import { describe, expect, test } from "bun:test";
import { F16, F32, F64, I32, U32 } from "../../descriptors";
import { allocate, wrap } from "../index.ts";

// ScalarMemoryBuffer is the leaf of the whole memory tree: get()/set() over a
// length-1 typed array. Everything else (vec.at, struct.get, array.at) bottoms
// out here, so its round-tripping and TypedArray coercion must be airtight.

describe("scalar get/set round-trip", () => {
    test("F32 stores and reads back", () => {
        const b = allocate(F32);
        b.set(3.5);
        expect(b.get()).toBe(3.5);
    });

    test("set overwrites, get reflects the latest write", () => {
        const b = allocate(I32);
        b.set(10);
        b.set(-7);
        expect(b.get()).toBe(-7);
    });

    test("buffer/offset/type are exposed and buffer is sized to the descriptor", () => {
        const b = allocate(F64);
        expect(b.type).toBe(F64);
        expect(b.offset).toBe(0);
        expect(b.buffer).toBeInstanceOf(ArrayBuffer);
        expect(b.buffer.byteLength).toBe(8);
    });
});

describe("scalar TypedArray coercion", () => {
    test("I32 truncates a float to a signed 32-bit int", () => {
        const b = allocate(I32);
        b.set(3.9);
        expect(b.get()).toBe(3);
        b.set(-1);
        expect(b.get()).toBe(-1);
    });

    test("U32 wraps a negative into unsigned space", () => {
        const b = allocate(U32);
        b.set(-1);
        expect(b.get()).toBe(0xffffffff);
    });

    test("F16 rounds to half precision", () => {
        const b = allocate(F16);
        b.set(1.5);
        expect(b.get()).toBe(1.5);
        b.set(65504); // f16 max
        expect(b.get()).toBe(65504);
    });

    test("F64 keeps precision F32 would drop", () => {
        const b = allocate(F64);
        b.set(1.0000000001);
        expect(b.get()).toBe(1.0000000001);
    });
});

describe("scalar view() aliases the region get()/set() use", () => {
    test("writes through view() are visible to get()", () => {
        const b = allocate(F32);
        b.view()[0] = 42;
        expect(b.get()).toBe(42);
    });

    test("wrap shares memory with the underlying buffer at the offset", () => {
        const backing = new ArrayBuffer(16);
        const b = wrap(F32, backing, 8);
        b.set(2.25);
        expect(new Float32Array(backing, 8, 1)[0]).toBe(2.25);
        expect(b.offset).toBe(8);
    });
});
