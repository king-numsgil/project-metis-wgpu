import {
    type GpuBindGroup,
    type GpuBuffer,
    GPUBufferUsage,
    type GpuCommandEncoder,
    type GpuDevice,
    type GpuRenderPipeline,
    GPUShaderStage,
    type GPUTextureFormat,
    type GpuTextureView,
    VectorContext,
} from "metis-native";
import { mat4 } from "wgpu-matrix";
import type { GpuProfiler } from "../debug/gpuProfiler.ts";
import { Std140Writer } from "../shading/std140.ts";
import vectorWgsl from "./wgsl/vector.wgsl" with { type: "text" };

/** Linear (not sRGB) RGBA in 0..1 — the HDR targets and the swapchain both want linear. */
export type Rgba = readonly [number, number, number, number];

/**
 * Upper bound on distinct colors in one `render()` call. Sized for the debug
 * widgets (a handful of series colors + text + chrome); the palette buffer costs
 * `MAX_PALETTE_COLORS * minUniformBufferOffsetAlignment` bytes (typically 16 KB),
 * so raising it is cheap if a widget ever needs more.
 */
export const MAX_PALETTE_COLORS = 64;

/**
 * Thin wrapper over metis-native's `VectorContext` for screen-space HUD
 * text and 2D debug vector graphics: loads a TTF, exposes `drawText`, and
 * composites the tessellated geometry with an orthographic pixel-space
 * projection.
 *
 * Color comes from a **palette indexed by `VectorContext.setId()`**. Tag
 * geometry with `ctx.setId(i)` before filling it, pass an array of colors to
 * `render()`, and each draw call is painted with `palette[id]`. Passing a
 * single color instead paints everything with it (id is then ignored), which is
 * the plain-HUD-text case.
 */
export class VectorText {
    readonly context: VectorContext;

    private readonly device: GpuDevice;
    private readonly pipeline: GpuRenderPipeline;
    private readonly frameBuffer: GpuBuffer;
    private readonly paletteBuffer: GpuBuffer;
    private readonly bindGroup: GpuBindGroup;
    /** Dynamic-offset stride: one palette slot per alignment unit, not per 16 bytes. */
    private readonly paletteStride: number;
    private readonly paletteStaging: Uint8Array;
    /**
     * Optional GPU profiler. Set it and this class's render pass shows up in the
     * profiler tree alongside the renderer's own passes.
     *
     * **This measures GPU time only** — the pass is a handful of triangles, so
     * expect a small number. The expensive part of text is `drawText`'s
     * tessellation and buffer staging, which happens on the **CPU** before any
     * command is encoded and is therefore invisible to timestamp queries. If the
     * HUD is costing you frame time, it will show up in CPU encode, not here.
     */
    profiler?: GpuProfiler;
    /**
     * Span name used in the profiler tree. Give each instance its own name when
     * a frame has more than one (e.g. a HUD and a debug overlay), or they're
     * indistinguishable in the output.
     */
    profileLabel = "vector-text";

    /** Palette from the last `render()`, so `renderCached` can repaint without re-staging. */
    private lastPalette: readonly Rgba[] = [];

