import {
    type GPUTextureFormat,
    type GpuBindGroup,
    type GpuBuffer,
    type GpuCommandEncoder,
    type GpuDevice,
    type GpuRenderPipeline,
    type GpuTextureView,
    GPUBufferUsage,
    GPUShaderStage,
    VectorContext,
} from "bun-webgpu-rs";
import { mat4 } from "wgpu-matrix";
import vectorWgsl from "./wgsl/vector.wgsl" with { type: "text" };
import { Std140Writer } from "../shading/std140";

/**
 * Thin wrapper over bun-webgpu-rs's `VectorContext` for screen-space HUD
 * text: loads a TTF, exposes `drawText`, and composites the tessellated
 * glyph geometry with a flat paint color + orthographic pixel-space
 * projection. `VectorContext` is fully implemented in the native addon but
 * had no consumer anywhere in the repo before this — see
 * test/vectorText.smoke.ts for the standalone validation render.
 */
export class VectorText {
    readonly context: VectorContext;

    private readonly device: GpuDevice;
    private readonly pipeline: GpuRenderPipeline;
    private readonly uniformBuffer: GpuBuffer;
    private readonly bindGroup: GpuBindGroup;

    constructor(device: GpuDevice, outputFormat: GPUTextureFormat) {
        this.device = device;
        this.context = new VectorContext(device);

        const bindGroupLayout = device.createBindGroupLayout({
            label: "metis-engine/vector-text-bgl",
            entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { bindingType: "uniform" } }],
        });
        const module = device.createShaderModule({ label: "metis-engine/vector-text-shader", code: vectorWgsl });
        this.pipeline = device.createRenderPipeline({
            label: "metis-engine/vector-text-pipeline",
            layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
            vertex: {
                module,
                entryPoint: "vs",
                buffers: [
                    {
                        arrayStride: 16,
                        attributes: [
                            { shaderLocation: 0, offset: 0, format: "float32x2" },
                            { shaderLocation: 1, offset: 8, format: "float32x2" },
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
                            color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
                            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
                        },
                    },
                ],
            },
            primitive: { topology: "triangle-list" },
        });

        this.uniformBuffer = device.createBuffer({
            label: "metis-engine/vector-text-uniforms",
            size: 80, // mat4 + vec4
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.bindGroup = device.createBindGroup({
            label: "metis-engine/vector-text-bind-group",
            layout: bindGroupLayout,
            entries: [{ binding: 0, buffer: { buffer: this.uniformBuffer } }],
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
     * Flushes pending draw commands and renders them into `view` with a flat
     * `color`, using a top-left-origin, y-down pixel-space orthographic
     * projection matching `drawText`'s (x, y) baseline coordinates.
     * `loadOp` defaults to `"load"` so text composites on top of whatever is
     * already in `view` (e.g. the tonemapped scene).
     */
    render(
        encoder: GpuCommandEncoder,
        view: GpuTextureView,
        width: number,
        height: number,
        color: [number, number, number, number] = [1, 1, 1, 1],
        loadOp: "load" | "clear" = "load",
    ) {
        this.context.flush();
        const calls = this.context.drawCalls;
        if (calls.length === 0) return;

        const proj = mat4.ortho(0, width, height, 0, -1, 1);
        const w = new Std140Writer();
        w.mat4(proj);
        w.vec4(color[0], color[1], color[2], color[3]);
        this.device.queue.writeBuffer(this.uniformBuffer, 0, w.toBytes());

        const pass = encoder.beginRenderPass({
            label: "metis-engine/vector-text-pass",
            colorAttachments: [
                {
                    view,
                    loadOp,
                    storeOp: "store",
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                },
            ],
        });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        this.context.bindBuffers(pass);
        for (const call of calls) {
            pass.drawIndexed(call.indexCount, 1, call.firstIndex);
        }
        pass.end();
    }

    destroy() {
        this.uniformBuffer.destroy();
    }
}
