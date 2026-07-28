import { describe, expect, test } from "bun:test";
import { MAX_COMPONENT_TYPES } from "../archetype.ts";
import { type ComponentDef, defineComponent } from "../component.ts";
import { f32, u32, vec3 } from "../field.ts";
import { World } from "../world.ts";

function makeWorld() {
    return new World({
        Position: defineComponent("Position", { pos: vec3(f32) }),
        Velocity: defineComponent("Velocity", { vel: vec3(f32) }),
        Health: defineComponent("Health", { value: f32 }),
        Tags: defineComponent("Tags", { bits: u32 }),
    });
}

describe("spawn / getComponent random access", () => {
    test("scalar and vec fields round-trip", () => {
        const w = makeWorld();
        const e = w.spawnEntity("Position", "Health", "Tags");
        const pos = w.getComponent(e, "Position");
        pos.pos.x = 1;
        pos.pos.y = 2;
        pos.pos.z = 3;
        w.getComponent(e, "Health").value = 42;
        w.getComponent(e, "Tags").bits = 0b1010;

        expect(w.getComponent(e, "Position").pos.x).toBe(1);
        expect(w.getComponent(e, "Position").pos.y).toBe(2);
        expect(w.getComponent(e, "Position").pos.z).toBe(3);
        expect(w.getComponent(e, "Health").value).toBe(42);
        expect(w.getComponent(e, "Tags").bits).toBe(0b1010);
    });

    test("fresh entities are zero-initialised", () => {
        const w = makeWorld();
        const e = w.spawnEntity("Position", "Health");
        expect(w.getComponent(e, "Position").pos.x).toBe(0);
        expect(w.getComponent(e, "Health").value).toBe(0);
    });

    test("u32 wraps like its typed array", () => {
        const w = makeWorld();
        const e = w.spawnEntity("Tags");
        w.getComponent(e, "Tags").bits = -1;
        expect(w.getComponent(e, "Tags").bits).toBe(0xffffffff);
    });

    test("entities are independent", () => {
        const w = makeWorld();
        const a = w.spawnEntity("Position");
        const b = w.spawnEntity("Position");
        w.getComponent(a, "Position").pos.x = 5;
        expect(w.getComponent(b, "Position").pos.x).toBe(0);
    });
});

describe("query fast path", () => {
    test("integrates every matching entity across archetypes", () => {
        const w = makeWorld();
        // Two archetypes both contain Position+Velocity.
        const a = w.spawnEntity("Position", "Velocity");
        const b = w.spawnEntity("Position", "Velocity", "Tags");
        const c = w.spawnEntity("Position"); // no Velocity — must be skipped
        for (const [e, px, vx] of [[a, 1, 10], [b, 2, 20]] as const) {
            w.getComponent(e, "Position").pos.x = px;
            w.getComponent(e, "Velocity").vel.x = vx;
        }
        w.getComponent(c, "Position").pos.x = 99;

        w.query(["Position", "Velocity"], (cols, count) => {
            const px = cols.Position.pos.x, vx = cols.Velocity.vel.x;
            for (let i = 0; i < count; i++) px[i]! += vx[i]!;
        });

        expect(w.getComponent(a, "Position").pos.x).toBe(11);
        expect(w.getComponent(b, "Position").pos.x).toBe(22);
        expect(w.getComponent(c, "Position").pos.x).toBe(99); // untouched
    });

    test("callback receives dense count and entity ids", () => {
        const w = makeWorld();
        const ids = [w.spawnEntity("Position"), w.spawnEntity("Position"), w.spawnEntity("Position")];
        let seenCount = 0;
        const seenIds: number[] = [];
        w.query(["Position"], (_cols, count, entityIds) => {
            seenCount += count;
            seenIds.push(...entityIds.slice(0, count));
        });
        expect(seenCount).toBe(3);
        expect(seenIds.sort()).toEqual([...ids].sort());
    });

    test("writes through columns are visible via getComponent", () => {
        const w = makeWorld();
        const e = w.spawnEntity("Position");
        w.query(["Position"], (cols, count) => {
            for (let i = 0; i < count; i++) {
                cols.Position.pos.x[i] = 7;
                cols.Position.pos.z[i] = 9;
            }
        });
        expect(w.getComponent(e, "Position").pos.x).toBe(7);
        expect(w.getComponent(e, "Position").pos.z).toBe(9);
    });
});

describe("despawn (swap-with-last)", () => {
    test("removing a middle entity keeps the others' data intact", () => {
        const w = makeWorld();
        const a = w.spawnEntity("Position");
        const b = w.spawnEntity("Position");
        const c = w.spawnEntity("Position");
        w.getComponent(a, "Position").pos.x = 1;
        w.getComponent(b, "Position").pos.x = 2;
        w.getComponent(c, "Position").pos.x = 3;

        w.despawnEntity(a); // c swaps into a's row
        expect(w.getComponent(b, "Position").pos.x).toBe(2);
        expect(w.getComponent(c, "Position").pos.x).toBe(3);
        expect(w.entityCount).toBe(2);
    });

    test("a reused slot is zeroed for the next spawn", () => {
        const w = makeWorld();
        const a = w.spawnEntity("Position");
        w.getComponent(a, "Position").pos.x = 123;
        w.despawnEntity(a);              // frees the slot (stale 123 left behind)
        const b = w.spawnEntity("Position"); // must reuse it, zeroed
        expect(w.getComponent(b, "Position").pos.x).toBe(0);
    });

    test("removing the last entity is a plain pop", () => {
        const w = makeWorld();
        const a = w.spawnEntity("Position");
        const b = w.spawnEntity("Position");
        w.getComponent(a, "Position").pos.x = 1;
        w.despawnEntity(b);
        expect(w.getComponent(a, "Position").pos.x).toBe(1);
    });
});

