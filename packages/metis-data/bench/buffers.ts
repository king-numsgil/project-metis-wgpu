// metis-data memory-buffer benchmark: how do the typed views cost, in time and
// memory, against the two things a game engine would otherwise reach for — a
// hand-indexed flat Float32Array (the theoretical floor) and an array of plain
// JS objects (the ergonomic default)?
//
//   bun run bench/buffers.ts                 # 100k particles, default iters
//   bun run bench/buffers.ts --count 1000000 # a million
//   bun run bench/buffers.ts --iters 50      # more timed reps (tighter stats)
//   bun run bench/buffers.ts --json          # machine-readable output only
//
// It runs three per-frame-shaped workloads over N particles (a 48-byte AoS
// component: position/velocity vec3, color vec4, mass/age scalars):
//   build      — construct + initialise all N (allocation-shaped)
//   integrate  — pos += vel*dt; age += dt   (write-heavy, the steady-state cost)
//   reduce     — sum positions -> centroid  (read-heavy)
// against four implementations:
//   md-wrapper — idiomatic metis-data: arr.at(i).get("pos").set(...) — allocates
//                a fresh view wrapper per access (the churn we want a number for)
//   md-view    — metis-data storage, but one long-lived .view() hand-indexed
//   flat       — a plain Float32Array, same AoS layout, hand-indexed (the floor)
//   objects    — an array of { px, py, ... } plain objects (the baseline)
// md-view and flat should tie: metis-data's buffer *is* a flat typed array, so
// the descriptor adds zero storage/throughput overhead. The gap between
// md-wrapper and md-view is the price of the ergonomic access path.
import {
    allocate,
    ArrayOf,
    F32,
    StructOf,
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
const ITERS = num("iters", 25); // timed reps for integrate/reduce
const BUILD_ITERS = Math.max(5, Math.round(ITERS / 3)); // build is heavier; fewer reps
const WARMUP = 3;
const DT = 1 / 60;
const JSON_ONLY = flag("json");

// ── The component under test ──────────────────────────────────────────────────
// Dense (particle/vertex-style) packing: tightest, no padding. 48 bytes = 12 f32.
const Particle = StructOf({
    position: Vec(F32, 3),
    velocity: Vec(F32, 3),
    color: Vec(F32, 4),
    mass: F32,
    age: F32,
});
const STRIDE_F32 = Particle.byteSize / 4; // 12
// Field offsets in floats, straight from the descriptor (no hardcoding).
const OFF = {
    px: Particle.offsetOf("position") / 4,
    vx: Particle.offsetOf("velocity") / 4,
    r: Particle.offsetOf("color") / 4,
    mass: Particle.offsetOf("mass") / 4,
    age: Particle.offsetOf("age") / 4,
};

// Deterministic pseudo-random so every implementation gets identical inputs.
function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

interface ParticleInit {
    pos: [number, number, number];
    vel: [number, number, number];
    color: [number, number, number, number];
    mass: number;
    age: number;
}
function makeInits(n: number): ParticleInit[] {
    const rand = mulberry32(0xc0ffee);
    const out: ParticleInit[] = new Array(n);
    for (let i = 0; i < n; i++) {
        out[i] = {
            pos: [rand() * 100 - 50, rand() * 100 - 50, rand() * 100 - 50],
            vel: [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1],
            color: [rand(), rand(), rand(), 1],
            mass: 0.5 + rand() * 4,
            age: 0,
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
// Each exposes: build() -> handle, integrate(handle), reduce(handle) -> checksum.

// Standalone factory so the handle type can be named without the impl object
// referencing its own type (which TS rejects as a circular initializer).
function makeMdArray() {
    return allocate(ArrayOf(Particle, COUNT));
}
type MdArr = ReturnType<typeof makeMdArray>;

// md-wrapper — idiomatic metis-data, wrapper object per field access.
const mdWrapper = {
    build(): MdArr {
        const arr = makeMdArray();
        for (let i = 0; i < COUNT; i++) {
            const p = arr.at(i);
            const s = inits[i]!;
            p.set({ position: s.pos, velocity: s.vel, color: s.color, mass: s.mass, age: s.age });
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
        }
    },
    reduce(arr: MdArr): number {
        let cx = 0, cy = 0, cz = 0;
        for (let i = 0; i < COUNT; i++) {
            const [px, py, pz] = arr.at(i).get("position").get();
            cx += px; cy += py; cz += pz;
        }
        return cx + cy + cz;
    },
};

// md-view — metis-data storage, one long-lived flat view, hand-indexed.
const mdView = {
    build() {
        const arr = allocate(ArrayOf(Particle, COUNT));
        // ArrayOf(<struct>).view() is a Uint8Array (raw struct bytes); for
        // hand-indexed float access take a Float32Array over the same region.
        const v = new Float32Array(arr.buffer, arr.offset, COUNT * STRIDE_F32);
        for (let i = 0; i < COUNT; i++) {
            const b = i * STRIDE_F32;
            const s = inits[i]!;
            v[b + OFF.px] = s.pos[0]; v[b + OFF.px + 1] = s.pos[1]; v[b + OFF.px + 2] = s.pos[2];
            v[b + OFF.vx] = s.vel[0]; v[b + OFF.vx + 1] = s.vel[1]; v[b + OFF.vx + 2] = s.vel[2];
            v[b + OFF.r] = s.color[0]; v[b + OFF.r + 1] = s.color[1]; v[b + OFF.r + 2] = s.color[2]; v[b + OFF.r + 3] = s.color[3];
            v[b + OFF.mass] = s.mass; v[b + OFF.age] = s.age;
        }
        return v;
    },
    integrate(v: Float32Array) {
        for (let i = 0; i < COUNT; i++) {
            const b = i * STRIDE_F32;
            v[b + OFF.px] = v[b + OFF.px]! + v[b + OFF.vx]! * DT;
            v[b + OFF.px + 1] = v[b + OFF.px + 1]! + v[b + OFF.vx + 1]! * DT;
            v[b + OFF.px + 2] = v[b + OFF.px + 2]! + v[b + OFF.vx + 2]! * DT;
            v[b + OFF.age] = v[b + OFF.age]! + DT;
        }
    },
    reduce(v: Float32Array): number {
        let cx = 0, cy = 0, cz = 0;
        for (let i = 0; i < COUNT; i++) {
            const b = i * STRIDE_F32;
            cx += v[b + OFF.px]!; cy += v[b + OFF.px + 1]!; cz += v[b + OFF.px + 2]!;
        }
        return cx + cy + cz;
    },
};

// flat — a plain Float32Array with the identical AoS layout. The floor.
const flat = {
    build() {
        const v = new Float32Array(COUNT * STRIDE_F32);
        for (let i = 0; i < COUNT; i++) {
            const b = i * STRIDE_F32;
            const s = inits[i]!;
            v[b + OFF.px] = s.pos[0]; v[b + OFF.px + 1] = s.pos[1]; v[b + OFF.px + 2] = s.pos[2];
            v[b + OFF.vx] = s.vel[0]; v[b + OFF.vx + 1] = s.vel[1]; v[b + OFF.vx + 2] = s.vel[2];
            v[b + OFF.r] = s.color[0]; v[b + OFF.r + 1] = s.color[1]; v[b + OFF.r + 2] = s.color[2]; v[b + OFF.r + 3] = s.color[3];
            v[b + OFF.mass] = s.mass; v[b + OFF.age] = s.age;
        }
        return v;
    },
    integrate: (v: Float32Array) => mdView.integrate(v),
    reduce: (v: Float32Array) => mdView.reduce(v),
};

// objects — array of plain JS objects. The ergonomic baseline.
interface ObjParticle {
    px: number; py: number; pz: number;
    vx: number; vy: number; vz: number;
    r: number; g: number; b: number; a: number;
    mass: number; age: number;
}
const objects = {
    build(): ObjParticle[] {
        const out: ObjParticle[] = new Array(COUNT);
        for (let i = 0; i < COUNT; i++) {
            const s = inits[i]!;
            out[i] = {
                px: s.pos[0], py: s.pos[1], pz: s.pos[2],
                vx: s.vel[0], vy: s.vel[1], vz: s.vel[2],
                r: s.color[0], g: s.color[1], b: s.color[2], a: s.color[3],
                mass: s.mass, age: s.age,
            };
        }
        return out;
    },
    integrate(o: ObjParticle[]) {
        for (let i = 0; i < COUNT; i++) {
            const p = o[i]!;
            p.px += p.vx * DT; p.py += p.vy * DT; p.pz += p.vz * DT;
            p.age += DT;
        }
    },
    reduce(o: ObjParticle[]): number {
        let cx = 0, cy = 0, cz = 0;
        for (let i = 0; i < COUNT; i++) {
            const p = o[i]!;
            cx += p.px; cy += p.py; cz += p.pz;
        }
        return cx + cy + cz;
    },
};

const IMPLS = [
    { name: "md-wrapper", impl: mdWrapper },
    { name: "md-view", impl: mdView },
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

// Storage footprint. All three buffer-backed impls ARE the packed ArrayBuffer —
// byte-for-byte a hand-packed Float32Array — so their footprint is exact and
// equal. md-wrapper's per-access wrapper churn is a CPU/GC cost (it shows up in
// throughput), not a retained-memory cost, so it does not inflate this number.
// Only the plain-object array must actually be measured, via a GC-settled heap
// delta with the array held live across the second collection.
const EXACT_BYTES = COUNT * Particle.byteSize;
let heldObjects: unknown = null;
// JSC's `heapUsed` does NOT account for object/ArrayBuffer storage (it reads 0
// for both), so the retained cost of the plain-object array is measured via the
// process RSS delta across a GC-settled build — a coarse but honest signal (a
// 100k-object array moves RSS by ~15 MiB). Averaged over a few builds to damp
// the page-granularity noise.
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
    return Math.max(0, samples[Math.floor(samples.length / 2)]!); // median
}
const bytesFor: Record<string, number> = {
    "md-wrapper": EXACT_BYTES,
    "md-view": EXACT_BYTES,
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
void heldObjects; // keep the measured object array rooted to end-of-run

// ── Report ────────────────────────────────────────────────────────────────────
if (JSON_ONLY) {
    console.log(JSON.stringify({ count: COUNT, iters: ITERS, stride: Particle.byteSize, rows }, null, 2));
} else {
    const mel = (ms: number) => (COUNT / ms / 1000).toFixed(1); // million elements / sec
    const bpe = (bytes: number) => (bytes / COUNT).toFixed(1);
    const pad = (s: string, n: number) => s.padEnd(n);
    const padL = (s: string, n: number) => s.padStart(n);

    console.log("═".repeat(78));
    console.log("  metis-data — memory-buffer benchmark");
    console.log("═".repeat(78));
    console.log(`    Particles ......... ${COUNT.toLocaleString()}`);
    console.log(`    Component ......... ${Particle.byteSize} B/entity (${STRIDE_F32} f32, Dense) — ${(COUNT * Particle.byteSize / 1048576).toFixed(1)} MiB packed`);
    console.log(`    Timed reps ........ integrate/reduce ${ITERS}, build ${BUILD_ITERS} (+${WARMUP} warmup)`);
    console.log(`    Runtime ........... Bun ${Bun.version}`);
    console.log("─".repeat(78));

    // Checksums must all agree (identical inputs + math) — a correctness guard.
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

    // Relative call-outs against the flat-array floor.
    const flatRow = rows.find((r) => r.name === "flat")!;
    const wrapRow = rows.find((r) => r.name === "md-wrapper")!;
    const objRow = rows.find((r) => r.name === "objects")!;
    const rel = (a: number, b: number) => {
        const r = a / b;
        return r >= 1 ? `${r.toFixed(1)}x slower` : `${(b / a).toFixed(1)}x faster`;
    };
    console.log("    vs flat Float32Array (the floor):");
    console.log(`      md-wrapper integrate .. ${rel(wrapRow.integrate.median, flatRow.integrate.median)}  (same ${bpe(EXACT_BYTES)} B/ent footprint — the cost is CPU/GC churn, not memory)`);
    console.log(`      objects    integrate .. ${rel(objRow.integrate.median, flatRow.integrate.median)}, ${(objRow.bytes / EXACT_BYTES).toFixed(1)}x memory (${bpe(objRow.bytes)} vs ${bpe(EXACT_BYTES)} B/ent)`);
    console.log(`    md-view vs flat ......... ${rel(rows.find((r) => r.name === "md-view")!.integrate.median, flatRow.integrate.median)} (expected ~tie — identical bytes & access; any gap is noise)`);
    console.log("═".repeat(78));
}
