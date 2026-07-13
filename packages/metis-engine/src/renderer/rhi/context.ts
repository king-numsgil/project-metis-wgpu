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
}

export interface FrameTarget {
    view: GpuTextureView;
    format: GPUTextureFormat;

    present(): void;
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

    /** Format the final post-process pass must target this frame. */
    get outputFormat(): GPUTextureFormat {
        return this.surface ? this.surface.getPreferredFormat() : this.offscreenFormat;
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
        const device = await adapter.requestDevice({label: options.label ?? "metis-engine-offscreen"});
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
        const device = await adapter.requestDevice({label: options.label ?? "metis-engine-windowed"});
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
