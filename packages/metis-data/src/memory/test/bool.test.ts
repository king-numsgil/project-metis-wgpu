import { describe, expect, test } from "bun:test";
import { Bool } from "../../descriptors";
import { allocate, wrap } from "../index.ts";

// Bool is stored as a uint32 and reported as `stored !== 0`. The interesting
// behaviour is the boolean<->uint32 boundary in both directions.

describe("bool get/set", () => {
    test("true writes 1, false writes 0", () => {
        const b = allocate(Bool);
        b.set(true);
        expect(b.get()).toBe(true);
        expect(b.view()[0]).toBe(1);

        b.set(false);
        expect(b.get()).toBe(false);
        expect(b.view()[0]).toBe(0);
    });

    test("any nonzero stored uint32 reads back as true", () => {
        const b = allocate(Bool);
        b.view()[0] = 5; // written out-of-band, not via set()
        expect(b.get()).toBe(true);
        b.view()[0] = 0;
        expect(b.get()).toBe(false);
    });

    test("occupies 4 bytes", () => {
        expect(allocate(Bool).buffer.byteLength).toBe(4);
    });
});

describe("bool over a wrapped buffer", () => {
    test("reads/writes at the given offset without touching neighbours", () => {
        const backing = new ArrayBuffer(12);
        const flag = wrap(Bool, backing, 4);
        flag.set(true);
        const words = new Uint32Array(backing);
        expect(words[0]).toBe(0); // untouched
        expect(words[1]).toBe(1); // the flag at offset 4
        expect(words[2]).toBe(0); // untouched
    });
});
