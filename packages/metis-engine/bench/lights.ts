// Windowed real-time benchmark for the clustered-forward renderer: a flat
// plane lit by N animated point lights (default 100), rendered through the full
// per-frame pipeline — shadow pass, cluster build + light cull (compute),
// forward shading, and the HDR post chain (luminance -> exposure -> ACES) — in
// a live SDL window for a fixed duration (default 5s). A HUD overlays live
// stats; a summary prints when it exits.
//
//   bun run bench/lights.ts                    # 100 lights, 1280x720, 5s
//   bun run bench/lights.ts --lights 200       # stress the per-cluster cap
//   bun run bench/lights.ts --duration 10      # run longer
//   bun run bench/lights.ts --width 1920 --height 1080
//   bun run bench/lights.ts --fps 60           # cap at 60 fps ("what it looks like live")
//   bun run bench/lights.ts --profile            # per-pass GPU timings via timestamp queries
//   bun run bench/lights.ts --no-prepass         # disable the depth prepass (on by default)
//
// Uses `immediate` present mode — tearing is irrelevant to a benchmark, and it
// removes the present back-pressure that otherwise parks inside
// getCurrentTexture() and inflates the acquire number. The loop runs uncapped so
// the per-frame timers reflect real work rather than the refresh interval. Each
// frame is split into three measurements so nothing is misleading: the swapchain
// acquire wait (present/compositor back-pressure, not engine cost), the CPU
// encode, and the GPU execution (submit -> onSubmittedWorkDone). "GPU frame time"
// is the real perf metric. Pass --fps N (or --vsync for 60) to cap the frame rate
// via the engine FrameLimiter; the cap is applied AFTER the GPU measurement each
// frame, so it only moves the achieved-frame-rate line, never the GPU number.
import { SdlEventType, SdlKeycode, sdlPollEvents } from "metis-native";
import {
    CLUSTER_COUNT_X,
    CLUSTER_COUNT_Y,
    CLUSTER_COUNT_Z,
    ClusteredForwardRenderer,
    createDefaultPostProcessPipeline,
    createExteriorEnvironment,
    DebugOverlay,
    FrameLimiter,
    type FrameTarget,
    GpuProfiler,
    History,
    Material,
    MAX_LIGHTS_PER_CLUSTER,
    MAX_LIGHTS,
    MAX_SHADOW_SPOTS,
    Mesh,
    mulberry32,
    NUM_CLUSTERS,
    plane,
    type Light,
    type ProfileSpan,
    profileSpansToRows,
    RenderContext,
    Scene,
} from "metis-engine/renderer";
import { vec3 } from "wgpu-matrix";

const FONT_PATH = new URL("../../../assets/JetBrainsMono-Regular.ttf", import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/,
    "$1",
);

// ── CLI args ────────────────────────────────────────────────────────────────
function parseArgs(argv: string[]) {
    const opts: Record<string, string | boolean> = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]!;
        if (!a.startsWith("--")) {
            continue;
        }
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith("--")) {
            opts[key] = true;
        } else {
            opts[key] = next;
            i++;
        }
    }
    return opts;
}

const args = parseArgs(Bun.argv.slice(2));
const num = (k: string, d: number) => (args[k] !== undefined ? Number(args[k]) : d);
const flag = (k: string) => args[k] === true || args[k] === "true";

