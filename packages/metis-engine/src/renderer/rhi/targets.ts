import { type GpuDevice, type GpuTexture, GPUTextureUsage, type GpuTextureView } from "metis-native";

/**
 * The forward pass's colour format — fixed, not user-tunable (changing it means
 * touching every shader that reads it). Float, because the whole point is to
 * carry unbounded radiance through to the tonemap without clipping.
 */
export const HDR_COLOR_FORMAT = "rgba16float" as const;
/**
 * The main depth format. **`depth32float` is a precondition, not a preference**:
 * the reverse-Z projection only buys constant relative precision because the
 * float's dense-near-zero region lands where `1/z` is coarsest. A unorm depth
 * buffer would make reversing pointless. See CLAUDE.md "Reverse-Z".
 */
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
    /** What the forward pass draws into (4x MSAA). **Never** what post-process reads. */
    hdrColorMultisampledView!: GpuTextureView;
    hdrColorResolved!: GpuTexture;
    /** The resolved, single-sampled colour — this is the view the post chain takes as `hdrColorView`. */
    hdrColorResolvedView!: GpuTextureView;
    depth!: GpuTexture;
    /**
     * The main depth buffer (4x MSAA, reverse-Z). Anything writing it needs
     * `depthCompare: "greater"` + `depthClearValue: 0.0`; anything reading it
     * tests background as `depth <= 0`, not `>= 1`.
     */
    depthView!: GpuTextureView;

    /** Allocates all three textures at `width x height`. Construct one directly when you own the device. */
    constructor(device: GpuDevice, width: number, height: number) {
        this.width = width;
        this.height = height;
        this.create(device);
    }

    /**
     * Reallocates every target at the new size (a no-op if unchanged). On the
     * caller-owned-device path this must be called alongside
     * `surface.configure(...)` — forget it and the forward pass keeps drawing at
     * the old size while the swapchain moves on.
     */
    resize(device: GpuDevice, width: number, height: number) {
        if (width === this.width && height === this.height) {
            return;
        }
        this.hdrColorMultisampled.destroy();
        this.hdrColorResolved.destroy();
        this.depth.destroy();
        this.width = width;
        this.height = height;
        this.create(device);
    }

    /** Releases all three textures. `RenderContext.destroy()` does this for you. */
    destroy() {
        this.hdrColorMultisampled.destroy();
        this.hdrColorResolved.destroy();
        this.depth.destroy();
    }

    private create(device: GpuDevice) {
        this.hdrColorMultisampled = device.createTexture({
            label: "metis-engine/hdr-color-msaa",
            size: {width: this.width, height: this.height},
            format: HDR_COLOR_FORMAT,
            sampleCount: MSAA_SAMPLE_COUNT,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.hdrColorMultisampledView = this.hdrColorMultisampled.createView();

        this.hdrColorResolved = device.createTexture({
            label: "metis-engine/hdr-color-resolved",
            size: {width: this.width, height: this.height},
            format: HDR_COLOR_FORMAT,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        this.hdrColorResolvedView = this.hdrColorResolved.createView();

        this.depth = device.createTexture({
            label: "metis-engine/depth",
            size: {width: this.width, height: this.height},
            format: DEPTH_FORMAT,
            sampleCount: MSAA_SAMPLE_COUNT,
            // TEXTURE_BINDING so LuminanceAveragePass can mask out background
            // (depth == far) pixels when metering exposure.
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        this.depthView = this.depth.createView();
    }
}
