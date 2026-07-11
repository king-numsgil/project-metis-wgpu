import { describe, expect, test } from "bun:test";
import { ArrayOf, F32, F64, Mat, PackingType, StructOf, U32, Vec } from "../index.ts";
import { GPU_STRUCT } from "../constants.ts";

const Dense = PackingType.Dense;
const Std140 = PackingType.Std140;

// layout.test.ts pins the std140 gap-packing edge cases ({vec3,f32} etc). This
// file covers member offset math generally, the offsets/member accessors and
// their error paths, alignment rounding, nesting, and the packing guard on
// array/mat members (which layout.test only exercises for vec/mat).

describe("dense struct layout", () => {
    test("vertex-style struct packs members in definition order", () => {
        const s = StructOf({
            position: Vec(F32, 3),
            uv: Vec(F32, 2),
            normal: Vec(F32, 3),
        });
        expect(s.offsetOf("position")).toBe(0);
        expect(s.offsetOf("uv")).toBe(12);
        expect(s.offsetOf("normal")).toBe(20);
        expect(s.byteSize).toBe(32);
        expect(s.alignment).toBe(4); // max member alignment (all scalar-4)
    });

    test("a wider scalar bumps both member alignment and struct size", () => {
        const s = StructOf({ a: F32, b: F64 });
        expect(s.offsetOf("a")).toBe(0);
        expect(s.offsetOf("b")).toBe(8); // F64 aligned to 8, not 4
        expect(s.alignment).toBe(8);
        expect(s.byteSize).toBe(16); // rounded up to alignment
    });

    test("type / packing / members are reported", () => {
        const s = StructOf({ a: F32 });
        expect(s.type).toBe(GPU_STRUCT);
        expect(s.packing).toBe(Dense);
        expect(s.members.a).toBe(F32);
    });
});

describe("std140 struct layout", () => {
    test("{ mat4, vec4 } → color at 64, size 80, align 16", () => {
        const s = StructOf(
            { mvp: Mat(F32, 4, Std140), color: Vec(F32, 4, Std140) },
            Std140,
        );
        expect(s.offsetOf("mvp")).toBe(0);
        expect(s.offsetOf("color")).toBe(64);
        expect(s.byteSize).toBe(80);
        expect(s.alignment).toBe(16);
        expect(s.arrayPitch).toBe(80); // already a multiple of 16
    });

    test("struct alignment is rounded up to 16 even for all-scalar members", () => {
        const s = StructOf({ a: F32, b: U32 }, Std140);
        expect(s.alignment).toBe(16);
        expect(s.byteSize).toBe(16); // two scalars padded up to the 16 alignment
    });
});

describe("offsets accessor is a defensive copy", () => {
    test("mutating the returned object does not corrupt the descriptor", () => {
        const s = StructOf({ a: F32, b: F32 });
        const offsets = s.offsets;
        expect(offsets).toEqual({ a: 0, b: 4 });
        (offsets as Record<string, number>).a = 999;
        expect(s.offsetOf("a")).toBe(0); // descriptor unaffected
        expect(s.offsets.a).toBe(0);
    });
});

describe("member accessors reject unknown names", () => {
    test("offsetOf throws for a missing member", () => {
        const s = StructOf({ a: F32 });
        // @ts-expect-error — "nope" is not a member key
        expect(() => s.offsetOf("nope")).toThrow(/does not exist/);
    });

    test("member() throws for a missing member", () => {
        const s = StructOf({ a: F32 });
        const buffer = new ArrayBuffer(s.byteSize);
        // @ts-expect-error — "nope" is not a member key
        expect(() => s.member(buffer, 0, "nope")).toThrow(/does not exist/);
    });

    test("member() returns the member's view at struct-offset + member-offset", () => {
        const s = StructOf({ a: F32, b: Vec(F32, 3) });
        const buffer = new ArrayBuffer(64);
        const bView = s.member(buffer, 16, "b");
        expect(bView).toBeInstanceOf(Float32Array);
        expect(bView.length).toBe(3);
        expect(bView.byteOffset).toBe(16 + s.offsetOf("b"));
    });
});

describe("nested structs", () => {
    test("an inner struct is aligned and sized as a member", () => {
        const inner = StructOf({ x: F32, y: F32 }); // size 8, align 4
        const outer = StructOf({ tag: U32, inner });
        expect(outer.offsetOf("tag")).toBe(0);
        expect(outer.offsetOf("inner")).toBe(4);
        expect(outer.byteSize).toBe(12);
    });

    test("view() returns the whole struct as a byteSize-length Uint8Array", () => {
        const s = StructOf({ a: F32, b: F32 });
        const view = s.view(new ArrayBuffer(s.byteSize), 0);
        expect(view).toBeInstanceOf(Uint8Array);
        expect(view.length).toBe(s.byteSize);
    });
});

describe("std140 packing guard (array & mat members)", () => {
    test("a Dense array member inside a Std140 struct throws", () => {
        expect(() => StructOf({ a: ArrayOf(F32, 4, Dense) }, Std140)).toThrow(/must be Std140|Std140/);
    });

    test("a Dense mat member inside a Std140 struct throws", () => {
        expect(() => StructOf({ m: Mat(F32, 4, Dense) }, Std140)).toThrow(/must be Std140/);
    });

    test("all-Std140 array & mat members are accepted", () => {
        expect(() =>
            StructOf(
                { a: ArrayOf(F32, 4, Std140), m: Mat(F32, 4, Std140) },
                Std140,
            ),
        ).not.toThrow();
    });
});

describe("toString", () => {
    test("lists members with their own toString", () => {
        const s = StructOf({ pos: Vec(F32, 3), id: U32 });
        expect(s.toString()).toBe("struct { pos: vec3<f32>, id: u32 }");
    });
});
