import type { GpuCommandEncoder, GpuDevice, GPUTextureFormat, GpuTextureView } from "metis-native";
import { MAX_PALETTE_COLORS, type Rgba, VectorText } from "../text/vectorText.ts";
import type { GpuProfiler, ProfileSpan } from "./gpuProfiler.ts";

/**
 * Default widget colors. Linear RGBA — these composite onto the *tonemapped*
 * output, so they read as written; drawing them into the HDR target instead
 * would put them through ACES and wash them out.
 */
export const DEBUG_THEME = {
    panel: [0.04, 0.05, 0.07, 0.82] as Rgba,
    border: [0.35, 0.42, 0.5, 0.9] as Rgba,
    grid: [0.18, 0.22, 0.28, 0.7] as Rgba,
    text: [0.85, 0.9, 0.95, 1.0] as Rgba,
    textDim: [0.5, 0.56, 0.62, 1.0] as Rgba,
    good: [0.35, 0.85, 0.45, 1.0] as Rgba,
    warn: [0.95, 0.75, 0.25, 1.0] as Rgba,
    bad: [0.95, 0.35, 0.3, 1.0] as Rgba,
    /** Cycled per series / per tree depth when no explicit color is given. */
    series: [
        [0.35, 0.75, 1.0, 1.0],
        [1.0, 0.6, 0.3, 1.0],
        [0.55, 0.9, 0.45, 1.0],
        [0.85, 0.5, 0.95, 1.0],
        [0.95, 0.85, 0.35, 1.0],
        [0.4, 0.9, 0.85, 1.0],
    ] as Rgba[],
} as const;

/**
 * Fixed-length rolling history — the shape `GraphWidget` plots. Keeps the last
 * `capacity` samples; `values` returns them oldest-first.
 */
export class History {
    private readonly buf: Float64Array;
    private count = 0;
    private head = 0;

    constructor(readonly capacity: number) {
        this.buf = new Float64Array(capacity);
    }

    push(v: number) {
        this.buf[this.head] = v;
        this.head = (this.head + 1) % this.capacity;
        if (this.count < this.capacity) {
            this.count++;
        }
    }

    get length(): number {
        return this.count;
    }

    /** Oldest-first copy, so the plot scrolls left as samples arrive. */
    values(out?: number[]): number[] {
        const res = out ?? [];
        res.length = this.count;
        const start = this.count < this.capacity ? 0 : this.head;
        for (let i = 0; i < this.count; i++) {
            res[i] = this.buf[(start + i) % this.capacity]!;
        }
        return res;
    }

    get latest(): number {
        return this.count === 0 ? 0 : this.buf[(this.head - 1 + this.capacity) % this.capacity]!;
    }

    get mean(): number {
        if (this.count === 0) {
            return 0;
        }
        let s = 0;
        for (let i = 0; i < this.count; i++) {
            s += this.buf[i]!;
        }
        return s / this.count;
    }

    get max(): number {
        let m = -Infinity;
        for (let i = 0; i < this.count; i++) {
            m = Math.max(m, this.buf[i]!);
        }
        return this.count === 0 ? 0 : m;
    }
}

export interface GraphSeries {
    label: string;
    values: readonly number[] | History;
    color?: Rgba;
}

export interface GraphSpec {
    x: number;
    y: number;
    width: number;
    height: number;
    title?: string;
    series: GraphSeries[];
    /** Y-axis bounds. Omit `max` to autoscale to the data (`min` defaults to 0). */
    min?: number;
    max?: number;
    unit?: string;
    fontSize?: number;
}

export interface TreeRow {
    label: string;
    /** Right-aligned value text, e.g. `"1.24 ms"`. */
    value?: string;
    /** 0..1 — draws a proportional bar behind the row. Omit for no bar. */
    fraction?: number;
    color?: Rgba;
    children?: TreeRow[];
}

export interface TreeSpec {
    x: number;
    y: number;
    width: number;
    title?: string;
    rows: TreeRow[];
    rowHeight?: number;
    fontSize?: number;
}

