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
} from "./constants.ts";
import {
    type ArrayDescriptor,
    type Descriptor,
    type DescriptorMemoryType,
    type DescriptorTypedArray,
    PackingType,
} from "./index.ts";

type TypedArrayConstructor =
    | typeof Float16Array
    | typeof Float32Array
    | typeof Float64Array
    | typeof Int32Array
    | typeof Uint32Array
    | typeof Uint8Array;

const TYPED_ARRAY_CONSTRUCTORS: Record<string, TypedArrayConstructor> = {
    [GPU_F16]: Float16Array,
    [GPU_F32]: Float32Array,
    [GPU_F64]: Float64Array,
    [GPU_I32]: Int32Array,
    [GPU_U32]: Uint32Array,
    [GPU_BOOL]: Uint32Array,
    [GPU_STRUCT]: Uint8Array,
};

function alignTo(value: number, alignment: number): number {
    if (!Number.isFinite(value) || !Number.isFinite(alignment) || alignment <= 0) {
        throw new RangeError(`Invalid alignment request: value=${value}, alignment=${alignment}`);
    }
    return Math.ceil(value / alignment) * alignment;
}

export class ArrayDescriptorImpl<
    ItemType extends Descriptor<DescriptorTypedArray>,
    N extends number,
> implements ArrayDescriptor<ItemType, N> {
    private readonly _itemDescriptor: ItemType;
    private readonly _length: N;
    private readonly _byteSize: number;
    private readonly _alignment: number;
    private readonly _arrayPitch: number;
    private readonly _packing: PackingType;

    constructor(itemDescriptor: ItemType, length: N, packingType: PackingType = PackingType.Dense) {
        this._itemDescriptor = itemDescriptor;
        this._length = length;
        this._packing = packingType;
        if (packingType === PackingType.Std140) {
            // std140 arrays: base alignment and element stride are both rounded up to a
            // multiple of 16 (the vec4 boundary), whatever the element type.
            this._alignment = alignTo(itemDescriptor.alignment, 16);
            this._arrayPitch = alignTo(itemDescriptor.byteSize, 16);
        } else {
            // Dense and std430 arrays both stride by the element's own alignment — no
            // 16-byte rounding. The two differ only through the element descriptor's
            // alignment (a std430 vec3 aligns to 16, a dense vec3 to 4), so the same
            // formula yields the right stride for each.
            this._alignment = itemDescriptor.alignment;
            this._arrayPitch = alignTo(itemDescriptor.byteSize, itemDescriptor.alignment);
        }
        this._byteSize = length * this._arrayPitch;
    }

    public get type(): typeof GPU_ARRAY {
        return GPU_ARRAY;
    }

    public get item(): ItemType {
        return this._itemDescriptor;
    }

    public get length(): N {
        return this._length;
    }

    public get packing(): PackingType {
        return this._packing;
    }

    public get byteSize(): number {
        return this._byteSize;
    }

    public get alignment(): number {
        return this._alignment;
    }

    public get arrayPitch(): number {
        return this._arrayPitch;
    }

    public offsetAt(index: number): number {
        if (index < 0 || index >= this._length) {
            throw new RangeError(`Array index ${index} out of range [0, ${this._length})`);
        }
        return index * this._arrayPitch;
    }

    public at(buffer: ArrayBuffer, offset: number, index: number): DescriptorMemoryType<ItemType> {
        const elementByteOffset = offset + this.offsetAt(index);
        return this._itemDescriptor.view(buffer, elementByteOffset) as DescriptorMemoryType<ItemType>;
    }

    public toString(): string {
        return `${GPU_ARRAY}<${this._itemDescriptor.toString()}, ${this._length}>`;
    }

    public view(buffer: ArrayBuffer, offset: number): DescriptorMemoryType<ItemType> {
        if (this._itemDescriptor.type === GPU_STRUCT) {
            return new Uint8Array(buffer, offset, this._byteSize) as DescriptorMemoryType<ItemType>;
        }

        // The flat view must span the WHOLE allocation (this._byteSize), padding
        // included. Sizing it by the element's *unpadded* extent (length * count)
        // undershoots any std140 array whose element carries internal padding —
        // e.g. array<vec3>, where each 12-byte vec is strided to 16: the view
        // would cover 12/16 of the buffer and its indices would skip the stride.
        // Dividing the true byteSize by the SCALAR size gives a full-region view
        // for both dense and std140; for scalar items it already did.
        let itemType = this._itemDescriptor.type;
        let scalarByteSize = this._itemDescriptor.byteSize;
        if (
            this._itemDescriptor.type === GPU_VEC2 || this._itemDescriptor.type === GPU_VEC3 || this._itemDescriptor.type === GPU_VEC4
            || this._itemDescriptor.type === GPU_MAT2 || this._itemDescriptor.type === GPU_MAT3 || this._itemDescriptor.type === GPU_MAT4
        ) {
            const scalar = (this._itemDescriptor as any).scalar;
            itemType = scalar.type;
            scalarByteSize = scalar.byteSize;
        }
        const elementCount = this._byteSize / scalarByteSize;

        const TypedArrayConstructor = TYPED_ARRAY_CONSTRUCTORS[itemType]!;
        return new TypedArrayConstructor(buffer, offset, elementCount) as DescriptorMemoryType<ItemType>;
    }
}
