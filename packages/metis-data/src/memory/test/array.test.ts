import { describe, expect, test } from "bun:test";
import { ArrayOf, F32, Mat, PackingType, StructOf, Vec } from "../../descriptors";
import { allocate, wrap } from "../index.ts";

const Dense = PackingType.Dense;
const Std140 = PackingType.Std140;

// ArrayMemoryBuffer.at(i) wraps element i (respecting the descriptor's
// arrayPitch) into whatever buffer flavour the item type calls for, and the
// buffer is iterable element-by-element.

describe("array at() element access", () => {
    test("scalar array: each element is an independent ScalarMemoryBuffer", () => {
        const a = allocate(ArrayOf(F32, 4));
        a.at(0).set(10);
        a.at(3).set(40);
        expect(a.at(0).get()).toBe(10);
        expect(a.at(3).get()).toBe(40);
        expect(a.at(1).get()).toBe(0);
    });

    test("vec array: elements are VecMemoryBuffers at the right stride", () => {
        const a = allocate(ArrayOf(Vec(F32, 2), 3)); // dense pitch 8
        a.at(0).set([1, 2]);
        a.at(1).set([3, 4]);
        a.at(2).set([5, 6]);
        expect(a.at(1).get()).toEqual([3, 4]);
        expect(a.at(1).offset).toBe(8);
        expect(a.at(2).offset).toBe(16);
    });

    test("std140 vec3 array strides elements by 16, not 12", () => {
        const a = allocate(ArrayOf(Vec(F32, 3, Std140), 4, Std140));
        a.at(0).set([1, 2, 3]);
        a.at(1).set([4, 5, 6]);
        expect(a.at(1).offset).toBe(16);
        expect(a.at(1).get()).toEqual([4, 5, 6]);
        // The gap word between element 0 and element 1 (byte 12) stays zero.
        expect(new Float32Array(a.buffer, 12, 1)[0]).toBe(0);
    });

    test("nested array of mat4: two levels of at()", () => {
        const a = allocate(ArrayOf(Mat(F32, 4, Std140), 2, Std140));
        a.at(1).set(0, [1, 2, 3, 4]);
        expect(a.at(1).get(0)).toEqual([1, 2, 3, 4]);
        expect(a.at(0).get(0)).toEqual([0, 0, 0, 0]);
    });
});

describe("array iteration", () => {
    test("for...of visits every element in order", () => {
        const a = allocate(ArrayOf(F32, 5));
        let i = 0;
        for (const el of a) {
            el.set(i * 10);
            i++;
        }
        expect(i).toBe(5);
        expect(Array.from(a.view())).toEqual([0, 10, 20, 30, 40]);
    });

    test("spread collects one buffer per element", () => {
        const a = allocate(ArrayOf(Vec(F32, 2), 3));
        const elems = [...a];
        expect(elems).toHaveLength(3);
        elems[2]!.set([9, 9]);
        expect(a.at(2).get()).toEqual([9, 9]);
    });
});

describe("array over a wrapped buffer", () => {
    test("element offsets are relative to the wrap base", () => {
        const backing = new ArrayBuffer(128);
        const a = wrap(ArrayOf(Vec(F32, 3, Std140), 4, Std140), backing, 32);
        a.at(2).set([1, 2, 3]);
        expect(a.at(2).offset).toBe(32 + 2 * 16);
        expect(Array.from(new Float32Array(backing, 32 + 32, 3))).toEqual([1, 2, 3]);
    });
});

describe("array of struct", () => {
    test("elements are StructMemoryBuffers addressable by field", () => {
        const item = StructOf({ x: F32, y: F32 });
        const a = allocate(ArrayOf(item, 3, Dense));
        a.at(1).set({ x: 3, y: 4 });
        expect(a.at(1).get("x").get()).toBe(3);
        expect(a.at(1).get("y").get()).toBe(4);
    });
});
