import {
    type GpuBindGroup,
    type GpuBindGroupLayout,
    type GpuBuffer,
    GPUBufferUsage,
    type GpuCommandEncoder,
    type GpuComputePipeline,
    type GpuDevice,
    GPUShaderStage,
    type GpuTextureView,
} from "metis-native";
import { Std140Writer } from "../shading/std140.ts";
import type { PostProcessFrameContext, PostProcessPass } from "./pipeline.ts";
import luminanceAverageWgsl from "./wgsl/luminance_average.wgsl" with { type: "text" };

const TILE_SIZE = 16;

/**
 * Two-pass parallel reduction that measures the HDR image's average
 * log-luminance every frame (Reinhard 2002's "log-average luminance" key —
 * see math/Tonemapping and exposure formulas.md), excluding background
 * (depth == far) pixels so an empty-space backdrop doesn't drag the reading
 * down and blow out the actual geometry. Exposes `resultBuffer` (a single
 * f32) for `AutoExposurePass` to read.
 */
export class LuminanceAveragePass implements PostProcessPass {
    readonly name = "luminance-average";

    execute(encoder: GpuCommandEncoder, ctx: PostProcessFrameContext): void {
        const {tileCountX, tileCountY, tileCount} = this.ensureCapacity(ctx.width, ctx.height);

        const params = new Std140Writer();
        params.vec4u(ctx.width, ctx.height, tileCountX, tileCount);
        this.device.queue.writeBuffer(this.paramsBuffer, 0, params.toBytes());

        if (!this.tileBindGroup || this.lastHdrView !== ctx.hdrColorView || this.lastDepthView !== ctx.depthView) {
            this.tileBindGroup = this.device.createBindGroup({
                label: "metis-engine/luminance-tile-bind-group",
                layout: this.tileBindGroupLayout,
                entries: [
                    {binding: 0, textureView: ctx.hdrColorView},
                    {binding: 1, buffer: {buffer: this.partialSumsBuffer!}},
                    {binding: 2, buffer: {buffer: this.paramsBuffer}},
                    {binding: 4, textureView: ctx.depthView},
                    {binding: 5, buffer: {buffer: this.partialCountsBuffer!}},
                ],
            });
            this.lastHdrView = ctx.hdrColorView;
            this.lastDepthView = ctx.depthView;
            this.finalBindGroup = null;
        }
        if (!this.finalBindGroup) {
            this.finalBindGroup = this.device.createBindGroup({
                label: "metis-engine/luminance-final-bind-group",
                layout: this.finalBindGroupLayout,
                entries: [
                    {binding: 1, buffer: {buffer: this.partialSumsBuffer!}},
                    {binding: 2, buffer: {buffer: this.paramsBuffer}},
                    {binding: 3, buffer: {buffer: this.avgLogLuminanceBuffer}},
                    {binding: 5, buffer: {buffer: this.partialCountsBuffer!}},
                ],
            });
        }

        const tilePass = encoder.beginComputePass({
            label: "metis-engine/luminance-tile-pass",
            timestampWrites: ctx.profiler?.pass("luminance-tile"),
        });
        tilePass.setPipeline(this.tilePipeline);
        tilePass.setBindGroup(0, this.tileBindGroup);
        tilePass.dispatchWorkgroups(tileCountX, tileCountY);
        tilePass.end();

        const finalPass = encoder.beginComputePass({
            label: "metis-engine/luminance-final-pass",
            timestampWrites: ctx.profiler?.pass("luminance-final"),
        });
        finalPass.setPipeline(this.finalPipeline);
        finalPass.setBindGroup(0, this.finalBindGroup);
        finalPass.dispatchWorkgroups(1);
        finalPass.end();
    }

    destroy() {
        this.paramsBuffer.destroy();
        this.avgLogLuminanceBuffer.destroy();
        this.partialSumsBuffer?.destroy();
        this.partialCountsBuffer?.destroy();
    }

    private readonly paramsBuffer: GpuBuffer;
    private readonly avgLogLuminanceBuffer: GpuBuffer;
    private readonly tileBindGroupLayout: GpuBindGroupLayout;
    private readonly tilePipeline: GpuComputePipeline;
    private readonly finalBindGroupLayout: GpuBindGroupLayout;
    private readonly finalPipeline: GpuComputePipeline;
    private partialSumsBuffer: GpuBuffer | null = null;
    private partialCountsBuffer: GpuBuffer | null = null;
    private partialCapacity = 0;
    private tileBindGroup: GpuBindGroup | null = null;
    private finalBindGroup: GpuBindGroup | null = null;
    private lastHdrView: GpuTextureView | null = null;
    private lastDepthView: GpuTextureView | null = null;

    constructor(private readonly device: GpuDevice) {
        this.paramsBuffer = device.createBuffer({
            label: "metis-engine/luminance-params",
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.avgLogLuminanceBuffer = device.createBuffer({
            label: "metis-engine/avg-log-luminance",
            size: 4,
            usage: GPUBufferUsage.STORAGE,
        });

        const module = device.createShaderModule({
            label: "metis-engine/luminance-average-shader",
            code: luminanceAverageWgsl,
        });

        this.tileBindGroupLayout = device.createBindGroupLayout({
            label: "metis-engine/luminance-tile-bgl",
            entries: [
                {binding: 0, visibility: GPUShaderStage.COMPUTE, texture: {sampleType: "float"}},
                {binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: {bindingType: "storage"}},
                {binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: {bindingType: "uniform"}},
                {binding: 4, visibility: GPUShaderStage.COMPUTE, texture: {sampleType: "depth", multisampled: true}},
                {binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: {bindingType: "storage"}},
            ],
        });
        this.tilePipeline = device.createComputePipeline({
            label: "metis-engine/luminance-tile-pipeline",
            layout: device.createPipelineLayout({bindGroupLayouts: [this.tileBindGroupLayout]}),
            compute: {module, entryPoint: "reduceTile"},
        });

        this.finalBindGroupLayout = device.createBindGroupLayout({
            label: "metis-engine/luminance-final-bgl",
            entries: [
                {binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: {bindingType: "storage"}},
                {binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: {bindingType: "uniform"}},
                {binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: {bindingType: "storage"}},
                {binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: {bindingType: "storage"}},
            ],
        });
        this.finalPipeline = device.createComputePipeline({
            label: "metis-engine/luminance-final-pipeline",
            layout: device.createPipelineLayout({bindGroupLayouts: [this.finalBindGroupLayout]}),
            compute: {module, entryPoint: "reduceFinal"},
        });
    }

    /** A single f32 storage buffer holding the current average log-luminance. */
    get resultBuffer(): GpuBuffer {
        return this.avgLogLuminanceBuffer;
    }

    private ensureCapacity(width: number, height: number) {
        const tileCountX = Math.ceil(width / TILE_SIZE);
        const tileCountY = Math.ceil(height / TILE_SIZE);
        const tileCount = tileCountX * tileCountY;
        if (tileCount > this.partialCapacity) {
            this.partialSumsBuffer?.destroy();
            this.partialCountsBuffer?.destroy();
            this.partialSumsBuffer = this.device.createBuffer({
                label: "metis-engine/luminance-partial-sums",
                size: tileCount * 4,
                usage: GPUBufferUsage.STORAGE,
            });
            this.partialCountsBuffer = this.device.createBuffer({
                label: "metis-engine/luminance-partial-counts",
                size: tileCount * 4,
                usage: GPUBufferUsage.STORAGE,
            });
            this.partialCapacity = tileCount;
            this.tileBindGroup = null;
            this.finalBindGroup = null;
        }
        return {tileCountX, tileCountY, tileCount};
    }
}
