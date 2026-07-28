// Stress benchmark for the archetype ECS (`src/ecs/`). Pure CPU — no GPU, no
// window, no metis-native. It answers the questions the ECS's design claims
// imply: is `query` actually as fast as a hand-written typed-array loop, how
// much does the `getComponent` accessor really cost, what does structural churn
// (spawn/despawn) cost per entity, and how does either scale with archetype
// count.
//
//   bun run bench:ecs                 # full sweep
//   bun run bench:ecs --quick         # fewer trials / smaller sizes
//   bun run bench:ecs --only A,C      # just those sections
//   bun run bench:ecs --trials 9      # more trials (median is reported)
//
// Method: every number is the MEDIAN of `--trials` trials; each trial is
// auto-calibrated to run at least `--min-ms` so a single measurement is never
// dominated by timer resolution or a cold JIT. Steady-state benchmarks (A, B, D)
// discard warmup calls; benchmarks whose setup can't be reused (C, E) build a
// fresh world per trial OUTSIDE the timer. Every loop feeds a global `sink` that
// is printed at the end, so nothing is dead-code eliminated.
//
// The headline comparison is section A's `raw typed arrays` row: that is the
// ceiling this ECS is trying to reach, measured in the same process on the same
// data, not a remembered number from somewhere else.
import {
    type ComponentDef,
    defineComponent,
    f32,
    inspectWorld,
    u32,
    u8,
    vec3,
    World,
} from "metis-engine/ecs";

// ── CLI ───────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
function flag(name: string): boolean {
    return argv.includes(`--${name}`);
}
function opt(name: string, fallback: string): string {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1]! : fallback;
}

const QUICK = flag("quick");
const TRIALS = Number(opt("trials", QUICK ? "3" : "5"));
const MIN_MS = Number(opt("min-ms", QUICK ? "40" : "120"));
const ONLY = opt("only", "").toUpperCase();
const SIZES = QUICK ? [1_000, 100_000] : [1_000, 10_000, 100_000, 1_000_000];

function sectionEnabled(letter: string): boolean {
    return ONLY === "" || ONLY.includes(letter);
}

// ── Timing harness ────────────────────────────────────────────────────────────

/** Prevents dead-code elimination of every measured loop. Printed at the end. */
let sink = 0;

interface Result {
    label: string;
    /** Nanoseconds per operation (median trial). */
    nsPerOp: number;
    /** Operations per second, derived from `nsPerOp`. */
    opsPerSec: number;
    /** Spread across trials, as (max-min)/median — a sanity check on the median. */
    spread: number;
    note?: string;
}