/**
 * Immediate-mode debug widgets drawn with `VectorText`: re-stage the widget list,
 * then `render()`. Nothing is retained except the geometry from the last build.
 *
 * ```ts
 * const debug = new DebugOverlay(device, ctx.outputFormat);
 * debug.loadFont("mono", FONT_PATH);
 * // per frame, after the post chain has written `frame.view`:
 * if (debug.due()) {
 *     debug.graph({x: 12, y: 12, width: 260, height: 90, title: "frame", series: [{label: "gpu", values: history}]});
 * }
 * debug.render(encoder, frame.view, width, height);
 * ```
 *
 * The `due()` gate is not optional dressing — staging tessellates every glyph,
 * and doing that per frame costs more than everything else the overlay does.
 * Staging unconditionally is supported (it just re-tessellates every frame), but
 * only do it when something must be frame-exact.
 *
 * Color reaches the GPU through `VectorText`'s palette, keyed by
 * `VectorContext.setId()`. This class allocates those slots automatically and
 * dedupes them, so widgets just name a color.
 */
export class DebugOverlay {
    readonly text: VectorText;
    /**
     * How often `due()` lets widgets be re-staged, in milliseconds. Vector text
     * is tessellated per glyph per call, which costs far more than the rest of
     * the overlay combined — re-staging it every frame at a few hundred fps
     * dominates the frame and (for a profiler HUD) perturbs what's being
     * measured. 0 re-stages every frame.
     */
    rebuildIntervalMs = 100;

    private fontName = "mono";
    private palette: Rgba[] = [];
    private slots = new Map<string, number>();
    private warnedPaletteFull = false;
    private staged = false;
    private lastBuildMs = -Infinity;

    constructor(device: GpuDevice, outputFormat: GPUTextureFormat) {
        this.text = new VectorText(device, outputFormat);
        this.text.profileLabel = "debug-overlay";
    }

    /**
     * Optional GPU profiler — forwards to the underlying `VectorText`, so the
     * overlay's own draw pass appears in the profiler tree it is displaying.
     *
     * Only the GPU pass is measured. Staging the widgets (`graph`/`tree`/`label`)
     * is CPU work that happens before encoding, so it never appears here — see
     * `due()` for why that cost matters and how it's kept down.
     */
    get profiler(): GpuProfiler | undefined {
        return this.text.profiler;
    }

    set profiler(p: GpuProfiler | undefined) {
        this.text.profiler = p;
    }

    /**
     * Whether widget geometry should be re-staged this frame. Gate staging on it
     * and `render()` replays the previous geometry on the frames it returns
     * false:
     *
     * ```ts
     * if (debug.due()) {
     *     debug.graph({...});
     *     debug.tree({...});
     * }
     * debug.render(encoder, view, width, height);
     * ```
     *
     * Values shown are then up to `rebuildIntervalMs` stale, which is invisible
     * on a HUD a human reads.
     */
    due(nowMs: number = performance.now()): boolean {
        if (nowMs - this.lastBuildMs >= this.rebuildIntervalMs) {
            this.lastBuildMs = nowMs;
            return true;
        }
        return false;
    }

    loadFont(name: string, path: string) {
        this.text.loadFont(name, path);
        this.fontName = name;
    }

