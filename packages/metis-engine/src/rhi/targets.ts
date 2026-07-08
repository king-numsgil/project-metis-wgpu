import { GPUTextureUsage, type GpuDevice, type GpuTexture, type GpuTextureView } from "bun-webgpu-rs";

/** Renderer-owned formats — fixed, not user-tunable (changing them means touching every shader that reads them). */
export const HDR_COLOR_FORMAT = "rgba16float" as const;
export const DEPTH_FORMAT = "depth32float" as const;
/** 4x MSAA — the one sample count every WebGPU implementation is required to support (besides 1). */
export const MSAA_SAMPLE_COUNT = 4;

/**
 * The HDR color + depth targets the clustered forward pass draws into, both
 * multisampled (no MSAA was the actual cause of the "dashed line" artifacts
 * at geometric seams between differently-lit surfaces in the interior
 * demo — see CLAUDE.md's debugging note — not the shadow map, which is why
 * shadow-bias tuning alone never fixed it). Color resolves automatically
 * (via `resolveTarget`) into a single-sampled texture every downstream
 * consumer (post-process passes) reads; depth is read directly as
 * multisampled by `LuminanceAveragePass` (sample index 0 is enough to know
 * whether *something* was drawn there, which is all it needs).
 */
export class RenderTargets {
    width: number;
    height: number;
    hdrColorMultisampled!: GpuTexture;
    hdrColorMultisampledView!: GpuTextureView;
    hdrColorResolved!: GpuTexture;
    hdrColorResolvedView!: GpuTextureView;
    depth!: GpuTexture;
    depthView!: GpuTextureView;

    constructor(device: GpuDevice, width: number, height: number) {
        this.width = width;
        this.height = height;
        this.create(device);
    }

    private create(device: GpuDevice) {
        this.hdrColorMultisampled = device.createTexture({
            label: "metis-engine/hdr-color-msaa",
            size: { width: this.width, height: this.height },
            format: HDR_COLOR_FORMAT,
            sampleCount: MSAA_SAMPLE_COUNT,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.hdrColorMultisampledView = this.hdrColorMultisampled.createView();

        this.hdrColorResolved = device.createTexture({
            label: "metis-engine/hdr-color-resolved",
            size: { width: this.width, height: this.height },
            format: HDR_COLOR_FORMAT,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        this.hdrColorResolvedView = this.hdrColorResolved.createView();

        this.depth = device.createTexture({
            label: "metis-engine/depth",
            size: { width: this.width, height: this.height },
            format: DEPTH_FORMAT,
            sampleCount: MSAA_SAMPLE_COUNT,
            // TEXTURE_BINDING so LuminanceAveragePass can mask out background
            // (depth == far) pixels when metering exposure.
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        this.depthView = this.depth.createView();
    }

    resize(device: GpuDevice, width: number, height: number) {
        if (width === this.width && height === this.height) return;
        this.hdrColorMultisampled.destroy();
        this.hdrColorResolved.destroy();
        this.depth.destroy();
        this.width = width;
        this.height = height;
        this.create(device);
    }

    destroy() {
        this.hdrColorMultisampled.destroy();
        this.hdrColorResolved.destroy();
        this.depth.destroy();
    }
}
