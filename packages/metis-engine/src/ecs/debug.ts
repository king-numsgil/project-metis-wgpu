import type { Archetype, EntityId } from "./archetype.ts";
import type { ComponentSet } from "./component.ts";
import type { World } from "./world.ts";

export interface ArchetypeInfo {
    readonly signatureKey: string;
    readonly entityCount: number;
    readonly capacity: number;
    readonly rowByteSize: number;
    readonly totalBytes: number;
    readonly usedBytes: number;
    readonly layout: Record<string, { offset: number; byteSize: number }>;
}

export function inspectArchetype<CS extends ComponentSet>(
    archetype: Archetype<CS>,
): ArchetypeInfo {
    return {
        signatureKey: archetype.signatureKey,
        entityCount: archetype.entityCount,
        capacity: archetype.capacity,
        rowByteSize: archetype.rowByteSize,
        totalBytes: archetype.capacity * archetype.rowByteSize,
        usedBytes: archetype.entityCount * archetype.rowByteSize,
        layout: archetype.dumpLayout(),
    };
}

export interface WorldInfo {
    readonly entityCount: number;
    readonly archetypeCount: number;
    readonly archetypes: ArchetypeInfo[];
}

export function inspectWorld<CS extends ComponentSet>(world: World<CS>): WorldInfo {
    return {
        entityCount: world.entityCount,
        archetypeCount: world.archetypeCount,
        archetypes: [...world.iterArchetypes()].map(inspectArchetype),
    };
}

export function printWorldInfo<CS extends ComponentSet>(world: World<CS>): void {
    const info = inspectWorld(world);
    console.log(`\n${"=".repeat(50)}`);
    console.log(`  World — ${info.entityCount} entities, ${info.archetypeCount} archetypes`);
    console.log(`${"=".repeat(50)}`);

    for (const arch of info.archetypes) {
        const pct = arch.totalBytes > 0
            ? ((arch.usedBytes / arch.totalBytes) * 100).toFixed(1)
            : "0.0";

        console.log(`\n  Archetype [${arch.signatureKey}]`);
        console.log(`    Entities : ${arch.entityCount} / ${arch.capacity} (${pct}% full)`);
        console.log(`    Row size : ${arch.rowByteSize} bytes`);
        console.log(`    Buffer   : ${arch.usedBytes} / ${arch.totalBytes} bytes`);
        console.log(`    Layout:`);

        const entries = Object.entries(arch.layout);
        for (const [name, {offset, byteSize}] of entries) {
            const bar = "█".repeat(byteSize);
            console.log(`      +${String(offset).padStart(3, "0")}  ${name.padEnd(16)} ${byteSize}b  ${bar}`);
        }
    }
    console.log();
}

export function printEntityBytes<CS extends ComponentSet>(
    world: World<CS>,
    entityId: EntityId,
): void {
    const dump = world.dumpEntityBytes(entityId);
    const layout = world.dumpEntityLayout(entityId);

    console.log(`\n  Entity ${entityId} [${dump.archetypeKey}] @ dense[${dump.denseIndex}]`);
    console.log(`  Row size : ${dump.rowByteSize} bytes`);
    console.log(`  Hex      : ${dump.hex}`);

    console.log(`  Breakdown:`);
    for (const [name, {offset, byteSize}] of Object.entries(layout)) {
        const bytes = Array.from(new Uint8Array(dump.f32View.buffer, offset, byteSize))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(" ");
        console.log(`    ${name.padEnd(16)} @+${String(offset).padStart(3, "0")} [${bytes}]`);
    }

    console.log(`  As f32   : [${Array.from(dump.f32View).join(", ")}]`);
    console.log(`  As u32   : [${Array.from(dump.u32View).join(", ")}]`);
}
