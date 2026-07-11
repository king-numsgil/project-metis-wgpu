// metis-data memory-buffer benchmark: how do the typed views cost, in time and
// memory, against what a game engine would otherwise reach for?
//
//   bun run bench/buffers.ts                 # 100k bodies, default iters
//   bun run bench/buffers.ts --count 1000000 # a million
//   bun run bench/buffers.ts --iters 50      # more timed reps (tighter stats)
//   bun run bench/buffers.ts --json          # machine-readable output only
//
// The component is a MIXED-TYPE struct (f32 vectors + u32 fields) — the realistic
// ECS case. That matters for the baseline: a single `new Float32Array(buffer)`
// view is UNUSABLE here (it would misread the u32 fields as float bits), so the
// honest hand-coded floor ("flat") juggles a Float32Array AND a Uint32Array over
// the same buffer, indexing each field into the right one. There is no cheaper
// correct baseline for a heterogeneous struct.
//
// Workloads (each per-frame-shaped) over N bodies:
//   build      — construct + initialise all N (allocation-shaped)
//   integrate  — pos += vel*dt; age += dt; tick += 1   (touches f32 AND u32)
//   reduce     — sum positions + ticks                 (read-heavy, both types)
// Implementations:
//   md-convenient — metis-data convenient API: arr.at(i).get("field")… (typed, packed)
//   flat          — hand-indexed Float32Array + Uint32Array (the realistic floor)
//   objects       — an array of { px, py, …, tick } plain objects (the ergonomic default)
// The convenient API is fine off the hot path; for the hot path, hand-index the
// packed buffer like `flat` (planned: generated typed accessors that match it).
import {
    allocate,
    ArrayOf,
    F32,
    StructOf,
    U32,
    Vec,
} from "../src/index.ts";

// ── CLI args ──────────────────────────────────────────────────────────────────
function parseArgs(argv: string[]) {
    const opts: Record<string, string | boolean> = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]!;
        if (!a.startsWith("--")) continue;
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith("--")) opts[key] = true;
        else { opts[key] = next; i++; }
    }
    return opts;
}
const args = parseArgs(Bun.argv.slice(2));
const num = (k: string, d: number) => (args[k] !== undefined ? Number(args[k]) : d);
const flag = (k: string) => args[k] === true || args[k] === "true";

const COUNT = num("count", 100_000);
const ITERS = num("iters", 25);
const BUILD_ITERS = Math.max(5, Math.round(ITERS / 3));
const WARMUP = 3;
const DT = 1 / 60;
const JSON_ONLY = flag("json");

// ── The component under test (mixed f32 + u32, Dense) ─────────────────────────
const Body = StructOf({
    position: Vec(F32, 3),
    velocity: Vec(F32, 3),
    tick: U32,
    flags: U32,
    mass: F32,
    age: F32,
});
const STRIDE_W = Body.byteSize / 4; // 10 four-byte words
// Field offsets in words, straight from the descriptor.
const OFF = {
    px: Body.offsetOf("position") / 4,
    vx: Body.offsetOf("velocity") / 4,
    tick: Body.offsetOf("tick") / 4,
    flags: Body.offsetOf("flags") / 4,
    mass: Body.offsetOf("mass") / 4,
    age: Body.offsetOf("age") / 4,
};

function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

interface BodyInit {
    pos: [number, number, number];
    vel: [number, number, number];
    flags: number;
    mass: number;
}
function makeInits(n: number): BodyInit[] {
    const rand = mulberry32(0xc0ffee);
    const out: BodyInit[] = new Array(n);
    for (let i = 0; i < n; i++) {
        out[i] = {
            pos: [rand() * 100 - 50, rand() * 100 - 50, rand() * 100 - 50],
            vel: [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1],
            flags: (rand() * 0xffff) | 0,
            mass: 0.5 + rand() * 4,
        };
    }
    return out;
}

// ── Timing ────────────────────────────────────────────────────────────────────
interface Stats { mean: number; median: number; min: number; p95: number; stddev: number; }
function summarize(samples: number[]): Stats {
    const s = [...samples].sort((a, b) => a - b);
    const n = s.length;
    const mean = s.reduce((x, y) => x + y, 0) / n;
    const variance = s.reduce((x, y) => x + (y - mean) ** 2, 0) / n;
    const pct = (p: number) => s[Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1))]!;
    return { mean, median: pct(50), min: s[0]!, p95: pct(95), stddev: Math.sqrt(variance) };
}
function timed(reps: number, fn: () => void): Stats {
    for (let i = 0; i < WARMUP; i++) fn();
    const samples: number[] = [];
    for (let i = 0; i < reps; i++) {
        const t0 = performance.now();
        fn();
        samples.push(performance.now() - t0);
    }
    return summarize(samples);
}

const inits = makeInits(COUNT);

// ── Implementations ───────────────────────────────────────────────────────────
function makeMdArray() {
    return allocate(ArrayOf(Body, COUNT));
}
type MdArr = ReturnType<typeof makeMdArray>;

