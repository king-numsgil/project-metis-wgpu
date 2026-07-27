import { Mat3, Mat4, Quat } from "metis-data";
import { type Mat3f, type Mat4f, mat3f, quatf, type Vec3f, vec3f } from "./types.ts";

/**
 * Position + Euler rotation (radians, applied X then Y then Z) + scale.
 *
 * Deliberately not a quaternion: this is the *authoring* shape, easy to set by
 * hand and to tweak from a demo's input handler. Content whose orientation
 * can't be expressed this way (a loaded glTF node) bypasses it entirely via
 * `SceneInstance.modelMatrixOverride`.
 */
export interface Transform {
    position: Vec3f;
    /** Rotation in **radians** per axis, applied X, then Y, then Z. */
    rotationEuler: Vec3f;
    /** Per-axis scale. Non-uniform values are handled correctly — the normal matrix compensates. */
    scale: Vec3f;
}

/** A `Transform` at the origin, unrotated, unit scale, with any `overrides` applied. */
export function createTransform(overrides?: Partial<Transform>): Transform {
    return {
        position: overrides?.position ?? vec3f(0, 0, 0),
        rotationEuler: overrides?.rotationEuler ?? vec3f(0, 0, 0),
        scale: overrides?.scale ?? vec3f(1, 1, 1),
    };
}

/**
 * Module-level scratch for the Euler → quaternion step. `transformToMat4` runs
 * once per instance per frame (twice, with the spot-shadow frustum cull), so it
 * must not allocate; the renderer is single-threaded and never re-enters this.
 */
const eulerScratch = quatf();

/**
 * Composes T * Rx * Ry * Rz * S into `out` — scale first, then rotate, then
 * translate.
 *
 * **Out-first, with no allocating variant, deliberately.** Its result always
 * lands in a GPU staging buffer (`SceneInstance`'s model uniform), so an
 * allocating form would only ever be a copy away from the buffer that wanted
 * it. `Mat4.composeTRS` writes the composition closed-form rather than
 * multiplying three intermediates.
 */
export function transformToMat4(t: Transform, out: Mat4f): Mat4f {
    const r = t.rotationEuler.view();
    const s = t.scale.view();
    const p = t.position.view();
    // Quat.fromEuler is XYZ order (qX·qY·qZ), matching the field's documented
    // "applied X, then Y, then Z" — and matching Mat4.composeTRS's convention,
    // which is tied to Mat4.rotation's.
    Quat.fromEuler(eulerScratch, r[0] as number, r[1] as number, r[2] as number);
    return Mat4.composeTRS(
        out,
        p[0] as number, p[1] as number, p[2] as number,
        eulerScratch,
        s[0] as number, s[1] as number, s[2] as number,
    );
}

/** Scratch for {@link normalMatrixFromModel}'s intermediate 3x3. */
const linearScratch = mat3f();

/**
 * Inverse-transpose of the model's upper 3x3, into `out` — required so normals
 * stay correct under non-uniform scale.
 *
 * Out-first for the same reason {@link transformToMat4} is: this runs per
 * instance per frame and the result belongs in the model uniform's std140
 * `mat3x3` slot. `out` must be **std140-packed** (`mat3f()` is) — a Dense mat3
 * type-checks identically and writes its columns 4 bytes apart from where the
 * shader reads them.
 */
export function normalMatrixFromModel(model: Mat4f, out: Mat3f): Mat3f {
    Mat4.getLinearTransform(linearScratch, model);
    Mat3.invert(linearScratch, linearScratch);
    return Mat3.transpose(out, linearScratch);
}
