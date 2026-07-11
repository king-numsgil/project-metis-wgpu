import { describe, expect, test } from "bun:test";
import { ArrayOf, Bool, F32, Mat, PackingType, StructOf, U32, Vec } from "../../descriptors";
import { allocate, wrap } from "../index.ts";

const Dense = PackingType.Dense;
const Std140 = PackingType.Std140;

// StructMemoryBuffer.get(name) wraps one member; set(value) walks the members
// and dispatches by kind (scalar/bool/vec via a plain .set, struct/array/mat
// recursively). This is the most branch-heavy memory type, so the bulk set()
// dispatch across every member kind is the focus here.

describe("struct get(name) member access", () => {
    test("returns a live buffer over the member's region", () => {
        const s = allocate(StructOf({ pos: Vec(F32, 3), id: U32 }));
        s.get("pos").set([1, 2, 3]);
        s.get("id").set(7);
        expect(s.get("pos").get()).toEqual([1, 2, 3]);
        expect(s.get("id").get()).toBe(7);
    });

    test("member buffers are positioned at the descriptor's offsets", () => {
        const desc = StructOf({ a: F32, b: Vec(F32, 3) });
        const s = allocate(desc);
        expect(s.get("a").offset).toBe(desc.offsetOf("a"));
        expect(s.get("b").offset).toBe(desc.offsetOf("b"));
    });

    test("members getter echoes the descriptor's members", () => {
        const desc = StructOf({ a: F32 });
        expect(allocate(desc).members).toBe(desc.members);
    });
});

describe("bulk set() across every member kind", () => {
    const desc = StructOf({
        flag: Bool,
        count: U32,
        pos: Vec(F32, 3),
        model: Mat(F32, 2, Dense),
        weights: ArrayOf(F32, 3, Dense),
        offsets: ArrayOf(Vec(F32, 2, Dense), 2, Dense),
        inner: StructOf({ a: F32, b: F32 }),
    });

    test("writes scalar, bool, vec, mat, array, array-of-vec and nested struct", () => {
        const s = allocate(desc);
        s.set({
            flag: true,
            count: 42,
            pos: [1, 2, 3],
            model: [[1, 2], [3, 4]],
            weights: [0.25, 0.5, 0.25],
            offsets: [[10, 11], [20, 21]],
            inner: { a: 9, b: 8 },
        });

        expect(s.get("flag").get()).toBe(true);
        expect(s.get("count").get()).toBe(42);
        expect(s.get("pos").get()).toEqual([1, 2, 3]);
        expect(s.get("model").get(0)).toEqual([1, 2]);
        expect(s.get("model").get(1)).toEqual([3, 4]);
        expect(s.get("weights").at(1).get()).toBe(0.5);
        expect(s.get("offsets").at(0).get()).toEqual([10, 11]);
        expect(s.get("offsets").at(1).get()).toEqual([20, 21]);
        expect(s.get("inner").get("a").get()).toBe(9);
        expect(s.get("inner").get("b").get()).toBe(8);
    });

    test("set() only touches the keys provided (partial update)", () => {
        const s = allocate(desc);
        s.set({
            flag: true,
            count: 1,
            pos: [1, 1, 1],
            model: [[1, 1], [1, 1]],
            weights: [1, 1, 1],
            offsets: [[1, 1], [1, 1]],
            inner: { a: 1, b: 1 },
        });
        // Now write only `count`; everything else must survive.
        s.set({ count: 99 } as never);
        expect(s.get("count").get()).toBe(99);
        expect(s.get("pos").get()).toEqual([1, 1, 1]);
        expect(s.get("inner").get("a").get()).toBe(1);
    });
});

describe("std140 struct round-trips through offsets", () => {
    test("{ mvp: mat4, tint: vec4 } reads back what it wrote", () => {
        const desc = StructOf(
            { mvp: Mat(F32, 4, Std140), tint: Vec(F32, 4, Std140) },
            Std140,
        );
        const s = allocate(desc);
        s.set({
            mvp: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [5, 6, 7, 1]],
            tint: [0.1, 0.2, 0.3, 1],
        });
        expect(s.get("mvp").get(3)).toEqual([5, 6, 7, 1]);
        expect(s.get("tint").get()).toEqual([
            new Float32Array([0.1])[0]!,
            new Float32Array([0.2])[0]!,
            new Float32Array([0.3])[0]!,
            1,
        ]);
        // tint lives at byte 64 in the shared buffer.
        expect(s.get("tint").offset).toBe(64);
    });
});

describe("struct over a wrapped buffer", () => {
    test("member offsets are relative to the wrap base", () => {
        const backing = new ArrayBuffer(64);
        const desc = StructOf({ a: U32, b: Vec(F32, 3) });
        const s = wrap(desc, backing, 16);
        s.set({ a: 5, b: [1, 2, 3] });
        expect(s.get("a").offset).toBe(16 + desc.offsetOf("a"));
        expect(s.get("b").offset).toBe(16 + desc.offsetOf("b"));
        expect(new Uint32Array(backing, 16, 1)[0]).toBe(5);
    });
});
