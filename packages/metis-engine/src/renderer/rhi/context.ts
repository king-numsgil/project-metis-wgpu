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
    enumerateAdapters,
    requestAdapter,
    requestAdapterForWindow,
    sdlCreateWindow,
    sdlInit,
    SdlInitFlag,
    sdlQuit,
    type SdlWindow,
} from "metis-native";
import { gpuProfilerFeatures } from "../debug/gpuProfiler.ts";
import { COMPUTE_WORKGROUP_SIZE, MAX_LIGHTS_PER_CLUSTER, NUM_CLUSTERS } from "../shading/clusterConfig.ts";
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
 * What the renderer actually needs from an adapter, derived from the config
 * rather than assumed.
 *
 * These are far *below* the WebGPU defaults (the compute dispatch needs tens of
 * workgroups, not 65535), which matters in both directions: the engine can run
 * on much weaker hardware than the spec baseline, and an adapter that fails
 * *these* genuinely cannot run it rather than merely being unfashionable.
 *
 * Only limits that actually discriminate between adapters are listed. Texture
 * dimensions and the like are met by everything and would just be noise.
 */
const ENGINE_MIN_LIMITS: Record<string, number> = {
    // cluster_build / light_cull dispatch one workgroup per COMPUTE_WORKGROUP_SIZE clusters.
    maxComputeWorkgroupsPerDimension: Math.ceil(NUM_CLUSTERS / COMPUTE_WORKGROUP_SIZE),
    maxComputeInvocationsPerWorkgroup: COMPUTE_WORKGROUP_SIZE,
    maxComputeWorkgroupSizeX: COMPUTE_WORKGROUP_SIZE,
    // The largest storage buffer the renderer binds.
    maxStorageBufferBindingSize: NUM_CLUSTERS * MAX_LIGHTS_PER_CLUSTER * 4,
};

/** Limits an adapter falls short on, empty if it can run the renderer. */
function adapterShortfalls(adapter: GpuAdapter): string[] {
    const limits = adapter.limits as unknown as Record<string, number>;
    return Object.entries(ENGINE_MIN_LIMITS)
        .filter(([key, need]) => (limits[key] ?? 0) < need)
        .map(([key, need]) => `${key}: need ${need}, adapter offers ${limits[key] ?? 0}`);
}

/** Rough desirability ordering when we have to choose for ourselves. */
function adapterRank(adapter: GpuAdapter): number {
    switch (adapter.info.deviceType) {
        case "DiscreteGpu":
            return 3;
        case "IntegratedGpu":
            return 2;
        case "Cpu":
            return 0;
        default:
            return 1;
    }
}

/**
 * Returns `preferred` if it can actually run the renderer; otherwise the best
 * adapter that can.
 *
 * `powerPreference` is only a hint about *desirability*, and wgpu honours it
 * without knowing what the app needs — so on a machine where the
 * highest-ranked adapter is a broken or feature-poor driver, it is selected and
 * everything fails afterwards with an unrelated-looking error. Seen in the
 * wild: a WSL box where the only Vulkan drivers were Mesa translation layers,
 * `requestAdapter` picked an "IntegratedGpu" that reported **zero** compute
 * workgroups, and the software rasterizer sitting right next to it — which
 * works fine, just slowly — was never considered.
 *
 * Falling back is loud on purpose: a silent downgrade to a CPU rasterizer would
 * look exactly like the engine having got 100x slower.
 */