// md-wrapper — convenient metis-data, fresh wrapper per field access.
const mdWrapper = {
    build(): MdArr {
        const arr = makeMdArray();
        for (let i = 0; i < COUNT; i++) {
            const s = inits[i]!;
            arr.at(i).set({ position: s.pos, velocity: s.vel, tick: 0, flags: s.flags, mass: s.mass, age: 0 });
        }
        return arr;
    },
    integrate(arr: MdArr) {
        for (let i = 0; i < COUNT; i++) {
            const p = arr.at(i);
            const pos = p.get("position");
            const vel = p.get("velocity");
            const [px, py, pz] = pos.get();
            const [vx, vy, vz] = vel.get();
            pos.set([px + vx * DT, py + vy * DT, pz + vz * DT]);
            const age = p.get("age");
            age.set(age.get() + DT);
            const tick = p.get("tick");
            tick.set(tick.get() + 1);
        }
    },
    reduce(arr: MdArr): number {
        let acc = 0;
        for (let i = 0; i < COUNT; i++) {
            const p = arr.at(i);
            const [px, py, pz] = p.get("position").get();
            acc += px + py + pz + p.get("tick").get();
        }
        return acc;
    },
};

// flat — the realistic hand-coded floor: TWO typed-array views over one buffer
// (a single Float32Array can't address the u32 fields correctly).
interface FlatHandle { f: Float32Array; u: Uint32Array; }
const flat = {
    build(): FlatHandle {
        const buf = new ArrayBuffer(COUNT * Body.byteSize);
        const f = new Float32Array(buf);
        const u = new Uint32Array(buf);
        for (let i = 0; i < COUNT; i++) {
            const b = i * STRIDE_W;
            const s = inits[i]!;
            f[b + OFF.px] = s.pos[0]; f[b + OFF.px + 1] = s.pos[1]; f[b + OFF.px + 2] = s.pos[2];
            f[b + OFF.vx] = s.vel[0]; f[b + OFF.vx + 1] = s.vel[1]; f[b + OFF.vx + 2] = s.vel[2];
            u[b + OFF.tick] = 0; u[b + OFF.flags] = s.flags;
            f[b + OFF.mass] = s.mass; f[b + OFF.age] = 0;
        }
        return { f, u };
    },
    integrate(h: FlatHandle) {
        const { f, u } = h;
        for (let i = 0; i < COUNT; i++) {
            const b = i * STRIDE_W;
            f[b + OFF.px] = f[b + OFF.px]! + f[b + OFF.vx]! * DT;
            f[b + OFF.px + 1] = f[b + OFF.px + 1]! + f[b + OFF.vx + 1]! * DT;
            f[b + OFF.px + 2] = f[b + OFF.px + 2]! + f[b + OFF.vx + 2]! * DT;
            f[b + OFF.age] = f[b + OFF.age]! + DT;
            u[b + OFF.tick] = u[b + OFF.tick]! + 1;
        }
    },
    reduce(h: FlatHandle): number {
        const { f, u } = h;
        let acc = 0;
        for (let i = 0; i < COUNT; i++) {
            const b = i * STRIDE_W;
            acc += f[b + OFF.px]! + f[b + OFF.px + 1]! + f[b + OFF.px + 2]! + u[b + OFF.tick]!;
        }
        return acc;
    },
};

// objects — array of plain JS objects. The ergonomic default.
interface ObjBody {
    px: number; py: number; pz: number;
    vx: number; vy: number; vz: number;
    tick: number; flags: number; mass: number; age: number;
}
const objects = {
    build(): ObjBody[] {
        const out: ObjBody[] = new Array(COUNT);
        for (let i = 0; i < COUNT; i++) {
            const s = inits[i]!;
            out[i] = {
                px: s.pos[0], py: s.pos[1], pz: s.pos[2],
                vx: s.vel[0], vy: s.vel[1], vz: s.vel[2],
                tick: 0, flags: s.flags, mass: s.mass, age: 0,
            };
        }
        return out;
    },
    integrate(o: ObjBody[]) {
        for (let i = 0; i < COUNT; i++) {
            const p = o[i]!;
            p.px += p.vx * DT; p.py += p.vy * DT; p.pz += p.vz * DT;
            p.age += DT; p.tick += 1;
        }
    },
    reduce(o: ObjBody[]): number {
        let acc = 0;
        for (let i = 0; i < COUNT; i++) {
            const p = o[i]!;
            acc += p.px + p.py + p.pz + p.tick;
        }
        return acc;
    },
};

const IMPLS = [
    { name: "md-convenient", impl: mdWrapper },
    { name: "flat", impl: flat },
    { name: "objects", impl: objects },
] as const;

// ── Run ───────────────────────────────────────────────────────────────────────
interface Row {
    name: string;
    bytes: number;
    build: Stats;
    integrate: Stats;
    reduce: Stats;
    checksum: number;
}

