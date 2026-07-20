// Coverage for the formats gained when SDL3_image was replaced by the pure-Rust
// `image` crate: TGA, JPEG and Radiance HDR. (PNG is covered by image.test.ts
// and image-16bit.test.ts.)
//
// TGA and HDR fixtures are generated inline rather than committed, so the exact
// bytes going in are visible next to the values asserted coming out — both are
// simple enough to write by hand. JPEG is not, so `assets/solid-halves.jpg` is a
// committed fixture (16x16, red top half / blue bottom half, quality 100).
//
// The HDR case is the one that matters most structurally: it is the only format
// here that does *not* produce an rgba8 texture. Radiance carries linear
// radiance outside [0,1], so it loads as `rgba16float` and `colorSpace` is
// ignored — the "output is always RGBA8" invariant that held under SDL3_image is
// gone, and these tests pin its replacement.
import { beforeAll, describe, expect, it } from "bun:test";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    type GpuDevice,
    GPUBufferUsage,
    GPUMapMode,
    GPUTextureUsage,
    ImageColorSpace,
    loadImageTexture,
    requestAdapter,
} from "../index.js";

let device: GpuDevice | null = null;

beforeAll(async () => {
    const adapter = await requestAdapter();
    if (adapter) {
        device = await adapter.requestDevice({label: "image-formats-test"});
    }
});

/**
 * Writes an uncompressed 32-bit TGA (image type 2). TGA stores pixels
 * **bottom-up and BGRA** unless told otherwise, so bit 5 of the descriptor byte
 * is set to flag top-down — if the decoder ignored either convention the
 * assertions below would see swapped channels or a vertically flipped image.
 */
function writeTga(path: string, w: number, h: number, bgra: (x: number, y: number) => [number, number, number, number]) {
    const header = new Uint8Array(18);
    header[2] = 2; // uncompressed true-colour
    header[12] = w & 0xff;
    header[13] = (w >> 8) & 0xff;
    header[14] = h & 0xff;
    header[15] = (h >> 8) & 0xff;
    header[16] = 32; // bits per pixel
    header[17] = 0x28; // 8 alpha bits + top-down origin
    const body = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const [b, g, r, a] = bgra(x, y);
            const o = (y * w + x) * 4;
            body[o] = b;
            body[o + 1] = g;
            body[o + 2] = r;
            body[o + 3] = a;
        }
    }
    writeFileSync(path, Buffer.concat([header, body]));
}

/**
 * Writes a Radiance HDR with flat (non-RLE) RGBE scanlines.
 *
 * RGBE packs a shared exponent: `value = mantissa / 256 * 2^(e - 128)`. Picking
 * `e = 128` makes that simply `mantissa / 256`, and `e = 129` doubles it — which
 * is how the >1.0 sample below is built, since representing values above 1 is
 * the entire reason this format is supported.
 *
 * A scanline whose first byte is 2 would be read as RLE-encoded; every mantissa
 * here is far above 2, so these are unambiguously flat scanlines.
 */