const WIDTH = num("width", 1280);
const HEIGHT = num("height", 720);
const LIGHT_COUNT = Math.min(num("lights", 100), MAX_LIGHTS);
const DURATION_S = num("duration", 5);
const WARMUP_S = num("warmup", 0.75); // let auto-exposure settle before collecting stats
// Frame-rate cap (0 = uncapped, the default, so timings reflect real work).
// --fps N sets it; --vsync is back-compat for 60. The FrameLimiter applies the
// cap AFTER the GPU measurement each frame, so — unlike native fifo, which parks
// the wait inside getCurrentTexture() — it never pollutes the GPU/encode numbers.
const CAP_FPS = num("fps", flag("vsync") ? 60 : 0);
// --profile turns on timestamp queries + the on-screen widgets. Off by default:
// the queries are cheap but not free, and the point of the bench is the
// unprofiled cost.
const PROFILE = flag("profile");
// Depth prepass — ON by default, matching the engine. This scene is a single
// plane (zero overdraw), so it's the *weakest* case for a prepass; the win here
// is the forward pass no longer writing 4x-MSAA depth, not early-Z. Pass
// --no-prepass to A/B it.
const PREPASS = !flag("no-prepass");
// Fraction of the field that is spot lights rather than point lights (0..1).
// Default 0.5 — half and half. **`--spots 0` reproduces the original all-point
// field exactly**, because buildLightField draws every random parameter
// unconditionally and only *uses* the spot ones when a light is a spot; the
// rand() sequence therefore doesn't depend on this fraction. That is what makes
// `--spots 0` a valid A/B baseline rather than merely a similar scene.
const SPOT_FRACTION = Math.min(Math.max(num("spots", 0.5), 0), 1);
// How many of the spot lights cast shadows (0..MAX_SHADOW_SPOTS). Each costs
// one extra depth pass over whatever geometry survives its frustum cull.
// `--shadow-spots 0` removes the cost entirely (the passes still run, but only
// to clear their layer).
//
// NB this bench is a *single large plane*, which is the worst possible case for
// the frustum culling that makes spot shadows affordable: one instance, always
// intersecting every cone. The numbers here therefore measure pass and
// rasterization overhead only, and say nothing about how well culling performs
// on a real interior. See CLAUDE.md "Spot light shadows".
const SHADOW_SPOTS = Math.min(Math.max(Math.round(num("shadow-spots", MAX_SHADOW_SPOTS)), 0), MAX_SHADOW_SPOTS);

// The plane the lights hover over, and the volume the lights animate within.
const PLANE_SIZE = 60;
const FIELD_HALF = 24; // lights spread over [-24, 24] in x/z

// ── Animated light field (point + spot) ─────────────────────────────────────
interface AnimatedLight {
    cx: number;
    cz: number;
    orbitRadius: number;
    orbitSpeed: number;
    phase: number;
    baseY: number;
    bobAmp: number;
    bobSpeed: number;
    /** Spot only: tilt of the cone axis away from straight-down, radians. */
    coneTilt: number;
    /** Spot only: how fast the tilted axis sweeps around Y, radians/sec (signed). */
    spinSpeed: number;
    /** Spot only: starting sweep angle, radians. */
    spinPhase: number;
    light: Light;
}

/**
 * Deterministically scatters `count` lights across the field with per-light
 * orbit + bob animation params, the first `SPOT_FRACTION` of them as spot
 * lights that sweep like searchlights.
 *
 * Every random draw below is unconditional — including the spot-only ones for a
 * light that ends up a point — so the sequence, and therefore every light's
 * position and orbit, is identical at any `SPOT_FRACTION`. Only the light kind
 * changes. Drawing them inside an `if` would silently make `--spots 0` a
 * different scene from the pre-spot bench and quietly invalidate the baseline.
 */
