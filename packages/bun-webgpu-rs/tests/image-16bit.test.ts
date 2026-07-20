// 16-bit-per-channel PNGs must decode to the correct 8-bit values.
//
// Regression test for a platform-specific corruption: SDL3_image decodes a
// 16-bit PNG into a 16-bit surface keeping PNG's **big-endian** sample order,
// while SDL's pixel conversion reads those formats in **host** order. On a
// little-endian host every sample was therefore down-converted from the wrong
// byte — a sample of 0x5aec read as 0xec5a, scaling to 235 instead of 90 — so
// textures came out as plausible-looking noise rather than failing outright.
//
// It only reproduced where SDL_image has a 16-bit-capable PNG decoder (Linux),
// which is exactly why it needs a test rather than a manual check: on a machine
// whose SDL_image hands back 8-bit surfaces this passes without exercising the
// swap at all, and would silently stop protecting anything if it relied on a
// downloaded asset that isn't 16-bit.
import { beforeAll, describe, expect, it } from "bun:test";
import { deflateSync } from "node:zlib";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    type GpuDevice,
    GPUBufferUsage,
    GPUMapMode,
    GPUTextureUsage,
    ImageColorSpace,
    requestAdapter,
    sdlImageLoadTexture,
} from "../index.js";

let device: GpuDevice | null = null;

beforeAll(async () => {
    const adapter = await requestAdapter();
    if (adapter) {
        device = await adapter.requestDevice({label: "image-16bit-test"});
    }
});

function crc32(buf: Uint8Array): number {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
        c ^= buf[i]!;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
        }
    }
    return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) {
        out[4 + i] = type.charCodeAt(i);
    }
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
}

/**
 * Writes a `size`x`size` 16-bit RGB PNG where every sample's **high** byte is
 * distinct from its low byte, so a byte-order mistake cannot accidentally
 * produce the right answer.
 */
function write16BitPng(path: string, size: number): {r: number; g: number; b: number} {
    // High bytes are what an 8-bit down-convert must keep; low bytes are decoys.
    const hi = {r: 0x5a, g: 0x50, b: 0x45};
    const lo = {r: 0xec, g: 0x95, b: 0xe6};
    const stride = size * 6;
    const raw = new Uint8Array((stride + 1) * size);
    for (let y = 0; y < size; y++) {
        const row = y * (stride + 1);
        raw[row] = 0; // filter: none
        for (let x = 0; x < size; x++) {
            const o = row + 1 + x * 6;
            raw[o] = hi.r;
            raw[o + 1] = lo.r;
            raw[o + 2] = hi.g;
            raw[o + 3] = lo.g;
            raw[o + 4] = hi.b;
            raw[o + 5] = lo.b;
        }
    }
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, size);
    dv.setUint32(4, size);
    ihdr[8] = 16; // bit depth
    ihdr[9] = 2; // colour type: RGB
    const png = new Uint8Array([
        ...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
        ...chunk("IHDR", ihdr),
        ...chunk("IDAT", new Uint8Array(deflateSync(raw))),
        ...chunk("IEND", new Uint8Array(0)),
    ]);
    writeFileSync(path, png);
    return hi;
}

async function readBack(path: string, srgb: boolean) {
    const tex = await sdlImageLoadTexture(device!, path, {
        colorSpace: srgb ? ImageColorSpace.Srgb : ImageColorSpace.Linear,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    });
    const w = tex.width;
    const h = tex.height;
    const padded = Math.ceil((w * 4) / 256) * 256;
    const buf = device!.createBuffer({size: padded * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
    const enc = device!.createCommandEncoder();
    enc.copyTextureToBuffer({texture: tex}, {buffer: buf, bytesPerRow: padded, rowsPerImage: h}, {width: w, height: h, depthOrArrayLayers: 1});
    device!.queue.submit([enc.finish()]);
    await device!.queue.onSubmittedWorkDone();
    await buf.mapAsync(GPUMapMode.READ);
    const m = buf.getMappedRange();
    const px = Array.from(m.subarray(0, 8));
    buf.unmap();
    buf.destroy();
    return px;
}

describe("16-bit PNG decoding", () => {
    it("keeps the high byte of each 16-bit sample", async () => {
        if (!device) {
            return;
        }
        const path = join(tmpdir(), `metis-16bit-${process.pid}.png`);
        const hi = write16BitPng(path, 8);
        try {
            const px = await readBack(path, false);
            // Tolerance of 1: SDL scales (v * 255 / 65535) rather than truncating,
            // so the high byte can land one off. A byte-order bug is off by ~145,
            // nowhere near this.
            expect(px[0]).toBeGreaterThanOrEqual(hi.r - 1);
            expect(px[0]).toBeLessThanOrEqual(hi.r + 1);
            expect(px[1]).toBeGreaterThanOrEqual(hi.g - 1);
            expect(px[1]).toBeLessThanOrEqual(hi.g + 1);
            expect(px[2]).toBeGreaterThanOrEqual(hi.b - 1);
            expect(px[2]).toBeLessThanOrEqual(hi.b + 1);
            expect(px[3]).toBe(255); // opaque
        } finally {
            try {
                unlinkSync(path);
            } catch {
                /* best effort */
            }
        }
    }, 60_000);

    it("decodes uniformly — every pixel identical, no row skew", async () => {
        if (!device) {
            return;
        }
        // A wrong pitch or stride shows up as pixel 1 differing from pixel 0
        // even though the source image is a flat colour.
        const path = join(tmpdir(), `metis-16bit-flat-${process.pid}.png`);
        write16BitPng(path, 8);
        try {
            const px = await readBack(path, false);
            expect(px.slice(4, 8)).toEqual(px.slice(0, 4));
        } finally {
            try {
                unlinkSync(path);
            } catch {
                /* best effort */
            }
        }
    }, 60_000);
});
