import {
    type GpuBindGroup,
    type GpuBindGroupLayout,
    type GpuBuffer,
    GPUBufferUsage,
    type GpuCommandEncoder,
    type GpuDevice,
    type GpuRenderPipeline,
    type GpuSampler,
    GPUShaderStage,
    type GpuTexture,
    GPUTextureUsage,
    type GpuTextureView,
} from "metis-native";
import { Mat4, Vec3 } from "metis-data";
import type { GpuProfiler } from "../debug/gpuProfiler.ts";
import { type Mat4f, mat4f, type Vec3f, vec3f } from "../math/types.ts";
import { MESH_VERTEX_LAYOUT } from "../scene/mesh.ts";
import type { Scene, SceneInstance } from "../scene/scene.ts";
import { castsShadow, forEachDrawRun, PassBinder } from "./drawBatching.ts";
import { type Frustum, frustumFromViewProj, sphereInFrustum } from "../math/frustum.ts";
import { CASCADE_COUNT, SHADOW_MAP_SIZE } from "./shadowConfig.ts";
import { CascadeUniforms, SHADOW_RENDER_STRIDE, stage, wrapMat4 } from "./gpuLayouts.ts";
import commonWgsl from "./wgsl/common.wgsl" with { type: "text" };
import shadowWgsl from "./wgsl/shadow.wgsl" with { type: "text" };

// Defined in shadowConfig.ts (a leaf module) so gpuLayouts.ts can size its
// descriptor arrays without importing this file back — see shadowConfig.ts.
// Re-exported here so the public import path is unchanged.
export { CASCADE_COUNT, SHADOW_MAP_SIZE };

const SHADOW_DEPTH_FORMAT = "depth32float" as const;

// Normal-offset sizing, applied per cascade. The offset must clear the depth
// spread of the 3x3 PCF footprint on a light-slanted receiver, which scales with
// the shadow texel's world size — so it is a *texel-count* quantity, not a
// world-space constant. A fixed world value silently collapses to sub-texel on
// the coarse far cascades and stripes the ground with acne (directly observed
// before this was texel-scaled); here each cascade gets its own offset from its
// own texel size. The `MIN` floor guarantees a minimum world-space displacement
// so a very fine cascade can't offset by a sub-millimetre amount that fp32
// rounding swallows.
//
// NB the floor is *binding on cascade 0* at the default `shadowDistance` (it
// only stops applying once a cascade's bounding radius exceeds
// SHADOW_MAP_SIZE·MIN/(2·TEXELS)), so cascade 0 is over-offset for its own texel
// size. Harmless today, but it is the first thing to lower if near contact
// shadows ever look detached (peter-panning) — cascade 0 used to be MSM, which
// needed no depth bias at all. See CLAUDE.md "Cascaded shadow maps".
const SHADOW_NORMAL_OFFSET_TEXELS = 2.0;
const SHADOW_NORMAL_OFFSET_MIN = 0.04;

// ── Cascaded shadow maps ────────────────────────────────────────────────────
// Four cascades fit to the camera frustum, all four plain depth32float sampled
// with a hardware comparison sampler (PCF): one depth array, one layer each.
// PCF is inherently bleed-free, and its small texel-scaled normal-offset bias
// is the only bias needed. See CLAUDE.md "Cascaded shadow maps".
//
// VRAM at 2048²: 4 × depth32float (4 × 17 MB) ≈ 67 MB.
/** Default for `ClusteredForwardRenderer.cascadeSplitLambda` — see that field for what it does. */
export const CASCADE_SPLIT_LAMBDA_DEFAULT = 0.85;
/** Default for `ClusteredForwardRenderer.shadowDistance`, in world units. */
export const SHADOW_DISTANCE_DEFAULT = 400;
// Each cascade cross-fades into the next over this fraction of its depth span,
// hiding the resolution step at the boundary.
const CASCADE_BLEND_FRACTION = 0.12;
// Light-space ortho depth range around a cascade's bounding-sphere centre, in
// units of the sphere radius: [center - NEAR·r toward the sun, center + FAR·r].
// NEAR is generous so occluders standing just outside the slice still cast in.
const CASCADE_ORTHO_NEAR_SCALE = 3.0;
const CASCADE_ORTHO_FAR_SCALE = 1.5;
// Sizes/strides now come from gpuLayouts.ts (CascadeUniforms,
// SHADOW_RENDER_STRIDE) rather than being hand-computed here.

