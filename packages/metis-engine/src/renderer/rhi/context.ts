import {
    createSurface,
    type GpuAdapter,
    type GpuDevice,
    type GPUPresentMode,
    type GpuSurface,
    type GpuTexture,
    type GPUTextureFormat,
    GPUTextureUsage,
    type GpuTextureView,
    requestAdapter,
    requestAdapterForWindow,
    sdlCreateWindow,
    sdlInit,
    SdlInitFlag,
    sdlQuit,
    type SdlWindow,
} from "bun-webgpu-rs";
import { gpuProfilerFeatures } from "../debug/gpuProfiler.ts";
import { RenderTargets } from "./targets.ts";

export type PowerPreference = "low-power" | "high-performance";
export type Backend = "vulkan" | "dx12" | "metal" | "gl";

export interface RenderContextOptions {
    width: number;
    height: number;
    powerPreference?: PowerPreference;
    backend?: Backend;
    label?: string;
    /**
     * Swapchain present mode (windowed only). Omit to take the binding default,
     * `"mailbox"` — tear-free, low-latency, and free of the periodic
     * getCurrentTexture() stall that `"fifo"`/`"auto-vsync"` show on some Vulkan
     * drivers. Pair it with a {@link FrameLimiter} for a frame cap. Use
     * `"immediate"` to measure raw CPU/GPU frame cost (no present back-pressure).
     */
    presentMode?: GPUPresentMode;
    /**
     * Request the timestamp-query features `GpuProfiler` needs. Off by default:
     * they're optional (and two are native-only wgpu extensions), so a device
     * shouldn't carry them unless something intends to profile.
     *
     * Only the tiers this adapter actually advertises are requested — asking for
     * a feature the adapter lacks fails `requestDevice` outright — so setting
     * this on a GPU with no timestamp support degrades to a normal device rather
     * than throwing. `GpuProfiler.create(ctx.device)` then returns `null`.
     */
    profiling?: boolean;
}

export interface FrameTarget {
    view: GpuTextureView;
    format: GPUTextureFormat;

    present(): void;
}

/**
 * Warns once when the selected adapter is a software rasterizer.
 *
 * On Linux/WSL a failed GPU passthrough falls back to llvmpipe *silently* —
 * wgpu reports a perfectly valid Vulkan adapter and everything renders
 * correctly, just two orders of magnitude slower. Without this the only clue is
 * a stray `MESA: error: ZINK: failed to choose pdev` line scrolled off the top
 * of the log, and the natural conclusion is "the engine got slow".
 */
function warnIfSoftwareAdapter(adapter: GpuAdapter) {
    const info = adapter.info;
    if (info.deviceType !== "Cpu") {
        return;
    }
    console.warn(
        `[metis-engine] adapter is a SOFTWARE rasterizer (${info.description || "unknown"}, ` +
            `${info.backendType}) — expect ~100x slower frames. GPU acceleration is ` +
            "unavailable or failed to initialise; any performance number measured now is meaningless.",
    );
}

/**
 * Owns the GPU device and whatever the final output surface is — a real SDL
 * window for interactive demos, or a plain offscreen texture for headless
 * fixtures — so the rest of the engine can target "whatever `beginFrame()`
 * hands back" without caring which mode it's in.
 */
export class RenderContext {
    readonly device: GpuDevice;
    readonly adapter: GpuAdapter;
    readonly targets: RenderTargets;
    width: number;
    height: number;

    private readonly window: SdlWindow | null;
    private readonly surface: GpuSurface | null;
    // undefined = take the binding's default present mode (mailbox); see configure().
    private readonly presentMode: GPUPresentMode | undefined;
    // takeScreenshot (bun-webgpu-rs/tests/helpers/screenshot.ts) can only read
    // back tight rgba8unorm, so the offscreen path is pinned to that format.
    private readonly offscreenFormat: GPUTextureFormat = "rgba8unorm";
    /**
     * Resolved once, never per frame. `surface.getPreferredFormat()` is a
     * `get_capabilities()` WSI round-trip costing **~6 ms** on this machine's
     * Vulkan backend — when `outputFormat` was a plain getter, `beginFrame()`
     * paid that on every single windowed frame, halving the frame rate
     * regardless of GPU work (200-light bench: 72 -> 149 fps once cached).
     * The format is a property of the surface+adapter pair and doesn't change
     * with size, so caching it is sound — and a format that could change
     * mid-run would be a bug anyway, since pipelines are built against one.
     */
    private readonly windowedFormat: GPUTextureFormat | null;
    private offscreenTarget: GpuTexture | null = null;
    private offscreenView: GpuTextureView | null = null;

