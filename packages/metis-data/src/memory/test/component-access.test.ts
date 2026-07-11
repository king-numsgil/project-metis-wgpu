import { describe, expect, test } from "bun:test";
import { ArrayOf, F32, StructOf, Vec } from "../../descriptors";
import { Vec3 } from "../../math";
import { allocate } from "../index.ts";

// getComponent/setComponent are the no-tuple accessors on vec buffers, and a
// couple of guards that the convenient API returns independent buffers (nothing
// shared/aliased) — the property the removed cursor experiment traded away.

describe("component accessors (getComponent / setComponent)", () => {
    test("read/write a single component, agreeing with get()/set()", () => {
        const v = allocate(Vec(F32, 3));
        v.set([1, 2, 3]);
        expect(v.getComponent(0)).toBe(1);
        expect(v.getComponent(2)).toBe(3);

        v.setComponent(1, 20);
        expect(v.get()).toEqual([1, 20, 3]);
        expect(v.getComponent(1)).toBe(20);
    });

    test("work on a vec reached through struct.get()", () => {
        const s = allocate(StructOf({ pos: Vec(F32, 3) }));
        const pos = s.get("pos");
        pos.setComponent(2, 9);
        expect(pos.get()).toEqual([0, 0, 9]);
    });
});

describe("vec buffers flow through the math library", () => {
    test("Vec3.add over allocated buffers writes through", () => {
        const a = allocate(Vec(F32, 3));
        a.set([1, 2, 3]);
        Vec3.add(a, a, Vec3.create(F32, 10, 20, 30));
        expect(a.get()).toEqual([11, 22, 33]);
    });
});

describe("convenient API returns independent buffers", () => {
    test("at() is fresh each call", () => {
        const arr = allocate(ArrayOf(Vec(F32, 2), 3));
        expect(arr.at(0)).not.toBe(arr.at(0));
    });

    test("[...arr] spreads independent elements", () => {
        const arr = allocate(ArrayOf(Vec(F32, 2), 3));
        arr.at(1).set([2, 2]);
        const spread = [...arr];
        expect(spread[0]).not.toBe(spread[1]);
        spread[0]!.set([9, 9]);
        expect(spread[1]!.get()).toEqual([2, 2]); // untouched
    });

    test("struct.get() is fresh each call", () => {
        const s = allocate(StructOf({ a: Vec(F32, 2), b: Vec(F32, 2) }));
        expect(s.get("a")).not.toBe(s.get("a"));
    });
});
