import { describe, expect, test } from "bun:test";
import { F32 } from "metis-data";
import { Vec3 } from "../vec3.ts";
import { Vec4 } from "../vec4.ts";

describe("Vec3", () => {
    describe("create", () => {
        test("creates zero vector with no arguments", () => {
            const v = Vec3.create();
            expect(v.get()).toEqual([0, 0, 0]);
        });

        test("creates vector with custom values", () => {
            const v = Vec3.create(F32, 3, 4, 5);
            expect(v.get()).toEqual([3, 4, 5]);
        });

        test("creates vector with negative values", () => {
            const v = Vec3.create(F32, -2, -5, -7);
            expect(v.get()).toEqual([-2, -5, -7]);
        });

        test("creates vector with fractional values", () => {
            const v = Vec3.create(F32, 0.5, 1.5, 2.5);
            expect(v.get()).toEqual([0.5, 1.5, 2.5]);
        });
    });

    describe("clone", () => {
        test("clones a vector", () => {
            const v = Vec3.create(F32, 3, 4, 5);
            const cloned = Vec3.clone(v);
            expect(cloned.get()).toEqual([3, 4, 5]);
            expect(cloned).not.toBe(v);
        });

        test("clone is independent of original", () => {
            const v = Vec3.create(F32, 3, 4, 5);
            const cloned = Vec3.clone(v);
            Vec3.set(v, 10, 20, 30);
            expect(cloned.get()).toEqual([3, 4, 5]);
            expect(v.get()).toEqual([10, 20, 30]);
        });
    });

    describe("copy", () => {
        test("copies values from one vector to another", () => {
            const a = Vec3.create(F32, 3, 4, 5);
            const b = Vec3.create(F32, 0, 0, 0);
            Vec3.copy(b, a);
            expect(b.get()).toEqual([3, 4, 5]);
        });

        test("copy modifies the destination", () => {
            const a = Vec3.create(F32, 10, 20, 30);
            const b = Vec3.create(F32, 5, 5, 5);
            Vec3.copy(b, a);
            expect(a.get()).toEqual([10, 20, 30]);
            expect(b.get()).toEqual([10, 20, 30]);
        });
    });

    describe("set", () => {
        test("sets vector components", () => {
            const v = Vec3.create(F32);
            Vec3.set(v, 7, 8, 9);
            expect(v.get()).toEqual([7, 8, 9]);
        });

        test("set can override existing values", () => {
            const v = Vec3.create(F32, 1, 2, 3);
            Vec3.set(v, 99, 100, 101);
            expect(v.get()).toEqual([99, 100, 101]);
        });
    });

    describe("add", () => {
        test("adds two vectors", () => {
            const a = Vec3.create(F32, 1, 2, 3);
            const b = Vec3.create(F32, 4, 5, 6);
            const out = Vec3.create(F32);
            Vec3.add(out, a, b);
            expect(out.get()).toEqual([5, 7, 9]);
        });

        test("add with negative values", () => {
            const a = Vec3.create(F32, -5, 3, -1);
            const b = Vec3.create(F32, 2, -1, 4);
            const out = Vec3.create(F32);
            Vec3.add(out, a, b);
            expect(out.get()).toEqual([-3, 2, 3]);
        });

        test("add with zero vector", () => {
            const a = Vec3.create(F32, 3, 4, 5);
            const zero = Vec3.create(F32, 0, 0, 0);
            const out = Vec3.create(F32);
            Vec3.add(out, a, zero);
            expect(out.get()).toEqual([3, 4, 5]);
        });
    });

    describe("subtract", () => {
        test("subtracts two vectors", () => {
            const a = Vec3.create(F32, 5, 8, 11);
            const b = Vec3.create(F32, 3, 4, 5);
            const out = Vec3.create(F32);
            Vec3.subtract(out, a, b);
            expect(out.get()).toEqual([2, 4, 6]);
        });

        test("subtract resulting in negative values", () => {
            const a = Vec3.create(F32, 2, 3, 4);
            const b = Vec3.create(F32, 5, 7, 9);
            const out = Vec3.create(F32);
            Vec3.subtract(out, a, b);
            expect(out.get()).toEqual([-3, -4, -5]);
        });

        test("subtract from zero", () => {
            const zero = Vec3.create(F32, 0, 0, 0);
            const a = Vec3.create(F32, 3, 4, 5);
            const out = Vec3.create(F32);
            Vec3.subtract(out, zero, a);
            expect(out.get()).toEqual([-3, -4, -5]);
        });
    });

    describe("multiply", () => {
        test("multiplies two vectors component-wise", () => {
            const a = Vec3.create(F32, 2, 3, 4);
            const b = Vec3.create(F32, 5, 6, 7);
            const out = Vec3.create(F32);
            Vec3.multiply(out, a, b);
            expect(out.get()).toEqual([10, 18, 28]);
        });

        test("multiply with negative values", () => {
            const a = Vec3.create(F32, -2, 3, -4);
            const b = Vec3.create(F32, 5, -6, 7);
            const out = Vec3.create(F32);
            Vec3.multiply(out, a, b);
            expect(out.get()).toEqual([-10, -18, -28]);
        });

        test("multiply by unit vector", () => {
            const a = Vec3.create(F32, 3, 4, 5);
            const unit = Vec3.create(F32, 1, 1, 1);
            const out = Vec3.create(F32);
            Vec3.multiply(out, a, unit);
            expect(out.get()).toEqual([3, 4, 5]);
        });
    });

    describe("divide", () => {
        test("divides two vectors component-wise", () => {
            const a = Vec3.create(F32, 8, 15, 24);
            const b = Vec3.create(F32, 2, 3, 4);
            const out = Vec3.create(F32);
            Vec3.divide(out, a, b);
            expect(out.get()).toEqual([4, 5, 6]);
        });

        test("divide with negative values", () => {
            const a = Vec3.create(F32, -8, 15, -24);
            const b = Vec3.create(F32, 2, -3, 4);
            const out = Vec3.create(F32);
            Vec3.divide(out, a, b);
            expect(out.get()).toEqual([-4, -5, -6]);
        });

        test("divide resulting in fractional values", () => {
            const a = Vec3.create(F32, 1, 1, 1);
            const b = Vec3.create(F32, 2, 4, 8);
            const out = Vec3.create(F32);
            Vec3.divide(out, a, b);
            expect(out.get()).toEqual([0.5, 0.25, 0.125]);
        });
    });

    describe("scale", () => {
        test("scales vector by positive scalar", () => {
            const v = Vec3.create(F32, 1, 2, 3);
            const out = Vec3.create(F32);
            Vec3.scale(out, v, 3);
            expect(out.get()).toEqual([3, 6, 9]);
        });

        test("scales vector by negative scalar", () => {
            const v = Vec3.create(F32, 1, 2, 3);
            const out = Vec3.create(F32);
            Vec3.scale(out, v, -3);
            expect(out.get()).toEqual([-3, -6, -9]);
        });

        test("scales vector by zero", () => {
            const v = Vec3.create(F32, 3, 4, 5);
            const out = Vec3.create(F32);
            Vec3.scale(out, v, 0);
            expect(out.get()).toEqual([0, 0, 0]);
        });

        test("scales vector by fractional scalar", () => {
            const v = Vec3.create(F32, 4, 6, 8);
            const out = Vec3.create(F32);
            Vec3.scale(out, v, 0.5);
            expect(out.get()).toEqual([2, 3, 4]);
        });
    });

    describe("dot", () => {
        test("calculates dot product", () => {
            const a = Vec3.create(F32, 1, 2, 3);
            const b = Vec3.create(F32, 4, 5, 6);
            expect(Vec3.dot(a, b)).toBe(32);
        });

        test("dot product of orthogonal vectors", () => {
            const a = Vec3.create(F32, 1, 0, 0);
            const b = Vec3.create(F32, 0, 1, 0);
            expect(Vec3.dot(a, b)).toBe(0);
        });

        test("dot product with negative values", () => {
            const a = Vec3.create(F32, -1, 2, -3);
            const b = Vec3.create(F32, 4, -5, 6);
            expect(Vec3.dot(a, b)).toBe(-32);
        });

        test("dot product with zero vector", () => {
            const a = Vec3.create(F32, 3, 4, 5);
            const zero = Vec3.create(F32, 0, 0, 0);
            expect(Vec3.dot(a, zero)).toBe(0);
        });
    });

    describe("cross", () => {
        test("calculates cross product of x and y axes", () => {
            const a = Vec3.create(F32, 1, 0, 0);
            const b = Vec3.create(F32, 0, 1, 0);
            const out = Vec3.create(F32);
            Vec3.cross(out, a, b);
            expect(out.get()).toEqual([0, 0, 1]);
        });

        test("cross product is anti-commutative", () => {
            const a = Vec3.create(F32, 1, 0, 0);
            const b = Vec3.create(F32, 0, 1, 0);
            const ab = Vec3.create(F32);
            const ba = Vec3.create(F32);
            Vec3.cross(ab, a, b);
            Vec3.cross(ba, b, a);
            expect(ab.get()[0]).toBeCloseTo(-ba.get()[0]);
            expect(ab.get()[1]).toBeCloseTo(-ba.get()[1]);
            expect(ab.get()[2]).toBeCloseTo(-ba.get()[2]);
        });

        test("cross product of parallel vectors is zero", () => {
            const a = Vec3.create(F32, 1, 1, 1);
            const b = Vec3.create(F32, 2, 2, 2);
            const out = Vec3.create(F32);
            Vec3.cross(out, a, b);
            expect(out.get()).toEqual([0, 0, 0]);
        });

        test("cross product of y and z axes", () => {
            const a = Vec3.create(F32, 0, 1, 0);
            const b = Vec3.create(F32, 0, 0, 1);
            const out = Vec3.create(F32);
            Vec3.cross(out, a, b);
            expect(out.get()).toEqual([1, 0, 0]);
        });
    });

    describe("length", () => {
        test("calculates length of unit vector", () => {
            const v = Vec3.create(F32, 1, 0, 0);
            expect(Vec3.length(v)).toBe(1);
        });

        test("calculates length of vector", () => {
            const v = Vec3.create(F32, 3, 4, 0);
            expect(Vec3.length(v)).toBe(5);
        });

        test("calculates length of 3D vector", () => {
            const v = Vec3.create(F32, 1, 2, 2);
            expect(Vec3.length(v)).toBe(3);
        });

        test("length of zero vector is zero", () => {
            const v = Vec3.create(F32, 0, 0, 0);
            expect(Vec3.length(v)).toBe(0);
        });

        test("length with negative components", () => {
            const v = Vec3.create(F32, -3, -4, 0);
            expect(Vec3.length(v)).toBe(5);
        });
    });

    describe("lengthSquared", () => {
        test("calculates squared length", () => {
            const v = Vec3.create(F32, 3, 4, 0);
            expect(Vec3.lengthSquared(v)).toBe(25);
        });

        test("squared length of unit vector is 1", () => {
            const v = Vec3.create(F32, 1, 0, 0);
            expect(Vec3.lengthSquared(v)).toBe(1);
        });

        test("squared length of zero vector is 0", () => {
            const v = Vec3.create(F32, 0, 0, 0);
            expect(Vec3.lengthSquared(v)).toBe(0);
        });
    });

    describe("distance", () => {
        test("calculates distance between two vectors", () => {
            const a = Vec3.create(F32, 0, 0, 0);
            const b = Vec3.create(F32, 3, 4, 0);
            expect(Vec3.distance(a, b)).toBe(5);
        });

        test("distance is symmetric", () => {
            const a = Vec3.create(F32, 1, 2, 3);
            const b = Vec3.create(F32, 4, 6, 8);
            expect(Vec3.distance(a, b)).toBe(Vec3.distance(b, a));
        });

        test("distance to itself is zero", () => {
            const v = Vec3.create(F32, 3, 4, 5);
            expect(Vec3.distance(v, v)).toBe(0);
        });

        test("distance between same origins is zero", () => {
            const a = Vec3.create(F32, 5, 7, 9);
            const b = Vec3.create(F32, 5, 7, 9);
            expect(Vec3.distance(a, b)).toBe(0);
        });

        test("3D distance calculation", () => {
            const a = Vec3.create(F32, 0, 0, 0);
            const b = Vec3.create(F32, 1, 2, 2);
            expect(Vec3.distance(a, b)).toBe(3);
        });
    });

    describe("distanceSquared", () => {
        test("calculates squared distance", () => {
            const a = Vec3.create(F32, 0, 0, 0);
            const b = Vec3.create(F32, 3, 4, 0);
            expect(Vec3.distanceSquared(a, b)).toBe(25);
        });

        test("squared distance to itself is zero", () => {
            const v = Vec3.create(F32, 3, 4, 5);
            expect(Vec3.distanceSquared(v, v)).toBe(0);
        });
    });

    describe("normalize", () => {
        test("normalizes a vector", () => {
            const v = Vec3.create(F32, 3, 4, 0);
            const out = Vec3.create(F32);
            Vec3.normalize(out, v);
            expect(Vec3.length(out)).toBeCloseTo(1);
        });

        test("normalized vector has same direction", () => {
            const v = Vec3.create(F32, 3, 4, 0);
            const out = Vec3.create(F32);
            Vec3.normalize(out, v);
            expect(out.get()[0]).toBeCloseTo(0.6);
            expect(out.get()[1]).toBeCloseTo(0.8);
            expect(out.get()[2]).toBeCloseTo(0);
        });

        test("normalize unit vector remains unit", () => {
            const v = Vec3.create(F32, 1, 0, 0);
            const out = Vec3.create(F32);
            Vec3.normalize(out, v);
            expect(out.get()).toEqual([1, 0, 0]);
        });

        test("normalize zero vector gives zero vector", () => {
            const v = Vec3.create(F32, 0, 0, 0);
            const out = Vec3.create(F32);
            Vec3.normalize(out, v);
            expect(out.get()).toEqual([0, 0, 0]);
        });
    });

    describe("negate", () => {
        test("negates a vector", () => {
            const v = Vec3.create(F32, 3, 4, 5);
            const out = Vec3.create(F32);
            Vec3.negate(out, v);
            expect(out.get()[0]).toBe(-3);
            expect(out.get()[1]).toBe(-4);
            expect(out.get()[2]).toBe(-5);
        });

        test("negate zero vector", () => {
            const v = Vec3.create(F32, 0, 0, 0);
            const out = Vec3.create(F32);
            Vec3.negate(out, v);
            expect(out.get()[0]).toBeCloseTo(0);
            expect(out.get()[1]).toBeCloseTo(0);
            expect(out.get()[2]).toBeCloseTo(0);
        });

        test("double negate returns original", () => {
            const v = Vec3.create(F32, 3, 4, 5);
            const out = Vec3.create(F32);
            Vec3.negate(out, v);
            Vec3.negate(out, out);
            expect(out.get()).toEqual([3, 4, 5]);
        });
    });

    describe("lerp", () => {
        test("linear interpolation at t=0", () => {
            const a = Vec3.create(F32, 0, 0, 0);
            const b = Vec3.create(F32, 10, 10, 10);
            const out = Vec3.create(F32);
            Vec3.lerp(out, a, b, 0);
            expect(out.get()).toEqual([0, 0, 0]);
        });

        test("linear interpolation at t=1", () => {
            const a = Vec3.create(F32, 0, 0, 0);
            const b = Vec3.create(F32, 10, 20, 30);
            const out = Vec3.create(F32);
            Vec3.lerp(out, a, b, 1);
            expect(out.get()).toEqual([10, 20, 30]);
        });

        test("linear interpolation at t=0.5", () => {
            const a = Vec3.create(F32, 0, 0, 0);
            const b = Vec3.create(F32, 10, 20, 30);
            const out = Vec3.create(F32);
            Vec3.lerp(out, a, b, 0.5);
            expect(out.get()).toEqual([5, 10, 15]);
        });

        test("linear interpolation extrapolates beyond t=1", () => {
            const a = Vec3.create(F32, 0, 0, 0);
            const b = Vec3.create(F32, 10, 10, 10);
            const out = Vec3.create(F32);
            Vec3.lerp(out, a, b, 2);
            expect(out.get()).toEqual([20, 20, 20]);
        });

        test("linear interpolation extrapolates before t=0", () => {
            const a = Vec3.create(F32, 10, 10, 10);
            const b = Vec3.create(F32, 20, 20, 20);
            const out = Vec3.create(F32);
            Vec3.lerp(out, a, b, -0.5);
            expect(out.get()).toEqual([5, 5, 5]);
        });
    });

    describe("transformQuat", () => {
        test("transforms vector by identity quaternion", () => {
            const v = Vec3.create(F32, 1, 2, 3);
            const q = Vec4.create(undefined, 0, 0, 0, 1);
            const out = Vec3.create(F32);
            Vec3.transformQuat(out, v, q);
            expect(out.get()[0]).toBeCloseTo(1);
            expect(out.get()[1]).toBeCloseTo(2);
            expect(out.get()[2]).toBeCloseTo(3);
        });

        test("transforms vector by 180 degree quaternion around x-axis", () => {
            const v = Vec3.create(F32, 0, 1, 0);
            const q = Vec4.create(undefined, 1, 0, 0, 0);
            const out = Vec3.create(F32);
            Vec3.transformQuat(out, v, q);
            expect(out.get()[1]).toBeCloseTo(-1);
        });

        test("transform preserves vector length", () => {
            const v = Vec3.create(F32, 3, 4, 0);
            const q = Vec4.create(undefined, Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
            const out = Vec3.create(F32);
            Vec3.transformQuat(out, v, q);
            expect(Vec3.length(out)).toBeCloseTo(5);
        });
    });

    describe("equals", () => {
        test("equal vectors return true", () => {
            const a = Vec3.create(F32, 3, 4, 5);
            const b = Vec3.create(F32, 3, 4, 5);
            expect(Vec3.equals(a, b)).toBe(true);
        });

        test("different vectors return false", () => {
            const a = Vec3.create(F32, 3, 4, 5);
            const b = Vec3.create(F32, 3, 4, 6);
            expect(Vec3.equals(a, b)).toBe(false);
        });

        test("same vector equals itself", () => {
            const v = Vec3.create(F32, 3, 4, 5);
            expect(Vec3.equals(v, v)).toBe(true);
        });
    });
});
