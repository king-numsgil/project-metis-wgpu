import { GPU_F16, GPU_F32, GPU_F64, GPU_I32, GPU_MAT2, GPU_MAT3, GPU_MAT4, GPU_U32 } from "./constants.ts";
import {
    type DescriptorMemoryType,
    type MatDescriptor,
    type MatrixTypeSelector,
    PackingType,
    type ScalarDescriptor,
    Vec,
    type VecDescriptor,
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

export class MatDescriptorImpl<
    ScalarType extends ScalarDescriptor,
    N extends 2 | 3 | 4
> implements MatDescriptor<ScalarType, N> {
    private readonly _scalarDescriptor: ScalarType;
    private readonly _colDescriptor: VecDescriptor<ScalarType, N>;
    private readonly _n: N;
    private readonly _type: MatrixTypeSelector<N>;
    private readonly _byteSize: number;
    private readonly _alignment: number;
    private readonly _arrayPitch: number;
    private readonly _columnStride: number;
    private readonly _packing: PackingType;

    constructor(scalarDescriptor: ScalarType, n: N, packingType: PackingType = PackingType.Dense) {
        this._colDescriptor = Vec(scalarDescriptor, n, packingType);
        this._scalarDescriptor = scalarDescriptor;
        this._n = n;
        this._packing = packingType;
        this._type = (n === 2 ? GPU_MAT2 : n === 3 ? GPU_MAT3 : GPU_MAT4) as MatrixTypeSelector<N>;

        if (packingType === PackingType.Dense) {
            // Dense packing: scalar alignment
            const scalarSize = scalarDescriptor.byteSize;

            this._alignment = scalarSize;
            this._columnStride = n * scalarSize;
            this._byteSize = n * this._columnStride;
            this._arrayPitch = this._byteSize;
        } else if (packingType === PackingType.Std140) {
            // std140: a matrix is an array of column vectors, and std140 arrays round
            // every element up to a 16-byte (vec4) boundary — so even a mat2's vec2
            // columns are strided to 16.
            this._alignment = alignTo(this._colDescriptor.alignment, 16);
            this._columnStride = alignTo(this._colDescriptor.byteSize, 16);
            this._byteSize = n * this._columnStride;
            this._arrayPitch = alignTo(this._byteSize, 16);
        } else {
            // std430: same column-vector model, but the stride rounds only up to the
            // column's own alignment, not 16. mat2<f32> columns pack at 8 (byteSize 16
            // vs std140's 32); mat3/mat4 are unchanged because vec3/vec4 already align
            // to 16. The matrix size is already a multiple of its alignment, so the
            // array stride needs no further rounding.
            this._alignment = this._colDescriptor.alignment;
            this._columnStride = alignTo(this._colDescriptor.byteSize, this._colDescriptor.alignment);
            this._byteSize = n * this._columnStride;
            this._arrayPitch = this._byteSize;
        }
    }

    public get type(): MatrixTypeSelector<N> {
        return this._type;
    }

    public get scalar(): ScalarType {
        return this._scalarDescriptor;
    }

    public get column(): VecDescriptor<ScalarType, N> {
        return this._colDescriptor;
    }

    public get columnStride(): number {
        return this._columnStride;
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

    public get length(): number {
        return this._n * this._n;
    }

    public get packing(): PackingType {
        return this._packing;
    }

    public col(buffer: ArrayBuffer, offset: number, index: number): DescriptorMemoryType<ScalarType> {
        if (index < 0 || index >= this._n) {
            throw new RangeError(`Column index ${index} out of range [0, ${this._n})`);
        }

        const TypedArrayConstructor = TYPED_ARRAY_CONSTRUCTORS[this._scalarDescriptor.type]!;
        const columnByteOffset = offset + (index * this._columnStride);
        return new TypedArrayConstructor(buffer, columnByteOffset, this._n) as DescriptorMemoryType<ScalarType>;
    }

    public toString(): string {
        return `${this._type}<${this._scalarDescriptor.type}>`;
    }

    public view(buffer: ArrayBuffer, offset: number): DescriptorMemoryType<ScalarType> {
        const TypedArrayConstructor = TYPED_ARRAY_CONSTRUCTORS[this._scalarDescriptor.type]!;
        const elementCount = (this._byteSize / this._scalarDescriptor.byteSize);
        return new TypedArrayConstructor(buffer, offset, elementCount) as DescriptorMemoryType<ScalarType>;
    }
}
