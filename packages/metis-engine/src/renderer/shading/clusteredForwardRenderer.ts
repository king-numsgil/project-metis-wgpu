import {
    type GpuBindGroup,
    type GpuBindGroupLayout,
    type GpuBuffer,
    GPUBufferUsage,
    type GpuCommandEncoder,
    type GpuDevice,
    type GpuRenderPipeline,
    GPUShaderStage,
    type GpuTextureView,
} from "metis-native";
import { Mat4 } from "metis-data";
import { AmbientOcclusion } from "../ao/ambientOcclusion.ts";
import { AoTechnique } from "../ao/aoConfig.ts";
import type { GpuProfiler } from "../debug/gpuProfiler.ts";
import { type Mat4f, mat4f } from "../math/types.ts";
import { DEPTH_FORMAT, HDR_COLOR_FORMAT, MSAA_SAMPLE_COUNT, type RenderTargets } from "../rhi/targets.ts";
import { MESH_VERTEX_LAYOUT, type Mesh } from "../scene/mesh.ts";
import type { SpotLight } from "../scene/light.ts";
import type { Scene, SceneInstance } from "../scene/scene.ts";
import { DrawOrder, forEachDrawRun, PassBinder } from "./drawBatching.ts";
import { type Frustum, frustumFromViewProj, sphereInFrustum, worldBoundingSphereInto } from "../math/frustum.ts";
import { ModelBuffer } from "./modelBuffer.ts";
import { LightCuller } from "./lightCuller.ts";
import { CASCADE_SPLIT_LAMBDA_DEFAULT, SHADOW_DISTANCE_DEFAULT, ShadowCascades } from "./shadowCascades.ts";
import { selectShadowCastingSpots, SpotShadows } from "./spotShadows.ts";
import { CameraUniforms, EnvironmentUniforms, stage } from "./gpuLayouts.ts";
import commonWgsl from "./wgsl/common.wgsl" with { type: "text" };
import depthPrepassWgsl from "./wgsl/depth_prepass.wgsl" with { type: "text" };
import forwardWgsl from "./wgsl/forward.wgsl" with { type: "text" };

/**
 * Depth-tested clustered-forward PBR pass: every fragment sees the directional
 * sun + flat ambient (group 0/1/2 — camera, material, model) plus whatever
 * point lights the cluster-culling pass assigned to its cluster (group 3).
 *
 * This class owns the forward pipeline + camera/environment uniforms and
 * orchestrates the frame; the two heavier subsystems live in collaborators it
 * constructs: `LightCuller` (group-3 cluster light lists — the two compute
 * passes) and `ShadowCascades` (the 4-cascade directional shadow). `Ambient
 * Occlusion` is the third. `render()` wires all three into the forward pass's
 * frame bind group.
 */
