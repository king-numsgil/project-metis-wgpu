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

    public view(): ReturnType<MatDescriptor<ScalarType, N>["view"]> {
        return this.type.view(this.buffer, this.offset);
    }

    public constructor(descriptor: MatDescriptor<ScalarType, N>, buffer: ArrayBuffer, offset: number) {
        this.type = descriptor;
        this.buffer = buffer;
        this.offset = offset;
    }

    public at(colIndex: ArrayIndices<TupleOf<N, number>>): VecMemoryBuffer<ScalarType, N> {
        return new VecMemoryBufferImpl(this.type.column, this.buffer, this.offset + (colIndex! * this.type.columnStride));
    }

    public get(colIndex: ArrayIndices<TupleOf<N, number>>): TupleOf<N, number> {
        return this.at(colIndex).get();
    }

    public set(colIndex: ArrayIndices<TupleOf<N, number>>, value: TupleOf<N, number>): void {
        this.at(colIndex).set(value);
    }
}
