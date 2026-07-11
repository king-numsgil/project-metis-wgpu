import { describe, expect, test } from "bun:test";
import { F32, Mat4, Quat, Vec3, Vec4 } from "metis-data";

// Cross-cutting correctness invariants for the math a WebGPU renderer depends on.
// These are written to FAIL when a convention is wrong (signed values, exact
// z-ranges, round-trips) — unlike sign-blind `Math.abs` checks, which silently
// passed the conjugate/transpose bugs these guard against.

type Mat = ReturnType<typeof Mat4.identity>;
type Vec = ReturnType<typeof Vec3.create>;

// p_view = M * p  (column-major: element (row i, col c) = M.get(c)[i])
function mul4(m: Mat, p: [number, number, number, number]): number[] {
    const c0 = m.get(0), c1 = m.get(1), c2 = m.get(2), c3 = m.get(3);
    return [0, 1, 2, 3].map((i) => c0[i]! * p[0] + c1[i]! * p[1] + c2[i]! * p[2] + c3[i]! * p[3]);
}

function unitAxis(x: number, y: number, z: number): Vec {
    const a = Vec3.create(F32, x, y, z);
    return Vec3.normalize(a, a);
}

// A spread of rotations, including an axis-aligned 90° and a near-180° case.
const SAMPLE_ROTATIONS: Array<[Vec, number]> = [
    [unitAxis(1, 0, 0), Math.PI / 2],
    [unitAxis(0, 1, 0), 1.3],
    [unitAxis(0, 0, 1), -0.8],
    [unitAxis(1, 1, 1), 2.0],
    [unitAxis(0.6, 0.48, 0.64), 3.0], // close to π: small w, the fragile branch
];

describe("Mat4.toQuat — represents the SAME rotation as its source matrix", () => {
    const v: [number, number, number, number] = [0.3, -0.7, 0.5, 0];

    for (const [axis, angle] of SAMPLE_ROTATIONS) {
        test(`axis ${axis.get().map((n) => +n.toFixed(2))} @ ${angle.toFixed(2)}rad`, () => {
            const q = Quat.create(F32);
            Quat.fromAxisAngle(q, axis, angle);
            const m = Mat4.identity(F32);
            Mat4.rotation(m, q);

            const q2 = Vec4.create(F32);
            Mat4.toQuat(q2, m);

            // Rotate a test vector two ways: by the matrix, and by the extracted
            // quaternion. If toQuat returned the conjugate, these would diverge.
            const viaMatrix = mul4(m, v);
            const rotated = Vec3.create(F32);
            Vec3.transformQuat(rotated, Vec3.create(F32, v[0], v[1], v[2]), q2);
            const got = rotated.get();
            for (let i = 0; i < 3; i++) expect(got[i]!).toBeCloseTo(viaMatrix[i]!, 4);
        });
    }

    test("preserves sign on an asymmetric rotation (not the conjugate)", () => {
        const q = Quat.create(F32);
        Quat.fromAxisAngle(q, unitAxis(1, 0, 0), Math.PI / 2); // qx > 0
        const m = Mat4.identity(F32);
        Mat4.rotation(m, q);
        const q2 = Vec4.create(F32);
        Mat4.toQuat(q2, m);
        expect(q2.get()[0]!).toBeGreaterThan(0); // conjugate bug made this negative
    });
});

describe("Mat4.decompose — TRS round-trips", () => {
    test("recovers translation and scale exactly, and rotation up to recompose", () => {
        const q = Quat.create(F32);
        Quat.fromAxisAngle(q, unitAxis(0.6, 0.48, 0.64), 1.1);
        const m = Mat4.fromTRS(F32, 5, -2, 3, q, 2, 0.5, 1.5);

        const t = Vec3.create(F32), rot = Vec4.create(F32), sc = Vec3.create(F32);
        Mat4.decompose(m, t, rot, sc);

        expect(t.get()).toEqual([5, -2, 3]);
        const s = sc.get();
        expect(s[0]!).toBeCloseTo(2);
        expect(s[1]!).toBeCloseTo(0.5);
        expect(s[2]!).toBeCloseTo(1.5);

        // Recompose from the decomposed parts and compare element-wise.
        const m2 = Mat4.fromTRS(F32, t.get()[0]!, t.get()[1]!, t.get()[2]!, rot, s[0]!, s[1]!, s[2]!);
        for (let c = 0; c < 4; c++) {
            const a = m.get(c as 0), b = m2.get(c as 0);
            for (let i = 0; i < 4; i++) expect(b[i]!).toBeCloseTo(a[i]!, 4);
        }
    });
});

