import { describe, expect, test } from "bun:test";
import { F16, F32, F64, I32, PackingType, U32, Vec } from "../index.ts";
import { GPU_VEC2, GPU_VEC3, GPU_VEC4 } from "../constants.ts";

const Dense = PackingType.Dense;
const Std140 = PackingType.Std140;

// layout.test.ts already pins the F32 std140 numbers that the vec3-size bug
// slipped through. This file covers the rest of the surface: the vec-type
// selector, dense packing across every N, and the std140 alignment `max()`
// branches that only fire for wider (F64) and narrower (F16) scalars.

describe("vec type selector and identity fields", () => {
    test("N maps to the right GPU vec type", () => {
        expect(Vec(F32, 2).type).toBe(GPU_VEC2);
        expect(Vec(F32, 3).type).toBe(GPU_VEC3);
        expect(Vec(F32, 4).type).toBe(GPU_VEC4);
    });

    test("scalar, length and packing are preserved", () => {
        const v = Vec(I32, 4, Std140);
        expect(v.scalar).toBe(I32);
        expect(v.length).toBe(4);
        expect(v.packing).toBe(Std140);
        expect(Vec(U32, 2).packing).toBe(Dense); // default packing
    });

    test("toString reads as vecN<scalar>", () => {
        expect(Vec(F32, 3).toString()).toBe("vec3<f32>");
        expect(Vec(F64, 2, Std140).toString()).toBe("vec2<f64>");
    });
});

describe("dense vec packing (scalar alignment, no padding)", () => {
    // [scalar, scalarSize]
    const scalars = [
        [F16, 2],
        [F32, 4],
        [F64, 8],
    ] as const;

    for (const [scalar, size] of scalars) {
        for (const n of [2, 3, 4] as const) {
            test(`vec${n}<${scalar.type}> dense`, () => {
                const v = Vec(scalar, n, Dense);
                expect(v.alignment).toBe(size);
                expect(v.byteSize).toBe(n * size);
                // dense pitch == size (already a scalar multiple, no rounding)
                expect(v.arrayPitch).toBe(n * size);
            });
        }
    }
});

describe("std140 vec alignment branches", () => {
    test("F64 widens the base alignment past the 8/16 floors", () => {
        // vec2 floor is max(8, 2*size); vec3/4 floor is max(16, 4*size).
        const v2 = Vec(F64, 2, Std140);
        expect([v2.byteSize, v2.alignment, v2.arrayPitch]).toEqual([16, 16, 16]);

        const v3 = Vec(F64, 3, Std140);
        expect([v3.byteSize, v3.alignment, v3.arrayPitch]).toEqual([24, 32, 32]);

        const v4 = Vec(F64, 4, Std140);
        expect([v4.byteSize, v4.alignment, v4.arrayPitch]).toEqual([32, 32, 32]);
    });

    test("F16 is clamped up to the 8/16 floors, not 2*/4* size", () => {
        const v2 = Vec(F16, 2, Std140);
        expect([v2.byteSize, v2.alignment, v2.arrayPitch]).toEqual([4, 8, 16]);

        const v3 = Vec(F16, 3, Std140);
        expect([v3.byteSize, v3.alignment, v3.arrayPitch]).toEqual([6, 16, 16]);

        const v4 = Vec(F16, 4, Std140);
        expect([v4.byteSize, v4.alignment, v4.arrayPitch]).toEqual([8, 16, 16]);
    });
});

describe("vec view()", () => {
    test("yields an N-length window of the scalar's TypedArray", () => {
        const buffer = new ArrayBuffer(64);
        const view = Vec(F32, 3).view(buffer, 16);
        expect(view).toBeInstanceOf(Float32Array);
        expect(view.length).toBe(3);
        expect(view.byteOffset).toBe(16);
    });

    test("std140 view still spans only N scalars (padding lives outside)", () => {
        // A std140 vec3<f32> has byteSize 12 even though its alignment is 16 —
        // the view must not read the 4 padding bytes as a 4th component.
        const buffer = new ArrayBuffer(16);
        const view = Vec(F32, 3, Std140).view(buffer, 0);
        expect(view.length).toBe(3);
    });

    test("view aliases the backing buffer", () => {
        const buffer = new ArrayBuffer(16);
        const a = Vec(F32, 4).view(buffer, 0);
        const b = new Float32Array(buffer);
        a[2] = 9;
        expect(b[2]).toBe(9);
    });
});
