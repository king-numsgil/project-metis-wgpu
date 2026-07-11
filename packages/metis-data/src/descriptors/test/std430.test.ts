import { describe, expect, test } from "bun:test";
import { ArrayOf, F32, F64, Mat, PackingType, StructOf, U32, Vec } from "../index.ts";

const Dense = PackingType.Dense;
const Std140 = PackingType.Std140;
const Std430 = PackingType.Std430;

// std430 is the storage-buffer layout (WGSL `var<storage>`). It matches std140
// EXCEPT that arrays and structs are NOT padded up to a 16-byte (vec4) boundary:
// element/column stride and struct alignment round only to the element's own
// alignment. These values are the ground truth a WGSL std430 buffer agrees with.
// The contrast columns against std140 are what make the mode worth having.

describe("std430 vectors", () => {
    test("alignment & size match std140; only vec2's array stride differs", () => {
        // vec2: stride 8 (std430) vs 16 (std140). vec3/vec4 already align to 16.
        const v2 = Vec(F32, 2, Std430);
        expect([v2.byteSize, v2.alignment, v2.arrayPitch]).toEqual([8, 8, 8]);
        expect(Vec(F32, 2, Std140).arrayPitch).toBe(16); // the contrast

        const v3 = Vec(F32, 3, Std430);
        expect([v3.byteSize, v3.alignment, v3.arrayPitch]).toEqual([12, 16, 16]);

        const v4 = Vec(F32, 4, Std430);
        expect([v4.byteSize, v4.alignment, v4.arrayPitch]).toEqual([16, 16, 16]);
    });

    test("f64 vec2 strides by its own 16-byte alignment", () => {
        const v = Vec(F64, 2, Std430);
        expect([v.byteSize, v.alignment, v.arrayPitch]).toEqual([16, 16, 16]);
    });
});

describe("std430 matrices", () => {
    test("mat2 columns pack at 8 (vs std140's 16) → 16 bytes, not 32", () => {
        const m = Mat(F32, 2, Std430);
        expect([m.byteSize, m.columnStride, m.alignment]).toEqual([16, 8, 8]);
        expect(Mat(F32, 2, Std140).byteSize).toBe(32); // the contrast
    });

    test("mat3 & mat4 are identical to std140 (vec3/vec4 already 16-aligned)", () => {
        const m3 = Mat(F32, 3, Std430);
        expect([m3.byteSize, m3.columnStride, m3.alignment]).toEqual([48, 16, 16]);
        const m4 = Mat(F32, 4, Std430);
        expect([m4.byteSize, m4.columnStride, m4.alignment]).toEqual([64, 16, 16]);
    });

    test("mat2<f64> columns are 16 wide (f64 vec2 aligns to 16)", () => {
        const m = Mat(F64, 2, Std430);
        expect([m.byteSize, m.columnStride, m.alignment]).toEqual([32, 16, 16]);
    });
});

describe("std430 arrays (stride = element alignment, no 16-rounding)", () => {
    test("array<f32> strides by 4, not 16", () => {
        const a = ArrayOf(F32, 4, Std430);
        expect([a.alignment, a.arrayPitch, a.byteSize]).toEqual([4, 4, 16]);
        expect(ArrayOf(F32, 4, Std140).byteSize).toBe(64); // the contrast
    });

    test("array<vec2> strides by 8", () => {
        const a = ArrayOf(Vec(F32, 2, Std430), 4, Std430);
        expect([a.alignment, a.arrayPitch, a.byteSize]).toEqual([8, 8, 32]);
    });

    test("array<vec3> still strides by 16 (element alignment is already 16)", () => {
        const a = ArrayOf(Vec(F32, 3, Std430), 10, Std430);
        expect([a.alignment, a.arrayPitch, a.byteSize]).toEqual([16, 16, 160]);
    });

    test("array<mat2> strides by 16 (element size 16), half of std140's 96", () => {
        const a = ArrayOf(Mat(F32, 2, Std430), 3, Std430);
        expect([a.arrayPitch, a.byteSize]).toEqual([16, 48]);
        expect(ArrayOf(Mat(F32, 2, Std140), 3, Std140).byteSize).toBe(96); // the contrast
    });
});

describe("std430 structs (alignment = max member alignment, not 16)", () => {
    test("{ f32, f32 } is 8 bytes / align 4 (std140 would be 16/16)", () => {
        const s = StructOf({ a: F32, b: F32 }, Std430);
        expect([s.byteSize, s.alignment, s.arrayPitch]).toEqual([8, 4, 8]);
        expect(StructOf({ a: F32, b: F32 }, Std140).byteSize).toBe(16); // the contrast
    });

    test("{ vec3, f32 } still gap-packs the scalar at offset 12 → 16 bytes", () => {
        const s = StructOf({ v: Vec(F32, 3, Std430), s: F32 }, Std430);
        expect(s.offsetOf("v")).toBe(0);
        expect(s.offsetOf("s")).toBe(12);
        expect([s.byteSize, s.alignment]).toEqual([16, 16]);
    });

    test("{ f32, vec3 } aligns the vec3 to 16 → size 32", () => {
        const s = StructOf({ a: F32, v: Vec(F32, 3, Std430) }, Std430);
        expect(s.offsetOf("a")).toBe(0);
        expect(s.offsetOf("v")).toBe(16);
        expect(s.byteSize).toBe(32);
    });

    test("a wider member drives struct alignment without a forced 16 floor", () => {
        // maxAlign here is 8 (from f64), so the struct aligns to 8 — std140 would
        // floor it to 16.
        const s = StructOf({ a: U32, b: F64 }, Std430);
        expect(s.alignment).toBe(8);
        expect(s.byteSize).toBe(16);
        expect(StructOf({ a: U32, b: F64 }, Std140).alignment).toBe(16); // the contrast
    });
});

describe("std430 packing guard", () => {
    test("a non-Std430 composite member inside a Std430 struct throws", () => {
        expect(() => StructOf({ v: Vec(F32, 3, Dense) }, Std430)).toThrow(/Std430/);
        expect(() => StructOf({ v: Vec(F32, 2, Std140) }, Std430)).toThrow(/must be Std430/);
        expect(() => StructOf({ m: Mat(F32, 2, Dense) }, Std430)).toThrow(/Std430/);
        expect(() => StructOf({ a: ArrayOf(F32, 4, Std140) }, Std430)).toThrow(/must be Std430/);
    });

    test("the error names the mismatched packing it found", () => {
        expect(() => StructOf({ v: Vec(F32, 2, Std140) }, Std430)).toThrow(
            /was built with Std140 packing/,
        );
    });

    test("all-Std430 members are accepted; scalars never trip the guard", () => {
        expect(() =>
            StructOf(
                { v: Vec(F32, 3, Std430), m: Mat(F32, 2, Std430), a: ArrayOf(F32, 4, Std430), s: F32 },
                Std430,
            ),
        ).not.toThrow();
    });

    test("Std430 members are rejected by a Std140 struct (and vice versa)", () => {
        expect(() => StructOf({ v: Vec(F32, 3, Std430) }, Std140)).toThrow(/must be Std140/);
        expect(() => StructOf({ v: Vec(F32, 3, Std140) }, Std430)).toThrow(/must be Std430/);
    });
});
