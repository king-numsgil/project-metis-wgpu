import { describe, expect, test } from "bun:test";
import { F32, Mat, PackingType, Vec } from "../../descriptors";
import { allocate, wrap } from "../index.ts";

const Dense = PackingType.Dense;
const Std140 = PackingType.Std140;

// MatMemoryBuffer is column-addressed: at(c) yields a VecMemoryBuffer over
// column c, positioned by the descriptor's columnStride (which differs between
// dense and std140). get/set are column-wise conveniences over at().

describe("mat column get/set", () => {
    test("dense mat4 round-trips every column", () => {
        const m = allocate(Mat(F32, 4, Dense));
        m.set(0, [1, 2, 3, 4]);
        m.set(1, [5, 6, 7, 8]);
        m.set(2, [9, 10, 11, 12]);
        m.set(3, [13, 14, 15, 16]);
        expect(m.get(0)).toEqual([1, 2, 3, 4]);
        expect(m.get(2)).toEqual([9, 10, 11, 12]);
        expect(m.get(3)).toEqual([13, 14, 15, 16]);
    });

    test("columns are laid out column-major and contiguous when dense", () => {
        const m = allocate(Mat(F32, 2, Dense)); // columnStride 8, byteSize 16
        m.set(0, [1, 2]);
        m.set(1, [3, 4]);
        // Whole-matrix flat view proves column-major order: [c0.x, c0.y, c1.x, c1.y]
        expect(Array.from(m.view())).toEqual([1, 2, 3, 4]);
    });
});

describe("std140 column stride", () => {
    test("mat3 columns are placed 16 bytes apart (not 12)", () => {
        const m = allocate(Mat(F32, 3, Std140)); // columnStride 16
        expect(m.at(0).offset).toBe(0);
        expect(m.at(1).offset).toBe(16);
        expect(m.at(2).offset).toBe(32);
    });

    test("writing std140 columns leaves the 4-byte padding gaps untouched", () => {
        const m = allocate(Mat(F32, 3, Std140));
        m.set(0, [1, 2, 3]);
        m.set(1, [4, 5, 6]);
        m.set(2, [7, 8, 9]);
        expect(m.get(1)).toEqual([4, 5, 6]);
        // The padding word after column 0 (byte offset 12) stays zero.
        expect(new Float32Array(m.buffer, 12, 1)[0]).toBe(0);
    });
});

describe("mat component access through at()", () => {
    test("at(col).at(row) reaches an individual element", () => {
        const m = allocate(Mat(F32, 4, Dense));
        m.set(2, [0, 0, 0, 0]);
        m.at(2).at(1).set(42);
        expect(m.get(2)).toEqual([0, 42, 0, 0]);
        expect(m.at(2).at(1).get()).toBe(42);
    });

    test("at(col) is a VecMemoryBuffer of matching width", () => {
        const m = allocate(Mat(F32, 4, Std140));
        const col = m.at(1);
        expect(col.get()).toEqual([0, 0, 0, 0]);
        expect(col.type.type).toBe(Vec(F32, 4).type);
    });
});

describe("mat over a wrapped buffer", () => {
    test("columns are offset from the wrap base by columnStride", () => {
        const backing = new ArrayBuffer(128);
        const m = wrap(Mat(F32, 4, Std140), backing, 32); // columnStride 16
        m.set(1, [1, 2, 3, 4]);
        expect(m.at(1).offset).toBe(32 + 16);
        expect(Array.from(new Float32Array(backing, 48, 4))).toEqual([1, 2, 3, 4]);
    });
});
