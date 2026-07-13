// Frame-hitch profiler for the metis-game loop.
//
// Stutter has three usual causes, each with a different fingerprint:
//   - GC / JS spike  → the `update+encode` segment balloons, GPU steady
//   - GPU spike      → `acquire` (vsync wait lands here on Vulkan/D3D) or
//                      `present` balloons while `update+encode` stays flat
//   - pacing         → whole-frame time lands at ~2x the vsync period (a
//                      dropped frame) with no single segment dominating
//
// It times each phase separately, flags frames slower than a rolling
// median-based threshold, tags the phase that caused the hitch, and prints a
// p50/p99 summary every ~2 s. Zero allocation in the steady path (fixed ring
// buffers), so the profiler itself doesn't create the churn it's hunting.
//
// Toggle with the env var:  METIS_PROFILE=1 bun run packages/metis-game/src/index.ts

type Phase = "acquire" | "update+encode" | "present" | "yield";
const PHASES: Phase[] = ["acquire", "update+encode", "present", "yield"];

const RING = 240; // frames kept for percentile stats (~4 s at 60 fps)

export class FrameProfiler {
    readonly enabled: boolean;
    private t = 0;
    private readonly seg: Record<Phase, number> = {acquire: 0, "update+encode": 0, present: 0, yield: 0};
    private readonly whole = new Float64Array(RING);
    private idx = 0;
    private filled = 0;
    private frames = 0;
    private hitches: Record<Phase, number> = {acquire: 0, "update+encode": 0, present: 0, yield: 0};
    private worstWhole = 0;
    private lastReport = 0;
    private readonly sorted = new Float64Array(RING);

    constructor(enabled = process.env.METIS_PROFILE === "1") {
        this.enabled = enabled;
        if (enabled) {
            console.log("[profiler] on — hitches tagged by phase; summary every ~2s. (METIS_PROFILE=1)");
            this.lastReport = performance.now();
        }
    }

    /** Call at the very top of the loop body. */
    begin() {
        if (!this.enabled) return;
        this.seg.acquire = 0;
        this.seg["update+encode"] = 0;
        this.seg.present = 0;
        this.seg.yield = 0;
        this.t = performance.now();
    }

    /** Add the elapsed time to the named phase; the clock rolls into the next.
     *  Accumulates, so a phase (e.g. update+encode) may be lapped more than once
     *  per frame with the pieces summed. */
    lap(phase: Phase) {
        if (!this.enabled) return;
        const now = performance.now();
        this.seg[phase] += now - this.t;
        this.t = now;
    }

    /** Call once at the very end of the loop body (after the last lap). */
    end() {
        if (!this.enabled) return;
        const whole = this.seg.acquire + this.seg["update+encode"] + this.seg.present + this.seg.yield;
        this.whole[this.idx] = whole;
        this.idx = (this.idx + 1) % RING;
        if (this.filled < RING) this.filled++;
        this.frames++;

        // Hitch = slower than 1.6x the rolling median, with a 4 ms floor so we
        // don't flag noise on an idle-fast frame.
        const median = this.percentile(50);
        const threshold = Math.max(median * 1.6, 4);
        if (whole > threshold && this.filled >= 30) {
            let worst: Phase = "acquire";
            for (const p of PHASES) if (this.seg[p] > this.seg[worst]) worst = p;
            this.hitches[worst]++;
            if (whole > this.worstWhole) this.worstWhole = whole;
            console.log(
                `[hitch] ${whole.toFixed(1)}ms (median ${median.toFixed(1)})  ` +
                `→ ${worst} ${this.seg[worst].toFixed(1)}ms  ` +
                `[acq ${this.seg.acquire.toFixed(1)} | upd+enc ${this.seg["update+encode"].toFixed(1)} | ` +
                `pres ${this.seg.present.toFixed(1)} | yld ${this.seg.yield.toFixed(1)}]`,
            );
        }

        const now = performance.now();
        if (now - this.lastReport >= 2000) {
            this.report();
            this.lastReport = now;
        }
    }

    private percentile(pct: number): number {
        const n = this.filled;
        if (n === 0) return 0;
        for (let i = 0; i < n; i++) this.sorted[i] = this.whole[i]!;
        // insertion sort — n is small (<=240) and this runs at most once/frame
        for (let i = 1; i < n; i++) {
            const v = this.sorted[i]!;
            let j = i - 1;
            while (j >= 0 && this.sorted[j]! > v) {
                this.sorted[j + 1] = this.sorted[j]!;
                j--;
            }
            this.sorted[j + 1] = v;
        }
        const rank = Math.min(n - 1, Math.floor((pct / 100) * n));
        return this.sorted[rank]!;
    }

    private report() {
        const p50 = this.percentile(50);
        const p99 = this.percentile(99);
        const total = this.hitches.acquire + this.hitches["update+encode"] + this.hitches.present + this.hitches.yield;
        console.log(
            `[summary] p50 ${p50.toFixed(1)}ms (${(1000 / p50).toFixed(0)}fps)  p99 ${p99.toFixed(1)}ms  ` +
            `worst ${this.worstWhole.toFixed(1)}ms  |  hitches ${total}: ` +
            `acq=${this.hitches.acquire} upd+enc=${this.hitches["update+encode"]} ` +
            `pres=${this.hitches.present} yld=${this.hitches.yield}`,
        );
    }
}
