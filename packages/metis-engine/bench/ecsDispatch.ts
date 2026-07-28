// Decomposes World.query's per-archetype dispatch into matching vs. `picked`
// allocation, to settle whether a bitmask signature alone recovers the cost.
//
// Fairness notes, both learned the hard way:
//  - The mask must live ON the archetype record (a plain number field), not in a
//    side Map keyed by the archetype object. The side-Map version measured
//    ~8x SLOWER than string `includes`, because it paid an object-keyed hash
//    plus a heap indirection per archetype.
//  - Archetypes are formed from COMBINATIONS of a few tag components, not from
//    N unique tags. That's how real worlds fragment, and it keeps the whole
//    registry inside 32 bits so the mask is one word.
import { type Archetype, type ComponentDef, defineComponent, f32, vec3, World } from "metis-engine/ecs";

const Position = defineComponent("Position", { pos: vec3(f32) });
const Velocity = defineComponent("Velocity", { vel: vec3(f32) });

const TAG_COUNT = 22; // + Position + Velocity = 24 components, one mask word
let sink = 0;

function t(label: string, ops: number, fn: () => void): void {
    for (let i = 0; i < 50; i++) fn();
    let reps = 64;
    for (;;) {
        const t0 = Bun.nanoseconds();
        for (let r = 0; r < reps; r++) fn();
        const ms = (Bun.nanoseconds() - t0) / 1e6;
        if (ms >= 100 || reps > 1e8) break;
        reps = Math.max(reps * 2, Math.ceil((reps * 100) / Math.max(ms, 0.01)));
    }
    const trials: number[] = [];
    for (let k = 0; k < 7; k++) {
        const t0 = Bun.nanoseconds();
        for (let r = 0; r < reps; r++) fn();
        trials.push((Bun.nanoseconds() - t0) / reps);
    }
    trials.sort((a, b) => a - b);
    console.log(
        `    ${label.padEnd(48)} ${(trials[3]! / ops).toFixed(1).padStart(6)} ns/arch  ${
            (trials[3]! / 1000).toFixed(2).padStart(8)
        } us/query`,
    );
}

/**
 * What every variant's callback reads. `Archetype.columns` is deliberately
 * loosely typed — precision is `World.query`'s job — so the hand-rolled variants
 * below narrow through this once rather than casting at each use.
 */
interface PosCols {
    Position: { pos: { x: Float32Array } };
}

function body(cols: PosCols, count: number): void {
    const x = cols.Position.pos.x;
    for (let i = 0; i < count; i++) sink += x[i]!;
}

interface Rec { mask: number; names: readonly string[]; a: Archetype; picked: PosCols }

for (const A of [16, 64, 256, 1024]) {
    const tagDefs: Record<string, ReturnType<typeof defineComponent>> = {};
    for (let i = 0; i < TAG_COUNT; i++) tagDefs[`T${i}`] = defineComponent(`T${i}`, { v: f32 });
    // Position/Velocity stay literal-typed so every measured callback is
    // cast-free; only the runtime-named spawn is widened, in setup.
    const w = new World({ Position, Velocity, ...tagDefs });
    const spawn = w.spawnEntity.bind(w) as (...names: string[]) => number;

    // A distinct tag combinations -> A distinct archetypes, all matching the query.
    const combos: string[][] = [];
    for (let seed = 1; combos.length < A; seed++) {
        const combo: string[] = [];
        for (let b = 0; b < TAG_COUNT; b++) if (seed & (1 << b)) combo.push(`T${b}`);
        if (combo.length > 0) combos.push(combo);
    }
    for (const combo of combos) spawn("Position", "Velocity", ...combo);

    const bitOf = new Map<string, number>([["Position", 0], ["Velocity", 1]]);
    for (let i = 0; i < TAG_COUNT; i++) bitOf.set(`T${i}`, 2 + i);
    const qMask = (1 << 0) | (1 << 1);
    const names = ["Position", "Velocity"];

    // The archetype list as World would hold it if it kept masks inline.
    const recs: Rec[] = [];
    for (const a of w.iterArchetypes()) {
        let mask = 0;
        for (const n of a.componentNames) mask |= 1 << bitOf.get(n)!;
        recs.push({
            mask,
            names: a.componentNames,
            a,
            // Two keys, matching the shape World.query builds — the megamorphism
            // finding depends on every archetype's copy having the SAME shape.
            picked: { Position: a.columns.Position, Velocity: a.columns.Velocity } as unknown as PosCols,
        });
    }
    const matches = recs.filter((r) => (r.mask & qMask) === qMask);

    console.log(`\n  A=${A} archetypes (all match, 1 entity each; ${w.archetypeCount} real)`);

    t("1. World.query (as shipped)", A, () => {
        w.query(["Position", "Velocity"], body);
    });
    t("2. array iter + includes match + picked{}", A, () => {
        for (let i = 0; i < recs.length; i++) {
            const r = recs[i]!;
            let ok = true;
            for (const n of names) if (!r.names.includes(n)) { ok = false; break; }
            if (!ok) continue;
            const all = r.a.columns;
            const picked = {} as Record<string, unknown>;
            for (const n of names) picked[n] = all[n];
            body(picked as unknown as PosCols, r.a.count);
        }
    });
    t("3. array iter + INLINE MASK match + picked{}", A, () => {
        for (let i = 0; i < recs.length; i++) {
            const r = recs[i]!;
            if ((r.mask & qMask) !== qMask) continue;
            const all = r.a.columns;
            const picked = {} as Record<string, unknown>;
            for (const n of names) picked[n] = all[n];
            body(picked as unknown as PosCols, r.a.count);
        }
    });
    t("4. array iter + INLINE MASK + cached picked", A, () => {
        for (let i = 0; i < recs.length; i++) {
            const r = recs[i]!;
            if ((r.mask & qMask) !== qMask) continue;
            body(r.picked, r.a.count);
        }
    });
    t("5. prepared: only matches, cached picked", A, () => {
        for (let i = 0; i < matches.length; i++) {
            const r = matches[i]!;
            body(r.picked, r.a.count);
        }
    });
    // The one-line candidate: keep `includes` matching exactly as shipped, but
    // hand the callback the archetype's ALREADY-BUILT columnsView instead of
    // constructing a filtered copy of it per call.
    t("7. includes match + pass a.columns (no picked)", A, () => {
        for (let i = 0; i < recs.length; i++) {
            const r = recs[i]!;
            let ok = true;
            for (const n of names) if (!r.names.includes(n)) { ok = false; break; }
            if (!ok) continue;
            body(r.a.columns as unknown as PosCols, r.a.count);
        }
    });
    t("8. INLINE MASK + pass a.columns (both fixes)", A, () => {
        for (let i = 0; i < recs.length; i++) {
            const r = recs[i]!;
            if ((r.mask & qMask) !== qMask) continue;
            body(r.a.columns as unknown as PosCols, r.a.count);
        }
    });
    t("6. floor: array iter + .count only", A, () => {
        for (let i = 0; i < recs.length; i++) sink += recs[i]!.a.count;
    });
}

console.log(`\nsink=${sink.toFixed(0)}`);