function median(xs: number[]): number {
    const s = [...xs].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function summarize(label: string, perTrialNs: number[], ops: number, note?: string): Result {
    const perOp = perTrialNs.map((ns) => ns / ops);
    const m = median(perOp);
    return {
        label,
        nsPerOp: m,
        opsPerSec: 1e9 / m,
        spread: m > 0 ? (Math.max(...perOp) - Math.min(...perOp)) / m : 0,
        note,
    };
}

/**
 * A repeatable steady-state measurement: `fn` may be called any number of times
 * and must do the same work each call (no accumulating state). Calibrates the
 * repetition count so one trial spans at least MIN_MS.
 */
function benchSteady(label: string, opsPerCall: number, fn: () => void, note?: string): Result {
    for (let i = 0; i < 3; i++) fn(); // warmup / JIT

    let reps = 1;
    for (;;) {
        const t0 = Bun.nanoseconds();
        for (let i = 0; i < reps; i++) fn();
        const ms = (Bun.nanoseconds() - t0) / 1e6;
        if (ms >= MIN_MS) break;
        // Scale to the target, with a 2x floor so a near-zero measurement still moves.
        reps = Math.max(reps * 2, Math.ceil((reps * MIN_MS) / Math.max(ms, 0.01)));
        if (reps > 1e9) break;
    }

    const trials: number[] = [];
    for (let t = 0; t < TRIALS; t++) {
        const t0 = Bun.nanoseconds();
        for (let i = 0; i < reps; i++) fn();
        trials.push(Bun.nanoseconds() - t0);
    }
    return summarize(label, trials, reps * opsPerCall, note);
}

/**
 * A one-shot measurement whose state cannot be reused: `setup` runs outside the
 * timer, `run` inside it, once per trial. For spawn/despawn benchmarks, where
 * calling twice on the same world would measure something else entirely.
 */
function benchSetup<T>(
    label: string,
    ops: number,
    setup: () => T,
    run: (state: T) => void,
    note?: string,
): Result {
    { // one untimed warmup pass to get the JIT through both functions
        const s = setup();
        run(s);
    }
    const trials: number[] = [];
    for (let t = 0; t < TRIALS; t++) {
        const state = setup();
        const t0 = Bun.nanoseconds();
        run(state);
        trials.push(Bun.nanoseconds() - t0);
    }
    return summarize(label, trials, ops, note);
}

// ── Reporting ─────────────────────────────────────────────────────────────────

function fmtNs(ns: number): string {
    if (ns < 1) return `${(ns * 1000).toFixed(1)} ps`;
    if (ns < 1000) return `${ns.toFixed(1)} ns`;
    if (ns < 1e6) return `${(ns / 1000).toFixed(2)} us`;
    return `${(ns / 1e6).toFixed(2)} ms`;
}

function fmtRate(ops: number): string {
    if (ops >= 1e9) return `${(ops / 1e9).toFixed(2)}B/s`;
    if (ops >= 1e6) return `${(ops / 1e6).toFixed(1)}M/s`;
    if (ops >= 1e3) return `${(ops / 1e3).toFixed(1)}K/s`;
    return `${ops.toFixed(0)}/s`;
}

function header(title: string): void {
    console.log(`\n${"─".repeat(96)}`);
    console.log(`  ${title}`);
    console.log("─".repeat(96));
    console.log(
        `  ${"benchmark".padEnd(46)}${"ns/op".padStart(11)}${"rate".padStart(12)}${"vs base".padStart(10)}  note`,
    );
}

/** Prints a result row; `baseline` (if given) is the row this one is a multiple of. */
function row(r: Result, baseline?: Result): void {
    const rel = baseline ? `${(r.nsPerOp / baseline.nsPerOp).toFixed(2)}x` : "";
    const spread = r.spread > 0.15 ? ` [spread ${(r.spread * 100).toFixed(0)}%]` : "";
    console.log(
        `  ${r.label.padEnd(46)}${fmtNs(r.nsPerOp).padStart(11)}${fmtRate(r.opsPerSec).padStart(12)}${
            rel.padStart(10)
        }  ${r.note ?? ""}${spread}`,
    );
}

// ── The world under test ──────────────────────────────────────────────────────

const Position = defineComponent("Position", { pos: vec3(f32) });
const Velocity = defineComponent("Velocity", { vel: vec3(f32) });
const Accel = defineComponent("Accel", { acc: vec3(f32) });
const Health = defineComponent("Health", { value: f32, regen: f32 });
const Tags = defineComponent("Tags", { bits: u32, team: u8 });

const REGISTRY = { Position, Velocity, Accel, Health, Tags };
type Reg = typeof REGISTRY;

function makeWorld(): World<Reg> {
    return new World(REGISTRY);
}

/** A world holding `n` entities with Position+Velocity, seeded with non-trivial values. */
function seededWorld(n: number, ...comps: Array<keyof Reg & string>): World<Reg> {
    const w = makeWorld();
    const names = comps.length > 0 ? comps : (["Position", "Velocity"] as Array<keyof Reg & string>);
    for (let i = 0; i < n; i++) w.spawnEntity(...names);
    // Seed through the columns rather than getComponent — this is setup, not the
    // thing being measured, and per-entity accessors would dominate it.
    w.query(["Position"], (cols, count) => {
        const { x, y, z } = cols.Position.pos;
        for (let i = 0; i < count; i++) {
            x[i] = i * 0.001;
            y[i] = i * 0.002;
            z[i] = i * 0.003;
        }
    });
    if (names.includes("Velocity")) {
        w.query(["Velocity"], (cols, count) => {
            const { x, y, z } = cols.Velocity.vel;
            for (let i = 0; i < count; i++) {
                x[i] = 1 + (i % 7) * 0.1;
                y[i] = 1 + (i % 5) * 0.1;
                z[i] = 1 + (i % 3) * 0.1;
            }
        });
    }
    return w;
}

/** xorshift32 — deterministic victim selection for churn, no renderer import. */
function rng(seed: number): () => number {
    let s = seed | 0 || 1;
    return () => {
        s ^= s << 13;
        s ^= s >>> 17;
        s ^= s << 5;
        return (s >>> 0) / 4294967296;
    };
}

const DT = 1 / 60;

// ── A. Iteration: is `query` really the hand-written loop? ────────────────────

function sectionA(): void {
    header("A. Iteration — position += velocity * dt, per entity, over 3 axes");

    for (const n of SIZES) {
        // The ceiling: six bare Float32Arrays, the exact loop, no ECS involved.
        const px = new Float32Array(n), py = new Float32Array(n), pz = new Float32Array(n);
        const vx = new Float32Array(n), vy = new Float32Array(n), vz = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            px[i] = i * 0.001; py[i] = i * 0.002; pz[i] = i * 0.003;
            vx[i] = 1 + (i % 7) * 0.1; vy[i] = 1 + (i % 5) * 0.1; vz[i] = 1 + (i % 3) * 0.1;
        }
        const base = benchSteady(`raw typed arrays                   n=${n}`, n, () => {
            for (let i = 0; i < n; i++) {
                px[i]! += vx[i]! * DT;
                py[i]! += vy[i]! * DT;
                pz[i]! += vz[i]! * DT;
            }
            sink += px[0]!;
        });

        const w = seededWorld(n);
        const q = benchSteady(`World.query (SoA columns)          n=${n}`, n, () => {
            w.query(["Position", "Velocity"], (cols, count) => {
                const { x: qx, y: qy, z: qz } = cols.Position.pos;
                const { x: wx, y: wy, z: wz } = cols.Velocity.vel;
                for (let i = 0; i < count; i++) {
                    qx[i]! += wx[i]! * DT;
                    qy[i]! += wy[i]! * DT;
                    qz[i]! += wz[i]! * DT;
                }
                sink += qx[0]!;
            });
        });

        // The random-access path, doing identical work. Capped: at 1e6 entities
        // this takes minutes, and the ratio is already established at 1e5.
        let acc: Result | undefined;
        let qe: Result | undefined;
        if (n <= 100_000) {
            const ids = [...w.queryEntities(["Position", "Velocity"])];
            acc = benchSteady(`getComponent accessor per entity   n=${n}`, n, () => {
                for (let k = 0; k < ids.length; k++) {
                    const id = ids[k]!;
                    const p = w.getComponent(id, "Position");
                    const v = w.getComponent(id, "Velocity");
                    p.pos.x += v.vel.x * DT;
                    p.pos.y += v.vel.y * DT;
                    p.pos.z += v.vel.z * DT;
                }
                sink += 1;
            });
            qe = benchSteady(`queryEntities + getComponent       n=${n}`, n, () => {
                for (const id of w.queryEntities(["Position", "Velocity"])) {
                    const p = w.getComponent(id, "Position");
                    const v = w.getComponent(id, "Velocity");
                    p.pos.x += v.vel.x * DT;
                    p.pos.y += v.vel.y * DT;
                    p.pos.z += v.vel.z * DT;
                }
                sink += 1;
            });
        }

        row(base);
        row(q, base);
        if (acc) row(acc, base);
        if (qe) row(qe, base);
        console.log();
    }
}