    /** A scrolling line graph of one or more series over a shared Y axis. */
    graph(spec: GraphSpec) {
        const fontSize = spec.fontSize ?? 11;
        const {x, y, width, height} = spec;
        const padTop = spec.title ? fontSize + 6 : 4;
        const plotX = x + 4;
        const plotY = y + padTop;
        const plotW = width - 8;
        const plotH = height - padTop - fontSize - 6;

        this.panel(x, y, width, height);

        const resolved = spec.series.map((s, i) => ({
            label: s.label,
            values: s.values instanceof History ? s.values.values() : (s.values as readonly number[]),
            color: s.color ?? DEBUG_THEME.series[i % DEBUG_THEME.series.length]!,
        }));

        // Autoscale: pad the peak by 15% so the line doesn't ride the top edge.
        let max = spec.max;
        if (max === undefined) {
            let peak = 0;
            for (const s of resolved) {
                for (const v of s.values) {
                    if (Number.isFinite(v)) {
                        peak = Math.max(peak, v);
                    }
                }
            }
            max = peak > 0 ? peak * 1.15 : 1;
        }
        const min = spec.min ?? 0;
        const span = max - min || 1;

        // Horizontal gridlines at 1/3 and 2/3.
        this.setColor(DEBUG_THEME.grid);
        for (const f of [1 / 3, 2 / 3]) {
            const gy = plotY + plotH * f;
            this.text.context.beginPath();
            this.text.context.moveTo(plotX, gy);
            this.text.context.lineTo(plotX + plotW, gy);
            this.text.context.stroke(1);
        }

        for (const s of resolved) {
            if (s.values.length < 2) {
                continue;
            }
            this.setColor(s.color);
            const ctx = this.text.context;
            ctx.beginPath();
            const step = plotW / (s.values.length - 1);
            for (let i = 0; i < s.values.length; i++) {
                const v = Number.isFinite(s.values[i]!) ? s.values[i]! : min;
                const t = Math.min(1, Math.max(0, (v - min) / span));
                const px = plotX + i * step;
                const py = plotY + plotH * (1 - t);
                if (i === 0) {
                    ctx.moveTo(px, py);
                } else {
                    ctx.lineTo(px, py);
                }
            }
            ctx.stroke(1.5);
        }

        if (spec.title) {
            this.setColor(DEBUG_THEME.text);
            this.text.drawText(spec.title, this.fontName, fontSize, x + 6, y + fontSize + 1);
        }

        // Axis max, top-right of the plot.
        const unit = spec.unit ?? "";
        this.setColor(DEBUG_THEME.textDim);
        const maxLabel = `${max.toFixed(max < 10 ? 1 : 0)}${unit}`;
        const maxW = this.text.context.measureText(this.fontName, fontSize, maxLabel);
        this.text.drawText(maxLabel, this.fontName, fontSize, x + width - 6 - maxW, y + padTop + fontSize);

        // Legend along the bottom: latest value per series, in the series color.
        let lx = x + 6;
        const ly = y + height - 4;
        for (const s of resolved) {
            const latest = s.values.length > 0 ? s.values[s.values.length - 1]! : 0;
            const label = `${s.label} ${latest.toFixed(2)}${unit}`;
            this.setColor(s.color);
            this.text.drawText(label, this.fontName, fontSize, lx, ly);
            lx += this.text.context.measureText(this.fontName, fontSize, label) + 10;
        }
    }

    /**
     * A hierarchical row list with indent guides and proportional bars — the
     * shape `GpuProfiler.spans` takes via `profileSpansToRows`.
     */
    tree(spec: TreeSpec) {
        const fontSize = spec.fontSize ?? 11;
        const rowH = spec.rowHeight ?? fontSize + 5;
        const {x, width} = spec;
        const padTop = spec.title ? fontSize + 8 : 4;

        const flat: Array<{row: TreeRow; depth: number; lastAtDepth: boolean[]}> = [];
        const walk = (rows: TreeRow[], depth: number, trail: boolean[]) => {
            rows.forEach((row, i) => {
                const isLast = i === rows.length - 1;
                flat.push({row, depth, lastAtDepth: [...trail, isLast]});
                if (row.children && row.children.length > 0) {
                    walk(row.children, depth + 1, [...trail, isLast]);
                }
            });
        };
        walk(spec.rows, 0, []);

        const height = padTop + flat.length * rowH + 4;
        this.panel(x, spec.y, width, height);

        if (spec.title) {
            this.setColor(DEBUG_THEME.text);
            this.text.drawText(spec.title, this.fontName, fontSize, x + 6, spec.y + fontSize + 2);
        }

        const indent = fontSize * 0.9;
        flat.forEach((entry, i) => {
            const {row, depth} = entry;
            const rowY = spec.y + padTop + i * rowH;
            const baseline = rowY + fontSize;
            const labelX = x + 6 + depth * indent + (depth > 0 ? indent * 0.75 : 0);
            const color = row.color ?? DEBUG_THEME.series[depth % DEBUG_THEME.series.length]!;

            // Proportional bar, behind the text.
            if (row.fraction !== undefined) {
                const f = Math.min(1, Math.max(0, row.fraction));
                if (f > 0) {
                    this.setColor([color[0], color[1], color[2], 0.22]);
                    this.rect(x + 3, rowY, (width - 6) * f, rowH - 1);
                }
            }

            // Indent guides: an elbow into this row, and verticals for ancestors
            // that still have siblings below them.
            if (depth > 0) {
                this.setColor(DEBUG_THEME.grid);
                const ctx = this.text.context;
                for (let d = 0; d < depth; d++) {
                    const gx = x + 6 + d * indent + indent * 0.4;
                    const isLast = entry.lastAtDepth[d]!;
                    if (d === depth - 1) {
                        // Elbow: down to this row's middle, then right.
                        ctx.beginPath();
                        ctx.moveTo(gx, rowY);
                        ctx.lineTo(gx, rowY + rowH * 0.5);
                        ctx.lineTo(gx + indent * 0.55, rowY + rowH * 0.5);
                        ctx.stroke(1);
                        if (!isLast) {
                            // Not the last child — the vertical continues past it.
                            ctx.beginPath();
                            ctx.moveTo(gx, rowY + rowH * 0.5);
                            ctx.lineTo(gx, rowY + rowH);
                            ctx.stroke(1);
                        }
                    } else if (!isLast) {
                        ctx.beginPath();
                        ctx.moveTo(gx, rowY);
                        ctx.lineTo(gx, rowY + rowH);
                        ctx.stroke(1);
                    }
                }
            }

            this.setColor(color);
            this.text.drawText(row.label, this.fontName, fontSize, labelX, baseline);

            if (row.value !== undefined) {
                this.setColor(DEBUG_THEME.text);
                const vw = this.text.context.measureText(this.fontName, fontSize, row.value);
                this.text.drawText(row.value, this.fontName, fontSize, x + width - 6 - vw, baseline);
            }
        });
    }

