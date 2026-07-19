// Headless validation for the GPU profiler + debug widgets.
//
// Both fail *silently* in ways a screenshot wouldn't catch: a mis-wired query
// index reads back zeros, and a widget with a bad layout still "renders fine"
// (just empty). So this asserts on the numbers — non-zero per-pass timings that
// sum sanely — and only then draws the widgets and screenshots them.
import { GPUTextureUsage } from "bun-webgpu-rs";
import { takeScreenshot } from "bun-webgpu-rs/tests/helpers/screenshot.ts";
import {
    ClusteredForwardRenderer,
    createDefaultPostProcessPipeline,
    createExteriorEnvironment,
    cube,
    DebugOverlay,
    GpuProfiler,
    History,
    Material,
    Mesh,
    plane,
    profileSpansToRows,
    RenderContext,
    Scene,
} from "metis-engine/renderer";
import { vec3 } from "wgpu-matrix";

const W = 900;
const H = 620;
const FONT_PATH = new URL("../../../assets/JetBrainsMono-Regular.ttf", import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/,
    "$1",
);
// Readback lags by a few frames by design (RING_SIZE), so run enough frames for
// at least one to land.
const FRAMES = 12;

async function main() {
    const ctx = await RenderContext.createOffscreen({width: W, height: H, label: "debug-widgets-smoke", profiling: true});

    const profiler = GpuProfiler.create(ctx.device);
    if (!profiler) {
        console.log("SKIP: adapter has no timestamp-query support — nothing to validate");
        ctx.destroy();
        return;
    }
    console.log(
        `profiler tiers — draw zones: ${profiler.canProfileDraws}, measured frame total: ${profiler.canProfileFrameTotal}`,
    );

    const forward = new ClusteredForwardRenderer(ctx.device);
    forward.profiler = profiler;
    const post = createDefaultPostProcessPipeline(ctx.device);
    const debug = new DebugOverlay(ctx.device, ctx.outputFormat);
    debug.loadFont("mono", FONT_PATH);
    // The overlay's own draw pass should appear in the tree it renders.
    debug.profiler = profiler;

    const scene = new Scene();
    scene.environment = createExteriorEnvironment();
    scene.camera.position = vec3.create(0, 1.6, 4.5);
    scene.camera.target = vec3.create(0, 0.3, 0);
    scene.camera.setAspectFromSize(W, H);
    scene.add(new Mesh(ctx.device, plane(20, 20), "floor"), new Material({baseColor: [0.5, 0.5, 0.55, 1]}));
    scene.add(new Mesh(ctx.device, cube(1, 1, 1), "crate"), new Material({baseColor: [0.8, 0.3, 0.2, 1], roughness: 0.6}));

    const gpuHistory = new History(120);

    // Validation errors only reach stderr in this binding, so a broken profiler
    // could "pass" with zeros. Scope the whole run.
    ctx.device.pushErrorScope("validation");

    let frame = ctx.beginFrame();
    for (let i = 0; i < FRAMES; i++) {
        frame = ctx.beginFrame();
        const encoder = ctx.device.createCommandEncoder();
        profiler.beginFrame(encoder);
        forward.render(encoder, ctx.targets, scene);
        post.pipeline.run(encoder, {
            device: ctx.device,
            hdrColorView: ctx.targets.hdrColorResolvedView,
            depthView: ctx.targets.depthView,
            outputView: frame.view,
            outputFormat: frame.format,
            width: W,
            height: H,
            deltaTime: 1 / 60,
            profiler,
        });
        gpuHistory.push(profiler.frameTotalMs);

        {
            // Staged every frame, not just the last: the profiler's readback lags
            // by a few frames, so a span that only exists on the final frame may
            // never appear in the results that get asserted below.
            debug.graph({
                x: W - 320,
                y: 12,
                width: 308,
                height: 96,
                title: "frame time",
                unit: "ms",
                series: [{label: "gpu", values: gpuHistory}],
            });
            debug.tree({
                x: W - 320,
                y: 118,
                width: 308,
                title: `GPU passes — ${profiler.frameTotalMs.toFixed(3)} ms`,
                rows: profileSpansToRows(profiler.spans, profiler.frameTotalMs),
            });
            debug.label("metis-engine // profiler smoke", 16, 28);
            debug.render(encoder, frame.view, W, H);
        }

        profiler.endFrame(encoder);
        ctx.device.queue.submit([encoder.finish()]);
        frame.present();
        // Yields to the event loop, letting the pending mapAsync settle.
        await ctx.device.queue.onSubmittedWorkDone();
    }

    const err = await ctx.device.popErrorScope();
    if (err) {
        throw new Error(`WebGPU validation error — profiler results would be meaningless:\n  ${err.message}`);
    }

    // ── Assert the timings are real ──────────────────────────────────────────
    const spans = profiler.spans;
    if (spans.length === 0) {
        throw new Error("profiler produced no spans after ${FRAMES} frames — readback never landed");
    }

    const flat: Array<{label: string; gpuMs: number; depth: number}> = [];
    const walk = (list: typeof spans, depth: number) => {
        for (const s of list) {
            flat.push({label: s.label, gpuMs: s.gpuMs, depth});
            walk(s.children, depth + 1);
        }
    };
    walk(spans, 0);

    console.log("\n  GPU pass timings (last completed frame):");
    for (const s of flat) {
        console.log(`    ${"  ".repeat(s.depth)}${s.label.padEnd(28 - s.depth * 2)} ${s.gpuMs.toFixed(4)} ms`);
    }

    const timed = flat.filter((s) => s.gpuMs > 0);
    if (timed.length === 0) {
        throw new Error(
            `all ${flat.length} spans read back as 0 ms — timestamps are being resolved but not written ` +
                "(check query indices / resolveQuerySet range)",
        );
    }
    const total = profiler.frameTotalMs;
    if (!(total > 0) || !Number.isFinite(total)) {
        throw new Error(`frame total is ${total} — expected a positive finite duration`);
    }
    if (total > 1000) {
        throw new Error(`frame total ${total} ms is implausible — timestamp period is probably misapplied`);
    }

    // The pass names the renderer hands the profiler must actually show up;
    // a silent rename would otherwise leave the tree quietly incomplete.
    for (const want of ["forward", "cluster-build", "light-cull", "tonemap", "debug-overlay"]) {
        if (!flat.some((s) => s.label === want)) {
            throw new Error(`expected a "${want}" span in the profile tree, got: ${flat.map((s) => s.label).join(", ")}`);
        }
    }
    if (profiler.canProfileDraws) {
        const zones = flat.filter((s) => s.depth > 1);
        if (zones.length === 0) {
            throw new Error("timestamp-query-inside-passes is enabled but no per-draw zones were recorded");
        }
        console.log(`\n  per-draw zones: ${zones.length} (${zones.map((z) => z.label).join(", ")})`);
    }

    const pixels = await takeScreenshot(ctx.device, ctx.captureTexture!, W, H, "test/output/debug-widgets.png");
    let lit = 0;
    for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i]! > 5 || pixels[i + 1]! > 5 || pixels[i + 2]! > 5) {
            lit++;
        }
    }
    console.log(`\n  debug-widgets.png written; ${timed.length}/${flat.length} spans timed, ${lit} lit pixels`);

    debug.destroy();
    profiler.destroy();
    forward.destroy();
    post.pipeline.destroy();
    ctx.destroy();
}

await main();
