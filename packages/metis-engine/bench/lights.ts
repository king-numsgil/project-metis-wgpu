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
//   bun run bench/lights.ts --vsync            # cap at refresh ("what it looks like live")
//
// Presents WITHOUT vsync by default (presentMode "immediate"), because the vsync
// wait lands in getCurrentTexture()/work-done and pins every timer to the refresh
// interval. Each frame is split into three measurements so nothing is misleading:
// the swapchain acquire wait (present/compositor back-pressure, not engine cost),
// the CPU encode, and the GPU execution (submit -> onSubmittedWorkDone). "GPU
// frame time" is the real perf metric. Under --vsync the GPU number is unreliable
// for that same reason, and the summary says so.
import { SdlEventType, SdlKeycode, sdlPollEvents } from "bun-webgpu-rs";
import {
    CLUSTER_COUNT_X,
    CLUSTER_COUNT_Y,
    CLUSTER_COUNT_Z,
    ClusteredForwardRenderer,
    createDefaultPostProcessPipeline,
    createExteriorEnvironment,
    type FrameTarget,
    Material,
    MAX_LIGHTS_PER_CLUSTER,
    MAX_POINT_LIGHTS,
    Mesh,
    mulberry32,
    NUM_CLUSTERS,
    plane,
    type PointLight,
    RenderContext,
    Scene,
    VectorText,
} from "metis-engine/renderer";
import { scheduler } from "node:timers/promises";
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
const LIGHT_COUNT = Math.min(num("lights", 100), MAX_POINT_LIGHTS);
const DURATION_S = num("duration", 5);
const WARMUP_S = num("warmup", 0.75); // let auto-exposure settle before collecting stats
// Default to no vsync so the frame-time numbers are real. With vsync the present
// wait lands in getCurrentTexture()/work-done and pins every measurement to the
// refresh interval (~16.6ms), telling you nothing about actual GPU cost.
const VSYNC = flag("vsync");

// The plane the lights hover over, and the volume the lights animate within.
const PLANE_SIZE = 60;
const FIELD_HALF = 24; // lights spread over [-24, 24] in x/z

// ── Animated point-light field ───────────────────────────────────────────────
interface AnimatedLight {
    cx: number;
    cz: number;
    orbitRadius: number;
    orbitSpeed: number;
    phase: number;
    baseY: number;
    bobAmp: number;
    bobSpeed: number;
    light: PointLight;
}

