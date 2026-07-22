import {
    type GpuBindGroup,
    type GpuBindGroupLayout,
    type GpuBuffer,
    GPUBufferUsage,
    type GpuCommandEncoder,
    type GpuDevice,
    type GpuRenderPipeline,
    GPUShaderStage,
    type GpuTexture,
    GPUTextureUsage,
    type GpuTextureView,
} from "metis-native";
import { mat4, type Mat4Arg, vec3 } from "wgpu-matrix";
import type { GpuProfiler } from "../debug/gpuProfiler.ts";
import { type Frustum, frustumFromViewProj, sphereInFrustum, worldBoundingSphere } from "../math/frustum.ts";
import { transformToMat4 } from "../math/transform.ts";
import type { Light, SpotLight } from "../scene/light.ts";
import { MESH_VERTEX_LAYOUT } from "../scene/mesh.ts";
import type { Scene } from "../scene/scene.ts";
import { Std140Writer } from "./std140.ts";
import commonWgsl from "./wgsl/common.wgsl" with { type: "text" };
import shadowWgsl from "./wgsl/shadow.wgsl" with { type: "text" };

/**
 * How many spot lights may cast shadows in one frame. This is a **compile-time**
 * bound, not a runtime dial: it sizes the depth array and the `array<mat4x4>` in
 * `SpotShadowUniforms`, and WGSL array lengths must be constant. Changing it is
 * a one-line edit plus a rebuild, but it is not something to set per scene.
 *
 * Four is deliberately modest. The intent is that scene code selects *which*
 * four matter for the current space (a galley's fixtures, then a cargo bay's)
 * rather than the renderer trying to shadow every spot at once — see CLAUDE.md
 * "Spot light shadows".
 */
export const MAX_SHADOW_SPOTS = 4;

/**
 * Per-light shadow map resolution. Lower than the sun's `SHADOW_MAP_SIZE`
 * because a spot's frustum covers a bounded cone rather than a whole cascade
 * slice, so each texel already subtends far less world space.
 *
 * VRAM = MAX_SHADOW_SPOTS × SPOT_SHADOW_MAP_SIZE² × 4 bytes (≈ 16.8 MB at 4 ×
 * 1024²). Doubling this quadruples that.
 */
export const SPOT_SHADOW_MAP_SIZE = 1024;

const SHADOW_DEPTH_FORMAT = "depth32float" as const;
/** 256-byte slices so one buffer can back a per-light offset bind group. */
const RENDER_STRIDE = 256;
/** mat4[4] (256) + texelScale vec4 (16) + params vec4 (16). Keep in sync with common.wgsl. */
const FORWARD_UNIFORM_SIZE = 288;

/**
 * Normal-offset bias, in texels of the *spot's own* map. Unlike the sun's
 * cascades, a spot map is perspective, so a texel's world size grows with
 * distance from the light — the shader therefore scales this by the receiver's
 * distance rather than using a fixed world offset (see `texelScale`).
 */
const SPOT_NORMAL_OFFSET_TEXELS = 1.5;

/**
 * A spot's shadow frustum can't be arbitrarily wide: at a full 180° the
 * perspective projection degenerates. Cones wider than this are shadowed with a
 * clamped frustum, which is a visible-but-graceful failure (shadow slightly
 * cropped) rather than a NaN matrix.
 */
const MAX_SHADOW_FOV = (150 * Math.PI) / 180;
/**
 * Near plane as a fraction of the light's range. Perspective depth precision is
 * dominated by the far/near ratio, so this can't be tiny; 2% of range keeps the
 * ratio at 50:1, which `depth32float` handles with room to spare.
 */
const NEAR_FRACTION = 0.02;

let warnedTooMany = false;

/**
 * The spot lights that will cast shadows this frame: those flagged
 * `castsShadow`, capped at `MAX_SHADOW_SPOTS`, in scene order.
 *
 * The renderer calls this once per frame and hands the result to *both*
 * `LightCuller.write` (which packs these lights first, so a light's buffer index
 * doubles as its shadow-map layer) and `SpotShadows.render`. Deriving it twice
 * would risk the two disagreeing, which would silently light fragments with the
 * wrong light's shadow map.
 */
export function selectShadowCastingSpots(lights: Light[]): SpotLight[] {
    const flagged = lights.filter((l): l is SpotLight => l.kind === "spot" && l.castsShadow === true);
    if (flagged.length > MAX_SHADOW_SPOTS && !warnedTooMany) {
        warnedTooMany = true;
        console.warn(
            `metis-engine: ${flagged.length} spot lights are flagged castsShadow, but only ` +
            `${MAX_SHADOW_SPOTS} can cast at once (MAX_SHADOW_SPOTS). The first ${MAX_SHADOW_SPOTS} ` +
            `in scene order win; the rest light normally but cast nothing.`,
        );
    }
    return flagged.slice(0, MAX_SHADOW_SPOTS);
}