/**
 * A fitted cascade. **No `viewProj` field** — `computeCascades` writes each
 * cascade's matrix directly into its render-buffer slice
 * (`renderMatrices[c]`) rather than handing one back to be copied.
 */
interface Cascade {
    radius: number;
    splitFar: number;
    normalOffset: number;
}

/**
 * The directional shadow: a 4-cascade CSM, every cascade plain depth + hardware
 * PCF. `render` records all the shadow passes; the forward pass samples the
 * result via `depthArrayView`/`compareSampler` plus `uniformBuffer` (the
 * per-frame cascade matrices/splits/offsets). See CLAUDE.md "Cascaded shadow
 * maps".
 */
export class ShadowCascades {
    /** All cascades' depth array (2d-array), binding 6. */
    readonly depthArrayView: GpuTextureView;
    /** Comparison sampler for hardware PCF, binding 7. */
    readonly compareSampler: GpuSampler;
    /** Per-frame CascadeUniforms (matrices + splits + offsets), binding 4. */
    readonly uniformBuffer: GpuBuffer;

    private readonly device: GpuDevice;
    private readonly modelBindGroupLayout: GpuBindGroupLayout;
    /** Redundant-bind tracker, reset at the start of each cascade's pass. */
    private readonly binder = new PassBinder();
    // All cascades: one depth32float array, one layer each.
    private readonly pcfDepthArray: GpuTexture;
    private readonly pcfDepthLayerViews: GpuTextureView[]; // per-layer, for rendering
    // Per-cascade light matrix for the render passes (offset-addressed slices).
    private readonly cascadeRenderBuffer: GpuBuffer;
    private readonly cascadeRenderBindGroups: GpuBindGroup[];
    private readonly pcfDepthPipeline: GpuRenderPipeline; // single-sample depth
    /** Persistent staging, allocated once (see gpuLayouts.ts). */
    private readonly renderBytes: Uint8Array;
    /** `Mat4f` per 256-byte slice, aliasing {@link renderBytes} — cascade fits write straight in. */
    private readonly renderMatrices: Mat4f[];
    /** Flat float views of the same slices, for the copy into the forward array. */
    private readonly renderMatrixViews: Float32Array[];
    private readonly forwardBytes: Uint8Array;
    private readonly forwardStaging: {
        viewProj: Float32Array;
        splitDepths: Float32Array;
        normalOffsets: Float32Array;
        params: Float32Array;
    };
    /**
     * Per-frame scratch for the cascade fit, so `computeCascades` allocates
     * nothing. It runs once a frame and builds four cascades from these.
     */
    private readonly scratch = {
        invView: mat4f(),
        view: mat4f(),
        lightView: mat4f(),
        proj: mat4f(),
        sunDir: vec3f(),
        up: vec3f(),
        zAxis: vec3f(),
        xAxis: vec3f(),
        yAxis: vec3f(),
        center: vec3f(),
        eye: vec3f(),
        offset: vec3f(),
        corner: vec3f(),
        // The eight frustum-slice corners, reused every cascade.
        corners: Array.from({length: 8}, () => vec3f()),
    };

    /**
     * Per-cascade copy of the `viewProj` its depth layer was last rendered with.
     * NaN-filled, so the first frame's compare cannot match and every cascade
     * renders once before anything is skipped — the depth array's contents are
     * undefined until something writes them.
     */
    private readonly cachedMatrices: Float32Array[] = Array.from({length: CASCADE_COUNT}, () =>
        new Float32Array(16).fill(NaN),
    );
    /** Caster-set fingerprint from the previous frame; see `castersChanged`. */
    private previousCasterCount = -1;
    private previousCasterHash = 0;
    /** How many cascades actually re-rendered last frame (0..CASCADE_COUNT). Diagnostics only. */
    lastRenderedCascades = CASCADE_COUNT;

