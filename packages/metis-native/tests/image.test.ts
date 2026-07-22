import { mkdirSync } from "node:fs";
import { beforeAll, describe, expect, it } from "bun:test";
import {
    type GpuDevice,
    GPUTextureUsage,
    ImageColorSpace,
    readTexturePixels,
    requestAdapter,
    loadImageTexture,
    savePixelsToFile,
} from "../index.js";

let device: GpuDevice | null = null;

beforeAll(async () => {
    const adapter = await requestAdapter();
    if (adapter) {
        device = await adapter.requestDevice({ label: "image-test" });
    }
});

// Relative to the package root (bun test's cwd), matching the other tests' use
// of `tests/output/...` paths.
const OUT_DIR = "tests/output";

// A 4x4 image with distinct per-pixel RGBA values — distinct enough to catch a
// channel swap (R<->B), a row-stride bug, or a dropped alpha.
const W = 4;
const H = 4;
function knownPixels(): Uint8Array {
    const px = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
        px[i * 4 + 0] = (i * 16) & 0xff; // R ramps
        px[i * 4 + 1] = 255 - ((i * 16) & 0xff); // G ramps down
        px[i * 4 + 2] = i % 2 === 0 ? 0 : 255; // B alternates
        px[i * 4 + 3] = 200 + i; // A distinct, non-255
    }
    return px;
}

describe("loadImageTexture", () => {
    it("decodes a PNG file straight into a GpuTexture with correct pixels (linear)", async () => {
        if (!device) return; // no GPU adapter in this environment
        mkdirSync(OUT_DIR, { recursive: true });

        const original = knownPixels();
        const pngPath = `${OUT_DIR}/roundtrip-input.png`;
        await savePixelsToFile(original, W, H, pngPath);

        const texture = await loadImageTexture(device, pngPath, {
            label: "roundtrip",
            colorSpace: ImageColorSpace.Linear, // rgba8unorm — raw bytes, readable back 1:1
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
        });

        expect(texture.width).toBe(W);
        expect(texture.height).toBe(H);
        expect(texture.format).toBe("rgba8unorm");

        // Read the uploaded texture back and compare byte-for-byte. This proves
        // the decode + wgpu upload preserved channel order (R,G,B,A) and every
        // pixel, with no stride corruption.
        const readback = await readTexturePixels(device, texture);
        await savePixelsToFile(readback, W, H, `${OUT_DIR}/roundtrip-output.png`);
        expect(readback.length).toBe(original.length);
        expect(Array.from(readback)).toEqual(Array.from(original));

        texture.destroy();
    });

    it("honours the sRGB colour space option", async () => {
        if (!device) return;
        const pngPath = `${OUT_DIR}/roundtrip-input.png`; // written by the test above
        const texture = await loadImageTexture(device, pngPath, { colorSpace: ImageColorSpace.Srgb });
        expect(texture.format).toBe("rgba8unorm-srgb");
        texture.destroy();
    });

    it("defaults to sRGB when no colour space is given", async () => {
        if (!device) return;
        const pngPath = `${OUT_DIR}/roundtrip-input.png`;
        const texture = await loadImageTexture(device, pngPath);
        expect(texture.format).toBe("rgba8unorm-srgb");
        texture.destroy();
    });

    it("rejects with a decode error when the file does not exist", async () => {
        if (!device) return;
        await expect(loadImageTexture(device, `${OUT_DIR}/does-not-exist.png`)).rejects.toThrow(/failed to open/);
    });
});
