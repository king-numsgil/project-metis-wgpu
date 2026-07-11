import { describe, expect, test } from "bun:test";
import { F32 } from "metis-data";
import { Mat4 } from "../mat4.ts";
import { Quat } from "../quat.ts";
import { Vec3 } from "../vec3.ts";

describe("Quat", () => {
    describe("identity", () => {
        test("creates identity quaternion", () => {
            const q = Quat.identity();
            expect(q.get()).toEqual([0, 0, 0, 1]);
        });

        test("identity quaternion has length 1", () => {
            const q = Quat.identity();
            expect(Quat.length(q)).toBe(1);
        });
    });

    describe("create", () => {
        test("creates zero quaternion with default w=1", () => {
            const q = Quat.create();
            expect(q.get()).toEqual([0, 0, 0, 1]);
        });

        test("creates quaternion with custom values", () => {
            const q = Quat.create(undefined, 1, 2, 3, 4);
            expect(q.get()).toEqual([1, 2, 3, 4]);
        });

        test("creates quaternion with negative values", () => {
            const q = Quat.create(undefined, -1, -2, -3, -4);
            expect(q.get()).toEqual([-1, -2, -3, -4]);
        });
    });

    describe("clone", () => {
        test("clones a quaternion", () => {
            const q = Quat.create(undefined, 1, 2, 3, 4);
            const cloned = Quat.clone(q);
            expect(cloned.get()).toEqual([1, 2, 3, 4]);
            expect(cloned).not.toBe(q);
        });

        test("clone is independent of original", () => {
            const q = Quat.create(undefined, 1, 2, 3, 4);
            const cloned = Quat.clone(q);
            Quat.set(q, 10, 20, 30, 40);
            expect(cloned.get()).toEqual([1, 2, 3, 4]);
            expect(q.get()).toEqual([10, 20, 30, 40]);
        });
    });

    describe("copy", () => {
        test("copies values from one quaternion to another", () => {
            const a = Quat.create(undefined, 1, 2, 3, 4);
            const b = Quat.create();
            Quat.copy(b, a);
            expect(b.get()).toEqual([1, 2, 3, 4]);
        });

        test("copy modifies the destination", () => {
            const a = Quat.create(undefined, 10, 20, 30, 40);
            const b = Quat.create(undefined, 5, 5, 5, 5);
            Quat.copy(b, a);
            expect(a.get()).toEqual([10, 20, 30, 40]);
            expect(b.get()).toEqual([10, 20, 30, 40]);
        });
    });

    describe("setIdentity", () => {
        test("sets quaternion to identity", () => {
            const q = Quat.create(undefined, 1, 2, 3, 4);
            Quat.setIdentity(q);
            expect(q.get()).toEqual([0, 0, 0, 1]);
        });
    });

    describe("set", () => {
        test("sets quaternion components", () => {
            const q = Quat.create();
            Quat.set(q, 1, 2, 3, 4);
            expect(q.get()).toEqual([1, 2, 3, 4]);
        });

        test("set can override existing values", () => {
            const q = Quat.create(undefined, 1, 2, 3, 4);
            Quat.set(q, 99, 100, 101, 102);
            expect(q.get()).toEqual([99, 100, 101, 102]);
        });
    });

    describe("fromAxisAngle", () => {
        test("creates 90 degree rotation around z-axis", () => {
            const axis = Vec3.create(F32, 0, 0, 1);
            const q = Quat.create();
            Quat.fromAxisAngle(q, axis, Math.PI / 2);
            expect(q.get()[0]).toBeCloseTo(0);
            expect(q.get()[1]).toBeCloseTo(0);
            expect(q.get()[2]).toBeCloseTo(Math.SQRT1_2);
            expect(q.get()[3]).toBeCloseTo(Math.SQRT1_2);
        });

        test("creates 180 degree rotation around x-axis", () => {
            const axis = Vec3.create(F32, 1, 0, 0);
            const q = Quat.create();
            Quat.fromAxisAngle(q, axis, Math.PI);
            expect(q.get()[0]).toBeCloseTo(1);
            expect(q.get()[1]).toBeCloseTo(0);
            expect(q.get()[2]).toBeCloseTo(0);
            expect(q.get()[3]).toBeCloseTo(0);
        });

        test("zero rotation gives identity quaternion", () => {
            const axis = Vec3.create(F32, 1, 0, 0);
            const q = Quat.create();
            Quat.fromAxisAngle(q, axis, 0);
            expect(q.get()).toEqual([0, 0, 0, 1]);
        });
    });

    describe("toAxisAngle", () => {
        test("extracts axis and angle from quaternion", () => {
            const axis = Vec3.create(F32, 0, 0, 1);
            const q = Quat.create();
            Quat.fromAxisAngle(q, axis, Math.PI / 2);
            const outAxis = Vec3.create(F32);
            const angle = Quat.toAxisAngle(q, outAxis);
            expect(angle).toBeCloseTo(Math.PI / 2);
            expect(outAxis.get()[0]).toBeCloseTo(0);
            expect(outAxis.get()[1]).toBeCloseTo(0);
            expect(outAxis.get()[2]).toBeCloseTo(1);
        });
    });

    describe("fromEuler", () => {
        test("creates quaternion from zero Euler angles", () => {
            const q = Quat.create();
            Quat.fromEuler(q, 0, 0, 0);
            expect(q.get()).toEqual([0, 0, 0, 1]);
        });

        test("creates quaternion from 90 degree rotation around z", () => {
            const q = Quat.create();
            Quat.fromEuler(q, 0, 0, Math.PI / 2);
            expect(Quat.length(q)).toBeCloseTo(1);
        });
    });

    describe("multiply", () => {
        test("multiplies two quaternions", () => {
            const a = Quat.create(undefined, 1, 0, 0, 0);
            const b = Quat.create(undefined, 0, 1, 0, 0);
            const out = Quat.create();
            Quat.multiply(out, a, b);
            expect(Quat.length(out)).toBeCloseTo(1);
        });

        test("multiplying by identity leaves quaternion unchanged", () => {
            const q = Quat.create(undefined, 1, 2, 3, 4);
            const identity = Quat.identity();
            const out = Quat.create();
            Quat.multiply(out, q, identity);
            expect(out.get()[0]).toBeCloseTo(1);
            expect(out.get()[1]).toBeCloseTo(2);
            expect(out.get()[2]).toBeCloseTo(3);
            expect(out.get()[3]).toBeCloseTo(4);
        });

        test("multiplication is associative", () => {
            const a = Quat.create(undefined, 1, 0, 0, 0);
            const b = Quat.create(undefined, 0, 1, 0, 0);
            const c = Quat.create(undefined, 0, 0, 1, 0);
            const ab = Quat.create();
            const bc = Quat.create();
            const result1 = Quat.create();
            const result2 = Quat.create();
            Quat.multiply(ab, a, b);
            Quat.multiply(result1, ab, c);
            Quat.multiply(bc, b, c);
            Quat.multiply(result2, a, bc);
            expect(result1.get()[0]).toBeCloseTo(result2.get()[0]);
            expect(result1.get()[1]).toBeCloseTo(result2.get()[1]);
            expect(result1.get()[2]).toBeCloseTo(result2.get()[2]);
            expect(result1.get()[3]).toBeCloseTo(result2.get()[3]);
        });
    });

    describe("rotate", () => {
        test("rotate is same as multiply", () => {
            const a = Quat.create(undefined, 1, 0, 0, 0);
            const b = Quat.create(undefined, 0, 1, 0, 0);
            const out1 = Quat.create();
            const out2 = Quat.create();
            Quat.rotate(out1, a, b);
            Quat.multiply(out2, a, b);
            expect(out1.get()).toEqual(out2.get());
        });
    });

    describe("rotateX", () => {
        test("rotates quaternion 90 degrees around x-axis", () => {
            const q = Quat.identity();
            const out = Quat.create();
            Quat.rotateX(out, q, Math.PI / 2);
            expect(Quat.length(out)).toBeCloseTo(1);
        });

        test("rotating identity by zero gives identity", () => {
            const q = Quat.identity();
            const out = Quat.create();
            Quat.rotateX(out, q, 0);
            expect(out.get()).toEqual([0, 0, 0, 1]);
        });
    });

    describe("rotateY", () => {
        test("rotates quaternion 90 degrees around y-axis", () => {
            const q = Quat.identity();
            const out = Quat.create();
            Quat.rotateY(out, q, Math.PI / 2);
            expect(Quat.length(out)).toBeCloseTo(1);
        });
    });

    describe("rotateZ", () => {
        test("rotates quaternion 90 degrees around z-axis", () => {
            const q = Quat.identity();
            const out = Quat.create();
            Quat.rotateZ(out, q, Math.PI / 2);
            expect(Quat.length(out)).toBeCloseTo(1);
        });
    });

    describe("dot", () => {
        test("calculates dot product", () => {
            const a = Quat.create(undefined, 1, 2, 3, 4);
            const b = Quat.create(undefined, 5, 6, 7, 8);
            expect(Quat.dot(a, b)).toBe(70);
        });

        test("dot product of identical normalized quaternions is 1", () => {
            const a = Quat.create(undefined, 1, 0, 0, 0);
            const b = Quat.create(undefined, 1, 0, 0, 0);
            expect(Quat.dot(a, b)).toBe(1);
        });
    });

    describe("length", () => {
        test("calculates length of unit quaternion", () => {
            const q = Quat.identity();
            expect(Quat.length(q)).toBe(1);
        });

        test("calculates length of quaternion", () => {
            const q = Quat.create(undefined, 1, 0, 0, 0);
            expect(Quat.length(q)).toBe(1);
        });

        test("length of zero quaternion is 0", () => {
            const q = Quat.create(undefined, 0, 0, 0, 0);
            expect(Quat.length(q)).toBe(0);
        });
    });

    describe("lengthSquared", () => {
        test("calculates squared length", () => {
            const q = Quat.create(undefined, 1, 0, 0, 0);
            expect(Quat.lengthSquared(q)).toBe(1);
        });

        test("squared length of identity is 1", () => {
            const q = Quat.identity();
            expect(Quat.lengthSquared(q)).toBe(1);
        });
    });

    describe("normalize", () => {
        test("normalizes a quaternion", () => {
            const q = Quat.create(undefined, 1, 2, 3, 4);
            const out = Quat.create();
            Quat.normalize(out, q);
            expect(Quat.length(out)).toBeCloseTo(1);
        });

        test("normalize unit quaternion remains unit", () => {
            const q = Quat.identity();
            const out = Quat.create();
            Quat.normalize(out, q);
            expect(out.get()).toEqual([0, 0, 0, 1]);
        });

        test("normalize zero quaternion gives zero quaternion", () => {
            const q = Quat.create(undefined, 0, 0, 0, 0);
            const out = Quat.create();
            Quat.normalize(out, q);
            expect(out.get()).toEqual([0, 0, 0, 0]);
        });
    });

    describe("conjugate", () => {
        test("calculates conjugate of quaternion", () => {
            const q = Quat.create(undefined, 1, 2, 3, 4);
            const out = Quat.create();
            Quat.conjugate(out, q);
            expect(out.get()).toEqual([-1, -2, -3, 4]);
        });

        test("conjugate of unit quaternion is its inverse", () => {
            const q = Quat.create(undefined, 0, Math.SQRT1_2, 0, Math.SQRT1_2);
            const conj = Quat.create();
            Quat.conjugate(conj, q);
            expect(Quat.length(conj)).toBeCloseTo(1);
        });

        test("double conjugate returns original", () => {
            const q = Quat.create(undefined, 1, 2, 3, 4);
            const out = Quat.create();
            Quat.conjugate(out, q);
            Quat.conjugate(out, out);
            expect(out.get()).toEqual([1, 2, 3, 4]);
        });
    });

    describe("invert", () => {
        test("calculates inverse of quaternion", () => {
            const q = Quat.create(undefined, 0, Math.SQRT1_2, 0, Math.SQRT1_2);
            const out = Quat.create();
            Quat.invert(out, q);
            expect(Quat.length(out)).toBeCloseTo(1);
        });

        test("multiplying quaternion by its inverse gives identity", () => {
            const q = Quat.create(undefined, 0, Math.SQRT1_2, 0, Math.SQRT1_2);
            const inv = Quat.create();
            const result = Quat.create();
            Quat.invert(inv, q);
            Quat.multiply(result, q, inv);
            expect(result.get()[0]).toBeCloseTo(0);
            expect(result.get()[1]).toBeCloseTo(0);
            expect(result.get()[2]).toBeCloseTo(0);
            expect(result.get()[3]).toBeCloseTo(1);
        });

        test("invert zero quaternion gives zero quaternion", () => {
            const q = Quat.create(undefined, 0, 0, 0, 0);
            const out = Quat.create();
            Quat.invert(out, q);
            expect(out.get()).toEqual([0, 0, 0, 0]);
        });
    });

    describe("slerp", () => {
        test("slerp at t=0 returns first quaternion", () => {
            const a = Quat.identity();
            const b = Quat.create(undefined, 0, 1, 0, 0);
            const out = Quat.create();
            Quat.slerp(out, a, b, 0);
            expect(out.get()).toEqual([0, 0, 0, 1]);
        });

        test("slerp at t=1 returns second quaternion", () => {
            const a = Quat.identity();
            const b = Quat.create(undefined, 0, 1, 0, 0);
            const out = Quat.create();
            Quat.slerp(out, a, b, 1);
            expect(out.get()[0]).toBeCloseTo(0);
            expect(out.get()[1]).toBeCloseTo(1);
            expect(out.get()[2]).toBeCloseTo(0);
            expect(out.get()[3]).toBeCloseTo(0);
        });

        test("slerp at t=0.5 gives intermediate rotation", () => {
            const a = Quat.identity();
            const b = Quat.create(undefined, 0, 1, 0, 0);
            const out = Quat.create();
            Quat.slerp(out, a, b, 0.5);
            expect(Quat.length(out)).toBeCloseTo(1);
        });

        test("slerp maintains constant angular velocity", () => {
            const a = Quat.identity();
            const b = Quat.create(undefined, 0, 0, 1, 0);
            const q1 = Quat.create();
            const q2 = Quat.create();
            Quat.slerp(q1, a, b, 0.25);
            Quat.slerp(q2, q1, b, 0.33);
            expect(Quat.length(q1)).toBeCloseTo(1);
            expect(Quat.length(q2)).toBeCloseTo(1);
        });
    });

    describe("lerp", () => {
        test("lerp at t=0 returns first quaternion", () => {
            const a = Quat.create(undefined, 1, 0, 0, 0);
            const b = Quat.create(undefined, 0, 1, 0, 0);
            const out = Quat.create();
            Quat.lerp(out, a, b, 0);
            expect(out.get()[0]).toBe(1);
            expect(out.get()[1]).toBe(0);
        });

        test("lerp at t=1 returns second quaternion", () => {
            const a = Quat.create(undefined, 1, 0, 0, 0);
            const b = Quat.create(undefined, 0, 1, 0, 0);
            const out = Quat.create();
            Quat.lerp(out, a, b, 1);
            expect(out.get()[0]).toBe(0);
            expect(out.get()[1]).toBe(1);
        });

        test("lerp at t=0.5 gives average", () => {
            const a = Quat.create(undefined, 1, 0, 0, 1);
            const b = Quat.create(undefined, 0, 1, 0, 1);
            const out = Quat.create();
            Quat.lerp(out, a, b, 0.5);
            expect(out.get()[0]).toBeCloseTo(0.5);
            expect(out.get()[1]).toBeCloseTo(0.5);
        });
    });

    describe("fromRotationTo", () => {
        test("creates rotation from x-axis to y-axis", () => {
            const from = Vec3.create(F32, 1, 0, 0);
            const to = Vec3.create(F32, 0, 1, 0);
            const out = Quat.create();
            Quat.fromRotationTo(out, from, to);
            expect(Quat.length(out)).toBeCloseTo(1);
        });

        test("parallel vectors give identity quaternion", () => {
            const from = Vec3.create(F32, 1, 0, 0);
            const to = Vec3.create(F32, 1, 0, 0);
            const out = Quat.create();
            Quat.fromRotationTo(out, from, to);
            expect(out.get()).toEqual([0, 0, 0, 1]);
        });
    });

    describe("getAngle", () => {
        test("gets angle of identity quaternion", () => {
            const q = Quat.identity();
            expect(Quat.getAngle(q)).toBe(0);
        });

        test("gets angle of 180 degree rotation", () => {
            const q = Quat.create(undefined, 1, 0, 0, 0);
            expect(Quat.getAngle(q)).toBeCloseTo(Math.PI);
        });
    });

    describe("equals", () => {
        test("equal quaternions return true", () => {
            const a = Quat.create(undefined, 1, 2, 3, 4);
            const b = Quat.create(undefined, 1, 2, 3, 4);
            expect(Quat.equals(a, b)).toBe(true);
        });

        test("different quaternions return false", () => {
            const a = Quat.create(undefined, 1, 2, 3, 4);
            const b = Quat.create(undefined, 1, 2, 3, 5);
            expect(Quat.equals(a, b)).toBe(false);
        });

        test("same quaternion equals itself", () => {
            const q = Quat.create(undefined, 1, 2, 3, 4);
            expect(Quat.equals(q, q)).toBe(true);
        });
    });

    describe("Matrix conversions", () => {
        test("quaternion to matrix and back", () => {
            const q = Quat.create(undefined, 0.5, 0.5, 0.5, 0.5);
            const m = Mat4.create();
            Mat4.rotation(m, q);
            const q2 = Quat.create();
            Mat4.toQuat(q2, m);
            expect(Math.abs(Math.abs(q.get()[0]) - Math.abs(q2.get()[0]))).toBeLessThan(0.01);
            expect(Math.abs(Math.abs(q.get()[1]) - Math.abs(q2.get()[1]))).toBeLessThan(0.01);
            expect(Math.abs(Math.abs(q.get()[2]) - Math.abs(q2.get()[2]))).toBeLessThan(0.01);
            expect(Math.abs(Math.abs(q.get()[3]) - Math.abs(q2.get()[3]))).toBeLessThan(0.01);
        });
    });
});
