import { describe, expect, it } from "bun:test";
import {
    createSurface,
    GPUTextureUsage,
    readTexturePixels,
    requestAdapterForWindow,
    savePixelsToFile,
    sdlCreateWindow,
    SdlEventType,
    sdlInit,
    SdlInitFlag,
    sdlPollEvents,
    sdlQuit,
    SdlWindowFlag,
} from "../index.js";

const W = 800;
const H = 600;
const DURATION_MS = 5_000;

const SHADER = /* wgsl */ `
struct Out { @builtin(position) pos: vec4<f32> }

@vertex fn vs(@builtin(vertex_index) vi: u32) -> Out {
  var p = array<vec2<f32>, 3>(
    vec2<f32>( 0.0,  0.5),   // top-center
    vec2<f32>(-0.5, -0.5),   // bottom-left
    vec2<f32>( 0.5, -0.5),   // bottom-right
  );
  return Out(vec4<f32>(p[vi], 0.0, 1.0));
}

@fragment fn fs() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 0.0, 0.0, 1.0);
}
`;

describe("render-window", () => {
    it("renders red triangle to SDL3 window for 5 s then saves screenshot", async () => {
        // ── SDL + GPU setup ───────────────────────────────────────────────────────
        sdlInit(SdlInitFlag.Video | SdlInitFlag.Events);
        const window = sdlCreateWindow("Red Triangle", W, H, SdlWindowFlag.Resizable);

        const adapter = await requestAdapterForWindow(window);
        if (!adapter) {
            sdlQuit();
            throw new Error("No GPU adapter compatible with this window");
        }
        const device = await adapter.requestDevice({label: "window-test"});

        const surface = createSurface(adapter, window);
        const fmt = surface.getPreferredFormat();
        surface.configure(device, {width: W, height: H});

        const shaderModule = device.createShaderModule({code: SHADER});

        // Pipeline that targets the surface's native format (e.g. bgra8unorm-srgb).
        const displayPipeline = device.createRenderPipeline({
            layout: "auto",
            vertex: {module: shaderModule, entryPoint: "vs"},
            fragment: {module: shaderModule, entryPoint: "fs", targets: [{format: fmt}]},
        });

        // Pipeline for the rgba8unorm offscreen capture texture.
        const capturePipeline = device.createRenderPipeline({
            layout: "auto",
            vertex: {module: shaderModule, entryPoint: "vs"},
            fragment: {module: shaderModule, entryPoint: "fs", targets: [{format: "rgba8unorm"}]},
        });

        // Off-screen RGBA texture used only for the final screenshot readback.
        const offscreen = device.createTexture({
            size: {width: W, height: H},
            format: "rgba8unorm",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        });

        // ── Render loop (5 seconds) ───────────────────────────────────────────────
        const deadline = Date.now() + DURATION_MS;
        while (Date.now() < deadline) {
            // Drain the event queue so the OS doesn't mark the window as unresponsive.
            for (const ev of sdlPollEvents()) {
                if (ev.type === SdlEventType.Quit || ev.type === SdlEventType.WindowCloseRequested) {
                    break;
                }
            }

            const frame = surface.getCurrentTexture();
            if (frame.suboptimal) {
                surface.configure(device, {width: window.width, height: window.height});
            }

            const encoder = device.createCommandEncoder();
            const pass = encoder.beginRenderPass({
                colorAttachments: [{
                    view: frame.createView(),
                    loadOp: "clear",
                    storeOp: "store",
                    clearValue: {r: 0, g: 0, b: 0, a: 1},
                }],
            });
            pass.setPipeline(displayPipeline);
            pass.draw(3);
            pass.end();

            device.queue.submit([encoder.finish()]);
            frame.present();
        }

        // ── Capture final frame ───────────────────────────────────────────────────
        // Render one more time into the rgba8unorm offscreen texture so we have a
        // format the readback helper understands.
        const captureEncoder = device.createCommandEncoder();
        const capturePass = captureEncoder.beginRenderPass({
            colorAttachments: [{
                view: offscreen.createView(),
                loadOp: "clear",
                storeOp: "store",
                clearValue: {r: 0, g: 0, b: 0, a: 1},
            }],
        });
        capturePass.setPipeline(capturePipeline);
        capturePass.draw(3);
        capturePass.end();
        device.queue.submit([captureEncoder.finish()]);

        const pixels = await readTexturePixels(device, offscreen);
        await savePixelsToFile(pixels, W, H, "tests/output/window-triangle.png");

        // ── Cleanup ───────────────────────────────────────────────────────────────
        offscreen.destroy();
        window.destroy();
        sdlQuit();

        // ── Assertions ────────────────────────────────────────────────────────────
        const px = (x: number, y: number) => {
            const i = (y * W + x) * 4;
            return {r: pixels[i], g: pixels[i + 1], b: pixels[i + 2], a: pixels[i + 3]};
        };

        // NDC (0, 0) maps to pixel (W/2, H/2) = (400, 300), which is inside the
        // triangle whose centroid sits there.
        const center = px(Math.floor(W / 2), Math.floor(H / 2));
        expect(center.r).toBe(255);
        expect(center.g).toBe(0);
        expect(center.b).toBe(0);
        expect(center.a).toBe(255);

        // Top-left corner is outside the triangle — should be the clear colour.
        const corner = px(10, 10);
        expect(corner.r).toBe(0);
        expect(corner.g).toBe(0);
        expect(corner.b).toBe(0);
        expect(corner.a).toBe(255);

        const file = Bun.file("tests/output/window-triangle.png");
        expect(await file.exists()).toBe(true);
        expect(file.size).toBeGreaterThan(1000);
    }, 12_000); // 12 s total: 5 s render loop + buffer for setup/teardown/IO
});
