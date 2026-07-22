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
import { mat4, type Mat4Arg, vec3 } from "wgpu-matrix";
import type { GpuProfiler } from "../debug/gpuProfiler.ts";
import { MESH_VERTEX_LAYOUT } from "../scene/mesh.ts";
import type { Scene } from "../scene/scene.ts";
import { Std140Writer } from "./std140.ts";
import commonWgsl from "./wgsl/common.wgsl" with { type: "text" };
import shadowWgsl from "./wgsl/shadow.wgsl" with { type: "text" };

// Per-cascade resolution. 2048 (down from a former 4096 single map) is enough
// because roomBox's solid-slab walls give corner depth gaps ~wall-thickness, far
// wider than any shadow test here needs to resolve.
export const SHADOW_MAP_SIZE = 2048;
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
export const CASCADE_COUNT = 4;
// Default practical-split blend and shadowed reach — the renderer surfaces these
// as tunable fields and passes the live values into `render`.
export const CASCADE_SPLIT_LAMBDA_DEFAULT = 0.85;
export const SHADOW_DISTANCE_DEFAULT = 400;
// Each cascade cross-fades into the next over this fraction of its depth span,
// hiding the resolution step at the boundary.
const CASCADE_BLEND_FRACTION = 0.12;
// Light-space ortho depth range around a cascade's bounding-sphere centre, in
// units of the sphere radius: [center - NEAR·r toward the sun, center + FAR·r].
// NEAR is generous so occluders standing just outside the slice still cast in.
const CASCADE_ORTHO_NEAR_SCALE = 3.0;
const CASCADE_ORTHO_FAR_SCALE = 1.5;
// 256-byte stride for the per-cascade shadow-render uniform (one mat4 each),
// meeting the uniform dynamic/offset alignment so 4 bind groups can slice one buffer.
const CASCADE_RENDER_STRIDE = 256;
// Forward-pass cascade uniform: mat4[4] (256) + splitDepths vec4 (16) +
// normalOffsets vec4 (16) + params vec4 (16) = 304. Keep in sync with
// common.wgsl's CascadeUniforms.
const CASCADE_FORWARD_SIZE = 304;