/**
 * Per-spot-light shadow maps: one perspective depth pass per shadow-casting
 * spot, into its own layer of a `depth_2d_array`, sampled in the forward pass
 * with the same hardware comparison sampler the cascades use.
 *
 * Draws are **frustum-culled per light** — the whole reason spot shadows are
 * affordable here. See CLAUDE.md "Spot light shadows".
 */
export class SpotShadows {
    /** Depth array (one layer per shadow-casting spot), frame bind group binding 2. */
    readonly depthArrayView: GpuTextureView;
    /** Per-frame matrices + params, binding 3. */
    readonly uniformBuffer: GpuBuffer;

    private readonly device: GpuDevice;
    private readonly modelBindGroupLayout: GpuBindGroupLayout;
    private readonly depthArray: GpuTexture;
    private readonly layerViews: GpuTextureView[];
    private readonly renderBuffer: GpuBuffer;
    private readonly renderBindGroups: GpuBindGroup[];
    private readonly pipeline: GpuRenderPipeline;
    private readonly frustum: Frustum = new Float32Array(24);

    /** Instances drawn across all spot shadow passes last frame, vs. the unculled total. Diagnostic only. */
    lastDrawnInstances = 0;
    lastCandidateInstances = 0;

    constructor(device: GpuDevice, modelBindGroupLayout: GpuBindGroupLayout) {
        this.device = device;
        this.modelBindGroupLayout = modelBindGroupLayout;

        this.depthArray = device.createTexture({
            label: "metis-engine/spot-shadow-depth-array",
            size: {
                width: SPOT_SHADOW_MAP_SIZE,
                height: SPOT_SHADOW_MAP_SIZE,
                depthOrArrayLayers: MAX_SHADOW_SPOTS,
            },
            format: SHADOW_DEPTH_FORMAT,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        this.depthArrayView = this.depthArray.createView({dimension: "2d-array"});
        this.layerViews = [];
        for (let i = 0; i < MAX_SHADOW_SPOTS; i++) {
            this.layerViews.push(this.depthArray.createView({
                dimension: "2d",
                baseArrayLayer: i,
                arrayLayerCount: 1,
            }));
        }

        this.renderBuffer = device.createBuffer({
            label: "metis-engine/spot-shadow-render-uniforms",
            size: MAX_SHADOW_SPOTS * RENDER_STRIDE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.uniformBuffer = device.createBuffer({
            label: "metis-engine/spot-shadow-forward-uniforms",
            size: FORWARD_UNIFORM_SIZE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const frameBGL = device.createBindGroupLayout({
            label: "metis-engine/spot-shadow-frame-bgl",
            entries: [{binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {bindingType: "uniform"}}],
        });
        this.renderBindGroups = [];
        for (let i = 0; i < MAX_SHADOW_SPOTS; i++) {
            this.renderBindGroups.push(device.createBindGroup({
                label: `metis-engine/spot-shadow-render-bg-${i}`,
                layout: frameBGL,
                entries: [{
                    binding: 0,
                    buffer: {buffer: this.renderBuffer, offset: i * RENDER_STRIDE, size: 64},
                }],
            }));
        }

        // Same vertex shader as the sun's cascades — a depth-only pass is a
        // depth-only pass; only the matrix differs (perspective here, ortho there).
        const module = device.createShaderModule({
            label: "metis-engine/spot-shadow-shader",
            code: `${commonWgsl}\n${shadowWgsl}`,
        });
        this.pipeline = device.createRenderPipeline({
            label: "metis-engine/spot-shadow-pipeline",
            layout: device.createPipelineLayout({bindGroupLayouts: [frameBGL, modelBindGroupLayout]}),
            vertex: {module, entryPoint: "vs", buffers: [MESH_VERTEX_LAYOUT]},
            // No culling, for the same reason the cascades don't cull: the
            // light's view has nothing to do with the camera's, so a room shell's
            // inward-facing triangles are back-facing to the light and would be
            // wrongly dropped.
            primitive: {topology: "triangle-list", cullMode: "none"},
            depthStencil: {format: SHADOW_DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: "less"},
        });
    }

    /**
     * Records one depth pass per shadow-casting spot. `spots` must be exactly
     * what `selectShadowCastingSpots` returned this frame and must match the
     * order `LightCuller.write` packed — layer *i* belongs to buffer light *i*.
     *
     * Every layer is cleared each frame, including unused ones: a stale layer
     * would otherwise be sampled by a light that inherited its index later.
     */
    render(encoder: GpuCommandEncoder, scene: Scene, spots: SpotLight[], profiler?: GpuProfiler) {
        const viewProjs: Mat4Arg[] = [];
        const texelScale = [0, 0, 0, 0];

        for (let i = 0; i < spots.length; i++) {
            const spot = spots[i]!;
            const dir = vec3.normalize(spot.direction);
            const eye = vec3.clone(spot.position);
            const target = vec3.add(eye, dir);
            // Any up vector not parallel to the cone axis; the choice only spins
            // the map about its own axis, which is invisible.
            const up = Math.abs(dir[1]!) > 0.99 ? vec3.create(1, 0, 0) : vec3.create(0, 1, 0);
            const view = mat4.lookAt(eye, target, up);

            // Full field of view is twice the cone's half-angle, plus a small
            // margin so the cone's own soft edge isn't clipped by the map border.
            const fov = Math.min(Math.max(spot.outerAngle * 2.1, 1e-3), MAX_SHADOW_FOV);
            const near = Math.max(spot.range * NEAR_FRACTION, 1e-3);
            const proj = mat4.perspective(fov, 1, near, Math.max(spot.range, near * 2));
            viewProjs.push(mat4.multiply(proj, view));
            // World size of one texel per unit distance from the light — the
            // shader multiplies this by the receiver's distance to size its
            // normal offset, since a perspective map's texels grow with depth.
            texelScale[i] = (2 * Math.tan(fov / 2)) / SPOT_SHADOW_MAP_SIZE;
        }

        for (let i = 0; i < spots.length; i++) {
            const w = new Std140Writer();
            w.mat4(viewProjs[i]!);
            this.device.queue.writeBuffer(this.renderBuffer, i * RENDER_STRIDE, w.toBytes());
        }

        const fw = new Std140Writer();
        for (let i = 0; i < MAX_SHADOW_SPOTS; i++) {
            fw.mat4(viewProjs[i] ?? mat4.identity());
        }
        fw.vec4(texelScale[0]!, texelScale[1]!, texelScale[2]!, texelScale[3]!);
        fw.vec4(spots.length, SPOT_SHADOW_MAP_SIZE, SPOT_NORMAL_OFFSET_TEXELS, 0);
        this.device.queue.writeBuffer(this.uniformBuffer, 0, fw.toBytes());

        // World bounding spheres once per frame, reused across every light's
        // frustum test rather than recomputed per (light, instance).
        const spheres = scene.instances.map((inst) => {
            const model = inst.modelMatrixOverride ?? transformToMat4(inst.transform);
            return worldBoundingSphere(model, inst.mesh.boundingRadius);
        });

        this.lastDrawnInstances = 0;
        this.lastCandidateInstances = 0;

        for (let i = 0; i < MAX_SHADOW_SPOTS; i++) {
            const pass = encoder.beginRenderPass({
                label: `metis-engine/spot-shadow-${i}-depth-pass`,
                timestampWrites: profiler?.pass(`spot-shadow-${i}`),
                colorAttachments: [],
                depthStencilAttachment: {
                    view: this.layerViews[i]!,
                    depthLoadOp: "clear",
                    depthStoreOp: "store",
                    depthClearValue: 1.0, // z=1 (farthest) = "no occluder here"
                },
            });
            // Unused layers still get the clear pass above — that's what makes a
            // stale layer impossible — but draw nothing.
            if (i < spots.length) {
                frustumFromViewProj(viewProjs[i]!, this.frustum);
                pass.setPipeline(this.pipeline);
                pass.setBindGroup(0, this.renderBindGroups[i]!);
                for (let k = 0; k < scene.instances.length; k++) {
                    this.lastCandidateInstances++;
                    const s = spheres[k]!;
                    if (!sphereInFrustum(this.frustum, s.x, s.y, s.z, s.r)) {
                        continue;
                    }
                    const instance = scene.instances[k]!;
                    pass.setBindGroup(1, instance.getModelBindGroup(this.device, this.modelBindGroupLayout));
                    instance.mesh.bind(pass);
                    instance.mesh.draw(pass);
                    this.lastDrawnInstances++;
                }
            }
            pass.end();
        }
    }

    destroy() {
        this.depthArray.destroy();
        this.renderBuffer.destroy();
        this.uniformBuffer.destroy();
    }
}
