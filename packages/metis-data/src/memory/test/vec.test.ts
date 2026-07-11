import { describe, expect, test } from "bun:test";
import { F32, I32, PackingType, Vec } from "../../descriptors";
import { allocate, wrap } from "../index.ts";

// VecMemoryBuffer: get() snapshots to a plain tuple, set() writes a tuple, and
// at(i) hands back a live ScalarMemoryBuffer over component i. Components are
// always tightly packed within the vector (a vec3 is 3 contiguous scalars)
// regardless of the vector's own std140 alignment.

describe("vec get/set round-trip", () => {
    test("vec3 stores all three components", () => {
        const v = allocate(Vec(F32, 3));
        v.set([1, 2, 3]);
        expect(v.get()).toEqual([1, 2, 3]);
    });

    test("vec2 and vec4 round-trip", () => {
        const v2 = allocate(Vec(F32, 2));
        v2.set([7, 8]);
        expect(v2.get()).toEqual([7, 8]);

        const v4 = allocate(Vec(F32, 4));
        v4.set([1, 2, 3, 4]);
        expect(v4.get()).toEqual([1, 2, 3, 4]);
    });

    test("get() returns a detached snapshot, not a live view", () => {
        const v = allocate(Vec(F32, 3));
        v.set([1, 2, 3]);
        const snap = v.get();
        snap[0] = 999;
        expect(v.get()).toEqual([1, 2, 3]); // mutation of the snapshot didn't leak
        expect(Array.isArray(snap)).toBe(true);
    });

    test("integer vectors coerce through their TypedArray", () => {
        const v = allocate(Vec(I32, 2));
        v.set([3.9, -1]);
        expect(v.get()).toEqual([3, -1]);
    });
});

describe("vec at(i) component access", () => {
    test("reads and writes an individual component in place", () => {
        const v = allocate(Vec(F32, 3));
        v.set([1, 2, 3]);
        expect(v.at(1).get()).toBe(2);

        v.at(1).set(20);
        expect(v.get()).toEqual([1, 20, 3]);
    });

    test("component buffers sit at scalar-sized strides from the vec offset", () => {
        const v = allocate(Vec(F32, 4));
        expect(v.at(0).offset).toBe(0);
        expect(v.at(1).offset).toBe(4);
        expect(v.at(3).offset).toBe(12);
    });

    test("component stride ignores std140 vec alignment (still tight)", () => {
        // A std140 vec3 aligns to 16, but its 3 components are contiguous f32s.
        const v = allocate(Vec(F32, 3, PackingType.Std140));
        expect(v.at(2).offset).toBe(8);
        v.at(2).set(5);
        expect(v.get()[2]).toBe(5);
    });
});

describe("vec over a wrapped buffer", () => {
    test("writes land at the base offset and alias the backing store", () => {
        const backing = new ArrayBuffer(64);
        const v = wrap(Vec(F32, 3), backing, 16);
        v.set([10, 20, 30]);
        expect(Array.from(new Float32Array(backing, 16, 3))).toEqual([10, 20, 30]);
        expect(v.at(1).offset).toBe(16 + 4);
    });
});
