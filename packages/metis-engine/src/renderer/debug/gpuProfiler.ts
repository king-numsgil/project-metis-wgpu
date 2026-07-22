import {
    type GpuAdapter,
    type GpuBuffer,
    GPUBufferUsage,
    type GpuCommandEncoder,
    type GpuComputePassEncoder,
    type GpuDevice,
    GPUMapMode,
    type GpuQuerySet,
    type GpuRenderPassEncoder,
} from "metis-native";

/** One measured GPU span. `children` are spans nested inside it (draws within a pass). */
export interface ProfileSpan {
    label: string;
    gpuMs: number;
    children: ProfileSpan[];
}

/** Flat record of where a span's two timestamps live, kept until its readback lands. */
interface SpanLayout {
    label: string;
    begin: number;
    end: number;
    /** Index into the same layout array, or -1 for a root span. */
    parent: number;
}

type RingState = "free" | "recorded" | "mapping";

interface RingEntry {
    resolve: GpuBuffer;
    readback: GpuBuffer;
    layout: SpanLayout[];
    queryCount: number;
    state: RingState;
}

/** Timestamps per query set. Each span costs 2; 256 covers every pass plus a per-draw zone on a busy scene. */
const MAX_QUERIES = 256;

/**
 * Frames in flight for readback. Results therefore lag the live frame by ~2-3
 * frames — fine for a debug HUD, and the entire point: mapping a buffer the GPU
 * is still writing would stall the pipeline and distort the very numbers being
 * measured.
 */
const RING_SIZE = 3;

export interface GpuProfilerSupport {
    /** `timestamp-query` — pass-level timing. Without it there is no profiler at all. */
    timestampQuery: boolean;
    /** `timestamp-query-inside-encoders` — a true whole-frame total, including gaps between passes. */
    insideEncoders: boolean;
    /** `timestamp-query-inside-passes` — per-draw-call zones nested under their pass. */
    insidePasses: boolean;
}

/**
 * Reports which profiling tiers `adapter` can support. Call before
 * `requestDevice` and feed the result to `gpuProfilerFeatures`.
 */
export function gpuProfilerSupport(adapter: GpuAdapter): GpuProfilerSupport {
    return {
        timestampQuery: adapter.features.has("timestamp-query"),
        insideEncoders: adapter.features.has("timestamp-query-inside-encoders"),
        insidePasses: adapter.features.has("timestamp-query-inside-passes"),
    };
}

/**
 * The feature names to put in `requestDevice`'s `requiredFeatures` for the
 * tiers this adapter actually supports. Requesting a feature the adapter lacks
 * makes `requestDevice` fail outright, so this is always filtered by
 * `gpuProfilerSupport` — never a hardcoded list.
 */
export function gpuProfilerFeatures(
    adapter: GpuAdapter,
): Array<"timestamp-query" | "timestamp-query-inside-encoders" | "timestamp-query-inside-passes"> {
    const s = gpuProfilerSupport(adapter);
    const out: Array<"timestamp-query" | "timestamp-query-inside-encoders" | "timestamp-query-inside-passes"> = [];
    if (s.timestampQuery) {
        out.push("timestamp-query");
    }
    if (s.insideEncoders) {
        out.push("timestamp-query-inside-encoders");
    }
    if (s.insidePasses) {
        out.push("timestamp-query-inside-passes");
    }
    return out;
}

/**
 * GPU timing for the renderer's passes, via timestamp queries, presented as a
 * tree (`spans`) that `TreeWidget` renders directly.
 *
 * **Opt-in and doubly gated.** Nothing here runs unless a caller constructs a
 * profiler *and* assigns it to `renderer.profiler`; and it can only be
 * constructed on a device that actually enabled the features (see
 * `GpuProfiler.create`). Every hook is a `profiler?.` call that costs nothing
 * when absent.
 *
 * Three tiers, each degrading cleanly to the one below:
 *  - `timestamp-query` (WebGPU spec) — per-pass timing via `timestampWrites`.
 *  - `+ timestamp-query-inside-encoders` (native) — a real whole-frame total
 *    that includes the work between passes, rather than a sum of passes.
 *  - `+ timestamp-query-inside-passes` (native) — per-draw zones inside a pass.
 *
 * **Encode order is the contract**: `beginZone` attaches to the most recent
 * `pass()` span, so passes must be encoded sequentially (which is how the
 * renderer works). Don't interleave the encoding of two passes.
 */
