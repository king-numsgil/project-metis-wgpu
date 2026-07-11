import type { Archetype } from "./archetype.ts";
import type { Registry } from "./component.ts";
import type { World } from "./world.ts";

export interface ArchetypeInfo {
    readonly signatureKey: string;
    readonly entityCount: number;
    readonly capacity: number;
    readonly allocatedBytes: number;
    readonly usedBytes: number;
    readonly components: Record<string, Array<{ field: string; kind: string; axes: number; bytes: number }>>;
}

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

export interface WorldInfo {
    readonly entityCount: number;
    readonly archetypeCount: number;
    readonly archetypes: ArchetypeInfo[];
}

export function inspectWorld<R extends Registry>(world: World<R>): WorldInfo {
    return {
        entityCount: world.entityCount,
        archetypeCount: world.archetypeCount,
        archetypes: [...world.iterArchetypes()].map(inspectArchetype),
    };
}

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
