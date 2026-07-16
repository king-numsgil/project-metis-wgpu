// Offscreen pixel tests for VectorContext.
//
// `vector.test.ts` asserts index counts, which only proves the tessellator
// emitted *something*. These assert on rendered pixels: where geometry landed,
// which edges exist, and what a path's fill actually covers. Several of the bugs
// this file guards were invisible to an index-count check — an unclosed path
// that got silently closed still produces plenty of indices.
import { beforeAll, describe, expect, it } from "bun:test";
import { type GpuDevice, requestAdapter, VectorContext } from "../index.js";
import { createVectorRenderer, makeProbe, type VectorRenderer } from "./helpers/vector-render.ts";

const W = 128;
const H = 128;
const FONT_PATH = new URL("../../../assets/JetBrainsMono-Regular.ttf", import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/,
    "$1",
);

let device: GpuDevice | null = null;
let renderer: VectorRenderer | null = null;

beforeAll(async () => {
    const adapter = await requestAdapter();
    if (!adapter) {
        return;
    }
    device = await adapter.requestDevice({label: "vector-render-test"});
    renderer = createVectorRenderer(device, W, H);
});

/** Stages `build`, renders it, and returns a pixel probe. */
async function draw(build: (ctx: VectorContext) => void) {
    const ctx = new VectorContext(device!);
    build(ctx);
    return makeProbe(await renderer!.render(ctx), W);
}

function rectPath(ctx: VectorContext, x: number, y: number, w: number, h: number) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
}

describe("fill geometry lands where asked", () => {
    it("fills a rect at the right pixels, in y-down pixel space", async () => {
        if (!device) {
            return;
        }
        const p = await draw((ctx) => {
            rectPath(ctx, 20, 30, 40, 50);
            ctx.fill();
        });
        // Inside.
        expect(p.lit(40, 55)).toBe(true);
        expect(p.lit(21, 31)).toBe(true);
        expect(p.lit(58, 78)).toBe(true);
        // Outside on every side — catches a flipped axis or an off-by-one origin.
        expect(p.dark(19, 55)).toBe(true);
        expect(p.dark(61, 55)).toBe(true);
        expect(p.dark(40, 29)).toBe(true);
        expect(p.dark(40, 81)).toBe(true);
        expect(p.bounds()).toEqual({minX: 20, minY: 30, maxX: 59, maxY: 79});
    });

    it("fills two sub-paths as two separate shapes", async () => {
        if (!device) {
            return;
        }
        const p = await draw((ctx) => {
            ctx.beginPath();
            ctx.moveTo(10, 10);
            ctx.lineTo(30, 10);
            ctx.lineTo(30, 30);
            ctx.closePath();
            ctx.moveTo(80, 80);
            ctx.lineTo(100, 80);
            ctx.lineTo(100, 100);
            ctx.closePath();
            ctx.fill();
        });
        expect(p.lit(27, 27)).toBe(true);
        expect(p.lit(97, 97)).toBe(true);
        // The gap between them must not be bridged.
        expect(p.dark(55, 55)).toBe(true);
    });

    it("fills a disc from arc()", async () => {
        if (!device) {
            return;
        }
        const p = await draw((ctx) => {
            ctx.beginPath();
            ctx.arc(64, 64, 30, 0, Math.PI * 2);
            ctx.fill();
        });
        expect(p.lit(64, 64)).toBe(true);
        expect(p.lit(64, 40)).toBe(true);
        expect(p.lit(40, 64)).toBe(true);
        // Outside the radius, including the corners of its bounding box.
        expect(p.dark(64, 20)).toBe(true);
        expect(p.dark(88, 88)).toBe(true);
        const b = p.bounds()!;
        expect(b.minX).toBeGreaterThanOrEqual(33);
        expect(b.maxX).toBeLessThanOrEqual(95);
    });
});

