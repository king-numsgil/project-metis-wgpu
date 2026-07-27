import { Archetype, type EntityId, makeSignatureKey, type SignatureKey } from "./archetype.ts";
import type { ComponentDef, Registry, SchemaOf } from "./component.ts";
import type { ComponentAccessor, ComponentColumns } from "./field.ts";

/** The typed columns object handed to a `query` callback, keyed by the queried component names. */
export type QueryColumns<R extends Registry, Names extends readonly (keyof R)[]> = {
    readonly [N in Names[number]]: ComponentColumns<SchemaOf<R[N]>>;
};

/**
 * The ECS container: a registry of components plus one {@link Archetype} per
 * distinct component set that has been spawned.
 *
 * ```ts
 * const world = new World({
 *     Position: defineComponent("Position", { pos: vec3(f32) }),
 *     Velocity: defineComponent("Velocity", { vel: vec3(f32) }),
 * });
 * const e = world.spawnEntity("Position", "Velocity");
 * world.getComponent(e, "Position").pos.x = 1.5;      // random access
 * world.query(["Position", "Velocity"], (cols, count) => { … });  // per-frame
 * ```
 *
 * Two access paths, deliberately: {@link getComponent} for one entity you have
 * a handle to, {@link query} for the per-frame sweep over many. Everything is
 * typed off `R`, so a misspelled component name is a compile error rather than
 * an `undefined` at runtime.
 *
 * Not here yet (all deliberate — see CLAUDE.md "The ECS"): systems/scheduling,
 * exclusion filters, hierarchy, and entity generation tags.
 */
export class World<R extends Registry> {
    private readonly registry: R;
    private readonly archetypes = new Map<SignatureKey, Archetype>();
    private readonly entityArchetype = new Map<EntityId, SignatureKey>();
    private nextEntityId: EntityId = 0;

    /** @param registry every component this world can spawn, keyed by component name. */
    constructor(registry: R) {
        this.registry = registry;
    }

    /** Live entities across every archetype. */
    get entityCount(): number {
        return this.entityArchetype.size;
    }

    /** Distinct component sets that have been spawned. Archetypes are created on demand and never removed. */
    get archetypeCount(): number {
        return this.archetypes.size;
    }

    /**
     * Create an entity holding exactly the named components (all zero-initialised).
     * The component *set* picks the archetype, so order doesn't matter.
     *
     * @throws if any name isn't in the registry.
     */
    spawnEntity(...componentNames: Array<keyof R & string>): EntityId {
        const archetype = this.getOrCreateArchetype(componentNames);
        const entityId = this.nextEntityId++;
        archetype.addEntity(entityId);
        this.entityArchetype.set(entityId, archetype.signatureKey);
        return entityId;
    }

    /**
     * Destroy an entity. Its archetype closes the gap by swapping its last row
     * down, so **other entities' row indices shift** — ids stay valid, raw rows
     * don't.
     *
     * @throws if the entity doesn't exist.
     */
    despawnEntity(entityId: EntityId): void {
        const archetype = this.archetypeOf(entityId);
        archetype.removeEntity(entityId);
        this.entityArchetype.delete(entityId);
    }

    /**
     * Random-access accessor for one entity's component: `pos.mass = 5`,
     * `pos.position.x = 1`. For per-frame work over many entities use `query`.
     *
     * The accessor resolves the live row and array on **every** property access,
     * so it survives column growth and despawn swaps — at the cost of a getter
     * call per read, which is why it isn't the hot path.
     *
     * @throws if the entity doesn't exist or lacks that component.
     */
    getComponent<K extends keyof R & string>(
        entityId: EntityId,
        componentName: K,
    ): ComponentAccessor<SchemaOf<R[K]>> {
        return this.archetypeOf(entityId).accessor(entityId, componentName) as ComponentAccessor<SchemaOf<R[K]>>;
    }

    /**
     * The fast path. Invokes `run` once per archetype that has ALL the named
     * components (superset matching — extra components don't disqualify),
     * handing it the typed SoA columns, the dense entity count, and the dense
     * entity ids. Index columns by row `0..count-1`:
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

    /**
     * Yield every entity id that has ALL the named components. Matching is by
     * **superset** — an entity with extra components still matches; there is no
     * exclusion (`Without`) filter yet.
     *
     * Convenient, but it yields ids rather than columns, so a system that walks
     * this and calls `getComponent` per entity pays the accessor cost per field
     * access. Use `query` for that.
     */
    *queryEntities(componentNames: Array<keyof R & string>): IterableIterator<EntityId> {
        for (const archetype of this.archetypes.values()) {
            if (this.archetypeHasAll(archetype, componentNames)) {
                yield* archetype.entityIds;
            }
        }
    }

    /** Every archetype, for inspection tooling (see `debug.ts`). */
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
