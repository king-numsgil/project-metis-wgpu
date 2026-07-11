import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { deflateSync } from "node:zlib";
import { GPUBufferUsage, type GpuDevice, GPUMapMode, type GpuTexture } from "../../index.js";

// ── CRC32 ─────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        t[i] = c;
    }
    return t;
})();

function crc32(buf: Uint8Array): number {
    let c = 0xffffffff;
    for (const b of buf) {
        c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}

// ── PNG encoder ───────────────────────────────────────────────────────────────

function u32be(n: number): Uint8Array {
    const v = new DataView(new ArrayBuffer(4));
    v.setUint32(0, n, false);
    return new Uint8Array(v.buffer);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
    const typeBytes = new TextEncoder().encode(type);
    const body = new Uint8Array(4 + data.length);
    body.set(typeBytes);
    body.set(data, 4);
    const out = new Uint8Array(4 + 4 + data.length + 4);
    out.set(u32be(data.length));
    out.set(body, 4);
    out.set(u32be(crc32(body)), 8 + data.length);
    return out;
}

// Encodes tight RGBA bytes (no row padding) into a PNG.
export function encodePng(pixels: Uint8Array, width: number, height: number): Uint8Array {
    const rowBytes = width * 4;
    // Prepend filter byte 0 (None) to each scanline — required by PNG spec.
    const filtered = new Uint8Array(height * (rowBytes + 1));
    for (let y = 0; y < height; y++) {
        filtered[y * (rowBytes + 1)] = 0;
        filtered.set(pixels.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1);
    }

    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, width, false);
    dv.setUint32(4, height, false);
    dv.setUint8(8, 8); // bit depth
    dv.setUint8(9, 6); // colour type RGBA

    const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const chunks = [
        sig,
        pngChunk("IHDR", ihdr),
        pngChunk("IDAT", deflateSync(filtered)), // zlib-wrapped (RFC 1950) as PNG requires
        pngChunk("IEND", new Uint8Array(0)),
    ];

    const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let off = 0;
    for (const c of chunks) {
        out.set(c, off);
        off += c.length;
    }
    return out;
}

// ── GPU texture readback ──────────────────────────────────────────────────────

// Copies an rgba8unorm texture to CPU and returns tight RGBA bytes (no GPU row padding).
async function readbackTexture(
    device: GpuDevice,
    texture: GpuTexture,
    width: number,
    height: number,
): Promise<Uint8Array> {
    const rowBytes = width * 4;
    // copyTextureToBuffer requires bytesPerRow to be a multiple of 256.
    const alignedBytesPerRow = Math.ceil(rowBytes / 256) * 256;
    const bufferSize = alignedBytesPerRow * height;

    const readbackBuf = device.createBuffer({
        size: bufferSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer(
        {texture},
        {buffer: readbackBuf, bytesPerRow: alignedBytesPerRow},
        {width, height},
    );
    device.queue.submit([encoder.finish()]);

    await readbackBuf.mapAsync(GPUMapMode.READ);
    const raw = readbackBuf.getMappedRange();

    // Strip per-row padding if the aligned stride is wider than the pixel data.
    let pixels: Uint8Array;
    if (alignedBytesPerRow === rowBytes) {
        pixels = raw.slice(0, rowBytes * height); // no padding: straight copy
    } else {
        pixels = new Uint8Array(rowBytes * height);
        for (let y = 0; y < height; y++) {
            pixels.set(
                raw.subarray(y * alignedBytesPerRow, y * alignedBytesPerRow + rowBytes),
                y * rowBytes,
            );
        }
    }

    readbackBuf.unmap();
    readbackBuf.destroy();
    return pixels;
}

// Reads back texture pixels, encodes them as PNG, writes to path, and returns
// the raw RGBA pixels so callers can inspect individual pixel values directly.
export async function takeScreenshot(
    device: GpuDevice,
    texture: GpuTexture,
    width: number,
    height: number,
    path: string,
): Promise<Uint8Array> {
    const pixels = await readbackTexture(device, texture, width, height);
    mkdirSync(dirname(path), {recursive: true});
    await Bun.write(path, encodePng(pixels, width, height))
    return pixels
}
