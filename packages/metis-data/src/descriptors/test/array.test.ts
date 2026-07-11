import { describe, expect, test } from "bun:test";
import { ArrayOf, F32, Mat, PackingType, StructOf, U32, Vec } from "../index.ts";
import { GPU_ARRAY } from "../constants.ts";

const Dense = PackingType.Dense;
const Std140 = PackingType.Std140;

describe("array identity + metadata", () => {
    test("type/item/length/packing are reported", () => {
        const a = ArrayOf(F32, 8, Std140);
        expect(a.type).toBe(GPU_ARRAY);
        expect(a.item).toBe(F32);
        expect(a.length).toBe(8);
        expect(a.packing).toBe(Std140);
        expect(ArrayOf(F32, 8).packing).toBe(Dense); // default
    });

    test("toString nests the item's toString and the length", () => {
        expect(ArrayOf(Vec(F32, 3), 4).toString()).toBe("array<vec3<f32>, 4>");
    });
});

describe("dense array packing (inherits item alignment/pitch)", () => {
    test("array<f32> is tightly packed", () => {
        const a = ArrayOf(F32, 4, Dense);
        expect([a.alignment, a.arrayPitch, a.byteSize]).toEqual([4, 4, 16]);
    });

    test("array<vec3<f32>> keeps the 12-byte dense stride", () => {
        const a = ArrayOf(Vec(F32, 3, Dense), 5, Dense);
        expect([a.alignment, a.arrayPitch, a.byteSize]).toEqual([4, 12, 60]);
    });

    test("array of dense mat4 uses the 64-byte item pitch", () => {
        const a = ArrayOf(Mat(F32, 4, Dense), 3, Dense);
        expect([a.arrayPitch, a.byteSize]).toEqual([64, 192]);
    });
});

describe("std140 array packing (alignment & stride rounded to 16)", () => {
    test("array<u32> strides to 16 per element", () => {
        const a = ArrayOf(U32, 4, Std140);
        expect([a.alignment, a.arrayPitch, a.byteSize]).toEqual([16, 16, 64]);
    });

    test("array<mat4> stride stays 64 (already a multiple of 16)", () => {
        const a = ArrayOf(Mat(F32, 4, Std140), 2, Std140);
        expect([a.arrayPitch, a.byteSize]).toEqual([64, 128]);
    });
});

describe("offsetAt()", () => {
    test("returns index * arrayPitch", () => {
        const a = ArrayOf(Vec(F32, 3, Std140), 10, Std140); // pitch 16
        expect(a.offsetAt(0)).toBe(0);
        expect(a.offsetAt(1)).toBe(16);
        expect(a.offsetAt(9)).toBe(144);
    });

    test("out-of-range index throws RangeError", () => {
        const a = ArrayOf(F32, 4);
        expect(() => a.offsetAt(-1)).toThrow(RangeError);
        expect(() => a.offsetAt(4)).toThrow(RangeError);
        expect(() => a.offsetAt(3)).not.toThrow();
    });
});

describe("at() element views", () => {
    test("hands back the item's view at the strided, base-offset-adjusted spot", () => {
        const a = ArrayOf(Vec(F32, 3, Std140), 4, Std140); // pitch 16
        const buffer = new ArrayBuffer(64 + 32);
        const el = a.at(buffer, 32, 2);
        expect(el).toBeInstanceOf(Float32Array);
        expect(el.length).toBe(3);
        expect(el.byteOffset).toBe(32 + 2 * 16);
    });

    test("at() delegates bounds checking to offsetAt", () => {
        const a = ArrayOf(F32, 3);
        const buffer = new ArrayBuffer(a.byteSize);
        expect(() => a.at(buffer, 0, 5)).toThrow(RangeError);
    });
});

describe("view()", () => {
    test("dense scalar array flattens to one big TypedArray", () => {
        const a = ArrayOf(F32, 4, Dense);
        const view = a.view(new ArrayBuffer(a.byteSize), 0);
        expect(view).toBeInstanceOf(Float32Array);
        expect(view.length).toBe(4);
    });

    test("dense vec array flattens component-major (length * N)", () => {
        const a = ArrayOf(Vec(F32, 3, Dense), 5, Dense);
        const view = a.view(new ArrayBuffer(a.byteSize), 0);
        expect(view.length).toBe(15); // 5 elements * 3 components, contiguous
    });

    test("array of struct exposes raw bytes as a Uint8Array", () => {
        const item = StructOf({ a: F32, b: F32 });
        const a = ArrayOf(item, 3, Dense);
        const view = a.view(new ArrayBuffer(a.byteSize), 0);
        expect(view).toBeInstanceOf(Uint8Array);
        expect(view.length).toBe(a.byteSize);
    });

    test("std140 padded-element view spans the FULL region (padding included)", () => {
        // Regression guard for the undershoot bug: a std140 array<vec3> strides
        // each 12-byte vec to 16, so the flat view must cover all 160 bytes
        // (40 f32 = 30 real + 10 padding), not just the 120 bytes of live data.
        const a = ArrayOf(Vec(F32, 3, Std140), 10, Std140);
        expect(a.byteSize).toBe(160);
        const view = a.view(new ArrayBuffer(a.byteSize), 0);
        expect(view.length).toBe(40);
        expect(view.length * 4).toBe(a.byteSize);
    });

    test("std140 array<mat3> view spans the full padded region too", () => {
        const a = ArrayOf(Mat(F32, 3, Std140), 4, Std140);
        const view = a.view(new ArrayBuffer(a.byteSize), 0);
        expect(view.length).toBe(a.byteSize / 4);
    });

    test("the flat view aliases the same bytes at()/offsetAt() address", () => {
        // Prove the view now respects element stride: element i's first
        // component lands at word (offsetAt(i)/4) in the flat view.
        const desc = ArrayOf(Vec(F32, 3, Std140), 3, Std140); // pitch 16 → 4 words
        const buffer = new ArrayBuffer(desc.byteSize);
        desc.at(buffer, 0, 0)[0] = 1;
        desc.at(buffer, 0, 1)[0] = 2;
        desc.at(buffer, 0, 2)[0] = 3;
        const view = desc.view(buffer, 0);
        expect(view[0]).toBe(1); // element 0 @ word 0
        expect(view[4]).toBe(2); // element 1 @ word 4 (byte 16)
        expect(view[8]).toBe(3); // element 2 @ word 8 (byte 32)
    });
});
