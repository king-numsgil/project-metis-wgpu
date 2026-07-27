import { describe, expect, test } from "bun:test";
import { F32, Vec2, Vec3, Vec4 } from "metis-data";

/**
 * Every producing op must tolerate `out` aliasing one of its inputs —
 * `Vec3.add(v, v, w)` and `Vec3.normalize(v, v)` are ordinary things to write,
 * and the renderer does write them.
 *
 * These tests exist because that safety is **incidental** in a `get()`/`set()`
 * implementation: `get()` snapshots each input into a detached tuple before
 * anything is written back, so aliasing can't corrupt anything. Rewriting the
 * ops to index the cached view directly removes that accident — reads and
 * writes then touch the same memory, and any op that interleaves them will
 * quietly produce garbage for the aliased case only.
 *
 * The rest of the suite would not catch it: nothing else passes the same buffer
 * twice. So these are pinned separately, and they must pass **before** a
 * view-based rewrite as well as after — otherwise they aren't testing the
 * rewrite, they're just testing the current code.
 */

const close = (a: number, b: number, eps = 1e-5) => Math.abs(a - b) < eps;

describe("Vec3 aliasing", () => {
    test("add: out === a", () => {
        const v = Vec3.create(F32, 1, 2, 3);
        const w = Vec3.create(F32, 10, 20, 30);
        Vec3.add(v, v, w);
        expect(v.get()).toEqual([11, 22, 33]);
    });

    test("add: out === b", () => {
        const v = Vec3.create(F32, 1, 2, 3);
        const w = Vec3.create(F32, 10, 20, 30);
        Vec3.add(w, v, w);
        expect(w.get()).toEqual([11, 22, 33]);
    });

    test("add: all three the same buffer", () => {
        const v = Vec3.create(F32, 1, 2, 3);
        Vec3.add(v, v, v);
        expect(v.get()).toEqual([2, 4, 6]);
    });

    test("subtract: out === b (order matters, so this is the dangerous one)", () => {
        const a = Vec3.create(F32, 10, 20, 30);
        const b = Vec3.create(F32, 1, 2, 3);
        Vec3.subtract(b, a, b);
        expect(b.get()).toEqual([9, 18, 27]);
    });

    test("multiply / divide: out === a", () => {
        const v = Vec3.create(F32, 2, 4, 8);
        const w = Vec3.create(F32, 2, 2, 2);
        Vec3.multiply(v, v, w);
        expect(v.get()).toEqual([4, 8, 16]);
        Vec3.divide(v, v, w);
        expect(v.get()).toEqual([2, 4, 8]);
    });

    test("scale / negate: out === v", () => {
        const v = Vec3.create(F32, 1, 2, 3);
        Vec3.scale(v, v, 3);
        expect(v.get()).toEqual([3, 6, 9]);
        Vec3.negate(v, v);
        expect(v.get()).toEqual([-3, -6, -9]);
    });

    test("normalize: out === v", () => {
        const v = Vec3.create(F32, 3, 4, 0);
        Vec3.normalize(v, v);
        expect(close(v.getComponent(0), 0.6)).toBe(true);
        expect(close(v.getComponent(1), 0.8)).toBe(true);
    });

    test("cross: out === a — the classic corruption case", () => {
        // x-cross-y = z. Writing out.x before reading a.y/a.z would poison the
        // remaining components, so this fails loudly on a bad rewrite.
        const a = Vec3.create(F32, 1, 0, 0);
        const b = Vec3.create(F32, 0, 1, 0);
        Vec3.cross(a, a, b);
        expect(a.get()).toEqual([0, 0, 1]);
    });

    test("cross: out === b", () => {
        const a = Vec3.create(F32, 1, 0, 0);
        const b = Vec3.create(F32, 0, 1, 0);
        Vec3.cross(b, a, b);
        expect(b.get()).toEqual([0, 0, 1]);
    });

    test("lerp: out === a and out === b", () => {
        const a = Vec3.create(F32, 0, 0, 0);
        const b = Vec3.create(F32, 10, 10, 10);
        Vec3.lerp(a, a, b, 0.5);
        expect(a.get()).toEqual([5, 5, 5]);

        const c = Vec3.create(F32, 0, 0, 0);
        const d = Vec3.create(F32, 10, 10, 10);
        Vec3.lerp(d, c, d, 0.5);
        expect(d.get()).toEqual([5, 5, 5]);
    });

    test("copy: out === src is a no-op, not a corruption", () => {
        const v = Vec3.create(F32, 1, 2, 3);
        Vec3.copy(v, v);
        expect(v.get()).toEqual([1, 2, 3]);
    });

    test("transformQuat: out === v", () => {
        // 180° about Z: (1,0,0) -> (-1,0,0).
        const v = Vec3.create(F32, 1, 0, 0);
        const q = Vec4.create(F32, 0, 0, 1, 0);
        Vec3.transformQuat(v, v, q);
        expect(close(v.getComponent(0), -1)).toBe(true);
        expect(close(v.getComponent(1), 0)).toBe(true);
    });
});

