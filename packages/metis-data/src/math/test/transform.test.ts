import { describe, expect, test } from "bun:test";
import { F32, Mat, Mat3, Mat4, PackingType, Vec2, Vec3, Vec4, allocate } from "metis-data";

const close = (a: number, b: number, eps = 1e-5) => Math.abs(a - b) < eps;

describe("Vec3.transformMat4", () => {
    test("applies translation to a point", () => {
        const m = Mat4.translation(F32, 10, 20, 30);
        const out = Vec3.create(F32);
        Vec3.transformMat4(out, Vec3.create(F32, 1, 2, 3), m);
        expect(out.get()).toEqual([11, 22, 33]);
    });

    test("applies scale then translation in TRS order", () => {
        const m = Mat4.translation(F32, 1, 0, 0);
        Mat4.scaleMatrix(m, m, 2, 2, 2);
        const out = Vec3.create(F32);
        Vec3.transformMat4(out, Vec3.create(F32, 3, 0, 0), m);
        // scale first, then translate: 3*2 + 1
        expect(out.getComponent(0)).toBe(7);
    });

    test("divides by w through a projection matrix", () => {
        // Under perspective, w = -viewZ, so a point at z = -2 must come back
        // halved relative to the same point at z = -1. This is the case that
        // separates a real homogeneous transform from a naive affine one.
        const proj = Mat4.perspective(F32, Math.PI / 2, 1, 0.1, 100);
        const near = Vec3.create(F32);
        const far = Vec3.create(F32);
        Vec3.transformMat4(near, Vec3.create(F32, 1, 0, -1), proj);
        Vec3.transformMat4(far, Vec3.create(F32, 1, 0, -2), proj);
        expect(close(far.getComponent(0), near.getComponent(0) / 2)).toBe(true);
    });

    test("treats w == 0 as 1 rather than producing Infinity", () => {
        // A matrix that zeroes w: every row 4 entry is 0.
        const m = Mat4.create(F32, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0);
        const out = Vec3.create(F32);
        Vec3.transformMat4(out, Vec3.create(F32, 1, 2, 3), m);
        expect(out.get().every(Number.isFinite)).toBe(true);
        expect(out.get()).toEqual([1, 2, 3]);
    });

    test("round-trips through a matrix and its inverse", () => {
        const m = Mat4.lookAt(
            F32,
            Vec3.create(F32, 3, 4, 5),
            Vec3.create(F32, 0, 0, 0),
            Vec3.create(F32, 0, 1, 0),
        );
        const inv = Mat4.create(F32);
        Mat4.invert(inv, m);

        const src = Vec3.create(F32, 1.5, -2.25, 7);
        const mid = Vec3.create(F32);
        const back = Vec3.create(F32);
        Vec3.transformMat4(mid, src, m);
        Vec3.transformMat4(back, mid, inv);

        for (let i = 0; i < 3; i++) {
            expect(close(back.getComponent(i), src.getComponent(i), 1e-4)).toBe(true);
        }
    });

    test("aliasing out and v is safe", () => {
        const m = Mat4.translation(F32, 1, 2, 3);
        const v = Vec3.create(F32, 10, 10, 10);
        Vec3.transformMat4(v, v, m);
        expect(v.get()).toEqual([11, 12, 13]);
    });
});

describe("Vec3.transformMat3 / transformMat4Upper3x3", () => {
    test("transformMat4Upper3x3 ignores the translation column", () => {
        const m = Mat4.translation(F32, 100, 200, 300);
        const out = Vec3.create(F32);
        Vec3.transformMat4Upper3x3(out, Vec3.create(F32, 1, 2, 3), m);
        expect(out.get()).toEqual([1, 2, 3]);
    });

    test("transformMat3 applies a linear map", () => {
        // Column-major: scale x by 2, y by 3, z by 4.
        const m = Mat(F32, 3);
        const buf = allocate(m);
        buf.set(0, [2, 0, 0]);
        buf.set(1, [0, 3, 0]);
        buf.set(2, [0, 0, 4]);
        const out = Vec3.create(F32);
        Vec3.transformMat3(out, Vec3.create(F32, 1, 1, 1), buf);
        expect(out.get()).toEqual([2, 3, 4]);
    });

    test("respects Std140 padded columns", () => {
        // A Std140 Mat3 pads each column to 16 bytes (4 floats), so the stride
        // between columns is 4 elements, not 3. Hardcoding 3 reads the wrong
        // components here and nowhere else — which is exactly why this case
        // gets its own test.
        const desc = Mat(F32, 3, PackingType.Std140);
        expect(desc.columnStride).toBe(16);

        const buf = allocate(desc);
        buf.set(0, [2, 0, 0]);
        buf.set(1, [0, 3, 0]);
        buf.set(2, [0, 0, 4]);
        expect(buf.columnElements).toBe(4);

        const out = Vec3.create(F32);
        Vec3.transformMat3(out, Vec3.create(F32, 1, 1, 1), buf);
        expect(out.get()).toEqual([2, 3, 4]);
    });
});

describe("Vec4.transformMat4", () => {
    test("does not divide by w", () => {
        const proj = Mat4.perspective(F32, Math.PI / 2, 1, 0.1, 100);
        const out = Vec4.create(F32);
        Vec4.transformMat4(out, Vec4.create(F32, 0, 0, -5, 1), proj);
        // w should be the un-divided homogeneous coordinate (+5 for view z=-5).
        expect(close(out.getComponent(3), 5)).toBe(true);
    });

    test("w = 0 transforms as a direction (no translation)", () => {
        const m = Mat4.translation(F32, 100, 200, 300);
        const out = Vec4.create(F32);
        Vec4.transformMat4(out, Vec4.create(F32, 1, 2, 3, 0), m);
        expect(out.get()).toEqual([1, 2, 3, 0]);
    });

    test("agrees with Vec3.transformMat4 after the divide", () => {
        const proj = Mat4.perspective(F32, Math.PI / 3, 16 / 9, 0.1, 1000);
        const v4 = Vec4.create(F32);
        Vec4.transformMat4(v4, Vec4.create(F32, 2, -1, -8, 1), proj);
        const v3 = Vec3.create(F32);
        Vec3.transformMat4(v3, Vec3.create(F32, 2, -1, -8), proj);

        const w = v4.getComponent(3);
        for (let i = 0; i < 3; i++) {
            expect(close(v3.getComponent(i), v4.getComponent(i) / w)).toBe(true);
        }
    });
});

describe("Vec2 transforms", () => {
    test("transformMat3 applies a 2D translation", () => {
        const m = Mat3.translation(F32, 5, -3);
        const out = Vec2.create(F32);
        Vec2.transformMat3(out, Vec2.create(F32, 1, 1), m);
        expect(out.get()).toEqual([6, -2]);
    });

    test("transformMat3 applies a 2D rotation", () => {
        const m = Mat3.rotation(F32, Math.PI / 2);
        const out = Vec2.create(F32);
        Vec2.transformMat3(out, Vec2.create(F32, 1, 0), m);
        expect(close(out.getComponent(0), 0)).toBe(true);
        expect(close(out.getComponent(1), 1)).toBe(true);
    });

    test("transformMat2 ignores translation by construction", () => {
        const desc = Mat(F32, 2);
        const m = allocate(desc);
        m.set(0, [0, 1]);
        m.set(1, [-1, 0]);
        const out = Vec2.create(F32);
        Vec2.transformMat2(out, Vec2.create(F32, 1, 0), m);
        expect(close(out.getComponent(0), 0)).toBe(true);
        expect(close(out.getComponent(1), 1)).toBe(true);
    });
});
