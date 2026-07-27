import { describe, expect, test } from "bun:test";
import { F32, Mat, Mat2, Mat3, Mat4, Quat, Vec3, allocate } from "metis-data";

/** Mat2 has no rotation *constructor* — `Mat2.rotation(m)` extracts an angle. */
function mat2(a: number, b: number, c: number, d: number) {
    const m = allocate(Mat(F32, 2));
    m.set(0, [a, b]);
    m.set(1, [c, d]);
    return m;
}

/** `Quat.fromEuler` is out-first; this is the "give me a rotation" shorthand. */
function quatEuler(x: number, y: number, z: number) {
    return Quat.fromEuler(Quat.identity(F32), x, y, z);
}

/**
 * Aliasing pins for the matrix and quaternion ops — same contract and same
 * reasoning as `aliasing.test.ts` covers for vectors.
 *
 * Matrices raise the stakes: `Mat4.multiply(m, m, b)` touches 16 components
 * where *every* output depends on *every* input column, so a rewrite that writes
 * column 0 before reading columns 1-3 corrupts the result completely — and only
 * when aliased. `Mat4.invert` and `transpose` are the same shape.
 *
 * Written and made to pass against the `get()`/`set()` implementation **first**,
 * so they're testing the contract rather than a rewrite's own assumptions.
 */

const close = (a: number, b: number, eps = 1e-4) => Math.abs(a - b) < eps;

function expectMat4Close(m: ReturnType<typeof Mat4.create>, expected: number[]) {
    const v = m.view();
    for (let i = 0; i < 16; i++) {
        expect(close(v[i] as number, expected[i]!)).toBe(true);
    }
}

describe("Mat4 aliasing", () => {
    test("multiply: out === a", () => {
        const a = Mat4.translation(F32, 1, 2, 3);
        const b = Mat4.scaling(F32, 2, 2, 2);
        const control = Mat4.create(F32);
        Mat4.multiply(control, a, b);

        Mat4.multiply(a, a, b);
        expectMat4Close(a, [...control.view()]);
    });

    test("multiply: out === b", () => {
        const a = Mat4.translation(F32, 1, 2, 3);
        const b = Mat4.scaling(F32, 2, 2, 2);
        const control = Mat4.create(F32);
        Mat4.multiply(control, a, b);

        Mat4.multiply(b, a, b);
        expectMat4Close(b, [...control.view()]);
    });

    test("multiply: out === a === b (squaring in place)", () => {
        const m = Mat4.translation(F32, 1, 2, 3);
        const control = Mat4.create(F32);
        Mat4.multiply(control, m, m);

        Mat4.multiply(m, m, m);
        expectMat4Close(m, [...control.view()]);
    });

    test("invert: out === m", () => {
        const m = Mat4.translation(F32, 5, -3, 2);
        const control = Mat4.create(F32);
        Mat4.invert(control, m);

        Mat4.invert(m, m);
        expectMat4Close(m, [...control.view()]);
    });

    test("transpose: out === m — the off-diagonal swap", () => {
        const m = Mat4.translation(F32, 7, 8, 9);
        const control = Mat4.create(F32);
        Mat4.transpose(control, m);

        Mat4.transpose(m, m);
        expectMat4Close(m, [...control.view()]);
    });

    test("copy: out === src", () => {
        const m = Mat4.translation(F32, 1, 2, 3);
        const before = [...m.view()];
        Mat4.copy(m, m);
        expectMat4Close(m, before);
    });

    test("round-trip stays correct after in-place invert", () => {
        // A composite transform, inverted in place, still round-trips a point.
        const m = Mat4.lookAt(
            F32,
            Vec3.create(F32, 3, 4, 5),
            Vec3.create(F32, 0, 0, 0),
            Vec3.create(F32, 0, 1, 0),
        );
        const src = Vec3.create(F32, 1.5, -2.25, 7);
        const mid = Vec3.create(F32);
        Vec3.transformMat4(mid, src, m);

        Mat4.invert(m, m); // in place
        const back = Vec3.create(F32);
        Vec3.transformMat4(back, mid, m);
        for (let i = 0; i < 3; i++) {
            expect(close(back.getComponent(i), src.getComponent(i))).toBe(true);
        }
    });
});

describe("Mat3 aliasing", () => {
    test("multiply: out === a and out === b", () => {
        const a = Mat3.translation(F32, 1, 2);
        const b = Mat3.scaling(F32, 3, 3);
        const control = Mat3.create(F32);
        Mat3.multiply(control, a, b);
        const want = [...control.view()];

        const a2 = Mat3.clone(a);
        Mat3.multiply(a2, a2, b);
        for (let i = 0; i < 9; i++) expect(close(a2.view()[i] as number, want[i]!)).toBe(true);

        const b2 = Mat3.clone(b);
        Mat3.multiply(b2, a, b2);
        for (let i = 0; i < 9; i++) expect(close(b2.view()[i] as number, want[i]!)).toBe(true);
    });

    test("invert / transpose: out === m", () => {
        const m = Mat3.translation(F32, 4, -2);
        const inv = Mat3.create(F32);
        Mat3.invert(inv, m);
        const want = [...inv.view()];

        Mat3.invert(m, m);
        for (let i = 0; i < 9; i++) expect(close(m.view()[i] as number, want[i]!)).toBe(true);

        const t = Mat3.rotation(F32, 0.7);
        const tt = Mat3.create(F32);
        Mat3.transpose(tt, t);
        const wantT = [...tt.view()];
        Mat3.transpose(t, t);
        for (let i = 0; i < 9; i++) expect(close(t.view()[i] as number, wantT[i]!)).toBe(true);
    });
});

