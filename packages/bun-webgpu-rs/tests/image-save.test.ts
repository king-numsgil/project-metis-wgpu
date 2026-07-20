// The write half of `image/`: readTexturePixels, savePixelsToFile,
// saveTextureToFile. These replaced a hand-rolled TS PNG encoder that was
// PNG-only and rgba8unorm-only, so the cases worth pinning are the ones it
// could never do — BGRA swizzling and HDR output — plus the guards that keep a
// wrong-format save from silently producing garbage.
//
// Correctness is asserted by **round-tripping through the loader**: save, load
// back, compare bytes. That closes the loop on both halves at once, and a
// channel-order or stride bug in either shows up as a byte mismatch rather than
// an image that merely looks plausible.
import { beforeAll, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    type GpuDevice,
    GPUBufferUsage,
    GPUMapMode,
    GPUTextureUsage,
    ImageColorSpace,
    loadImageTexture,
    readTexturePixels,
    requestAdapter,
    savePixelsToFile,
    saveTextureToFile,
} from "../index.js";

let device: GpuDevice | null = null;

beforeAll(async () => {
    const adapter = await requestAdapter();
    if (adapter) {
        device = await adapter.requestDevice({label: "image-save-test"});
    }
});

const OUT = join(tmpdir(), `metis-save-${process.pid}`);
const RW = GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING;

/** A 4x2 pattern where every channel of every pixel is distinct. */
function knownRgba(w: number, h: number): Uint8Array {
    const px = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
        px[i * 4] = (i * 17 + 3) & 0xff;
        px[i * 4 + 1] = (i * 29 + 71) & 0xff;
        px[i * 4 + 2] = (i * 43 + 137) & 0xff;
        px[i * 4 + 3] = 255;
    }
    return px;
}

function makeTexture(w: number, h: number, format: string, bytes: Uint8Array, bpp = 4) {
    const tex = device!.createTexture({size: {width: w, height: h}, format: format as never, usage: RW});
    device!.queue.writeTexture({texture: tex}, bytes, {bytesPerRow: w * bpp}, {width: w, height: h});
    return tex;
}

