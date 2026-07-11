import { F32, StructOf, U32 } from "metis-data";
import { defineComponent } from "./component.ts";
import { printEntityBytes, printWorldInfo } from "./debug.ts";
import { World } from "./world.ts";

const world = new World({
    Position: defineComponent("Position", StructOf({x: F32, y: F32})),
    Velocity: defineComponent("Velocity", StructOf({x: F32, y: F32})),
    Health: defineComponent("Health", StructOf({value: F32})),
    Tags: defineComponent("Tags", U32),
} as const);

const e0 = world.spawnEntity("Position", "Velocity", "Tags");
const e1 = world.spawnEntity("Position", "Velocity", "Tags");
const e2 = world.spawnEntity("Position", "Velocity", "Health");
const e3 = world.spawnEntity("Health");

world.getComponent(e0, "Position").set({x: 1.5, y: 2.5});
world.getComponent(e0, "Velocity").set({x: 0.1, y: 0.2});
world.getComponent(e0, "Tags").set(0b00000011);

world.getComponent(e1, "Position").set({x: 10, y: 20});
world.getComponent(e1, "Velocity").set({x: 3, y: 4});
world.getComponent(e1, "Tags").set(0b00000001);

world.getComponent(e2, "Position").set({x: 99, y: 88});
world.getComponent(e2, "Health").set({value: 100});

world.getComponent(e3, "Health").set({value: 50});

console.log("\n>>> INITIAL STATE");
printWorldInfo(world);

console.log(">>> RAW BYTES — e0 [Position, Velocity, Tags]");
printEntityBytes(world, e0);

console.log("\n>>> RAW BYTES — e1 [Position, Velocity, Tags]");
printEntityBytes(world, e1);

console.log("\n>>> RAW BYTES — e2 [Position, Velocity, Health]");
printEntityBytes(world, e2);

console.log("\n\n>>> DESPAWNING e1...");
world.despawnEntity(e1);

console.log("\n>>> RAW BYTES — e0 after despawn (should be unchanged)");
printEntityBytes(world, e0);

console.log("\n\n>>> SPAWNING 35 more entities to trigger buffer growth (capacity starts at 32)...");
const extras: number[] = [];
for (let i = 0; i < 35; i++) {
    const id = world.spawnEntity("Position", "Velocity", "Tags");
    world.getComponent(id, "Position").get("x").set(i);
    extras.push(id);
}

console.log("\n>>> WORLD AFTER GROWTH");
printWorldInfo(world);

console.log(">>> RAW BYTES — e0 after buffer growth (should still be original values)");
printEntityBytes(world, e0);
