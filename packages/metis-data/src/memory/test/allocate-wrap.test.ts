import { describe, expect, test } from "bun:test";
import { ArrayOf, Bool, F32, Mat, PackingType, StructOf, U32, Vec } from "../../descriptors";
import { allocate, wrap } from "../index.ts";

// allocate() and wrap() are the dispatch layer: descriptor.type picks the
// concrete buffer class. allocate() also owns a fresh ArrayBuffer sized to the
// descriptor; wrap() borrows an existing one at an offset. These tests pin the
// dispatch (right API for each kind), the sizing, and the aliasing semantics.

describe("allocate() sizes a fresh buffer to the descriptor", () => {
    const cases = [
        ["scalar", F32, 4],
        ["vec3", Vec(F32, 3), 12],
        ["mat4 std140", Mat(F32, 4, PackingType.Std140), 64],
        ["array<f32>[4]", ArrayOf(F32, 4), 16],
        ["struct{f32,f32}", StructOf({ a: F32, b: F32 }), 8],
    ] as const;

    for (const [label, desc, size] of cases) {
        test(`${label} → ${size} bytes at offset 0`, () => {
            const b = allocate(desc as never);
            expect(b.buffer.byteLength).toBe(size);
            expect(b.offset).toBe(0);
        });
    }
});

describe("allocate() dispatches to the correct buffer kind", () => {
    test("bool → boolean-valued buffer", () => {
        const b = allocate(Bool);
        b.set(true);
        expect(b.get()).toBe(true);
    });

    test("scalar → number-valued buffer", () => {
        const b = allocate(U32);
        b.set(3);
        expect(b.get()).toBe(3);
    });

    test("vec → tuple get/set + at()", () => {
        const b = allocate(Vec(F32, 2));
        b.set([1, 2]);
        expect(b.get()).toEqual([1, 2]);
        expect(typeof b.at(0).get()).toBe("number");
    });

    test("mat → column get/set", () => {
        const b = allocate(Mat(F32, 2));
        b.set(0, [1, 2]);
        expect(b.get(0)).toEqual([1, 2]);
    });

    test("array → at() + iterable", () => {
        const b = allocate(ArrayOf(F32, 2));
        expect(typeof (b as unknown as { [Symbol.iterator]: unknown })[Symbol.iterator]).toBe("function");
        b.at(0).set(1);
        expect(b.at(0).get()).toBe(1);
    });

    test("struct → members + get(name)", () => {
        const b = allocate(StructOf({ a: F32 }));
        expect(b.members).toHaveProperty("a");
        b.get("a").set(5);
        expect(b.get("a").get()).toBe(5);
    });

    test("allocate buffers are independent", () => {
        const a = allocate(F32);
        const b = allocate(F32);
        a.set(1);
        b.set(2);
        expect(a.get()).toBe(1);
        expect(b.get()).toBe(2);
        expect(a.buffer).not.toBe(b.buffer);
    });
});

describe("wrap() borrows an existing buffer", () => {
    test("shares memory: writes are visible through a second wrap of the same spot", () => {
        const backing = new ArrayBuffer(32);
        const a = wrap(Vec(F32, 3), backing, 8);
        const b = wrap(Vec(F32, 3), backing, 8);
        a.set([1, 2, 3]);
        expect(b.get()).toEqual([1, 2, 3]); // same region, two views
        expect(a.buffer).toBe(backing);
        expect(b.buffer).toBe(backing);
    });

    test("different offsets are isolated within one buffer", () => {
        const backing = new ArrayBuffer(32);
        const first = wrap(F32, backing, 0);
        const second = wrap(F32, backing, 16);
        first.set(1);
        second.set(2);
        expect(first.get()).toBe(1);
        expect(second.get()).toBe(2);
    });

    test("wrap can pack several descriptors into one shared buffer", () => {
        // Emulates suballocating from a bump buffer: a header scalar followed by
        // a vec3, hand-placed at known offsets.
        const backing = new ArrayBuffer(64);
        const header = wrap(U32, backing, 0);
        const pos = wrap(Vec(F32, 3), backing, 4);
        header.set(0xdeadbeef);
        pos.set([1, 2, 3]);
        expect(new Uint32Array(backing, 0, 1)[0]).toBe(0xdeadbeef);
        expect(Array.from(new Float32Array(backing, 4, 3))).toEqual([1, 2, 3]);
    });
});