// Storage footprint: exact for the buffer-backed impls (they ARE the packed
// ArrayBuffer); the plain-object array is measured via a GC-settled RSS delta,
// because JSC's heapUsed does not account for object/ArrayBuffer bytes.
const EXACT_BYTES = COUNT * Body.byteSize;
let heldObjects: unknown = null;
function objectMemoryBytes(): number {
    const samples: number[] = [];
    for (let s = 0; s < 4; s++) {
        heldObjects = null;
        Bun.gc(true);
        const before = process.memoryUsage().rss;
        heldObjects = objects.build();
        Bun.gc(true);
        samples.push(process.memoryUsage().rss - before);
    }
    samples.sort((a, b) => a - b);
    return Math.max(0, samples[Math.floor(samples.length / 2)]!);
}
const bytesFor: Record<string, number> = {
    "md-convenient": EXACT_BYTES,
    "flat": EXACT_BYTES,
    "objects": objectMemoryBytes(),
};

const rows: Row[] = [];
for (const { name, impl } of IMPLS) {
    const handle = impl.build() as never;
    const build = timed(BUILD_ITERS, () => { impl.build(); });
    const integrate = timed(ITERS, () => { impl.integrate(handle); });
    const checksum = impl.reduce(handle);
    const reduce = timed(ITERS, () => { impl.reduce(handle); });
    rows.push({ name, bytes: bytesFor[name]!, build, integrate, reduce, checksum });
}
void heldObjects;

// ── Report ────────────────────────────────────────────────────────────────────
if (JSON_ONLY) {
    console.log(JSON.stringify({ count: COUNT, iters: ITERS, stride: Body.byteSize, rows }, null, 2));
} else {
    const mel = (ms: number) => (COUNT / ms / 1000).toFixed(1);
    const bpe = (bytes: number) => (bytes / COUNT).toFixed(1);
    const pad = (s: string, n: number) => s.padEnd(n);
    const padL = (s: string, n: number) => s.padStart(n);

    console.log("═".repeat(78));
    console.log("  metis-data — memory-buffer benchmark (mixed-type component)");
    console.log("═".repeat(78));
    console.log(`    Bodies ............ ${COUNT.toLocaleString()}`);
    console.log(`    Component ......... ${Body.byteSize} B/entity (${STRIDE_W} words: vec3 f32 ×2, u32 ×2, f32 ×2) — ${(COUNT * Body.byteSize / 1048576).toFixed(1)} MiB packed`);
    console.log(`    Timed reps ........ integrate/reduce ${ITERS}, build ${BUILD_ITERS} (+${WARMUP} warmup)`);
    console.log(`    Runtime ........... Bun ${Bun.version}`);
    console.log("─".repeat(78));

    const cs0 = rows[0]!.checksum;
    const csOk = rows.every((r) => Math.abs(r.checksum - cs0) < Math.abs(cs0) * 1e-4 + 1);
    console.log(`    checksum ${csOk ? "OK (all impls agree)" : "MISMATCH — results suspect!"}: ${rows.map((r) => r.checksum.toFixed(0)).join("  ")}`);
    console.log("");

    console.log(`    ${pad("impl", 12)} ${padL("mem B/ent", 10)} ${padL("build ms", 9)} ${padL("integr ms", 10)} ${padL("Melem/s", 8)} ${padL("reduce ms", 10)} ${padL("Melem/s", 8)}`);
    console.log(`    ${"-".repeat(12)} ${"-".repeat(10)} ${"-".repeat(9)} ${"-".repeat(10)} ${"-".repeat(8)} ${"-".repeat(10)} ${"-".repeat(8)}`);
    for (const r of rows) {
        console.log(
            `    ${pad(r.name, 12)} ${padL(bpe(r.bytes), 10)} ${padL(r.build.median.toFixed(2), 9)} `
            + `${padL(r.integrate.median.toFixed(3), 10)} ${padL(mel(r.integrate.median), 8)} `
            + `${padL(r.reduce.median.toFixed(3), 10)} ${padL(mel(r.reduce.median), 8)}`,
        );
    }
    console.log("");

    const flatRow = rows.find((r) => r.name === "flat")!;
    const convRow = rows.find((r) => r.name === "md-convenient")!;
    const objRow = rows.find((r) => r.name === "objects")!;
    const rel = (a: number, b: number) => {
        const r = a / b;
        return r >= 1 ? `${r.toFixed(1)}x slower` : `${(b / a).toFixed(1)}x faster`;
    };
    console.log("    integrate, vs the hand-coded flat floor (2 typed-array views):");
    console.log(`      md-convenient .. ${rel(convRow.integrate.median, flatRow.integrate.median)}  (typed named access; fine off the hot path)`);
    console.log(`      objects       .. ${rel(objRow.integrate.median, flatRow.integrate.median)}, ${(objRow.bytes / EXACT_BYTES).toFixed(1)}x memory (${bpe(objRow.bytes)} vs ${bpe(EXACT_BYTES)} B/ent, + GC, not packed)`);
    console.log("    (hot path -> hand-index the packed buffer as 'flat' does; codegen accessors are the planned typed equivalent.)");
    console.log("═".repeat(78));
}
