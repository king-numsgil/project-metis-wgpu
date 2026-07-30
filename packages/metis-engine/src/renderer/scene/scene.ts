import { Mat4 } from "metis-data";
import { Camera } from "../math/camera.ts";
import { createTransform, normalMatrixFromModel, type Transform, transformToMat4 } from "../math/transform.ts";
import type { Mat3f, Mat4f } from "../math/types.ts";
import { createExteriorEnvironment, type Environment } from "./environment.ts";
import type { Light } from "./light.ts";
import type { Material } from "./material.ts";
import type { Mesh } from "./mesh.ts";

/**
 * One drawable: a mesh + material pairing, placed in the world by `transform`.
 *
 * It owns **no GPU resources**. Its model + normal matrices are written into a
 * slot of the renderer's shared model array (`shading/modelBuffer.ts`), which is
 * what lets instances sharing a mesh collapse into one instanced draw.
 */
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

    /**
     * Last model matrix written, so {@link writeModel} can tell a no-op from a
     * move. NaN-filled so the first write can never match: a zero-filled one
     * would silently report "unchanged" for an instance whose model matrix is
     * legitimately all zeros.
     */
    private readonly writtenModel = new Float32Array(16).fill(NaN);
    /**
     * Whether the last {@link writeModel} produced a different model matrix than
     * the frame before — i.e. whether this instance actually moved.
     *
     * `ShadowCascades` reads it to decide whether a cached cascade is still
     * valid, and `ModelBuffer` sums it to decide whether to upload at all. It is
     * per-frame state, meaningless before the first write, and `true` on the
     * frame the instance is first written (nothing to compare against, so it
     * counts as a change).
     */
    modelChanged = true;

    /**
     * This frame's model matrix as a flat column-major 16-float view — valid
     * after {@link writeModel}, which every instance gets once per frame.
     *
     * `ShadowCascades` culls against it rather than recomputing
     * `transformToMat4`, which is the whole reason it is exposed: the matrix has
     * already been built this frame and rebuilding it per cascade would cost
     * more than the culling saves.
     */
    get modelFloats(): Readonly<Float32Array> {
        return this.writtenModel;
    }

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
     * Composes this instance's model matrix into `model` and its normal matrix
     * into `normalMatrix` — both views into the renderer's shared model array —
     * and returns whether the result differs from the last frame's.
     *
     * **Renderer-internal, called once per frame per instance** by
     * `ModelBuffer.update`, over `DrawOrder`'s output. The slot it writes into is
     * the instance's position in that order, which is what the passes' instanced
     * draws index by; see `shading/modelBuffer.ts` for why that has to line up.
     *
     * Writing straight into the upload bytes means there is no intermediate
     * matrix and no copy — an override is the only case that copies, and only
     * because the caller owns that matrix.
     */
    writeModel(model: Mat4f, normalMatrix: Mat3f): boolean {
        if (this.modelMatrixOverride) {
            Mat4.copy(model, this.modelMatrixOverride);
        } else {
            transformToMat4(this.transform, model);
        }

        // The normal matrix is a pure function of the model matrix, so comparing
        // the model alone decides both — 16 floats, not the whole 112-byte
        // struct. Cheap enough to be worth doing on every instance every frame,
        // because what it saves is a whole-array upload and (via
        // ShadowCascades) four depth passes.
        // `view()` is allocation-free and cached (metis-data DOC.md's allocation
        // table), and a mat4's columns are unpadded under both packings, so this
        // is a flat 16-element float view — not `get()`, which allocates a tuple
        // per column and would undo the point of doing this per instance.
        const current = model.view();
        const written = this.writtenModel;
        let changed = false;
        for (let i = 0; i < 16; i++) {
            if (current[i] !== written[i]) {
                changed = true;
                break;
            }
        }
        this.modelChanged = changed;

        if (changed) {
            normalMatrixFromModel(model, normalMatrix);
            written.set(current);
        }
        return changed;
    }

    /**
     * No-op, kept because callers hold `SceneInstance`s and used to have to
     * release them.
     *
     * An instance owned a GPU buffer and a bind group until the renderer moved
     * every transform into one shared model array; it now owns nothing, and the
     * shared mesh and material were never its to free. Dropping the reference is
     * all that is required.
     *
     * @deprecated Nothing to release; safe to stop calling.
     */
    destroy() {}
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
