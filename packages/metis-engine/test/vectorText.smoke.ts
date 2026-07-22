// Standalone validation for metis-native's VectorContext — it's fully
// implemented in the native addon but had no consumer anywhere in the repo
// before src/text/vectorText.ts, so this renders one string to an offscreen
// target and screenshots it before the HUD overlay leans on it.
import { type GpuTexture, GPUTextureUsage } from "metis-native";
import { readTexturePixels, savePixelsToFile } from "metis-native";
import { RenderContext, type Rgba, VectorText } from "metis-engine/renderer";

const W = 480;
const H = 160;
const FONT_PATH = new URL("../../../assets/JetBrainsMono-Regular.ttf", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

async function main() {
    const ctx = await RenderContext.createOffscreen({width: W, height: H, label: "vector-text-smoke"});
    const text = new VectorText(ctx.device, "rgba8unorm");
    text.loadFont("mono", FONT_PATH);
    text.drawText("metis-engine HUD", "mono", 28, 16, 64);

    const target = ctx.device.createTexture({
        label: "vector-text-smoke-target",
        size: {width: W, height: H},
        format: "rgba8unorm",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });

    const encoder = ctx.device.createCommandEncoder();
    text.render(encoder, target.createView(), W, H, [0.1, 1.0, 0.6, 1.0], "clear");
    ctx.device.queue.submit([encoder.finish()]);

    const pixels = await readTexturePixels(ctx.device, target);
    await savePixelsToFile(pixels, W, H, "test/output/vector-text-smoke.png");
    const litPixels = countNonBackground(pixels);
    console.log(`vector-text-smoke.png written; ${litPixels} non-background pixels`);
    if (litPixels === 0) {
        throw new Error("VectorContext smoke test drew nothing — text rendering is broken");
    }

    await paletteCheck(ctx, target);

    target.destroy();
    ctx.destroy();
}

/**
 * The palette path (VectorContext.setId -> dynamic-offset paint color) can fail
 * *silently*: a broken dynamic offset just paints everything one color, which
 * still looks like "text rendered fine". So assert the two tagged strings come
 * back as two genuinely different colors, not just that pixels are lit.
 */
async function paletteCheck(ctx: RenderContext, target: GpuTexture) {
    const text = new VectorText(ctx.device, "rgba8unorm");
    text.loadFont("mono", FONT_PATH);

    const RED: Rgba = [1, 0, 0, 1];
    const BLUE: Rgba = [0, 0, 1, 1];
    text.context.setId(0);
    text.drawText("AAAA", "mono", 40, 16, 64);
    text.context.setId(1);
    text.drawText("BBBB", "mono", 40, 16, 130);

    const encoder = ctx.device.createCommandEncoder();
    text.render(encoder, target.createView(), W, H, [RED, BLUE], "clear");
    ctx.device.queue.submit([encoder.finish()]);

    const pixels = await readTexturePixels(ctx.device, target);
    await savePixelsToFile(pixels, W, H, "test/output/vector-text-palette.png");
    let reds = 0;
    let blues = 0;
    for (let i = 0; i < pixels.length; i += 4) {
        const [r, , b] = [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
        if (r > 200 && b < 50) {
            reds++;
        }
        if (b > 200 && r < 50) {
            blues++;
        }
    }
    console.log(`vector-text-palette.png written; ${reds} red px (id 0), ${blues} blue px (id 1)`);
    if (reds === 0 || blues === 0) {
        throw new Error(
            `palette failed: expected both colors, got ${reds} red / ${blues} blue — ` +
                "setId is not reaching the paint binding",
        );
    }
    text.destroy();
}

function countNonBackground(pixels: Uint8Array): number {
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i]! > 5 || pixels[i + 1]! > 5 || pixels[i + 2]! > 5) {
            count++;
        }
    }
    return count;
}

await main();
