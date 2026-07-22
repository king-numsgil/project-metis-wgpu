import { beforeAll, describe, expect, it } from "bun:test";
import { type GpuDevice, GPUTextureUsage, readTexturePixels, requestAdapter, savePixelsToFile } from "../index.js";

let device: GpuDevice | null = null;

beforeAll(async () => {
    const adapter = await requestAdapter();
    if (adapter) {
        device = await adapter.requestDevice({label: "render-test"});
    }
});

const W = 512;
const H = 512;

// Hardcoded red triangle on black background. No vertex buffers needed.
const SHADER = /* wgsl */ `
struct Out { @builtin(position) pos: vec4<f32> }

@vertex fn vs(@builtin(vertex_index) vi: u32) -> Out {
  var p = array<vec2<f32>, 3>(
    vec2<f32>( 0.0,  0.5),   // top-center   → pixel (256, 128)
    vec2<f32>(-0.5, -0.5),   // bottom-left  → pixel (128, 384)
    vec2<f32>( 0.5, -0.5),   // bottom-right → pixel (384, 384)
  );
  return Out(vec4<f32>(p[vi], 0.0, 1.0));
}

@fragment fn fs() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 0.0, 0.0, 1.0); // red
}
`;

describe("render", () => {
    it("renders a red triangle to PNG", async () => {
        if (!device) {
            return;
        }

        // Off-screen render target — needs RENDER_ATTACHMENT to draw into and
        // COPY_SRC so copyTextureToBuffer can read it back.
        const target = device.createTexture({
            size: {width: W, height: H},
            format: "rgba8unorm",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        });

        const module = device.createShaderModule({code: SHADER});
        const pipeline = device.createRenderPipeline({
            layout: "auto",
            vertex: {module, entryPoint: "vs"},
            fragment: {module, entryPoint: "fs", targets: [{format: "rgba8unorm"}]},
        });

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: target.createView(),
                loadOp: "clear",
                storeOp: "store",
                clearValue: {r: 0, g: 0, b: 0, a: 1},
            }],
        });
        pass.setPipeline(pipeline);
        pass.draw(3);
        pass.end();
        device.queue.submit([encoder.finish()]);

        const pixels = await readTexturePixels(device, target);
        await savePixelsToFile(pixels, W, H, "tests/output/red-triangle.png");
        target.destroy();

        // Helper: read RGBA at pixel (x, y).
        const px = (x: number, y: number) => {
            const i = (y * W + x) * 4;
            return {r: pixels[i], g: pixels[i + 1], b: pixels[i + 2], a: pixels[i + 3]};
        };

        // NDC (0, 0.5) / (-0.5,-0.5) / (0.5,-0.5) maps to pixel triangle
        // (256,128) / (128,384) / (384,384). The centroid at (256,299) is safely
        // inside; we use (256,256) which is also well inside.
        const inside = px(256, 256);
        expect(inside.r).toBe(255);
        expect(inside.g).toBe(0);
        expect(inside.b).toBe(0);
        expect(inside.a).toBe(255);

        // Top-left corner is outside the triangle — should be the clear colour.
        const outside = px(10, 10);
        expect(outside.r).toBe(0);
        expect(outside.g).toBe(0);
        expect(outside.b).toBe(0);
        expect(outside.a).toBe(255);

        // PNG file was written and is non-trivially sized.
        const file = Bun.file("tests/output/red-triangle.png");
        expect(await file.exists()).toBe(true);
        expect(file.size).toBeGreaterThan(1000)
    })
})