/** Reads an rgba16float texture directly — `readTexturePixels` refuses f16 by design. */
async function readF16(tex: {width: number; height: number}, texture: never) {
    const bpr = Math.ceil((tex.width * 8) / 256) * 256;
    const buf = device!.createBuffer({size: bpr * tex.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
    const enc = device!.createCommandEncoder();
    enc.copyTextureToBuffer({texture}, {buffer: buf, bytesPerRow: bpr, rowsPerImage: tex.height}, {width: tex.width, height: tex.height});
    device!.queue.submit([enc.finish()]);
    await device!.queue.onSubmittedWorkDone();
    await buf.mapAsync(GPUMapMode.READ);
    const m = new Uint8Array(buf.getMappedRange()).slice(0, tex.width * 8);
    buf.unmap();
    buf.destroy();
    const out: number[] = [];
    for (let i = 0; i < tex.width * 4; i++) {
        const bits = m[i * 2]! | (m[i * 2 + 1]! << 8);
        const exp = (bits >> 10) & 0x1f;
        const frac = bits & 0x3ff;
        const sign = bits & 0x8000 ? -1 : 1;
        out.push(exp === 0 ? sign * frac * 2 ** -24 : sign * (1 + frac / 1024) * 2 ** (exp - 15));
    }
    return out;
}

describe("texture readback and image saving", () => {
    it("reads back tight RGBA8 with no row padding", async () => {
        if (!device) return;
        // Width 4 => 16 tight bytes/row, well under the 256-byte GPU row
        // alignment, so a failure to strip padding is immediately visible.
        const [W, H] = [4, 2];
        const src = knownRgba(W, H);
        const tex = makeTexture(W, H, "rgba8unorm", src);
        const px = await readTexturePixels(device, tex);
        expect(px.length).toBe(W * H * 4);
        expect(Array.from(px)).toEqual(Array.from(src));
        tex.destroy();
    }, 60_000);

    it("round-trips pixels through savePixelsToFile and back", async () => {
        if (!device) return;
        const [W, H] = [4, 2];
        const src = knownRgba(W, H);
        const path = join(OUT, "nested", "pixels.png");
        await savePixelsToFile(src, W, H, path);

        const tex = await loadImageTexture(device, path, {
            colorSpace: ImageColorSpace.Linear, // rgba8unorm — readable back 1:1
            usage: RW,
        });
        expect(tex.width).toBe(W);
        expect(tex.height).toBe(H);
        const px = await readTexturePixels(device, tex);
        expect(Array.from(px)).toEqual(Array.from(src));
        tex.destroy();
    }, 60_000);

    it("round-trips a texture through saveTextureToFile and back", async () => {
        if (!device) return;
        const [W, H] = [4, 2];
        const src = knownRgba(W, H);
        const tex = makeTexture(W, H, "rgba8unorm", src);
        const path = join(OUT, "texture.png");
        await saveTextureToFile(device, tex, path);

        const back = await loadImageTexture(device, path, {colorSpace: ImageColorSpace.Linear, usage: RW});
        const px = await readTexturePixels(device, back);
        expect(Array.from(px)).toEqual(Array.from(src));
        tex.destroy();
        back.destroy();
    }, 60_000);

    // The old TS helper could not read BGRA at all, which is why RenderContext
    // still renders into a separate rgba8unorm capture texture. A swapchain
    // texture is bgra8unorm on most backends, so this is the case that makes
    // saving one directly possible.
    it("swizzles bgra8unorm to RGBA on readback", async () => {
        if (!device) return;
        const [W, H] = [2, 1];
        // Stored BGRA: B=10 G=20 R=30 A=255 -> must read back as R=30 G=20 B=10.
        const bgra = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]);
        const tex = makeTexture(W, H, "bgra8unorm", bgra);
        const px = await readTexturePixels(device, tex);
        expect(Array.from(px)).toEqual([30, 20, 10, 255, 60, 50, 40, 255]);
        tex.destroy();
    }, 60_000);

    it("saves rgba16float as Radiance HDR, preserving values above 1.0", async () => {
        if (!device) return;
        const [W, H] = [2, 1];
        // Exact f16 bit patterns: 0.5=0x3800, 1.0=0x3C00, 2.0=0x4000, 4.0=0x4400.
        const f16 = (v: number) => new Uint8Array([v & 0xff, v >> 8]);
        const texels = new Uint8Array([
            ...f16(0x3800), ...f16(0x3c00), ...f16(0x4000), ...f16(0x3c00), // 0.5, 1, 2, a=1
            ...f16(0x4400), ...f16(0x3800), ...f16(0x3c00), ...f16(0x3c00), // 4, 0.5, 1, a=1
        ]);
        const tex = makeTexture(W, H, "rgba16float", texels, 8);
        const path = join(OUT, "radiance.hdr");
        await saveTextureToFile(device, tex, path);

        expect(existsSync(path)).toBe(true);
        // Radiance signature — proves it really wrote that container.
        expect(readFileSync(path).subarray(0, 10).toString("ascii")).toBe("#?RADIANCE");

        const back = await loadImageTexture(device, path, {usage: RW});
        expect(back.format).toBe("rgba16float");
        expect(back.width).toBe(W);
        const vals = await readF16(back, back as never);
        // RGBE is a shared-exponent format, so values are approximate — but 2.0
        // and 4.0 surviving at all is the point: 8-bit output would clip both.
        expect(vals[0]).toBeCloseTo(0.5, 1);
        expect(vals[1]).toBeCloseTo(1.0, 1);
        expect(vals[2]).toBeCloseTo(2.0, 1);
        expect(vals[4]).toBeCloseTo(4.0, 1);
        tex.destroy();
        back.destroy();
    }, 60_000);

    it("writes jpeg and tga from the path extension", async () => {
        if (!device) return;
        const [W, H] = [8, 8];
        const tex = makeTexture(W, H, "rgba8unorm", knownRgba(W, H));
        for (const ext of ["jpg", "tga"]) {
            const path = join(OUT, `out.${ext}`);
            await saveTextureToFile(device, tex, path);
            expect(existsSync(path)).toBe(true);
            // Loading it back proves the bytes are a valid file of that format.
            const back = await loadImageTexture(device, path, {colorSpace: ImageColorSpace.Linear, usage: RW});
            expect(back.width).toBe(W);
            expect(back.height).toBe(H);
            back.destroy();
        }
        tex.destroy();
    }, 60_000);

    describe("guards", () => {
        it("rejects a texture without COPY_SRC", async () => {
            if (!device) return;
            const tex = device.createTexture({
                size: {width: 2, height: 2},
                format: "rgba8unorm",
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            });
            await expect(readTexturePixels(device, tex)).rejects.toThrow(/COPY_SRC/);
            tex.destroy();
        }, 60_000);

        it("rejects an unsupported output extension", async () => {
            if (!device) return;
            const tex = makeTexture(2, 2, "rgba8unorm", knownRgba(2, 2));
            await expect(saveTextureToFile(device, tex, join(OUT, "x.gif"))).rejects.toThrow(/unsupported output extension/);
            tex.destroy();
        }, 60_000);

        it("rejects 8-bit -> .hdr (no high-dynamic-range data to write)", async () => {
            if (!device) return;
            const tex = makeTexture(2, 2, "rgba8unorm", knownRgba(2, 2));
            await expect(saveTextureToFile(device, tex, join(OUT, "x.hdr"))).rejects.toThrow(/source is 8-bit/);
            tex.destroy();
        }, 60_000);

        it("rejects rgba16float -> .png, and f16 pixel readback", async () => {
            if (!device) return;
            const tex = makeTexture(1, 1, "rgba16float", new Uint8Array(8), 8);
            await expect(saveTextureToFile(device, tex, join(OUT, "x.png"))).rejects.toThrow(/only be written as \.hdr/);
            // Reinterpreting f16 bytes as 8-bit colour would be silently wrong,
            // so it is refused rather than guessed at.
            await expect(readTexturePixels(device, tex)).rejects.toThrow(/rgba16float/);
            tex.destroy();
        }, 60_000);
    });

    it("creates missing parent directories", async () => {
        if (!device) return;
        const path = join(OUT, "deep", "deeper", "made.png");
        rmSync(join(OUT, "deep"), {recursive: true, force: true});
        await savePixelsToFile(knownRgba(2, 2), 2, 2, path);
        expect(existsSync(path)).toBe(true);
    }, 60_000);
});
