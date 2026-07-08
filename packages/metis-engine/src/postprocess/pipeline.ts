import type { GPUTextureFormat, GpuCommandEncoder, GpuDevice, GpuTextureView } from "bun-webgpu-rs";
import { AutoExposurePass } from "./autoExposure";
import { ExposureState } from "./exposureState";
import { LuminanceAveragePass } from "./luminanceAverage";
import { TonemapPass } from "./tonemap";

export interface PostProcessFrameContext {
    device: GpuDevice;
    /** The clustered forward pass's HDR output — read-only input to the whole chain. */
    hdrColorView: GpuTextureView;
    /** The forward pass's depth buffer — `LuminanceAveragePass` uses it to exclude background (depth==far) from metering. */
    depthView: GpuTextureView;
    /** This frame's final display target (the swapchain view, or the fixture's offscreen capture view). */
    outputView: GpuTextureView;
    outputFormat: GPUTextureFormat;
    width: number;
    height: number;
    deltaTime: number;
}

/**
 * One stage of the post-process chain. Compute-only stages (luminance
 * measurement, auto-exposure) just update buffers; image stages read
 * `ctx.hdrColorView` and/or write `ctx.outputView`. Add new passes (bloom,
 * color grading, …) by implementing this interface and inserting them into
 * the array passed to `PostProcessPipeline` — nothing else needs to change.
 */
export interface PostProcessPass {
    readonly name: string;
    execute(encoder: GpuCommandEncoder, ctx: PostProcessFrameContext): void;
    destroy?(): void;
}

export class PostProcessPipeline {
    constructor(private passes: PostProcessPass[]) {}

    run(encoder: GpuCommandEncoder, ctx: PostProcessFrameContext) {
        for (const pass of this.passes) {
            pass.execute(encoder, ctx);
        }
    }

    destroy() {
        for (const pass of this.passes) pass.destroy?.();
    }
}

export interface DefaultPostProcessPipeline {
    pipeline: PostProcessPipeline;
    exposure: ExposureState;
    luminance: LuminanceAveragePass;
    autoExposure: AutoExposurePass;
    tonemap: TonemapPass;
}

/** HDR forward output -> measure luminance -> auto-adapt exposure -> ACES filmic tonemap. The engine's default chain — see src/postprocess/pipeline.ts's `PostProcessPass` doc comment for how to extend it (e.g. bloom). */
export function createDefaultPostProcessPipeline(device: GpuDevice): DefaultPostProcessPipeline {
    const exposure = new ExposureState(device, 1.0);
    const luminance = new LuminanceAveragePass(device);
    const autoExposure = new AutoExposurePass(device, luminance, exposure);
    const tonemap = new TonemapPass(device, exposure);
    return {
        pipeline: new PostProcessPipeline([luminance, autoExposure, tonemap]),
        exposure,
        luminance,
        autoExposure,
        tonemap,
    };
}