export class ClusteredForwardRenderer {
    /** Group 0: camera + environment + shadow/AO resources. Exposed so a custom pass can match the layout. */
    readonly frameBindGroupLayout: GpuBindGroupLayout;
    /** Group 1: material factors + its 5 textures and sampler. */
    readonly materialBindGroupLayout: GpuBindGroupLayout;
    /** Group 2: the per-instance model + normal matrices. Also used by the shadow, AO-prepass, and depth-prepass pipelines. */
    readonly modelBindGroupLayout: GpuBindGroupLayout;
    /** Screen-space ambient occlusion (None/SSAO/HBAO). Set `.technique` to switch; applied to the ambient term only. */
    readonly ao: AmbientOcclusion;
    /**
     * Far reach of the shadowed region, in world units. The 4 cascades are fit
     * to the camera frustum over `[camera.near, shadowDistance]`; geometry
     * beyond it casts/receives no directional shadow (renders fully sunlit).
     * Keep this to the distance shadows are actually legible — the cascades
     * subdivide it, so a needlessly large value coarsens every cascade.
     */
    shadowDistance = SHADOW_DISTANCE_DEFAULT;
    /**
     * Practical-split blend (`1` = logarithmic → tight near cascade, `0` =
     * uniform). Higher biases resolution toward the camera; `0.85` keeps
     * cascade 0 crisp without starving the far cascades.
     */
    cascadeSplitLambda = CASCADE_SPLIT_LAMBDA_DEFAULT;
    /**
     * Opt-in GPU profiling. Leave `undefined` (the default) and every pass
     * encodes exactly as before — the hooks are `profiler?.` calls that cost
     * nothing when absent.
     *
     * Assign a `GpuProfiler` and each pass gets `timestampWrites`; read the
     * result back from `profiler.spans` and feed it to `DebugOverlay.tree` via
     * `profileSpansToRows`. The profiler can only be constructed on a device
     * that enabled `timestamp-query` (see `GpuProfiler.create`), so this can't
     * silently produce validation errors.
     *
     * The caller must drive `beginFrame`/`endFrame` around its own encoder —
     * the renderer only owns the passes, not the frame.
     */
    profiler?: GpuProfiler;
    /**
     * Render a depth-only pass before the forward pass, so occluded fragments
     * never run the clustered light loop or shadow sampling.
     *
     * On by default, because it measured a win in both directions: strongly so
     * with overdraw (a room full of objects roughly halved the forward pass and
     * cut the whole GPU frame by over a third), and *still* slightly positive
     * with none. The zero-overdraw case surprises people — the saving there
     * isn't early-Z, it's that the forward pass stops writing 4x-MSAA depth,
     * which is real bandwidth. The prepass writes it once, with no fragment
     * stage at all.
     *
     * Turn it off for geometry-heavy, overdraw-light scenes: the prepass reruns
     * every vertex shader, so a scene that is vertex-bound rather than
     * fragment-bound pays for it twice. Compare the `depth-prepass` and
     * `forward` spans with `bun run bench:lights --profile --prepass`.
     *
     * Two correctness requirements, both currently satisfied engine-wide:
     * - **Opaque geometry only.** An alpha-tested or blended material would have
     *   to be excluded from the prepass; nothing in the engine is either today.
     * - **The vertex transform must be bit-identical** between forward.wgsl and
     *   depth_prepass.wgsl, since the forward pass then tests `depthCompare:
     *   "equal"`. That's what the `@invariant` on both `@builtin(position)`
     *   outputs guarantees. If geometry ever vanishes wholesale after editing
     *   either vertex shader, this is the first thing to check.
     */
    depthPrepass = true;
    /**
     * Cull draws against the camera frustum, in the depth prepass, the forward
     * pass and the AO prepass.
     *
     * Before this existed, **off-screen was not undrawn** — every instance was
     * submitted every frame however far outside the view it sat. In a world
     * bigger than the screen that is the single largest source of wasted draws,
     * which is why this defaults on despite the bench barely exercising it (its
     * whole field is in front of the camera).
     *
     * The camera's projection is reverse-Z with an **infinite far plane**, so
     * this only ever rejects geometry behind the camera or off to the sides —
     * never for being distant. `test/cameraFrustum.test.ts` pins that, including
     * the degenerate plane the reverse-Z form produces.
     */
    frustumCulling = true;

    /** Instances drawn / considered by the forward pass last frame. */
    lastDrawnInstances = 0;
    lastCandidateInstances = 0;