// ── B. Access shape: does one column per axis actually pay? ───────────────────

function sectionB(): void {
    header("B. Access shape — what SoA-per-axis buys, and what a wide read costs");
    const n = QUICK ? 100_000 : 1_000_000;
    const w = seededWorld(n, "Position", "Velocity", "Accel", "Health", "Tags");

    const oneAxis = benchSteady(`touch 1 of 3 axes (pos.x only)     n=${n}`, n, () => {
        w.query(["Position"], (cols, count) => {
            const x = cols.Position.pos.x;
            let s = 0;
            for (let i = 0; i < count; i++) s += x[i]!;
            sink += s;
        });
    }, "the SoA claim");

    const threeAxes = benchSteady(`touch 3 of 3 axes                  n=${n}`, n, () => {
        w.query(["Position"], (cols, count) => {
            const { x, y, z } = cols.Position.pos;
            let s = 0;
            for (let i = 0; i < count; i++) s += x[i]! + y[i]! + z[i]!;
            sink += s;
        });
    });

    const fiveComp = benchSteady(`touch 5 components / 10 columns    n=${n}`, n, () => {
        w.query(["Position", "Velocity", "Accel", "Health", "Tags"], (cols, count) => {
            const p = cols.Position.pos, v = cols.Velocity.vel, a = cols.Accel.acc;
            const hp = cols.Health.value, rg = cols.Health.regen;
            const bits = cols.Tags.bits, team = cols.Tags.team;
            let s = 0;
            for (let i = 0; i < count; i++) {
                s += p.x[i]! + p.y[i]! + p.z[i]! + v.x[i]! + v.y[i]! + v.z[i]!
                    + a.x[i]! + a.y[i]! + a.z[i]! + hp[i]! + rg[i]! + bits[i]! + team[i]!;
            }
            sink += s;
        });
    }, "13 columns/entity");

    const branchy = benchSteady(`u8 tag filter + conditional write  n=${n}`, n, () => {
        w.query(["Tags", "Health"], (cols, count) => {
            const team = cols.Tags.team, hp = cols.Health.value, rg = cols.Health.regen;
            for (let i = 0; i < count; i++) {
                if (team[i]! === 0) hp[i]! += rg[i]! * DT;
            }
            sink += hp[0]!;
        });
    }, "predictable branch");

    row(oneAxis);
    row(threeAxes, oneAxis);
    row(fiveComp, oneAxis);
    row(branchy, oneAxis);
    console.log();
}