describe("buffer growth preserves data", () => {
    test("spawning past the initial capacity keeps every value", () => {
        const w = makeWorld();
        const ids: number[] = [];
        for (let i = 0; i < 100; i++) { // past INITIAL_CAPACITY (32) twice over
            const e = w.spawnEntity("Position");
            w.getComponent(e, "Position").pos.x = i;
            ids.push(e);
        }
        for (let i = 0; i < ids.length; i++) {
            expect(w.getComponent(ids[i]!, "Position").pos.x).toBe(i);
        }
        // Accessors created before growth still read correctly afterwards.
        const first = w.getComponent(ids[0]!, "Position");
        expect(first.pos.x).toBe(0);
    });
});

describe("archetypes and queries", () => {
    test("same component set = one archetype regardless of name order", () => {
        const w = makeWorld();
        w.spawnEntity("Position", "Velocity");
        w.spawnEntity("Velocity", "Position");
        expect(w.archetypeCount).toBe(1);
    });

    test("queryEntities yields only supersets of the requested set", () => {
        const w = makeWorld();
        const a = w.spawnEntity("Position", "Velocity");
        w.spawnEntity("Position"); // missing Velocity
        expect([...w.queryEntities(["Position", "Velocity"])]).toEqual([a]);
    });
});

describe("bitmask signatures", () => {
    /**
     * A registry holding exactly `MAX_COMPONENT_TYPES` components, with `First`
     * at bit 0 and `Last` at bit 31 — the sign bit. Those two are declared
     * properties so they stay precisely typed; the filler spread only
     * contributes an index signature, which is what keeps the tests below free
     * of casts.
     */
    function cappedRegistry() {
        const filler: Record<string, ComponentDef> = {};
        for (let i = 0; i < MAX_COMPONENT_TYPES - 2; i++) {
            filler[`F${i}`] = defineComponent(`F${i}`, { v: f32 });
        }
        return {
            First: defineComponent("First", { v: f32 }),
            ...filler,
            Last: defineComponent("Last", { v: f32 }),
        };
    }

    test("the fixture really does put Last on the sign bit", () => {
        const keys = Object.keys(cappedRegistry());
        expect(keys).toHaveLength(MAX_COMPONENT_TYPES);
        expect(keys.indexOf("Last")).toBe(31);
    });

    test("a registry at the cap is accepted", () => {
        expect(() => new World(cappedRegistry())).not.toThrow();
    });

    test("a registry over the cap throws, pointing at the constant", () => {
        const tooMany: Record<string, ComponentDef> = cappedRegistry();
        tooMany.OneTooMany = defineComponent("OneTooMany", { v: f32 });
        expect(() => new World(tooMany)).toThrow(/MAX_COMPONENT_TYPES/);
    });

    // The highest bit makes a mask NEGATIVE (1 << 31 === -2147483648). Mask
    // building, archetype keying, and the (a & q) === q test all have to agree
    // on signed int32; normalising any one of them with `>>> 0` breaks matching
    // silently. Mutation-checked — adding `>>> 0` to makeSignatureMask fails
    // this test and the next.
    test("the sign-bit component (bit 31) spawns, matches, and reads back", () => {
        const w = new World(cappedRegistry());
        const e = w.spawnEntity("First", "Last");
        w.getComponent(e, "Last").v = 7;

        expect([...w.queryEntities(["Last"])]).toEqual([e]);
        expect([...w.queryEntities(["First", "Last"])]).toEqual([e]);
        expect(w.getComponent(e, "Last").v).toBe(7);

        let seen = 0;
        w.query(["Last"], (cols, count) => {
            seen += count;
            expect(cols.Last.v[0]).toBe(7);
        });
        expect(seen).toBe(1);
    });

    test("a query for the sign-bit component does not match archetypes lacking it", () => {
        const w = new World(cappedRegistry());
        w.spawnEntity("First"); // no bit 31
        const withLast = w.spawnEntity("First", "Last");
        expect([...w.queryEntities(["Last"])]).toEqual([withLast]);
    });

    // OR is idempotent, so a duplicated name collapses. The old sorted-string
    // key produced "Position,Position" — a second, distinct archetype.
    test("duplicate component names resolve to the same archetype", () => {
        const w = makeWorld();
        w.spawnEntity("Position", "Position");
        w.spawnEntity("Position");
        expect(w.archetypeCount).toBe(1);
        expect(w.entityCount).toBe(2);
    });

    test("querying an unregistered component throws instead of matching nothing", () => {
        const w = makeWorld();
        w.spawnEntity("Position");
        // @ts-expect-error — "Nope" is not a registered component
        expect(() => w.query(["Nope"], () => {})).toThrow(/not registered/);
        // @ts-expect-error — generators throw on first next()
        expect(() => [...w.queryEntities(["Nope"])]).toThrow(/not registered/);
    });
});

describe("error paths", () => {
    test("spawning an unregistered component throws", () => {
        const w = makeWorld();
        // @ts-expect-error — "Nope" is not a registered component
        expect(() => w.spawnEntity("Nope")).toThrow(/not registered/);
    });

    test("operating on a nonexistent entity throws", () => {
        const w = makeWorld();
        expect(() => w.getComponent(999, "Position")).toThrow(/does not exist/);
        expect(() => w.despawnEntity(999)).toThrow(/does not exist/);
    });
});