export class GpuProfiler {
    /**
     * Returns a profiler, or `null` if `device` didn't enable `timestamp-query`.
     * Checks the **device**, not the adapter, on purpose: an adapter can support
     * a feature that the caller never requested, and using it then would be a
     * validation error rather than a graceful degrade.
     */
    static create(device: GpuDevice): GpuProfiler | null {
        if (!device.features.has("timestamp-query")) {
            return null;
        }
        return new GpuProfiler(device);
    }

    /** True when per-draw zones are available; `beginZone`/`endZone` are no-ops otherwise. */
    readonly canProfileDraws: boolean;
    /** True when `frameTotalMs` reflects a measured whole-frame span rather than a sum of passes. */
    readonly canProfileFrameTotal: boolean;

    private readonly device: GpuDevice;
    private readonly querySet: GpuQuerySet;
    private readonly ring: RingEntry[] = [];
    private readonly periodNs: number;

    private layout: SpanLayout[] = [];
    private cursor = 0;
    /** Index into `layout` of the pass a zone should nest under, or -1. */
    private currentPass = -1;
    private zoneStack: number[] = [];
    private frameSpan = -1;
    private overflowed = false;

    private lastSpans: ProfileSpan[] = [];
    private lastFrameTotalMs = 0;

    private constructor(device: GpuDevice) {
        this.device = device;
        this.canProfileDraws = device.features.has("timestamp-query-inside-passes");
        this.canProfileFrameTotal = device.features.has("timestamp-query-inside-encoders");
        this.periodNs = device.queue.getTimestampPeriod();

        this.querySet = device.createQuerySet({
            label: "metis-engine/profiler-queries",
            type: "timestamp",
            count: MAX_QUERIES,
        });

        for (let i = 0; i < RING_SIZE; i++) {
            this.ring.push({
                resolve: device.createBuffer({
                    label: `metis-engine/profiler-resolve-${i}`,
                    size: MAX_QUERIES * 8,
                    usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
                }),
                readback: device.createBuffer({
                    label: `metis-engine/profiler-readback-${i}`,
                    size: MAX_QUERIES * 8,
                    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
                }),
                layout: [],
                queryCount: 0,
                state: "free",
            });
        }
    }

    /** The most recent completed frame's span tree. Lags the live frame by a few frames. */
    get spans(): ProfileSpan[] {
        return this.lastSpans;
    }

    /**
     * Total GPU time for the most recent completed frame. A measured span when
     * `canProfileFrameTotal`, otherwise the sum of the top-level passes (which
     * misses any gaps between them).
     */
    get frameTotalMs(): number {
        return this.lastFrameTotalMs;
    }

    /** Call once per frame, before encoding. Also kicks readback of earlier frames. */
    beginFrame(encoder: GpuCommandEncoder) {
        // Entries recorded on a previous frame have certainly been submitted by
        // now (submit happens between two beginFrame calls), so their maps are
        // safe to kick here. Doing it in endFrame would race the submit: the map
        // could resolve before the copy that fills the buffer.
        for (const entry of this.ring) {
            if (entry.state === "recorded") {
                this.kickReadback(entry);
            }
        }

        this.layout = [];
        this.cursor = 0;
        this.currentPass = -1;
        this.zoneStack = [];
        this.frameSpan = -1;
        this.overflowed = false;

        if (this.canProfileFrameTotal) {
            this.frameSpan = this.allocSpan("GPU frame", -1);
            if (this.frameSpan >= 0) {
                encoder.writeTimestamp(this.querySet, this.layout[this.frameSpan]!.begin);
            }
        }
    }

    /**
     * `timestampWrites` for a render or compute pass descriptor, nested under
     * the frame span. Returns `undefined` when the query budget is exhausted,
     * which a pass descriptor accepts as "no timing" — so an overflow costs
     * measurements, never correctness.
     */
    pass(label: string): {querySet: GpuQuerySet; beginningOfPassWriteIndex: number; endOfPassWriteIndex: number} | undefined {
        const idx = this.allocSpan(label, this.frameSpan);
        if (idx < 0) {
            return undefined;
        }
        this.currentPass = idx;
        const span = this.layout[idx]!;
        return {querySet: this.querySet, beginningOfPassWriteIndex: span.begin, endOfPassWriteIndex: span.end};
    }

