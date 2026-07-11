import {
    type GpuBindGroup,
    type GpuBindGroupLayout,
    type GpuBuffer,
    GPUBufferUsage,
    type GpuDevice,
} from "bun-webgpu-rs";
import type { Mat4Arg } from "wgpu-matrix";
import { Camera } from "../math/camera.ts";
import { createTransform, normalMatrixFromModel, type Transform, transformToMat4 } from "../math/transform.ts";
import { Std140Writer } from "../shading/std140.ts";
import { createExteriorEnvironment, type Environment } from "./environment.ts";
import type { PointLight } from "./light.ts";
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

    constructor(
        public mesh: Mesh,
        public material: Material,
        transform?: Partial<Transform>,
    ) {
        this.transform = createTransform(transform);
    }

    /** Recomputes model + normal matrices from `transform` (or uses `modelMatrixOverride`) and returns a bind group for group(2) of the forward pipeline. */
    getModelBindGroup(device: GpuDevice, layout: GpuBindGroupLayout): GpuBindGroup {
        const model = this.modelMatrixOverride ?? transformToMat4(this.transform);
        const normalMat = normalMatrixFromModel(model);

        const w = new Std140Writer();
        w.mat4(model);
        w.mat3(normalMat as Float32Array);
        const bytes = w.toBytes();

        if (!this.buffer) {
            this.buffer = device.createBuffer({
                label: "metis-engine/model",
                size: bytes.byteLength,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
            this.bindGroup = device.createBindGroup({
                label: "metis-engine/model-bind-group",
                layout,
                entries: [{binding: 0, buffer: {buffer: this.buffer}}],
            });
        }

        device.queue.writeBuffer(this.buffer, 0, bytes);
        return this.bindGroup!;
    }

    destroy() {
        this.buffer?.destroy();
        this.buffer = null;
        this.bindGroup = null;
    }
}

/** A camera + environment + the set of instances/lights to draw this frame. */
export class Scene {
    camera = new Camera();
    environment: Environment = createExteriorEnvironment();
    instances: SceneInstance[] = [];
    pointLights: PointLight[] = [];

    add(mesh: Mesh, material: Material, transform?: Partial<Transform>): SceneInstance {
        const instance = new SceneInstance(mesh, material, transform);
        this.instances.push(instance);
        return instance;
    }
}
