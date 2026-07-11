import { describe, expect, test } from "bun:test";
import { F32 } from "metis-data";
import { Mat3 } from "../mat3.ts";
import { Mat4 } from "../mat4.ts";
import { Quat } from "../quat.ts";
import { Vec3 } from "../vec3.ts";

describe("Mat4", () => {
    describe("create", () => {
        test("creates identity matrix with no arguments", () => {
            const m = Mat4.create();
            expect(m.get(0)).toEqual([1, 0, 0, 0]);
            expect(m.get(1)).toEqual([0, 1, 0, 0]);
            expect(m.get(2)).toEqual([0, 0, 1, 0]);
            expect(m.get(3)).toEqual([0, 0, 0, 1]);
        });

        test("creates matrix with custom values", () => {
            const m = Mat4.create(F32, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
            expect(m.get(0)).toEqual([1, 2, 3, 4]);
            expect(m.get(1)).toEqual([5, 6, 7, 8]);
            expect(m.get(2)).toEqual([9, 10, 11, 12]);
            expect(m.get(3)).toEqual([13, 14, 15, 16]);
        });

        test("creates matrix with negative values", () => {
            const m = Mat4.create(F32, -1, -2, -3, -4, -5, -6, -7, -8, -9, -10, -11, -12, -13, -14, -15, -16);
            expect(m.get(0)).toEqual([-1, -2, -3, -4]);
        });
    });

    describe("clone", () => {
        test("clones a matrix", () => {
            const m = Mat4.create(F32, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
            const cloned = Mat4.clone(m);
            expect(cloned.get(0)).toEqual([1, 2, 3, 4]);
            expect(cloned).not.toBe(m);
        });

        test("clone is independent of original", () => {
            const m = Mat4.create(F32, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
            const cloned = Mat4.clone(m);
            Mat4.set(m, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2);
            expect(cloned.get(0)).toEqual([1, 0, 0, 0]);
        });
    });

    describe("copy", () => {
        test("copies values from one matrix to another", () => {
            const a = Mat4.create(F32, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
            const b = Mat4.create(F32);
            Mat4.copy(b, a);
            expect(b.get(3)).toEqual([13, 14, 15, 16]);
        });
    });

    describe("set", () => {
        test("sets matrix components", () => {
            const m = Mat4.create(F32);
            Mat4.set(m, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
            expect(m.get(3)).toEqual([13, 14, 15, 16]);
        });
    });

    describe("identity", () => {
        test("creates identity matrix", () => {
            const m = Mat4.identity();
            expect(m.get(0)).toEqual([1, 0, 0, 0]);
            expect(m.get(3)).toEqual([0, 0, 0, 1]);
        });

        test("identity matrix has determinant 1", () => {
            const m = Mat4.identity();
            expect(Mat4.determinant(m)).toBe(1);
        });
    });

    describe("add", () => {
        test("adds two matrices", () => {
            const a = Mat4.identity();
            const b = Mat4.create(F32, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
            const out = Mat4.create(F32);
            Mat4.add(out, a, b);
            expect(out.get(0)).toEqual([2, 2, 3, 4]);
            expect(out.get(3)).toEqual([13, 14, 15, 17]);
        });
    });

    describe("subtract", () => {
        test("subtracts two matrices", () => {
            const a = Mat4.create(F32, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17);
            const b = Mat4.identity();
            const out = Mat4.create(F32);
            Mat4.subtract(out, a, b);
            expect(out.get(0)).toEqual([1, 3, 4, 5]);
        });
    });

    describe("multiply", () => {
        test("multiplies two matrices", () => {
            const a = Mat4.identity();
            const b = Mat4.create(F32, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2);
            const out = Mat4.create(F32);
            Mat4.multiply(out, a, b);
            expect(out.get(0)).toEqual([2, 0, 0, 0]);
            expect(out.get(3)).toEqual([0, 0, 0, 2]);
        });

        test("multiplying by identity leaves unchanged", () => {
            const m = Mat4.create(F32, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
            const identity = Mat4.identity();
            const out = Mat4.create(F32);
            Mat4.multiply(out, m, identity);
            expect(out.get(0)).toEqual([1, 2, 3, 4]);
        });
    });

    describe("scale", () => {
        test("scales matrix by scalar", () => {
            const m = Mat4.identity();
            const out = Mat4.create(F32);
            Mat4.scale(out, m, 2);
            expect(out.get(0)).toEqual([2, 0, 0, 0]);
            expect(out.get(3)).toEqual([0, 0, 0, 2]);
        });

        test("scale by zero gives zero matrix", () => {
            const m = Mat4.identity();
            const out = Mat4.create(F32);
            Mat4.scale(out, m, 0);
            expect(out.get(0)).toEqual([0, 0, 0, 0]);
        });
    });

    describe("determinant", () => {
        test("calculates determinant of identity", () => {
            const m = Mat4.identity();
            expect(Mat4.determinant(m)).toBe(1);
        });

        test("determinant of zero matrix is 0", () => {
            const m = Mat4.create(F32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
            expect(Mat4.determinant(m)).toBe(0);
        });

        test("determinant of scaling matrix", () => {
            const m = Mat4.create(F32, 2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 5);
            expect(Mat4.determinant(m)).toBe(120);
        });
    });

    describe("invert", () => {
        test("inverts identity matrix", () => {
            const m = Mat4.identity();
            const out = Mat4.create(F32);
            Mat4.invert(out, m);
            expect(out.get(0)).toEqual([1, 0, 0, 0]);
        });

        test("singular matrix inverts to zero matrix", () => {
            const m = Mat4.create(F32, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
            const out = Mat4.create(F32);
            Mat4.invert(out, m);
            expect(out.get(0)).toEqual([0, 0, 0, 0]);
        });

        test("inverts scaling matrix", () => {
            const m = Mat4.create(F32, 2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 5);
            const out = Mat4.create(F32);
            Mat4.invert(out, m);
            expect(out.get(0)[0]).toBeCloseTo(0.5);
            expect(out.get(1)[1]).toBeCloseTo(1 / 3);
            expect(out.get(2)[2]).toBeCloseTo(0.25);
            expect(out.get(3)[3]).toBeCloseTo(0.2);
        });

        test("multiplying by inverse gives identity", () => {
            const m = Mat4.create(F32, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2);
            const inv = Mat4.create(F32);
            const result = Mat4.create(F32);
            Mat4.invert(inv, m);
            Mat4.multiply(result, m, inv);
            expect(result.get(0)[0]).toBeCloseTo(1);
            expect(result.get(1)[1]).toBeCloseTo(1);
        });
    });

    describe("transpose", () => {
        test("transposes a matrix", () => {
            const m = Mat4.create(F32, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
            const out = Mat4.create(F32);
            Mat4.transpose(out, m);
            expect(out.get(0)).toEqual([1, 5, 9, 13]);
            expect(out.get(3)).toEqual([4, 8, 12, 16]);
        });

        test("transpose of identity is itself", () => {
            const m = Mat4.identity();
            const t = Mat4.create(F32);
            Mat4.transpose(t, m);
            expect(t.get(0)).toEqual([1, 0, 0, 0]);
        });

        test("double transpose returns original", () => {
            const m = Mat4.create(F32, 1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4);
            const out = Mat4.create(F32);
            Mat4.transpose(out, m);
            Mat4.transpose(out, out);
            expect(out.get(0)).toEqual([1, 0, 0, 0]);
        });
    });

    describe("equals", () => {
        test("equal matrices return true", () => {
            const a = Mat4.identity();
            const b = Mat4.identity();
            expect(Mat4.equals(a, b)).toBe(true);
        });

        test("different matrices return false", () => {
            const a = Mat4.identity();
            const b = Mat4.create(F32, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2);
            expect(Mat4.equals(a, b)).toBe(false);
        });

        test("same matrix equals itself", () => {
            const m = Mat4.identity();
            expect(Mat4.equals(m, m)).toBe(true);
        });
    });

    describe("translation", () => {
        test("creates translation matrix", () => {
            const m = Mat4.translation(F32, 5, 10, 15);
            expect(m.get(0)).toEqual([1, 0, 0, 0]);
            expect(m.get(1)).toEqual([0, 1, 0, 0]);
            expect(m.get(2)).toEqual([0, 0, 1, 0]);
            expect(m.get(3)).toEqual([5, 10, 15, 1]);
        });

        test("zero translation is identity", () => {
            const m = Mat4.translation(F32, 0, 0, 0);
            expect(m.get(0)).toEqual([1, 0, 0, 0]);
            expect(m.get(3)).toEqual([0, 0, 0, 1]);
        });
    });

    describe("rotation", () => {
        test("creates rotation matrix from quaternion", () => {
            const q = Quat.create(undefined, 0, 0, 0, 1);
            const m = Mat4.identity();
            Mat4.rotation(m, q);
            expect(m.get(0)).toEqual([1, 0, 0, 0]);
            expect(m.get(3)).toEqual([0, 0, 0, 1]);
        });

        test("90 degree rotation around z-axis", () => {
            const q = Quat.create(undefined, 0, 0, Math.SQRT1_2, Math.SQRT1_2);
            const m = Mat4.identity();
            Mat4.rotation(m, q);
            expect(m.get(0)[0]).toBeCloseTo(0);
            expect(m.get(0)[1]).toBeCloseTo(1);
            expect(m.get(1)[0]).toBeCloseTo(-1);
            expect(m.get(1)[1]).toBeCloseTo(0);
        });
    });

    describe("fromAxisAngle", () => {
        test("creates rotation from axis and angle", () => {
            const axis = Vec3.create(F32, 0, 0, 1);
            const m = Mat4.fromAxisAngle(F32, axis, Math.PI / 2);
            expect(m.get(0)[0]).toBeCloseTo(0);
            expect(m.get(0)[1]).toBeCloseTo(1);
        });
    });

    describe("fromEuler", () => {
        test("creates rotation from Euler angles", () => {
            const m = Mat4.fromEuler(F32, 0, 0, Math.PI / 2);
            expect(m.get(0)[0]).toBeCloseTo(0);
            expect(m.get(0)[1]).toBeCloseTo(1);
        });

        test("zero Euler angles give identity", () => {
            const m = Mat4.fromEuler(F32, 0, 0, 0);
            expect(Mat4.equals(m, Mat4.identity())).toBe(true);
        });
    });

    describe("scaling", () => {
        test("creates scaling matrix", () => {
            const m = Mat4.scaling(F32, 2, 3, 4);
            expect(m.get(0)).toEqual([2, 0, 0, 0]);
            expect(m.get(1)).toEqual([0, 3, 0, 0]);
            expect(m.get(2)).toEqual([0, 0, 4, 0]);
            expect(m.get(3)).toEqual([0, 0, 0, 1]);
        });

        test("uniform scaling", () => {
            const m = Mat4.uniformScaling(F32, 2);
            expect(m.get(0)).toEqual([2, 0, 0, 0]);
            expect(m.get(1)).toEqual([0, 2, 0, 0]);
            expect(m.get(2)).toEqual([0, 0, 2, 0]);
            expect(m.get(3)).toEqual([0, 0, 0, 1]);
        });
    });

    describe("lookAt", () => {
        test("creates look-at matrix", () => {
            const eye = Vec3.create(F32, 0, 0, 5);
            const center = Vec3.create(F32, 0, 0, 0);
            const up = Vec3.create(F32, 0, 1, 0);
            const m = Mat4.lookAt(F32, eye, center, up);
            expect(m.get(0)[0]).toBeCloseTo(1);
            expect(m.get(3)).toBeDefined();
        });

        test("look-at with standard forward", () => {
            const eye = Vec3.create(F32, 0, 0, 0);
            const center = Vec3.create(F32, 0, 0, -1);
            const up = Vec3.create(F32, 0, 1, 0);
            const m = Mat4.lookAt(F32, eye, center, up);
            expect(m.get(0)[0]).toBeCloseTo(1);
            expect(m.get(1)[1]).toBeCloseTo(1);
        });
    });

    describe("perspective (WebGPU, z in [0,1])", () => {
        test("maps near plane to 0 and far plane to 1 (NOT -1..1 like OpenGL)", () => {
            const m = Mat4.perspective(F32, Math.PI / 3, 1.5, 0.1, 100);
            const c2 = m.get(2), c3 = m.get(3);
            const ndcZ = (vz: number) => (c2[2]! * vz + c3[2]!) / (c2[3]! * vz);
            expect(ndcZ(-0.1)).toBeCloseTo(0, 5); // near -> 0
            expect(ndcZ(-100)).toBeCloseTo(1, 5); // far  -> 1
            expect(m.get(2)[3]).toBe(-1); // clip.w = -view.z
        });

        test("focal length and aspect scaling", () => {
            const m = Mat4.perspective(F32, Math.PI / 2, 2, 0.1, 100);
            const f = 1 / Math.tan(Math.PI / 4); // 1
            expect(m.get(1)[1]).toBeCloseTo(f);
            expect(m.get(0)[0]).toBeCloseTo(f / 2); // divided by aspect
        });

        test("infinite far plane maps near->0 and infinity->1", () => {
            const m = Mat4.perspective(F32, Math.PI / 3, 1.5, 0.1, Infinity);
            const c2 = m.get(2), c3 = m.get(3);
            const ndcZ = (vz: number) => (c2[2]! * vz + c3[2]!) / (c2[3]! * vz);
            expect(ndcZ(-0.1)).toBeCloseTo(0, 5);
            expect(ndcZ(-1e9)).toBeCloseTo(1, 4);
            expect(Number.isFinite(m.get(2)[2]!)).toBe(true);
        });
    });

    describe("perspectiveReverseZ (near->1, far->0)", () => {
        const ndcZ = (m: ReturnType<typeof Mat4.perspectiveReverseZ>, vz: number) => {
            const c2 = m.get(2), c3 = m.get(3);
            return (c2[2]! * vz + c3[2]!) / (c2[3]! * vz);
        };

        test("infinite far (default) maps near->1 and infinity->0", () => {
            const m = Mat4.perspectiveReverseZ(F32, Math.PI / 3, 1.5, 0.1);
            expect(ndcZ(m, -0.1)).toBeCloseTo(1, 5);
            expect(ndcZ(m, -1e9)).toBeCloseTo(0, 5);
            expect(m.get(2)[3]).toBe(-1);
        });

        test("finite far maps near->1 and far->0", () => {
            const m = Mat4.perspectiveReverseZ(F32, Math.PI / 3, 1.5, 0.1, 100);
            expect(ndcZ(m, -0.1)).toBeCloseTo(1, 5);
            expect(ndcZ(m, -100)).toBeCloseTo(0, 5);
        });

        test("depth increases toward the camera (reverse of standard)", () => {
            const m = Mat4.perspectiveReverseZ(F32, Math.PI / 3, 1.5, 0.1);
            expect(ndcZ(m, -1)).toBeGreaterThan(ndcZ(m, -10));
        });
    });

    describe("orthographic (WebGPU, z in [0,1])", () => {
        test("maps near plane to 0 and far plane to 1 (NOT -1..1 like OpenGL)", () => {
            const m = Mat4.orthographic(F32, -1, 1, -1, 1, 0.1, 100);
            const c2 = m.get(2), c3 = m.get(3);
            const ndcZ = (vz: number) => c2[2]! * vz + c3[2]!; // w = 1
            expect(ndcZ(-0.1)).toBeCloseTo(0, 5);
            expect(ndcZ(-100)).toBeCloseTo(1, 5);
            expect(m.get(3)[3]).toBe(1);
        });

        test("maps x/y extents to [-1, 1]", () => {
            const m = Mat4.orthographic(F32, -2, 2, -3, 3, 0.1, 100);
            const ndcX = (x: number) => m.get(0)[0]! * x + m.get(3)[0]!;
            const ndcY = (y: number) => m.get(1)[1]! * y + m.get(3)[1]!;
            expect(ndcX(-2)).toBeCloseTo(-1);
            expect(ndcX(2)).toBeCloseTo(1);
            expect(ndcY(-3)).toBeCloseTo(-1);
            expect(ndcY(3)).toBeCloseTo(1);
        });

        test("symmetric frustum has no x/y offset", () => {
            const m = Mat4.orthographic(F32, -10, 10, -10, 10, 1, 100);
            expect(m.get(3)[0]).toBeCloseTo(0);
            expect(m.get(3)[1]).toBeCloseTo(0);
        });
    });

    describe("translate", () => {
        test("translates a matrix", () => {
            const m = Mat4.identity();
            const out = Mat4.create(F32);
            Mat4.translate(out, m, 5, 10, 15);
            expect(out.get(3)).toEqual([5, 10, 15, 1]);
        });

        test("translate accumulates", () => {
            const m = Mat4.translation(F32, 1, 2, 3);
            const out = Mat4.create(F32);
            Mat4.translate(out, m, 3, 4, 5);
            expect(out.get(3)).toEqual([4, 6, 8, 1]);
        });
    });

    describe("rotate", () => {
        test("rotates a matrix", () => {
            const m = Mat4.identity();
            const q = Quat.create(undefined, 0, 0, Math.SQRT1_2, Math.SQRT1_2);
            const out = Mat4.create(F32);
            Mat4.rotate(out, m, q);
            expect(out.get(0)[0]).toBeCloseTo(0);
            expect(out.get(0)[1]).toBeCloseTo(1);
        });

        test("rotate accumulates", () => {
            const m = Mat4.rotation(Mat4.identity(), Quat.create(undefined, 0, 0, Math.SQRT1_2, Math.SQRT1_2));
            const q = Quat.create(undefined, 0, 0, Math.SQRT1_2, Math.SQRT1_2);
            const out = Mat4.create(F32);
            Mat4.rotate(out, m, q);
            expect(out.get(0)[0]).toBeCloseTo(-1);
        });
    });

    describe("scaleMatrix", () => {
        test("scales a matrix", () => {
            const m = Mat4.identity();
            const out = Mat4.create(F32);
            Mat4.scaleMatrix(out, m, 2, 3, 4);
            expect(out.get(0)).toEqual([2, 0, 0, 0]);
            expect(out.get(1)).toEqual([0, 3, 0, 0]);
            expect(out.get(2)).toEqual([0, 0, 4, 0]);
        });

        test("scale accumulates", () => {
            const m = Mat4.scaling(F32, 2, 3, 4);
            const out = Mat4.create(F32);
            Mat4.scaleMatrix(out, m, 2, 2, 2);
            expect(out.get(0)[0]).toBe(4);
            expect(out.get(1)[1]).toBe(6);
        });
    });

    describe("fromTRS", () => {
        test("creates matrix from TRS components", () => {
            const q = Quat.create(undefined, 0, 0, Math.SQRT1_2, Math.SQRT1_2);
            const m = Mat4.fromTRS(F32, 5, 10, 15, q, 2, 2, 2);
            expect(m.get(3)[0]).toBe(5);
            expect(m.get(3)[1]).toBe(10);
            expect(m.get(3)[2]).toBe(15);
        });
    });

    describe("decompose", () => {
        test("decomposes matrix into TRS components", () => {
            const q = Quat.create(undefined, 0, 0, 0, 1);
            const m = Mat4.fromTRS(F32, 5, 10, 15, q, 2, 3, 4);
            const outT = Vec3.create(F32);
            const outR = Quat.create();
            const outS = Vec3.create(F32);
            Mat4.decompose(m, outT, outR, outS);
            expect(outT.get()[0]).toBeCloseTo(5);
            expect(outT.get()[1]).toBeCloseTo(10);
            expect(outT.get()[2]).toBeCloseTo(15);
            expect(outS.get()[0]).toBeCloseTo(2);
            expect(outS.get()[1]).toBeCloseTo(3);
            expect(outS.get()[2]).toBeCloseTo(4);
        });

        test("decompose identity", () => {
            const m = Mat4.identity();
            const outT = Vec3.create(F32);
            const outR = Quat.create();
            const outS = Vec3.create(F32);
            Mat4.decompose(m, outT, outR, outS);
            expect(outT.get()).toEqual([0, 0, 0]);
            expect(outS.get()[0]).toBeCloseTo(1);
        });
    });

    describe("getTranslation", () => {
        test("extracts translation", () => {
            const m = Mat4.translation(F32, 5, 10, 15);
            const out = Vec3.create(F32);
            Mat4.getTranslation(out, m);
            expect(out.get()).toEqual([5, 10, 15]);
        });

        test("identity has zero translation", () => {
            const m = Mat4.identity();
            const out = Vec3.create(F32);
            Mat4.getTranslation(out, m);
            expect(out.get()).toEqual([0, 0, 0]);
        });
    });

    describe("getRotation", () => {
        test("extracts rotation quaternion", () => {
            const q = Quat.create(undefined, 0, 0, Math.SQRT1_2, Math.SQRT1_2);
            const m = Mat4.rotation(Mat4.identity(), q);
            const out = Quat.create();
            Mat4.getRotation(out, m);
            expect(Math.abs(out.get()[2])).toBeCloseTo(Math.SQRT1_2);
        });

        test("identity has zero rotation", () => {
            const m = Mat4.identity();
            const out = Quat.create();
            Mat4.getRotation(out, m);
            expect(out.get()[3]).toBeCloseTo(1);
        });
    });

    describe("getScale", () => {
        test("extracts scale", () => {
            const m = Mat4.scaling(F32, 2, 3, 4);
            const out = Vec3.create(F32);
            Mat4.getScale(out, m);
            expect(out.get()[0]).toBeCloseTo(2);
            expect(out.get()[1]).toBeCloseTo(3);
            expect(out.get()[2]).toBeCloseTo(4);
        });

        test("identity has unit scale", () => {
            const m = Mat4.identity();
            const out = Vec3.create(F32);
            Mat4.getScale(out, m);
            expect(out.get()[0]).toBeCloseTo(1);
            expect(out.get()[1]).toBeCloseTo(1);
            expect(out.get()[2]).toBeCloseTo(1);
        });
    });

    describe("getLinearTransform", () => {
        test("extracts linear transform", () => {
            const m = Mat4.scaling(F32, 2, 3, 4);
            const out = Mat3.create(F32);
            Mat4.getLinearTransform(out, m);
            expect(out.get(0)[0]).toBe(2);
            expect(out.get(1)[1]).toBe(3);
            expect(out.get(2)[2]).toBe(4);
        });
    });

    describe("toQuat", () => {
        test("converts rotation matrix to quaternion (signed — catches the conjugate bug)", () => {
            const q = Quat.create(undefined, 0, 0, Math.SQRT1_2, Math.SQRT1_2);
            const m = Mat4.rotation(Mat4.identity(), q);
            const out = Quat.create();
            Mat4.toQuat(out, m);
            const [x, y, z, w] = out.get();
            expect(x).toBeCloseTo(0);
            expect(y).toBeCloseTo(0);
            expect(z).toBeCloseTo(Math.SQRT1_2); // NOT -Math.SQRT1_2
            expect(w).toBeCloseTo(Math.SQRT1_2);
        });

        test("identity matrix gives identity quaternion", () => {
            const m = Mat4.identity();
            const out = Quat.create();
            Mat4.toQuat(out, m);
            expect(out.get()[0]).toBeCloseTo(0);
            expect(out.get()[1]).toBeCloseTo(0);
            expect(out.get()[2]).toBeCloseTo(0);
            expect(out.get()[3]).toBeCloseTo(1);
        });
    });

    describe("fromQuat", () => {
        test("round-trips a quaternion through its rotation matrix (signed)", () => {
            const q = Quat.create(undefined, 0.5, 0.5, 0.5, 0.5);
            const m = Mat4.fromQuat(Mat4.create(F32), q);
            const q2 = Quat.create();
            Mat4.toQuat(q2, m);
            const a = q.get(), b = q2.get();
            for (let i = 0; i < 4; i++) expect(b[i]!).toBeCloseTo(a[i]!);
        });
    });
});
