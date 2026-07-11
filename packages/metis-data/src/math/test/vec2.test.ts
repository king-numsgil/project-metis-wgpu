import { describe, expect, test } from "bun:test";
import { F32 } from "metis-data";
import { Vec2 } from "../vec2.ts";

describe("Vec2", () => {
    describe("create", () => {
        test("creates zero vector with no arguments", () => {
            const v = Vec2.create();
            expect(v.get()).toEqual([0, 0]);
        });

        test("creates vector with custom values", () => {
            const v = Vec2.create(F32, 3, 4);
            expect(v.get()).toEqual([3, 4]);
        });

        test("creates vector with negative values", () => {
            const v = Vec2.create(F32, -2, -5);
            expect(v.get()).toEqual([-2, -5]);
        });

        test("creates vector with fractional values", () => {
            const v = Vec2.create(F32, 0.5, 1.5);
            expect(v.get()).toEqual([0.5, 1.5]);
        });
    });

    describe("clone", () => {
        test("clones a vector", () => {
            const v = Vec2.create(F32, 3, 4);
            const cloned = Vec2.clone(v);
            expect(cloned.get()).toEqual([3, 4]);
            expect(cloned).not.toBe(v);
        });

        test("clone is independent of original", () => {
            const v = Vec2.create(F32, 3, 4);
            const cloned = Vec2.clone(v);
            Vec2.set(v, 10, 20);
            expect(cloned.get()).toEqual([3, 4]);
            expect(v.get()).toEqual([10, 20]);
        });
    });

    describe("copy", () => {
        test("copies values from one vector to another", () => {
            const a = Vec2.create(F32, 3, 4);
            const b = Vec2.create(F32, 0, 0);
            Vec2.copy(b, a);
            expect(b.get()).toEqual([3, 4]);
        });

        test("copy modifies the destination", () => {
            const a = Vec2.create(F32, 10, 20);
            const b = Vec2.create(F32, 5, 5);
            Vec2.copy(b, a);
            expect(a.get()).toEqual([10, 20]);
            expect(b.get()).toEqual([10, 20]);
        });
    });

    describe("set", () => {
        test("sets vector components", () => {
            const v = Vec2.create(F32);
            Vec2.set(v, 7, 8);
            expect(v.get()).toEqual([7, 8]);
        });

        test("set can override existing values", () => {
            const v = Vec2.create(F32, 1, 2);
            Vec2.set(v, 99, 100);
            expect(v.get()).toEqual([99, 100]);
        });
    });

    describe("add", () => {
        test("adds two vectors", () => {
            const a = Vec2.create(F32, 1, 2);
            const b = Vec2.create(F32, 3, 4);
            const out = Vec2.create(F32);
            Vec2.add(out, a, b);
            expect(out.get()).toEqual([4, 6]);
        });

        test("add with negative values", () => {
            const a = Vec2.create(F32, -5, 3);
            const b = Vec2.create(F32, 2, -1);
            const out = Vec2.create(F32);
            Vec2.add(out, a, b);
            expect(out.get()).toEqual([-3, 2]);
        });

        test("add with zero vector", () => {
            const a = Vec2.create(F32, 3, 4);
            const zero = Vec2.create(F32, 0, 0);
            const out = Vec2.create(F32);
            Vec2.add(out, a, zero);
            expect(out.get()).toEqual([3, 4]);
        });
    });

    describe("subtract", () => {
        test("subtracts two vectors", () => {
            const a = Vec2.create(F32, 5, 8);
            const b = Vec2.create(F32, 3, 4);
            const out = Vec2.create(F32);
            Vec2.subtract(out, a, b);
            expect(out.get()).toEqual([2, 4]);
        });

        test("subtract resulting in negative values", () => {
            const a = Vec2.create(F32, 2, 3);
            const b = Vec2.create(F32, 5, 7);
            const out = Vec2.create(F32);
            Vec2.subtract(out, a, b);
            expect(out.get()).toEqual([-3, -4]);
        });

        test("subtract from zero", () => {
            const zero = Vec2.create(F32, 0, 0);
            const a = Vec2.create(F32, 3, 4);
            const out = Vec2.create(F32);
            Vec2.subtract(out, zero, a);
            expect(out.get()).toEqual([-3, -4]);
        });
    });

    describe("multiply", () => {
        test("multiplies two vectors component-wise", () => {
            const a = Vec2.create(F32, 2, 3);
            const b = Vec2.create(F32, 4, 5);
            const out = Vec2.create(F32);
            Vec2.multiply(out, a, b);
            expect(out.get()).toEqual([8, 15]);
        });

        test("multiply with negative values", () => {
            const a = Vec2.create(F32, -2, 3);
            const b = Vec2.create(F32, 4, -5);
            const out = Vec2.create(F32);
            Vec2.multiply(out, a, b);
            expect(out.get()).toEqual([-8, -15]);
        });

        test("multiply by unit vector", () => {
            const a = Vec2.create(F32, 3, 4);
            const unit = Vec2.create(F32, 1, 1);
            const out = Vec2.create(F32);
            Vec2.multiply(out, a, unit);
            expect(out.get()).toEqual([3, 4]);
        });
    });

    describe("divide", () => {
        test("divides two vectors component-wise", () => {
            const a = Vec2.create(F32, 8, 15);
            const b = Vec2.create(F32, 2, 3);
            const out = Vec2.create(F32);
            Vec2.divide(out, a, b);
            expect(out.get()).toEqual([4, 5]);
        });

        test("divide with negative values", () => {
            const a = Vec2.create(F32, -8, 15);
            const b = Vec2.create(F32, 2, -3);
            const out = Vec2.create(F32);
            Vec2.divide(out, a, b);
            expect(out.get()).toEqual([-4, -5]);
        });

        test("divide resulting in fractional values", () => {
            const a = Vec2.create(F32, 1, 1);
            const b = Vec2.create(F32, 2, 4);
            const out = Vec2.create(F32);
            Vec2.divide(out, a, b);
            expect(out.get()).toEqual([0.5, 0.25]);
        });
    });

    describe("scale", () => {
        test("scales vector by positive scalar", () => {
            const v = Vec2.create(F32, 1, 2);
            const out = Vec2.create(F32);
            Vec2.scale(out, v, 3);
            expect(out.get()).toEqual([3, 6]);
        });

        test("scales vector by negative scalar", () => {
            const v = Vec2.create(F32, 1, 2);
            const out = Vec2.create(F32);
            Vec2.scale(out, v, -3);
            expect(out.get()).toEqual([-3, -6]);
        });

        test("scales vector by zero", () => {
            const v = Vec2.create(F32, 3, 4);
            const out = Vec2.create(F32);
            Vec2.scale(out, v, 0);
            expect(out.get()).toEqual([0, 0]);
        });

        test("scales vector by fractional scalar", () => {
            const v = Vec2.create(F32, 4, 6);
            const out = Vec2.create(F32);
            Vec2.scale(out, v, 0.5);
            expect(out.get()).toEqual([2, 3]);
        });
    });

    describe("dot", () => {
        test("calculates dot product", () => {
            const a = Vec2.create(F32, 1, 2);
            const b = Vec2.create(F32, 3, 4);
            expect(Vec2.dot(a, b)).toBe(11);
        });

        test("dot product of orthogonal vectors", () => {
            const a = Vec2.create(F32, 1, 0);
            const b = Vec2.create(F32, 0, 1);
            expect(Vec2.dot(a, b)).toBe(0);
        });

        test("dot product with negative values", () => {
            const a = Vec2.create(F32, -1, 2);
            const b = Vec2.create(F32, 3, -4);
            expect(Vec2.dot(a, b)).toBe(-11);
        });

        test("dot product with zero vector", () => {
            const a = Vec2.create(F32, 3, 4);
            const zero = Vec2.create(F32, 0, 0);
            expect(Vec2.dot(a, zero)).toBe(0);
        });
    });

    describe("cross", () => {
        test("calculates cross product magnitude (z-component)", () => {
            const a = Vec2.create(F32, 1, 0);
            const b = Vec2.create(F32, 0, 1);
            expect(Vec2.cross(a, b)).toBe(1);
        });

        test("cross product is anti-commutative", () => {
            const a = Vec2.create(F32, 1, 0);
            const b = Vec2.create(F32, 0, 1);
            expect(Vec2.cross(a, b)).toBe(-Vec2.cross(b, a));
        });

        test("cross product of parallel vectors is zero", () => {
            const a = Vec2.create(F32, 1, 1);
            const b = Vec2.create(F32, 2, 2);
            expect(Vec2.cross(a, b)).toBe(0);
        });
    });

    describe("length", () => {
        test("calculates length of unit vector", () => {
            const v = Vec2.create(F32, 1, 0);
            expect(Vec2.length(v)).toBe(1);
        });

        test("calculates length of vector", () => {
            const v = Vec2.create(F32, 3, 4);
            expect(Vec2.length(v)).toBe(5);
        });

        test("length of zero vector is zero", () => {
            const v = Vec2.create(F32, 0, 0);
            expect(Vec2.length(v)).toBe(0);
        });

        test("length with negative components", () => {
            const v = Vec2.create(F32, -3, -4);
            expect(Vec2.length(v)).toBe(5);
        });
    });

    describe("lengthSquared", () => {
        test("calculates squared length", () => {
            const v = Vec2.create(F32, 3, 4);
            expect(Vec2.lengthSquared(v)).toBe(25);
        });

        test("squared length of unit vector is 1", () => {
            const v = Vec2.create(F32, 1, 0);
            expect(Vec2.lengthSquared(v)).toBe(1);
        });

        test("squared length of zero vector is 0", () => {
            const v = Vec2.create(F32, 0, 0);
            expect(Vec2.lengthSquared(v)).toBe(0);
        });
    });

    describe("distance", () => {
        test("calculates distance between two vectors", () => {
            const a = Vec2.create(F32, 0, 0);
            const b = Vec2.create(F32, 3, 4);
            expect(Vec2.distance(a, b)).toBe(5);
        });

        test("distance is symmetric", () => {
            const a = Vec2.create(F32, 1, 2);
            const b = Vec2.create(F32, 4, 6);
            expect(Vec2.distance(a, b)).toBe(Vec2.distance(b, a));
        });

        test("distance to itself is zero", () => {
            const v = Vec2.create(F32, 3, 4);
            expect(Vec2.distance(v, v)).toBe(0);
        });

        test("distance between same origins is zero", () => {
            const a = Vec2.create(F32, 5, 7);
            const b = Vec2.create(F32, 5, 7);
            expect(Vec2.distance(a, b)).toBe(0);
        });
    });

    describe("distanceSquared", () => {
        test("calculates squared distance", () => {
            const a = Vec2.create(F32, 0, 0);
            const b = Vec2.create(F32, 3, 4);
            expect(Vec2.distanceSquared(a, b)).toBe(25);
        });

        test("squared distance to itself is zero", () => {
            const v = Vec2.create(F32, 3, 4);
            expect(Vec2.distanceSquared(v, v)).toBe(0);
        });
    });

    describe("normalize", () => {
        test("normalizes a vector", () => {
            const v = Vec2.create(F32, 3, 4);
            const out = Vec2.create(F32);
            Vec2.normalize(out, v);
            expect(Vec2.length(out)).toBeCloseTo(1);
        });

        test("normalized vector has same direction", () => {
            const v = Vec2.create(F32, 3, 4);
            const out = Vec2.create(F32);
            Vec2.normalize(out, v);
            expect(out.get()[0]).toBeCloseTo(0.6);
            expect(out.get()[1]).toBeCloseTo(0.8);
        });

        test("normalize unit vector remains unit", () => {
            const v = Vec2.create(F32, 1, 0);
            const out = Vec2.create(F32);
            Vec2.normalize(out, v);
            expect(out.get()).toEqual([1, 0]);
        });

        test("normalize zero vector gives zero vector", () => {
            const v = Vec2.create(F32, 0, 0);
            const out = Vec2.create(F32);
            Vec2.normalize(out, v);
            expect(out.get()).toEqual([0, 0]);
        });
    });

    describe("negate", () => {
        test("negates a vector", () => {
            const v = Vec2.create(F32, 3, 4);
            const out = Vec2.create(F32);
            Vec2.negate(out, v);
            expect(out.get()).toEqual([-3, -4]);
        });

        test("negate zero vector", () => {
            const v = Vec2.create(F32, 0, 0);
            const out = Vec2.create(F32);
            Vec2.negate(out, v);
            expect(out.get()[0]).toBeCloseTo(0);
            expect(out.get()[1]).toBeCloseTo(0);
        });

        test("double negate returns original", () => {
            const v = Vec2.create(F32, 3, 4);
            const out = Vec2.create(F32);
            Vec2.negate(out, v);
            Vec2.negate(out, out);
            expect(out.get()).toEqual([3, 4]);
        });
    });

    describe("lerp", () => {
        test("linear interpolation at t=0", () => {
            const a = Vec2.create(F32, 0, 0);
            const b = Vec2.create(F32, 10, 10);
            const out = Vec2.create(F32);
            Vec2.lerp(out, a, b, 0);
            expect(out.get()).toEqual([0, 0]);
        });

        test("linear interpolation at t=1", () => {
            const a = Vec2.create(F32, 0, 0);
            const b = Vec2.create(F32, 10, 10);
            const out = Vec2.create(F32);
            Vec2.lerp(out, a, b, 1);
            expect(out.get()).toEqual([10, 10]);
        });

        test("linear interpolation at t=0.5", () => {
            const a = Vec2.create(F32, 0, 0);
            const b = Vec2.create(F32, 10, 20);
            const out = Vec2.create(F32);
            Vec2.lerp(out, a, b, 0.5);
            expect(out.get()).toEqual([5, 10]);
        });

        test("linear interpolation extrapolates beyond t=1", () => {
            const a = Vec2.create(F32, 0, 0);
            const b = Vec2.create(F32, 10, 10);
            const out = Vec2.create(F32);
            Vec2.lerp(out, a, b, 2);
            expect(out.get()).toEqual([20, 20]);
        });

        test("linear interpolation extrapolates before t=0", () => {
            const a = Vec2.create(F32, 10, 10);
            const b = Vec2.create(F32, 20, 20);
            const out = Vec2.create(F32);
            Vec2.lerp(out, a, b, -0.5);
            expect(out.get()).toEqual([5, 5]);
        });
    });

    describe("rotate", () => {
        test("rotates vector by 90 degrees", () => {
            const v = Vec2.create(F32, 1, 0);
            const out = Vec2.create(F32);
            Vec2.rotate(out, v, Math.PI / 2);
            expect(out.get()[0]).toBeCloseTo(0);
            expect(out.get()[1]).toBeCloseTo(1);
        });

        test("rotates vector by 180 degrees", () => {
            const v = Vec2.create(F32, 1, 0);
            const out = Vec2.create(F32);
            Vec2.rotate(out, v, Math.PI);
            expect(out.get()[0]).toBeCloseTo(-1);
            expect(out.get()[1]).toBeCloseTo(0);
        });

        test("rotates vector by 360 degrees", () => {
            const v = Vec2.create(F32, 3, 4);
            const out = Vec2.create(F32);
            Vec2.rotate(out, v, 2 * Math.PI);
            expect(out.get()[0]).toBeCloseTo(3);
            expect(out.get()[1]).toBeCloseTo(4);
        });

        test("rotate by zero angle", () => {
            const v = Vec2.create(F32, 3, 4);
            const out = Vec2.create(F32);
            Vec2.rotate(out, v, 0);
            expect(out.get()).toEqual([3, 4]);
        });
    });

    describe("angle", () => {
        test("calculates angle of positive x-axis", () => {
            const v = Vec2.create(F32, 1, 0);
            expect(Vec2.angle(v)).toBeCloseTo(0);
        });

        test("calculates angle of positive y-axis", () => {
            const v = Vec2.create(F32, 0, 1);
            expect(Vec2.angle(v)).toBeCloseTo(Math.PI / 2);
        });

        test("calculates angle of negative x-axis", () => {
            const v = Vec2.create(F32, -1, 0);
            expect(Vec2.angle(v)).toBeCloseTo(Math.PI);
        });

        test("calculates angle of 45 degree vector", () => {
            const v = Vec2.create(F32, 1, 1);
            expect(Vec2.angle(v)).toBeCloseTo(Math.PI / 4);
        });

        test("calculates angle of diagonal vector", () => {
            const v = Vec2.create(F32, 3, 4);
            expect(Vec2.angle(v)).toBeCloseTo(Math.atan2(4, 3));
        });
    });

    describe("equals", () => {
        test("equal vectors return true", () => {
            const a = Vec2.create(F32, 3, 4);
            const b = Vec2.create(F32, 3, 4);
            expect(Vec2.equals(a, b)).toBe(true);
        });

        test("different vectors return false", () => {
            const a = Vec2.create(F32, 3, 4);
            const b = Vec2.create(F32, 3, 5);
            expect(Vec2.equals(a, b)).toBe(false);
        });

        test("same vector equals itself", () => {
            const v = Vec2.create(F32, 3, 4);
            expect(Vec2.equals(v, v)).toBe(true);
        });
    });
});
