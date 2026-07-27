import { describe, expect, test } from "bun:test";
import { F32, Mat4, Quat, Vec3 } from "metis-data";

/**
 * `composeTRS` must agree with `fromTRS` exactly — it is the same composition
 * written closed-form to avoid the three intermediate matrices, so any
 * divergence is a bug in the closed form, not a design choice.
 */
const close = (a: number, b: number, eps = 1e-5) => Math.abs(a - b) < eps;

function expectSame(a: ReturnType<typeof Mat4.create>, b: ReturnType<typeof Mat4.create>) {
    const av = a.view(), bv = b.view();
    for (let i = 0; i < 16; i++) {
        expect(close(av[i] as number, bv[i] as number)).toBe(true);
    }
}

describe("Mat4.composeTRS", () => {
    const cases: Array<[string, number[], [number, number, number], [number, number, number]]> = [
        ["identity rotation", [0, 0, 0], [1, 2, 3], [1, 1, 1]],
        ["single-axis rotation", [Math.PI / 3, 0, 0], [0, 0, 0], [1, 1, 1]],
        ["composite rotation", [0.3, -0.7, 1.1], [5, -2, 8], [1, 1, 1]],
        ["non-uniform scale", [0.3, -0.7, 1.1], [5, -2, 8], [2, 0.5, 3]],
        ["negative scale", [0.2, 0.4, 0.6], [1, 1, 1], [-1, 2, 1]],
    ];

    for (const [name, euler, t, s] of cases) {
        test(`matches fromTRS — ${name}`, () => {
            const q = Quat.fromEuler(Quat.identity(F32), euler[0]!, euler[1]!, euler[2]!);
            const want = Mat4.fromTRS(F32, t[0], t[1], t[2], q, s[0], s[1], s[2]);
            const got = Mat4.create(F32);
            Mat4.composeTRS(got, t[0], t[1], t[2], q, s[0], s[1], s[2]);
            expectSame(got, want);
        });
    }

    test("transforms a point the same way fromTRS does", () => {
        const q = Quat.fromEuler(Quat.identity(F32), 0.4, 0.9, -0.2);
        const want = Mat4.fromTRS(F32, 3, -1, 4, q, 2, 2, 2);
        const got = Mat4.create(F32);
        Mat4.composeTRS(got, 3, -1, 4, q, 2, 2, 2);

        const src = Vec3.create(F32, 1, 2, 3);
        const a = Vec3.create(F32);
        const b = Vec3.create(F32);
        Vec3.transformMat4(a, src, want);
        Vec3.transformMat4(b, src, got);
        for (let i = 0; i < 3; i++) {
            expect(close(a.getComponent(i), b.getComponent(i))).toBe(true);
        }
    });

    test("allocates nothing — repeated calls reuse out", () => {
        const q = Quat.identity(F32);
        const out = Mat4.create(F32);
        const buf = out.buffer;
        for (let i = 0; i < 100; i++) Mat4.composeTRS(out, i, 0, 0, q, 1, 1, 1);
        expect(out.buffer).toBe(buf);
        expect(out.view()[12]).toBe(99);
    });
});
