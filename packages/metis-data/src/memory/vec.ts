import type { ArrayIndices, TupleOf } from "type-fest";

import type { ScalarDescriptor, VecDescriptor } from "../descriptors";
import type { ScalarMemoryBuffer, VecMemoryBuffer } from "./index.ts";
import { ScalarMemoryBufferImpl } from "./scalar.ts";

export class VecMemoryBufferImpl<
    ScalarType extends ScalarDescriptor,
    N extends 2 | 3 | 4,
> implements VecMemoryBuffer<ScalarType, N> {
    public readonly type: VecDescriptor<ScalarType, N>;
    public readonly buffer: ArrayBuffer;
    public readonly offset: number;
    private readonly _view: ReturnType<VecDescriptor<ScalarType, N>["view"]>;
    private readonly _n: number;
    private readonly _scalarBytes: number;

    public constructor(descriptor: VecDescriptor<ScalarType, N>, buffer: ArrayBuffer, offset: number) {
        this.type = descriptor;
        this.buffer = buffer;
        this.offset = offset;
        this._view = descriptor.view(buffer, offset);
        this._n = descriptor.length as number;
        this._scalarBytes = descriptor.scalar.byteSize;
    }

    public view(): ReturnType<VecDescriptor<ScalarType, N>["view"]> {
        return this._view;
    }

    public at(index: ArrayIndices<TupleOf<N, number>>): ScalarMemoryBuffer<ScalarType> {
        return new ScalarMemoryBufferImpl(this.type.scalar, this.buffer, this.offset + index! * this._scalarBytes);
    }

    public get(): TupleOf<N, number> {
        const view = this._view;
        const out = new Array<number>(this._n);
        for (let i = 0; i < this._n; i++) {
            out[i] = view[i]! as number;
        }
        return out as TupleOf<N, number>;
    }

    public set(value: TupleOf<N, number>): void {
        this._view.set(value);
    }

    /** Read a single component without allocating a tuple. */
    public getComponent(index: number): number {
        return this._view[index]! as number;
    }

    /** Write a single component without allocating a tuple. */
    public setComponent(index: number, value: number): void {
        this._view[index] = value;
    }
}