    /**
     * Set `false` to re-render every cascade every frame, as this class did
     * before the cache existed. Exists so the cache can be A/B'd against itself
     * on one machine in one sitting (`bench:lights --no-shadow-cache`), which is
     * this package's standing requirement for a performance claim.
     */
    cacheEnabled = true;

    /**
     * Cull each cascade's draws against its own ortho frustum.
     *
     * **Free of visual consequence by construction**: the test volume is the
     * exact matrix the pass renders with, so anything it rejects would have been
     * clipped anyway. The fixtures assert that — they come back byte-identical
     * either way.
     *
     * **Off by default, on measurement rather than principle.** On the only
     * scene the bench can build it rejects ~16-20% of cascade draws and produces
     * *no* frame-time change that survives this machine's run-to-run drift,
     * while costing per-frame CPU: four sphere tests per instance, plus run
     * fragmentation, since a culled instance splits an instanced draw
     * (`forEachDrawRun`). Turn it on for a world genuinely larger than the
     * cascades — see CLAUDE.md "Per-cascade frustum culling measured as
     * nothing" for why this bench cannot show that and what would.
     *
     * A/B with `bench:lights --helmets 400 --no-shadow-cache --cascade-cull`,
     * alternating runs; the cache has to be off or there is nothing to cull.
     */
    cullPerCascade = false;

    /** Draws issued / casters considered, summed over all four cascades last frame. */
    lastDrawnInstances = 0;
    lastCandidateInstances = 0;

    /** Per-cascade visibility mask; see the purity note on `forEachDrawRun`. */
    private visible = new Uint8Array(0);
    private readonly cascadeFrustum: Frustum = frustumFromViewProj(mat4f());

