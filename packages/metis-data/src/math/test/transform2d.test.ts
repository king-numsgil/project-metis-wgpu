import { describe, expect, test } from "bun:test";
import { F32, Mat2, Mat3 } from "metis-data";

// Ground-truth invariants for the 2D transform matrices (Mat2, Mat3), validated
// against known geometric outcomes rather than the library's own expected values.

type M3 = ReturnType<typeof Mat3.identity>;

// p' = M * [x, y, 1]  (column-major: element (row i, col c) = M.get(c)[i])
function xf2d(m: M3, x: number, y: number): [number, number] {
    const c0 = m.get(0), c1 = m.get(1), c2 = m.get(2);
    return [c0[0]! * x + c1[0]! * y + c2[0]!, c0[1]! * x + c1[1]! * y + c2[1]!];
}

describe("Mat2", () => {
    test("M · M⁻¹ = I", () => {
        const m = Mat2.create(F32, 4, 3, 6, 3);
        const inv = Mat2.create(F32);
        Mat2.invert(inv, m);
        const p = Mat2.create(F32);
        Mat2.multiply(p, m, inv);
        expect(p.get(0)[0]!).toBeCloseTo(1);
        expect(p.get(0)[1]!).toBeCloseTo(0);
        expect(p.get(1)[0]!).toBeCloseTo(0);
        expect(p.get(1)[1]!).toBeCloseTo(1);
    });

    test("determinant of a known matrix", () => {
        // column-major create(m00,m01,m10,m11) => M = [[4,6],[3,3]] (row-major)
        expect(Mat2.determinant(Mat2.create(F32, 4, 3, 6, 3))).toBeCloseTo(4 * 3 - 6 * 3);
    });

    test("transpose swaps off-diagonal", () => {
        const m = Mat2.create(F32, 1, 2, 3, 4);
        const t = Mat2.create(F32);
        Mat2.transpose(t, m);
        expect(t.get(0)).toEqual([1, 3]);
        expect(t.get(1)).toEqual([2, 4]);
    });

    test("rotation angle extraction round-trips", () => {
        // a CCW 2D rotation stored column-major: col0 = [cos, sin]
        const a = 0.7;
        const m = Mat2.create(F32, Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a));
        expect(Mat2.rotation(m)).toBeCloseTo(a);
    });
});

describe("Mat3 (2D homogeneous transforms)", () => {
    test("identity leaves a point unchanged", () => {
        expect(xf2d(Mat3.identity(F32), 3, -5)).toEqual([3, -5]);
    });

    test("translation moves a point", () => {
        expect(xf2d(Mat3.translation(F32, 10, -2), 1, 1)).toEqual([11, -1]);
    });

    test("rotation is CCW: R(90°)·(1,0) = (0,1)", () => {
        const [x, y] = xf2d(Mat3.rotation(F32, Math.PI / 2), 1, 0);
        expect(x).toBeCloseTo(0);
        expect(y).toBeCloseTo(1);
    });

    test("fromTRS applies S then R then T", () => {
        // T(3,4) · R(90°) · S(2,1) on (1,0): scale->(2,0), rot->(0,2), translate->(3,6)
        const m = Mat3.fromTRS(F32, 3, 4, Math.PI / 2, 2, 1);
        const [x, y] = xf2d(m, 1, 0);
        expect(x).toBeCloseTo(3);
        expect(y).toBeCloseTo(6);
    });

    test("fromTRS -> decompose round-trips", () => {
        const m = Mat3.fromTRS(F32, -7, 2.5, 1.1, 3, 0.5);
        const [tx, ty, angle, sx, sy] = Mat3.decompose(m);
        expect(tx).toBeCloseTo(-7);
        expect(ty).toBeCloseTo(2.5);
        expect(angle).toBeCloseTo(1.1);
        expect(sx).toBeCloseTo(3);
        expect(sy).toBeCloseTo(0.5);
    });

    test("getTranslation / getRotation / getScale agree with the parts", () => {
        const m = Mat3.fromTRS(F32, 8, -1, 0.6, 2, 4);
        expect(Mat3.getTranslation(m)[0]!).toBeCloseTo(8);
        expect(Mat3.getTranslation(m)[1]!).toBeCloseTo(-1);
        expect(Mat3.getRotation(m)).toBeCloseTo(0.6);
        expect(Mat3.getScale(m)[0]!).toBeCloseTo(2);
        expect(Mat3.getScale(m)[1]!).toBeCloseTo(4);
    });

    test("multiply order: (T · R) rotates first, then translates", () => {
        const t = Mat3.translation(F32, 5, 0);
        const rot = Mat3.rotation(F32, Math.PI / 2);
        const tr = Mat3.create(F32);
        Mat3.multiply(tr, t, rot); // T · R
        // (1,0): R -> (0,1), then T -> (5,1)
        const [x, y] = xf2d(tr, 1, 0);
        expect(x).toBeCloseTo(5);
        expect(y).toBeCloseTo(1);
    });

    test("M · M⁻¹ = I for a TRS matrix", () => {
        const m = Mat3.fromTRS(F32, 4, -3, 0.9, 2, 1.5);
        const inv = Mat3.create(F32);
        Mat3.invert(inv, m);
        const p = Mat3.create(F32);
        Mat3.multiply(p, m, inv);
        for (let c = 0; c < 3; c++) {
            for (let i = 0; i < 3; i++) expect(p.get(c as 0)[i]!).toBeCloseTo(c === i ? 1 : 0);
        }
    });
});
