import {
    Archetype,
    type ComponentBits,
    type EntityId,
    makeSignatureMask,
    MAX_COMPONENT_TYPES,
    type SignatureMask,
} from "./archetype.ts";
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
    private readonly archetypes = new Map<SignatureMask, Archetype>();
    private readonly entityArchetype = new Map<EntityId, SignatureMask>();
    /** Registry key -> bit index. Fixed at construction; the registry can't grow. */
    private readonly bits: ComponentBits;
    /** Bit index -> registry key, for rebuilding a component set from a mask. */
    private readonly namesByBit: readonly string[];
    private nextEntityId: EntityId = 0;

    /**
     * @param registry every component this world can spawn, keyed by component name.
     * @throws if the registry holds more than {@link MAX_COMPONENT_TYPES} components.
     */
    constructor(registry: R) {
        this.registry = registry;
        // Bit indices are assigned once, here, because the registry is fixed at
        // construction — that's what makes a bitmask signature possible at all.
        const names = Object.keys(registry);
        if (names.length > MAX_COMPONENT_TYPES) {
            throw new Error(
                `World registry has ${names.length} components, but an archetype signature is a ` +
                    `single int32 bitmask, so at most ${MAX_COMPONENT_TYPES} are supported. Widening ` +
                    `this is a real change, not a constant bump — see MAX_COMPONENT_TYPES in ` +
                    `ecs/archetype.ts and CLAUDE.md "The 32-component ceiling".`,
            );
        }
        const bits = new Map<string, number>();
        for (let i = 0; i < names.length; i++) {
            bits.set(names[i]!, i);
        }
        this.bits = bits;
        this.namesByBit = names;
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
        const mask = makeSignatureMask(this.bits, componentNames);
        const archetype = this.getOrCreateArchetype(mask);
        const entityId = this.nextEntityId++;
        archetype.addEntity(entityId);
        this.entityArchetype.set(entityId, mask);
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
        const wanted = makeSignatureMask(this.bits, componentNames);
        for (const archetype of this.archetypes.values()) {
            if ((archetype.mask & wanted) !== wanted) {
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
        const wanted = makeSignatureMask(this.bits, componentNames);
        for (const archetype of this.archetypes.values()) {
            if ((archetype.mask & wanted) === wanted) {
                yield* archetype.entityIds;
            }
        }
    }

    /** Every archetype, for inspection tooling (see `debug.ts`). */
    *iterArchetypes(): IterableIterator<Archetype> {
        yield* this.archetypes.values();
    }

    private archetypeOf(entityId: EntityId): Archetype {
        const mask = this.entityArchetype.get(entityId);
        if (mask === undefined) {
            throw new Error(`Entity ${entityId} does not exist`);
        }
        const archetype = this.archetypes.get(mask);
        if (archetype === undefined) {
            throw new Error(`Archetype for mask ${mask} not found`);
        }
        return archetype;
    }

    private getOrCreateArchetype(mask: SignatureMask): Archetype {
        const existing = this.archetypes.get(mask);
        if (existing !== undefined) {
            return existing;
        }

        // Rebuild the component set from the mask rather than from the caller's
        // argument list, so an archetype's defs always agree with the mask that
        // keys it — and so duplicate names (`spawn("Position", "Position")`)
        // resolve to the same archetype as the deduplicated set, which the old
        // string key silently did not.
        const defs: ComponentDef[] = [];
        for (let bit = 0; bit < this.namesByBit.length; bit++) {
            if ((mask & (1 << bit)) !== 0) {
                defs.push(this.registry[this.namesByBit[bit]!]!);
            }
        }

        const archetype = new Archetype(mask, defs);
        this.archetypes.set(mask, archetype);
        return archetype;
    }
}
