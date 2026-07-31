import {
    type GpuBindGroup,
    type GpuBindGroupLayout,
    type GpuCommandEncoder,
    type GpuDevice,
    type GpuPipelineLayout,
    type GpuRenderPipeline,
    type GpuShaderModule,
    GPUShaderStage,
    type GPUTextureFormat,
    type GpuTextureView,
} from "metis-native";
import type { ExposureState } from "./exposureState.ts";
import type { PostProcessFrameContext, PostProcessPass } from "./pipeline.ts";
import tonemapWgsl from "./wgsl/tonemap.wgsl" with { type: "text" };

/** Applies `exposure * ACES filmic` and writes the final display-format image. Always the last pass in the default chain. */
export class TonemapPass implements PostProcessPass {
    readonly name = "tonemap";

    /**
     * Draws a fullscreen triangle from `ctx.hdrColorView` into `ctx.outputView`.
     *
     * The shader emits **linear** values and does no sRGB encoding of its own —
     * it relies on `ctx.outputFormat`'s `-srgb` suffix for the hardware
     * encode-on-write. A non-sRGB target therefore silently skips the encode and
     * produces a markedly darker image, with no error anywhere. Pipelines are
     * built lazily and cached per output format.
     */
    execute(encoder: GpuCommandEncoder, ctx: PostProcessFrameContext): void {
        const pipeline = this.getPipeline(ctx.outputFormat);
        // Cached across frames: the exposure buffer is fixed for this pass's
        // lifetime and the HDR view only changes when the targets are
        // reallocated, so this is keyed on that view's identity — the same
        // pattern `LuminanceAveragePass` uses for its own inputs.
        if (!this.bindGroup || this.lastHdrView !== ctx.hdrColorView) {
            this.bindGroup = this.device.createBindGroup({
                label: "metis-engine/tonemap-bind-group",
                layout: this.bindGroupLayout,
                entries: [
                    {binding: 0, textureView: ctx.hdrColorView},
                    {binding: 1, buffer: {buffer: this.exposure.buffer}},
                ],
            });
            this.lastHdrView = ctx.hdrColorView;
        }
        const bindGroup = this.bindGroup;

        const pass = encoder.beginRenderPass({
            label: "metis-engine/tonemap-pass",
            timestampWrites: ctx.profiler?.pass("tonemap"),
            colorAttachments: [
                {
                    view: ctx.outputView,
                    loadOp: "clear",
                    storeOp: "store",
                    clearValue: {r: 0, g: 0, b: 0, a: 1},
                },
            ],
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3);
        pass.end();
    }

    private readonly bindGroupLayout: GpuBindGroupLayout;
    private readonly pipelineLayout: GpuPipelineLayout;
    private readonly module: GpuShaderModule;
    private readonly pipelines = new Map<GPUTextureFormat, GpuRenderPipeline>();
    private bindGroup: GpuBindGroup | null = null;
    private lastHdrView: GpuTextureView | null = null;

    constructor(
        private readonly device: GpuDevice,
        private readonly exposure: ExposureState,
    ) {
        this.bindGroupLayout = device.createBindGroupLayout({
            label: "metis-engine/tonemap-bgl",
            entries: [
                {binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {sampleType: "float"}},
                {binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: {bindingType: "read-only-storage"}},
            ],
        });
        this.pipelineLayout = device.createPipelineLayout({
            label: "metis-engine/tonemap-pipeline-layout",
            bindGroupLayouts: [this.bindGroupLayout],
        });
        this.module = device.createShaderModule({label: "metis-engine/tonemap-shader", code: tonemapWgsl});
    }

    private getPipeline(format: GPUTextureFormat): GpuRenderPipeline {
        let pipeline = this.pipelines.get(format);
        if (!pipeline) {
            pipeline = this.device.createRenderPipeline({
                label: `metis-engine/tonemap-pipeline-${format}`,
                layout: this.pipelineLayout,
                vertex: {module: this.module, entryPoint: "vs"},
                fragment: {module: this.module, entryPoint: "fs", targets: [{format}]},
                primitive: {topology: "triangle-list"},
            });
            this.pipelines.set(format, pipeline);
        }
        return pipeline;
    }
}
