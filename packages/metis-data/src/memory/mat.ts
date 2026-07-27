import type { ArrayIndices, TupleOf } from "type-fest";

import type { MatDescriptor, ScalarDescriptor } from "../descriptors";
import type { MatMemoryBuffer, VecMemoryBuffer } from "./index.ts";
import { VecMemoryBufferImpl } from "./vec.ts";

export class MatMemoryBufferImpl<
    ScalarType extends ScalarDescriptor,
    N extends 2 | 3 | 4,
> implements MatMemoryBuffer<ScalarType, N> {
    public readonly type: MatDescriptor<ScalarType, N>;
    public readonly buffer: ArrayBuffer;
    public readonly offset: number;
    private readonly _view: ReturnType<MatDescriptor<ScalarType, N>["view"]>;
    private readonly _columnElements: number;
    /** N — rows per column, i.e. the matrix dimension. */
    private readonly _n: number;

    public constructor(descriptor: MatDescriptor<ScalarType, N>, buffer: ArrayBuffer, offset: number) {
        this.type = descriptor;
        this.buffer = buffer;
        this.offset = offset;
        // Cached, mirroring VecMemoryBufferImpl. This used to re-derive a fresh
        // TypedArray on every view() call, which meant every math op that walked
        // a matrix allocated once per access — Mat4.multiply alone reached ~24
        // allocations. The region is fixed at construction, so caching is sound.
        this._view = descriptor.view(buffer, offset);
        this._columnElements = descriptor.columnStride / descriptor.scalar.byteSize;
        this._n = descriptor.column.length as number;
    }

    public view(): ReturnType<MatDescriptor<ScalarType, N>["view"]> {
        return this._view;
    }

    /**
     * Stride between columns measured in **scalar elements** of `view()`, not
     * bytes — so component (col, row) is `view()[col * columnElements + row]`.
     * Under Std140 a `Mat3` pads its columns to 4 elements, so this is not
     * always N.
     */
    public get columnElements(): number {
        return this._columnElements;
    }

    public at(colIndex: ArrayIndices<TupleOf<N, number>>): VecMemoryBuffer<ScalarType, N> {
        return new VecMemoryBufferImpl(this.type.column, this.buffer, this.offset + colIndex! * this.type.columnStride);
    }

    /**
     * A column as a detached tuple.
     *
     * Reads the cached view directly rather than going through `at()`. It used
     * to do `this.at(col).get()`, which minted a whole `VecMemoryBufferImpl`
     * (and its TypedArray view) purely to read N numbers out of it — so every
     * matrix op paid two allocations per column access instead of one. The
     * remaining allocation is the returned tuple, which is the documented
     * contract and can't go away.
     */
    public get(colIndex: ArrayIndices<TupleOf<N, number>>): TupleOf<N, number> {
        const view = this._view;
        const base = colIndex! * this._columnElements;
        const out = new Array<number>(this._n);
        for (let i = 0; i < this._n; i++) {
            out[i] = view[base + i] as number;
        }
        return out as TupleOf<N, number>;
    }

    /**
     * Write a column from a tuple. Writes through the cached view — the only
     * allocation left is the array literal the caller passes in.
     */
    public set(colIndex: ArrayIndices<TupleOf<N, number>>, value: TupleOf<N, number>): void {
        const view = this._view;
        const base = colIndex! * this._columnElements;
        for (let i = 0; i < this._n; i++) {
            view[base + i] = value[i] as number;
        }
    }
}
