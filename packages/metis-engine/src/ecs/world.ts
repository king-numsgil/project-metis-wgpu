import { Archetype, type EntityId, makeSignatureKey, type SignatureKey } from "./archetype.ts";
import type { ComponentDef, Registry, SchemaOf } from "./component.ts";
import type { ComponentAccessor, ComponentColumns } from "./field.ts";

/** The typed columns object handed to a `query` callback, keyed by the queried component names. */
export type QueryColumns<R extends Registry, Names extends readonly (keyof R)[]> = {
    readonly [N in Names[number]]: ComponentColumns<SchemaOf<R[N]>>;
};

export class World<R extends Registry> {
    private readonly registry: R;
    private readonly archetypes = new Map<SignatureKey, Archetype>();
    private readonly entityArchetype = new Map<EntityId, SignatureKey>();
    private nextEntityId: EntityId = 0;

    constructor(registry: R) {
        this.registry = registry;
    }

    get entityCount(): number {
        return this.entityArchetype.size;
    }

    get archetypeCount(): number {
        return this.archetypes.size;
    }

    /** Create an entity holding exactly the named components (all zero-initialised). */
    spawnEntity(...componentNames: Array<keyof R & string>): EntityId {
        const archetype = this.getOrCreateArchetype(componentNames);
        const entityId = this.nextEntityId++;
        archetype.addEntity(entityId);
        this.entityArchetype.set(entityId, archetype.signatureKey);
        return entityId;
    }

    despawnEntity(entityId: EntityId): void {
        const archetype = this.archetypeOf(entityId);
        archetype.removeEntity(entityId);
        this.entityArchetype.delete(entityId);
    }

    /**
     * Random-access accessor for one entity's component: `pos.mass = 5`,
     * `pos.position.x = 1`. For per-frame work over many entities use `query`.
     */
    getComponent<K extends keyof R & string>(
        entityId: EntityId,
        componentName: K,
    ): ComponentAccessor<SchemaOf<R[K]>> {
        return this.archetypeOf(entityId).accessor(entityId, componentName) as ComponentAccessor<SchemaOf<R[K]>>;
    }

    /**
     * The fast path. Invokes `run` once per archetype that has ALL the named
     * components, handing it the typed SoA columns, the dense entity count, and
     * the dense entity ids. Index columns by row `0..count-1`:
     *
     *   world.query(["Position", "Velocity"], (cols, count) => {
     *     const px = cols.Position.position.x, vx = cols.Velocity.velocity.x;
     *     for (let i = 0; i < count; i++) px[i] += vx[i] * dt;
     *   });
     *
     * Do not spawn/despawn while iterating — structural changes invalidate the
     * columns and rows for the current archetype.
     */
    query<const Names extends readonly (keyof R & string)[]>(
        componentNames: Names,
        run: (columns: QueryColumns<R, Names>, count: number, entityIds: readonly EntityId[]) => void,
    ): void {
        for (const archetype of this.archetypes.values()) {
            if (!this.archetypeHasAll(archetype, componentNames)) {
                continue;
            }
            const all = archetype.columns;
            const picked = {} as Record<string, unknown>;
            for (const name of componentNames) {
                picked[name] = all[name];
            }
            run(picked as QueryColumns<R, Names>, archetype.count, archetype.entityIds);
        }
    }

    /** Yield every entity id that has ALL the named components. */
    *queryEntities(componentNames: Array<keyof R & string>): IterableIterator<EntityId> {
        for (const archetype of this.archetypes.values()) {
            if (this.archetypeHasAll(archetype, componentNames)) {
                yield* archetype.entityIds;
            }
        }
    }

    *iterArchetypes(): IterableIterator<Archetype> {
        yield* this.archetypes.values();
    }

    private archetypeOf(entityId: EntityId): Archetype {
        const key = this.entityArchetype.get(entityId);
        if (key === undefined) {
            throw new Error(`Entity ${entityId} does not exist`);
        }
        const archetype = this.archetypes.get(key);
        if (archetype === undefined) {
            throw new Error(`Archetype "${key}" not found`);
        }
        return archetype;
    }

    private archetypeHasAll(archetype: Archetype, names: readonly string[]): boolean {
        const present = archetype.componentNames;
        for (const name of names) {
            if (!present.includes(name)) {
                return false;
            }
        }
        return true;
    }

    private getOrCreateArchetype(componentNames: Array<keyof R & string>): Archetype {
        const key = makeSignatureKey(componentNames);
        const existing = this.archetypes.get(key);
        if (existing !== undefined) {
            return existing;
        }

        const defs: ComponentDef[] = [];
        for (const name of componentNames) {
            const def = this.registry[name];
            if (def === undefined) {
                throw new Error(`Component "${name}" is not registered in this World`);
            }
            defs.push(def);
        }

        const archetype = new Archetype(key, defs);
        this.archetypes.set(key, archetype);
        return archetype;
    }
}
