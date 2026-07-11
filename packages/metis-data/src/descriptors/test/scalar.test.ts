import { describe, expect, test } from "bun:test";
import {
    Bool,
    F16,
    F32,
    F64,
    I32,
    U32,
    type ScalarDescriptor,
} from "../index.ts";
import {
    GPU_BOOL,
    GPU_F16,
    GPU_F32,
    GPU_F64,
    GPU_I32,
    GPU_U32,
} from "../constants.ts";

// Scalar descriptors are frozen singletons. Their whole job is to report the
// right byte size / alignment / pitch and hand back a length-1 typed array over
// a region. These lock those numbers and the TypedArray flavour each yields.

describe("scalar descriptor metadata", () => {
    // [descriptor, gpuType, byteSize, alignment, arrayPitch]
    const cases = [
        [Bool, GPU_BOOL, 4, 4, 4],
        [I32, GPU_I32, 4, 4, 4],
        [U32, GPU_U32, 4, 4, 4],
        [F16, GPU_F16, 2, 2, 2],
        [F32, GPU_F32, 4, 4, 4],
        [F64, GPU_F64, 8, 8, 8],
    ] as const;

    for (const [desc, gpuType, byteSize, alignment, arrayPitch] of cases) {
        test(`${gpuType}: size/align/pitch`, () => {
            expect(desc.type).toBe(gpuType);
            expect(desc.byteSize).toBe(byteSize);
            expect(desc.alignment).toBe(alignment);
            expect(desc.arrayPitch).toBe(arrayPitch);
        });

        test(`${gpuType}: toString echoes the WGSL type`, () => {
            expect(desc.toString()).toBe(gpuType);
        });
    }
});

describe("scalar descriptor views", () => {
    test("each scalar yields the correct TypedArray flavour, length 1", () => {
        const buffer = new ArrayBuffer(8);
        expect(I32.view(buffer, 0)).toBeInstanceOf(Int32Array);
        expect(U32.view(buffer, 0)).toBeInstanceOf(Uint32Array);
        expect(Bool.view(buffer, 0)).toBeInstanceOf(Uint32Array);
        expect(F16.view(buffer, 0)).toBeInstanceOf(Float16Array);
        expect(F32.view(buffer, 0)).toBeInstanceOf(Float32Array);
        expect(F64.view(buffer, 0)).toBeInstanceOf(Float64Array);

        expect(F32.view(buffer, 0).length).toBe(1);
        expect(F64.view(buffer, 0).length).toBe(1);
    });

    test("view honours the byte offset and aliases the backing buffer", () => {
        const buffer = new ArrayBuffer(16);
        const a = F32.view(buffer, 4);
        const b = F32.view(buffer, 4);
        a[0] = 3.5;
        expect(b[0]).toBe(3.5); // same region, different views
        expect(a.byteOffset).toBe(4);
    });

    test("F16 truncates to half precision through its view", () => {
        const buffer = new ArrayBuffer(2);
        const v = F16.view(buffer, 0);
        v[0] = 1.5; // exactly representable in f16
        expect(v[0]).toBe(1.5);
        v[0] = 1.0000001; // rounds to 1 in half precision
        expect(v[0]).toBe(1);
    });

    test("F64 preserves precision a 32-bit float would lose", () => {
        const buffer = new ArrayBuffer(8);
        const v = F64.view(buffer, 0);
        const precise = 1.0000000001;
        v[0] = precise;
        expect(v[0]).toBe(precise);
        expect(new Float32Array([precise])[0]).not.toBe(precise);
    });
});

describe("scalar descriptors are the ScalarDescriptor union", () => {
    test("all six satisfy the ScalarDescriptor / Descriptor shape", () => {
        // Purely a compile-time assertion made runtime-visible: if any of these
        // stopped matching, tsc would fail before this ever runs.
        const all: ScalarDescriptor[] = [I32, U32, F16, F32, F64];
        expect(all).toHaveLength(5);
        // Bool is its own descriptor (boolean-valued), not in the numeric union.
        expect(Bool.type).toBe(GPU_BOOL);
    });
});
