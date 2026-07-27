import { scheduler } from "node:timers/promises";

const SPIN_TAIL_MS = 2; // busy-spin the final stretch for jitter-free pacing

/**
 * Software frame limiter — paces a render loop to a target frame rate. This is
 * the engine's "vsync on" knob, and it is deliberately **separate from the
 * present mode**.
 *
 * The default present mode is `mailbox`, which is tear-free but does NOT cap
 * the frame rate: an idle loop renders as fast as it can, burning GPU/CPU on
 * frames the display never shows. This caps *submission* to a target rate — the
 * power/heat half of what vsync gives you — without the periodic
 * `getCurrentTexture()` stall that native `fifo`/`auto-vsync` exhibit on some
 * Vulkan drivers (that stall is exactly why the default moved off Fifo). So:
 * tearing is the present mode's job, the cap is this class's. Don't reach for
 * `fifo` to get a cap back.
 *
 * ```ts
 * const limiter = new FrameLimiter(Number(process.env.METIS_FPS) || 0);
 * // … each frame, after present():
 * await limiter.wait();
 * ```
 *
 * Reading a cap from the environment / CLI is the caller's job. When
 * benchmarking, call `wait()` *after* any GPU-timing readback so the cap never
 * lands inside what's being measured.
 *
 * Precision: a plain `setTimeout`/`scheduler.wait` oversleeps by 1–15 ms on
 * Windows, which would reintroduce visible judder. So it sleeps for all but the
 * last ~2 ms and busy-spins the tail to hit the deadline exactly — under 2 ms of
 * one core per frame, cheap next to the ~14 ms being given back at 60 fps.
 */
export class FrameLimiter {
    /** The cap this limiter was constructed with; `0` means uncapped. */
    readonly targetFps: number;
    /** `false` when `targetFps` is 0 — `wait()` then only yields to the event loop. */
    readonly enabled: boolean;
    private readonly period: number;
    private next = 0; // performance.now() timestamp of the next frame deadline

    /** @param targetFps frames per second to cap at; `0` (default) = uncapped. */
    constructor(targetFps = 0) {
        this.targetFps = targetFps;
        this.enabled = targetFps > 0;
        this.period = this.enabled ? 1000 / targetFps : 0;
    }

    /**
     * Await until the next frame deadline, then arm the following one. When
     * uncapped, yields to the event loop and returns immediately. Call once per
     * frame, after `present()`.
     */
    async wait() {
        if (!this.enabled) {
            await scheduler.yield(); // still let the event loop breathe
            return;
        }
        const now = performance.now();
        if (this.next === 0) this.next = now + this.period;

        const coarse = this.next - now - SPIN_TAIL_MS;
        if (coarse > 0) await scheduler.wait(coarse);
        while (performance.now() < this.next) {
            // busy-spin the tail — sub-millisecond, keeps frame delivery even
        }

        this.next += this.period;
        // If we fell more than a full frame behind (a real hitch, alt-tab, GC),
        // resync the deadline to "now" so we don't spiral trying to catch up.
        if (performance.now() - this.next > this.period) {
            this.next = performance.now() + this.period;
        }
    }
}