describe("open vs closed paths", () => {
    // The regression that matters: an open polyline must not grow a closing
    // edge. Index counts can't see this — a wrongly-closed path still
    // tessellates fine.
    it("stroking an open polyline draws no closing edge", async () => {
        if (!device) {
            return;
        }
        const p = await draw((ctx) => {
            ctx.beginPath();
            ctx.moveTo(20, 20);
            ctx.lineTo(100, 20);
            ctx.lineTo(100, 100);
            ctx.stroke(3);
        });
        // The two real segments.
        expect(p.lit(60, 20)).toBe(true);
        expect(p.lit(100, 60)).toBe(true);
        // The hypotenuse (100,100)->(20,20) must NOT be drawn.
        expect(p.dark(60, 60)).toBe(true);
        expect(p.dark(40, 40)).toBe(true);
    });

    it("stroking a closed path DOES draw the closing edge", async () => {
        if (!device) {
            return;
        }
        const p = await draw((ctx) => {
            ctx.beginPath();
            ctx.moveTo(20, 20);
            ctx.lineTo(100, 20);
            ctx.lineTo(100, 100);
            ctx.closePath();
            ctx.stroke(3);
        });
        expect(p.lit(60, 20)).toBe(true);
        expect(p.lit(100, 60)).toBe(true);
        // Now the hypotenuse exists.
        expect(p.lit(60, 60)).toBe(true);
    });

    it("filling an open path closes it implicitly, as canvas does", async () => {
        if (!device) {
            return;
        }
        const p = await draw((ctx) => {
            ctx.beginPath();
            ctx.moveTo(20, 20);
            ctx.lineTo(100, 20);
            ctx.lineTo(100, 100);
            ctx.fill();
        });
        // Interior of the implied triangle.
        expect(p.lit(90, 40)).toBe(true);
        // Outside it.
        expect(p.dark(30, 90)).toBe(true);
    });

    it("keeps two open sub-paths separate under one stroke", async () => {
        if (!device) {
            return;
        }
        const p = await draw((ctx) => {
            ctx.beginPath();
            ctx.moveTo(10, 20);
            ctx.lineTo(50, 20);
            ctx.moveTo(10, 100);
            ctx.lineTo(50, 100);
            ctx.stroke(3);
        });
        expect(p.lit(30, 20)).toBe(true);
        expect(p.lit(30, 100)).toBe(true);
        // A second moveTo must start a new sub-path, not connect to the first.
        expect(p.dark(30, 60)).toBe(true);
    });
});

describe("canvas semantics for segments with no open sub-path", () => {
    // Each of these used to abort the process with a lyon panic rather than
    // throw, so "renders nothing" is the fix working.
    it("lineTo with no sub-path acts as moveTo — no segment", async () => {
        if (!device) {
            return;
        }
        const p = await draw((ctx) => {
            ctx.beginPath();
            ctx.lineTo(60, 60);
            ctx.stroke(4);
        });
        expect(p.count()).toBe(0);
    });

    it("lineTo after the first moveTo still draws", async () => {
        if (!device) {
            return;
        }
        const p = await draw((ctx) => {
            ctx.beginPath();
            ctx.lineTo(20, 60); // acts as moveTo
            ctx.lineTo(100, 60); // real segment from (20,60)
            ctx.stroke(4);
        });
        expect(p.lit(60, 60)).toBe(true);
        expect(p.dark(60, 20)).toBe(true);
    });

    it("quadTo with no sub-path starts one at the control point and draws", async () => {
        if (!device) {
            return;
        }
        const p = await draw((ctx) => {
            ctx.beginPath();
            ctx.quadTo(20, 20, 100, 100);
            ctx.stroke(4);
        });
        // Curve runs from the control point (20,20) to (100,100).
        expect(p.count()).toBeGreaterThan(0);
        const b = p.bounds()!;
        expect(b.minX).toBeLessThan(30);
        expect(b.maxX).toBeGreaterThan(90);
    });

    it("lineTo after closePath resumes at the closed sub-path's start point", async () => {
        if (!device) {
            return;
        }
        // Canvas: the new sub-path begins at (20,20) — where the closed one
        // started — so the segment runs (20,20) -> (100,100).
        const p = await draw((ctx) => {
            ctx.beginPath();
            ctx.moveTo(20, 20);
            ctx.lineTo(60, 20);
            ctx.closePath();
            ctx.lineTo(100, 100);
            ctx.stroke(3);
        });
        expect(p.lit(40, 20)).toBe(true); // the closed sub-path
        expect(p.lit(60, 60)).toBe(true); // the resumed diagonal
    });
});