function writeHdr(path: string, w: number, h: number, rgbe: (x: number, y: number) => [number, number, number, number]) {
    const header = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`, "ascii");
    const body = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const [r, g, b, e] = rgbe(x, y);
            const o = (y * w + x) * 4;
            body[o] = r;
            body[o + 1] = g;
            body[o + 2] = b;
            body[o + 3] = e;
        }
    }
    writeFileSync(path, Buffer.concat([header, body]));
}

/** Reads back the first `count` texels as raw bytes. `bpp` is bytes per pixel. */
async function readTexels(path: string, srgb: boolean, bpp: number, count: number) {
    const tex = await loadImageTexture(device!, path, {
        colorSpace: srgb ? ImageColorSpace.Srgb : ImageColorSpace.Linear,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    });
    const w = tex.width;
    const h = tex.height;
    const padded = Math.ceil((w * bpp) / 256) * 256;
    const buf = device!.createBuffer({size: padded * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
    const enc = device!.createCommandEncoder();
    enc.copyTextureToBuffer({texture: tex}, {buffer: buf, bytesPerRow: padded, rowsPerImage: h}, {width: w, height: h, depthOrArrayLayers: 1});
    device!.queue.submit([enc.finish()]);
    await device!.queue.onSubmittedWorkDone();
    await buf.mapAsync(GPUMapMode.READ);
    const m = buf.getMappedRange();
    // Row 0, plus the first texel of row 1 (at `padded`) for row-order checks.
    const first = new Uint8Array(m.subarray(0, count * bpp));
    const secondRow = new Uint8Array(m.subarray(padded, padded + bpp));
    const out = {first, secondRow, width: w, height: h, format: tex.format, rowPitch: padded};
    buf.unmap();
    buf.destroy();
    return out;
}

/** Decodes an IEEE half float from two little-endian bytes. */
function f16(lo: number, hi: number): number {
    const bits = (hi << 8) | lo;
    const sign = bits & 0x8000 ? -1 : 1;
    const exp = (bits >> 10) & 0x1f;
    const frac = bits & 0x3ff;
    if (exp === 0) return sign * frac * 2 ** -24;
    if (exp === 31) return frac ? NaN : sign * Infinity;
    return sign * (1 + frac / 1024) * 2 ** (exp - 15);
}

describe("image formats", () => {
    it("decodes TGA, honouring BGRA order and the top-down flag", async () => {
        if (!device) return;
        const path = join(tmpdir(), `metis-fmt-${process.pid}.tga`);
        // Row 0 red, row 1 green — distinct channels *and* distinct rows, so a
        // channel swap and a vertical flip are separately detectable.
        writeTga(path, 4, 2, (_x, y) => (y === 0 ? [0, 0, 255, 255] : [0, 255, 0, 255]));
        try {
            const {first, secondRow, width, height, format} = await readTexels(path, false, 4, 1);
            expect(width).toBe(4);
            expect(height).toBe(2);
            expect(format).toBe("rgba8unorm");
            expect(Array.from(first)).toEqual([255, 0, 0, 255]); // red, not blue
            expect(Array.from(secondRow)).toEqual([0, 255, 0, 255]); // green, not flipped
        } finally {
            try { unlinkSync(path); } catch { /* best effort */ }
        }
    }, 60_000);

    it("decodes JPEG", async () => {
        if (!device) return;
        const path = join(import.meta.dir, "assets", "solid-halves.jpg");
        const {first, width, height, format} = await readTexels(path, false, 4, 1);
        expect(width).toBe(16);
        expect(height).toBe(16);
        expect(format).toBe("rgba8unorm");
        // Lossy, but these are flat 8x8-aligned blocks at quality 100, so ringing
        // is minimal. Generous tolerance: the point is "decoded, right channels,
        // not swapped", not codec fidelity.
        expect(first[0]).toBeGreaterThan(170);
        expect(first[1]).toBeLessThan(100);
        expect(first[2]).toBeLessThan(100);
        expect(first[3]).toBe(255);
    }, 60_000);

    it("respects colorSpace for 8-bit sources", async () => {
        if (!device) return;
        const path = join(tmpdir(), `metis-fmt-srgb-${process.pid}.tga`);
        writeTga(path, 2, 2, () => [0, 0, 255, 255]);
        try {
            const linear = await readTexels(path, false, 4, 1);
            const srgb = await readTexels(path, true, 4, 1);
            expect(linear.format).toBe("rgba8unorm");
            expect(srgb.format).toBe("rgba8unorm-srgb");
            // Same stored bytes either way — the difference is how the GPU
            // interprets them on sample, not what gets uploaded.
            expect(Array.from(srgb.first)).toEqual(Array.from(linear.first));
        } finally {
            try { unlinkSync(path); } catch { /* best effort */ }
        }
    }, 60_000);

    it("decodes Radiance HDR to rgba16float, preserving values above 1.0", async () => {
        if (!device) return;
        const path = join(tmpdir(), `metis-fmt-${process.pid}.hdr`);
        // e=128 => mantissa/256. 128 -> 0.5. e=129 doubles it: 128 -> 1.0,
        // and 255 -> ~1.996, which is the >1.0 sample 8-bit formats would clip.
        writeHdr(path, 4, 2, (_x, y) => (y === 0 ? [128, 64, 32, 128] : [255, 128, 64, 129]));
        try {
            const {first, secondRow, width, height, format} = await readTexels(path, false, 8, 1);
            expect(width).toBe(4);
            expect(height).toBe(2);
            expect(format).toBe("rgba16float");

            const px0 = [0, 1, 2].map((i) => f16(first[i * 2]!, first[i * 2 + 1]!));
            expect(px0[0]).toBeCloseTo(0.5, 2);
            expect(px0[1]).toBeCloseTo(0.25, 2);
            expect(px0[2]).toBeCloseTo(0.125, 2);

            // The load-bearing assertion: this exceeds 1.0 and survives.
            const px1 = [0, 1, 2].map((i) => f16(secondRow[i * 2]!, secondRow[i * 2 + 1]!));
            expect(px1[0]).toBeGreaterThan(1.9);
            expect(px1[1]).toBeCloseTo(1.0, 2);
            expect(px1[2]).toBeCloseTo(0.5, 2);
        } finally {
            try { unlinkSync(path); } catch { /* best effort */ }
        }
    }, 60_000);

    it("ignores colorSpace for HDR — there is no -srgb float format", async () => {
        if (!device) return;
        const path = join(tmpdir(), `metis-fmt-hdr-srgb-${process.pid}.hdr`);
        writeHdr(path, 2, 2, () => [128, 128, 128, 128]);
        try {
            const linear = await readTexels(path, false, 8, 1);
            const srgb = await readTexels(path, true, 8, 1);
            expect(linear.format).toBe("rgba16float");
            expect(srgb.format).toBe("rgba16float");
            expect(Array.from(srgb.first)).toEqual(Array.from(linear.first));
        } finally {
            try { unlinkSync(path); } catch { /* best effort */ }
        }
    }, 60_000);

    it("sniffs format from content for formats that have a signature", async () => {
        if (!device) return;
        // Radiance starts with "#?RADIANCE", so a misnamed .png still loads.
        const path = join(tmpdir(), `metis-fmt-liar-${process.pid}.png`);
        writeHdr(path, 2, 2, () => [128, 128, 128, 128]);
        try {
            const {format} = await readTexels(path, false, 8, 1);
            expect(format).toBe("rgba16float");
        } finally {
            try { unlinkSync(path); } catch { /* best effort */ }
        }
    }, 60_000);

    // Pins a real limitation so it isn't rediscovered as a bug: TGA is the one
    // supported format with **no magic bytes** (the TGA 2.0 "TRUEVISION-XFILE"
    // footer is optional and absent here), so content sniffing cannot identify
    // it and the loader falls back to the file extension. A TGA named .png is
    // therefore a decode error, while a PNG/JPEG/HDR named anything at all
    // loads fine. If a future decoder swap makes this pass, the docs in
    // src/image/mod.rs need updating to match.
    it("cannot sniff TGA — it has no signature, so the extension must be right", async () => {
        if (!device) return;
        const path = join(tmpdir(), `metis-fmt-tga-liar-${process.pid}.png`);
        writeTga(path, 2, 2, () => [0, 0, 255, 255]);
        try {
            await expect(readTexels(path, false, 4, 1)).rejects.toThrow(/failed to decode/);
        } finally {
            try { unlinkSync(path); } catch { /* best effort */ }
        }
    }, 60_000);
});
