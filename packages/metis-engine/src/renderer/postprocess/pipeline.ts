import type { GpuCommandEncoder, GpuDevice, GPUTextureFormat, GpuTextureView } from "metis-native";
import type { GpuProfiler } from "../debug/gpuProfiler.ts";
import { AutoExposurePass } from "./autoExposure.ts";
import { ExposureState } from "./exposureState.ts";
import { LuminanceAveragePass } from "./luminanceAverage.ts";
import { TonemapPass } from "./tonemap.ts";

/** Everything a post-process pass needs for one frame. Built fresh by the caller each frame. */
export interface PostProcessFrameContext {
    device: GpuDevice;
    /** The clustered forward pass's HDR output — read-only input to the whole chain. */
    hdrColorView: GpuTextureView;
    /** The forward pass's depth buffer — `LuminanceAveragePass` uses it to exclude background (depth==far) from metering. */
    depthView: GpuTextureView;
    /** This frame's final display target (the swapchain view, or the fixture's offscreen capture view). */
    outputView: GpuTextureView;
    /**
     * `outputView`'s format — the swapchain's preferred format, or the
     * offscreen capture's. **Never hardcode one**: the tonemap writes linear
     * values and relies on the target's `-srgb` suffix for the hardware encode,
     * and a mismatch is a *silent* validation error that still writes a
     * plausible-looking image.
     */
    outputFormat: GPUTextureFormat;
    /** Output size in pixels; passes size their dispatches from it. */
    width: number;
    height: number;
    /** Seconds since the last frame. Drives auto-exposure's temporal adaptation. */
    deltaTime: number;
    /** Optional GPU profiler; each pass hands it `timestampWrites`. Absent = no profiling, zero cost. */
    profiler?: GpuProfiler;
}

/**
 * One stage of the post-process chain. Compute-only stages (luminance
 * measurement, auto-exposure) just update buffers; image stages read
 * `ctx.hdrColorView` and/or write `ctx.outputView`. Add new passes (bloom,
 * color grading, …) by implementing this interface and inserting them into
 * the array passed to `PostProcessPipeline` — nothing else needs to change.
 */
export interface PostProcessPass {
    /** Identifies the pass; also the natural label to give its profiler span. */
    readonly name: string;

    /** Records this pass's work. Called once per frame, in pipeline order. */
    execute(encoder: GpuCommandEncoder, ctx: PostProcessFrameContext): void;

    /** Release GPU resources. Optional — passes owning nothing can omit it. */
    destroy?(): void;
}

/** Runs a fixed list of {@link PostProcessPass}es in order. Order *is* the chain: nothing is reordered or culled. */
export class PostProcessPipeline {
    /** @param passes executed in array order, every frame. */
    constructor(private passes: PostProcessPass[]) {
    }

    /**
     * Records every pass into `encoder`. Call after the forward pass and before
     * `queue.submit()`; the last pass writes `ctx.outputView`.
     */
    run(encoder: GpuCommandEncoder, ctx: PostProcessFrameContext) {
        for (const pass of this.passes) {
            pass.execute(encoder, ctx);
        }
    }

    /** Destroys every pass that owns resources. */
    destroy() {
        for (const pass of this.passes) {
            pass.destroy?.();
        }
    }
}

/**
 * What {@link createDefaultPostProcessPipeline} returns: the assembled pipeline
 * plus each stage, so callers can retune them (`autoExposure.adaptationTau`,
 * `exposure.set(...)`) without rebuilding the chain.
 */
export interface DefaultPostProcessPipeline {
    /** The thing to call `run()` on each frame. */
    pipeline: PostProcessPipeline;
    /** The shared exposure value the tonemap applies; auto-exposure overwrites it every frame. */
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