// ── C. Structural churn: spawn, despawn, and steady-state turnover ────────────

function sectionC(): void {
    header("C. Structural churn — spawn / despawn / steady-state turnover");
    const n = QUICK ? 20_000 : 100_000;

    // Spawn cost as a function of how many components the entity has. Isolates
    // the per-spawn work that is NOT proportional to the data: the rest-args
    // array, makeSignatureKey's sort+join, two Map inserts, and the row zeroing.
    const compSets: Array<Array<keyof Reg & string>> = [
        ["Position"],
        ["Position", "Velocity"],
        ["Position", "Velocity", "Accel"],
        ["Position", "Velocity", "Accel", "Health", "Tags"],
    ];
    const spawnResults: Result[] = [];
    for (const set of compSets) {
        spawnResults.push(benchSetup(
            `spawn ${set.length} component(s)                   n=${n}`,
            n,
            () => makeWorld(),
            (w) => {
                for (let i = 0; i < n; i++) w.spawnEntity(...set);
                sink += w.entityCount;
            },
            set.length === 1 ? "incl. all column growth" : "",
        ));
    }
    for (const r of spawnResults) row(r, spawnResults[0]);
    console.log();

    // Where that time goes. These reproduce, in isolation, the work spawnEntity
    // does per call that is NOT proportional to the component data, so the
    // attribution doesn't depend on a profiler or a scratch script.
    const names = ["Position", "Velocity"];
    const bits = new Map<string, number>([["Position", 0], ["Velocity", 1]]);
    const maskCost = benchSteady(`  isolate: mask OR from names (current)`.padEnd(46), 1, () => {
        let m = 0;
        for (let i = 0; i < names.length; i++) m |= 1 << bits.get(names[i]!)!;
        sink += m;
    }, "makeSignatureMask, per spawnEntity call");
    const keyCost = benchSteady(`  isolate: sort().join(",") — REPLACED`.padEnd(46), 1, () => {
        sink += [...names].sort().join(",").length;
    }, "the string key the mask replaced; kept as the A/B");
    const mapCost = benchSetup(
        `  isolate: 2x Map.set (id->row, id->key)`.padEnd(46),
        n,
        () => ({ a: new Map<number, number>(), b: new Map<number, string>() }),
        ({ a, b }) => {
            for (let i = 0; i < n; i++) { a.set(i, i); b.set(i, "Position,Velocity"); }
            sink += a.size + b.size;
        },
        "World.entityArchetype + Archetype.rowOfEntity",
    );
    const zeroCost = benchSetup(
        `  isolate: nested-Map walk + 6 zero stores`.padEnd(46),
        n,
        () => {
            const store = new Map<string, Map<string, { arrays: Float32Array[] }>>();
            for (const c of names) {
                const f = new Map<string, { arrays: Float32Array[] }>();
                f.set("v", { arrays: [new Float32Array(n), new Float32Array(n), new Float32Array(n)] });
                store.set(c, f);
            }
            return store;
        },
        (store) => {
            for (let r = 0; r < n; r++) {
                for (const fields of store.values()) {
                    for (const col of fields.values()) for (const arr of col.arrays) arr[r] = 0;
                }
            }
            sink += 1;
        },
        "addEntity's row zeroing",
    );
    row(maskCost);
    row(keyCost);
    row(mapCost);
    row(zeroCost);
    console.log(
        `  ^ the two Map.sets now dominate a spawn; the data itself is 6 float stores.`,
    );
    console.log();

    // Despawn order matters: swap-with-last means removing the FRONT copies the
    // tail row down every time, removing the BACK is a plain pop.
    const mk = () => {
        const w = seededWorld(n);
        return { w, ids: [...w.queryEntities(["Position", "Velocity"])] };
    };
    const backwards = benchSetup(`despawn all, back to front         n=${n}`, n, mk, ({ w, ids }) => {
        for (let i = ids.length - 1; i >= 0; i--) w.despawnEntity(ids[i]!);
        sink += w.entityCount;
    }, "pure pop, no swap");
    const forwards = benchSetup(`despawn all, front to back         n=${n}`, n, mk, ({ w, ids }) => {
        for (let i = 0; i < ids.length; i++) w.despawnEntity(ids[i]!);
        sink += w.entityCount;
    }, "swap every time");
    row(backwards);
    row(forwards, backwards);
    console.log();

    // Steady state: population held constant, one despawn+spawn pair per op.
    // This is the shape a real sim has (bullets, particles, debris).
    for (const churnFrac of QUICK ? [0.1] : [0.01, 0.1, 1.0]) {
        const cycles = Math.max(1, Math.round(n * churnFrac));
        const r = benchSetup(
            `churn ${(churnFrac * 100).toFixed(0)}% of ${n} (despawn+spawn)`.padEnd(46).slice(0, 46),
            cycles,
            () => {
                const w = seededWorld(n);
                return { w, ids: [...w.queryEntities(["Position", "Velocity"])], rand: rng(0x5eed) };
            },
            ({ w, ids, rand }) => {
                for (let i = 0; i < cycles; i++) {
                    const k = (rand() * ids.length) | 0;
                    w.despawnEntity(ids[k]!);
                    ids[k] = w.spawnEntity("Position", "Velocity");
                }
                sink += w.entityCount;
            },
            "per despawn+spawn pair",
        );
        row(r);
    }
    console.log();
}