describe("Mat2 aliasing", () => {
    test("multiply / invert / transpose: out === input", () => {
        const a = mat2(Math.cos(0.5), Math.sin(0.5), -Math.sin(0.5), Math.cos(0.5));
        const b = mat2(2, 0, 0, 3);
        const control = Mat2.create(F32);
        Mat2.multiply(control, a, b);
        const want = [...control.view()];

        const a2 = Mat2.clone(a);
        Mat2.multiply(a2, a2, b);
        for (let i = 0; i < 4; i++) expect(close(a2.view()[i] as number, want[i]!)).toBe(true);

        const m = mat2(Math.cos(0.9), Math.sin(0.9), -Math.sin(0.9), Math.cos(0.9));
        const inv = Mat2.create(F32);
        Mat2.invert(inv, m);
        const wantInv = [...inv.view()];
        Mat2.invert(m, m);
        for (let i = 0; i < 4; i++) expect(close(m.view()[i] as number, wantInv[i]!)).toBe(true);
    });
});

describe("Quat aliasing", () => {
    test("multiply: out === a, out === b, and out === both", () => {
        const a = quatEuler(0.3, 0.4, 0.5);
        const b = quatEuler(-0.2, 0.7, 0.1);
        const control = Quat.identity(F32);
        Quat.multiply(control, a, b);
        const want = control.get();

        const a2 = Quat.clone(a);
        Quat.multiply(a2, a2, b);
        for (let i = 0; i < 4; i++) expect(close(a2.getComponent(i), want[i]!)).toBe(true);

        const b2 = Quat.clone(b);
        Quat.multiply(b2, a, b2);
        for (let i = 0; i < 4; i++) expect(close(b2.getComponent(i), want[i]!)).toBe(true);

        const sq = Quat.identity(F32);
        Quat.multiply(sq, a, a);
        const s2 = Quat.clone(a);
        Quat.multiply(s2, s2, s2);
        for (let i = 0; i < 4; i++) expect(close(s2.getComponent(i), sq.getComponent(i))).toBe(true);
    });

    test("normalize / conjugate / invert: out === q", () => {
        const q = Quat.create(F32, 1, 2, 3, 4);
        const n = Quat.identity(F32);
        Quat.normalize(n, q);
        const wantN = n.get();
        const q2 = Quat.clone(q);
        Quat.normalize(q2, q2);
        for (let i = 0; i < 4; i++) expect(close(q2.getComponent(i), wantN[i]!)).toBe(true);

        const c = Quat.identity(F32);
        Quat.conjugate(c, q);
        const wantC = c.get();
        const q3 = Quat.clone(q);
        Quat.conjugate(q3, q3);
        for (let i = 0; i < 4; i++) expect(close(q3.getComponent(i), wantC[i]!)).toBe(true);

        const iv = Quat.identity(F32);
        Quat.invert(iv, q);
        const wantI = iv.get();
        const q4 = Quat.clone(q);
        Quat.invert(q4, q4);
        for (let i = 0; i < 4; i++) expect(close(q4.getComponent(i), wantI[i]!)).toBe(true);
    });

    test("slerp / lerp: out === a and out === b", () => {
        const a = quatEuler(0, 0, 0);
        const b = quatEuler(0, Math.PI / 2, 0);
        const control = Quat.identity(F32);
        Quat.slerp(control, a, b, 0.5);
        const want = control.get();

        const a2 = Quat.clone(a);
        Quat.slerp(a2, a2, b, 0.5);
        for (let i = 0; i < 4; i++) expect(close(a2.getComponent(i), want[i]!)).toBe(true);

        const b2 = Quat.clone(b);
        Quat.slerp(b2, a, b2, 0.5);
        for (let i = 0; i < 4; i++) expect(close(b2.getComponent(i), want[i]!)).toBe(true);
    });

    test("rotateX/Y/Z: out === q", () => {
        const q = quatEuler(0.1, 0.2, 0.3);
        const r = Quat.identity(F32);
        Quat.rotateY(r, q, 0.6);
        const want = r.get();
        const q2 = Quat.clone(q);
        Quat.rotateY(q2, q2, 0.6);
        for (let i = 0; i < 4; i++) expect(close(q2.getComponent(i), want[i]!)).toBe(true);
    });
});
