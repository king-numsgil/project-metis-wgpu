/**
 * napi-overhead.test.ts
 *
 * Measures the cost of crossing the JS→Rust napi-rs boundary for each call
 * in a typical render loop.  Uses SDL3 performance timers (already in the
 * native library) so the probe itself never leaves native code.
 *
 * GPU debug groups are inserted around each render pass so the frame regions
 * are visible in GPU capture tools (RenderDoc / PIX / NVIDIA Nsight).
 *
 * Run:  bun test tests/napi-overhead.test.ts
 */

import { describe, expect, it } from "bun:test";
import {
    createSurface,
    requestAdapterForWindow,
    sdlCreateWindow,
    sdlGetPerformanceCounter,
    sdlGetPerformanceFrequency,
    sdlInit,
    SdlInitFlag,
    sdlPollEvents,
    sdlQuit,
    SdlWindowFlag,
} from "../index.js";

// ── Constants ────────────────────────────────────────────────────────────────

const W = 800;
const H = 600;
const DURATION_MS = 5_000;
const MICROBENCH_N = 100_000;

const SHADER = /* wgsl */ `
struct Out { @builtin(position) pos: vec4<f32> }

@vertex fn vs(@builtin(vertex_index) vi: u32) -> Out {
  var p = array<vec2<f32>, 3>(
    vec2<f32>( 0.0,  0.5),
    vec2<f32>(-0.5, -0.5),
    vec2<f32>( 0.5, -0.5),
  );
  return Out(vec4<f32>(p[vi], 0.0, 1.0));
}

@fragment fn fs() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 0.0, 0.0, 1.0);
}
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

type Stat = { sum: number; count: number; min: number; max: number }

const newStat = (): Stat => ({sum: 0, count: 0, min: Infinity, max: -Infinity});

const sample = (s: Stat, ticks: number) => {
    s.sum += ticks;
    s.count++;
    if (ticks < s.min) {
        s.min = ticks;
    }
    if (ticks > s.max) {
        s.max = ticks;
    }
};

// Convert performance-counter ticks to µs using the frequency recorded once
// at the start of the test.
const toUs = (ticks: number, freq: number) => (ticks / freq) * 1e6;

const avgUs = (s: Stat, freq: number) => toUs(s.sum / s.count, freq);
const minUs = (s: Stat, freq: number) => toUs(s.min, freq);
const maxUs = (s: Stat, freq: number) => toUs(s.max, freq);

// ASCII bar scaled to [0, 20] chars where 100 % == 20 chars.
const bar = (pct: number) => "▓".repeat(Math.max(0, Math.round(pct / 5))).padEnd(20);

// ── Test ─────────────────────────────────────────────────────────────────────

describe("napi-overhead", () => {
    it(
        "profiles per-call napi-rs costs over a 5 s render window",
        async () => {
            // ── 1. Microbenchmark: base napi round-trip cost ───────────────────────
            // Call sdlGetPerformanceCounter() (a near-zero-work Rust function) N times
            // in a tight JS loop.  Total wall time / N ≈ 1 napi round-trip.
            // Note: the timing envelope itself adds 2 extra napi calls per measurement
            // in the render loop below, so reported values include that probe overhead
            // (~2 × nsPerCall).
            const freq = sdlGetPerformanceFrequency();

            const mb0 = sdlGetPerformanceCounter();
            for (let i = 0; i < MICROBENCH_N; i++) {
                sdlGetPerformanceCounter();
            }
            const mb1 = sdlGetPerformanceCounter();

            const nsPerCall = toUs(mb1 - mb0, freq) * 1000 / MICROBENCH_N; // nanoseconds

            // ── 2. SDL + GPU setup ─────────────────────────────────────────────────
            sdlInit(SdlInitFlag.Video | SdlInitFlag.Events);
            const window = sdlCreateWindow("napi-rs overhead profiler", W, H, SdlWindowFlag.Resizable);

            const adapter = await requestAdapterForWindow(window);
            if (!adapter) {
                window.destroy();
                sdlQuit();
                throw new Error("No GPU adapter");
            }

            const device = await adapter.requestDevice({label: "overhead-test"});

            const surface = createSurface(adapter, window);
            const surfaceFmt = surface.getPreferredFormat();
            surface.configure(device, {width: W, height: H, presentMode: "immediate"});

            const shaderModule = device.createShaderModule({code: SHADER});
            const pipeline = device.createRenderPipeline({
                layout: "auto",
                vertex: {module: shaderModule, entryPoint: "vs"},
                fragment: {module: shaderModule, entryPoint: "fs", targets: [{format: surfaceFmt}]},
            });

            // ── 3. Render loop with per-call timing ────────────────────────────────
            const s = {
                frame: newStat(),
                pollEvents: newStat(),
                getTexture: newStat(),
                createView: newStat(),
                createEncoder: newStat(),
                beginPass: newStat(),
                setPipeline: newStat(),
                draw: newStat(),
                insertMarker: newStat(),
                endPass: newStat(),
                finish: newStat(),
                submit: newStat(),
                present: newStat(),
            };

            // t is reused for every timed segment — keep it in hot scope.
            let t: number;
            let frameCount = 0;
            const deadline = Date.now() + DURATION_MS;

            while (Date.now() < deadline) {
                const f0 = sdlGetPerformanceCounter();

                // Event polling
                t = sdlGetPerformanceCounter();
                sdlPollEvents();
                sample(s.pollEvents, sdlGetPerformanceCounter() - t);

                // Acquire swapchain texture
                t = sdlGetPerformanceCounter();
                const frame = surface.getCurrentTexture();
                sample(s.getTexture, sdlGetPerformanceCounter() - t);

                if (frame.suboptimal) {
                    surface.configure(device, {width: W, height: H});
                }

                // Create view
                t = sdlGetPerformanceCounter();
                const view = frame.createView();
                sample(s.createView, sdlGetPerformanceCounter() - t);

                // Create encoder
                t = sdlGetPerformanceCounter();
                const encoder = device.createCommandEncoder({label: "frame"});
                sample(s.createEncoder, sdlGetPerformanceCounter() - t);

                // GPU debug group — marks this frame in RenderDoc/PIX/Nsight
                encoder.pushDebugGroup(`frame-${frameCount}`);

                // Begin render pass
                t = sdlGetPerformanceCounter();
                const pass = encoder.beginRenderPass({
                    colorAttachments: [{
                        view,
                        loadOp: "clear",
                        storeOp: "store",
                        clearValue: {r: 0, g: 0, b: 0, a: 1},
                    }],
                });
                sample(s.beginPass, sdlGetPerformanceCounter() - t);

                // Draw commands
                t = sdlGetPerformanceCounter();
                pass.setPipeline(pipeline);
                sample(s.setPipeline, sdlGetPerformanceCounter() - t);
                t = sdlGetPerformanceCounter();
                pass.draw(3);
                sample(s.draw, sdlGetPerformanceCounter() - t);

                // Debug marker for the draw call (visible in GPU frame captures)
                t = sdlGetPerformanceCounter();
                pass.insertDebugMarker("triangle-draw");
                sample(s.insertMarker, sdlGetPerformanceCounter() - t);

                t = sdlGetPerformanceCounter();
                pass.end();
                sample(s.endPass, sdlGetPerformanceCounter() - t);

                encoder.popDebugGroup();

                // Finish + submit
                t = sdlGetPerformanceCounter();
                const cmd = encoder.finish();
                sample(s.finish, sdlGetPerformanceCounter() - t);
                t = sdlGetPerformanceCounter();
                device.queue.submit([cmd]);
                sample(s.submit, sdlGetPerformanceCounter() - t);

                // Present (includes VSync wait when present mode is AutoVsync)
                t = sdlGetPerformanceCounter();
                frame.present();
                sample(s.present, sdlGetPerformanceCounter() - t);

                sample(s.frame, sdlGetPerformanceCounter() - f0);
                frameCount++;
            }

            // ── 4. Cleanup ─────────────────────────────────────────────────────────
            window.destroy();
            sdlQuit();

            // ── 5. Report ──────────────────────────────────────────────────────────
            const frameAvgUs = avgUs(s.frame, freq);
            const presentAvgUs = avgUs(s.present, freq);
            const nonPresentUs = frameAvgUs - presentAvgUs;

            // Sum of all napi-call averages excluding present (which includes VSync).
            const napiWorkUs = [
                s.pollEvents, s.getTexture, s.createView, s.createEncoder,
                s.beginPass, s.setPipeline, s.draw, s.insertMarker, s.endPass,
                s.finish, s.submit,
            ].reduce((acc, stat) => acc + avgUs(stat, freq), 0);

            const callsPerFrame = 13; // counted above (excl. present)
            const napiFloorUs = callsPerFrame * nsPerCall / 1000;

            const rows: [string, Stat][] = [
                ["sdlPollEvents", s.pollEvents],
                ["getCurrentTexture", s.getTexture],
                ["createView", s.createView],
                ["createCommandEncoder", s.createEncoder],
                ["beginRenderPass", s.beginPass],
                ["setPipeline", s.setPipeline],
                ["draw", s.draw],
                ["insertDebugMarker", s.insertMarker],
                ["pass.end", s.endPass],
                ["encoder.finish", s.finish],
                ["queue.submit", s.submit],
                ["frame.present *", s.present],
            ];

            const W1 = 22;

            const line = "─".repeat(72);
            console.log(`
  ╔══════════════════════════════════════════════════════════════════════╗
  ║           napi-rs overhead report — ${frameCount} frames, ${(DURATION_MS / 1000).toFixed(0)} s${" ".repeat(Math.max(0, 21 - frameCount.toString().length))}║
  ╠══════════════════════════════════════════════════════════════════════╣
  ║  Microbenchmark (${MICROBENCH_N / 1000}k × sdlGetPerformanceCounter):                ║
  ║    base round-trip ≈ ${nsPerCall.toFixed(1).padStart(7)} ns/call                            ║
  ║    frame budget (16.7 ms) can absorb ≈ ${Math.round(16_700_000 / nsPerCall).toLocaleString().padStart(7)} napi calls        ║
  ╠══════════════════════════════════════════════════════════════════════╣
  ║  Frame timing                                                        ║
  ║    avg frame:       ${(frameAvgUs / 1000).toFixed(3).padStart(9)} ms                               ║
  ║    avg present *:   ${(presentAvgUs / 1000).toFixed(3).padStart(9)} ms  (includes VSync wait)        ║
  ║    non-present:     ${nonPresentUs.toFixed(2).padStart(9)} µs                               ║
  ╠══════════════════════════════════════════════════════════════════════╣
  ║  ${"call".padEnd(W1)}  ${"avg µs".padStart(8)}  ${"min µs".padStart(8)}  ${"max µs".padStart(8)}  bar (% frame) ║
  ║  ${line}  ║`);

            for (const [name, stat] of rows) {
                const a = avgUs(stat, freq);
                const pct = a / frameAvgUs * 100;
                console.log(
                    `  ║  ${name.padEnd(W1)}  ${a.toFixed(3).padStart(8)}  ${minUs(stat, freq).toFixed(3).padStart(8)}  ${maxUs(stat, freq).toFixed(3).padStart(8)}  ${bar(pct)} ${pct.toFixed(1).padStart(5)}%  ║`,
                );
            }

            console.log(`  ║  ${line}  ║
  ║  ${"total napi excl. present".padEnd(W1)}  ${napiWorkUs.toFixed(3).padStart(8)} µs  (${(napiWorkUs / nonPresentUs * 100).toFixed(1).padStart(5)}% of non-present)       ║
  ║  napi base-cost floor:  ~${callsPerFrame} calls × ${nsPerCall.toFixed(0)} ns = ${napiFloorUs.toFixed(2).padStart(7)} µs              ║
  ║  actual work overhead:  ${(napiWorkUs - napiFloorUs).toFixed(2).padStart(9)} µs  (call bodies excl. napi glue)   ║
  ║  * present includes VSync; use presentMode: 'immediate' to remove it ║
  ╚══════════════════════════════════════════════════════════════════════╝
`);

            // ── 6. Assertions ──────────────────────────────────────────────────────
            // These are generous upper-bounds that should hold on any reasonable
            // dev machine.  The test is primarily a profiling tool, not a benchmark.
            expect(frameCount).toBeGreaterThan(0);
            expect(nsPerCall).toBeLessThan(100_000); // < 100 µs per napi call
            expect(napiWorkUs).toBeLessThan(50_000); // < 50 ms total napi work per frame
        },
        (DURATION_MS + 7_000), // 5 s render loop + 7 s setup/teardown/adapter init
    )
})
