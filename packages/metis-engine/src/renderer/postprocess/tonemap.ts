import {
    type GpuBindGroupLayout,
    type GpuCommandEncoder,
    type GpuDevice,
    type GpuPipelineLayout,
    type GpuRenderPipeline,
    type GpuShaderModule,
    GPUShaderStage,
    type GPUTextureFormat,
} from "bun-webgpu-rs";
import type { ExposureState } from "./exposureState.ts";
import type { PostProcessFrameContext, PostProcessPass } from "./pipeline.ts";
import tonemapWgsl from "./wgsl/tonemap.wgsl" with { type: "text" };

/** Applies `exposure * ACES filmic` and writes the final display-format image. Always the last pass in the default chain. */
export class TonemapPass implements PostProcessPass {
    readonly name = "tonemap";

    execute(encoder: GpuCommandEncoder, ctx: PostProcessFrameContext): void {
        const pipeline = this.getPipeline(ctx.outputFormat);
        const bindGroup = this.device.createBindGroup({
            label: "metis-engine/tonemap-bind-group",
            layout: this.bindGroupLayout,
            entries: [
                {binding: 0, textureView: ctx.hdrColorView},
                {binding: 1, buffer: {buffer: this.exposure.buffer}},
            ],
        });

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