interface Cascade {
    viewProj: Mat4Arg;
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
    // All cascades: one depth32float array, one layer each.
    private readonly pcfDepthArray: GpuTexture;
    private readonly pcfDepthLayerViews: GpuTextureView[]; // per-layer, for rendering
    // Per-cascade light matrix for the render passes (offset-addressed slices).
    private readonly cascadeRenderBuffer: GpuBuffer;
    private readonly cascadeRenderBindGroups: GpuBindGroup[];
    private readonly pcfDepthPipeline: GpuRenderPipeline; // single-sample depth

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
            size: CASCADE_COUNT * CASCADE_RENDER_STRIDE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.uniformBuffer = device.createBuffer({
            label: "metis-engine/cascade-forward-uniforms",
            size: CASCADE_FORWARD_SIZE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

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
                    buffer: {buffer: this.cascadeRenderBuffer, offset: i * CASCADE_RENDER_STRIDE, size: 64},
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
     * Records all cascade shadow passes for this frame: cascade 0's MSAA depth +
     * moment resolve, then cascades 1..N single-sample depth into the array. Fit
     * to `[camera.near, shadowDistance]` by the practical split (`splitLambda`).
     */
    render(
        encoder: GpuCommandEncoder,
        scene: Scene,
        shadowDistance: number,
        splitLambda: number,
        profiler?: GpuProfiler,
    ) {
        const cascades = this.computeCascades(scene, shadowDistance, splitLambda);

        // Per-cascade render matrix (one 64-byte mat4 per 256-byte slice).
        for (let c = 0; c < CASCADE_COUNT; c++) {
            const w = new Std140Writer();
            w.mat4(cascades[c]!.viewProj);
            this.device.queue.writeBuffer(this.cascadeRenderBuffer, c * CASCADE_RENDER_STRIDE, w.toBytes());
        }
        // Forward cascade set: matrices + split far-depths + per-cascade offsets + params.
        const fw = new Std140Writer();
        for (let c = 0; c < CASCADE_COUNT; c++) {
            fw.mat4(cascades[c]!.viewProj);
        }
        fw.vec4(cascades[0]!.splitFar, cascades[1]!.splitFar, cascades[2]!.splitFar, cascades[3]!.splitFar);
        fw.vec4(cascades[0]!.normalOffset, cascades[1]!.normalOffset, cascades[2]!.normalOffset, cascades[3]!.normalOffset);
        fw.vec4(CASCADE_COUNT, SHADOW_MAP_SIZE, CASCADE_BLEND_FRACTION, 0);
        this.device.queue.writeBuffer(this.uniformBuffer, 0, fw.toBytes());

        const drawScene = (pass: ReturnType<GpuCommandEncoder["beginRenderPass"]>, cascade: number) => {
            pass.setBindGroup(0, this.cascadeRenderBindGroups[cascade]!);
            for (const instance of scene.instances) {
                pass.setBindGroup(1, instance.getModelBindGroup(this.device, this.modelBindGroupLayout));
                instance.mesh.bind(pass);
                instance.mesh.draw(pass);
            }
        };

        // Every cascade (PCF): single-sample depth into its array layer.
        for (let c = 0; c < CASCADE_COUNT; c++) {
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
        }
    }

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

        const invView = mat4.invert(cam.viewMatrix());
        const tanHalfY = Math.tan(cam.fovYRadians / 2);
        const tanHalfX = tanHalfY * cam.aspect;
        const sunDir = vec3.normalize(scene.environment.sunDirection);
        const up = Math.abs(sunDir[1]!) > 0.98 ? vec3.create(1, 0, 0) : vec3.create(0, 1, 0);
        // Light XY basis (rotation only), for texel-snapping the sphere centre.
        const zAxis = vec3.negate(sunDir); // view looks down -z; eye is toward the light
        const xAxis = vec3.normalize(vec3.cross(up, zAxis));
        const yAxis = vec3.cross(zAxis, xAxis);

        const cascades: Cascade[] = [];
        let sliceNear = near;
        for (let c = 0; c < CASCADE_COUNT; c++) {
            const sliceFar = splitFar[c]!;

            // 8 world-space corners of this frustum slice.
            const corners: ReturnType<typeof vec3.create>[] = [];
            for (const d of [sliceNear, sliceFar]) {
                for (const sx of [-1, 1]) {
                    for (const sy of [-1, 1]) {
                        corners.push(vec3.transformMat4(vec3.create(sx * d * tanHalfX, sy * d * tanHalfY, -d), invView));
                    }
                }
            }

            // Bounding sphere (average-centre — stable and standard for CSM).
            const center = vec3.create(0, 0, 0);
            for (const p of corners) {
                vec3.add(center, p, center);
            }
            vec3.scale(center, 1 / corners.length, center);
            let radius = 0;
            for (const p of corners) {
                radius = Math.max(radius, vec3.distance(center, p));
            }
            // Quantize the radius so it doesn't wobble by sub-texel amounts.
            radius = Math.ceil(radius * 16) / 16;

            const worldPerTexel = (2 * radius) / SHADOW_MAP_SIZE;
            // Snap the centre within the light's XY plane to the texel grid.
            const cx = vec3.dot(center, xAxis);
            const cy = vec3.dot(center, yAxis);
            const snapX = Math.round(cx / worldPerTexel) * worldPerTexel - cx;
            const snapY = Math.round(cy / worldPerTexel) * worldPerTexel - cy;
            vec3.add(center, vec3.scale(xAxis, snapX), center);
            vec3.add(center, vec3.scale(yAxis, snapY), center);

            const dist = radius * CASCADE_ORTHO_NEAR_SCALE;
            const eye = vec3.subtract(center, vec3.scale(sunDir, dist));
            const lightView = mat4.lookAt(eye, center, up);
            // Ortho half-extent padded by a texel so the ≤1-texel snap can't clip
            // the sphere. Depth 0..(dist + FAR·r) captures occluders standing
            // well outside the slice, between it and the light.
            const half = radius + worldPerTexel;
            const proj = mat4.ortho(-half, half, -half, half, 0, dist + radius * CASCADE_ORTHO_FAR_SCALE);

            const normalOffset = Math.max(SHADOW_NORMAL_OFFSET_MIN, SHADOW_NORMAL_OFFSET_TEXELS * worldPerTexel);
            cascades.push({viewProj: mat4.multiply(proj, lightView), radius, splitFar: sliceFar, normalOffset});
            sliceNear = sliceFar;
        }
        return cascades;
    }
}
