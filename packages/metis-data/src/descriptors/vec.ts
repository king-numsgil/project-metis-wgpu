import { GPU_F16, GPU_F32, GPU_F64, GPU_I32, GPU_U32, GPU_VEC2, GPU_VEC3, GPU_VEC4 } from "./constants.ts";
import {
    type DescriptorMemoryType,
    PackingType,
    type ScalarDescriptor,
    type VecDescriptor,
    type VectorTypeSelector,
} from "./index.ts";

type TypedArrayConstructor =
    | typeof Float16Array
    | typeof Float32Array
    | typeof Float64Array
    | typeof Int32Array
    | typeof Uint32Array;

const TYPED_ARRAY_CONSTRUCTORS: Record<string, TypedArrayConstructor> = {
    [GPU_F16]: Float16Array,
    [GPU_F32]: Float32Array,
    [GPU_F64]: Float64Array,
    [GPU_I32]: Int32Array,
    [GPU_U32]: Uint32Array,
};

function alignTo(value: number, alignment: number): number {
    if (!Number.isFinite(value) || !Number.isFinite(alignment) || alignment <= 0) {
        throw new RangeError(`Invalid alignment request: value=${value}, alignment=${alignment}`);
    }
    return Math.ceil(value / alignment) * alignment;
}

export class VecDescriptorImpl<
    ScalarType extends ScalarDescriptor,
    N extends 2 | 3 | 4
> implements VecDescriptor<ScalarType, N> {
    private readonly _scalarDescriptor: ScalarType;
    private readonly _n: N;
    private readonly _type: VectorTypeSelector<N>;
    private readonly _byteSize: number;
    private readonly _alignment: number;
    private readonly _arrayPitch: number;
    private readonly _packing: PackingType;

    constructor(scalarDescriptor: ScalarType, n: N, packingType: PackingType = PackingType.Dense) {
        this._scalarDescriptor = scalarDescriptor;
        this._n = n;
        this._packing = packingType;
        this._type = (n === 2 ? GPU_VEC2 : n === 3 ? GPU_VEC3 : GPU_VEC4) as VectorTypeSelector<N>;

        const scalarSize = scalarDescriptor.byteSize;
        const rawByteSize = n * scalarSize;

        if (packingType === PackingType.Dense) {
            // Dense packing: tightly packed scalars.
            this._alignment = scalarSize;
            this._byteSize = rawByteSize;
            this._arrayPitch = alignTo(this._byteSize, this._alignment);
            return;
        }

        // std140 and std430 share the same base-alignment rules for a vector:
        // - vec2 base alignment = 2N (but at least 8)
        // - vec3/vec4 base alignment = 4N (but at least 16)
        if (n === 2) {
            this._alignment = Math.max(8, 2 * scalarSize);
        } else {
            this._alignment = Math.max(16, 4 * scalarSize);
        }

        // byteSize is the UNPADDED extent (vec3<f32> = 12). std140/std430 (and WGSL)
        // let a smaller-aligned member — e.g. a trailing scalar — pack into the gap
        // after a vec3, so { vec3, f32 } is 16 bytes with the scalar at offset 12.
        // Padding the size up to `alignment` here would push that scalar to offset 16
        // and silently corrupt every following field. Only *placement* (alignment) and
        // *array stride* (arrayPitch) are padded — never the size itself.
        this._byteSize = rawByteSize;

        // The one std140-vs-std430 difference for vectors is the array stride:
        // std140 rounds every array element up to a 16-byte (vec4) boundary; std430
        // rounds only up to the element's own alignment. So array<vec2<f32>> strides
        // by 16 in std140 but by 8 in std430; vec3/vec4 already align to 16 in both.
        this._arrayPitch = packingType === PackingType.Std140
            ? alignTo(rawByteSize, 16)
            : alignTo(rawByteSize, this._alignment);
    }

    public get type(): VectorTypeSelector<N> {
        return this._type;
    }

    public get scalar(): ScalarType {
        return this._scalarDescriptor;
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

    public get length(): N {
        return this._n;
    }

    public get packing(): PackingType {
        return this._packing;
    }

    public toString(): string {
        return `${this._type}<${this._scalarDescriptor.type}>`;
    }

    public view(buffer: ArrayBuffer, offset: number): DescriptorMemoryType<ScalarType> {
        const TypedArrayConstructor = TYPED_ARRAY_CONSTRUCTORS[this._scalarDescriptor.type]!;
        return new TypedArrayConstructor(buffer, offset, this._n) as DescriptorMemoryType<ScalarType>;
    }
}
