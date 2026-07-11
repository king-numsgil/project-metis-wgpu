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

    public view(): ReturnType<VecDescriptor<ScalarType, N>["view"]> {
        return this.type.view(this.buffer, this.offset);
    }

    public constructor(descriptor: VecDescriptor<ScalarType, N>, buffer: ArrayBuffer, offset: number) {
        this.type = descriptor;
        this.buffer = buffer;
        this.offset = offset;
    }

    public at(index: ArrayIndices<TupleOf<N, number>>): ScalarMemoryBuffer<ScalarType> {
        return new ScalarMemoryBufferImpl(this.type.scalar, this.buffer, this.offset + (index! * this.type.scalar.byteSize));
    }

    public get(): TupleOf<N, number> {
        return Array.from(this.view()) as TupleOf<N, number>;
    }

    public set(value: TupleOf<N, number>): void {
        this.view().set(value);
    }
}