function buildLightField(count: number): AnimatedLight[] {
    const rand = mulberry32(0x1234_abcd);
    // Cone parameters come from their OWN stream, so they consume nothing from
    // `rand`. Appending draws to the main stream instead would shift every
    // subsequent light's position and quietly make `--spots 0` a different scene
    // from the pre-spot bench — the baseline would look valid and be worthless.
    const spotRand = mulberry32(0x5eed_c0de);
    const spotCount = Math.round(count * SPOT_FRACTION);
    const lights: AnimatedLight[] = [];
    for (let i = 0; i < count; i++) {
        // Warm/cool alternating palette so the field reads as distinct lights.
        const hueWarm = i % 2 === 0;
        const color: [number, number, number] = hueWarm
            ? [1.0, 0.55 + 0.35 * rand(), 0.35 + 0.2 * rand()]
            : [0.35 + 0.2 * rand(), 0.6 + 0.3 * rand(), 1.0];
        // Drawn for every light, spot or not, so the spot stream stays in step
        // with the light index regardless of SPOT_FRACTION.
        const coneTilt = (10 + spotRand() * 45) * (Math.PI / 180);
        const spinSpeed = (spotRand() * 2 - 1) * 2.2;
        const spinPhase = spotRand() * Math.PI * 2;
        const outerAngle = (12 + spotRand() * 25) * (Math.PI / 180);
        // Inner edge somewhere inside the outer one, so the field carries a mix
        // of sharp and soft cones.
        const innerAngle = outerAngle * (0.2 + spotRand() * 0.7);
        const isSpot = i < spotCount;
        const cx = (rand() * 2 - 1) * FIELD_HALF;
        const cz = (rand() * 2 - 1) * FIELD_HALF;
        const orbitRadius = 1.5 + rand() * 4;
        const orbitSpeed = (rand() * 2 - 1) * 1.6;
        const phase = rand() * Math.PI * 2;
        const baseY = 0.8 + rand() * 2.8;
        const bobAmp = 0.3 + rand() * 1.0;
        const bobSpeed = 0.5 + rand() * 2.0;
        // Order matters: these two are drawn here, after the orbit params,
        // exactly where the original all-point field drew them.
        const intensity = 6 + rand() * 8;
        const range = 5 + rand() * 4;
        lights.push({
            cx,
            cz,
            orbitRadius,
            orbitSpeed,
            phase,
            baseY,
            bobAmp,
            bobSpeed,
            coneTilt,
            spinSpeed,
            spinPhase,
            light: isSpot
                ? {
                      kind: "spot",
                      position: vec3.create(0, 0, 0),
                      // Overwritten every frame by animateLights; a placeholder
                      // rather than a meaningful value.
                      direction: vec3.create(0, -1, 0),
                      color,
                      // Brighter than the point lights: a cone concentrates the
                      // same nominal intensity into a much smaller footprint, so
                      // matching numbers would make the spots read as near-black
                      // against them.
                      intensity: intensity * 3,
                      range,
                      innerAngle: innerAngle,
                      outerAngle: outerAngle,
                      // The first SHADOW_SPOTS spots in the field cast.
                      castsShadow: i < SHADOW_SPOTS,
                  }
                : {
                      kind: "point",
                      position: vec3.create(0, 0, 0),
                      color,
                      intensity,
                      range,
                  },
        });
    }
    return lights;
}

function animateLights(lights: AnimatedLight[], t: number) {
    for (const a of lights) {
        const angle = a.phase + a.orbitSpeed * t;
        const x = a.cx + Math.cos(angle) * a.orbitRadius;
        const z = a.cz + Math.sin(angle) * a.orbitRadius;
        const y = a.baseY + Math.sin(t * a.bobSpeed + a.phase) * a.bobAmp;
        a.light.position = vec3.set(x, y, z, a.light.position as Float32Array);

        if (a.light.kind === "spot") {
            // Searchlight sweep: an axis held `coneTilt` off straight-down,
            // rotating around Y at this light's own speed. Writing a unit vector
            // here is not required (LightCuller normalizes on upload) but keeps
            // the animation readable.
            const sweep = a.spinPhase + a.spinSpeed * t;
            const s = Math.sin(a.coneTilt);
            a.light.direction = vec3.set(
                s * Math.cos(sweep),
                -Math.cos(a.coneTilt),
                s * Math.sin(sweep),
                a.light.direction as Float32Array,
            );
        }
    }
}

// ── Stats helpers ─────────────────────────────────────────────────────────────
function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) {
        return NaN;
    }
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[idx]!;
}

function summarize(samples: number[]) {
    const sorted = [...samples].sort((a, b) => a - b);
    const n = sorted.length;
    const sum = sorted.reduce((s, x) => s + x, 0);
    const mean = sum / n;
    const variance = sorted.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
    return {
        n,
        mean,
        min: sorted[0]!,
        max: sorted[n - 1]!,
        median: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        stddev: Math.sqrt(variance),
    };
}

const ms = (x: number) => `${x.toFixed(3)} ms`;

// ── Setup ──────────────────────────────────────────────────────────────────────
const ctx = await RenderContext.createWindowed(`metis-engine — light bench (${LIGHT_COUNT} lights)`, {
    width: WIDTH,
    height: HEIGHT,
    powerPreference: "high-performance",
    // `immediate`: no present back-pressure, so the acquire/GPU numbers are the
    // engine's own cost. Pacing is handled by the FrameLimiter below.
    presentMode: "immediate",
    profiling: PROFILE,
    label: "metis-engine-bench-lights",
});
const limiter = new FrameLimiter(CAP_FPS);
const forward = new ClusteredForwardRenderer(ctx.device);
const post = createDefaultPostProcessPipeline(ctx.device);
// DebugOverlay owns a VectorText, so it doubles as the plain HUD text renderer.
const hud = new DebugOverlay(ctx.device, ctx.outputFormat);
hud.loadFont("mono", FONT_PATH);

