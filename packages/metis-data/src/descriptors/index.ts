import type { IntRange } from "type-fest";
import { ArrayDescriptorImpl } from "./array.ts";
import { BoolDescriptorImpl } from "./bool.ts";

import {
    GPU_ARRAY,
    GPU_BOOL,
    GPU_F16,
    GPU_F32,
    GPU_F64,
    GPU_I32,
    GPU_MAT2,
    GPU_MAT3,
    GPU_MAT4,
    GPU_STRUCT,
    GPU_U32,
    GPU_VEC2,
    GPU_VEC3,
    GPU_VEC4,
    type GPUType,
} from "./constants.ts";
import { F16DescriptorImpl } from "./f16.ts";
import { F32DescriptorImpl } from "./f32.ts";
import { F64DescriptorImpl } from "./f64.ts";
import { I32DescriptorImpl } from "./i32.ts";
import { MatDescriptorImpl } from "./mat.ts";

import { StructDescriptorImpl } from "./struct.ts";
import { U32DescriptorImpl } from "./u32.ts";
import { VecDescriptorImpl } from "./vec.ts";

export type DescriptorTypedArray =
    | Uint8Array
    | Int32Array
    | Uint32Array
    | Float16Array
    | Float32Array
    | Float64Array;

export enum PackingType {
    Dense,
    Std140,
    Std430,
}

export interface Descriptor<MemoryType extends DescriptorTypedArray> {
    readonly type: GPUType;
    readonly byteSize: number;
    readonly alignment: number;
    readonly arrayPitch: number;

    toString(): string;

    view(buffer: ArrayBuffer, offset: number): MemoryType;
}

export type DescriptorMemoryType<T> = T extends Descriptor<infer MemoryType>
    ? MemoryType
    : never;

export const Bool: BoolDescriptor = new BoolDescriptorImpl();
export const I32: I32Descriptor = new I32DescriptorImpl();
export const U32: U32Descriptor = new U32DescriptorImpl();
export const F16: F16Descriptor = new F16DescriptorImpl();
export const F32: F32Descriptor = new F32DescriptorImpl();
export const F64: F64Descriptor = new F64DescriptorImpl();

export function Vec<
    ScalarType extends ScalarDescriptor,
    N extends 2 | 3 | 4,
>(
    scalarDescriptor: ScalarType,
    n: N,
    packingType: PackingType = PackingType.Dense,
): VecDescriptor<ScalarType, N> {
    return new VecDescriptorImpl<ScalarType, N>(scalarDescriptor, n, packingType);
}

export function Mat<
    ScalarType extends ScalarDescriptor,
    N extends 2 | 3 | 4,
>(
    scalarDescriptor: ScalarType,
    n: N,
    packingType: PackingType = PackingType.Dense,
): MatDescriptor<ScalarType, N> {
    return new MatDescriptorImpl<ScalarType, N>(scalarDescriptor, n, packingType);
}

export function ArrayOf<
    ItemType extends Descriptor<DescriptorTypedArray>,
    N extends number,
>(
    itemDescriptor: ItemType,
    length: N,
    packingType: PackingType = PackingType.Dense,
): ArrayDescriptor<ItemType, N> {
    return new ArrayDescriptorImpl<ItemType, N>(itemDescriptor, length, packingType);
}

export function StructOf<
    Members extends Record<string, Descriptor<DescriptorTypedArray>>,
>(
    members: Members,
    packingType: PackingType = PackingType.Dense,
): StructDescriptor<Members> {
    return new StructDescriptorImpl<Members>(members, packingType);
}

export interface BoolDescriptor extends Descriptor<Uint32Array> {
    readonly type: typeof GPU_BOOL;
    readonly byteSize: 4;
    readonly alignment: 4;
    readonly arrayPitch: 4;
}

export interface I32Descriptor extends Descriptor<Int32Array> {
    readonly type: typeof GPU_I32;
    readonly byteSize: 4;
    readonly alignment: 4;
    readonly arrayPitch: 4;
}

export interface U32Descriptor extends Descriptor<Uint32Array> {
    readonly type: typeof GPU_U32;
    readonly byteSize: 4;
    readonly alignment: 4;
    readonly arrayPitch: 4;
}

export interface F16Descriptor extends Descriptor<Float16Array> {
    readonly type: typeof GPU_F16;
    readonly byteSize: 2;
    readonly alignment: 2;
    readonly arrayPitch: 2;
}

export interface F32Descriptor extends Descriptor<Float32Array> {
    readonly type: typeof GPU_F32;
    readonly byteSize: 4;
    readonly alignment: 4;
    readonly arrayPitch: 4;
}

export interface F64Descriptor extends Descriptor<Float64Array> {
    readonly type: typeof GPU_F64;
    readonly byteSize: 8;
    readonly alignment: 8;
    readonly arrayPitch: 8;
}

export type ScalarDescriptor =
    | I32Descriptor
    | U32Descriptor
    | F16Descriptor
    | F32Descriptor
    | F64Descriptor;

export type VectorTypeSelector<N extends number = 2 | 3 | 4> =
    N extends 2 ? typeof GPU_VEC2 :
        N extends 3 ? typeof GPU_VEC3 :
            N extends 4 ? typeof GPU_VEC4 :
                never;

export interface VecDescriptor<
    ScalarType extends ScalarDescriptor,
    N extends 2 | 3 | 4,
> extends Descriptor<DescriptorMemoryType<ScalarType>> {
    readonly type: VectorTypeSelector<N>;
    readonly scalar: ScalarType;
    readonly byteSize: number;
    readonly alignment: number;
    readonly arrayPitch: number;
    readonly length: N;
    readonly packing: PackingType;
}

export type MatrixTypeSelector<N extends number = 2 | 3 | 4> =
    N extends 2 ? typeof GPU_MAT2 :
        N extends 3 ? typeof GPU_MAT3 :
            N extends 4 ? typeof GPU_MAT4 :
                never;

export interface MatDescriptor<
    ScalarType extends ScalarDescriptor,
    N extends 2 | 3 | 4,
> extends Descriptor<DescriptorMemoryType<ScalarType>> {
    readonly type: MatrixTypeSelector<N>;
    readonly scalar: ScalarType;
    readonly column: VecDescriptor<ScalarType, N>;
    readonly columnStride: number;
    readonly byteSize: number;
    readonly alignment: number;
    readonly arrayPitch: number;
    readonly length: number;
    readonly packing: PackingType;

    col(buffer: ArrayBuffer, offset: number, index: IntRange<0, N>): DescriptorMemoryType<ScalarType>;
}

export interface ArrayDescriptor<
    ItemType extends Descriptor<DescriptorTypedArray>,
    N extends number,
> extends Descriptor<DescriptorMemoryType<ItemType>> {
    readonly type: typeof GPU_ARRAY;
    readonly item: ItemType;
    readonly length: N;
    readonly byteSize: number;
    readonly alignment: number;
    readonly arrayPitch: number;
    readonly packing: PackingType;

    offsetAt(index: number): number;

    at(buffer: ArrayBuffer, offset: number, index: number): DescriptorMemoryType<ItemType>;
}

export interface StructDescriptor<
    Members extends Record<string, Descriptor<DescriptorTypedArray>>,
> extends Descriptor<Uint8Array> {
    readonly type: typeof GPU_STRUCT;
    readonly members: Members;
    readonly offsets: Record<keyof Members, number>;
    readonly packing: PackingType;

    offsetOf<K extends keyof Members>(name: K): number;

    member<K extends keyof Members>(
        buffer: ArrayBuffer,
        offset: number,
        name: K,
    ): DescriptorMemoryType<Members[K]>;
}
