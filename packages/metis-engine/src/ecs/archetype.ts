import {
    type Descriptor,
    type DescriptorToMemoryBuffer,
    type DescriptorTypedArray,
    type StructDescriptor,
    StructOf,
    wrap,
} from "metis-data";

import type { ComponentSet } from "./component.ts";

export type EntityId = number;
export type SignatureKey = string;

export function makeSignatureKey(names: string[]): SignatureKey {
    return [...names].sort().join(",");
}

const INITIAL_CAPACITY = 32;

type ArchetypeStructMembers<CS extends ComponentSet> = {
    [K in keyof CS]: CS[K]["descriptor"];
};

type ArchetypeRowDescriptor<CS extends ComponentSet> = StructDescriptor<ArchetypeStructMembers<CS>>;

export interface EntityBytesDump {
    readonly archetypeKey: SignatureKey;
    readonly entityId: EntityId;
    readonly denseIndex: number;
    readonly rowByteSize: number;
    readonly hex: string;
    readonly f32View: Float32Array;
    readonly u32View: Uint32Array;
}

export class Archetype<CS extends ComponentSet> {
    readonly signatureKey: SignatureKey;

    private readonly rowDescriptor: ArchetypeRowDescriptor<CS>;
    private buffer: ArrayBuffer;
    private readonly entities: EntityId[];
    private readonly entityIndex: Map<EntityId, number>;

    constructor(signatureKey: SignatureKey, components: CS) {
        this.signatureKey = signatureKey;
        this.entities = [];
        this.entityIndex = new Map();
        this._capacity = INITIAL_CAPACITY;

        const members = {} as ArchetypeStructMembers<CS>;
        for (const key of Object.keys(components) as Array<keyof CS>) {
            members[key] = components[key]!.descriptor as CS[typeof key]["descriptor"];
        }
        this.rowDescriptor = StructOf(members) as ArchetypeRowDescriptor<CS>;
        this.buffer = new ArrayBuffer(INITIAL_CAPACITY * this.rowDescriptor.byteSize);
    }

    private _capacity: number;

    get capacity(): number {
        return this._capacity;
    }

    get entityCount(): number {
        return this.entities.length;
    }

    get rowByteSize(): number {
        return this.rowDescriptor.byteSize;
    }

    addEntity(entityId: EntityId): void {
        if (this.entityIndex.has(entityId)) {
            throw new Error(`Entity ${entityId} already exists in archetype "${this.signatureKey}"`);
        }
        if (this.entities.length >= this._capacity) {
            this.grow();
        }
        const denseIndex = this.entities.length;
        this.entities.push(entityId);
        this.entityIndex.set(entityId, denseIndex);
    }

    removeEntity(entityId: EntityId): void {
        const denseIndex = this.entityIndex.get(entityId);
        if (denseIndex === undefined) {
            throw new Error(`Entity ${entityId} not found in archetype "${this.signatureKey}"`);
        }

        const lastIndex = this.entities.length - 1;
        const lastEntityId = this.entities[lastIndex];
        if (lastEntityId === undefined) {
            throw new Error(`Archetype "${this.signatureKey}" is unexpectedly empty`);
        }

        if (denseIndex !== lastIndex) {
            const rowSize = this.rowDescriptor.byteSize;
            const dst = new Uint8Array(this.buffer, denseIndex * rowSize, rowSize);
            const src = new Uint8Array(this.buffer, lastIndex * rowSize, rowSize);
            dst.set(src);
            this.entities[denseIndex] = lastEntityId;
            this.entityIndex.set(lastEntityId, denseIndex);
        }

        this.entities.pop();
        this.entityIndex.delete(entityId);
    }

    getComponent<K extends keyof CS & string>(
        entityId: EntityId,
        componentName: K,
    ): DescriptorToMemoryBuffer<CS[K]["descriptor"]> {
        const denseIndex = this.entityIndex.get(entityId);
        if (denseIndex === undefined) {
            throw new Error(`Entity ${entityId} not found in archetype "${this.signatureKey}"`);
        }

        const rowOffset = denseIndex * this.rowDescriptor.byteSize;
        const memberOffset = rowOffset + this.rowDescriptor.offsetOf(componentName);
        const memberDescriptor = this.rowDescriptor.members[componentName] as CS[K]["descriptor"];

        return wrap(
            memberDescriptor as Descriptor<DescriptorTypedArray>,
            this.buffer,
            memberOffset,
        ) as DescriptorToMemoryBuffer<CS[K]["descriptor"]>;
    }

    dumpEntityBytes(entityId: EntityId): EntityBytesDump {
        const denseIndex = this.entityIndex.get(entityId);
        if (denseIndex === undefined) {
            throw new Error(`Entity ${entityId} not found in archetype "${this.signatureKey}"`);
        }

        const rowSize = this.rowDescriptor.byteSize;
        const rowOffset = denseIndex * rowSize;
        const rowBuffer = this.buffer.slice(rowOffset, rowOffset + rowSize);

        const hex = Array.from(new Uint8Array(rowBuffer))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(" ");

        return {
            archetypeKey: this.signatureKey,
            entityId,
            denseIndex,
            rowByteSize: rowSize,
            hex,
            f32View: new Float32Array(rowBuffer),
            u32View: new Uint32Array(rowBuffer),
        };
    }

    dumpLayout(): Record<string, { offset: number; byteSize: number }> {
        const result: Record<string, { offset: number; byteSize: number }> = {};
        for (const key of Object.keys(this.rowDescriptor.members)) {
            result[key] = {
                offset: this.rowDescriptor.offsetOf(key),
                byteSize: this.rowDescriptor.members[key]!.byteSize,
            };
        }
        return result;
    }

    *iterEntities(): IterableIterator<EntityId> {
        yield *this.entities;
    }

    private grow(): void {
        this._capacity *= 2;
        const newBuffer = new ArrayBuffer(this._capacity * this.rowDescriptor.byteSize);
        new Uint8Array(newBuffer).set(new Uint8Array(this.buffer));
        this.buffer = newBuffer;
    }
}