const profiler = PROFILE ? GpuProfiler.create(ctx.device) : null;
if (PROFILE && !profiler) {
    console.warn("[bench] --profile requested but this adapter has no timestamp-query support; continuing without it");
}
forward.depthPrepass = PREPASS;  // engine default is on; --no-prepass turns it off
if (profiler) {
    forward.profiler = profiler;
    // The HUD draws into the same frame, so it belongs in the same tree.
    hud.profiler = profiler;
}
const gpuHistory = new History(120);

const scene = new Scene();
scene.environment = createExteriorEnvironment({ambientIntensity: 0.02});
scene.camera.position = vec3.create(0, 11, 30);
scene.camera.target = vec3.create(0, 1, 0);
scene.camera.clusterFar = 200; // light-culling range; the projection itself is infinite
scene.camera.setAspectFromSize(ctx.width, ctx.height);

const floorMesh = new Mesh(ctx.device, plane(PLANE_SIZE, PLANE_SIZE), "bench-floor");
const floorMaterial = new Material({baseColor: [0.5, 0.5, 0.52, 1], metallic: 0.0, roughness: 0.85});
scene.add(floorMesh, floorMaterial);

const activeLights = buildLightField(LIGHT_COUNT);
scene.lights = activeLights.map((a) => a.light);

const triangles = floorMesh.indexCount / 3;

/**
 * Records + submits one frame. `hudLine` is drawn as an overlay. Returns the
 * acquired frame (call `present()` after draining) plus a timing split:
 *   * acquireMs — the whole of `beginFrame()`: getCurrentTexture + createView.
 *                 Under `immediate` this should be ~0.05 ms; anything bigger is
 *                 real work hiding inside beginFrame, not present back-pressure.
 *                 It once read ~6 ms because beginFrame re-queried the surface's
 *                 preferred format every frame — a WSI round-trip.
 *   * encodeMs  — the real JS work: animate is already done, this is the encode
 *                 of every pass + submit.
 */
function renderFrame(dt: number, hudLine: string): { frame: FrameTarget; acquireMs: number; encodeMs: number } {
    const t0 = performance.now();
    const frame = ctx.beginFrame();
    const t1 = performance.now();
    const encoder = ctx.device.createCommandEncoder();
    profiler?.beginFrame(encoder);
    forward.render(encoder, ctx.targets, scene);
    post.pipeline.run(encoder, {
        device: ctx.device,
        hdrColorView: ctx.targets.hdrColorResolvedView,
        depthView: ctx.targets.depthView,
        outputView: frame.view,
        outputFormat: frame.format,
        width: ctx.width,
        height: ctx.height,
        deltaTime: dt,
        profiler: profiler ?? undefined,
    });
    if (profiler) {
        gpuHistory.push(profiler.frameTotalMs);
    }
    // Staging tessellates every glyph, which would cost more per frame than the
    // whole GPU frame being measured — rebuild at a readable rate and replay the
    // geometry in between. `hudLine` already only changes ~4x/sec.
    if (hud.due()) {
        hud.label(hudLine, 14, 26, [0.85, 0.95, 1.0, 1.0], 18);
        if (profiler) {
            const x = ctx.width - 320;
            hud.graph({
                x,
                y: 12,
                width: 308,
                height: 96,
                title: "GPU frame time",
                unit: "ms",
                series: [{label: "gpu", values: gpuHistory}],
            });
            hud.tree({
                x,
                y: 118,
                width: 308,
                title: `GPU passes — ${profiler.frameTotalMs.toFixed(3)} ms`,
                rows: profileSpansToRows(profiler.spans, profiler.frameTotalMs),
            });
        }
    }
    hud.render(encoder, frame.view, ctx.width, ctx.height);
    profiler?.endFrame(encoder);
    ctx.device.queue.submit([encoder.finish()]);
    const t2 = performance.now();
    return {frame, acquireMs: t1 - t0, encodeMs: t2 - t1};
}

