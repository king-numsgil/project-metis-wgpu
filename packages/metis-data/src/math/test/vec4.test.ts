import { describe, expect, test } from "bun:test";
import { F32 } from "metis-data";
import { Vec4 } from "../vec4.ts";

describe("Vec4", () => {
    describe("create", () => {
        test("creates zero vector with no arguments", () => {
            const v = Vec4.create();
            expect(v.get()).toEqual([0, 0, 0, 0]);
        });

        test("creates vector with custom values", () => {
            const v = Vec4.create(F32, 3, 4, 5, 6);
            expect(v.get()).toEqual([3, 4, 5, 6]);
        });

        test("creates vector with negative values", () => {
            const v = Vec4.create(F32, -2, -5, -7, -9);
            expect(v.get()).toEqual([-2, -5, -7, -9]);
        });

        test("creates vector with fractional values", () => {
            const v = Vec4.create(F32, 0.5, 1.5, 2.5, 3.5);
            expect(v.get()).toEqual([0.5, 1.5, 2.5, 3.5]);
        });

        test("creates homogeneous coordinate (w=1)", () => {
            const v = Vec4.create(F32, 3, 4, 5, 1);
            expect(v.get()).toEqual([3, 4, 5, 1]);
        });
    });

    describe("clone", () => {
        test("clones a vector", () => {
            const v = Vec4.create(F32, 3, 4, 5, 6);
            const cloned = Vec4.clone(v);
            expect(cloned.get()).toEqual([3, 4, 5, 6]);
            expect(cloned).not.toBe(v);
        });

        test("clone is independent of original", () => {
            const v = Vec4.create(F32, 3, 4, 5, 6);
            const cloned = Vec4.clone(v);
            Vec4.set(v, 10, 20, 30, 40);
            expect(cloned.get()).toEqual([3, 4, 5, 6]);
            expect(v.get()).toEqual([10, 20, 30, 40]);
        });
    });

    describe("copy", () => {
        test("copies values from one vector to another", () => {
            const a = Vec4.create(F32, 3, 4, 5, 6);
            const b = Vec4.create(F32, 0, 0, 0, 0);
            Vec4.copy(b, a);
            expect(b.get()).toEqual([3, 4, 5, 6]);
        });

        test("copy modifies the destination", () => {
            const a = Vec4.create(F32, 10, 20, 30, 40);
            const b = Vec4.create(F32, 5, 5, 5, 5);
            Vec4.copy(b, a);
            expect(a.get()).toEqual([10, 20, 30, 40]);
            expect(b.get()).toEqual([10, 20, 30, 40]);
        });
    });

    describe("set", () => {
        test("sets vector components", () => {
            const v = Vec4.create(F32);
            Vec4.set(v, 7, 8, 9, 10);
            expect(v.get()).toEqual([7, 8, 9, 10]);
        });

        test("set can override existing values", () => {
            const v = Vec4.create(F32, 1, 2, 3, 4);
            Vec4.set(v, 99, 100, 101, 102);
            expect(v.get()).toEqual([99, 100, 101, 102]);
        });
    });

    describe("add", () => {
        test("adds two vectors", () => {
            const a = Vec4.create(F32, 1, 2, 3, 4);
            const b = Vec4.create(F32, 5, 6, 7, 8);
            const out = Vec4.create(F32);
            Vec4.add(out, a, b);
            expect(out.get()).toEqual([6, 8, 10, 12]);
        });

        test("add with negative values", () => {
            const a = Vec4.create(F32, -5, 3, -1, 7);
            const b = Vec4.create(F32, 2, -1, 4, -3);
            const out = Vec4.create(F32);
            Vec4.add(out, a, b);
            expect(out.get()).toEqual([-3, 2, 3, 4]);
        });

        test("add with zero vector", () => {
            const a = Vec4.create(F32, 3, 4, 5, 6);
            const zero = Vec4.create(F32, 0, 0, 0, 0);
            const out = Vec4.create(F32);
            Vec4.add(out, a, zero);
            expect(out.get()).toEqual([3, 4, 5, 6]);
        });
    });

    describe("subtract", () => {
        test("subtracts two vectors", () => {
            const a = Vec4.create(F32, 5, 8, 11, 14);
            const b = Vec4.create(F32, 3, 4, 5, 6);
            const out = Vec4.create(F32);
            Vec4.subtract(out, a, b);
            expect(out.get()).toEqual([2, 4, 6, 8]);
        });

        test("subtract resulting in negative values", () => {
            const a = Vec4.create(F32, 2, 3, 4, 5);
            const b = Vec4.create(F32, 5, 7, 9, 11);
            const out = Vec4.create(F32);
            Vec4.subtract(out, a, b);
            expect(out.get()).toEqual([-3, -4, -5, -6]);
        });

        test("subtract from zero", () => {
            const zero = Vec4.create(F32, 0, 0, 0, 0);
            const a = Vec4.create(F32, 3, 4, 5, 6);
            const out = Vec4.create(F32);
            Vec4.subtract(out, zero, a);
            expect(out.get()).toEqual([-3, -4, -5, -6]);
        });
    });

    describe("multiply", () => {
        test("multiplies two vectors component-wise", () => {
            const a = Vec4.create(F32, 2, 3, 4, 5);
            const b = Vec4.create(F32, 6, 7, 8, 9);
            const out = Vec4.create(F32);
            Vec4.multiply(out, a, b);
            expect(out.get()).toEqual([12, 21, 32, 45]);
        });

        test("multiply with negative values", () => {
            const a = Vec4.create(F32, -2, 3, -4, 5);
            const b = Vec4.create(F32, 6, -7, 8, -9);
            const out = Vec4.create(F32);
            Vec4.multiply(out, a, b);
            expect(out.get()).toEqual([-12, -21, -32, -45]);
        });

        test("multiply by unit vector", () => {
            const a = Vec4.create(F32, 3, 4, 5, 6);
            const unit = Vec4.create(F32, 1, 1, 1, 1);
            const out = Vec4.create(F32);
            Vec4.multiply(out, a, unit);
            expect(out.get()).toEqual([3, 4, 5, 6]);
        });
    });

    describe("divide", () => {
        test("divides two vectors component-wise", () => {
            const a = Vec4.create(F32, 12, 21, 32, 45);
            const b = Vec4.create(F32, 2, 3, 4, 5);
            const out = Vec4.create(F32);
            Vec4.divide(out, a, b);
            expect(out.get()).toEqual([6, 7, 8, 9]);
        });

        test("divide with negative values", () => {
            const a = Vec4.create(F32, -12, 21, -32, 45);
            const b = Vec4.create(F32, 2, -3, 4, -5);
            const out = Vec4.create(F32);
            Vec4.divide(out, a, b);
            expect(out.get()).toEqual([-6, -7, -8, -9]);
        });

        test("divide resulting in fractional values", () => {
            const a = Vec4.create(F32, 1, 1, 1, 1);
            const b = Vec4.create(F32, 2, 4, 8, 16);
            const out = Vec4.create(F32);
            Vec4.divide(out, a, b);
            expect(out.get()).toEqual([0.5, 0.25, 0.125, 0.0625]);
        });
    });

    describe("scale", () => {
        test("scales vector by positive scalar", () => {
            const v = Vec4.create(F32, 1, 2, 3, 4);
            const out = Vec4.create(F32);
            Vec4.scale(out, v, 2);
            expect(out.get()).toEqual([2, 4, 6, 8]);
        });

        test("scales vector by negative scalar", () => {
            const v = Vec4.create(F32, 1, 2, 3, 4);
            const out = Vec4.create(F32);
            Vec4.scale(out, v, -2);
            expect(out.get()).toEqual([-2, -4, -6, -8]);
        });

        test("scales vector by zero", () => {
            const v = Vec4.create(F32, 3, 4, 5, 6);
            const out = Vec4.create(F32);
            Vec4.scale(out, v, 0);
            expect(out.get()).toEqual([0, 0, 0, 0]);
        });

        test("scales vector by fractional scalar", () => {
            const v = Vec4.create(F32, 4, 6, 8, 10);
            const out = Vec4.create(F32);
            Vec4.scale(out, v, 0.5);
            expect(out.get()).toEqual([2, 3, 4, 5]);
        });
    });

    describe("dot", () => {
        test("calculates dot product", () => {
            const a = Vec4.create(F32, 1, 2, 3, 4);
            const b = Vec4.create(F32, 5, 6, 7, 8);
            expect(Vec4.dot(a, b)).toBe(70);
        });

        test("dot product with negative values", () => {
            const a = Vec4.create(F32, -1, 2, -3, 4);
            const b = Vec4.create(F32, 5, -6, 7, -8);
            expect(Vec4.dot(a, b)).toBe(-70);
        });

        test("dot product with zero vector", () => {
            const a = Vec4.create(F32, 3, 4, 5, 6);
            const zero = Vec4.create(F32, 0, 0, 0, 0);
            expect(Vec4.dot(a, zero)).toBe(0);
        });

        test("dot product of orthonormal vectors", () => {
            const a = Vec4.create(F32, 1, 0, 0, 0);
            const b = Vec4.create(F32, 0, 1, 0, 0);
            expect(Vec4.dot(a, b)).toBe(0);
        });
    });

    describe("length", () => {
        test("calculates length of unit vector", () => {
            const v = Vec4.create(F32, 1, 0, 0, 0);
            expect(Vec4.length(v)).toBe(1);
        });

        test("calculates length of 4D vector", () => {
            const v = Vec4.create(F32, 1, 2, 2, 4);
            expect(Vec4.length(v)).toBe(5);
        });

        test("length of zero vector is zero", () => {
            const v = Vec4.create(F32, 0, 0, 0, 0);
            expect(Vec4.length(v)).toBe(0);
        });

        test("length with negative components", () => {
            const v = Vec4.create(F32, -3, -4, 0, 0);
            expect(Vec4.length(v)).toBe(5);
        });
    });

    describe("lengthSquared", () => {
        test("calculates squared length", () => {
            const v = Vec4.create(F32, 1, 2, 2, 4);
            expect(Vec4.lengthSquared(v)).toBe(25);
        });

        test("squared length of unit vector is 1", () => {
            const v = Vec4.create(F32, 1, 0, 0, 0);
            expect(Vec4.lengthSquared(v)).toBe(1);
        });

        test("squared length of zero vector is 0", () => {
            const v = Vec4.create(F32, 0, 0, 0, 0);
            expect(Vec4.lengthSquared(v)).toBe(0);
        });
    });

    describe("normalize", () => {
        test("normalizes a vector", () => {
            const v = Vec4.create(F32, 1, 2, 2, 4);
            const out = Vec4.create(F32);
            Vec4.normalize(out, v);
            expect(Vec4.length(out)).toBeCloseTo(1);
        });

        test("normalized vector maintains proportions", () => {
            const v = Vec4.create(F32, 1, 2, 2, 4);
            const out = Vec4.create(F32);
            Vec4.normalize(out, v);
            expect(out.get()[0]).toBeCloseTo(0.2);
            expect(out.get()[1]).toBeCloseTo(0.4);
            expect(out.get()[2]).toBeCloseTo(0.4);
            expect(out.get()[3]).toBeCloseTo(0.8);
        });

        test("normalize unit vector remains unit", () => {
            const v = Vec4.create(F32, 1, 0, 0, 0);
            const out = Vec4.create(F32);
            Vec4.normalize(out, v);
            expect(out.get()).toEqual([1, 0, 0, 0]);
        });

        test("normalize zero vector gives zero vector", () => {
            const v = Vec4.create(F32, 0, 0, 0, 0);
            const out = Vec4.create(F32);
            Vec4.normalize(out, v);
            expect(out.get()).toEqual([0, 0, 0, 0]);
        });
    });

    describe("negate", () => {
        test("negates a vector", () => {
            const v = Vec4.create(F32, 3, 4, 5, 6);
            const out = Vec4.create(F32);
            Vec4.negate(out, v);
            expect(out.get()[0]).toBe(-3);
            expect(out.get()[1]).toBe(-4);
            expect(out.get()[2]).toBe(-5);
            expect(out.get()[3]).toBe(-6);
        });

        test("negate zero vector", () => {
            const v = Vec4.create(F32, 0, 0, 0, 0);
            const out = Vec4.create(F32);
            Vec4.negate(out, v);
            expect(out.get()[0]).toBeCloseTo(0);
            expect(out.get()[1]).toBeCloseTo(0);
            expect(out.get()[2]).toBeCloseTo(0);
            expect(out.get()[3]).toBeCloseTo(0);
        });

        test("double negate returns original", () => {
            const v = Vec4.create(F32, 3, 4, 5, 6);
            const out = Vec4.create(F32);
            Vec4.negate(out, v);
            Vec4.negate(out, out);
            expect(out.get()).toEqual([3, 4, 5, 6]);
        });
    });

    describe("lerp", () => {
        test("linear interpolation at t=0", () => {
            const a = Vec4.create(F32, 0, 0, 0, 0);
            const b = Vec4.create(F32, 10, 20, 30, 40);
            const out = Vec4.create(F32);
            Vec4.lerp(out, a, b, 0);
            expect(out.get()).toEqual([0, 0, 0, 0]);
        });

        test("linear interpolation at t=1", () => {
            const a = Vec4.create(F32, 0, 0, 0, 0);
            const b = Vec4.create(F32, 10, 20, 30, 40);
            const out = Vec4.create(F32);
            Vec4.lerp(out, a, b, 1);
            expect(out.get()).toEqual([10, 20, 30, 40]);
        });

        test("linear interpolation at t=0.5", () => {
            const a = Vec4.create(F32, 0, 0, 0, 0);
            const b = Vec4.create(F32, 10, 20, 30, 40);
            const out = Vec4.create(F32);
            Vec4.lerp(out, a, b, 0.5);
            expect(out.get()).toEqual([5, 10, 15, 20]);
        });

        test("linear interpolation extrapolates beyond t=1", () => {
            const a = Vec4.create(F32, 0, 0, 0, 0);
            const b = Vec4.create(F32, 10, 10, 10, 10);
            const out = Vec4.create(F32);
            Vec4.lerp(out, a, b, 2);
            expect(out.get()).toEqual([20, 20, 20, 20]);
        });

        test("linear interpolation extrapolates before t=0", () => {
            const a = Vec4.create(F32, 10, 10, 10, 10);
            const b = Vec4.create(F32, 20, 20, 20, 20);
            const out = Vec4.create(F32);
            Vec4.lerp(out, a, b, -0.5);
            expect(out.get()).toEqual([5, 5, 5, 5]);
        });
    });

    describe("equals", () => {
        test("equal vectors return true", () => {
            const a = Vec4.create(F32, 3, 4, 5, 6);
            const b = Vec4.create(F32, 3, 4, 5, 6);
            expect(Vec4.equals(a, b)).toBe(true);
        });

        test("different vectors return false", () => {
            const a = Vec4.create(F32, 3, 4, 5, 6);
            const b = Vec4.create(F32, 3, 4, 5, 7);
            expect(Vec4.equals(a, b)).toBe(false);
        });

        test("same vector equals itself", () => {
            const v = Vec4.create(F32, 3, 4, 5, 6);
            expect(Vec4.equals(v, v)).toBe(true);
        });

        test("order matters for equality", () => {
            const a = Vec4.create(F32, 1, 2, 3, 4);
            const b = Vec4.create(F32, 4, 3, 2, 1);
            expect(Vec4.equals(a, b)).toBe(false);
        });
    });
});
