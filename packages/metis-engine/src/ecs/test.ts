// Manual smoke script for the SoA ECS: `bun run src/ecs/test.ts`.
// (The automated checks live in test/ecs.test.ts.)
import { defineComponent } from "./component.ts";
import { printWorldInfo } from "./debug.ts";
import { f32, u32, vec2 } from "./field.ts";
import { World } from "./world.ts";

const world = new World({
    Position: defineComponent("Position", { pos: vec2(f32) }),
    Velocity: defineComponent("Velocity", { vel: vec2(f32) }),
    Health: defineComponent("Health", { value: f32 }),
    Tags: defineComponent("Tags", { bits: u32 }),
});

const e0 = world.spawnEntity("Position", "Velocity", "Tags");
const e1 = world.spawnEntity("Position", "Velocity", "Tags");
const e2 = world.spawnEntity("Position", "Velocity", "Health");
const e3 = world.spawnEntity("Health");

world.getComponent(e0, "Position").pos.x = 1.5;
world.getComponent(e0, "Position").pos.y = 2.5;
world.getComponent(e0, "Velocity").vel.x = 0.1;
world.getComponent(e0, "Velocity").vel.y = 0.2;
world.getComponent(e0, "Tags").bits = 0b11;

world.getComponent(e1, "Position").pos.x = 10;
world.getComponent(e1, "Velocity").vel.x = 3;
world.getComponent(e2, "Health").value = 100;
world.getComponent(e3, "Health").value = 50;

console.log("\n>>> INITIAL STATE");
printWorldInfo(world);

console.log(">>> integrate Position += Velocity (query fast path)");
const DT = 1 / 60;
world.query(["Position", "Velocity"], (cols, count) => {
    const px = cols.Position.pos.x, py = cols.Position.pos.y;
    const vx = cols.Velocity.vel.x, vy = cols.Velocity.vel.y;
    for (let i = 0; i < count; i++) {
        px[i]! += vx[i]! * DT;
        py[i]! += vy[i]! * DT;
    }
});
console.log(`  e0.pos = (${world.getComponent(e0, "Position").pos.x}, ${world.getComponent(e0, "Position").pos.y})`);

console.log("\n>>> DESPAWN e0 (swap-with-last), e1 should keep its data");
world.despawnEntity(e0);
console.log(`  e1.pos.x = ${world.getComponent(e1, "Position").pos.x}  (expected 10)`);

console.log("\n>>> spawn 40 to trigger growth (capacity starts at 32)");
for (let i = 0; i < 40; i++) {
    world.getComponent(world.spawnEntity("Position"), "Position").pos.x = i;
}
printWorldInfo(world);