// ── Validation guard ─────────────────────────────────────────────────────────
// metis-native swallows WebGPU validation errors (they only hit stderr), so a
// broken bench can silently "succeed". Catch it up front. See metis-engine
// CLAUDE.md "Debugging WebGPU validation errors".
ctx.device.pushErrorScope("validation");
animateLights(activeLights, 0);
{
    const r = renderFrame(1 / 60, "warmup");
    await ctx.device.queue.onSubmittedWorkDone();
    r.frame.present();
}
const validationError = await ctx.device.popErrorScope();
if (validationError) {
    console.error(`\n[bench] WebGPU validation error — results would be meaningless:\n  ${validationError.message}\n`);
    ctx.destroy();
    process.exit(1);
}

// ── Report header ─────────────────────────────────────────────────────────────
console.log("═".repeat(72));
console.log("  metis-engine — clustered-forward light benchmark (windowed)");
console.log("═".repeat(72));
console.log(`    Resolution ............ ${ctx.width} x ${ctx.height}  (4x MSAA, immediate, ${CAP_FPS ? `${CAP_FPS} fps cap` : "uncapped"})`);
console.log(`    GPU profiler .......... ${profiler ? `on (draw zones: ${profiler.canProfileDraws})` : "off  (--profile to enable)"}`);
console.log(`    Depth prepass ......... ${PREPASS ? "on" : "off  (--no-prepass given)"}`);
console.log(`    Lights ................ ${LIGHT_COUNT}   (${Math.round(LIGHT_COUNT * SPOT_FRACTION)} spot, ${LIGHT_COUNT - Math.round(LIGHT_COUNT * SPOT_FRACTION)} point — --spots 0..1, ${SHADOW_SPOTS} casting shadows)`);
console.log(`    Cluster grid .......... ${CLUSTER_COUNT_X} x ${CLUSTER_COUNT_Y} x ${CLUSTER_COUNT_Z} = ${NUM_CLUSTERS} clusters`);
console.log(`    Max lights / cluster .. ${MAX_LIGHTS_PER_CLUSTER}   (capacity cap)`);
console.log(`    Max lights / scene .... ${MAX_LIGHTS}`);
console.log(`    Forward draw calls .... 1   (${triangles} triangles — a single plane)`);
console.log(
    `    Per frame ............. shadow + cluster-build + light-cull + ${PREPASS ? "depth-prepass + " : ""}forward + HDR post`,
);
console.log(`    Adapter ............... ${ctx.adapter.info.description || "?"} (${ctx.adapter.info.backendType || "?"}, ${ctx.adapter.info.deviceType || "?"})`);
console.log(`    Duration .............. ${DURATION_S}s  (${WARMUP_S}s warmup, then collecting) — Esc/close to quit early`);
console.log("─".repeat(72));

// ── Real-time loop ────────────────────────────────────────────────────────────
const intervalSamples: number[] = []; // wall time between frame starts (real achieved frame rate)
const encodeSamples: number[] = []; // JS encode + submit cost
const acquireSamples: number[] = []; // swapchain-image acquire wait (present back-pressure)
const gpuSamples: number[] = []; // GPU execution cost

let running = true;
let virtualTime = 0;
const startTime = performance.now();
let lastFrameStart = startTime;
let hudLine = `${LIGHT_COUNT} lights  |  warming up...`;
let lastHudUpdate = 0;
let fpsEma = 60;

while (running) {
    const now = performance.now();
    const interval = now - lastFrameStart;
    lastFrameStart = now;
    const elapsed = now - startTime;
    const dt = Math.min(interval / 1000, 0.1);

    for (const e of sdlPollEvents()) {
        if (e.type === SdlEventType.WindowCloseRequested || e.type === SdlEventType.Quit) {
            running = false;
        }
        if (e.type === SdlEventType.KeyDown && e.keycode === SdlKeycode.Escape) {
            running = false;
        }
    }
    if (elapsed >= DURATION_S * 1000) {
        running = false;
    }

    virtualTime += dt;
    animateLights(activeLights, virtualTime);

    const r = renderFrame(dt, hudLine);
    const afterSubmit = performance.now();
    await ctx.device.queue.onSubmittedWorkDone();
    const gpuMs = performance.now() - afterSubmit;
    r.frame.present();

    // Skip the warmup window (exposure adaptation + shader/pipeline warmup).
    if (elapsed >= WARMUP_S * 1000) {
        intervalSamples.push(interval);
        encodeSamples.push(r.encodeMs);
        acquireSamples.push(r.acquireMs);
        gpuSamples.push(gpuMs);
    }

    // Smooth on-screen fps for the HUD; refresh the text ~4x/sec.
    if (interval > 0) {
        fpsEma = fpsEma * 0.9 + (1000 / interval) * 0.1;
    }
    if (now - lastHudUpdate > 250) {
        hudLine = `${LIGHT_COUNT} lights  |  ${fpsEma.toFixed(0)} fps on-screen  |  GPU ${gpuMs.toFixed(2)} ms  |  ${(DURATION_S - elapsed / 1000).toFixed(1)}s left`;
        lastHudUpdate = now;
    }

    await limiter.wait();
}

