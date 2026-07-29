import {
    type GpuBindGroup,
    type GpuBindGroupLayout,
    type GpuBuffer,
    GPUBufferUsage,
    type GpuDevice,
} from "metis-native";
import { Mat4 } from "metis-data";
import { Camera } from "../math/camera.ts";
import { createTransform, normalMatrixFromModel, type Transform, transformToMat4 } from "../math/transform.ts";
import type { Mat3f, Mat4f } from "../math/types.ts";
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
    modelMatrixOverride: Mat4f | null = null;
    /**
     * Whether this instance is drawn into the shadow passes (all four sun
     * cascades and every spot-shadow layer). Default `true`.
     *
     * Set it `false` for geometry that is *visual only* — light gizmos, sky
     * shells, emissive markers, anything whose silhouette is not meant to
     * occlude. A hundred small emissive spheres standing in for point lights
     * (see `examples/helmet-demo.ts`) otherwise speckle every lit surface with
     * their own little shadows, which reads as noise rather than as lighting.
     *
     * It is not a culling optimisation and should not be used as one — a real
     * occluder that is off-screen must still cast, and that is what the spot
     * pass's frustum test is for. This says "this object has no shadow",
     * which is a property of the content, not of the frame.
     */
    castsShadow = true;

    private buffer: GpuBuffer | null = null;
    private bindGroup: GpuBindGroup | null = null;
    /**
     * Per-instance CPU staging, created with the GPU buffer on first use and
     * rewritten in place every frame. This is the allocation that scaled with
     * scene size before — one `Std140Writer` per instance per frame, each with
     * five allocations of its own.
     *
     * `model`/`normalMatrix` are `Mat4f`/`Mat3f` **aliasing the upload bytes**,
     * so the two matrices below are computed directly into what gets uploaded.
     * There is no intermediate matrix and no copy on this path any more.
     */
    private staging: {bytes: Uint8Array; model: Mat4f; normalMatrix: Mat3f} | null = null;

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
                model: s.mat4("model"),
                // A std140 mat3 is three *vec4* columns — 48 bytes, not 36.
                normalMatrix: s.mat3("normalMatrix"),
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

        // Composed straight into the upload bytes. An override is the only case
        // that copies, and only because the caller owns that matrix.
        const model = this.staging.model;
        if (this.modelMatrixOverride) {
            Mat4.copy(model, this.modelMatrixOverride);
        } else {
            transformToMat4(this.transform, model);
        }
        normalMatrixFromModel(model, this.staging.normalMatrix);

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
