import { mat3, type Mat3Arg, mat4, type Mat4Arg, vec3, type Vec3Arg } from "wgpu-matrix";

/** Position + Euler rotation (radians, applied X then Y then Z) + scale. */
export interface Transform {
    position: Vec3Arg;
    rotationEuler: Vec3Arg;
    scale: Vec3Arg;
}

export function createTransform(overrides?: Partial<Transform>): Transform {
    return {
        position: overrides?.position ?? vec3.create(0, 0, 0),
        rotationEuler: overrides?.rotationEuler ?? vec3.create(0, 0, 0),
        scale: overrides?.scale ?? vec3.create(1, 1, 1),
    };
}

/** Composes T * Rx * Ry * Rz * S — scale first, then rotate, then translate. */
export function transformToMat4(t: Transform, dst?: Mat4Arg): Mat4Arg {
    const m = mat4.translation(t.position, dst);
    mat4.rotateX(m, t.rotationEuler[0]!, m);
    mat4.rotateY(m, t.rotationEuler[1]!, m);
    mat4.rotateZ(m, t.rotationEuler[2]!, m);
    mat4.scale(m, t.scale, m);
    return m;
}

/** Inverse-transpose of the model's upper 3x3 — required so normals stay correct under non-uniform scale. */
export function normalMatrixFromModel(model: Mat4Arg, dst?: Mat3Arg): Mat3Arg {
    const m3 = mat3.fromMat4(model);
    mat3.invert(m3, m3);
    mat3.transpose(m3, m3);
    return dst ? mat3.copy(m3, dst) : m3;
}