// ── Summary ────────────────────────────────────────────────────────────────────
console.log("");
if (gpuSamples.length === 0) {
    console.log("  (ran too briefly to collect samples — try a longer --duration)");
} else {
    const collectedElapsed = intervalSamples.reduce((s, x) => s + x, 0);
    const observedFps = (intervalSamples.length / collectedElapsed) * 1000;
    const gpu = summarize(gpuSamples);
    const encode = summarize(encodeSamples);
    const acquire = summarize(acquireSamples);

    console.log(`  Measured ${gpuSamples.length} frames over ${(collectedElapsed / 1000).toFixed(2)}s`);
    console.log(`\n  ${CAP_FPS ? `Achieved frame rate  (capped at ${CAP_FPS} fps — what you saw)` : "Achieved frame rate  (uncapped — full real-time frame incl. present)"}`);
    console.log(`    ${observedFps.toFixed(1)} fps   (${ms(1000 / observedFps)}/frame avg interval)`);
    console.log(`\n  GPU frame time  (submit -> work-done, the GPU execution cost — the real perf metric)`);
    console.log(`    mean ....... ${ms(gpu.mean)}   ->  headroom for ${(1000 / gpu.mean).toFixed(0)} fps`);
    console.log(`    median ..... ${ms(gpu.median)}`);
    console.log(`    min / max .. ${ms(gpu.min)}  /  ${ms(gpu.max)}`);
    console.log(`    p95 / p99 .. ${ms(gpu.p95)}  /  ${ms(gpu.p99)}`);
    console.log(`    stddev ..... ${ms(gpu.stddev)}`);
    console.log(`\n  CPU encode time  (JS: encode every pass + submit, per frame)`);
    console.log(`    mean ....... ${ms(encode.mean)}   (p95 ${ms(encode.p95)})`);
    console.log(`\n  beginFrame  (getCurrentTexture + createView)`);
    console.log(`    mean ....... ${ms(acquire.mean)}   (p95 ${ms(acquire.p95)})`);
    // Under `immediate` there is no present back-pressure by construction, so a
    // big number here means something expensive is running inside beginFrame —
    // not that the compositor is throttling us. Don't restore a "gated by
    // present back-pressure" conclusion: under this present mode it can only
    // ever be wrong, and it's exactly what disguised the ~6 ms per-frame
    // getPreferredFormat() call that used to live in beginFrame.
    if (acquire.mean > 1.0) {
        console.log(`    -> unexpectedly slow for 'immediate', which has no present back-pressure.`);
        console.log(`       Something costly is running inside beginFrame — go measure it.`);
    }

    if (profiler && profiler.spans.length > 0) {
        console.log(`
  GPU pass breakdown  (timestamp queries, last completed frame)`);
        const printSpan = (span: ProfileSpan, depth: number) => {
            const indent = "    " + "  ".repeat(depth + 1);
            const pct = profiler.frameTotalMs > 0 ? (span.gpuMs / profiler.frameTotalMs) * 100 : 0;
            console.log(`${indent}${span.label.padEnd(30 - depth * 2)} ${ms(span.gpuMs).padStart(10)}  ${pct.toFixed(1).padStart(5)}%`);
            for (const child of span.children) {
                printSpan(child, depth + 1);
            }
        };
        for (const span of profiler.spans) {
            printSpan(span, 0);
        }
        if (!profiler.canProfileFrameTotal) {
            console.log(`    (no timestamp-query-inside-encoders — total is the sum of passes, excluding gaps between them)`);
        }
    }
}
console.log("═".repeat(72));

forward.destroy();
post.pipeline.destroy();
hud.destroy();
profiler?.destroy();
ctx.destroy();
