import {
    type GpuBindGroup,
    type GpuBindGroupLayout,
    type GpuBuffer,
    GPUBufferUsage,
    type GpuDevice,
} from "metis-native";
import type { Mat4Arg } from "wgpu-matrix";
import { Camera } from "../math/camera.ts";
import { createTransform, normalMatrixFromModel, type Transform, transformToMat4 } from "../math/transform.ts";
import { ModelUniforms, stage } from "../shading/gpuLayouts.ts";
import { createExteriorEnvironment, type Environment } from "./environment.ts";
import type { Light } from "./light.ts";
import type { Material } from "./material.ts";
import type { Mesh } from "./mesh.ts";

/** One drawable: a mesh + material pairing, placed in the world by `transform`. Owns its own per-instance model uniform buffer. */
export class SceneInstance {
    transform: Transform;
    /**
     * When set, used as the model matrix instead of `transformToMat4(transform)`
     * — for content (e.g. a loaded glTF node) whose world matrix came from an
     * arbitrary quaternion rotation + non-uniform scale that can't be losslessly
     * decomposed back into `Transform`'s position/Euler-rotation/scale fields.
     */
    modelMatrixOverride: Mat4Arg | null = null;

    private buffer: GpuBuffer | null = null;
    private bindGroup: GpuBindGroup | null = null;
    /**
     * Per-instance CPU staging, created with the GPU buffer on first use and
     * rewritten in place every frame. This is the allocation that scaled with
     * scene size before — one `Std140Writer` per instance per frame, each with
     * five allocations of its own.
     */
    private staging: {bytes: Uint8Array; model: Float32Array; normalMatrix: Float32Array} | null = null;

    /**
     * @param mesh geometry to draw; shared freely between instances.
     * @param material shading parameters; also shareable.
     * @param transform initial placement — unset fields take `createTransform`'s defaults.
     */
    constructor(
        public mesh: Mesh,
        public material: Material,
        transform?: Partial<Transform>,
    ) {
        this.transform = createTransform(transform);
    }

    /** Recomputes model + normal matrices from `transform` (or uses `modelMatrixOverride`) and returns a bind group for group(2) of the forward pipeline. */
    getModelBindGroup(device: GpuDevice, layout: GpuBindGroupLayout): GpuBindGroup {
        if (!this.staging) {
            const s = stage(ModelUniforms);
            this.staging = {
                bytes: s.bytes,
                model: s.f32("model", 16),
                // A std140 mat3 is three *vec4* columns — 12 floats, not 9.
                normalMatrix: s.f32("normalMatrix", 12),
            };
            this.buffer = device.createBuffer({
                label: "metis-engine/model",
                size: ModelUniforms.byteSize,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
            this.bindGroup = device.createBindGroup({
                label: "metis-engine/model-bind-group",
                layout,
                entries: [{binding: 0, buffer: {buffer: this.buffer}}],
            });
        }

        const model = this.modelMatrixOverride ?? transformToMat4(this.transform);
        this.staging.model.set(model as Float32Array);
        // wgpu-matrix's Mat3 is already 12 floats with the same column padding
        // std140 wants, so this copies straight across.
        this.staging.normalMatrix.set(normalMatrixFromModel(model) as Float32Array);

        device.queue.writeBuffer(this.buffer!, 0, this.staging.bytes);
        return this.bindGroup!;
    }

    /** Releases this instance's model uniform buffer. Does **not** touch the shared mesh or material. */
    destroy() {
        this.buffer?.destroy();
        this.buffer = null;
        this.bindGroup = null;
        this.staging = null;
    }
}

/**
 * A camera + environment + the set of instances/lights to draw this frame.
 *
 * Plain mutable data with no GPU resources of its own — build one however you
 * like and hand it to `ClusteredForwardRenderer.render()` each frame. (The ECS
 * does not feed this yet; nothing extracts a `Scene` from ECS data.)
 */
export class Scene {
    camera = new Camera();
    /** Sun + ambient fill. Defaults to `createExteriorEnvironment()` (near-zero ambient). */
    environment: Environment = createExteriorEnvironment();
    /** Everything drawn, in order. Each is one draw call per pass. */
    instances: SceneInstance[] = [];
    /**
     * Point + spot lights, culled per-cluster. Discriminate on `kind`.
     *
     * Order matters in two places: lights past `MAX_LIGHTS` are dropped with a
     * warning, and when more spots are flagged `castsShadow` than
     * `MAX_SHADOW_SPOTS`, the first ones in **this array's** order win.
     */
    lights: Light[] = [];

    /** Creates a `SceneInstance`, appends it to {@link instances}, and returns it for further tweaking. */
    add(mesh: Mesh, material: Material, transform?: Partial<Transform>): SceneInstance {
        const instance = new SceneInstance(mesh, material, transform);
        this.instances.push(instance);
        return instance;
    }
}