    constructor(device: GpuDevice, outputFormat: GPUTextureFormat) {
        this.device = device;
        this.context = new VectorContext(device);

        // A dynamic offset must be a multiple of minUniformBufferOffsetAlignment,
        // so each palette entry occupies a full alignment unit even though only
        // its first 16 bytes (one vec4) are ever read.
        this.paletteStride = Math.max(16, device.limits.minUniformBufferOffsetAlignment);
        this.paletteStaging = new Uint8Array(this.paletteStride * MAX_PALETTE_COLORS);

        const bindGroupLayout = device.createBindGroupLayout({
            label: "metis-engine/vector-text-bgl",
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: {bindingType: "uniform"},
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: {bindingType: "uniform", hasDynamicOffset: true, minBindingSize: 16},
                },
            ],
        });
        const module = device.createShaderModule({label: "metis-engine/vector-text-shader", code: vectorWgsl});
        this.pipeline = device.createRenderPipeline({
            label: "metis-engine/vector-text-pipeline",
            layout: device.createPipelineLayout({bindGroupLayouts: [bindGroupLayout]}),
            vertex: {
                module,
                entryPoint: "vs",
                buffers: [
                    {
                        arrayStride: 16,
                        attributes: [
                            {shaderLocation: 0, offset: 0, format: "float32x2"},
                            {shaderLocation: 1, offset: 8, format: "float32x2"},
                        ],
                    },
                ],
            },
            fragment: {
                module,
                entryPoint: "fs",
                targets: [
                    {
                        format: outputFormat,
                        blend: {
                            color: {srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha"},
                            alpha: {srcFactor: "one", dstFactor: "one-minus-src-alpha"},
                        },
                    },
                ],
            },
            primitive: {topology: "triangle-list"},
        });

        this.frameBuffer = device.createBuffer({
            label: "metis-engine/vector-text-frame",
            size: 64, // mat4
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.paletteBuffer = device.createBuffer({
            label: "metis-engine/vector-text-palette",
            size: this.paletteStride * MAX_PALETTE_COLORS,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.bindGroup = device.createBindGroup({
            label: "metis-engine/vector-text-bind-group",
            layout: bindGroupLayout,
            entries: [
                {binding: 0, buffer: {buffer: this.frameBuffer}},
                // size 16 (not the whole buffer) — the dynamic offset slides this
                // 16-byte window over the palette.
                {binding: 1, buffer: {buffer: this.paletteBuffer, size: 16}},
            ],
        });
    }

    /** `path` must be an absolute (or CWD-relative) filesystem path — the engine doesn't assume where the caller's assets live. */
    loadFont(name: string, path: string) {
        this.context.loadFont(name, path);
    }

    drawText(text: string, fontName: string, sizePx: number, x: number, y: number) {
        this.context.drawText(text, fontName, sizePx, x, y);
        // drawText() only stages a fillable glyph path — same as
        // beginPath()/lineTo()/closePath() — it still needs fill() to
        // actually enqueue a draw command. Easy to miss: the class doc
        // comment reads like drawText is a fire-and-forget draw call.
        this.context.fill();
    }

    /**
     * Flushes pending draw commands and renders them into `view`, using a
     * top-left-origin, y-down pixel-space orthographic projection matching
     * `drawText`'s (x, y) baseline coordinates.
     *
     * `paint` is either one color for everything, or a palette that each draw
     * call indexes with the id it was tagged with via `context.setId()`. Ids at
     * or past the palette's length (or >= `MAX_PALETTE_COLORS`) fall back to
     * palette entry 0 rather than reading a stale slot.
     *
     * `loadOp` defaults to `"load"` so text composites on top of whatever is
     * already in `view` (e.g. the tonemapped scene).
     */
    render(
        encoder: GpuCommandEncoder,
        view: GpuTextureView,
        width: number,
        height: number,
        paint: Rgba | readonly Rgba[] = [1, 1, 1, 1],
        loadOp: "load" | "clear" = "load",
    ) {
        this.context.flush();
        const calls = this.context.drawCalls;
        if (calls.length === 0) {
            return;
        }

        const palette: readonly Rgba[] = typeof paint[0] === "number" ? [paint as Rgba] : (paint as readonly Rgba[]);
        this.lastPalette = palette;
        const used = Math.min(palette.length, MAX_PALETTE_COLORS);

        const proj = mat4.ortho(0, width, height, 0, -1, 1);
        const w = new Std140Writer();
        w.mat4(proj);
        this.device.queue.writeBuffer(this.frameBuffer, 0, w.toBytes());

        // One writeBuffer for the whole palette: the staging array is laid out at
        // the dynamic-offset stride so each color lands where its offset points.
        const f32 = new Float32Array(this.paletteStaging.buffer);
        for (let i = 0; i < used; i++) {
            const c = palette[i]!;
            const base = (i * this.paletteStride) / 4;
            f32[base] = c[0];
            f32[base + 1] = c[1];
            f32[base + 2] = c[2];
            f32[base + 3] = c[3];
        }
        this.device.queue.writeBuffer(this.paletteBuffer, 0, this.paletteStaging.subarray(0, used * this.paletteStride));

        this.encodePass(encoder, view, loadOp, calls, used);
    }

    private encodePass(
        encoder: GpuCommandEncoder,
        view: GpuTextureView,
        loadOp: "load" | "clear",
        calls: ReadonlyArray<{firstIndex: number; indexCount: number; id: number}>,
        used: number,
    ) {
        const pass = encoder.beginRenderPass({
            label: `metis-engine/${this.profileLabel}-pass`,
            timestampWrites: this.profiler?.pass(this.profileLabel),
            colorAttachments: [
                {
                    view,
                    loadOp,
                    storeOp: "store",
                    clearValue: {r: 0, g: 0, b: 0, a: 1},
                },
            ],
        });
        pass.setPipeline(this.pipeline);
        this.context.bindBuffers(pass);
        let boundSlot = -1;
        for (const call of calls) {
            const slot = call.id < used ? call.id : 0;
            // drawCalls are in staging order — flush() does not group or merge by
            // id — so this only skips the rebind for runs that happen to share a
            // colour. Cheap either way; setBindGroup is not the cost here.
            if (slot !== boundSlot) {
                pass.setBindGroup(0, this.bindGroup, [slot * this.paletteStride]);
                boundSlot = slot;
            }
            pass.drawIndexed(call.indexCount, 1, call.firstIndex);
        }
        pass.end();
    }

    /**
     * Re-draws the geometry from the last `render()` without re-tessellating it.
     *
     * `flush()` uploads to persistent vertex/index buffers and leaves
     * `drawCalls` populated, so replaying them is valid until the next `flush()`.
     * Text is expensive to tessellate (every glyph outline, every call), which
     * makes this the difference between a debug HUD that costs a fraction of a
     * millisecond and one that costs tens.
     *
     * Only valid if **nothing has been staged since** the last `render()` — a
     * staged-but-unflushed path would silently not appear.
     */
    renderCached(
        encoder: GpuCommandEncoder,
        view: GpuTextureView,
        width: number,
        height: number,
        loadOp: "load" | "clear" = "load",
    ) {
        const calls = this.context.drawCalls;
        if (calls.length === 0) {
            return;
        }
        // The projection still has to be rewritten: the window may have resized
        // since the geometry was built.
        const proj = mat4.ortho(0, width, height, 0, -1, 1);
        const w = new Std140Writer();
        w.mat4(proj);
        this.device.queue.writeBuffer(this.frameBuffer, 0, w.toBytes());
        this.encodePass(encoder, view, loadOp, calls, Math.min(this.lastPalette.length, MAX_PALETTE_COLORS));
    }

    destroy() {
        this.frameBuffer.destroy();
        this.paletteBuffer.destroy();
    }
}