    private readonly device: GpuDevice;
    private readonly pipeline: GpuRenderPipeline;
    private readonly depthPrepassPipeline: GpuRenderPipeline;
    private readonly depthPrepassBindGroup: GpuBindGroup;
    /** Forward variant used when `depthPrepass` is on: tests `equal`, writes no depth. */
    private readonly pipelineDepthEqual: GpuRenderPipeline;
    private readonly cameraBuffer: GpuBuffer;
    private readonly environmentBuffer: GpuBuffer;
    /** Scratch for the projection in `writeFrameUniforms`, so that path allocates nothing. */
    private readonly projScratch = mat4f();
    /** Persistent CPU staging — allocated once, rewritten in place each frame. */
    private readonly cameraBytes: Uint8Array;
    private readonly cameraStaging: {viewProj: Mat4f; view: Mat4f; position: Float32Array};
    private readonly environmentBytes: Uint8Array;
    private readonly environmentStaging: {
        sunDirection: Float32Array;
        sunColorIntensity: Float32Array;
        ambientColorIntensity: Float32Array;
    };
    private readonly culler: LightCuller;
    /** The 4-cascade directional shadow. Public for `cacheEnabled` and `lastRenderedCascades`. */
    readonly shadows: ShadowCascades;
    /** Per-spot-light shadow maps. `lastDrawnInstances`/`lastCandidateInstances` report cull effectiveness. */
    readonly spotShadows: SpotShadows;
    /** Frame-scoped draw sort, shared with the shadow passes. See `drawBatching.ts`. */
    private readonly drawOrder = new DrawOrder();
    /** The frame's shared `array<Model>`; every pass binds this one group. */
    private readonly models: ModelBuffer;
    /**
     * World bounding spheres for the frame's draw order, flat `[x,y,z,r]`.
     *
     * Computed **once here** and lent to `ShadowCascades` and `SpotShadows`.
     * They each used to derive their own — `SpotShadows` allocating an object
     * per instance per frame — which was three passes over the same matrices to
     * produce identical numbers, since a bounding sphere depends on the
     * instance and nothing about the viewer.
     */
    private worldSpheres = new Float32Array(0);
    /**
     * The `Mesh` each slot's sphere was computed against, so an in-place mesh
     * swap invalidates that slot. See the loop in `render()`.
     */
    private sphereMeshes: (Mesh | null)[] = [];
    /** Camera visibility for the frame's draw order; see `frustumCulling`. */
    private cameraVisible = new Uint8Array(0);
    private readonly cameraFrustum: Frustum = frustumFromViewProj(mat4f());
    /** Pass-scoped bind tracker for the prepass and forward passes; `begin()` per pass. */
    private readonly binder = new PassBinder();
    /**
     * Group 0, cached across frames.
     *
     * Seven of its eight entries are fixed for the renderer's lifetime — the two
     * uniform buffers this class owns, and the shadow/spot resources its
     * collaborators allocate once in their constructors. Only `ao.resultView`
     * is reallocated, and only when the viewport size changes, so the cache is
     * keyed on that view's identity. Rebuilding all eight entries every frame
     * was a per-frame napi crossing marshalling eight descriptors for a value
     * that changes on resize.
     */
    private frameBindGroup: GpuBindGroup | null = null;
    private frameBindGroupAoView: GpuTextureView | null = null;
    /**
     * This frame's shadow-casting spots, refilled in place each frame and handed
     * to *both* the culler and `SpotShadows` — the shared-derivation invariant
     * is unchanged, this only stops it allocating two arrays per frame.
     */
    private readonly shadowSpotsScratch: SpotLight[] = [];