function selectUsableAdapter(preferred: GpuAdapter, candidates: GpuAdapter[]): GpuAdapter {
    const shortfalls = adapterShortfalls(preferred);
    if (shortfalls.length === 0) {
        return preferred;
    }

    const usable = candidates
        .filter((a) => adapterShortfalls(a).length === 0)
        .sort((a, b) => adapterRank(b) - adapterRank(a));

    if (usable.length === 0) {
        throw new Error(
            `metis-engine: no usable GPU adapter. '${preferred.info.description || "?"}' ` +
                `(${preferred.info.backendType}, ${preferred.info.deviceType}) falls short on:\n` +
                shortfalls.map((s) => `  ${s}`).join("\n") +
                `\nand no other adapter qualifies either. An adapter reporting 0 for a compute ` +
                `limit is a non-conformant or misconfigured driver — check which Vulkan ICD is ` +
                `being selected (\`vulkaninfo --summary\`; a driverID of MESA_DOZEN is a D3D12 ` +
                `translation layer, not a real driver).`,
        );
    }

    const chosen = usable[0]!;
    console.warn(
        `[metis-engine] preferred adapter '${preferred.info.description || "?"}' ` +
            `(${preferred.info.backendType}, ${preferred.info.deviceType}) cannot run this renderer:\n` +
            shortfalls.map((s) => `    ${s}`).join("\n") +
            `\n  Falling back to '${chosen.info.description || "?"}' ` +
            `(${chosen.info.backendType}, ${chosen.info.deviceType}).`,
    );
    return chosen;
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
    /**
     * **sRGB, and that is load-bearing** — it must stay in the same colour space
     * as a real swapchain, which is `bgra8unorm-srgb` on every backend this runs
     * on.
     *
     * `tonemap.wgsl` ends at `acesFilmic(...)` and writes **linear** values; it
     * performs no sRGB encoding of its own, relying on the target format's
     * `-srgb` suffix for the hardware encode-on-write. So the output format is
     * not a free choice — it is the last step of the colour pipeline.
     *
     * This was `rgba8unorm` (no `-srgb`) for as long as readback could only
     * handle that format, which silently skipped the encode: headless captures
     * were linear values stored as if they were sRGB, i.e. **markedly darker
     * than the same scene in a window** (measured on the exterior fixture: mean
     * R 94.8 vs 147.9, and the two images differ by exactly the sRGB transfer
     * curve to within 8-bit rounding). Screenshot validation was therefore
     * validating an image the engine never actually displays. The readback
     * constraint is gone, so the format now matches the windowed path.
     *
     * Corollary: anything building a pipeline that targets this texture must
     * take `ctx.outputFormat` rather than hardcoding a format — a mismatch is a
     * *silent* validation error (stderr only) that still writes a plausible
     * file. `test/fixture.ts`'s `NaiveClampPass` is the cautionary example.
     */
    private readonly offscreenFormat: GPUTextureFormat = "rgba8unorm-srgb";
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

    /** The texture backing the offscreen target — `null` in windowed mode. Read this back with `readTexturePixels` / `saveTextureToFile`. */
    get captureTexture(): GpuTexture | null {
        return this.offscreenTarget;
    }

    /** Headless target for the fixture / any automated screenshot check — no SDL window. */
    static async createOffscreen(options: RenderContextOptions): Promise<RenderContext> {
        const preferred = await requestAdapter({powerPreference: options.powerPreference});
        if (!preferred) {
            throw new Error("metis-engine: no GPU adapter available");
        }
        const adapter = selectUsableAdapter(preferred, await enumerateAdapters());
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
     * per metis-native/CLAUDE.md: a surfaceless adapter can be incompatible
     * with the window's surface and fail at `configure()`.
     */
    static async createWindowed(title: string, options: RenderContextOptions): Promise<RenderContext> {
        sdlInit(SdlInitFlag.Video);
        const window = sdlCreateWindow(title, options.width, options.height);
        const preferred = await requestAdapterForWindow(window, {
            powerPreference: options.powerPreference ?? "high-performance",
            backend: options.backend,
        });
        if (!preferred) {
            window.destroy();
            sdlQuit();
            throw new Error("metis-engine: no GPU adapter compatible with this window");
        }
        // Note the asymmetry: `requestAdapterForWindow` guarantees surface
        // compatibility, an enumerated fallback does not. We only reach for one
        // when the compatible adapter genuinely cannot run the renderer, i.e.
        // when the alternative is failing outright — `configure()` will say so
        // if the fallback can't present either.
        const adapter = selectUsableAdapter(preferred, await enumerateAdapters());
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
        // The surface must go before the window: its teardown talks to the
        // window system, and SDL_DestroyWindow/sdlQuit close the connection it
        // needs. Dropping it afterwards segfaults inside libxcb on Linux/X11.
        this.surface?.destroy();
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
