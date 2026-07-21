import type { Mat4Arg } from "wgpu-matrix";

/**
 * Frustum culling against a view-projection matrix.
 *
 * Used by the spot-shadow passes: a spot light's frustum is a genuinely tight
 * bounded volume (a cone capped by `range`), so in an interior scene most of the
 * world falls outside it and never needs drawing. This is *not* worth much for
 * the cascaded sun shadows, whose ortho frusta deliberately swallow the whole
 * view slice — see CLAUDE.md "Spot light shadows".
 */

/** Six planes as `(nx, ny, nz, d)`, normalized, inward-facing: a point is inside when `dot(n, p) + d >= 0` for all six. */
export type Frustum = Float32Array;

/**
 * Extracts the six clip-space planes from a view-projection matrix
 * (Gribb & Hartmann). `m` is column-major, as every `wgpu-matrix` mat4 is, so
 * row *i* of the logical matrix is `(m[i], m[4+i], m[8+i], m[12+i])`.
 *
 * **Depth range is WebGPU's `[0, 1]`, not OpenGL's `[-1, 1]`.** The near plane
 * is therefore `row2` alone rather than `row3 + row2`; using the GL form here
 * yields a near plane in the wrong place, which culls geometry that is actually
 * visible — the sort of bug that shows up as objects vanishing near the light
 * rather than as anything obviously wrong with the maths.
 */
export function frustumFromViewProj(m: Mat4Arg, dst?: Frustum): Frustum {
    const out = dst ?? new Float32Array(24);
    const row = (i: number) => [m[i]!, m[4 + i]!, m[8 + i]!, m[12 + i]!] as const;
    const [x0, y0, z0, w0] = row(0);
    const [x1, y1, z1, w1] = row(1);
    const [x2, y2, z2, w2] = row(2);
    const [x3, y3, z3, w3] = row(3);

    // left, right, bottom, top, near, far
    const planes: (readonly [number, number, number, number])[] = [
        [x3 + x0, y3 + y0, z3 + z0, w3 + w0],
        [x3 - x0, y3 - y0, z3 - z0, w3 - w0],
        [x3 + x1, y3 + y1, z3 + z1, w3 + w1],
        [x3 - x1, y3 - y1, z3 - z1, w3 - w1],
        [x2, y2, z2, w2],
        [x3 - x2, y3 - y2, z3 - z2, w3 - w2],
    ];

    for (let p = 0; p < 6; p++) {
        const [a, b, c, d] = planes[p]!;
        // Normalize so `dot(n, p) + d` is a true signed distance and can be
        // compared against a world-space radius.
        const len = Math.hypot(a, b, c) || 1;
        out[p * 4 + 0] = a / len;
        out[p * 4 + 1] = b / len;
        out[p * 4 + 2] = c / len;
        out[p * 4 + 3] = d / len;
    }
    return out;
}

/**
 * Conservative sphere-vs-frustum test: `false` only when the sphere is wholly
 * outside at least one plane. Being conservative is the safe direction — a
 * false positive draws something needlessly, a false negative makes geometry
 * silently stop casting a shadow.
 */
export function sphereInFrustum(f: Frustum, cx: number, cy: number, cz: number, radius: number): boolean {
    for (let p = 0; p < 6; p++) {
        const d = f[p * 4]! * cx + f[p * 4 + 1]! * cy + f[p * 4 + 2]! * cz + f[p * 4 + 3]!;
        if (d < -radius) {
            return false;
        }
    }
    return true;
}

/**
 * World-space bounding sphere of an instance, derived from its **model matrix**
 * rather than its `Transform`.
 *
 * That distinction is load-bearing: `SceneInstance.modelMatrixOverride` (used by
 * the glTF loader) bypasses `Transform` entirely, so reading position/scale off
 * the transform would silently mis-place any overridden instance. Translation is
 * the matrix's fourth column; the scale factor is the longest of its three basis
 * columns, which is the correct conservative choice under non-uniform scale.
 */
export function worldBoundingSphere(model: Mat4Arg, localRadius: number): {x: number; y: number; z: number; r: number} {
    const sx = Math.hypot(model[0]!, model[1]!, model[2]!);
    const sy = Math.hypot(model[4]!, model[5]!, model[6]!);
    const sz = Math.hypot(model[8]!, model[9]!, model[10]!);
    return {
        x: model[12]!,
        y: model[13]!,
        z: model[14]!,
        r: localRadius * Math.max(sx, sy, sz),
    };
}