// ── D. Archetype scaling: what a fragmented world costs per query ─────────────

function sectionD(): void {
    header("D. Archetype scaling — per-query dispatch cost as the world fragments");

    // Build A distinct archetypes from distinct COMBINATIONS of a fixed pool of
    // tag components — which is how a real world fragments, and what keeps the
    // registry inside MAX_COMPONENT_TYPES. (One unique tag per archetype, the
    // obvious construction, both blows the 32-component ceiling and models a
    // world nobody has.) Each archetype holds a handful of entities, so the
    // measurement is dominated by dispatch — signature matching plus the
    // per-archetype `picked` object — not by data.
    const TAG_POOL = 22; // + Position + Velocity = 24 components, one mask word
    const counts = QUICK ? [1, 32, 256] : [1, 8, 64, 256, 1024];
    const perArch = 8;
    const results: Result[] = [];

    // T0..T2 are declared explicitly so the selective query below stays typed;
    // the rest of the pool only ever appears in runtime-computed combinations.
    const T0 = defineComponent("T0", { v: f32 });
    const T1 = defineComponent("T1", { v: f32 });
    const T2 = defineComponent("T2", { v: f32 });
    const tags: Record<string, ComponentDef> = {};
    for (let i = 3; i < TAG_POOL; i++) tags[`T${i}`] = defineComponent(`T${i}`, { v: f32 });

    for (const archCount of counts) {
        // Position/Velocity stay literal-typed so the measured callbacks below
        // need no casts; only the spawn call, whose component names are computed
        // at runtime, is widened — and that is setup, outside every timer.
        const w = new World({ Position, Velocity, T0, T1, T2, ...tags });
        const spawn = w.spawnEntity.bind(w) as (...names: string[]) => number;
        for (let seed = 1, made = 0; made < archCount; seed++) {
            const combo: string[] = [];
            for (let b = 0; b < TAG_POOL; b++) if (seed & (1 << b)) combo.push(`T${b}`);
            if (combo.length === 0) continue;
            for (let i = 0; i < perArch; i++) {
                spawn("Position", "Velocity", ...combo);
            }
            made++;
        }
        const total = archCount * perArch;

        // One query touching every entity in the world, spread over archCount archetypes.
        results.push(benchSteady(
            `query over ${String(archCount).padStart(4)} archetypes (${total} ents)`.padEnd(46).slice(0, 46),
            1,
            () => {
                w.query(["Position", "Velocity"], (cols, count) => {
                    const x = cols.Position.pos.x;
                    let s = 0;
                    for (let i = 0; i < count; i++) s += x[i]!;
                    sink += s;
                });
            },
            "per whole query call",
        ));

        // The same fragmented world, but a selective query: it needs T0+T1+T2,
        // which only combos with all three low bits set have — about 1 in 8. The
        // other ~7/8 are pure rejection cost, which is what this row measures.
        results.push(benchSteady(
            `  ...selective, ~1/8 of ${String(archCount).padStart(4)} match`.padEnd(46).slice(0, 46),
            1,
            () => {
                w.query(["Position", "Velocity", "T0", "T1", "T2"], (cols, count) => {
                    const x = cols.Position.pos.x;
                    let s = 0;
                    for (let i = 0; i < count; i++) s += x[i]!;
                    sink += s;
                });
            },
        ));
    }

    for (const r of results) row(r, results[0]);
    console.log();
}

