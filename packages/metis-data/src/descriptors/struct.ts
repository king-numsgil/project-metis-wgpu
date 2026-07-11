import { GPU_STRUCT } from "./constants.ts";
import {
    type Descriptor,
    type DescriptorMemoryType,
    type DescriptorTypedArray,
    PackingType,
    type StructDescriptor,
} from "./index.ts";

function alignTo(value: number, alignment: number): number {
    if (!Number.isFinite(value) || !Number.isFinite(alignment) || alignment <= 0) {
        throw new RangeError(`Invalid alignment request: value=${value}, alignment=${alignment}`);
    }
    return Math.ceil(value / alignment) * alignment;
}

export class StructDescriptorImpl<
    Members extends Record<string, Descriptor<DescriptorTypedArray>>,
> implements StructDescriptor<Members> {
    private readonly _members: Members;
    private readonly _offsets: Record<keyof Members, number>;
    private readonly _byteSize: number;
    private readonly _alignment: number;
    private readonly _arrayPitch: number;
    private readonly _packing: PackingType;

    constructor(members: Members, packingType: PackingType = PackingType.Dense) {
        this._members = members;
        this._offsets = {} as Record<keyof Members, number>;
        this._packing = packingType;

        // A Std140 struct only lays out correctly if its composite members were
        // themselves built Std140. Packing is NOT inherited — each descriptor's
        // packing is frozen at construction — so a member left Dense would be
        // under-aligned and silently corrupt the layout. Catch it loudly instead.
        if (packingType === PackingType.Std140) {
            for (const key of Object.keys(members) as Array<keyof Members>) {
                const memberPacking = (members[key] as { packing?: PackingType }).packing;
                if (memberPacking !== undefined && memberPacking !== PackingType.Std140) {
                    throw new Error(
                        `Std140 struct member "${String(key)}" was built with `
                        + `${PackingType[memberPacking]} packing; it must be Std140 too, or its `
                        + `offset/stride will disagree with the shader. Pass PackingType.Std140 `
                        + `when constructing it.`,
                    );
                }
            }
        }

        let currentOffset = 0;
        let maxAlignment = 0;

        // Calculate offsets for each member.
        for (const key of Object.keys(members) as Array<keyof Members>) {
            const member = members[key]!;
            const memberAlignment = member.alignment;

            maxAlignment = Math.max(maxAlignment, memberAlignment);
            currentOffset = alignTo(currentOffset, memberAlignment);
            this._offsets[key] = currentOffset;
            currentOffset += member.byteSize;
        }

        // Dense packing behaves like a C struct.
        // std140-like packing requires the struct itself to have at least 16-byte alignment.
        const safeMaxAlignment = Math.max(1, maxAlignment);
        this._alignment = packingType === PackingType.Std140
            ? alignTo(safeMaxAlignment, 16)
            : safeMaxAlignment;

        this._byteSize = alignTo(currentOffset, this._alignment);
        this._arrayPitch = packingType === PackingType.Std140
            ? alignTo(this._byteSize, 16)
            : this._byteSize;
    }

    public get type(): typeof GPU_STRUCT {
        return GPU_STRUCT;
    }

    public get members(): Members {
        return this._members;
    }

    public get offsets(): Record<keyof Members, number> {
        return {...this._offsets};
    }

    public get packing(): PackingType {
        return this._packing;
    }

    public offsetOf<K extends keyof Members>(name: K): number {
        if (!(name in this._offsets)) {
            throw new Error(`Member "${String(name)}" does not exist in struct`);
        }
        return this._offsets[name];
    }

    public member<K extends keyof Members>(
        buffer: ArrayBuffer,
        offset: number,
        name: K,
    ): DescriptorMemoryType<Members[K]> {
        if (!(name in this._offsets)) {
            throw new Error(`Member "${String(name)}" does not exist in struct`);
        }

        const memberOffset = this._offsets[name]!;
        const memberDescriptor = this._members[name]!;

        return memberDescriptor.view(buffer, offset + memberOffset) as DescriptorMemoryType<Members[K]>;
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

    public toString(): string {
        const memberStrings = Object.keys(this._members)
            .map(key => `${String(key)}: ${this._members[key]!.toString()}`)
            .join(", ");
        return `${GPU_STRUCT} { ${memberStrings} }`;
    }

    public view(buffer: ArrayBuffer, offset: number): Uint8Array {
        return new Uint8Array(buffer, offset, this._byteSize);
    }
}
