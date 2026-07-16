// VectorContext path-building semantics.
//
// The stroke cases here are regression tests for a hard process panic: `moveTo`
// opens a lyon sub-path and only `closePath` ever ended it, so stroking an open
// polyline — the single most natural use of stroke() — aborted the process with
// "build() called before end()" rather than throwing something catchable.
import { beforeAll, describe, expect, it } from "bun:test";
import { type GpuDevice, requestAdapter, VectorContext } from "../index.js";

const FONT_PATH = new URL("../../../assets/JetBrainsMono-Regular.ttf", import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/,
    "$1",
);

let device: GpuDevice | null = null;

beforeAll(async () => {
    const adapter = await requestAdapter();
    if (adapter) {
        device = await adapter.requestDevice({label: "vector-test-device"});
    }
});

/** Total indices produced by flushing `build` — 0 means nothing was tessellated. */
function tessellate(build: (ctx: VectorContext) => void): number {
    const ctx = new VectorContext(device!);
    build(ctx);
    ctx.flush();
    return ctx.drawCalls.reduce((sum, c) => sum + c.indexCount, 0);
}

describe("VectorContext open paths", () => {
    it("strokes an open polyline without panicking", () => {
        if (!device) {
            return;
        }
        const indices = tessellate((ctx) => {
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(50, 10);
            ctx.lineTo(100, 0);
            ctx.stroke(2);
        });
        expect(indices).toBeGreaterThan(0);
    });

    it("strokes an open arc without panicking", () => {
        if (!device) {
            return;
        }
        const indices = tessellate((ctx) => {
            ctx.beginPath();
            ctx.arc(50, 50, 20, 0, Math.PI);
            ctx.stroke(1.5);
        });
        expect(indices).toBeGreaterThan(0);
    });

    it("handles several open sub-paths in one path", () => {
        if (!device) {
            return;
        }
        // A second moveTo must end the first sub-path; lyon panics on begin()
        // while one is already open.
        const indices = tessellate((ctx) => {
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(10, 10);
            ctx.moveTo(20, 0);
            ctx.lineTo(30, 10);
            ctx.moveTo(40, 0);
            ctx.lineTo(50, 10);
            ctx.stroke(1);
        });
        expect(indices).toBeGreaterThan(0);
    });

    it("still fills a closed path", () => {
        if (!device) {
            return;
        }
        const indices = tessellate((ctx) => {
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(10, 0);
            ctx.lineTo(10, 10);
            ctx.lineTo(0, 10);
            ctx.closePath();
            ctx.fill();
        });
        // Two triangles for a quad.
        expect(indices).toBe(6);
    });

    it("an open path can be filled (implicitly closed by the tessellator)", () => {
        if (!device) {
            return;
        }
        const indices = tessellate((ctx) => {
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(10, 0);
            ctx.lineTo(10, 10);
            ctx.fill();
        });
        expect(indices).toBeGreaterThan(0);
    });
});