/** Deterministically scatters `count` lights across the field with per-light orbit + bob animation params. */
function buildLightField(count: number): AnimatedLight[] {
    const rand = mulberry32(0x1234_abcd);
    const lights: AnimatedLight[] = [];
    for (let i = 0; i < count; i++) {
        // Warm/cool alternating palette so the field reads as distinct lights.
        const hueWarm = i % 2 === 0;
        const color: [number, number, number] = hueWarm
            ? [1.0, 0.55 + 0.35 * rand(), 0.35 + 0.2 * rand()]
            : [0.35 + 0.2 * rand(), 0.6 + 0.3 * rand(), 1.0];
        lights.push({
            cx: (rand() * 2 - 1) * FIELD_HALF,
            cz: (rand() * 2 - 1) * FIELD_HALF,
            orbitRadius: 1.5 + rand() * 4,
            orbitSpeed: (rand() * 2 - 1) * 1.6,
            phase: rand() * Math.PI * 2,
            baseY: 0.8 + rand() * 2.8,
            bobAmp: 0.3 + rand() * 1.0,
            bobSpeed: 0.5 + rand() * 2.0,
            light: {
                position: vec3.create(0, 0, 0),
                color,
                intensity: 6 + rand() * 8,
                range: 5 + rand() * 4,
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
    presentMode: VSYNC ? "fifo" : "immediate",
    label: "metis-engine-bench-lights",
});
const forward = new ClusteredForwardRenderer(ctx.device);
const post = createDefaultPostProcessPipeline(ctx.device);
const hud = new VectorText(ctx.device, ctx.outputFormat);
hud.loadFont("mono", FONT_PATH);

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
scene.pointLights = activeLights.map((a) => a.light);

const triangles = floorMesh.indexCount / 3;

/**
 * Records + submits one frame. `hudLine` is drawn as an overlay. Returns the
 * acquired frame (call `present()` after draining) plus a timing split:
 *   * acquireMs — `beginFrame()`, i.e. waiting for a free swapchain image. This
 *                 is windowing/present back-pressure, NOT engine cost.
 *   * encodeMs  — the real JS work: animate is already done, this is the encode
 *                 of every pass + submit.
 */
function renderFrame(dt: number, hudLine: string): { frame: FrameTarget; acquireMs: number; encodeMs: number } {
    const t0 = performance.now();
    const frame = ctx.beginFrame();
    const t1 = performance.now();
    const encoder = ctx.device.createCommandEncoder();
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
    });
    hud.drawText(hudLine, "mono", 18, 14, 26);
    hud.render(encoder, frame.view, ctx.width, ctx.height, [0.85, 0.95, 1.0, 1.0]);
    ctx.device.queue.submit([encoder.finish()]);
    const t2 = performance.now();
    return {frame, acquireMs: t1 - t0, encodeMs: t2 - t1};
}

// ── Validation guard ─────────────────────────────────────────────────────────
// bun-webgpu-rs swallows WebGPU validation errors (they only hit stderr), so a
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
console.log(`    Resolution ............ ${ctx.width} x ${ctx.height}  (4x MSAA, ${VSYNC ? "vsync present" : "no vsync / immediate"})`);
console.log(`    Point lights .......... ${LIGHT_COUNT}`);
console.log(`    Cluster grid .......... ${CLUSTER_COUNT_X} x ${CLUSTER_COUNT_Y} x ${CLUSTER_COUNT_Z} = ${NUM_CLUSTERS} clusters`);
console.log(`    Max lights / cluster .. ${MAX_LIGHTS_PER_CLUSTER}   (capacity cap)`);
console.log(`    Max lights / scene .... ${MAX_POINT_LIGHTS}`);
console.log(`    Forward draw calls .... 1   (${triangles} triangles — a single plane)`);
console.log(`    Per frame ............. shadow + cluster-build + light-cull + forward + HDR post`);
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

    await scheduler.yield();
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
    console.log(`\n  ${VSYNC ? "On-screen frame rate  (vsync-limited — what you saw)" : "Achieved frame rate  (no vsync — full real-time frame incl. present)"}`);
    console.log(`    ${observedFps.toFixed(1)} fps   (${ms(1000 / observedFps)}/frame avg interval)`);
    console.log(`\n  GPU frame time  (submit -> work-done, the GPU execution cost — the real perf metric)`);
    if (VSYNC) {
        console.log(`    (unreliable under --vsync: present back-pressure bleeds into the work-done`);
        console.log(`     wait — re-run without --vsync for the true GPU cost)`);
    }
    console.log(`    mean ....... ${ms(gpu.mean)}   ->  headroom for ${(1000 / gpu.mean).toFixed(0)} fps`);
    console.log(`    median ..... ${ms(gpu.median)}`);
    console.log(`    min / max .. ${ms(gpu.min)}  /  ${ms(gpu.max)}`);
    console.log(`    p95 / p99 .. ${ms(gpu.p95)}  /  ${ms(gpu.p99)}`);
    console.log(`    stddev ..... ${ms(gpu.stddev)}`);
    console.log(`\n  CPU encode time  (JS: encode every pass + submit, per frame)`);
    console.log(`    mean ....... ${ms(encode.mean)}   (p95 ${ms(encode.p95)})`);
    console.log(`\n  Swapchain acquire wait  (beginFrame back-pressure — present/compositor, not engine)`);
    console.log(`    mean ....... ${ms(acquire.mean)}   (p95 ${ms(acquire.p95)})`);
    if (!VSYNC && acquire.mean > gpu.mean) {
        console.log(`    -> the frame rate above is gated by present back-pressure, not GPU work;`);
        console.log(`       GPU headroom is ~${(1000 / gpu.mean).toFixed(0)} fps.`);
    }
}
console.log("═".repeat(72));

forward.destroy();
post.pipeline.destroy();
hud.destroy();
ctx.destroy();
