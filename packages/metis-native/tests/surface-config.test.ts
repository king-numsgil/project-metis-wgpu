// Coverage for `surface.configure({ colorSpace })` and the failure modes of
// `surface.getCurrentTexture()`. Both arrived with the wgpu 30 upgrade:
// `colorSpace` is a new required field on wgpu's `SurfaceConfiguration`, and
// `getCurrentTexture()` went from `Result<SurfaceTexture, SurfaceError>` to an
// enum that separates "usable frame" from "usable frame, but reconfigure".
//
// **Which of these are deterministic, and which cannot be.** Acquire outcomes
// like Timeout, Occluded, Outdated and Lost depend on the compositor, the
// driver and window-manager state — a test that demanded one of them would be
// flaky on someone else's machine, which is worse than no test. So they are
// covered by asserting the *contract* instead: whatever comes back is either a
// usable frame or a throw whose message names one of the known cases. That
// catches a broken enum mapping (the actual risk here) without depending on
// which branch a given driver takes. Input validation and lifecycle errors are
// pinned exactly, because those are ours and are deterministic everywhere.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
    createSurface,
    type GpuAdapter,
    type GpuDevice,
    type GpuSurface,
    requestAdapterForWindow,
    SdlInitFlag,
    type SdlWindow,
    SdlWindowFlag,
    sdlCreateWindow,
    sdlInit,
    sdlQuit,
} from "../index.js";

const W = 320;
const H = 240;

let window: SdlWindow | null = null;
let adapter: GpuAdapter | null = null;
let device: GpuDevice | null = null;
let surface: GpuSurface | null = null;
let format = "";

beforeAll(async () => {
    sdlInit(SdlInitFlag.Video | SdlInitFlag.Events);
    window = sdlCreateWindow("surface-config", W, H, SdlWindowFlag.Resizable);
    adapter = await requestAdapterForWindow(window);
    if (!adapter) return;
    device = await adapter.requestDevice({ label: "surface-config-test" });
    surface = createSurface(adapter, window);
    format = surface.getPreferredFormat();
});

afterAll(() => {
    // Retire anything still in flight before tearing the swapchain down.
    // Presentation is asynchronous, so a frame presented moments ago can still
    // hold a swapchain acquire semaphore, and wgpu-hal panics (aborting the
    // process, not throwing) if the swapchain outlives it.
    device?.poll("wait");
    // Order is load-bearing: surface before window before sdlQuit, or this
    // segfaults on Linux/X11. See `GpuSurface::destroy` and
    // tests/surface-teardown.test.ts.
    surface?.destroy();
    window?.destroy();
    sdlQuit();
});

describe("configure({ colorSpace })", () => {
    it("defaults to auto when omitted", () => {
        if (!surface || !device) return;
        expect(() => surface!.configure(device!, { width: W, height: H })).not.toThrow();
    });

    it("accepts the SDR spellings", () => {
        if (!surface || !device) return;
        for (const colorSpace of ["auto", "srgb"] as const) {
            expect(() =>
                surface!.configure(device!, { width: W, height: H, colorSpace }),
            ).not.toThrow();
        }
    });

    it("rejects an unknown name and lists the valid ones", () => {
        if (!surface || !device) return;
        // Pure input validation — no hardware involved, so this is exact.
        expect(() =>
            surface!.configure(device!, {
                width: W,
                height: H,
                colorSpace: "rec2020" as never,
            }),
        ).toThrow(/invalid value 'rec2020' for GPUSurfaceColorSpace/);
    });

    it("refuses an HDR colour space on an 8-bit SDR format", () => {
        if (!surface || !device) return;
        // Asserted strictly rather than "succeeds or fails", because this is a
        // property of the *format*, not of the display: extended sRGB exists to
        // carry values outside [0,1], which an 8-bit unorm surface cannot
        // represent at all. No driver offers that pairing, so an HDR request on
        // an 8-bit format must be refused everywhere.
        //
        // Refusing matters because the alternative is silent: left to wgpu, an
        // unsupported colour space is a `configure()` validation error, which
        // this binding only prints to stderr — leaving the surface unconfigured
        // and the app rendering SDR while believing it asked for HDR.
        if (!/^(bgra8|rgba8)/.test(format)) return;
        for (const colorSpace of ["extended-srgb", "extended-srgb-linear"] as const) {
            expect(() =>
                surface!.configure(device!, { width: W, height: H, colorSpace }),
            ).toThrow(new RegExp(`colorSpace .* is not supported for surface format ${format}`));
        }
        // Leave the surface in a known-good state for the tests below.
        surface!.configure(device!, { width: W, height: H });
    });
});