    /** Plain text, for anything that isn't worth a widget. */
    label(text: string, x: number, y: number, color: Rgba = DEBUG_THEME.text, fontSize = 12) {
        this.setColor(color);
        this.text.drawText(text, this.fontName, fontSize, x, y);
    }

    /**
     * Flushes every widget staged since the last call into one render pass. If
     * nothing was staged this frame, replays the previous geometry instead of
     * re-tessellating it — see `due()`.
     */
    render(encoder: GpuCommandEncoder, view: GpuTextureView, width: number, height: number) {
        if (!this.staged) {
            this.text.renderCached(encoder, view, width, height);
            return;
        }
        // Palette is per-build: the ids staged above index exactly this array.
        this.text.render(encoder, view, width, height, this.palette.length > 0 ? this.palette : [DEBUG_THEME.text]);
        this.palette = [];
        this.slots.clear();
        this.staged = false;
    }

    destroy() {
        this.text.destroy();
    }

    /** Interns `c` into this build's palette and tags subsequent geometry with its slot. */
    private setColor(c: Rgba) {
        this.staged = true;
        const key = `${c[0]},${c[1]},${c[2]},${c[3]}`;
        let slot = this.slots.get(key);
        if (slot === undefined) {
            if (this.palette.length >= MAX_PALETTE_COLORS) {
                if (!this.warnedPaletteFull) {
                    this.warnedPaletteFull = true;
                    console.warn(
                        `[metis-engine] DebugOverlay exceeded ${MAX_PALETTE_COLORS} distinct colors; ` +
                            "extra colors fall back to palette slot 0.",
                    );
                }
                slot = 0;
            } else {
                slot = this.palette.length;
                this.palette.push(c);
                this.slots.set(key, slot);
            }
        }
        this.text.context.setId(slot);
    }

    private rect(x: number, y: number, w: number, h: number) {
        const ctx = this.text.context;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + w, y);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x, y + h);
        ctx.closePath();
        ctx.fill();
    }

    private panel(x: number, y: number, w: number, h: number) {
        this.setColor(DEBUG_THEME.panel);
        this.rect(x, y, w, h);
        this.setColor(DEBUG_THEME.border);
        const ctx = this.text.context;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + w, y);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x, y + h);
        ctx.closePath();
        ctx.stroke(1);
    }
}

/**
 * Converts `GpuProfiler.spans` into `TreeWidget` rows: each span's `fraction` is
 * its share of `totalMs`, and its color grades green -> amber -> red by that
 * share, so the expensive pass is the one that stands out.
 *
 * A span that *is* the whole frame (the `"GPU frame"` root) is drawn neutral:
 * it's 100% by definition, and grading it red would flag the total as a problem
 * on every frame.
 */
export function profileSpansToRows(spans: readonly ProfileSpan[], totalMs: number): TreeRow[] {
    const total = totalMs > 0 ? totalMs : 1;
    const convert = (s: ProfileSpan): TreeRow => {
        const fraction = s.gpuMs / total;
        const color =
            fraction >= 0.999
                ? DEBUG_THEME.text
                : fraction > 0.5
                  ? DEBUG_THEME.bad
                  : fraction > 0.25
                    ? DEBUG_THEME.warn
                    : DEBUG_THEME.good;
        return {
            label: s.label,
            value: `${s.gpuMs.toFixed(3)} ms`,
            fraction,
            color,
            children: s.children.map(convert),
        };
    };
    return spans.map(convert);
}
