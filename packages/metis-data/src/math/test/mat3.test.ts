import { describe, expect, test } from "bun:test";
import { F32 } from "metis-data";
import { Mat2 } from "../mat2.ts";
import { Mat3 } from "../mat3.ts";

describe("Mat3", () => {
    describe("create", () => {
        test("creates identity matrix with no arguments", () => {
            const m = Mat3.create();
            expect(m.get(0)).toEqual([1, 0, 0]);
            expect(m.get(1)).toEqual([0, 1, 0]);
            expect(m.get(2)).toEqual([0, 0, 1]);
        });

        test("creates matrix with custom values", () => {
            const m = Mat3.create(F32, 1, 2, 3, 4, 5, 6, 7, 8, 9);
            expect(m.get(0)).toEqual([1, 2, 3]);
            expect(m.get(1)).toEqual([4, 5, 6]);
            expect(m.get(2)).toEqual([7, 8, 9]);
        });

        test("creates matrix with negative values", () => {
            const m = Mat3.create(F32, -1, -2, -3, -4, -5, -6, -7, -8, -9);
            expect(m.get(0)).toEqual([-1, -2, -3]);
            expect(m.get(1)).toEqual([-4, -5, -6]);
            expect(m.get(2)).toEqual([-7, -8, -9]);
        });
    });

    describe("clone", () => {
        test("clones a matrix", () => {
            const m = Mat3.create(F32, 1, 2, 3, 4, 5, 6, 7, 8, 9);
            const cloned = Mat3.clone(m);
            expect(cloned.get(0)).toEqual([1, 2, 3]);
            expect(cloned).not.toBe(m);
        });

        test("clone is independent of original", () => {
            const m = Mat3.create(F32, 1, 2, 3, 4, 5, 6, 7, 8, 9);
            const cloned = Mat3.clone(m);
            Mat3.set(m, 10, 20, 30, 40, 50, 60, 70, 80, 90);
            expect(cloned.get(0)).toEqual([1, 2, 3]);
        });
    });

    describe("copy", () => {
        test("copies values from one matrix to another", () => {
            const a = Mat3.create(F32, 1, 2, 3, 4, 5, 6, 7, 8, 9);
            const b = Mat3.create(F32);
            Mat3.copy(b, a);
            expect(b.get(0)).toEqual([1, 2, 3]);
        });
    });

    describe("set", () => {
        test("sets matrix components", () => {
            const m = Mat3.create(F32);
            Mat3.set(m, 1, 2, 3, 4, 5, 6, 7, 8, 9);
            expect(m.get(2)).toEqual([7, 8, 9]);
        });
    });

    describe("identity", () => {
        test("creates identity matrix", () => {
            const m = Mat3.identity();
            expect(m.get(0)).toEqual([1, 0, 0]);
            expect(m.get(1)).toEqual([0, 1, 0]);
            expect(m.get(2)).toEqual([0, 0, 1]);
        });

        test("identity matrix has determinant 1", () => {
            const m = Mat3.identity();
            expect(Mat3.determinant(m)).toBe(1);
        });
    });

    describe("add", () => {
        test("adds two matrices", () => {
            const a = Mat3.create(F32, 1, 2, 3, 4, 5, 6, 7, 8, 9);
            const b = Mat3.create(F32, 9, 8, 7, 6, 5, 4, 3, 2, 1);
            const out = Mat3.create(F32);
            Mat3.add(out, a, b);
            expect(out.get(0)).toEqual([10, 10, 10]);
            expect(out.get(2)).toEqual([10, 10, 10]);
        });
    });

    describe("subtract", () => {
        test("subtracts two matrices", () => {
            const a = Mat3.create(F32, 9, 8, 7, 6, 5, 4, 3, 2, 1);
            const b = Mat3.create(F32, 1, 2, 3, 4, 5, 6, 7, 8, 9);
            const out = Mat3.create(F32);
            Mat3.subtract(out, a, b);
            expect(out.get(0)).toEqual([8, 6, 4]);
            expect(out.get(2)).toEqual([-4, -6, -8]);
        });
    });

    describe("multiply", () => {
        test("multiplies two matrices", () => {
            const a = Mat3.identity();
            const b = Mat3.create(F32, 2, 0, 0, 0, 2, 0, 0, 0, 2);
            const out = Mat3.create(F32);
            Mat3.multiply(out, a, b);
            expect(out.get(0)).toEqual([2, 0, 0]);
            expect(out.get(2)).toEqual([0, 0, 2]);
        });

        test("multiplying by identity leaves unchanged", () => {
            const m = Mat3.create(F32, 1, 2, 3, 4, 5, 6, 7, 8, 9);
            const identity = Mat3.identity();
            const out = Mat3.create(F32);
            Mat3.multiply(out, m, identity);
            expect(out.get(1)).toEqual([4, 5, 6]);
        });
    });

    describe("scale", () => {
        test("scales matrix by scalar", () => {
            const m = Mat3.create(F32, 1, 2, 3, 4, 5, 6, 7, 8, 9);
            const out = Mat3.create(F32);
            Mat3.scale(out, m, 2);
            expect(out.get(0)).toEqual([2, 4, 6]);
            expect(out.get(2)).toEqual([14, 16, 18]);
        });

        test("scale by zero gives zero matrix", () => {
            const m = Mat3.create(F32, 1, 2, 3, 4, 5, 6, 7, 8, 9);
            const out = Mat3.create(F32);
            Mat3.scale(out, m, 0);
            expect(out.get(0)).toEqual([0, 0, 0]);
        });
    });

    describe("determinant", () => {
        test("calculates determinant of identity", () => {
            const m = Mat3.identity();
            expect(Mat3.determinant(m)).toBe(1);
        });

        test("calculates determinant of 3x3 matrix", () => {
            const m = Mat3.create(F32, 1, 2, 3, 4, 5, 6, 7, 8, 9);
            expect(Mat3.determinant(m)).toBe(0);
        });

        test("determinant of zero matrix is 0", () => {
            const m = Mat3.create(F32, 0, 0, 0, 0, 0, 0, 0, 0, 0);
            expect(Mat3.determinant(m)).toBe(0);
        });
    });

    describe("invert", () => {
        test("inverts identity matrix", () => {
            const m = Mat3.identity();
            const out = Mat3.create(F32);
            Mat3.invert(out, m);
            expect(out.get(0)).toEqual([1, 0, 0]);
        });

        test("singular matrix inverts to zero matrix", () => {
            const m = Mat3.create(F32, 1, 2, 3, 1, 2, 3, 1, 2, 3);
            const out = Mat3.create(F32);
            Mat3.invert(out, m);
            expect(out.get(0)).toEqual([0, 0, 0]);
        });

        test("multiplying by inverse gives identity", () => {
            const m = Mat3.create(F32, 2, 0, 0, 0, 2, 0, 0, 0, 2);
            const inv = Mat3.create(F32);
            const result = Mat3.create(F32);
            Mat3.invert(inv, m);
            Mat3.multiply(result, m, inv);
            expect(result.get(0)[0]).toBeCloseTo(1);
            expect(result.get(1)[1]).toBeCloseTo(1);
        });
    });

    describe("transpose", () => {
        test("transposes a matrix", () => {
            const m = Mat3.create(F32, 1, 2, 3, 4, 5, 6, 7, 8, 9);
            const out = Mat3.create(F32);
            Mat3.transpose(out, m);
            expect(out.get(0)).toEqual([1, 4, 7]);
            expect(out.get(2)).toEqual([3, 6, 9]);
        });

        test("transpose of identity is itself", () => {
            const m = Mat3.identity();
            const t = Mat3.create(F32);
            Mat3.transpose(t, m);
            expect(t.get(0)).toEqual([1, 0, 0]);
        });
    });

    describe("adjugate", () => {
        test("calculates adjugate of matrix", () => {
            const m = Mat3.create(F32, 1, 2, 3, 4, 5, 6, 7, 8, 9);
            const out = Mat3.create(F32);
            Mat3.adjugate(out, m);
            expect(out.get(0)).toEqual([-3, 6, -3]);
        });
    });

    describe("equals", () => {
        test("equal matrices return true", () => {
            const a = Mat3.create(F32, 1, 2, 3, 4, 5, 6, 7, 8, 9);
            const b = Mat3.create(F32, 1, 2, 3, 4, 5, 6, 7, 8, 9);
            expect(Mat3.equals(a, b)).toBe(true);
        });

        test("different matrices return false", () => {
            const a = Mat3.create(F32, 1, 2, 3, 4, 5, 6, 7, 8, 9);
            const b = Mat3.create(F32, 1, 2, 3, 4, 5, 6, 7, 8, 10);
            expect(Mat3.equals(a, b)).toBe(false);
        });
    });

    describe("translation", () => {
        test("creates translation matrix", () => {
            const m = Mat3.translation(F32, 5, 10);
            expect(m.get(0)).toEqual([1, 0, 0]);
            expect(m.get(1)).toEqual([0, 1, 0]);
            expect(m.get(2)).toEqual([5, 10, 1]);
        });
    });

    describe("rotation", () => {
        test("creates 90 degree rotation matrix", () => {
            const m = Mat3.rotation(F32, Math.PI / 2);
            expect(m.get(0)[0]).toBeCloseTo(0);
            expect(m.get(0)[1]).toBeCloseTo(1);
            expect(m.get(1)[0]).toBeCloseTo(-1);
            expect(m.get(1)[1]).toBeCloseTo(0);
        });

        test("zero rotation gives identity", () => {
            const m = Mat3.rotation(F32, 0);
            expect(m.get(0)).toEqual([1, 0, 0]);
        });
    });

    describe("scaling", () => {
        test("creates scaling matrix", () => {
            const m = Mat3.scaling(F32, 2, 3);
            expect(m.get(0)).toEqual([2, 0, 0]);
            expect(m.get(1)).toEqual([0, 3, 0]);
            expect(m.get(2)).toEqual([0, 0, 1]);
        });
    });

    describe("uniformScaling", () => {
        test("creates uniform scaling matrix", () => {
            const m = Mat3.uniformScaling(F32, 2);
            expect(m.get(0)).toEqual([2, 0, 0]);
            expect(m.get(1)).toEqual([0, 2, 0]);
            expect(m.get(2)).toEqual([0, 0, 1]);
        });
    });

    describe("shear", () => {
        test("creates shear matrix", () => {
            const m = Mat3.shear(F32, 0.5, 0.3);
            expect(m.get(0)[0]).toBe(1);
            expect(m.get(0)[1]).toBeCloseTo(0.3);
            expect(m.get(0)[2]).toBe(0);
            expect(m.get(1)[0]).toBeCloseTo(0.5);
            expect(m.get(1)[1]).toBe(1);
            expect(m.get(2)[2]).toBe(1);
        });
    });

    describe("reflectX", () => {
        test("creates reflection across X axis", () => {
            const m = Mat3.reflectX();
            expect(m.get(0)).toEqual([1, 0, 0]);
            expect(m.get(1)).toEqual([0, -1, 0]);
        });
    });

    describe("reflectY", () => {
        test("creates reflection across Y axis", () => {
            const m = Mat3.reflectY();
            expect(m.get(0)).toEqual([-1, 0, 0]);
            expect(m.get(1)).toEqual([0, 1, 0]);
        });
    });

    describe("reflectOrigin", () => {
        test("creates reflection across origin", () => {
            const m = Mat3.reflectOrigin();
            expect(m.get(0)).toEqual([-1, 0, 0]);
            expect(m.get(1)).toEqual([0, -1, 0]);
        });
    });

    describe("translate", () => {
        test("translates a matrix", () => {
            const m = Mat3.identity();
            const out = Mat3.create(F32);
            Mat3.translate(out, m, 5, 10);
            expect(out.get(2)).toEqual([5, 10, 1]);
        });

        test("translate accumulates", () => {
            const m = Mat3.translation(F32, 1, 2);
            const out = Mat3.create(F32);
            Mat3.translate(out, m, 3, 4);
            expect(out.get(2)).toEqual([4, 6, 1]);
        });
    });

    describe("rotate", () => {
        test("rotates a matrix", () => {
            const m = Mat3.identity();
            const out = Mat3.create(F32);
            Mat3.rotate(out, m, Math.PI / 2);
            expect(out.get(0)[0]).toBeCloseTo(0);
            expect(out.get(0)[1]).toBeCloseTo(1);
        });

        test("rotate accumulates", () => {
            const m = Mat3.rotation(F32, Math.PI / 4);
            const out = Mat3.create(F32);
            Mat3.rotate(out, m, Math.PI / 4);
            expect(out.get(0)[0]).toBeCloseTo(0);
        });
    });

    describe("scaleMatrix", () => {
        test("scales a matrix", () => {
            const m = Mat3.identity();
            const out = Mat3.create(F32);
            Mat3.scaleMatrix(out, m, 2, 3);
            expect(out.get(0)).toEqual([2, 0, 0]);
            expect(out.get(1)).toEqual([0, 3, 0]);
        });

        test("scale accumulates", () => {
            const m = Mat3.scaling(F32, 2, 3);
            const out = Mat3.create(F32);
            Mat3.scaleMatrix(out, m, 3, 2);
            expect(out.get(0)).toEqual([6, 0, 0]);
            expect(out.get(1)).toEqual([0, 6, 0]);
        });
    });

    describe("fromTRS", () => {
        test("creates matrix from TRS components", () => {
            const m = Mat3.fromTRS(F32, 5, 10, Math.PI / 4, 2, 3);
            expect(m.get(2)[0]).toBe(5);
            expect(m.get(2)[1]).toBe(10);
            expect(m.get(2)[2]).toBe(1);
        });
    });

    describe("decompose", () => {
        test("decomposes matrix into TRS components", () => {
            const m = Mat3.fromTRS(F32, 5, 10, Math.PI / 4, 2, 3);
            const [tx, ty, angle, sx, sy] = Mat3.decompose(m);
            expect(tx).toBeCloseTo(5);
            expect(ty).toBeCloseTo(10);
            expect(sx).toBeCloseTo(2);
            expect(sy).toBeCloseTo(3);
            expect(angle % Math.PI).toBeCloseTo(Math.PI / 4);
        });

        test("decompose identity matrix", () => {
            const m = Mat3.identity();
            const [tx, ty, angle, sx, sy] = Mat3.decompose(m);
            expect(tx).toBe(0);
            expect(ty).toBe(0);
            expect(sx).toBeCloseTo(1);
            expect(sy).toBeCloseTo(1);
            expect(angle).toBe(0);
        });
    });

    describe("getTranslation", () => {
        test("extracts translation from matrix", () => {
            const m = Mat3.translation(F32, 5, 10);
            const [tx, ty] = Mat3.getTranslation(m);
            expect(tx).toBe(5);
            expect(ty).toBe(10);
        });
    });

    describe("getRotation", () => {
        test("extracts rotation angle from matrix", () => {
            const m = Mat3.rotation(F32, Math.PI / 4);
            expect(Mat3.getRotation(m)).toBeCloseTo(Math.PI / 4);
        });

        test("identity matrix has rotation 0", () => {
            const m = Mat3.identity();
            expect(Mat3.getRotation(m)).toBe(0);
        });
    });

    describe("getScale", () => {
        test("extracts scale from matrix", () => {
            const m = Mat3.scaling(F32, 2, 3);
            const [sx, sy] = Mat3.getScale(m);
            expect(sx).toBeCloseTo(2);
            expect(sy).toBeCloseTo(3);
        });

        test("identity matrix has scale 1, 1", () => {
            const m = Mat3.identity();
            const [sx, sy] = Mat3.getScale(m);
            expect(sx).toBeCloseTo(1);
            expect(sy).toBeCloseTo(1);
        });
    });

    describe("getLinearTransform", () => {
        test("extracts linear transform from matrix", () => {
            const m = Mat3.scaling(F32, 2, 3);
            const linear = Mat2.create(F32);
            Mat3.getLinearTransform(linear, m);
            expect(linear.get(0)).toEqual([2, 0]);
            expect(linear.get(1)).toEqual([0, 3]);
        });
    });
});
