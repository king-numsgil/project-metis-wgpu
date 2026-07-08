// Standalone validation for bun-webgpu-rs's VectorContext — it's fully
// implemented in the native addon but had no consumer anywhere in the repo
// before src/text/vectorText.ts, so this renders one string to an offscreen
// target and screenshots it before the HUD overlay leans on it.
import { GPUTextureUsage } from "bun-webgpu-rs";
import { takeScreenshot } from "../../bun-webgpu-rs/tests/helpers/screenshot";
import { VectorText } from "../src/text/vectorText";
import { RenderContext } from "../src/rhi/context";

const W = 480;
const H = 160;
const FONT_PATH = new URL("../../../assets/JetBrainsMono-Regular.ttf", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

async function main() {
    const ctx = await RenderContext.createOffscreen({ width: W, height: H, label: "vector-text-smoke" });
    const text = new VectorText(ctx.device, "rgba8unorm");
    text.loadFont("mono", FONT_PATH);
    text.drawText("metis-engine HUD", "mono", 28, 16, 64);

    const target = ctx.device.createTexture({
        label: "vector-text-smoke-target",
        size: { width: W, height: H },
        format: "rgba8unorm",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });

    const encoder = ctx.device.createCommandEncoder();
    text.render(encoder, target.createView(), W, H, [0.1, 1.0, 0.6, 1.0], "clear");
    ctx.device.queue.submit([encoder.finish()]);

    const pixels = await takeScreenshot(ctx.device, target, W, H, "tests/output/vector-text-smoke.png");
    const litPixels = countNonBackground(pixels);
    console.log(`vector-text-smoke.png written; ${litPixels} non-background pixels`);
    if (litPixels === 0) {
        throw new Error("VectorContext smoke test drew nothing — text rendering is broken");
    }

    target.destroy();
    ctx.destroy();
}

function countNonBackground(pixels: Uint8Array): number {
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i]! > 5 || pixels[i + 1]! > 5 || pixels[i + 2]! > 5) count++;
    }
    return count;
}

await main();