describe("getCurrentTexture()", () => {
    it("acquires a frame once configured", () => {
        if (!surface || !device) return;
        surface.configure(device, { width: W, height: H });
        const frame = surface.getCurrentTexture();
        expect(typeof frame.suboptimal).toBe("boolean");
        expect(() => frame.createView()).not.toThrow();
        frame.present();
    });

    it("refuses to present the same frame twice", () => {
        if (!surface || !device) return;
        surface.configure(device, { width: W, height: H });
        const frame = surface.getCurrentTexture();
        frame.present();
        expect(() => frame.present()).toThrow(/already presented/);
    });

    it("survives a resize without reconfiguring, or says why it cannot", async () => {
        if (!surface || !device || !window) return;
        surface.configure(device, { width: W, height: H });
        surface.getCurrentTexture().present();

        window.setSize(W * 2, H * 2);
        await new Promise((r) => setTimeout(r, 250));

        // Contract, not outcome: a resized-but-unreconfigured swapchain may
        // still hand back frames (flagged suboptimal) or may refuse. Either is
        // correct; an unrecognised third thing is not.
        try {
            const frame = surface.getCurrentTexture();
            expect(typeof frame.suboptimal).toBe("boolean");
            frame.present();
        } catch (e) {
            expect((e as Error).message).toMatch(
                /surface (outdated|lost|timeout|occluded|validation)/,
            );
        }

        surface.configure(device, { width: W * 2, height: H * 2 });
        const recovered = surface.getCurrentTexture();
        expect(recovered.suboptimal).toBe(false); // reconfiguring clears it
        recovered.present();
    });
});

// These two are lifecycle guards rather than acquire outcomes, and both are
// exact everywhere. The first one matters more than it looks: before the
// binding tracked a queue per surface there was nothing to check, and an
// unconfigured surface reached wgpu and **panicked**, aborting the process
// rather than throwing. If that guard is ever removed this test does not fail,
// it takes the runner down with it — which is loud enough to be its own signal.
describe("surface lifecycle errors", () => {
    // A second window, so these can create and tear down surfaces without
    // disturbing the one the tests above are using. The **adapter is shared**:
    // `requestAdapterForWindow` builds its own `wgpu::Instance` each call, and
    // pairing a surface from one instance with a device from another does not
    // raise an error — it panics inside wgpu-core and aborts the process.
    let scratch: SdlWindow | null = null;

    beforeAll(() => {
        if (!adapter) return;
        scratch = sdlCreateWindow("surface-config-scratch", W, H);
    });

    afterAll(() => {
        scratch?.destroy();
    });

    it("rejects getCurrentTexture() before configure()", () => {
        if (!adapter || !scratch) return;
        const fresh = createSurface(adapter, scratch);
        expect(() => fresh.getCurrentTexture()).toThrow(/before configure\(\)/);
        fresh.destroy();
    });

    it("rejects every operation after destroy()", () => {
        if (!adapter || !device || !scratch) return;
        const dev = device; // narrow once; `device` is a `let` and widens inside closures
        const doomed = createSurface(adapter, scratch);
        doomed.configure(dev, { width: W, height: H });
        doomed.destroy();
        expect(() => doomed.getCurrentTexture()).toThrow(/destroyed/);
        expect(() => doomed.configure(dev, { width: W, height: H })).toThrow(/destroyed/);
    });
});
