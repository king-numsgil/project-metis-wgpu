import type { ArrayIndices, TupleOf } from "type-fest";
import type {
    ArrayDescriptor,
    BoolDescriptor,
    Descriptor,
    DescriptorMemoryType,
    DescriptorTypedArray,
    MatDescriptor,
    ScalarDescriptor,
    StructDescriptor,
    VecDescriptor,
} from "../descriptors";

import {
    GPU_ARRAY,
    GPU_BOOL,
    GPU_MAT2,
    GPU_MAT3,
    GPU_MAT4,
    GPU_STRUCT,
    GPU_VEC2,
    GPU_VEC3,
    GPU_VEC4,
} from "../descriptors/constants.ts";
import { ArrayMemoryBufferImpl } from "./array.ts";
import { BoolMemoryBufferImpl } from "./bool.ts";
import { MatMemoryBufferImpl } from "./mat.ts";

import { ScalarMemoryBufferImpl } from "./scalar.ts";
import { StructMemoryBufferImpl } from "./struct.ts";
import { VecMemoryBufferImpl } from "./vec.ts";

export interface MemoryBuffer<
    Type extends Descriptor<DescriptorTypedArray>,
> {
    readonly type: Type;
    readonly buffer: ArrayBuffer;
    readonly offset: number;

    view(): ReturnType<Type["view"]>;
}

export type DescriptorToMemoryBuffer<T extends Descriptor<DescriptorTypedArray>> =
    T extends BoolDescriptor ? BoolMemoryBuffer :
        T extends ScalarDescriptor ? ScalarMemoryBuffer<T> :
            T extends VecDescriptor<infer S, infer N> ? VecMemoryBuffer<S, N> :
                T extends MatDescriptor<infer S, infer N> ? MatMemoryBuffer<S, N> :
                    T extends ArrayDescriptor<infer Item, infer N> ? ArrayMemoryBuffer<Item, N> :
                        T extends StructDescriptor<infer Members> ? StructMemoryBuffer<Members> :
                            never;

export type DescriptorValueType<T extends Descriptor<DescriptorTypedArray>> =
    T extends BoolDescriptor ? boolean :
        T extends ScalarDescriptor ? number :
            T extends VecDescriptor<ScalarDescriptor, infer N> ? TupleOf<N, number> :
                T extends MatDescriptor<ScalarDescriptor, infer N> ? TupleOf<N, TupleOf<N, number>> :
                    T extends ArrayDescriptor<infer Item, infer N> ? TupleOf<N, DescriptorValueType<Item>> :
                        T extends StructDescriptor<infer Members> ? { [K in keyof Members]: DescriptorValueType<Members[K]> } :
                            never;

export interface ScalarMemoryBuffer<
    ScalarType extends ScalarDescriptor,
> extends MemoryBuffer<ScalarType> {
    get(): number;

    set(value: number): void;
}

export interface BoolMemoryBuffer extends MemoryBuffer<BoolDescriptor> {
    get(): boolean;

    set(value: boolean): void;
}

export interface VecMemoryBuffer<
    ScalarType extends ScalarDescriptor,
    N extends 2 | 3 | 4,
> extends MemoryBuffer<VecDescriptor<ScalarType, N>> {
    at(index: ArrayIndices<TupleOf<N, number>>): ScalarMemoryBuffer<ScalarType>;

    get(): TupleOf<N, number>;

    set(value: TupleOf<N, number>): void;
}

export interface MatMemoryBuffer<
    ScalarType extends ScalarDescriptor,
    N extends 2 | 3 | 4,
> extends MemoryBuffer<MatDescriptor<ScalarType, N>> {
    at(colIndex: ArrayIndices<TupleOf<N, number>>): VecMemoryBuffer<ScalarType, N>;

    get(colIndex: ArrayIndices<TupleOf<N, number>>): TupleOf<N, number>;

    set(colIndex: ArrayIndices<TupleOf<N, number>>, value: TupleOf<N, number>): void;
}

export interface ArrayMemoryBuffer<
    ItemType extends Descriptor<DescriptorTypedArray>,
    N extends number,
> extends MemoryBuffer<ArrayDescriptor<ItemType, N>> {
    view(): DescriptorMemoryType<ItemType>;

    at(index: number): DescriptorToMemoryBuffer<ItemType>;

    [Symbol.iterator](): Iterator<DescriptorToMemoryBuffer<ItemType>>;
}