describe("transform stack", () => {
    it("applies a pushed transform to subsequent geometry", async () => {
        if (!device) {
            return;
        }
        const p = await draw((ctx) => {
            ctx.pushTransform(new Float32Array([1, 0, 0, 1, 40, 20])); // translate
            rectPath(ctx, 10, 10, 20, 20);
            ctx.fill();
        });
        expect(p.bounds()).toEqual({minX: 50, minY: 30, maxX: 69, maxY: 49});
    });

    it("nests: the innermost transform applies first (canvas/SVG order)", async () => {
        if (!device) {
            return;
        }
        // translate(100,0) outside, scale(2) inside. A point at (10,10) is scaled
        // in the translated group's local space -> (20,20) -> (120,20).
        // The reverse order would put it at (220,20) — off-screen here.
        const p = await draw((ctx) => {
            ctx.pushTransform(new Float32Array([1, 0, 0, 1, 40, 0]));
            ctx.pushTransform(new Float32Array([2, 0, 0, 2, 0, 0]));
            rectPath(ctx, 10, 10, 10, 10);
            ctx.fill();
        });
        expect(p.bounds()).toEqual({minX: 60, minY: 20, maxX: 79, maxY: 39});
    });

    it("popTransform restores the enclosing transform", async () => {
        if (!device) {
            return;
        }
        const p = await draw((ctx) => {
            ctx.pushTransform(new Float32Array([1, 0, 0, 1, 60, 60]));
            ctx.popTransform();
            rectPath(ctx, 10, 10, 20, 20);
            ctx.fill();
        });
        expect(p.bounds()).toEqual({minX: 10, minY: 10, maxX: 29, maxY: 29});
    });

    it("ignores a non-finite transform but keeps the stack balanced", async () => {
        if (!device) {
            return;
        }
        // A NaN matrix must not silently swallow the caller's matching pop — if
        // it did, the pop would discard the *enclosing* transform instead.
        const p = await draw((ctx) => {
            ctx.pushTransform(new Float32Array([1, 0, 0, 1, 40, 20]));
            ctx.pushTransform(new Float32Array([NaN, 0, 0, 1, 0, 0]));
            ctx.popTransform();
            rectPath(ctx, 10, 10, 20, 20);
            ctx.fill();
        });
        expect(p.bounds()).toEqual({minX: 50, minY: 30, maxX: 69, maxY: 49});
    });
});

describe("non-finite input is ignored, not fatal", () => {
    it("drops a path with NaN coordinates", async () => {
        if (!device) {
            return;
        }
        const p = await draw((ctx) => {
            ctx.beginPath();
            ctx.moveTo(NaN, 0);
            ctx.lineTo(10, NaN);
            ctx.lineTo(Infinity, 10);
            ctx.fill();
        });
        expect(p.count()).toBe(0);
    });

    it("skips only the non-finite segment, keeping the rest of the path", async () => {
        if (!device) {
            return;
        }
        const p = await draw((ctx) => {
            ctx.beginPath();
            ctx.moveTo(20, 20);
            ctx.lineTo(100, 20);
            ctx.lineTo(NaN, NaN); // ignored
            ctx.lineTo(100, 100);
            ctx.stroke(3);
        });
        expect(p.lit(60, 20)).toBe(true);
        expect(p.lit(100, 60)).toBe(true);
    });

    it("drops text drawn at a non-finite position", async () => {
        if (!device) {
            return;
        }
        const p = await draw((ctx) => {
            ctx.loadFont("mono", FONT_PATH);
            ctx.drawText("hello", "mono", 24, NaN, 40);
            ctx.fill();
        });
        // Previously this pushed NaN vertices straight into the buffer (fill) and
        // panicked lyon (stroke).
        expect(p.count()).toBe(0);
    });
});

describe("arc bounds", () => {
    it("clamps a sweep past a full turn instead of tessellating forever", async () => {
        if (!device) {
            return;
        }
        const ctx = new VectorContext(device);
        ctx.beginPath();
        ctx.arc(64, 64, 30, 0, 1e6); // ~92M indices before the clamp
        ctx.stroke(2);
        ctx.flush();
        const indices = ctx.drawCalls.reduce((s, c) => s + c.indexCount, 0);
        expect(indices).toBeGreaterThan(0);
        expect(indices).toBeLessThan(10_000);

        // And it still looks like a full circle.
        const p = makeProbe(await renderer!.render(new VectorContext(device)), W); // clear
        expect(p.count()).toBe(0);
        const q = await draw((c) => {
            c.beginPath();
            c.arc(64, 64, 30, 0, 1e6);
            c.stroke(2);
        });
        expect(q.lit(64, 34)).toBe(true);
        expect(q.lit(94, 64)).toBe(true);
        expect(q.lit(64, 94)).toBe(true);
        expect(q.lit(34, 64)).toBe(true);
        expect(q.dark(64, 64)).toBe(true); // stroked, not filled
    });
});