    private constructor(
        device: GpuDevice,
        adapter: GpuAdapter,
        width: number,
        height: number,
        window: SdlWindow | null,
        surface: GpuSurface | null,
        presentMode?: GPUPresentMode,
    ) {
        this.device = device;
        this.adapter = adapter;
        this.width = width;
        this.height = height;
        this.window = window;
        this.surface = surface;
        this.presentMode = presentMode;
        this.windowedFormat = surface ? surface.getPreferredFormat() : null;
        this.targets = new RenderTargets(device, width, height);
        if (!surface) {
            this.createOffscreenTarget();
        }
    }

    get sdlWindow(): SdlWindow | null {
        return this.window;
    }

    get isWindowed(): boolean {
        return this.surface !== null;
    }

    /** Format the final post-process pass must target this frame. Cached — see `windowedFormat`. */
    get outputFormat(): GPUTextureFormat {
        return this.windowedFormat ?? this.offscreenFormat;
    }

    /** The texture backing the offscreen target — `null` in windowed mode. Read this back with `takeScreenshot`. */
    get captureTexture(): GpuTexture | null {
        return this.offscreenTarget;
    }

    /** Headless target for the fixture / any automated screenshot check — no SDL window. */
    static async createOffscreen(options: RenderContextOptions): Promise<RenderContext> {
        const adapter = await requestAdapter({powerPreference: options.powerPreference});
        if (!adapter) {
            throw new Error("metis-engine: no GPU adapter available");
        }
        warnIfSoftwareAdapter(adapter);
        const device = await adapter.requestDevice({
            label: options.label ?? "metis-engine-offscreen",
            requiredFeatures: options.profiling ? gpuProfilerFeatures(adapter) : undefined,
        });
        return new RenderContext(device, adapter, options.width, options.height, null, null);
    }

    /**
     * Interactive target — opens a real SDL window and presents to its
     * swapchain. Always uses `requestAdapterForWindow` (not `requestAdapter`)
     * per bun-webgpu-rs/CLAUDE.md: a surfaceless adapter can be incompatible
     * with the window's surface and fail at `configure()`.
     */
    static async createWindowed(title: string, options: RenderContextOptions): Promise<RenderContext> {
        sdlInit(SdlInitFlag.Video);
        const window = sdlCreateWindow(title, options.width, options.height);
        const adapter = await requestAdapterForWindow(window, {
            powerPreference: options.powerPreference ?? "high-performance",
            backend: options.backend,
        });
        if (!adapter) {
            window.destroy();
            sdlQuit();
            throw new Error("metis-engine: no GPU adapter compatible with this window");
        }
        warnIfSoftwareAdapter(adapter);
        const device = await adapter.requestDevice({
            label: options.label ?? "metis-engine-windowed",
            requiredFeatures: options.profiling ? gpuProfilerFeatures(adapter) : undefined,
        });
        const surface = createSurface(adapter, window);
        // Omitting presentMode lets the binding pick its default (mailbox).
        const presentMode = options.presentMode;
        surface.configure(device, {width: window.width, height: window.height, presentMode});
        return new RenderContext(device, adapter, window.width, window.height, window, surface, presentMode);
    }

    /**
     * Acquire this frame's final-output view. Call once per frame before
     * recording commands, and call the returned `present()` after
     * `queue.submit()` (a no-op in offscreen mode).
     */
    beginFrame(): FrameTarget {
        if (this.surface) {
            const frame = this.surface.getCurrentTexture();
            if (frame.suboptimal) {
                this.surface.configure(this.device, {width: this.width, height: this.height, presentMode: this.presentMode});
            }
            return {
                view: frame.createView(),
                format: this.outputFormat,
                present: () => frame.present(),
            };
        }

        return {
            view: this.offscreenView!,
            format: this.outputFormat,
            present: () => {
            },
        };
    }

    /** Resize the swapchain (windowed) or the offscreen capture texture, plus the shared HDR/depth targets. */
    resize(width: number, height: number) {
        if (width === this.width && height === this.height) {
            return;
        }
        this.width = width;
        this.height = height;
        this.targets.resize(this.device, width, height);
        if (this.surface) {
            this.surface.configure(this.device, {width, height, presentMode: this.presentMode});
        } else {
            this.offscreenTarget?.destroy();
            this.createOffscreenTarget();
        }
    }

    destroy() {
        this.targets.destroy();
        this.offscreenTarget?.destroy();
        this.device.destroy();
        if (this.window) {
            this.window.destroy();
            sdlQuit();
        }
    }

    private createOffscreenTarget() {
        this.offscreenTarget = this.device.createTexture({
            label: "metis-engine/offscreen-capture",
            size: {width: this.width, height: this.height},
            format: this.offscreenFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        });
        this.offscreenView = this.offscreenTarget.createView();
    }
}
