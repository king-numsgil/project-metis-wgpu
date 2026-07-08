import {
    type GpuBindGroup,
    type GpuBindGroupLayout,
    type GpuBuffer,
    type GpuCommandEncoder,
    type GpuComputePipeline,
    type GpuDevice,
    GPUBufferUsage,
    GPUShaderStage,
} from "bun-webgpu-rs";
import autoExposureWgsl from "./wgsl/auto_exposure.wgsl" with { type: "text" };
import type { ExposureState } from "./exposureState";
import type { LuminanceAveragePass } from "./luminanceAverage";
import type { PostProcessFrameContext, PostProcessPass } from "./pipeline";
import { Std140Writer } from "../shading/std140";

/**
 * Exponentially adapts `ExposureState` toward the exposure implied by
 * `LuminanceAveragePass`'s measurement, so `TonemapPass` never needs a
 * hand-tuned exposure constant — see math/Tonemapping and exposure
 * formulas.md (Formula 2-3).
 */
export class AutoExposurePass implements PostProcessPass {
    readonly name = "auto-exposure";

    private readonly device: GpuDevice;
    private readonly paramsBuffer: GpuBuffer;
    private readonly bindGroupLayout: GpuBindGroupLayout;
    private readonly pipeline: GpuComputePipeline;
    private readonly bindGroup: GpuBindGroup;

    /** Seconds for exposure to adapt ~63% of the way to a new target — larger = slower, dreamier adaptation. */
    adaptationTau = 0.6;
    /** Manual stops-like multiplier applied on top of the metered exposure. */
    exposureCompensation = 1.0;

    constructor(
        device: GpuDevice,
        luminance: LuminanceAveragePass,
        exposure: ExposureState,
    ) {
        this.device = device;
        this.paramsBuffer = device.createBuffer({
            label: "metis-engine/auto-exposure-params",
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.bindGroupLayout = device.createBindGroupLayout({
            label: "metis-engine/auto-exposure-bgl",
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { bindingType: "uniform" } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { bindingType: "read-only-storage" } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { bindingType: "storage" } },
            ],
        });
        this.bindGroup = device.createBindGroup({
            label: "metis-engine/auto-exposure-bind-group",
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, buffer: { buffer: this.paramsBuffer } },
                { binding: 1, buffer: { buffer: luminance.resultBuffer } },
                { binding: 2, buffer: { buffer: exposure.buffer } },
            ],
        });
        this.pipeline = device.createComputePipeline({
            label: "metis-engine/auto-exposure-pipeline",
            layout: device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
            compute: {
                module: device.createShaderModule({
                    label: "metis-engine/auto-exposure-shader",
                    code: autoExposureWgsl,
                }),
                entryPoint: "autoExpose",
            },
        });
    }

    execute(encoder: GpuCommandEncoder, ctx: PostProcessFrameContext): void {
        const params = new Std140Writer();
        params.vec4(ctx.deltaTime, this.adaptationTau, this.exposureCompensation, 0);
        this.device.queue.writeBuffer(this.paramsBuffer, 0, params.toBytes());

        const pass = encoder.beginComputePass({ label: "metis-engine/auto-exposure-pass" });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.dispatchWorkgroups(1);
        pass.end();
    }

    destroy() {
        this.paramsBuffer.destroy();
    }
}
