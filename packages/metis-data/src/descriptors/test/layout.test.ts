import { describe, expect, test } from "bun:test";
import { ArrayOf, F32, Mat, PackingType, StructOf, U32, Vec } from "../index.ts";

const Dense = PackingType.Dense;
const Std140 = PackingType.Std140;

// These lock in std140 layout (the WGSL-uniform-block rules metis-data's Std140
// packing targets). They exist because the descriptors shipped untested, which
// is how the vec3-size bug (a trailing scalar landing at offset 16 instead of
// 12) survived. Values here are the ground truth a WGSL shader agrees with.

describe("vector layout", () => {
    test("std140 vec sizes are UNPADDED; only alignment/stride pad", () => {
        const v2 = Vec(F32, 2, Std140);
        expect([v2.byteSize, v2.alignment, v2.arrayPitch]).toEqual([8, 8, 16]);

        const v3 = Vec(F32, 3, Std140);
        // The regression: byteSize must be 12 (not 16); align 16; array stride 16.
        expect([v3.byteSize, v3.alignment, v3.arrayPitch]).toEqual([12, 16, 16]);

        const v4 = Vec(F32, 4, Std140);
        expect([v4.byteSize, v4.alignment, v4.arrayPitch]).toEqual([16, 16, 16]);
    });

    test("dense vec is tightly packed", () => {
        const v3 = Vec(F32, 3, Dense);
        expect([v3.byteSize, v3.alignment]).toEqual([12, 4]);
    });
});

describe("struct layout (std140)", () => {
    test("{ vec3, f32 } packs the scalar into the vec3 gap -> 16 bytes", () => {
        const s = StructOf({ v: Vec(F32, 3, Std140), s: F32 }, Std140);
        expect(s.offsetOf("v")).toBe(0);
        expect(s.offsetOf("s")).toBe(12); // the whole point
        expect(s.byteSize).toBe(16);
    });

    test("{ f32, vec3 } aligns the vec3 up to 16", () => {
        const s = StructOf({ a: F32, v: Vec(F32, 3, Std140) }, Std140);
        expect(s.offsetOf("a")).toBe(0);
        expect(s.offsetOf("v")).toBe(16);
        expect(s.byteSize).toBe(32);
    });

    test("{ vec3, vec3 } -> second at 16, size 32", () => {
        const s = StructOf({ a: Vec(F32, 3, Std140), b: Vec(F32, 3, Std140) }, Std140);
        expect(s.offsetOf("b")).toBe(16);
        expect(s.byteSize).toBe(32);
    });

    test("dense { vec3, f32 } is also 16 (scalar at 12)", () => {
        const s = StructOf({ v: Vec(F32, 3, Dense), s: F32 }, Dense);
        expect(s.offsetOf("s")).toBe(12);
        expect(s.byteSize).toBe(16);
    });
});

describe("matrix layout (std140)", () => {
    test("mat4 = 4x vec4 columns", () => {
        const m = Mat(F32, 4, Std140);
        expect([m.byteSize, m.columnStride, m.alignment]).toEqual([64, 16, 16]);
    });

    test("mat3 columns pad to 16 -> 48 bytes", () => {
        const m = Mat(F32, 3, Std140);
        expect([m.byteSize, m.columnStride, m.alignment]).toEqual([48, 16, 16]);
    });
});

describe("array layout (std140)", () => {
    test("array<f32> strides to 16 per element", () => {
        const a = ArrayOf(F32, 4, Std140);
        expect([a.arrayPitch, a.byteSize]).toEqual([16, 64]);
    });

    test("array<vec3> strides to 16 per element", () => {
        const a = ArrayOf(Vec(F32, 3, Std140), 10, Std140);
        expect([a.arrayPitch, a.byteSize]).toEqual([16, 160]);
    });
});

describe("packing propagation guard", () => {
    test("a Dense composite member inside a Std140 struct throws", () => {
        expect(() => StructOf({ v: Vec(F32, 3, Dense) }, Std140)).toThrow(/Std140/);
        expect(() => StructOf({ m: Mat(F32, 4, Dense) }, Std140)).toThrow(/must be Std140/);
    });

    test("all-Std140 members are accepted", () => {
        expect(() => StructOf({ v: Vec(F32, 3, Std140), m: Mat(F32, 4, Std140) }, Std140)).not.toThrow();
    });

    test("scalars are layout-invariant and never trip the guard", () => {
        expect(() => StructOf({ a: F32, b: U32 }, Std140)).not.toThrow();
    });

    test("Dense structs are not validated", () => {
        expect(() => StructOf({ v: Vec(F32, 3, Dense) }, Dense)).not.toThrow();
    });
});
