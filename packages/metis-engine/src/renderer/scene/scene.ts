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
    private staging: {
        bytes: Uint8Array;
        model: Mat4f;
        normalMatrix: Mat3f;
        /** Flat float view of `model`, for the cheap frame-to-frame compare below. */
        modelFloats: Float32Array;
        /** Last *uploaded* model matrix, so `prepareModel` can tell a no-op from a move. */
        uploadedModel: Float32Array;
    } | null = null;
    /**
     * Whether the last {@link prepareModel} produced a different model matrix
     * than the frame before — i.e. whether this instance actually moved.
     *
     * `ShadowCascades` reads it to decide whether a cached cascade is still
     * valid. It is per-frame state, meaningless before the first `prepareModel`,
     * and `true` on the frame the instance is first prepared (nothing to
     * compare against, so it counts as a change).
     */
    modelChanged = true;

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

    /**
     * The bind group {@link prepareModel} last uploaded — group(2) of the
     * forward pipeline, group(1) of every depth-only one.
     *
     * Binding is all this does: no matrix math, no upload. That split is the
     * whole point, because ~6-10 passes bind this per frame and only one of them
     * needs the value recomputed.
     *
     * **Throws if the instance was never prepared this frame.** The alternative
     * — lazily preparing here — would silently paper over an instance that a
     * pass draws but `render()` never walked, and the symptom would be an object
     * rendered at a stale transform, which looks like a game-logic bug rather
     * than a renderer one. Loud is better; see CLAUDE.md's running theme of
     * things that "render plausibly" while being wrong.
     */
    get modelBindGroup(): GpuBindGroup {
        if (!this.bindGroup) {
            throw new Error(
                "SceneInstance.modelBindGroup read before prepareModel() — every pass that draws an " +
                    "instance must draw one the frame's prepare loop walked (see ClusteredForwardRenderer.render).",
            );
        }
        return this.bindGroup;
    }

    /**
     * Recomputes model + normal matrices from `transform` (or
     * `modelMatrixOverride`), uploads them, and returns the bind group.
     *
     * **Call exactly once per frame per instance, before any pass draws it** —
     * `ClusteredForwardRenderer.render()` does this for the whole draw order up
     * front. Passes then bind {@link modelBindGroup}.
     *
     * This used to be one method that every pass called, so the same bytes were
     * re-derived and re-uploaded once per pass. See CLAUDE.md "The model uniform
     * is computed once per frame" for what that cost.
     */
    prepareModel(device: GpuDevice, layout: GpuBindGroupLayout): GpuBindGroup {
        if (!this.staging) {
            const s = stage(ModelUniforms);
            this.staging = {
                bytes: s.bytes,
                model: s.mat4("model"),
                // A std140 mat3 is three *vec4* columns — 48 bytes, not 36.
                normalMatrix: s.mat3("normalMatrix"),
                modelFloats: s.f32("model", 16),
                // NaN-filled so the first compare below cannot match: NaN !== NaN,
                // so frame 1 always counts as a change and always uploads. A
                // zero-filled array would silently skip the first upload for any
                // instance whose model matrix happens to be all zeros.
                uploadedModel: new Float32Array(16).fill(NaN),
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
        // The normal matrix is a pure function of the model matrix, so comparing
        // the model alone decides both — 16 floats, not the whole 112-byte
        // struct.
        const {modelFloats, uploadedModel} = this.staging;
        let changed = false;
        for (let i = 0; i < 16; i++) {
            if (modelFloats[i] !== uploadedModel[i]) {
                changed = true;
                break;
            }
        }
        this.modelChanged = changed;

        // A static instance stops uploading entirely. The GPU buffer keeps what
        // it was last given, so skipping the write is not "stale data" — it is
        // the same data, not re-sent. 16 float compares are far cheaper than the
        // JS -> napi -> Rust crossing they avoid.
        if (changed) {
            normalMatrixFromModel(model, this.staging.normalMatrix);
            device.queue.writeBuffer(this.buffer!, 0, this.staging.bytes);
            uploadedModel.set(modelFloats);
        }
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