describe("text", () => {
    it("renders glyph pixels at the baseline position", async () => {
        if (!device) {
            return;
        }
        const p = await draw((ctx) => {
            ctx.loadFont("mono", FONT_PATH);
            ctx.drawText("HH", "mono", 40, 20, 80);
            ctx.fill();
        });
        expect(p.count()).toBeGreaterThan(0);
        const b = p.bounds()!;
        // drawText's y is the baseline, so glyphs sit ABOVE it (y is down).
        expect(b.maxY).toBeLessThanOrEqual(80);
        expect(b.minY).toBeGreaterThan(40);
        expect(b.minX).toBeGreaterThanOrEqual(20);
    });

    it("measureText agrees with the rendered width", async () => {
        if (!device) {
            return;
        }
        const ctx = new VectorContext(device);
        ctx.loadFont("mono", FONT_PATH);
        const measured = ctx.measureText("mono", 40, "HHH");
        ctx.drawText("HHH", "mono", 40, 10, 80);
        ctx.fill();
        const p = makeProbe(await renderer!.render(ctx), W);
        const b = p.bounds()!;
        // Rendered ink is inside the advance width (side bearings), never wider.
        const inkWidth = b.maxX - b.minX + 1;
        expect(inkWidth).toBeLessThanOrEqual(Math.ceil(measured));
        expect(inkWidth).toBeGreaterThan(measured * 0.5);
    });

    it("renders nothing for an empty string", async () => {
        if (!device) {
            return;
        }
        const p = await draw((ctx) => {
            ctx.loadFont("mono", FONT_PATH);
            ctx.drawText("", "mono", 40, 10, 80);
            ctx.fill();
        });
        expect(p.count()).toBe(0);
    });

    it("draws a notdef box for a glyph the font lacks", async () => {
        if (!device) {
            return;
        }
        const p = await draw((ctx) => {
            ctx.loadFont("mono", FONT_PATH);
            ctx.drawText("\u{4E2D}", "mono", 40, 20, 80);
            ctx.fill();
        });
        // Not silently nothing — the caller should see the glyph is missing.
        expect(p.count()).toBeGreaterThan(0);
    });
});

describe("buffer reuse across flushes", () => {
    it("renders correctly when a later flush needs a bigger buffer", async () => {
        if (!device) {
            return;
        }
        // Buffers are grow-only and reused, so a small->large->small sequence
        // exercises reallocation and stale-tail handling.
        const ctx = new VectorContext(device);

        rectPath(ctx, 10, 10, 10, 10);
        ctx.fill();
        let p = makeProbe(await renderer!.render(ctx), W);
        expect(p.bounds()).toEqual({minX: 10, minY: 10, maxX: 19, maxY: 19});

        // Much more geometry -> forces a grow.
        for (let i = 0; i < 40; i++) {
            ctx.beginPath();
            ctx.arc(64, 64, 10 + i, 0, Math.PI * 2);
            ctx.stroke(1);
        }
        p = makeProbe(await renderer!.render(ctx), W);
        expect(p.count()).toBeGreaterThan(1000);

        // Back to a small draw: must not render any of the previous frame's
        // geometry left behind in the (now larger) buffer.
        rectPath(ctx, 90, 90, 10, 10);
        ctx.fill();
        p = makeProbe(await renderer!.render(ctx), W);
        expect(p.bounds()).toEqual({minX: 90, minY: 90, maxX: 99, maxY: 99});
    });

    it("clear() discards staged geometry without rendering it", async () => {
        if (!device) {
            return;
        }
        const ctx = new VectorContext(device);
        rectPath(ctx, 10, 10, 40, 40);
        ctx.fill();
        ctx.clear();
        const p = makeProbe(await renderer!.render(ctx), W);
        expect(p.count()).toBe(0);
    });

    it("re-renders the last flush's geometry when nothing new is staged", async () => {
        if (!device) {
            return;
        }
        // metis-engine's VectorText.renderCached depends on drawCalls + the GPU
        // buffers staying valid until the next flush().
        const ctx = new VectorContext(device);
        rectPath(ctx, 20, 20, 30, 30);
        ctx.fill();
        const first = makeProbe(await renderer!.render(ctx), W);
        expect(first.bounds()).toEqual({minX: 20, minY: 20, maxX: 49, maxY: 49});

        // render() flushes again with nothing staged; drawCalls is emptied, which
        // is exactly why renderCached must NOT call flush().
        const second = makeProbe(await renderer!.render(ctx), W);
        expect(second.count()).toBe(0);
    });
});

describe("draw call ids", () => {
    it("tags each draw call with the id current when it was staged", async () => {
        if (!device) {
            return;
        }
        const ctx = new VectorContext(device);
        ctx.setId(7);
        rectPath(ctx, 10, 10, 10, 10);
        ctx.fill();
        ctx.setId(3);
        rectPath(ctx, 30, 30, 10, 10);
        ctx.fill();
        ctx.flush();
        // Order is staging order — flush does not sort or merge by id.
        expect(ctx.drawCalls.map((c) => c.id)).toEqual([7, 3]);
        expect(ctx.drawCalls[0]!.firstIndex).toBe(0);
        expect(ctx.drawCalls[1]!.firstIndex).toBe(ctx.drawCalls[0]!.indexCount);
    });
});
