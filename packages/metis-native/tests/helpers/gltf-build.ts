// Builds glTF 2.0 fixtures byte by byte, in a temp directory.
//
// Same reasoning as `image-ktx2.test.ts`'s inline KTX2 writer: the interesting
// cases for an importer are the ones no exporter emits on request — a
// `byteStride` that interleaves two attributes, a sparse accessor, `UNSIGNED_BYTE`
// indices, a `TRIANGLE_FAN`, a `data:` URI, a GLB binary chunk. Writing them here
// puts the exact bytes going in next to the values asserted coming out, and
// keeps the suite free of committed binaries whose contents nobody can read.
//
// The Khronos sample assets are the other tier, in `gltf-samples.test.ts`: real
// exporter output, downloaded and cached, to check this tier's assumptions
// against files that were not written to make these tests pass.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A scratch directory that lives for the process; fixtures are written into it. */
export const FIXTURE_DIR = mkdtempSync(join(tmpdir(), "metis-gltf-"));

export const F32 = 5126;
export const U8 = 5121;
export const U16 = 5123;
export const U32 = 5125;
export const I16 = 5122;

export function f32Bytes(values: number[]): Uint8Array {
    return new Uint8Array(Float32Array.from(values).buffer);
}

export function u16Bytes(values: number[]): Uint8Array {
    return new Uint8Array(Uint16Array.from(values).buffer);
}

export function u32Bytes(values: number[]): Uint8Array {
    return new Uint8Array(Uint32Array.from(values).buffer);
}

/** Concatenate, padding each part out to a 4-byte boundary (glTF's alignment rule). */
export function concatAligned(...parts: Uint8Array[]): { bytes: Uint8Array; offsets: number[] } {
    const offsets: number[] = [];
    let total = 0;
    for (const p of parts) {
        offsets.push(total);
        total += Math.ceil(p.byteLength / 4) * 4;
    }
    const bytes = new Uint8Array(total);
    parts.forEach((p, i) => bytes.set(p, offsets[i]!));
    return {bytes, offsets};
}

let counter = 0;

/** Write a `.gltf` plus a sibling `.bin`, and return the `.gltf` path. */
export function writeGltf(json: Record<string, unknown>, bin?: Uint8Array): string {
    const name = `fixture-${counter++}`;
    if (bin) {
        writeFileSync(join(FIXTURE_DIR, `${name}.bin`), bin);
    }
    const path = join(FIXTURE_DIR, `${name}.gltf`);
    writeFileSync(path, JSON.stringify(json));
    return path;
}

/** The `uri` a `writeGltf` fixture's buffer should use to find its `.bin`. */
export function binUriFor(gltfPath: string): string {
    return `${gltfPath.split("/").pop()!.replace(/\.gltf$/, "")}.bin`;
}

/**
 * Write a `.glb`. The JSON chunk is space-padded and the BIN chunk zero-padded
 * to 4 bytes, per the container spec — an importer that ignores the padding
 * reads the second chunk header at the wrong offset.
 */
export function writeGlb(json: Record<string, unknown>, bin?: Uint8Array): string {
    const enc = new TextEncoder();
    let jsonBytes = enc.encode(JSON.stringify(json));
    const jsonPad = (4 - (jsonBytes.byteLength % 4)) % 4;
    if (jsonPad) {
        const padded = new Uint8Array(jsonBytes.byteLength + jsonPad).fill(0x20);
        padded.set(jsonBytes);
        jsonBytes = padded;
    }
    let binBytes = bin ?? new Uint8Array(0);
    const binPad = (4 - (binBytes.byteLength % 4)) % 4;
    if (binPad) {
        const padded = new Uint8Array(binBytes.byteLength + binPad);
        padded.set(binBytes);
        binBytes = padded;
    }

    const hasBin = binBytes.byteLength > 0;
    const total = 12 + 8 + jsonBytes.byteLength + (hasBin ? 8 + binBytes.byteLength : 0);
    const out = new Uint8Array(total);
    const view = new DataView(out.buffer);
    out.set(enc.encode("glTF"), 0);
    view.setUint32(4, 2, true);
    view.setUint32(8, total, true);
    view.setUint32(12, jsonBytes.byteLength, true);
    view.setUint32(16, 0x4e4f534a, true); // 'JSON'
    out.set(jsonBytes, 20);
    if (hasBin) {
        const o = 20 + jsonBytes.byteLength;
        view.setUint32(o, binBytes.byteLength, true);
        view.setUint32(o + 4, 0x004e4942, true); // 'BIN\0'
        out.set(binBytes, o + 8);
    }

    const path = join(FIXTURE_DIR, `fixture-${counter++}.glb`);
    writeFileSync(path, out);
    return path;
}

/** A 1x1 opaque-red PNG, for the texture paths. Hand-built so it has no fixture file. */
export const RED_PNG = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb0, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82,
]);

/**
 * The three-vertex triangle every geometry fixture starts from: positions at
 * (0,0,0), (1,0,0), (0,1,0), wound CCW, with `u16` indices 0,1,2.
 */
export const TRI_POSITIONS = [0, 0, 0, 1, 0, 0, 0, 1, 0];

/** A complete single-triangle `.gltf` with one external buffer. */
export function triangleGltf(extra: Record<string, unknown> = {}): string {
    const {bytes, offsets} = concatAligned(f32Bytes(TRI_POSITIONS), u16Bytes([0, 1, 2]));
    const name = `fixture-${counter}`;
    writeFileSync(join(FIXTURE_DIR, `${name}.bin`), bytes);
    const json = {
        asset: {version: "2.0"},
        scene: 0,
        scenes: [{nodes: [0]}],
        nodes: [{mesh: 0}],
        meshes: [{primitives: [{attributes: {POSITION: 0}, indices: 1}]}],
        accessors: [
            {
                bufferView: 0,
                componentType: F32,
                count: 3,
                type: "VEC3",
                min: [0, 0, 0],
                max: [1, 1, 0],
            },
            {bufferView: 1, componentType: U16, count: 3, type: "SCALAR"},
        ],
        bufferViews: [
            {buffer: 0, byteOffset: offsets[0], byteLength: 36},
            {buffer: 0, byteOffset: offsets[1], byteLength: 6},
        ],
        buffers: [{uri: `${name}.bin`, byteLength: bytes.byteLength}],
        ...extra,
    };
    const path = join(FIXTURE_DIR, `${name}.gltf`);
    writeFileSync(path, JSON.stringify(json));
    counter++;
    return path;
}