describe("Mat4.invert — M · M⁻¹ = I", () => {
    test("for a translate/rotate/scale matrix, both orders give identity", () => {
        const q = Quat.create(F32);
        Quat.fromAxisAngle(q, unitAxis(0.2, 0.9, -0.3), 0.9);
        const m = Mat4.fromTRS(F32, 7, 1, -4, q, 3, 0.25, 2);
        const inv = Mat4.create(F32);
        Mat4.invert(inv, m);

        for (const [a, b] of [[m, inv], [inv, m]] as const) {
            const prod = Mat4.create(F32);
            Mat4.multiply(prod, a, b);
            for (let c = 0; c < 4; c++) {
                for (let i = 0; i < 4; i++) {
                    expect(prod.get(c as 0)[i]!).toBeCloseTo(c === i ? 1 : 0, 4);
                }
            }
        }
    });
});

describe("Quat.fromEuler — documented XYZ order (qX·qY·qZ)", () => {
    test("equals the explicit qX·qY·qZ product", () => {
        const [x, y, z] = [0.3, 0.5, 0.7];
        const e = Quat.create(F32);
        Quat.fromEuler(e, x, y, z);

        const qx = Quat.create(F32); Quat.fromAxisAngle(qx, unitAxis(1, 0, 0), x);
        const qy = Quat.create(F32); Quat.fromAxisAngle(qy, unitAxis(0, 1, 0), y);
        const qz = Quat.create(F32); Quat.fromAxisAngle(qz, unitAxis(0, 0, 1), z);
        const tmp = Quat.create(F32), xyz = Quat.create(F32);
        Quat.multiply(tmp, qx, qy);
        Quat.multiply(xyz, tmp, qz);

        const a = e.get(), b = xyz.get();
        for (let i = 0; i < 4; i++) expect(a[i]!).toBeCloseTo(b[i]!);
    });

    test("single-axis reduces to that axis's rotation", () => {
        const e = Quat.create(F32); Quat.fromEuler(e, 0, 0, Math.PI / 2);
        const [x, y, z, w] = e.get();
        expect([x, y, z]).toEqual([0, 0, expect.closeTo(Math.SQRT1_2) as unknown as number]);
        expect(w).toBeCloseTo(Math.SQRT1_2);
    });
});

describe("Mat4.lookAt — right-handed view (camera looks down -z)", () => {
    test("puts the target in front of the camera along -z", () => {
        const eye = Vec3.create(F32, 0, 0, 5);
        const center = Vec3.create(F32, 0, 0, 0);
        const up = Vec3.create(F32, 0, 1, 0);
        const v = Mat4.lookAt(F32, eye, center, up);

        // world origin -> 5 units in front of the camera => view z = -5
        expect(mul4(v, [0, 0, 0, 1])).toEqual([
            expect.closeTo(0) as unknown as number,
            expect.closeTo(0) as unknown as number,
            expect.closeTo(-5) as unknown as number,
            expect.closeTo(1) as unknown as number,
        ]);
        // a point to the world +x stays on view +x
        expect(mul4(v, [1, 0, 0, 1])[0]!).toBeCloseTo(1);
    });
});

describe("Quat.slerp", () => {
    const a = Quat.create(F32); Quat.fromAxisAngle(a, unitAxis(0, 1, 0), 0.2);
    const b = Quat.create(F32); Quat.fromAxisAngle(b, unitAxis(0, 1, 0), 1.4);

    test("endpoints return the inputs", () => {
        const out = Quat.create(F32);
        Quat.slerp(out, a, b, 0);
        for (let i = 0; i < 4; i++) expect(out.get()[i]!).toBeCloseTo(a.get()[i]!);
        Quat.slerp(out, a, b, 1);
        for (let i = 0; i < 4; i++) expect(out.get()[i]!).toBeCloseTo(b.get()[i]!);
    });

    test("interpolant stays unit length", () => {
        const out = Quat.create(F32);
        Quat.slerp(out, a, b, 0.37);
        expect(Quat.length(out)).toBeCloseTo(1);
    });

    test("takes the shortest path (negating an endpoint gives the same result)", () => {
        const nb = Quat.create(F32);
        Quat.set(nb, -b.get()[0]!, -b.get()[1]!, -b.get()[2]!, -b.get()[3]!);
        const out1 = Quat.create(F32), out2 = Quat.create(F32);
        Quat.slerp(out1, a, b, 0.5);
        Quat.slerp(out2, a, nb, 0.5);
        for (let i = 0; i < 4; i++) expect(out1.get()[i]!).toBeCloseTo(out2.get()[i]!);
    });
});