export interface StructMemoryBuffer<
    Members extends Record<string, Descriptor<DescriptorTypedArray>>,
> extends MemoryBuffer<StructDescriptor<Members>> {
    readonly members: Members;

    get<K extends keyof Members>(name: K): DescriptorToMemoryBuffer<Members[K]>;

    set(value: { [K in keyof Members]: DescriptorValueType<Members[K]> }): void;
}

export function allocate(descriptor: BoolDescriptor): BoolMemoryBuffer;
export function allocate<ScalarType extends ScalarDescriptor>(
    descriptor: ScalarType,
): ScalarMemoryBuffer<ScalarType>;
export function allocate<ScalarType extends ScalarDescriptor, N extends 2 | 3 | 4>(
    descriptor: VecDescriptor<ScalarType, N>,
): VecMemoryBuffer<ScalarType, N>;
export function allocate<ScalarType extends ScalarDescriptor, N extends 2 | 3 | 4>(
    descriptor: MatDescriptor<ScalarType, N>,
): MatMemoryBuffer<ScalarType, N>;
export function allocate<
    ItemType extends Descriptor<DescriptorTypedArray>,
    N extends number,
>(
    descriptor: ArrayDescriptor<ItemType, N>,
): ArrayMemoryBuffer<ItemType, N>;
export function allocate<
    Members extends Record<string, Descriptor<DescriptorTypedArray>>,
>(
    descriptor: StructDescriptor<Members>,
): StructMemoryBuffer<Members>;

export function allocate(
    descriptor: Descriptor<DescriptorTypedArray>,
):
    | BoolMemoryBuffer
    | ScalarMemoryBuffer<ScalarDescriptor>
    | VecMemoryBuffer<ScalarDescriptor, 2 | 3 | 4>
    | MatMemoryBuffer<ScalarDescriptor, 2 | 3 | 4>
    | ArrayMemoryBuffer<Descriptor<DescriptorTypedArray>, number>
    | StructMemoryBuffer<Record<string, Descriptor<DescriptorTypedArray>>> {
    const buffer = new ArrayBuffer(descriptor.byteSize);
    switch (descriptor.type) {
        case GPU_BOOL:
            return new BoolMemoryBufferImpl(
                descriptor as BoolDescriptor,
                buffer,
                0,
            );
        case GPU_VEC2:
        case GPU_VEC3:
        case GPU_VEC4:
            return new VecMemoryBufferImpl(
                descriptor as VecDescriptor<ScalarDescriptor, 2 | 3 | 4>,
                buffer,
                0,
            );
        case GPU_MAT2:
        case GPU_MAT3:
        case GPU_MAT4:
            return new MatMemoryBufferImpl(
                descriptor as MatDescriptor<ScalarDescriptor, 2 | 3 | 4>,
                buffer,
                0,
            );
        case GPU_ARRAY:
            return new ArrayMemoryBufferImpl(
                descriptor as ArrayDescriptor<Descriptor<DescriptorTypedArray>, number>,
                buffer,
                0,
            );
        case GPU_STRUCT:
            return new StructMemoryBufferImpl(
                descriptor as StructDescriptor<Record<string, Descriptor<DescriptorTypedArray>>>,
                buffer,
                0,
            );
        default:
            return new ScalarMemoryBufferImpl(
                descriptor as ScalarDescriptor,
                buffer,
                0,
            );
    }
}

export function wrap<T extends Descriptor<DescriptorTypedArray>>(
    descriptor: T,
    buffer: ArrayBuffer,
    offset: number,
): DescriptorToMemoryBuffer<T> {
    switch (descriptor.type) {
        case GPU_BOOL:
            return new BoolMemoryBufferImpl(descriptor as any, buffer, offset) as any;
        case GPU_VEC2:
        case GPU_VEC3:
        case GPU_VEC4:
            return new VecMemoryBufferImpl(descriptor as any, buffer, offset) as any;
        case GPU_MAT2:
        case GPU_MAT3:
        case GPU_MAT4:
            return new MatMemoryBufferImpl(descriptor as any, buffer, offset) as any;
        case GPU_ARRAY:
            return new ArrayMemoryBufferImpl(descriptor as any, buffer, offset) as any;
        case GPU_STRUCT:
            return new StructMemoryBufferImpl(descriptor as any, buffer, offset) as any;
        default:
            return new ScalarMemoryBufferImpl(descriptor as any, buffer, offset) as any;
    }
}