// ── E. Memory: footprint and churn-generated garbage ──────────────────────────

function sectionE(): void {
    header("E. Memory — column footprint and the garbage churn generates");
    const n = QUICK ? 50_000 : 500_000;

    const w = seededWorld(n, "Position", "Velocity", "Accel", "Health", "Tags");
    const info = inspectWorld(w);
    const arch = info.archetypes[0]!;
    const perEntity = arch.allocatedBytes / arch.capacity;
    console.log(`  entities            : ${arch.entityCount} (capacity ${arch.capacity})`);
    console.log(`  columns allocated   : ${(arch.allocatedBytes / 1e6).toFixed(2)} MB`);
    console.log(`  columns live        : ${(arch.usedBytes / 1e6).toFixed(2)} MB`);
    console.log(
        `  slack from doubling : ${
            (100 * (1 - arch.entityCount / arch.capacity)).toFixed(1)
        }% (worst case just past a doubling: 50%)`,
    );
    console.log(`  bytes/entity        : ${perEntity} (5 components, 13 columns)`);

    // Total heap vs. the columns above: the gap is the per-entity bookkeeping
    // (World.entityArchetype, Archetype.rowOfEntity, Archetype.entities).
    Bun.gc(true);
    const atRest = process.memoryUsage().heapUsed;
    console.log(
        `  total heap at rest  : ${(atRest / 1e6).toFixed(1)} MB — ${
            (atRest / arch.entityCount).toFixed(0)
        } B/entity, vs ${perEntity} B of actual component data`,
    );

    // Does churn leak? Measure ACROSS ROUNDS with a forced GC each time, not as a
    // single before/after delta: the Maps take one step up when deletions start
    // leaving tombstones, and a rehash transiently doubles the table. A one-shot
    // delta catches that step plus the transient and reads as a leak.
    console.log();
    console.log(`  churn: ${arch.entityCount} entities held constant, one round = that many despawn+spawn pairs`);
    const ids = [...w.queryEntities(["Position", "Velocity"])];
    const rand = rng(0xc0ffee);
    const rounds = QUICK ? 3 : 6;
    let prev = atRest;
    for (let r = 1; r <= rounds; r++) {
        for (let i = 0; i < ids.length; i++) {
            const k = (rand() * ids.length) | 0;
            w.despawnEntity(ids[k]!);
            ids[k] = w.spawnEntity("Position", "Velocity", "Accel", "Health", "Tags");
        }
        Bun.gc(true);
        const now = process.memoryUsage().heapUsed;
        console.log(
            `    round ${r} (${String((r + 1) * arch.entityCount).padStart(8)} ids issued) : ${
                (now / 1e6).toFixed(1).padStart(7)
            } MB   delta ${((now - prev) / 1e6).toFixed(1).padStart(7)} MB`,
        );
        prev = now;
        sink += w.entityCount;
    }
    console.log(`  -> a plateau (with a rehash step early on) is the pass condition; steady growth would be a leak.`);
    console.log();
}

