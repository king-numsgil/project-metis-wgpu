import type { DescriptorToMemoryBuffer } from "metis-data";
import { Archetype, type EntityBytesDump, type EntityId, makeSignatureKey, type SignatureKey } from "./archetype.ts";

import type { ComponentSet } from "./component.ts";

type SubsetOf<CS extends ComponentSet, K extends keyof CS = keyof CS> = {
    [P in K]: CS[P];
};

interface EntityRecord {
    readonly archetypeKey: SignatureKey;
}

export class World<CS extends ComponentSet> {
    private readonly components: CS;
    private readonly archetypes: Map<SignatureKey, Archetype<SubsetOf<CS>>>;
    private readonly entityRecords: Map<EntityId, EntityRecord>;
    private nextEntityId: EntityId = 0;

    constructor(components: CS) {
        this.components = components;
        this.archetypes = new Map();
        this.entityRecords = new Map();
    }

    get archetypeCount(): number {
        return this.archetypes.size;
    }

    get entityCount(): number {
        return this.entityRecords.size;
    }

    spawnEntity(...componentNames: Array<keyof CS & string>): EntityId {
        const archetype = this.getOrCreateArchetype(componentNames);
        const entityId = this.nextEntityId++;
        archetype.addEntity(entityId);
        this.entityRecords.set(entityId, {archetypeKey: archetype.signatureKey});
        return entityId;
    }

    despawnEntity(entityId: EntityId): void {
        const record = this.entityRecords.get(entityId);
        if (record === undefined) {
            throw new Error(`Entity ${entityId} does not exist`);
        }
        const archetype = this.archetypes.get(record.archetypeKey);
        if (archetype === undefined) {
            throw new Error(`Archetype "${record.archetypeKey}" not found`);
        }
        archetype.removeEntity(entityId);
        this.entityRecords.delete(entityId);
    }

    getComponent<K extends keyof CS & string>(
        entityId: EntityId,
        componentName: K,
    ): DescriptorToMemoryBuffer<CS[K]["descriptor"]> {
        const record = this.entityRecords.get(entityId);
        if (record === undefined) {
            throw new Error(`Entity ${entityId} does not exist`);
        }
        const archetype = this.archetypes.get(record.archetypeKey);
        if (archetype === undefined) {
            throw new Error(`Archetype "${record.archetypeKey}" not found`);
        }
        return archetype.getComponent(
            entityId,
            componentName,
        ) as DescriptorToMemoryBuffer<CS[K]["descriptor"]>;
    }

    *queryEntities(componentNames: Array<keyof CS & string>): IterableIterator<EntityId> {
        const querySet = new Set<string>(componentNames);
        for (const archetype of this.archetypes.values()) {
            const archetypeNames = new Set(archetype.signatureKey.split(","));
            if ([...querySet].every((name) => archetypeNames.has(name))) {
                yield *archetype.iterEntities();
            }
        }
    }

    *iterArchetypes(): IterableIterator<Archetype<SubsetOf<CS>>> {
        yield *this.archetypes.values();
    }

    dumpEntityBytes(entityId: EntityId): EntityBytesDump {
        const record = this.entityRecords.get(entityId);
        if (record === undefined) {
            throw new Error(`Entity ${entityId} does not exist`);
        }
        const archetype = this.archetypes.get(record.archetypeKey);
        if (archetype === undefined) {
            throw new Error(`Archetype "${record.archetypeKey}" not found`);
        }
        return archetype.dumpEntityBytes(entityId);
    }

    dumpEntityLayout(entityId: EntityId): Record<string, { offset: number; byteSize: number }> {
        const record = this.entityRecords.get(entityId);
        if (record === undefined) {
            throw new Error(`Entity ${entityId} does not exist`);
        }
        const archetype = this.archetypes.get(record.archetypeKey);
        if (archetype === undefined) {
            throw new Error(`Archetype "${record.archetypeKey}" not found`);
        }
        return archetype.dumpLayout();
    }

    private getOrCreateArchetype(
        componentNames: Array<keyof CS & string>,
    ): Archetype<SubsetOf<CS>> {
        const key = makeSignatureKey(componentNames);
        const existing = this.archetypes.get(key);
        if (existing !== undefined) {
            return existing;
        }

        const subset = {} as SubsetOf<CS>;
        for (const name of componentNames) {
            const def = this.components[name];
            if (def === undefined) {
                throw new Error(`Component "${name}" is not registered in this World`);
            }
            (subset as ComponentSet)[name] = def;
        }

        const archetype = new Archetype<SubsetOf<CS>>(key, subset);
        this.archetypes.set(key, archetype);
        return archetype;
    }
}
