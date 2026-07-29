// Coverage for `inspectGltf` / `loadGltf`.
//
// **The assertions read buffer bytes back wherever they can, and that is the
// point.** Almost every way a glTF importer goes wrong produces a
// correctly-shaped result: a mis-strided read yields the right vertex *count* in
// the wrong places, an ignored sparse block yields zeros, an index accessor read
// at the wrong width yields plausible-looking triangles. None of those throws,
// and none of them is a wgpu validation error either — so a test that only
// checks `vertexCount` and `layout.arrayStride` would stay green through all of
// them. `helpers/read-buffer.ts` makes the bytes observable; the tests that
// matter most below compare them element by element.
//
// The fixtures are built inline (`helpers/gltf-build.ts`) so the exact bytes
// going in sit next to the values coming out. Real exporter output is the other
// tier — see `gltf-samples.test.ts`.
import { beforeAll, describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
    GltfAlphaMode,
    GltfAttributeSemantic,
    GltfComponentType,
    GltfImageEncoding,
    GltfIndexFormat,
    GltfInterpolation,
    GltfLightKind,
    GltfPrimitiveMode,
    GltfResourceKind,
    GltfResourceSource,
    GltfVertexLayoutMode,
    GltfWrapMode,
    GPUBufferUsage,
    type GpuAdapter,
    type GpuDevice,
    ImageColorSpace,
    inspectGltf,
    loadGltf,
    requestAdapter,
    savePixelsToFile,
} from "../index.js";
import {
    F32,
    FIXTURE_DIR,
    I16,
    RED_PNG,
    TRI_POSITIONS,
    U16,
    U32,
    U8,
    binUriFor,
    concatAligned,
    f32Bytes,
    triangleGltf,
    u16Bytes,
    u32Bytes,
    writeGlb,
    writeGltf,
} from "./helpers/gltf-build.js";
import { readBuffer, readF32, readU16 } from "./helpers/read-buffer.js";

// glTF requires a POSITION accessor to declare `min`/`max`, and gltf-json's
// validation enforces it — so every fixture below carries the bounds of the
// shared triangle rather than omitting them as "not needed here".
const POS_MIN = [0, 0, 0];
const POS_MAX = [1, 1, 0];

let adapter: GpuAdapter;
let device: GpuDevice;

beforeAll(async () => {
    adapter = (await requestAdapter())!;
    device = await adapter.requestDevice({label: "gltf-tests"});
});

/** Load with both buffer kinds made readable, which every byte-level test needs. */
const READABLE = {
    extraVertexBufferUsage: GPUBufferUsage.COPY_SRC,
    extraIndexBufferUsage: GPUBufferUsage.COPY_SRC,
};

// ── inspectGltf ─────────────────────────────────────────────────────────────

describe("inspectGltf", () => {
    it("lists external resources with the URI an override matches on", async () => {
        const path = triangleGltf();
        const manifest = await inspectGltf(path);

        expect(manifest.isBinary).toBe(false);
        expect(manifest.version).toBe("2.0");
        expect(manifest.resources).toHaveLength(1);
        const buffer = manifest.resources[0]!;
        expect(buffer.kind).toBe(GltfResourceKind.Buffer);
        expect(buffer.index).toBe(0);
        expect(buffer.source).toBe(GltfResourceSource.External);
        expect(buffer.uri).toBe(binUriFor(path));
        // The resolved path is what will actually be opened — the URI joined to
        // the base directory, which defaults to the glTF file's own.
        expect(buffer.resolvedPath).toBe(join(FIXTURE_DIR, binUriFor(path)));
        expect(buffer.byteLength).toBe(44);
        expect(manifest.counts.primitives).toBe(1);
    });

    it("reads the GLB binary chunk's length without a device", async () => {
        const {bytes, offsets} = concatAligned(f32Bytes(TRI_POSITIONS), u16Bytes([0, 1, 2]));
        const path = writeGlb(
            {
                asset: {version: "2.0"},
                meshes: [{primitives: [{attributes: {POSITION: 0}, indices: 1}]}],
                accessors: [
                    {bufferView: 0, componentType: F32, count: 3, type: "VEC3", min: POS_MIN, max: POS_MAX},
                    {bufferView: 1, componentType: U16, count: 3, type: "SCALAR"},
                ],
                bufferViews: [
                    {buffer: 0, byteOffset: offsets[0], byteLength: 36},
                    {buffer: 0, byteOffset: offsets[1], byteLength: 6},
                ],
                buffers: [{byteLength: bytes.byteLength}],
            },
            bytes,
        );
        const manifest = await inspectGltf(path);
        expect(manifest.isBinary).toBe(true);
        expect(manifest.binaryChunkLength).toBe(44); // 36 positions + 6 indices, each part 4-byte aligned
        expect(manifest.resources[0]!.source).toBe(GltfResourceSource.BinaryChunk);
        expect(manifest.resources[0]!.uri).toBeUndefined();
    });

    it("flags a required extension it cannot implement, without failing", async () => {
        const path = triangleGltf({
            extensionsRequired: ["KHR_draco_mesh_compression"],
            extensionsUsed: ["KHR_draco_mesh_compression"],
        });
        const manifest = await inspectGltf(path);
        expect(manifest.unsupportedRequiredExtensions).toEqual(["KHR_draco_mesh_compression"]);
    });

    it("does not treat a supported required extension as unsupported", async () => {
        const path = triangleGltf({
            extensionsRequired: ["KHR_mesh_quantization"],
            extensionsUsed: ["KHR_mesh_quantization"],
        });
        const manifest = await inspectGltf(path);
        expect(manifest.unsupportedRequiredExtensions).toEqual([]);
    });
});

// ── geometry ────────────────────────────────────────────────────────────────

