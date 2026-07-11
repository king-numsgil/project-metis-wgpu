import { describe, expect, test } from "bun:test";
import { F32, F64, Mat, PackingType, Vec } from "../index.ts";
import { GPU_MAT2, GPU_MAT3, GPU_MAT4 } from "../constants.ts";

const Dense = PackingType.Dense;
const Std140 = PackingType.Std140;

// A matrix is modelled as N column-vectors laid end to end. Dense columns are
// tight; std140 columns each pad up to a 16-byte stride. layout.test.ts pins the
// F32 std140 mat sizes; here we cover the selector, dense packing, F64 columns,
// the derived `column` descriptor, col() bounds, and view() over the whole matrix.

describe("mat type selector and derived column descriptor", () => {
    test("N maps to the right GPU mat type", () => {
        expect(Mat(F32, 2).type).toBe(GPU_MAT2);
        expect(Mat(F32, 3).type).toBe(GPU_MAT3);
        expect(Mat(F32, 4).type).toBe(GPU_MAT4);
    });

    test("length is N*N (component count), packing is preserved", () => {
        expect(Mat(F32, 2).length).toBe(4);
        expect(Mat(F32, 3).length).toBe(9);
        expect(Mat(F32, 4).length).toBe(16);
        expect(Mat(F32, 4, Std140).packing).toBe(Std140);
    });

    test("column is a Vec of matching scalar / N / packing", () => {
        const m = Mat(F64, 3, Std140);
        expect(m.column.type).toBe(Vec(F64, 3).type);
        expect(m.column.scalar).toBe(F64);
        expect(m.column.length).toBe(3);
        expect(m.column.packing).toBe(Std140);
    });

    test("toString reads as matN<scalar>", () => {
        expect(Mat(F32, 4).toString()).toBe("mat4<f32>");
    });
});

describe("dense mat packing", () => {
    // [n, columnStride, byteSize, length] for F32 (scalarSize 4)
    const cases = [
        [2, 8, 16, 4],
        [3, 12, 36, 9],
        [4, 16, 64, 16],
    ] as const;

    for (const [n, columnStride, byteSize, length] of cases) {
        test(`mat${n}<f32> dense`, () => {
            const m = Mat(F32, n, Dense);
            expect(m.alignment).toBe(4); // scalar alignment
            expect(m.columnStride).toBe(columnStride);
            expect(m.byteSize).toBe(byteSize);
            expect(m.arrayPitch).toBe(byteSize); // dense: no 16-byte rounding
            expect(m.length).toBe(length);
        });
    }
});

describe("std140 mat packing with F64 columns", () => {
    test("mat2<f64>: 16-byte columns", () => {
        const m = Mat(F64, 2, Std140);
        expect([m.columnStride, m.byteSize, m.alignment, m.arrayPitch]).toEqual([16, 32, 16, 32]);
    });

    test("mat3<f64>: 24-byte column pads to 32", () => {
        const m = Mat(F64, 3, Std140);
        expect([m.columnStride, m.byteSize, m.alignment, m.arrayPitch]).toEqual([32, 96, 32, 96]);
    });

    test("mat4<f64>: 32-byte columns", () => {
        const m = Mat(F64, 4, Std140);
        expect([m.columnStride, m.byteSize, m.alignment, m.arrayPitch]).toEqual([32, 128, 32, 128]);
    });
});

describe("mat col()", () => {
    test("returns an N-length column view at the right stride offset", () => {
        const m = Mat(F32, 4, Std140); // columnStride 16
        const buffer = new ArrayBuffer(m.byteSize);
        const col2 = m.col(buffer, 0, 2);
        expect(col2).toBeInstanceOf(Float32Array);
        expect(col2.length).toBe(4);
        expect(col2.byteOffset).toBe(2 * 16);
    });

    test("honours the base offset", () => {
        const m = Mat(F32, 3, Dense); // columnStride 12
        const buffer = new ArrayBuffer(64);
        expect(m.col(buffer, 16, 1).byteOffset).toBe(16 + 12);
    });

    test("out-of-range column index throws RangeError", () => {
        const m = Mat(F32, 4);
        const buffer = new ArrayBuffer(m.byteSize);
        // @ts-expect-error — the type restricts the index; we're testing the runtime guard
        expect(() => m.col(buffer, 0, -1)).toThrow(RangeError);
        // @ts-expect-error — the type restricts the index; we're testing the runtime guard
        expect(() => m.col(buffer, 0, 4)).toThrow(RangeError);
        expect(() => m.col(buffer, 0, 0)).not.toThrow();
        expect(() => m.col(buffer, 0, 3)).not.toThrow();
    });
});

describe("mat view()", () => {
    test("dense view spans every component (N*N)", () => {
        const m = Mat(F32, 4, Dense);
        const view = m.view(new ArrayBuffer(m.byteSize), 0);
        expect(view.length).toBe(16);
    });

    test("std140 view spans the full padded region (includes column padding)", () => {
        // mat3<f32> std140 is 48 bytes = 12 f32 (9 real + 3 padding). The flat
        // view covers the whole allocation so it never reads out of bounds.
        const m = Mat(F32, 3, Std140);
        const view = m.view(new ArrayBuffer(m.byteSize), 0);
        expect(view.length).toBe(m.byteSize / 4);
        expect(view.length).toBe(12);
    });
});
