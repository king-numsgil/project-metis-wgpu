import { inflateSync } from "node:zlib";

/**
 * A from-scratch PNG decoder — the inverse of the PNG *encoder* already
 * hand-rolled in bun-webgpu-rs/tests/helpers/screenshot.ts (same chunk
 * format, same zlib wrapping), written here rather than pulled in as a
 * dependency since it has zero interaction with the WebGPU compatibility
 * concerns that rule out other libraries for this stack.
 *
 * Supports: color type 0 (grayscale), 2 (RGB), 4 (grayscale+alpha), 6
 * (RGBA); bit depth 8 or 16 (16-bit samples are downsampled to 8-bit by
 * taking the high byte — plenty of precision for albedo/normal/roughness
 * maps); no interlacing (Adam7); no palettes (color type 3).
 */
export interface DecodedImage {
    width: number;
    height: number;
    /** Tight RGBA8, 4 bytes per pixel. */
    pixels: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CHANNELS_FOR_COLOR_TYPE: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

function paeth(a: number, b: number, c: number): number {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
}

export function decodePng(bytes: Uint8Array): DecodedImage {
    for (let i = 0; i < SIGNATURE.length; i++) {
        if (bytes[i] !== SIGNATURE[i]) throw new Error("decodePng: not a PNG file (bad signature)");
    }

    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    const idatChunks: Uint8Array[] = [];

    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    while (offset < bytes.length) {
        const length = dv.getUint32(offset, false);
        const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!);
        const dataStart = offset + 8;
        const data = bytes.subarray(dataStart, dataStart + length);

        if (type === "IHDR") {
            width = dv.getUint32(dataStart, false);
            height = dv.getUint32(dataStart + 4, false);
            bitDepth = data[8]!;
            colorType = data[9]!;
            const compressionMethod = data[10]!;
            const interlaceMethod = data[12]!;
            if (compressionMethod !== 0) throw new Error("decodePng: unsupported compression method");
            if (interlaceMethod !== 0) throw new Error("decodePng: interlaced PNGs are not supported");
        } else if (type === "IDAT") {
            idatChunks.push(data);
        } else if (type === "IEND") {
            break;
        }

        offset = dataStart + length + 4; // skip CRC
    }

    if (colorType === 3) throw new Error("decodePng: palette (color type 3) PNGs are not supported");
    const channels = CHANNELS_FOR_COLOR_TYPE[colorType];
    if (!channels) throw new Error(`decodePng: unsupported color type ${colorType}`);
    if (bitDepth !== 8 && bitDepth !== 16) throw new Error(`decodePng: unsupported bit depth ${bitDepth}`);

    const totalIdat = new Uint8Array(idatChunks.reduce((n, c) => n + c.length, 0));
    let idatOffset = 0;
    for (const chunk of idatChunks) {
        totalIdat.set(chunk, idatOffset);
        idatOffset += chunk.length;
    }
    const inflated = inflateSync(totalIdat);

    const bytesPerSample = bitDepth === 16 ? 2 : 1;
    const bpp = channels * bytesPerSample;
    const rowBytes = width * bpp;
    const raw = new Uint8Array(height * rowBytes);

    let src = 0;
    let priorRowStart = -1;
    for (let y = 0; y < height; y++) {
        const filterType = inflated[src]!;
        src += 1;
        const rowStart = y * rowBytes;
        for (let x = 0; x < rowBytes; x++) {
            const filtByte = inflated[src + x]!;
            const a = x >= bpp ? raw[rowStart + x - bpp]! : 0;
            const b = priorRowStart >= 0 ? raw[priorRowStart + x]! : 0;
            const c = priorRowStart >= 0 && x >= bpp ? raw[priorRowStart + x - bpp]! : 0;
            let value: number;
            switch (filterType) {
                case 0:
                    value = filtByte;
                    break;
                case 1:
                    value = filtByte + a;
                    break;
                case 2:
                    value = filtByte + b;
                    break;
                case 3:
                    value = filtByte + Math.floor((a + b) / 2);
                    break;
                case 4:
                    value = filtByte + paeth(a, b, c);
                    break;
                default:
                    throw new Error(`decodePng: unknown filter type ${filterType}`);
            }
            raw[rowStart + x] = value & 0xff;
        }
        src += rowBytes;
        priorRowStart = rowStart;
    }

    const pixels = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        const base = i * bpp;
        const sample = (c: number) => raw[base + c * bytesPerSample]!; // high byte of a 16-bit sample, or the 8-bit sample directly
        let r: number;
        let g: number;
        let b: number;
        let a: number;
        switch (colorType) {
            case 0:
                r = g = b = sample(0);
                a = 255;
                break;
            case 2:
                r = sample(0);
                g = sample(1);
                b = sample(2);
                a = 255;
                break;
            case 4:
                r = g = b = sample(0);
                a = sample(1);
                break;
            default:
                r = sample(0);
                g = sample(1);
                b = sample(2);
                a = sample(3);
                break;
        }
        pixels[i * 4 + 0] = r;
        pixels[i * 4 + 1] = g;
        pixels[i * 4 + 2] = b;
        pixels[i * 4 + 3] = a;
    }

    return { width, height, pixels };
}