describe("VectorContext degenerate input", () => {
    // Everything here reached a Rust panic at some point, which aborts the
    // process rather than throwing — so `bun test` would die outright, not fail.
    // A passing run is the assertion; the expect() calls are secondary.
    const cases: Array<[string, (ctx: VectorContext) => void]> = [
        ["closePath with no sub-path", (c) => {
            c.beginPath();
            c.closePath();
            c.fill();
        }],
        ["double closePath", (c) => {
            c.beginPath();
            c.moveTo(0, 0);
            c.lineTo(10, 0);
            c.lineTo(10, 10);
            c.closePath();
            c.closePath();
            c.fill();
        }],
        ["fill with no path at all", (c) => c.fill()],
        ["stroke with no path at all", (c) => c.stroke(1)],
        ["moveTo without beginPath", (c) => {
            c.moveTo(0, 0);
            c.lineTo(10, 10);
            c.stroke(1);
        }],
        ["arc without beginPath", (c) => {
            c.arc(10, 10, 5, 0, Math.PI);
            c.stroke(1);
        }],
        ["moveTo with nothing after it", (c) => {
            c.beginPath();
            c.moveTo(1, 1);
            c.stroke(1);
        }],
        ["zero-radius arc", (c) => {
            c.beginPath();
            c.arc(10, 10, 0, 0, Math.PI * 2);
            c.fill();
        }],
        ["zero-sweep arc", (c) => {
            c.beginPath();
            c.arc(10, 10, 5, 0, 0);
            c.stroke(1);
        }],
        ["zero stroke width", (c) => {
            c.beginPath();
            c.moveTo(0, 0);
            c.lineTo(10, 10);
            c.stroke(0);
        }],
        ["negative stroke width", (c) => {
            c.beginPath();
            c.moveTo(0, 0);
            c.lineTo(10, 10);
            c.stroke(-5);
        }],
        ["NaN stroke width", (c) => {
            c.beginPath();
            c.moveTo(0, 0);
            c.lineTo(10, 10);
            c.stroke(NaN);
        }],
        ["popTransform on an empty stack", (c) => {
            c.popTransform();
            c.popTransform();
        }],
        ["pushTransform with a short array", (c) => {
            c.pushTransform(new Float32Array([1, 0]));
            c.beginPath();
            c.moveTo(0, 0);
            c.lineTo(10, 10);
            c.stroke(1);
        }],
        ["all-zero (degenerate) transform", (c) => {
            c.pushTransform(new Float32Array([0, 0, 0, 0, 0, 0]));
            c.beginPath();
            c.moveTo(0, 0);
            c.lineTo(10, 10);
            c.lineTo(10, 0);
            c.fill();
        }],
        ["huge finite coordinates", (c) => {
            c.beginPath();
            c.moveTo(-1e30, -1e30);
            c.lineTo(1e30, 1e30);
            c.lineTo(0, 1e30);
            c.fill();
        }],
        ["self-intersecting fill", (c) => {
            c.beginPath();
            c.moveTo(0, 0);
            c.lineTo(10, 10);
            c.lineTo(10, 0);
            c.lineTo(0, 10);
            c.closePath();
            c.fill();
        }],
        ["empty string stroke", (c) => {
            c.loadFont("mono", FONT_PATH);
            c.drawText("", "mono", 12, 0, 0);
            c.stroke(1);
        }],
        ["whitespace-only stroke", (c) => {
            c.loadFont("mono", FONT_PATH);
            c.drawText("   ", "mono", 12, 0, 0);
            c.stroke(1);
        }],
        ["missing glyph stroke", (c) => {
            c.loadFont("mono", FONT_PATH);
            c.drawText("\u{1F600}\u{4E2D}", "mono", 12, 0, 0);
            c.stroke(1);
        }],
        ["NaN text position, stroked", (c) => {
            c.loadFont("mono", FONT_PATH);
            c.drawText("hi", "mono", 12, NaN, 0);
            c.stroke(1);
        }],
        ["NaN text size", (c) => {
            c.loadFont("mono", FONT_PATH);
            c.drawText("hi", "mono", NaN, 0, 0);
            c.fill();
        }],
        ["text then a path in the same batch", (c) => {
            c.loadFont("mono", FONT_PATH);
            c.drawText("hi", "mono", 12, 0, 0);
            c.moveTo(50, 50);
            c.lineTo(60, 60);
            c.stroke(1);
        }],
        ["flush with nothing staged", (c) => {
            c.flush();
            c.flush();
        }],
    ];

    for (const [name, build] of cases) {
        it(`survives: ${name}`, () => {
            if (!device) {
                return;
            }
            const indices = tessellate(build);
            expect(indices).toBeGreaterThanOrEqual(0);
        });
    }

    it("does not blow up geometry for an arc swept past a full turn", () => {
        if (!device) {
            return;
        }
        // Unclamped, the step count grew with |sweep|: 1e6 rad produced
        // ~92M indices (~370 MB of buffers) from one call.
        const indices = tessellate((c) => {
            c.beginPath();
            c.arc(10, 10, 5, 0, 1e6);
            c.stroke(1);
        });
        expect(indices).toBeGreaterThan(0);
        expect(indices).toBeLessThan(10_000);
    });

    it("throws (not panics) for an unknown font", () => {
        if (!device) {
            return;
        }
        const ctx = new VectorContext(device);
        expect(() => ctx.drawText("hi", "nope", 12, 0, 0)).toThrow();
        expect(() => ctx.measureText("nope", 12, "hi")).toThrow();
        expect(() => ctx.fontMetrics("nope", 12)).toThrow();
    });

    it("throws for multi-line text rather than silently mis-rendering", () => {
        if (!device) {
            return;
        }
        const ctx = new VectorContext(device);
        ctx.loadFont("mono", FONT_PATH);
        expect(() => ctx.drawText("a\nb", "mono", 12, 0, 0)).toThrow();
        expect(() => ctx.measureText("mono", 12, "a\nb")).toThrow();
    });
});

describe("VectorContext text", () => {
    it("fills text", () => {
        if (!device) {
            return;
        }
        const indices = tessellate((ctx) => {
            ctx.loadFont("mono", FONT_PATH);
            ctx.drawText("Ag", "mono", 32, 0, 32);
            ctx.fill();
        });
        expect(indices).toBeGreaterThan(0);
    });

    it("strokes text — the outline is built lazily, so this exercises that path", () => {
        if (!device) {
            return;
        }
        // fill() uses cached pre-tessellated geometry and never needs the glyph
        // outline; stroke() is the only consumer, so it's built on demand here.
        const indices = tessellate((ctx) => {
            ctx.loadFont("mono", FONT_PATH);
            ctx.drawText("Ag", "mono", 32, 0, 32);
            ctx.stroke(1);
        });
        expect(indices).toBeGreaterThan(0);
    });

    it("fills then strokes the same text", () => {
        if (!device) {
            return;
        }
        const ctx = new VectorContext(device);
        ctx.loadFont("mono", FONT_PATH);
        ctx.drawText("Ag", "mono", 32, 0, 32);
        ctx.fill();
        ctx.stroke(1);
        ctx.flush();
        // Both paints must survive: fill consumes the cached geometry, stroke
        // then expands the outline from the retained source.
        expect(ctx.drawCalls.length).toBe(2);
        for (const call of ctx.drawCalls) {
            expect(call.indexCount).toBeGreaterThan(0);
        }
    });
});
