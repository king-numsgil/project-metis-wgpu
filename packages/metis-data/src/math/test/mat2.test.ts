import { describe, expect, test } from "bun:test";
import { F32 } from "metis-data";
import { Mat2 } from "../mat2.ts";

describe("Mat2", () => {
    describe("create", () => {
        test("creates identity matrix with no arguments", () => {
            const m = Mat2.create();
            expect(m.get(0)).toEqual([1, 0]);
            expect(m.get(1)).toEqual([0, 1]);
        });

        test("creates matrix with custom values", () => {
            const m = Mat2.create(F32, 1, 2, 3, 4);
            expect(m.get(0)).toEqual([1, 2]);
            expect(m.get(1)).toEqual([3, 4]);
        });

        test("creates matrix with negative values", () => {
            const m = Mat2.create(F32, -1, -2, -3, -4);
            expect(m.get(0)).toEqual([-1, -2]);
            expect(m.get(1)).toEqual([-3, -4]);
        });

        test("creates matrix with fractional values", () => {
            const m = Mat2.create(F32, 0.5, 1.5, 2.5, 3.5);
            expect(m.get(0)).toEqual([0.5, 1.5]);
            expect(m.get(1)).toEqual([2.5, 3.5]);
        });
    });

    describe("clone", () => {
        test("clones a matrix", () => {
            const m = Mat2.create(F32, 1, 2, 3, 4);
            const cloned = Mat2.clone(m);
            expect(cloned.get(0)).toEqual([1, 2]);
            expect(cloned.get(1)).toEqual([3, 4]);
            expect(cloned).not.toBe(m);
        });

        test("clone is independent of original", () => {
            const m = Mat2.create(F32, 1, 2, 3, 4);
            const cloned = Mat2.clone(m);
            Mat2.set(m, 10, 20, 30, 40);
            expect(cloned.get(0)).toEqual([1, 2]);
            expect(cloned.get(1)).toEqual([3, 4]);
            expect(m.get(0)).toEqual([10, 20]);
            expect(m.get(1)).toEqual([30, 40]);
        });
    });

    describe("copy", () => {
        test("copies values from one matrix to another", () => {
            const a = Mat2.create(F32, 1, 2, 3, 4);
            const b = Mat2.create(F32, 0, 0, 0, 0);
            Mat2.copy(b, a);
            expect(b.get(0)).toEqual([1, 2]);
            expect(b.get(1)).toEqual([3, 4]);
        });

        test("copy modifies the destination", () => {
            const a = Mat2.create(F32, 10, 20, 30, 40);
            const b = Mat2.create(F32, 5, 5, 5, 5);
            Mat2.copy(b, a);
            expect(a.get(0)).toEqual([10, 20]);
            expect(a.get(1)).toEqual([30, 40]);
            expect(b.get(0)).toEqual([10, 20]);
            expect(b.get(1)).toEqual([30, 40]);
        });
    });

    describe("set", () => {
        test("sets matrix components", () => {
            const m = Mat2.create(F32);
            Mat2.set(m, 1, 2, 3, 4);
            expect(m.get(0)).toEqual([1, 2]);
            expect(m.get(1)).toEqual([3, 4]);
        });

        test("set can override existing values", () => {
            const m = Mat2.create(F32, 1, 2, 3, 4);
            Mat2.set(m, 99, 100, 101, 102);
            expect(m.get(0)).toEqual([99, 100]);
            expect(m.get(1)).toEqual([101, 102]);
        });
    });

    describe("identity", () => {
        test("creates identity matrix", () => {
            const m = Mat2.identity();
            expect(m.get(0)).toEqual([1, 0]);
            expect(m.get(1)).toEqual([0, 1]);
        });

        test("identity matrix has determinant 1", () => {
            const m = Mat2.identity();
            expect(Mat2.determinant(m)).toBe(1);
        });
    });

    describe("add", () => {
        test("adds two matrices", () => {
            const a = Mat2.create(F32, 1, 2, 3, 4);
            const b = Mat2.create(F32, 5, 6, 7, 8);
            const out = Mat2.create(F32);
            Mat2.add(out, a, b);
            expect(out.get(0)).toEqual([6, 8]);
            expect(out.get(1)).toEqual([10, 12]);
        });

        test("add with negative values", () => {
            const a = Mat2.create(F32, -5, 3, -1, 7);
            const b = Mat2.create(F32, 2, -1, 4, -3);
            const out = Mat2.create(F32);
            Mat2.add(out, a, b);
            expect(out.get(0)).toEqual([-3, 2]);
            expect(out.get(1)).toEqual([3, 4]);
        });

        test("add with zero matrix", () => {
            const a = Mat2.create(F32, 1, 2, 3, 4);
            const zero = Mat2.create(F32, 0, 0, 0, 0);
            const out = Mat2.create(F32);
            Mat2.add(out, a, zero);
            expect(out.get(0)).toEqual([1, 2]);
            expect(out.get(1)).toEqual([3, 4]);
        });
    });

    describe("subtract", () => {
        test("subtracts two matrices", () => {
            const a = Mat2.create(F32, 5, 8, 11, 14);
            const b = Mat2.create(F32, 3, 4, 5, 6);
            const out = Mat2.create(F32);
            Mat2.subtract(out, a, b);
            expect(out.get(0)).toEqual([2, 4]);
            expect(out.get(1)).toEqual([6, 8]);
        });

        test("subtract resulting in negative values", () => {
            const a = Mat2.create(F32, 2, 3, 4, 5);
            const b = Mat2.create(F32, 5, 7, 9, 11);
            const out = Mat2.create(F32);
            Mat2.subtract(out, a, b);
            expect(out.get(0)).toEqual([-3, -4]);
            expect(out.get(1)).toEqual([-5, -6]);
        });

        test("subtract from zero", () => {
            const zero = Mat2.create(F32, 0, 0, 0, 0);
            const a = Mat2.create(F32, 1, 2, 3, 4);
            const out = Mat2.create(F32);
            Mat2.subtract(out, zero, a);
            expect(out.get(0)).toEqual([-1, -2]);
            expect(out.get(1)).toEqual([-3, -4]);
        });
    });

    describe("multiply", () => {
        test("multiplies two matrices", () => {
            const a = Mat2.create(F32, 1, 2, 3, 4);
            const b = Mat2.create(F32, 5, 6, 7, 8);
            const out = Mat2.create(F32);
            Mat2.multiply(out, a, b);
            expect(out.get(0)[0]).toBe(23);
            expect(out.get(0)[1]).toBe(34);
            expect(out.get(1)[0]).toBe(31);
            expect(out.get(1)[1]).toBe(46);
        });

        test("multiplying by identity leaves unchanged", () => {
            const a = Mat2.create(F32, 1, 2, 3, 4);
            const identity = Mat2.identity();
            const out = Mat2.create(F32);
            Mat2.multiply(out, a, identity);
            expect(out.get(0)).toEqual([1, 2]);
            expect(out.get(1)).toEqual([3, 4]);
        });

        test("multiplying by zero matrix gives zero matrix", () => {
            const a = Mat2.create(F32, 1, 2, 3, 4);
            const zero = Mat2.create(F32, 0, 0, 0, 0);
            const out = Mat2.create(F32);
            Mat2.multiply(out, a, zero);
            expect(out.get(0)).toEqual([0, 0]);
            expect(out.get(1)).toEqual([0, 0]);
        });

        test("matrix multiplication is not commutative", () => {
            const a = Mat2.create(F32, 1, 2, 3, 4);
            const b = Mat2.create(F32, 5, 6, 7, 8);
            const ab = Mat2.create(F32);
            const ba = Mat2.create(F32);
            Mat2.multiply(ab, a, b);
            Mat2.multiply(ba, b, a);
            expect(ab.get(0)).not.toEqual(ba.get(0));
        });
    });

    describe("scale", () => {
        test("scales matrix by positive scalar", () => {
            const m = Mat2.create(F32, 1, 2, 3, 4);
            const out = Mat2.create(F32);
            Mat2.scale(out, m, 2);
            expect(out.get(0)).toEqual([2, 4]);
            expect(out.get(1)).toEqual([6, 8]);
        });

        test("scales matrix by negative scalar", () => {
            const m = Mat2.create(F32, 1, 2, 3, 4);
            const out = Mat2.create(F32);
            Mat2.scale(out, m, -2);
            expect(out.get(0)).toEqual([-2, -4]);
            expect(out.get(1)).toEqual([-6, -8]);
        });

        test("scales matrix by zero", () => {
            const m = Mat2.create(F32, 1, 2, 3, 4);
            const out = Mat2.create(F32);
            Mat2.scale(out, m, 0);
            expect(out.get(0)).toEqual([0, 0]);
            expect(out.get(1)).toEqual([0, 0]);
        });

        test("scales matrix by fractional scalar", () => {
            const m = Mat2.create(F32, 4, 6, 8, 10);
            const out = Mat2.create(F32);
            Mat2.scale(out, m, 0.5);
            expect(out.get(0)).toEqual([2, 3]);
            expect(out.get(1)).toEqual([4, 5]);
        });
    });

    describe("determinant", () => {
        test("calculates determinant of identity matrix", () => {
            const m = Mat2.identity();
            expect(Mat2.determinant(m)).toBe(1);
        });

        test("calculates determinant of 2x2 matrix", () => {
            const m = Mat2.create(F32, 1, 2, 3, 4);
            expect(Mat2.determinant(m)).toBe(-2);
        });

        test("determinant of zero matrix is 0", () => {
            const m = Mat2.create(F32, 0, 0, 0, 0);
            expect(Mat2.determinant(m)).toBe(0);
        });

        test("determinant of singular matrix is 0", () => {
            const m = Mat2.create(F32, 1, 2, 2, 4);
            expect(Mat2.determinant(m)).toBe(0);
        });
    });

    describe("invert", () => {
        test("inverts identity matrix", () => {
            const m = Mat2.identity();
            const out = Mat2.create(F32);
            Mat2.invert(out, m);
            expect(out.get(0)[0]).toBe(1);
            expect(out.get(0)[1]).toBeCloseTo(0);
            expect(out.get(1)[0]).toBeCloseTo(0);
            expect(out.get(1)[1]).toBe(1);
        });

        test("inverts 2x2 matrix", () => {
            const m = Mat2.create(F32, 4, 7, 2, 6);
            const out = Mat2.create(F32);
            Mat2.invert(out, m);
            expect(out.get(0)[0]).toBeCloseTo(0.6);
            expect(out.get(0)[1]).toBeCloseTo(-0.7);
            expect(out.get(1)[0]).toBeCloseTo(-0.2);
            expect(out.get(1)[1]).toBeCloseTo(0.4);
        });

        test("singular matrix inverts to zero matrix", () => {
            const m = Mat2.create(F32, 1, 2, 2, 4);
            const out = Mat2.create(F32);
            Mat2.invert(out, m);
            expect(out.get(0)).toEqual([0, 0]);
            expect(out.get(1)).toEqual([0, 0]);
        });

        test("multiplying matrix by its inverse gives identity", () => {
            const m = Mat2.create(F32, 4, 7, 2, 6);
            const inv = Mat2.create(F32);
            const result = Mat2.create(F32);
            Mat2.invert(inv, m);
            Mat2.multiply(result, m, inv);
            expect(result.get(0)[0]).toBeCloseTo(1);
            expect(result.get(0)[1]).toBeCloseTo(0);
            expect(result.get(1)[0]).toBeCloseTo(0);
            expect(result.get(1)[1]).toBeCloseTo(1);
        });
    });

    describe("transpose", () => {
        test("transposes a matrix", () => {
            const m = Mat2.create(F32, 1, 2, 3, 4);
            const out = Mat2.create(F32);
            Mat2.transpose(out, m);
            expect(out.get(0)).toEqual([1, 3]);
            expect(out.get(1)).toEqual([2, 4]);
        });

        test("transpose of identity is itself", () => {
            const m = Mat2.identity();
            const out = Mat2.create(F32);
            Mat2.transpose(out, m);
            expect(out.get(0)).toEqual([1, 0]);
            expect(out.get(1)).toEqual([0, 1]);
        });

        test("double transpose returns original", () => {
            const m = Mat2.create(F32, 1, 2, 3, 4);
            const out = Mat2.create(F32);
            Mat2.transpose(out, m);
            Mat2.transpose(out, out);
            expect(out.get(0)).toEqual([1, 2]);
            expect(out.get(1)).toEqual([3, 4]);
        });

        test("transpose of symmetric matrix is itself", () => {
            const m = Mat2.create(F32, 1, 2, 2, 3);
            const t = Mat2.create(F32);
            Mat2.transpose(t, m);
            expect(t.get(0)).toEqual([1, 2]);
            expect(t.get(1)).toEqual([2, 3]);
        });
    });

    describe("adjugate", () => {
        test("calculates adjugate of 2x2 matrix", () => {
            const m = Mat2.create(F32, 1, 2, 3, 4);
            const out = Mat2.create(F32);
            Mat2.adjugate(out, m);
            expect(out.get(0)[0]).toBe(4);
            expect(out.get(0)[1]).toBe(-2);
            expect(out.get(1)[0]).toBe(-3);
            expect(out.get(1)[1]).toBe(1);
        });

        test("adjugate of identity is itself", () => {
            const m = Mat2.identity();
            const out = Mat2.create(F32);
            Mat2.adjugate(out, m);
            expect(out.get(0)[0]).toBe(1);
            expect(out.get(0)[1]).toBeCloseTo(0);
            expect(out.get(1)[0]).toBeCloseTo(0);
            expect(out.get(1)[1]).toBe(1);
        });
    });

    describe("equals", () => {
        test("equal matrices return true", () => {
            const a = Mat2.create(F32, 1, 2, 3, 4);
            const b = Mat2.create(F32, 1, 2, 3, 4);
            expect(Mat2.equals(a, b)).toBe(true);
        });

        test("different matrices return false", () => {
            const a = Mat2.create(F32, 1, 2, 3, 4);
            const b = Mat2.create(F32, 1, 2, 3, 5);
            expect(Mat2.equals(a, b)).toBe(false);
        });

        test("same matrix equals itself", () => {
            const m = Mat2.create(F32, 1, 2, 3, 4);
            expect(Mat2.equals(m, m)).toBe(true);
        });
    });

    describe("rotation", () => {
        test("extracts rotation angle from rotation matrix", () => {
            const angle = Math.PI / 4;
            const c = Math.cos(angle);
            const s = Math.sin(angle);
            const m = Mat2.create(F32, c, s, -s, c);
            expect(Mat2.rotation(m)).toBeCloseTo(Math.PI / 4);
        });

        test("identity matrix has rotation 0", () => {
            const m = Mat2.identity();
            expect(Mat2.rotation(m)).toBe(0);
        });
    });

    describe("scaleFactors", () => {
        test("extracts scale factors from scaling matrix", () => {
            const m = Mat2.create(F32, 2, 0, 0, 3);
            const [sx, sy] = Mat2.scaleFactors(m);
            expect(sx).toBeCloseTo(2);
            expect(sy).toBeCloseTo(3);
        });

        test("identity matrix has scale 1, 1", () => {
            const m = Mat2.identity();
            const [sx, sy] = Mat2.scaleFactors(m);
            expect(sx).toBeCloseTo(1);
            expect(sy).toBeCloseTo(1);
        });

        test("rotation matrix has scale 1, 1", () => {
            const angle = Math.PI / 4;
            const c = Math.cos(angle);
            const s = Math.sin(angle);
            const m = Mat2.create(F32, c, s, -s, c);
            const [sx, sy] = Mat2.scaleFactors(m);
            expect(sx).toBeCloseTo(1);
            expect(sy).toBeCloseTo(1);
        });
    });
});
