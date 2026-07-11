import { describe, expect, test } from "bun:test";
import { ArrayOf, F32, Mat, PackingType, StructOf, U32, Vec } from "../../descriptors";
import { allocate } from "../index.ts";

const Std430 = PackingType.Std430;

// The memory layer reads strides straight off the descriptor, so std430 should
// "just work" — but its whole point is the tighter packing, so these prove the
// buffers are actually sized and strided the std430 way end-to-end.

describe("std430 memory round-trips", () => {
    test("mat2 columns sit 8 bytes apart (buffer is 16 bytes, not 32)", () => {
        const m = allocate(Mat(F32, 2, Std430));
        expect(m.buffer.byteLength).toBe(16);
        m.set(0, [1, 2]);
        m.set(1, [3, 4]);
        expect(m.at(1).offset).toBe(8); // std140 would be 16
        expect(m.get(0)).toEqual([1, 2]);
        expect(m.get(1)).toEqual([3, 4]);
        // column-major and gapless: [c0.x, c0.y, c1.x, c1.y]
        expect(Array.from(m.view())).toEqual([1, 2, 3, 4]);
    });

    test("array<vec2> elements are 8 bytes apart, contiguous", () => {
        const a = allocate(ArrayOf(Vec(F32, 2, Std430), 3, Std430));
        expect(a.buffer.byteLength).toBe(24); // 3 * 8, no 16 padding
        a.at(0).set([1, 2]);
        a.at(1).set([3, 4]);
        a.at(2).set([5, 6]);
        expect(a.at(1).offset).toBe(8);
        expect(a.at(2).offset).toBe(16);
        expect(Array.from(a.view())).toEqual([1, 2, 3, 4, 5, 6]);
    });

    test("packed struct { u32, f32, f32 } stays 12 bytes and round-trips", () => {
        const s = allocate(StructOf({ id: U32, x: F32, y: F32 }, Std430));
        expect(s.buffer.byteLength).toBe(12); // std140 would round to 16
        s.set({ id: 7, x: 1.5, y: 2.5 });
        expect(s.get("id").get()).toBe(7);
        expect(s.get("x").get()).toBe(1.5);
        expect(s.get("y").get()).toBe(2.5);
        expect(s.get("y").offset).toBe(8);
    });

    test("array-of-struct honours the tighter std430 element stride", () => {
        const item = StructOf({ a: F32, b: F32 }, Std430); // size 8, align 4
        const a = allocate(ArrayOf(item, 3, Std430)); // stride 8, not 16
        expect(a.buffer.byteLength).toBe(24);
        a.at(2).set({ a: 9, b: 10 });
        expect(a.at(2).get("a").get()).toBe(9);
        expect(a.at(2).get("b").get()).toBe(10);
    });
});