    constructor(device: GpuDevice, modelBindGroupLayout: GpuBindGroupLayout) {
        this.device = device;
        this.modelBindGroupLayout = modelBindGroupLayout;

        // ── All cascades: PCF depth array (one layer each) ──────────────────
        this.pcfDepthArray = device.createTexture({
            label: "metis-engine/pcf-depth-array",
            size: {width: SHADOW_MAP_SIZE, height: SHADOW_MAP_SIZE, depthOrArrayLayers: CASCADE_COUNT},
            format: SHADOW_DEPTH_FORMAT,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        this.depthArrayView = this.pcfDepthArray.createView({dimension: "2d-array"});
        this.pcfDepthLayerViews = [];
        for (let i = 0; i < CASCADE_COUNT; i++) {
            this.pcfDepthLayerViews.push(this.pcfDepthArray.createView({
                dimension: "2d",
                baseArrayLayer: i,
                arrayLayerCount: 1,
            }));
        }
        // The shadow pass renders standard-Z ortho depth (near=0, far=1, smaller
        // = closer to the light), so a receiver is lit where its depth <= the
        // stored occluder depth. Linear filter gives 2x2 hardware PCF per tap.
        this.compareSampler = device.createSampler({
            label: "metis-engine/shadow-compare-sampler",
            compare: "less-equal",
            magFilter: "linear",
            minFilter: "linear",
            addressModeU: "clamp-to-edge",
            addressModeV: "clamp-to-edge",
        });

        // Per-cascade light matrix for the render passes (one mat4 per slice).
        this.cascadeRenderBuffer = device.createBuffer({
            label: "metis-engine/cascade-render-uniforms",
            size: CASCADE_COUNT * SHADOW_RENDER_STRIDE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.uniformBuffer = device.createBuffer({
            label: "metis-engine/cascade-forward-uniforms",
            size: CascadeUniforms.byteSize,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Per-cascade render matrix staging. One mat4 per 256-byte slice, so
        // this is a raw buffer with a view per slice rather than an ArrayOf —
        // metis-data has no way to declare a stride wider than the element.
        const renderBuffer = new ArrayBuffer(CASCADE_COUNT * SHADOW_RENDER_STRIDE);
        this.renderBytes = new Uint8Array(renderBuffer);
        this.renderMatrices = [];
        this.renderMatrixViews = [];
        for (let i = 0; i < CASCADE_COUNT; i++) {
            this.renderMatrices.push(wrapMat4(renderBuffer, i * SHADOW_RENDER_STRIDE));
            this.renderMatrixViews.push(new Float32Array(renderBuffer, i * SHADOW_RENDER_STRIDE, 16));
        }

        const fw = stage(CascadeUniforms);
        this.forwardBytes = fw.bytes;
        this.forwardStaging = {
            viewProj: fw.f32("viewProj", CASCADE_COUNT * 16),
            splitDepths: fw.f32("splitDepths", 4),
            normalOffsets: fw.f32("normalOffsets", 4),
            params: fw.f32("params", 4),
        };
        // params is constant for the lifetime of the object.
        this.forwardStaging.params[0] = CASCADE_COUNT;
        this.forwardStaging.params[1] = SHADOW_MAP_SIZE;
        this.forwardStaging.params[2] = CASCADE_BLEND_FRACTION;

        const shadowFrameBGL = device.createBindGroupLayout({
            label: "metis-engine/shadow-frame-bgl",
            entries: [{binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {bindingType: "uniform"}}],
        });
        // One offset bind group per cascade, each viewing its 64-byte mat4 slice.
        this.cascadeRenderBindGroups = [];
        for (let i = 0; i < CASCADE_COUNT; i++) {
            this.cascadeRenderBindGroups.push(device.createBindGroup({
                label: `metis-engine/cascade-render-bg-${i}`,
                layout: shadowFrameBGL,
                entries: [{
                    binding: 0,
                    buffer: {buffer: this.cascadeRenderBuffer, offset: i * SHADOW_RENDER_STRIDE, size: 64},
                }],
            }));
        }
        const shadowModule = device.createShaderModule({
            label: "metis-engine/shadow-shader",
            code: `${commonWgsl}\n${shadowWgsl}`,
        });
        const shadowPipelineLayout = device.createPipelineLayout({bindGroupLayouts: [shadowFrameBGL, modelBindGroupLayout]});
        // No culling: the light's viewpoint has nothing to do with the main
        // camera's, so backface culling tuned for interior-normal geometry (a
        // room shell viewed from inside) would wrongly drop triangles that are
        // front-facing to the camera but back-facing to the light — exactly the
        // geometry a shadow pass most needs.
        this.pcfDepthPipeline = device.createRenderPipeline({
            label: "metis-engine/pcf-depth-pipeline",
            layout: shadowPipelineLayout,
            vertex: {module: shadowModule, entryPoint: "vs", buffers: [MESH_VERTEX_LAYOUT]},
            primitive: {topology: "triangle-list", cullMode: "none"},
            depthStencil: {format: SHADOW_DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: "less"},
        });
    }

    /**
     * Records this frame's cascade shadow passes: one single-sample depth-only
     * pass per cascade into its own layer of the depth array, fit to
     * `[camera.near, shadowDistance]` by the practical split (`splitLambda`).
     * Also uploads the per-frame cascade matrices/splits/offsets the forward
     * pass reads from {@link uniformBuffer}.
     *
     * **A cascade whose fit and casters are unchanged is skipped entirely** —
     * see `cacheEnabled` and CLAUDE.md "Cascade shadow maps are cached". When a
     * cascade does render it redraws every instance: there is no per-cascade
     * frustum culling (deliberate: a cascade's ortho frustum is fit to a slice
     * of the camera frustum, so almost nothing the camera sees falls outside
     * it), which is also why invalidation is frame-global.
     *
     * @param instances the frame's draw order from `DrawOrder` — **not**
     *   `scene.instances`. Same array for every pass in the frame, so the
     *   redundant binds each pass skips are the same ones; see `drawBatching.ts`.
     * @param shadowDistance far reach of the shadowed region, in world units.
     * @param splitLambda practical-split blend: 1 = logarithmic, 0 = uniform.
     */
    render(
        encoder: GpuCommandEncoder,
        scene: Scene,
        instances: readonly SceneInstance[],
        modelBindGroup: GpuBindGroup,
        /** Shared per-frame world bounding spheres, flat `[x,y,z,r]`. */
        spheres: Float32Array,
        shadowDistance: number,
        splitLambda: number,
        profiler?: GpuProfiler,
    ) {
        const cascades = this.computeCascades(scene, shadowDistance, splitLambda);

        // Per-cascade render matrix (one 64-byte mat4 per 256-byte slice), then
        // the forward set: matrices + split far-depths + per-cascade offsets.
        // `params` was written once at construction.
        // `computeCascades` wrote each viewProj straight into its 256-stride
        // render slice, so this only fans it out to the forward array.
        const fw = this.forwardStaging;
        for (let c = 0; c < CASCADE_COUNT; c++) {
            const cascade = cascades[c]!;
            fw.viewProj.set(this.renderMatrixViews[c]!, c * 16);
            fw.splitDepths[c] = cascade.splitFar;
            fw.normalOffsets[c] = cascade.normalOffset;
        }
        // One upload for all four slices instead of four.
        this.device.queue.writeBuffer(this.cascadeRenderBuffer, 0, this.renderBytes);
        this.device.queue.writeBuffer(this.uniformBuffer, 0, this.forwardBytes);

        this.lastDrawnInstances = 0;
        this.lastCandidateInstances = 0;
        // Grow BEFORE the capture below. `visible` is closed over by `isVisible`,
        // so reallocating it afterwards would leave the predicate reading a
        // stale zero-length array — every index `undefined`, every instance
        // culled, every shadow silently gone. That is exactly what happened the
        // first time this was written, and the fixtures caught it.
        if (this.visible.length < instances.length) {
            this.visible = new Uint8Array(instances.length);
        }
        const visible = this.visible;
        const isVisible = (_instance: SceneInstance, index: number) => visible[index] === 1;

        const drawScene = (pass: ReturnType<GpuCommandEncoder["beginRenderPass"]>, cascade: number) => {
            pass.setBindGroup(0, this.cascadeRenderBindGroups[cascade]!);
            pass.setBindGroup(1, modelBindGroup);
            // Per pass, not per cascade loop: nothing survives beginRenderPass.
            this.binder.begin();

            let filter: ((instance: SceneInstance, index: number) => boolean) | null = castsShadow;
            if (this.cullPerCascade) {
                // Tested once per instance here, in a plain loop, because the
                // sphere test is real work and the counters are a side effect —
                // `forEachDrawRun` may consult its predicate twice at a run
                // boundary, so what it gets is the pure lookup below.
                frustumFromViewProj(this.renderMatrices[cascade]!, this.cascadeFrustum);
                for (let k = 0; k < instances.length; k++) {
                    if (!instances[k]!.castsShadow) {
                        visible[k] = 0;
                        continue;
                    }
                    this.lastCandidateInstances++;
                    const b = k * 4;
                    const inside = sphereInFrustum(
                        this.cascadeFrustum,
                        spheres[b]!, spheres[b + 1]!, spheres[b + 2]!, spheres[b + 3]!,
                    );
                    visible[k] = inside ? 1 : 0;
                    if (inside) {
                        this.lastDrawnInstances++;
                    }
                }
                filter = isVisible;
            }

            // Depth-only — no material here, which is why the draw sort is
            // mesh-major: this pass and the three others like it can only ever
            // batch on mesh, and so get the longest runs.
            forEachDrawRun(instances, filter, false, (mesh, _material, first, count) => {
                this.binder.setMesh(pass, mesh);
                mesh.draw(pass, count, first);
            });
        };

        // A caster that moved, appeared, vanished or swapped its mesh invalidates
        // every cascade at once: knowing *which* cascades a given caster falls in
        // would need a per-instance/per-cascade frustum test, which does not
        // exist yet (see CLAUDE.md's per-cascade frustum culling entry). Until it
        // does, one moved object costs a full re-render — correct, and no worse
        // than the uncached behaviour it replaces.
        const castersMoved = this.castersChanged(instances);


        // Every cascade (PCF): single-sample depth into its array layer.
        this.lastRenderedCascades = 0;
        for (let c = 0; c < CASCADE_COUNT; c++) {
            if (this.cacheEnabled && !castersMoved && this.matchesCached(c)) {
                // Skip the pass entirely — not a cheaper pass, no pass at all.
                // The layer keeps the depth it was last rendered with, which is
                // still exactly right: we only get here when this cascade's
                // viewProj is bit-identical to the one that produced it, so the
                // `CascadeUniforms.viewProj` the forward pass samples with still
                // matches the map it samples. That agreement is the whole
                // correctness argument, and it is why the test is on the matrix
                // rather than on "did the camera move".
                continue;
            }
            const pass = encoder.beginRenderPass({
                label: `metis-engine/pcf-cascade-${c}-depth-pass`,
                timestampWrites: profiler?.pass(`pcf-cascade-${c}-depth`),
                colorAttachments: [],
                depthStencilAttachment: {
                    view: this.pcfDepthLayerViews[c]!,
                    depthLoadOp: "clear",
                    depthStoreOp: "store",
                    depthClearValue: 1.0, // z=1 (farthest) = "no occluder here"
                },
            });
            pass.setPipeline(this.pcfDepthPipeline);
            drawScene(pass, c);
            pass.end();
            this.cachedMatrices[c]!.set(this.renderMatrixViews[c]!);
            this.lastRenderedCascades++;
        }
    }

    /** True when cascade `c`'s fit is bit-identical to the one its layer holds. */
    private matchesCached(c: number): boolean {
        const now = this.renderMatrixViews[c]!;
        const cached = this.cachedMatrices[c]!;
        for (let i = 0; i < 16; i++) {
            if (now[i] !== cached[i]) {
                return false;
            }
        }
        return true;
    }

    /**
     * Whether anything about the shadow-casting set differs from last frame:
     * a caster moved, one was added or removed, `castsShadow` was toggled, or an
     * instance's `mesh` was swapped under it.
     *
     * **The mesh hash is not paranoia.** Movement is caught by
     * `SceneInstance.modelChanged` and membership by the count, but reassigning
     * `instance.mesh` in place changes the silhouette while leaving both
     * unchanged — and unlike `DrawOrder`, where a stale answer is merely a missed
     * optimisation, a stale answer here is a *wrong picture*: an object casting
     * the shadow of the mesh it used to be. Hashing the ids costs one multiply
     * per caster in a loop that already exists.
     */
    private castersChanged(instances: readonly SceneInstance[]): boolean {
        let count = 0;
        let hash = 0;
        let moved = false;
        for (let i = 0; i < instances.length; i++) {
            const instance = instances[i]!;
            if (!instance.castsShadow) {
                continue;
            }
            count++;
            hash = (Math.imul(hash, 31) + instance.mesh.id) | 0;
            if (instance.modelChanged) {
                moved = true;
            }
        }
        const changed = moved || count !== this.previousCasterCount || hash !== this.previousCasterHash;
        this.previousCasterCount = count;
        this.previousCasterHash = hash;
        return changed;
    }

    /** Releases the depth array and both uniform buffers. */
    destroy() {
        this.pcfDepthArray.destroy();
        this.cascadeRenderBuffer.destroy();
        this.uniformBuffer.destroy();
    }

    /**
     * Fits one orthographic frustum per cascade to a slice of the camera
     * frustum. Cascades subdivide `[camera.near, shadowDistance]` by the
     * practical split scheme; each is fit to the slice's *bounding sphere*
     * (rotation-invariant, so the ortho size is constant frame-to-frame → no
     * shimmer from camera rotation), and its centre is snapped to whole shadow
     * texels (→ no shimmer from camera translation).
     */
    private computeCascades(scene: Scene, shadowDistance: number, splitLambda: number): Cascade[] {
        const cam = scene.camera;
        const near = Math.max(cam.near, 1e-3);
        const far = shadowDistance;

        // Practical split: blend logarithmic (near-crisp) and uniform far-boundaries.
        const splitFar: number[] = [];
        for (let i = 1; i <= CASCADE_COUNT; i++) {
            const s = i / CASCADE_COUNT;
            const logSplit = near * Math.pow(far / near, s);
            const uniSplit = near + (far - near) * s;
            splitFar.push(splitLambda * logSplit + (1 - splitLambda) * uniSplit);
        }

        // Everything below runs out of `this.scratch` — this method is called
        // once per frame and builds four cascades, so nothing here allocates.
        const S = this.scratch;
        Mat4.invert(S.invView, cam.viewMatrix(S.view));
        const tanHalfY = Math.tan(cam.fovYRadians / 2);
        const tanHalfX = tanHalfY * cam.aspect;
        const sunDir = Vec3.normalize(S.sunDir, scene.environment.sunDirection);
        const sun = sunDir.view();
        // +Y up, unless the sun is near-vertical and would make it degenerate.
        // The choice only spins the map about its own axis, which is invisible.
        const up = Math.abs(sun[1] as number) > 0.98
            ? Vec3.set(S.up, 1, 0, 0)
            : Vec3.set(S.up, 0, 1, 0);
        // Light XY basis (rotation only), for texel-snapping the sphere centre.
        const zAxis = Vec3.negate(S.zAxis, sunDir); // view looks down -z; eye is toward the light
        const xAxis = Vec3.normalize(S.xAxis, Vec3.cross(S.xAxis, up, zAxis));
        const yAxis = Vec3.cross(S.yAxis, zAxis, xAxis);

        const cascades: Cascade[] = [];
        let sliceNear = near;
        for (let c = 0; c < CASCADE_COUNT; c++) {
            const sliceFar = splitFar[c]!;

            // 8 world-space corners of this frustum slice.
            const corners = S.corners;
            let n = 0;
            for (const d of [sliceNear, sliceFar]) {
                for (const sx of [-1, 1]) {
                    for (const sy of [-1, 1]) {
                        Vec3.set(S.corner, sx * d * tanHalfX, sy * d * tanHalfY, -d);
                        Vec3.transformMat4(corners[n++]!, S.corner, S.invView);
                    }
                }
            }

            // Bounding sphere (average-centre — stable and standard for CSM).
            const center = Vec3.set(S.center, 0, 0, 0);
            for (const p of corners) {
                Vec3.add(center, center, p);
            }
            Vec3.scale(center, center, 1 / corners.length);
            let radius = 0;
            for (const p of corners) {
                radius = Math.max(radius, Vec3.distance(center, p));
            }
            // Quantize the radius so it doesn't wobble by sub-texel amounts.
            radius = Math.ceil(radius * 16) / 16;

            const worldPerTexel = (2 * radius) / SHADOW_MAP_SIZE;
            // Snap the centre within the light's XY plane to the texel grid.
            const cx = Vec3.dot(center, xAxis);
            const cy = Vec3.dot(center, yAxis);
            const snapX = Math.round(cx / worldPerTexel) * worldPerTexel - cx;
            const snapY = Math.round(cy / worldPerTexel) * worldPerTexel - cy;
            Vec3.add(center, center, Vec3.scale(S.offset, xAxis, snapX));
            Vec3.add(center, center, Vec3.scale(S.offset, yAxis, snapY));

            const dist = radius * CASCADE_ORTHO_NEAR_SCALE;
            const eye = Vec3.subtract(S.eye, center, Vec3.scale(S.offset, sunDir, dist));
            const lightView = Mat4.setLookAt(S.lightView, eye, center, up);
            // Ortho half-extent padded by a texel so the ≤1-texel snap can't clip
            // the sphere. Depth 0..(dist + FAR·r) captures occluders standing
            // well outside the slice, between it and the light.
            const half = radius + worldPerTexel;
            const proj = Mat4.setOrthographic(
                S.proj, -half, half, -half, half, 0, dist + radius * CASCADE_ORTHO_FAR_SCALE,
            );

            const normalOffset = Math.max(SHADOW_NORMAL_OFFSET_MIN, SHADOW_NORMAL_OFFSET_TEXELS * worldPerTexel);
            // Straight into this cascade's 256-stride render slice; `render`
            // then fans it out to the forward uniform. The matrix used to be
            // allocated here and copied into both.
            Mat4.multiply(this.renderMatrices[c]!, proj, lightView);
            cascades.push({radius, splitFar: sliceFar, normalOffset});
            sliceNear = sliceFar;
        }
        return cascades;
    }
}