    /** Opens a per-draw zone inside the pass most recently returned by `pass()`. No-op without `timestamp-query-inside-passes`. */
    beginZone(pass: GpuRenderPassEncoder | GpuComputePassEncoder, label: string) {
        if (!this.canProfileDraws) {
            return;
        }
        const parent = this.zoneStack.length > 0 ? this.zoneStack[this.zoneStack.length - 1]! : this.currentPass;
        const idx = this.allocSpan(label, parent);
        if (idx < 0) {
            return;
        }
        this.zoneStack.push(idx);
        pass.writeTimestamp(this.querySet, this.layout[idx]!.begin);
    }

    /** Closes the innermost open zone. */
    endZone(pass: GpuRenderPassEncoder | GpuComputePassEncoder) {
        if (!this.canProfileDraws) {
            return;
        }
        const idx = this.zoneStack.pop();
        if (idx === undefined) {
            return;
        }
        pass.writeTimestamp(this.querySet, this.layout[idx]!.end);
    }

    /** Call once per frame, after all passes are encoded but before `submit`. */
    endFrame(encoder: GpuCommandEncoder) {
        if (this.frameSpan >= 0) {
            encoder.writeTimestamp(this.querySet, this.layout[this.frameSpan]!.end);
        }
        if (this.cursor === 0) {
            return;
        }
        const entry = this.ring.find((e) => e.state === "free");
        if (!entry) {
            // Every buffer is still in flight — skip this frame's readback rather
            // than stall. The HUD just shows the previous result a little longer.
            return;
        }
        // resolveQuerySet writes every slot in the range, including ones no pass
        // wrote; the layout is what decides which values are read back.
        encoder.resolveQuerySet(this.querySet, 0, this.cursor, entry.resolve, 0);
        encoder.copyBufferToBuffer(entry.resolve, 0, entry.readback, 0, this.cursor * 8);
        entry.layout = this.layout;
        entry.queryCount = this.cursor;
        entry.state = "recorded";
    }

    destroy() {
        for (const entry of this.ring) {
            entry.resolve.destroy();
            entry.readback.destroy();
        }
        this.querySet.destroy();
    }

    /** Allocates 2 query slots and a layout row. Returns -1 once the budget is spent. */
    private allocSpan(label: string, parent: number): number {
        if (this.cursor + 2 > MAX_QUERIES) {
            if (!this.overflowed) {
                this.overflowed = true;
                console.warn(
                    `[metis-engine] GPU profiler exhausted its ${MAX_QUERIES}-query budget; ` +
                        `spans past "${label}" are untimed this frame.`,
                );
            }
            return -1;
        }
        const idx = this.layout.length;
        this.layout.push({label, begin: this.cursor, end: this.cursor + 1, parent});
        this.cursor += 2;
        return idx;
    }

    private kickReadback(entry: RingEntry) {
        entry.state = "mapping";
        const byteSize = entry.queryCount * 8;
        entry.readback
            .mapAsync(GPUMapMode.READ, 0, byteSize)
            .then(() => {
                const bytes = entry.readback.getMappedRange(0, byteSize);
                // Reinterpret the bytes as u64. `new BigUint64Array(bytes)` would
                // convert *values* element-by-element instead — the same trap that
                // once produced a phantom shadow bug in this repo.
                const ticks = new BigUint64Array(
                    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + byteSize),
                );
                this.build(entry.layout, ticks);
                entry.readback.unmap();
                entry.state = "free";
            })
            .catch((e: unknown) => {
                console.warn(`[metis-engine] GPU profiler readback failed: ${String(e)}`);
                entry.state = "free";
            });
    }

    private build(layout: SpanLayout[], ticks: BigUint64Array) {
        const nodes: ProfileSpan[] = layout.map((l) => {
            const a = ticks[l.begin] ?? 0n;
            const b = ticks[l.end] ?? 0n;
            // A pass that never executed leaves its slots unwritten, which can
            // read back as b < a. Clamp rather than surface a negative duration.
            const deltaTicks = b > a ? Number(b - a) : 0;
            return {label: l.label, gpuMs: (deltaTicks * this.periodNs) / 1e6, children: []};
        });

        const roots: ProfileSpan[] = [];
        for (let i = 0; i < layout.length; i++) {
            const parent = layout[i]!.parent;
            if (parent >= 0 && parent < nodes.length) {
                nodes[parent]!.children.push(nodes[i]!);
            } else {
                roots.push(nodes[i]!);
            }
        }

        this.lastSpans = roots;
        this.lastFrameTotalMs = roots.reduce((s, r) => s + r.gpuMs, 0);
    }
}