    constructor(device: GpuDevice) {
        this.device = device;

        this.frameBindGroupLayout = device.createBindGroupLayout({
            label: "metis-engine/frame-bgl",
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: {bindingType: "uniform"},
                },
                {binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: {bindingType: "uniform"}},
                // Spot shadows reuse the slots the cascade-0 MSM moments texture
                // and its sampler used to occupy.
                {
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {sampleType: "depth", viewDimension: "2d-array"},
                },
                {binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: {bindingType: "uniform"}},
                {binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: {bindingType: "uniform"}}, // cascade uniforms
                {binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: {sampleType: "unfilterable-float"}}, // AO
                // All cascades: depth array + comparison sampler (hardware PCF).
                {
                    binding: 6,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {sampleType: "depth", viewDimension: "2d-array"},
                },
                {binding: 7, visibility: GPUShaderStage.FRAGMENT, sampler: {samplerType: "comparison"}},
            ],
        });
        this.materialBindGroupLayout = device.createBindGroupLayout({
            label: "metis-engine/material-bgl",
            entries: [
                {binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {bindingType: "uniform"}},
                {binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {samplerType: "filtering"}},
                {binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {sampleType: "float"}}, // albedo
                {binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {sampleType: "float"}}, // normal
                {binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: {sampleType: "float"}}, // metallic
                {binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: {sampleType: "float"}}, // roughness
                {binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: {sampleType: "float"}}, // emissive
            ],
        });
        this.modelBindGroupLayout = device.createBindGroupLayout({
            label: "metis-engine/model-bgl",
            // read-only-storage, not uniform: this is the frame-wide array<Model>
            // that every vertex shader indexes by @builtin(instance_index).
            entries: [{binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {bindingType: "read-only-storage"}}],
        });

        // Collaborators. The culler owns the group-3 layout the forward pipeline
        // needs; the shadow + AO subsystems both render from the model layout.
        this.models = new ModelBuffer(device, this.modelBindGroupLayout);
        this.culler = new LightCuller(device);
        this.shadows = new ShadowCascades(device, this.modelBindGroupLayout);
        this.spotShadows = new SpotShadows(device, this.modelBindGroupLayout);
        this.ao = new AmbientOcclusion(device, this.modelBindGroupLayout);

        const pipelineLayout = device.createPipelineLayout({
            label: "metis-engine/forward-pipeline-layout",
            bindGroupLayouts: [
                this.frameBindGroupLayout,
                this.materialBindGroupLayout,
                this.modelBindGroupLayout,
                this.culler.bindGroupLayout,
            ],
        });
        const module = device.createShaderModule({
            label: "metis-engine/forward-shader",
            code: `${commonWgsl}\n${forwardWgsl}`,
        });
        const forwardPipelineFor = (depthWriteEnabled: boolean, depthCompare: "greater" | "equal") =>
            device.createRenderPipeline({
                label: `metis-engine/forward-pipeline-${depthCompare}`,
                layout: pipelineLayout,
                vertex: {module, entryPoint: "vs", buffers: [MESH_VERTEX_LAYOUT]},
                fragment: {module, entryPoint: "fs", targets: [{format: HDR_COLOR_FORMAT}]},
                primitive: {topology: "triangle-list", cullMode: "back"},
                // "greater", not "less": Camera uses a reverse-Z projection (near -> 1,
                // infinity -> 0), which is what makes depth32float's precision land
                // where the perspective divide needs it. Paired with depthClearValue 0.
                depthStencil: {format: DEPTH_FORMAT, depthWriteEnabled, depthCompare},
                multisample: {count: MSAA_SAMPLE_COUNT},
            });
        this.pipeline = forwardPipelineFor(true, "greater");
        // Prepass variant: depth is already final, so test for an exact match and
        // write nothing. Built up front rather than lazily so toggling
        // `depthPrepass` at runtime never stalls on pipeline creation.
        this.pipelineDepthEqual = forwardPipelineFor(false, "equal");

        // ── Depth prepass ────────────────────────────────────────────────────
        // Its own minimal layout: a depth-only pass needs the camera and the
        // model matrix, nothing else. Reusing the 8-entry frame layout would
        // force the shadow/AO resources to be bound for a pass that can't read
        // them.
        const prepassCameraLayout = device.createBindGroupLayout({
            label: "metis-engine/depth-prepass-camera-bgl",
            entries: [{binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {bindingType: "uniform"}}],
        });
        const prepassModule = device.createShaderModule({
            label: "metis-engine/depth-prepass-shader",
            code: `${commonWgsl}
${depthPrepassWgsl}`,
        });
        this.depthPrepassPipeline = device.createRenderPipeline({
            label: "metis-engine/depth-prepass-pipeline",
            layout: device.createPipelineLayout({
                bindGroupLayouts: [prepassCameraLayout, this.modelBindGroupLayout],
            }),
            vertex: {module: prepassModule, entryPoint: "vs", buffers: [MESH_VERTEX_LAYOUT]},
            // No fragment stage at all — depth-only. That's the point: this pass
            // must be far cheaper than the shading it lets the forward pass skip.
            primitive: {topology: "triangle-list", cullMode: "back"},
            depthStencil: {format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: "greater"},
            multisample: {count: MSAA_SAMPLE_COUNT},
        });

        // Sizes derive from the descriptors — see gpuLayouts.ts. Each staging
        // buffer is allocated once and rewritten in place every frame.
        this.cameraBuffer = device.createBuffer({
            label: "metis-engine/camera",
            size: CameraUniforms.byteSize,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.environmentBuffer = device.createBuffer({
            label: "metis-engine/environment",
            size: EnvironmentUniforms.byteSize,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        const camStage = stage(CameraUniforms);
        this.cameraBytes = camStage.bytes;
        this.cameraStaging = {
            // Matrix members alias the upload bytes (see gpuLayouts.ts's
            // `stage`), so `writeFrameUniforms` computes into them directly.
            viewProj: camStage.mat4("viewProj"),
            view: camStage.mat4("view"),
            position: camStage.f32("position", 3),
        };
        const envStage = stage(EnvironmentUniforms);
        this.environmentBytes = envStage.bytes;
        this.environmentStaging = {
            sunDirection: envStage.f32("sunDirection", 3),
            sunColorIntensity: envStage.f32("sunColorIntensity", 4),
            ambientColorIntensity: envStage.f32("ambientColorIntensity", 4),
        };

        this.depthPrepassBindGroup = device.createBindGroup({
            label: "metis-engine/depth-prepass-bind-group",
            layout: prepassCameraLayout,
            entries: [{binding: 0, buffer: {buffer: this.cameraBuffer}}],
        });
    }

    /**
     * Records everything needed to produce one HDR frame into
     * `targets.hdrColorMultisampled` (auto-resolving into
     * `targets.hdrColorResolved`, which is what the post chain reads).
     *
     * Encodes, in order:
     * 1. camera + environment uniforms, and the packed light array;
     * 2. four cascaded sun-shadow depth passes;
     * 3. one depth pass per shadow-casting spot (frustum-culled per light);
     * 4. cluster build + light cull (two compute passes);
     * 5. ambient occlusion, or a clear-to-white when the technique is `None`;
     * 6. the optional depth prepass;
     * 7. the forward pass — one draw per `SceneInstance`.
     *
     * Nothing here touches a window or a surface: the caller owns the encoder,
     * the submit, and the present. This does **not** run the post chain — the
     * output is still HDR and untonemapped.
     */
    render(encoder: GpuCommandEncoder, targets: RenderTargets, scene: Scene) {
        this.writeFrameUniforms(scene);
        // Derived once and shared: LightCuller packs these lights first so a
        // light's buffer index is also its shadow-map layer, and SpotShadows
        // renders the layers in the same order. Two independent derivations
        // could disagree and shadow fragments with the wrong light's map.
        const shadowSpots = selectShadowCastingSpots(scene.lights, this.shadowSpotsScratch);
        // Sorted once per frame and shared by every pass that draws: all four
        // cascades, every spot layer, the prepass and the forward pass walk the
        // *same* order, so the redundant binds each of them skips are the same
        // ones. Sorting per pass would cost six sorts to reach the same place.
        const instances = this.drawOrder.update(scene.instances);
        // Every instance's model + normal matrix, written ONCE per frame into
        // one shared storage array and uploaded in a single crossing (skipped
        // entirely when nothing moved). Slot i is draw-order position i, which
        // every pass below relies on when it issues an instanced draw with
        // `firstInstance = run start`. See modelBuffer.ts.
        this.models.update(instances);
        const modelBindGroup = this.models.bindGroup;

        // Bounding spheres once, for every consumer. `models.update` has just
        // written each instance's matrix, so `modelFloats` is this frame's.
        let spheresStale = this.drawOrder.resorted;
        if (this.worldSpheres.length < instances.length * 4) {
            this.worldSpheres = new Float32Array(instances.length * 4);
            this.cameraVisible = new Uint8Array(instances.length);
            this.sphereMeshes = new Array<Mesh | null>(instances.length).fill(null);
            spheresStale = true; // a fresh array holds nothing
        }
        // A sphere depends on the instance's model matrix and its mesh's local
        // radius, and on nothing about the viewer — so an instance that did not
        // move, was not re-slotted and did not swap meshes still has last
        // frame's answer, and it is exactly right. Skipping recomputes three
        // `Math.hypot`s per instance per frame.
        //
        // The mesh check is not redundant with `modelChanged`: reassigning
        // `instance.mesh` in place changes `boundingRadius` while the transform
        // and the draw order both stay put. Unlike a stale *sort*, which only
        // costs binds, a stale radius is a wrong cull — an object that silently
        // stops being drawn. Same hazard, and same reasoning, as the mesh hash
        // in `ShadowCascades.castersChanged`.
        for (let i = 0; i < instances.length; i++) {
            const instance = instances[i]!;
            if (!spheresStale && !instance.modelChanged && this.sphereMeshes[i] === instance.mesh) {
                continue;
            }
            this.sphereMeshes[i] = instance.mesh;
            worldBoundingSphereInto(instance.modelFloats, instance.mesh.boundingRadius, this.worldSpheres, i * 4);
        }

        // ONE camera visibility mask, shared by the depth prepass, the forward
        // pass and the AO prepass. They must agree: with a prepass the forward
        // pass tests `depthCompare: "equal"`, so anything the forward pass draws
        // that the prepass skipped has no matching depth and renders as nothing.
        // Deriving the set twice would make that a matter of luck.
        this.lastCandidateInstances = instances.length;
        this.lastDrawnInstances = 0;
        if (this.frustumCulling) {
            frustumFromViewProj(this.cameraStaging.viewProj, this.cameraFrustum);
            for (let i = 0; i < instances.length; i++) {
                const b = i * 4;
                const inside = sphereInFrustum(
                    this.cameraFrustum,
                    this.worldSpheres[b]!, this.worldSpheres[b + 1]!,
                    this.worldSpheres[b + 2]!, this.worldSpheres[b + 3]!,
                );
                this.cameraVisible[i] = inside ? 1 : 0;
            }
        }
        const visible = this.cameraVisible;
        const cameraFilter = this.frustumCulling
            ? (_instance: SceneInstance, index: number) => visible[index] === 1
            : null;

        this.culler.write(scene, targets, shadowSpots);
        this.shadows.render(
            encoder, scene, instances, modelBindGroup, this.worldSpheres,
            this.shadowDistance, this.cascadeSplitLambda, this.profiler);
        this.spotShadows.render(encoder, instances, modelBindGroup, this.worldSpheres, shadowSpots, this.profiler);
        this.culler.cull(encoder, this.profiler);

        // Ambient occlusion (feeds the forward pass's ambient term). `None`
        // clears the result to white so the forward multiply is a no-op.
        this.ao.ensureSize(targets.width, targets.height);
        if (this.ao.technique === AoTechnique.None) {
            this.ao.clearToWhite(encoder, this.profiler);
        } else {
            this.ao.render(encoder, scene, instances, modelBindGroup, cameraFilter, targets, this.profiler);
        }

        // Rebuilt only when AO's result texture was reallocated (a resize) —
        // every other entry is fixed for this renderer's lifetime.
        const aoView = this.ao.resultView;
        if (!this.frameBindGroup || this.frameBindGroupAoView !== aoView) {
            this.frameBindGroup = this.device.createBindGroup({
                label: "metis-engine/frame-bind-group",
                layout: this.frameBindGroupLayout,
                entries: [
                    {binding: 0, buffer: {buffer: this.cameraBuffer}},
                    {binding: 1, buffer: {buffer: this.environmentBuffer}},
                    {binding: 2, textureView: this.spotShadows.depthArrayView},
                    {binding: 3, buffer: {buffer: this.spotShadows.uniformBuffer}},
                    {binding: 4, buffer: {buffer: this.shadows.uniformBuffer}},
                    {binding: 5, textureView: aoView},
                    {binding: 6, textureView: this.shadows.depthArrayView},
                    {binding: 7, sampler: this.shadows.compareSampler},
                ],
            });
            this.frameBindGroupAoView = aoView;
        }
        const frameBindGroup = this.frameBindGroup;

        if (this.depthPrepass) {
            const pre = encoder.beginRenderPass({
                label: "metis-engine/depth-prepass",
                timestampWrites: this.profiler?.pass("depth-prepass"),
                colorAttachments: [],
                depthStencilAttachment: {
                    view: targets.depthView,
                    depthLoadOp: "clear",
                    depthStoreOp: "store", // the forward pass reads it back
                    depthClearValue: 0.0, // reverse-Z: 0 = infinitely far
                },
            });
            pre.setPipeline(this.depthPrepassPipeline);
            pre.setBindGroup(0, this.depthPrepassBindGroup);
            // Bound once for the whole pass now, not once per draw.
            pre.setBindGroup(1, modelBindGroup);
            this.binder.begin();
            forEachDrawRun(instances, cameraFilter, false, (mesh, _material, first, count) => {
                this.binder.setMesh(pre, mesh);
                mesh.draw(pre, count, first);
            });
            pre.end();
        }

        const pass = encoder.beginRenderPass({
            label: "metis-engine/forward-pass",
            timestampWrites: this.profiler?.pass("forward"),
            colorAttachments: [
                {
                    view: targets.hdrColorMultisampledView,
                    resolveTarget: targets.hdrColorResolvedView,
                    loadOp: "clear",
                    storeOp: "discard", // multisampled data is only needed until it's resolved above
                    clearValue: {r: 0, g: 0, b: 0, a: 1},
                },
            ],
            depthStencilAttachment: {
                view: targets.depthView,
                // With a prepass the depth buffer is already final — load it and
                // test `equal`. Without one, clear and write as usual.
                depthLoadOp: this.depthPrepass ? "load" : "clear",
                depthStoreOp: "store",
                depthClearValue: 0.0, // reverse-Z: 0 = infinitely far = "nothing drawn"
            },
        });

        pass.setPipeline(this.depthPrepass ? this.pipelineDepthEqual : this.pipeline);
        pass.setBindGroup(0, frameBindGroup);
        pass.setBindGroup(2, modelBindGroup);
        pass.setBindGroup(3, this.culler.bindGroup);

        this.binder.begin();
        // Grouped by material as well as mesh: this is the one pass that binds a
        // material, so a run here is the intersection of both.
        forEachDrawRun(instances, cameraFilter, true, (mesh, material, first, count) => {
            // Accumulated from the draws themselves, so `lastDrawnInstances`
            // reports submission rather than intent — see the note above
            // `frustumCulling`.
            this.lastDrawnInstances += count;
            this.binder.setMaterial(pass, 1, material, this.device, this.materialBindGroupLayout);
            this.binder.setMesh(pass, mesh);
            // One zone per *run*, so a scene of N identical meshes now reports a
            // single row instead of N — the profiler tree's `xN` merge counts
            // draws, and there is genuinely one draw. See CLAUDE.md.
            this.profiler?.beginZone(pass, mesh.label ?? `instances ${first}..${first + count - 1}`);
            mesh.draw(pass, count, first);
            this.profiler?.endZone(pass);
        });

        pass.end();
    }

    /**
     * Releases the renderer's buffers and every collaborator it constructed
     * (culler, cascades, spot shadows, AO). Does not touch the `RenderTargets`
     * or anything in the `Scene` — those are the caller's.
     */
    destroy() {
        this.cameraBuffer.destroy();
        this.environmentBuffer.destroy();
        this.models.destroy();
        this.culler.destroy();
        this.shadows.destroy();
        this.spotShadows.destroy();
        this.ao.destroy();
    }

    private writeFrameUniforms(scene: Scene) {
        // Written straight into the packed slots — no intermediate matrices.
        // `view` is computed once here and reused for the product, rather than
        // calling viewProjectionMatrix() (which would recompute it internally).
        const cam = this.cameraStaging;
        scene.camera.viewMatrix(cam.view);
        Mat4.multiply(cam.viewProj, scene.camera.projectionMatrix(this.projScratch), cam.view);
        const p = scene.camera.position.view();
        cam.position[0] = p[0]!;
        cam.position[1] = p[1]!;
        cam.position[2] = p[2]!;
        this.device.queue.writeBuffer(this.cameraBuffer, 0, this.cameraBytes);

        const env = this.environmentStaging;
        const sd = scene.environment.sunDirection.view();
        env.sunDirection[0] = sd[0]!;
        env.sunDirection[1] = sd[1]!;
        env.sunDirection[2] = sd[2]!;
        const sc = scene.environment.sunColor;
        env.sunColorIntensity[0] = sc[0];
        env.sunColorIntensity[1] = sc[1];
        env.sunColorIntensity[2] = sc[2];
        env.sunColorIntensity[3] = scene.environment.sunIntensity;
        const ac = scene.environment.ambientColor;
        env.ambientColorIntensity[0] = ac[0];
        env.ambientColorIntensity[1] = ac[1];
        env.ambientColorIntensity[2] = ac[2];
        env.ambientColorIntensity[3] = scene.environment.ambientIntensity;
        this.device.queue.writeBuffer(this.environmentBuffer, 0, this.environmentBytes);
    }
}
