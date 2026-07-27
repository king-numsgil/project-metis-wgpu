import type { Archetype } from "./archetype.ts";
import type { Registry } from "./component.ts";
import type { World } from "./world.ts";

/**
 * Inspection helpers for the SoA storage — what archetypes exist, how full their
 * columns are, and how many bytes each component costs per entity.
 *
 * This is a *debugging* surface, not part of the ECS's working API: nothing in
 * the hot path calls it, and it walks every archetype and column, so keep it out
 * of per-frame code.
 */

/** One archetype's storage layout and occupancy — see {@link inspectArchetype}. */
export interface ArchetypeInfo {
    /** The archetype's canonical component set, e.g. `"Position,Velocity"`. */
    readonly signatureKey: string;
    /** Live entities (dense rows in use). */
    readonly entityCount: number;
    /** Rows the columns can currently hold before the next doubling. */
    readonly capacity: number;
    /** Bytes actually allocated across every column. */
    readonly allocatedBytes: number;
    /** Bytes backing live entities — `allocatedBytes` minus the unused tail. */
    readonly usedBytes: number;
    /** Per-component field layout: field name, `scalar`/`vecN`, column count, and bytes per entity. */
    readonly components: Record<string, Array<{ field: string; kind: string; axes: number; bytes: number }>>;
}

/** Snapshot one archetype's layout and occupancy. */
export function inspectArchetype(archetype: Archetype): ArchetypeInfo {
    // Used bytes = the per-entity byte footprint (sum over columns) times count.
    const perEntity = archetype.count > 0 ? archetype.allocatedBytes / archetype.capacity : 0;
    return {
        signatureKey: archetype.signatureKey,
        entityCount: archetype.count,
        capacity: archetype.capacity,
        allocatedBytes: archetype.allocatedBytes,
        usedBytes: Math.round(perEntity * archetype.count),
        components: archetype.describe(),
    };
}

/** A whole world's storage snapshot — see {@link inspectWorld}. */
export interface WorldInfo {
    readonly entityCount: number;
    readonly archetypeCount: number;
    /** One entry per archetype, in creation order. */
    readonly archetypes: ArchetypeInfo[];
}

/** Snapshot every archetype in `world`. Returns plain data — log it, diff it, or assert on it in a test. */
export function inspectWorld<R extends Registry>(world: World<R>): WorldInfo {
    return {
        entityCount: world.entityCount,
        archetypeCount: world.archetypeCount,
        archetypes: [...world.iterArchetypes()].map(inspectArchetype),
    };
}

/**
 * `console.log` {@link inspectWorld}'s snapshot as a readable table: per
 * archetype, its entity count vs. capacity, buffer utilisation, and each
 * component's column layout.
 */
export function printWorldInfo<R extends Registry>(world: World<R>): void {
    const info = inspectWorld(world);
    console.log(`\n${"=".repeat(56)}`);
    console.log(`  World — ${info.entityCount} entities, ${info.archetypeCount} archetypes (SoA)`);
    console.log(`${"=".repeat(56)}`);

    for (const arch of info.archetypes) {
        const pct = arch.allocatedBytes > 0
            ? ((arch.usedBytes / arch.allocatedBytes) * 100).toFixed(1)
            : "0.0";
        console.log(`\n  Archetype [${arch.signatureKey}]`);
        console.log(`    Entities : ${arch.entityCount} / ${arch.capacity} (${pct}% of buffers used)`);
        console.log(`    Columns  : ${arch.usedBytes} / ${arch.allocatedBytes} bytes`);
        for (const [comp, fields] of Object.entries(arch.components)) {
            console.log(`    ${comp}:`);
            for (const f of fields) {
                console.log(`      ${f.field.padEnd(14)} ${f.kind.padEnd(6)} ${f.axes} col  ${f.bytes}b/entity`);
            }
        }
    }
    console.log();
}