describe("loadGltf — geometry", () => {
    it("packs a triangle and reports a layout that matches its bytes", async () => {
        const asset = await loadGltf(device, triangleGltf(), READABLE);

        expect(asset.meshes).toHaveLength(1);
        const prim = asset.meshes[0]!.primitives[0]!;
        expect(prim.vertexCount).toBe(3);
        expect(prim.mode).toBe(GltfPrimitiveMode.Triangles);
        expect(prim.gpuTopology).toBe("triangle-list");
        expect(prim.indexFormat).toBe(GltfIndexFormat.Uint16);
        expect(prim.indexCount).toBe(3);
        expect(prim.min).toEqual([0, 0, 0]);
        expect(prim.max).toEqual([1, 1, 0]);

        // POSITION alone: one float32x3 at location 0, stride 12.
        expect(prim.layout.arrayStride).toBe(12);
        expect(prim.layout.attributes).toHaveLength(1);
        const pos = prim.layout.attributes[0]!;
        expect(pos.semantic).toBe(GltfAttributeSemantic.Position);
        expect(pos.name).toBe("POSITION");
        expect(pos.format).toBe("float32x3");
        expect(pos.offset).toBe(0);
        expect(pos.shaderLocation).toBe(0);
        expect(pos.sourceComponentType).toBe(GltfComponentType.F32);

        expect(Array.from(await readF32(device, prim.vertexBuffer, 9))).toEqual(TRI_POSITIONS);
        expect(Array.from(await readU16(device, prim.indexBuffer!, 3))).toEqual([0, 1, 2]);
    });

    it("de-interleaves a bufferView with a byteStride", async () => {
        // POSITION and TEXCOORD_0 interleaved in one 20-byte-stride view, which
        // is what a real exporter emits. Reading them as if they were tightly
        // packed produces the right vertex count and garbage coordinates.
        const interleaved = f32Bytes([
            /* v0 */ 1, 2, 3, 0.1, 0.2,
            /* v1 */ 4, 5, 6, 0.3, 0.4,
            /* v2 */ 7, 8, 9, 0.5, 0.6,
        ]);
        const {bytes, offsets} = concatAligned(interleaved, u16Bytes([0, 1, 2]));
        writeFileSync(join(FIXTURE_DIR, "interleaved.bin"), bytes);
        const path = writeGltf({
            asset: {version: "2.0"},
            meshes: [{primitives: [{attributes: {POSITION: 0, TEXCOORD_0: 1}, indices: 2}]}],
            accessors: [
                {bufferView: 0, byteOffset: 0, componentType: F32, count: 3, type: "VEC3", min: [1, 2, 3], max: [7, 8, 9]},
                {bufferView: 0, byteOffset: 12, componentType: F32, count: 3, type: "VEC2"},
                {bufferView: 1, componentType: U16, count: 3, type: "SCALAR"},
            ],
            bufferViews: [
                {buffer: 0, byteOffset: offsets[0], byteLength: 60, byteStride: 20},
                {buffer: 0, byteOffset: offsets[1], byteLength: 6},
            ],
            buffers: [{uri: "interleaved.bin", byteLength: bytes.byteLength}],
        });

        const asset = await loadGltf(device, path, READABLE);
        const prim = asset.meshes[0]!.primitives[0]!;
        // POSITION at location 0 (offset 0), TEXCOORD_0 at location 3 (offset 12).
        expect(prim.layout.arrayStride).toBe(20);
        const uv = prim.layout.attributes.find((a) => a.semantic === GltfAttributeSemantic.TexCoord)!;
        expect(uv.offset).toBe(12);
        expect(uv.shaderLocation).toBe(3);

        const v = await readF32(device, prim.vertexBuffer, 15);
        expect(Array.from(v.slice(0, 3))).toEqual([1, 2, 3]);
        expect(Array.from(v.slice(3, 5))).toEqual([0.1, 0.2].map(Math.fround));
        expect(Array.from(v.slice(5, 8))).toEqual([4, 5, 6]);
        expect(Array.from(v.slice(10, 13))).toEqual([7, 8, 9]);
    });

    it("applies a sparse accessor's substitutions", async () => {
        // Base data says every position is the origin; the sparse block moves
        // vertex 1. An importer that ignores `sparse` returns a degenerate
        // triangle and no error.
        const base = f32Bytes([0, 0, 0, 0, 0, 0, 0, 0, 0]);
        const sparseIdx = u16Bytes([1]);
        const sparseVal = f32Bytes([9, 8, 7]);
        const {bytes, offsets} = concatAligned(base, sparseIdx, sparseVal, u16Bytes([0, 1, 2]));
        writeFileSync(join(FIXTURE_DIR, "sparse.bin"), bytes);
        const path = writeGltf({
            asset: {version: "2.0"},
            meshes: [{primitives: [{attributes: {POSITION: 0}, indices: 1}]}],
            accessors: [
                {
                    bufferView: 0,
                    componentType: F32,
                    count: 3,
                    type: "VEC3",
                    min: [0, 0, 0],
                    max: [9, 8, 7],
                    sparse: {
                        count: 1,
                        indices: {bufferView: 1, componentType: U16},
                        values: {bufferView: 2},
                    },
                },
                {bufferView: 3, componentType: U16, count: 3, type: "SCALAR"},
            ],
            bufferViews: [
                {buffer: 0, byteOffset: offsets[0], byteLength: 36},
                {buffer: 0, byteOffset: offsets[1], byteLength: 2},
                {buffer: 0, byteOffset: offsets[2], byteLength: 12},
                {buffer: 0, byteOffset: offsets[3], byteLength: 6},
            ],
            buffers: [{uri: "sparse.bin", byteLength: bytes.byteLength}],
        });

        const asset = await loadGltf(device, path, READABLE);
        const v = await readF32(device, asset.meshes[0]!.primitives[0]!.vertexBuffer, 9);
        expect(Array.from(v)).toEqual([0, 0, 0, 9, 8, 7, 0, 0, 0]);
    });

    it("widens UNSIGNED_BYTE indices to Uint16 — WebGPU has no 8-bit format", async () => {
        const {bytes, offsets} = concatAligned(f32Bytes(TRI_POSITIONS), Uint8Array.from([2, 0, 1]));
        writeFileSync(join(FIXTURE_DIR, "u8idx.bin"), bytes);
        const path = writeGltf({
            asset: {version: "2.0"},
            meshes: [{primitives: [{attributes: {POSITION: 0}, indices: 1}]}],
            accessors: [
                {bufferView: 0, componentType: F32, count: 3, type: "VEC3", min: POS_MIN, max: POS_MAX},
                {bufferView: 1, componentType: U8, count: 3, type: "SCALAR"},
            ],
            bufferViews: [
                {buffer: 0, byteOffset: offsets[0], byteLength: 36},
                {buffer: 0, byteOffset: offsets[1], byteLength: 3},
            ],
            buffers: [{uri: "u8idx.bin", byteLength: bytes.byteLength}],
        });

        const asset = await loadGltf(device, path, READABLE);
        const prim = asset.meshes[0]!.primitives[0]!;
        expect(prim.indexFormat).toBe(GltfIndexFormat.Uint16);
        expect(Array.from(await readU16(device, prim.indexBuffer!, 3))).toEqual([2, 0, 1]);
    });

    it("un-normalises a quantised attribute rather than passing the integers through", async () => {
        // KHR_mesh_quantization territory: a normalized SHORT texcoord. 32767
        // must read back as 1.0, not as 32767.
        const {bytes, offsets} = concatAligned(
            f32Bytes(TRI_POSITIONS),
            new Uint8Array(Int16Array.from([0, 0, 32767, 0, 0, 32767]).buffer),
            u16Bytes([0, 1, 2]),
        );
        writeFileSync(join(FIXTURE_DIR, "quant.bin"), bytes);
        const path = writeGltf({
            asset: {version: "2.0"},
            extensionsUsed: ["KHR_mesh_quantization"],
            meshes: [{primitives: [{attributes: {POSITION: 0, TEXCOORD_0: 1}, indices: 2}]}],
            accessors: [
                {bufferView: 0, componentType: F32, count: 3, type: "VEC3", min: POS_MIN, max: POS_MAX},
                {bufferView: 1, componentType: I16, count: 3, type: "VEC2", normalized: true},
                {bufferView: 2, componentType: U16, count: 3, type: "SCALAR"},
            ],
            bufferViews: [
                {buffer: 0, byteOffset: offsets[0], byteLength: 36},
                {buffer: 0, byteOffset: offsets[1], byteLength: 12},
                {buffer: 0, byteOffset: offsets[2], byteLength: 6},
            ],
            buffers: [{uri: "quant.bin", byteLength: bytes.byteLength}],
        });

        const asset = await loadGltf(device, path, READABLE);
        const prim = asset.meshes[0]!.primitives[0]!;
        const uv = prim.layout.attributes.find((a) => a.semantic === GltfAttributeSemantic.TexCoord)!;
        // The canonical destination is float32x2 whatever the source held, and
        // the source type is still reported.
        expect(uv.format).toBe("float32x2");
        expect(uv.sourceComponentType).toBe(GltfComponentType.I16);
        expect(uv.sourceNormalized).toBe(true);

        const v = await readF32(device, prim.vertexBuffer, 15);
        expect(v[3]).toBe(0);
        expect(v[4]).toBe(0);
        expect(v[8]).toBeCloseTo(1, 5);
    });

    it("rewrites a TRIANGLE_FAN into a triangle list WebGPU can draw", async () => {
        const positions = f32Bytes([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
        const {bytes, offsets} = concatAligned(positions, u16Bytes([0, 1, 2, 3]));
        writeFileSync(join(FIXTURE_DIR, "fan.bin"), bytes);
        const path = writeGltf({
            asset: {version: "2.0"},
            meshes: [{primitives: [{attributes: {POSITION: 0}, indices: 1, mode: 6}]}],
            accessors: [
                {bufferView: 0, componentType: F32, count: 4, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0]},
                {bufferView: 1, componentType: U16, count: 4, type: "SCALAR"},
            ],
            bufferViews: [
                {buffer: 0, byteOffset: offsets[0], byteLength: 48},
                {buffer: 0, byteOffset: offsets[1], byteLength: 8},
            ],
            buffers: [{uri: "fan.bin", byteLength: bytes.byteLength}],
        });

        const asset = await loadGltf(device, path, READABLE);
        const prim = asset.meshes[0]!.primitives[0]!;
        // `mode` still reports what the file said; `gpuTopology` reports what
        // the buffers now hold.
        expect(prim.mode).toBe(GltfPrimitiveMode.TriangleFan);
        expect(prim.gpuTopology).toBe("triangle-list");
        expect(prim.indexCount).toBe(6);
        expect(Array.from(await readU16(device, prim.indexBuffer!, 6))).toEqual([0, 1, 2, 0, 2, 3]);
    });

    it("leaves a fan alone when the rewrite is switched off", async () => {
        const positions = f32Bytes([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
        const {bytes, offsets} = concatAligned(positions, u16Bytes([0, 1, 2, 3]));
        writeFileSync(join(FIXTURE_DIR, "fan2.bin"), bytes);
        const path = writeGltf({
            asset: {version: "2.0"},
            meshes: [{primitives: [{attributes: {POSITION: 0}, indices: 1, mode: 6}]}],
            accessors: [
                {bufferView: 0, componentType: F32, count: 4, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0]},
                {bufferView: 1, componentType: U16, count: 4, type: "SCALAR"},
            ],
            bufferViews: [
                {buffer: 0, byteOffset: offsets[0], byteLength: 48},
                {buffer: 0, byteOffset: offsets[1], byteLength: 8},
            ],
            buffers: [{uri: "fan2.bin", byteLength: bytes.byteLength}],
        });

        const asset = await loadGltf(device, path, {convertUnsupportedTopologies: false});
        const prim = asset.meshes[0]!.primitives[0]!;
        expect(prim.mode).toBe(GltfPrimitiveMode.TriangleFan);
        expect(prim.gpuTopology).toBeUndefined();
        expect(prim.indexCount).toBe(4);
    });

    it("reads a GLB's binary chunk and a data: URI the same way", async () => {
        const {bytes, offsets} = concatAligned(f32Bytes(TRI_POSITIONS), u16Bytes([0, 1, 2]));
        const common = {
            asset: {version: "2.0"},
            meshes: [{primitives: [{attributes: {POSITION: 0}, indices: 1}]}],
            accessors: [
                {bufferView: 0, componentType: F32, count: 3, type: "VEC3", min: POS_MIN, max: POS_MAX},
                {bufferView: 1, componentType: U16, count: 3, type: "SCALAR"},
            ],
            bufferViews: [
                {buffer: 0, byteOffset: offsets[0], byteLength: 36},
                {buffer: 0, byteOffset: offsets[1], byteLength: 6},
            ],
        };

        const glb = await loadGltf(device, writeGlb({...common, buffers: [{byteLength: bytes.byteLength}]}, bytes), READABLE);
        const base64 = Buffer.from(bytes).toString("base64");
        const embedded = await loadGltf(
            device,
            writeGltf({
                ...common,
                buffers: [{uri: `data:application/octet-stream;base64,${base64}`, byteLength: bytes.byteLength}],
            }),
            READABLE,
        );

        for (const asset of [glb, embedded]) {
            const v = await readF32(device, asset.meshes[0]!.primitives[0]!.vertexBuffer, 9);
            expect(Array.from(v)).toEqual(TRI_POSITIONS);
        }
    });

    it("gives morph targets their own locations, past the base layout's", async () => {
        const {bytes, offsets} = concatAligned(
            f32Bytes(TRI_POSITIONS),
            f32Bytes([0, 0, 1, 0, 0, 1, 0, 0, 1]),
            u16Bytes([0, 1, 2]),
        );
        writeFileSync(join(FIXTURE_DIR, "morph.bin"), bytes);
        const path = writeGltf({
            asset: {version: "2.0"},
            meshes: [
                {
                    weights: [0.25],
                    primitives: [
                        {attributes: {POSITION: 0}, indices: 2, targets: [{POSITION: 1}]},
                    ],
                },
            ],
            accessors: [
                {bufferView: 0, componentType: F32, count: 3, type: "VEC3", min: POS_MIN, max: POS_MAX},
                {bufferView: 1, componentType: F32, count: 3, type: "VEC3"},
                {bufferView: 2, componentType: U16, count: 3, type: "SCALAR"},
            ],
            bufferViews: [
                {buffer: 0, byteOffset: offsets[0], byteLength: 36},
                {buffer: 0, byteOffset: offsets[1], byteLength: 36},
                {buffer: 0, byteOffset: offsets[2], byteLength: 6},
            ],
            buffers: [{uri: "morph.bin", byteLength: bytes.byteLength}],
        });

        const asset = await loadGltf(device, path, READABLE);
        expect(asset.meshes[0]!.weights).toEqual([0.25]);
        const prim = asset.meshes[0]!.primitives[0]!;
        expect(prim.morphTargets).toHaveLength(1);
        const target = prim.morphTargets[0]!;
        // Not 0 — that is where the base buffer's POSITION already is.
        expect(target.layout.attributes[0]!.shaderLocation).toBeGreaterThan(0);
        const deltas = await readF32(device, target.buffer, 9);
        expect(Array.from(deltas)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    });
});

// ── the fixed layout ────────────────────────────────────────────────────────

describe("loadGltf — Standard vertex layout", () => {
    it("always produces stride 48 with position/normal/tangent/uv", async () => {
        const asset = await loadGltf(device, triangleGltf(), {
            ...READABLE,
            vertexLayout: GltfVertexLayoutMode.Standard,
        });
        const prim = asset.meshes[0]!.primitives[0]!;
        expect(prim.layout.arrayStride).toBe(48);
        expect(prim.layout.attributes.map((a) => [a.name, a.offset, a.format, a.shaderLocation])).toEqual([
            ["POSITION", 0, "float32x3", 0],
            ["NORMAL", 12, "float32x3", 1],
            ["TANGENT", 24, "float32x4", 2],
            ["TEXCOORD_0", 40, "float32x2", 3],
        ]);

        const v = await readF32(device, prim.vertexBuffer, 12);
        expect(Array.from(v.slice(0, 3))).toEqual([0, 0, 0]);
        // The fixture has no NORMAL, so one was generated from the triangle:
        // CCW in the XY plane means +Z.
        expect(Array.from(v.slice(3, 6))).toEqual([0, 0, 1]);
        // The tangent must be a unit vector perpendicular to that normal.
        const t = v.slice(6, 9);
        expect(Math.hypot(t[0]!, t[1]!, t[2]!)).toBeCloseTo(1, 5);
        expect(t[0]! * 0 + t[1]! * 0 + t[2]! * 1).toBeCloseTo(0, 5);
        expect(v[9]).toBe(1); // handedness
    });

    it("derives tangents from UVs when the file has none", async () => {
        // A triangle in the XY plane whose U axis runs along +X: the tangent
        // must come out as +X, which an arbitrary perpendicular would not
        // reliably do.
        const {bytes, offsets} = concatAligned(
            f32Bytes([0, 0, 0, 1, 0, 0, 0, 1, 0]),
            f32Bytes([0, 0, 0, 0, 1, 0, 0, 0, 1]),
            f32Bytes([0, 0, 1, 0, 0, 1]),
            u16Bytes([0, 1, 2]),
        );
        writeFileSync(join(FIXTURE_DIR, "tangent.bin"), bytes);
        const path = writeGltf({
            asset: {version: "2.0"},
            meshes: [{primitives: [{attributes: {POSITION: 0, NORMAL: 1, TEXCOORD_0: 2}, indices: 3}]}],
            accessors: [
                {bufferView: 0, componentType: F32, count: 3, type: "VEC3", min: POS_MIN, max: POS_MAX},
                {bufferView: 1, componentType: F32, count: 3, type: "VEC3"},
                {bufferView: 2, componentType: F32, count: 3, type: "VEC2"},
                {bufferView: 3, componentType: U16, count: 3, type: "SCALAR"},
            ],
            bufferViews: [
                {buffer: 0, byteOffset: offsets[0], byteLength: 36},
                {buffer: 0, byteOffset: offsets[1], byteLength: 36},
                {buffer: 0, byteOffset: offsets[2], byteLength: 24},
                {buffer: 0, byteOffset: offsets[3], byteLength: 6},
            ],
            buffers: [{uri: "tangent.bin", byteLength: bytes.byteLength}],
        });

        const asset = await loadGltf(device, path, {
            ...READABLE,
            vertexLayout: GltfVertexLayoutMode.Standard,
        });
        const v = await readF32(device, asset.meshes[0]!.primitives[0]!.vertexBuffer, 12);
        expect(v[6]).toBeCloseTo(1, 4);
        expect(v[7]).toBeCloseTo(0, 4);
        expect(v[8]).toBeCloseTo(0, 4);
    });
});

// ── materials, textures, samplers ───────────────────────────────────────────

describe("loadGltf — materials", () => {
    it("materialises every spec default and appends the default material", async () => {
        const asset = await loadGltf(device, triangleGltf());
        // One appended default material, and the primitive points at it.
        expect(asset.materials).toHaveLength(1);
        expect(asset.defaultMaterial).toBe(0);
        expect(asset.meshes[0]!.primitives[0]!.material).toBe(0);

        const m = asset.materials[0]!;
        expect(m.baseColorFactor).toEqual([1, 1, 1, 1]);
        expect(m.metallicFactor).toBe(1);
        expect(m.roughnessFactor).toBe(1);
        expect(m.alphaMode).toBe(GltfAlphaMode.Opaque);
        expect(m.alphaCutoff).toBe(0.5);
        expect(m.ior).toBe(1.5);
        expect(m.emissiveStrength).toBe(1);
        expect(m.doubleSided).toBe(false);
    });

    it("folds in the KHR extensions gltf models and the ones it does not", async () => {
        const path = triangleGltf({
            extensionsUsed: [
                "KHR_materials_emissive_strength",
                "KHR_materials_ior",
                "KHR_materials_clearcoat",
                "VENDOR_thing",
            ],
            materials: [
                {
                    name: "coated",
                    pbrMetallicRoughness: {baseColorFactor: [0.2, 0.4, 0.6, 1], metallicFactor: 0.25},
                    extensions: {
                        KHR_materials_emissive_strength: {emissiveStrength: 7},
                        KHR_materials_ior: {ior: 1.9},
                        KHR_materials_clearcoat: {clearcoatFactor: 0.8, clearcoatRoughnessFactor: 0.1},
                        VENDOR_thing: {answer: 42},
                    },
                },
            ],
        });
        const asset = await loadGltf(device, path);
        const m = asset.materials[0]!;
        expect(m.name).toBe("coated");
        expect(m.metallicFactor).toBeCloseTo(0.25, 6);
        expect(m.emissiveStrength).toBeCloseTo(7, 6);
        expect(m.ior).toBeCloseTo(1.9, 6);
        expect(m.clearcoat!.factor).toBeCloseTo(0.8, 6);
        expect(m.clearcoat!.roughnessFactor).toBeCloseTo(0.1, 6);
        // Unrecognised extensions survive as raw JSON rather than being dropped.
        expect(JSON.parse(m.extensions!)).toEqual({VENDOR_thing: {answer: 42}});
    });

    it("carries KHR_texture_transform through on a texture slot", async () => {
        const path = texturedGltf({
            extensionsUsed: ["KHR_texture_transform"],
            transform: {offset: [0.5, 0.25], rotation: 1.5, scale: [2, 4]},
        });
        const asset = await loadGltf(device, path);
        const t = asset.materials[0]!.baseColorTexture!.transform!;
        expect(t.offset).toEqual([0.5, 0.25]);
        expect(t.rotation).toBeCloseTo(1.5, 6);
        expect(t.scale).toEqual([2, 4]);
    });
});

/** A triangle whose material has a base-colour texture from an embedded PNG. */
function texturedGltf(opts: {
    extensionsUsed?: string[];
    transform?: Record<string, unknown>;
    normalToo?: boolean;
} = {}): string {
    const {bytes, offsets} = concatAligned(f32Bytes(TRI_POSITIONS), u16Bytes([0, 1, 2]), RED_PNG);
    const name = `textured-${Math.random().toString(36).slice(2)}`;
    writeFileSync(join(FIXTURE_DIR, `${name}.bin`), bytes);
    const baseColorTexture: Record<string, unknown> = {index: 0};
    if (opts.transform) {
        baseColorTexture.extensions = {KHR_texture_transform: opts.transform};
    }
    const json: Record<string, unknown> = {
        asset: {version: "2.0"},
        ...(opts.extensionsUsed ? {extensionsUsed: opts.extensionsUsed} : {}),
        meshes: [{primitives: [{attributes: {POSITION: 0}, indices: 1, material: 0}]}],
        materials: [
            {
                pbrMetallicRoughness: {baseColorTexture},
                ...(opts.normalToo ? {normalTexture: {index: 1}} : {}),
            },
        ],
        textures: opts.normalToo ? [{source: 0, sampler: 0}, {source: 0}] : [{source: 0, sampler: 0}],
        samplers: [{magFilter: 9728, minFilter: 9984, wrapS: 33071, wrapT: 10497}],
        images: [{bufferView: 2, mimeType: "image/png"}],
        accessors: [
            {bufferView: 0, componentType: F32, count: 3, type: "VEC3", min: POS_MIN, max: POS_MAX},
            {bufferView: 1, componentType: U16, count: 3, type: "SCALAR"},
        ],
        bufferViews: [
            {buffer: 0, byteOffset: offsets[0], byteLength: 36},
            {buffer: 0, byteOffset: offsets[1], byteLength: 6},
            {buffer: 0, byteOffset: offsets[2], byteLength: RED_PNG.byteLength},
        ],
        buffers: [{uri: `${name}.bin`, byteLength: bytes.byteLength}],
    };
    const path = join(FIXTURE_DIR, `${name}.gltf`);
    writeFileSync(path, JSON.stringify(json));
    return path;
}

describe("loadGltf — textures and samplers", () => {
    it("decodes an image out of a bufferView and picks sRGB from the slot it is used in", async () => {
        const asset = await loadGltf(device, texturedGltf({normalToo: true}));
        expect(asset.textures).toHaveLength(2);

        const base = asset.textures[0]!;
        expect(base.encoding).toBe(GltfImageEncoding.Png);
        expect(base.colorSpace).toBe(ImageColorSpace.Srgb);
        expect(base.texture!.format).toBe("rgba8unorm-srgb");
        expect(base.texture!.width).toBe(1);

        // The same image, bound to `normalTexture`, must not get an sRGB decode.
        const normal = asset.textures[1]!;
        expect(normal.colorSpace).toBe(ImageColorSpace.Linear);
        expect(normal.texture!.format).toBe("rgba8unorm");
    });

    it("honours a per-texture colour-space override", async () => {
        const asset = await loadGltf(device, texturedGltf(), {
            textureColorSpaces: [{texture: 0, colorSpace: ImageColorSpace.Linear}],
        });
        expect(asset.textures[0]!.colorSpace).toBe(ImageColorSpace.Linear);
        expect(asset.textures[0]!.texture!.format).toBe("rgba8unorm");
    });

    it("translates sampler enums and appends a default for textures with none", async () => {
        const asset = await loadGltf(device, texturedGltf({normalToo: true}));
        // The file has one sampler; texture 1 declares none, so a default was
        // appended and texture 1 points at it.
        expect(asset.samplers).toHaveLength(2);
        expect(asset.samplers[0]!.isDefault).toBe(false);
        expect(asset.samplers[0]!.wrapS).toBe(GltfWrapMode.ClampToEdge);
        expect(asset.samplers[0]!.wrapT).toBe(GltfWrapMode.Repeat);
        expect(asset.samplers[1]!.isDefault).toBe(true);
        expect(asset.textures[0]!.sampler).toBe(0);
        expect(asset.textures[1]!.sampler).toBe(1);
    });

    it("skips image decoding entirely when asked", async () => {
        const asset = await loadGltf(device, texturedGltf(), {loadImages: false});
        expect(asset.textures[0]!.texture).toBeUndefined();
        // The sampler is still created — only the image work is skipped.
        expect(asset.samplers[0]!.sampler).toBeDefined();
    });
});

// ── the override hook ───────────────────────────────────────────────────────

describe("loadGltf — resourceOverrides", () => {
    it("replaces a buffer's bytes, matched by URI", async () => {
        const path = triangleGltf();
        const replacement = concatAligned(
            f32Bytes([5, 5, 5, 6, 6, 6, 7, 7, 7]),
            u16Bytes([0, 1, 2]),
        ).bytes;

        const asset = await loadGltf(device, path, {
            ...READABLE,
            resourceOverrides: [
                {kind: GltfResourceKind.Buffer, uri: binUriFor(path), bytes: replacement},
            ],
        });
        const v = await readF32(device, asset.meshes[0]!.primitives[0]!.vertexBuffer, 9);
        expect(Array.from(v)).toEqual([5, 5, 5, 6, 6, 6, 7, 7, 7]);
    });

    it("redirects an image to a sidecar file, matched by index", async () => {
        // The sidecar is a 2x1 PNG, so the swap is observable in the texture's
        // dimensions rather than only in bytes nothing reads.
        const wide = join(FIXTURE_DIR, "sidecar.png");
        await writePng(wide, 2, 1);
        const asset = await loadGltf(device, texturedGltf(), {
            resourceOverrides: [{kind: GltfResourceKind.Image, index: 0, path: wide}],
        });
        expect(asset.textures[0]!.texture!.width).toBe(2);
        expect(asset.textures[0]!.texture!.height).toBe(1);
    });

    it("drops an image on request, leaving a null texture and a live sampler", async () => {
        const asset = await loadGltf(device, texturedGltf(), {
            resourceOverrides: [{kind: GltfResourceKind.Image, index: 0, skip: true}],
        });
        expect(asset.textures[0]!.texture).toBeUndefined();
        expect(asset.textures[0]!.sampler).toBe(0);
    });

    // Malformed *options* throw synchronously rather than rejecting: they are
    // argument errors, caught before any work is scheduled, which is also where
    // the `Uint8Array` copy off the JS thread happens.
    it("rejects an override that names more than one action", () => {
        expect(() =>
            loadGltf(device, triangleGltf(), {
                resourceOverrides: [
                    {kind: GltfResourceKind.Buffer, index: 0, skip: true, path: "/nowhere"},
                ],
            }),
        ).toThrow(/exactly one of/);
    });
});

/**
 * A `w`x`h` opaque-red PNG on disk, written with metis-native's own encoder
 * rather than a hand-rolled one — `savePixelsToFile` is right there, and a
 * second PNG writer in the test suite is a second thing that can be wrong.
 */
async function writePng(path: string, w: number, h: number): Promise<void> {
    const pixels = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
        pixels[i * 4] = 255;
        pixels[i * 4 + 3] = 255;
    }
    await savePixelsToFile(pixels, w, h, path);
}

// ── scene graph, animation, lights ──────────────────────────────────────────

describe("loadGltf — scene graph", () => {
    it("reports a node's transform in both forms and says which the file used", async () => {
        const path = triangleGltf({
            nodes: [
                {mesh: 0, translation: [1, 2, 3], scale: [2, 2, 2], children: [1]},
                {matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 5, 6, 1]},
            ],
            scenes: [{nodes: [0]}],
        });
        const asset = await loadGltf(device, path);

        const trs = asset.nodes[0]!;
        expect(trs.hasMatrix).toBe(false);
        expect(trs.translation).toEqual([1, 2, 3]);
        expect(trs.children).toEqual([1]);
        // The composed matrix is column-major, so the translation is elements 12-14.
        expect(trs.matrix.slice(12, 15)).toEqual([1, 2, 3]);
        expect(trs.matrix[0]).toBe(2);

        const mat = asset.nodes[1]!;
        expect(mat.hasMatrix).toBe(true);
        expect(mat.translation).toEqual([4, 5, 6]);
    });

    it("reads KHR_lights_punctual, defaults included", async () => {
        const path = triangleGltf({
            extensionsUsed: ["KHR_lights_punctual"],
            extensions: {
                KHR_lights_punctual: {
                    lights: [
                        {type: "directional", color: [1, 0.9, 0.8], intensity: 3},
                        {type: "spot", intensity: 10, spot: {outerConeAngle: 0.5}},
                    ],
                },
            },
            nodes: [{mesh: 0, extensions: {KHR_lights_punctual: {light: 1}}}],
        });
        const asset = await loadGltf(device, path);
        expect(asset.lights).toHaveLength(2);
        expect(asset.lights[0]!.kind).toBe(GltfLightKind.Directional);
        expect(asset.lights[0]!.intensity).toBeCloseTo(3, 6);
        expect(asset.lights[1]!.kind).toBe(GltfLightKind.Spot);
        expect(asset.lights[1]!.innerConeAngle).toBe(0);
        expect(asset.lights[1]!.outerConeAngle).toBeCloseTo(0.5, 6);
        // The light's colour defaults to white when the file omits it.
        expect(asset.lights[1]!.color).toEqual([1, 1, 1]);
        expect(asset.nodes[0]!.light).toBe(1);
    });

    it("decodes animation samplers and reports the cubic-spline stride", async () => {
        const times = f32Bytes([0, 0.5, 1]);
        const linear = f32Bytes([0, 0, 0, 1, 0, 0, 2, 0, 0]);
        // CUBICSPLINE: in-tangent, value, out-tangent per keyframe.
        const cubic = f32Bytes(new Array(3 * 3 * 3).fill(0).map((_, i) => i));
        const {bytes, offsets} = concatAligned(
            f32Bytes(TRI_POSITIONS),
            u16Bytes([0, 1, 2]),
            times,
            linear,
            cubic,
        );
        writeFileSync(join(FIXTURE_DIR, "anim.bin"), bytes);
        const path = writeGltf({
            asset: {version: "2.0"},
            nodes: [{mesh: 0}],
            scenes: [{nodes: [0]}],
            meshes: [{primitives: [{attributes: {POSITION: 0}, indices: 1}]}],
            animations: [
                {
                    name: "wobble",
                    samplers: [
                        {input: 2, output: 3, interpolation: "LINEAR"},
                        {input: 2, output: 4, interpolation: "CUBICSPLINE"},
                    ],
                    channels: [
                        {sampler: 0, target: {node: 0, path: "translation"}},
                        {sampler: 1, target: {node: 0, path: "scale"}},
                    ],
                },
            ],
            accessors: [
                {bufferView: 0, componentType: F32, count: 3, type: "VEC3", min: POS_MIN, max: POS_MAX},
                {bufferView: 1, componentType: U16, count: 3, type: "SCALAR"},
                {bufferView: 2, componentType: F32, count: 3, type: "SCALAR", min: [0], max: [1]},
                {bufferView: 3, componentType: F32, count: 3, type: "VEC3"},
                {bufferView: 4, componentType: F32, count: 9, type: "VEC3"},
            ],
            bufferViews: [
                {buffer: 0, byteOffset: offsets[0], byteLength: 36},
                {buffer: 0, byteOffset: offsets[1], byteLength: 6},
                {buffer: 0, byteOffset: offsets[2], byteLength: 12},
                {buffer: 0, byteOffset: offsets[3], byteLength: 36},
                {buffer: 0, byteOffset: offsets[4], byteLength: 108},
            ],
            buffers: [{uri: "anim.bin", byteLength: bytes.byteLength}],
        });

        const asset = await loadGltf(device, path);
        expect(asset.animations).toHaveLength(1);
        const anim = asset.animations[0]!;
        expect(anim.name).toBe("wobble");
        expect(anim.duration).toBeCloseTo(1, 6);
        expect(Array.from(anim.samplers[0]!.input)).toEqual([0, 0.5, 1]);
        expect(anim.samplers[0]!.interpolation).toBe(GltfInterpolation.Linear);
        expect(anim.samplers[0]!.components).toBe(3);
        expect(anim.samplers[0]!.valuesPerKeyframe).toBe(3);
        // The cubic sampler carries three values per keyframe, not one.
        expect(anim.samplers[1]!.interpolation).toBe(GltfInterpolation.CubicSpline);
        expect(anim.samplers[1]!.components).toBe(3);
        expect(anim.samplers[1]!.valuesPerKeyframe).toBe(9);
        expect(anim.samplers[1]!.output.length).toBe(27);
        expect(anim.channels[0]!.targetNode).toBe(0);
    });

    it("reads a skin's joints and inverse bind matrices", async () => {
        const ibm = f32Bytes([
            ...[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            ...[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -1, -2, -3, 1],
        ]);
        const {bytes, offsets} = concatAligned(f32Bytes(TRI_POSITIONS), u16Bytes([0, 1, 2]), ibm);
        writeFileSync(join(FIXTURE_DIR, "skin.bin"), bytes);
        const path = writeGltf({
            asset: {version: "2.0"},
            nodes: [{mesh: 0, skin: 0}, {}, {}],
            scenes: [{nodes: [0, 1, 2]}],
            skins: [{joints: [1, 2], skeleton: 1, inverseBindMatrices: 2}],
            meshes: [{primitives: [{attributes: {POSITION: 0}, indices: 1}]}],
            accessors: [
                {bufferView: 0, componentType: F32, count: 3, type: "VEC3", min: POS_MIN, max: POS_MAX},
                {bufferView: 1, componentType: U16, count: 3, type: "SCALAR"},
                {bufferView: 2, componentType: F32, count: 2, type: "MAT4"},
            ],
            bufferViews: [
                {buffer: 0, byteOffset: offsets[0], byteLength: 36},
                {buffer: 0, byteOffset: offsets[1], byteLength: 6},
                {buffer: 0, byteOffset: offsets[2], byteLength: 128},
            ],
            buffers: [{uri: "skin.bin", byteLength: bytes.byteLength}],
        });

        const asset = await loadGltf(device, path);
        expect(asset.skins).toHaveLength(1);
        expect(asset.skins[0]!.joints).toEqual([1, 2]);
        expect(asset.skins[0]!.skeleton).toBe(1);
        const m = asset.skins[0]!.inverseBindMatrices!;
        expect(m.length).toBe(32);
        expect(Array.from(m.slice(28, 31))).toEqual([-1, -2, -3]);
        expect(asset.nodes[0]!.skin).toBe(0);
    });
});

// ── failure modes ───────────────────────────────────────────────────────────

describe("loadGltf — errors", () => {
    it("refuses a file requiring an extension it cannot implement", async () => {
        const path = triangleGltf({
            extensionsRequired: ["KHR_draco_mesh_compression"],
            extensionsUsed: ["KHR_draco_mesh_compression"],
        });
        await expect(loadGltf(device, path)).rejects.toThrow(/KHR_draco_mesh_compression/);
    });

    it("loads it anyway, and says so, when strictness is switched off", async () => {
        const path = triangleGltf({
            extensionsRequired: ["KHR_draco_mesh_compression"],
            extensionsUsed: ["KHR_draco_mesh_compression"],
        });
        const asset = await loadGltf(device, path, {strictRequiredExtensions: false});
        expect(asset.unsupportedRequiredExtensions).toEqual(["KHR_draco_mesh_compression"]);
    });

    it("rejects a missing sidecar buffer by name", async () => {
        const path = writeGltf({
            asset: {version: "2.0"},
            meshes: [{primitives: [{attributes: {POSITION: 0}}]}],
            accessors: [{bufferView: 0, componentType: F32, count: 3, type: "VEC3", min: POS_MIN, max: POS_MAX}],
            bufferViews: [{buffer: 0, byteOffset: 0, byteLength: 36}],
            buffers: [{uri: "does-not-exist.bin", byteLength: 36}],
        });
        await expect(loadGltf(device, path)).rejects.toThrow(/does-not-exist\.bin/);
    });

    it("rejects a network URI rather than fetching it", async () => {
        const path = writeGltf({
            asset: {version: "2.0"},
            meshes: [{primitives: [{attributes: {POSITION: 0}}]}],
            accessors: [{bufferView: 0, componentType: F32, count: 3, type: "VEC3", min: POS_MIN, max: POS_MAX}],
            bufferViews: [{buffer: 0, byteOffset: 0, byteLength: 36}],
            buffers: [{uri: "https://example.com/model.bin", byteLength: 36}],
        });
        await expect(loadGltf(device, path)).rejects.toThrow(/network URI/);
    });

    it("rejects a truncated buffer instead of reading past its end", async () => {
        writeFileSync(join(FIXTURE_DIR, "short.bin"), new Uint8Array(8));
        const path = writeGltf({
            asset: {version: "2.0"},
            meshes: [{primitives: [{attributes: {POSITION: 0}}]}],
            accessors: [{bufferView: 0, componentType: F32, count: 3, type: "VEC3", min: POS_MIN, max: POS_MAX}],
            bufferViews: [{buffer: 0, byteOffset: 0, byteLength: 36}],
            buffers: [{uri: "short.bin", byteLength: 36}],
        });
        await expect(loadGltf(device, path)).rejects.toThrow(/byteLength 36 but only 8/);
    });

    it("rejects an out-of-range index rather than drawing garbage", async () => {
        const {bytes, offsets} = concatAligned(f32Bytes(TRI_POSITIONS), u16Bytes([0, 1, 99]));
        writeFileSync(join(FIXTURE_DIR, "badidx.bin"), bytes);
        const path = writeGltf({
            asset: {version: "2.0"},
            meshes: [{primitives: [{attributes: {POSITION: 0}, indices: 1}]}],
            accessors: [
                {bufferView: 0, componentType: F32, count: 3, type: "VEC3", min: POS_MIN, max: POS_MAX},
                {bufferView: 1, componentType: U16, count: 3, type: "SCALAR"},
            ],
            bufferViews: [
                {buffer: 0, byteOffset: offsets[0], byteLength: 36},
                {buffer: 0, byteOffset: offsets[1], byteLength: 6},
            ],
            buffers: [{uri: "badidx.bin", byteLength: bytes.byteLength}],
        });
        await expect(loadGltf(device, path)).rejects.toThrow(/index 99 is out of range/);
    });

    it("rejects a file that is not glTF at all", async () => {
        const path = join(FIXTURE_DIR, "not-gltf.gltf");
        writeFileSync(path, "this is not JSON");
        await expect(loadGltf(device, path)).rejects.toThrow(/failed to parse/);
    });
});

// Keep the u32 helper referenced — it is part of the fixture vocabulary and its
// absence here would be a lint error, not a signal that indices never widen.
void u32Bytes;
void U32;
void readBuffer;