// ── F. Frame budget: what a realistic multi-system tick costs ─────────────────

function sectionF(): void {
    header("F. Frame budget — a realistic tick (4 systems + churn) at 60 Hz");

    for (const n of QUICK ? [100_000] : [10_000, 100_000, 1_000_000]) {
        const w = seededWorld(n, "Position", "Velocity", "Accel", "Health", "Tags");
        const ids = [...w.queryEntities(["Position"])];
        const rand = rng(0xbeef);
        const churnPerFrame = Math.max(1, Math.round(n * 0.01)); // 1% turnover/frame

        const r = benchSetup(
            `tick ${String(n).padStart(9)} entities`.padEnd(46).slice(0, 46),
            1,
            () => ({ w, ids, rand }),
            (s) => {
                // 1. integrate velocity from acceleration
                s.w.query(["Velocity", "Accel"], (cols, count) => {
                    const v = cols.Velocity.vel, a = cols.Accel.acc;
                    for (let i = 0; i < count; i++) {
                        v.x[i]! += a.x[i]! * DT;
                        v.y[i]! += a.y[i]! * DT;
                        v.z[i]! += a.z[i]! * DT;
                    }
                });
                // 2. integrate position from velocity
                s.w.query(["Position", "Velocity"], (cols, count) => {
                    const p = cols.Position.pos, v = cols.Velocity.vel;
                    for (let i = 0; i < count; i++) {
                        p.x[i]! += v.x[i]! * DT;
                        p.y[i]! += v.y[i]! * DT;
                        p.z[i]! += v.z[i]! * DT;
                    }
                });
                // 3. damping + ground clamp (a branch that is NOT well predicted)
                s.w.query(["Position", "Velocity"], (cols, count) => {
                    const p = cols.Position.pos, v = cols.Velocity.vel;
                    for (let i = 0; i < count; i++) {
                        v.x[i]! *= 0.999;
                        v.y[i]! *= 0.999;
                        v.z[i]! *= 0.999;
                        if (p.y[i]! < 0) { p.y[i] = 0; v.y[i]! = -v.y[i]! * 0.5; }
                    }
                });
                // 4. regen, gated on a tag
                s.w.query(["Health", "Tags"], (cols, count) => {
                    const hp = cols.Health.value, rg = cols.Health.regen, team = cols.Tags.team;
                    for (let i = 0; i < count; i++) {
                        if (team[i]! === 0) hp[i]! = Math.min(100, hp[i]! + rg[i]! * DT);
                    }
                });
                // 5. structural churn — 1% of the population turns over
                for (let i = 0; i < churnPerFrame; i++) {
                    const k = (s.rand() * s.ids.length) | 0;
                    s.w.despawnEntity(s.ids[k]!);
                    s.ids[k] = s.w.spawnEntity("Position", "Velocity", "Accel", "Health", "Tags");
                }
                sink += s.w.entityCount;
            },
            `${churnPerFrame} churned/frame`,
        );

        const budgetPct = (r.nsPerOp / 1e6 / 16.667) * 100;
        row({ ...r, note: `${r.note}, ${budgetPct.toFixed(1)}% of a 16.7 ms frame` });
    }
    console.log();
}

// ── main ──────────────────────────────────────────────────────────────────────

console.log(`\nECS stress benchmark — ${TRIALS} trials/measurement, >=${MIN_MS} ms per trial, median reported`);
console.log(`Bun ${Bun.version} on ${process.platform}/${process.arch}${QUICK ? "   [--quick]" : ""}`);

if (sectionEnabled("A")) sectionA();
if (sectionEnabled("B")) sectionB();
if (sectionEnabled("C")) sectionC();
if (sectionEnabled("D")) sectionD();
if (sectionEnabled("E")) sectionE();
if (sectionEnabled("F")) sectionF();

console.log(`(sink = ${sink.toFixed(3)} — printed so nothing above is dead-code eliminated)\n`);