describe("Vec2 aliasing", () => {
    test("add / subtract: out === a, out === b", () => {
        const a = Vec2.create(F32, 1, 2);
        const b = Vec2.create(F32, 10, 20);
        Vec2.add(a, a, b);
        expect(a.get()).toEqual([11, 22]);
        Vec2.subtract(b, a, b);
        expect(b.get()).toEqual([1, 2]);
    });

    test("rotate: out === v — reads x after writing x would corrupt y", () => {
        const v = Vec2.create(F32, 1, 0);
        Vec2.rotate(v, v, Math.PI / 2);
        expect(close(v.getComponent(0), 0)).toBe(true);
        expect(close(v.getComponent(1), 1)).toBe(true);
    });

    test("normalize / negate / scale: out === v", () => {
        const v = Vec2.create(F32, 3, 4);
        Vec2.normalize(v, v);
        expect(close(v.getComponent(0), 0.6)).toBe(true);
        Vec2.scale(v, v, 10);
        expect(close(v.getComponent(0), 6)).toBe(true);
        Vec2.negate(v, v);
        expect(close(v.getComponent(0), -6)).toBe(true);
    });

    test("lerp: out === a", () => {
        const a = Vec2.create(F32, 0, 0);
        const b = Vec2.create(F32, 10, 10);
        Vec2.lerp(a, a, b, 0.25);
        expect(a.get()).toEqual([2.5, 2.5]);
    });
});

describe("Vec4 aliasing", () => {
    test("add / subtract: out === a, out === b", () => {
        const a = Vec4.create(F32, 1, 2, 3, 4);
        const b = Vec4.create(F32, 10, 20, 30, 40);
        Vec4.add(a, a, b);
        expect(a.get()).toEqual([11, 22, 33, 44]);
        Vec4.subtract(b, a, b);
        expect(b.get()).toEqual([1, 2, 3, 4]);
    });

    test("multiply / divide / scale / negate: out === a", () => {
        const v = Vec4.create(F32, 2, 4, 8, 16);
        const w = Vec4.create(F32, 2, 2, 2, 2);
        Vec4.multiply(v, v, w);
        expect(v.get()).toEqual([4, 8, 16, 32]);
        Vec4.divide(v, v, w);
        expect(v.get()).toEqual([2, 4, 8, 16]);
        Vec4.scale(v, v, 0.5);
        expect(v.get()).toEqual([1, 2, 4, 8]);
        Vec4.negate(v, v);
        expect(v.get()).toEqual([-1, -2, -4, -8]);
    });

    test("normalize: out === v", () => {
        const v = Vec4.create(F32, 1, 1, 1, 1);
        Vec4.normalize(v, v);
        expect(close(v.getComponent(0), 0.5)).toBe(true);
    });

    test("lerp: out === b", () => {
        const a = Vec4.create(F32, 0, 0, 0, 0);
        const b = Vec4.create(F32, 10, 10, 10, 10);
        Vec4.lerp(b, a, b, 0.5);
        expect(b.get()).toEqual([5, 5, 5, 5]);
    });
});
