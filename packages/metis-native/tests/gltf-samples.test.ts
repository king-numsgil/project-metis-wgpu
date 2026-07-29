// The second fixture tier: real Khronos sample assets, downloaded once into a
// gitignored cache.
//
// **Why this exists alongside `gltf.test.ts`.** That file's fixtures are built
// inline, which makes the bytes readable but also makes them agree with this
// importer by construction — they were written by the same person, the same
// afternoon, from the same reading of the spec. A misreading would be baked into
// both sides and the suite would stay green. These files were not: they are
// Blender/Cesium/Khronos exporter output, and they exercise the combinations a
// hand-written fixture does not think to make (a GLB whose textures live in the
// binary chunk, a mesh with no TANGENT, morph targets with real animation
// tracks, a skin with real inverse bind matrices).
//
// **Network policy.** The download is cached under `tests/assets-cache/`
// (gitignored) and the whole file **skips** rather than fails when it is
// unreachable — a test suite that goes red because GitHub is slow teaches people
// to ignore red. Same shape as `metis-engine/test/fixture.ts`'s sample cache.
// Run once with a connection and it is offline-clean afterwards.
import { beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
    GltfAttributeSemantic,
    GltfIndexFormat,
    GltfImageEncoding,
    GltfInterpolation,
    GltfPrimitiveMode,
    GltfResourceKind,
    GltfResourceSource,
    GltfVertexLayoutMode,
    type GpuAdapter,
    type GpuDevice,
    GPUBufferUsage,
    ImageColorSpace,
    inspectGltf,
    loadGltf,
    requestAdapter,
} from "../index.js";
import { readF32 } from "./helpers/read-buffer.js";

const CACHE = join(import.meta.dir, "assets-cache");
const BASE = "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models";

/** Fetch `remote` into the cache once; returns the local path, or null offline. */
async function cached(remote: string, name: string): Promise<string | null> {
    mkdirSync(CACHE, {recursive: true});
    const dest = join(CACHE, name);
    if (await Bun.file(dest).exists()) {
        return dest;
    }
    try {
        const res = await fetch(`${BASE}/${remote}`, {signal: AbortSignal.timeout(30_000)});
        if (!res.ok) {
            return null;
        }
        await Bun.write(dest, await res.arrayBuffer());
        return dest;
    } catch {
        return null;
    }
}

let adapter: GpuAdapter;
let device: GpuDevice;
let helmet: string | null = null;
let boxTextured: string | null = null;
let morphCube: string | null = null;
let rigged: string | null = null;
let sparse: string | null = null;

beforeAll(async () => {
    adapter = (await requestAdapter())!;
    device = await adapter.requestDevice({label: "gltf-samples"});

    helmet = await cached("DamagedHelmet/glTF-Binary/DamagedHelmet.glb", "DamagedHelmet.glb");
    morphCube = await cached("AnimatedMorphCube/glTF-Binary/AnimatedMorphCube.glb", "AnimatedMorphCube.glb");
    rigged = await cached("RiggedSimple/glTF-Binary/RiggedSimple.glb", "RiggedSimple.glb");
    sparse = await cached("SimpleSparseAccessor/glTF-Embedded/SimpleSparseAccessor.gltf", "SimpleSparseAccessor.gltf");

    // BoxTextured is the separate-files case, so all three parts have to land
    // in the cache next to each other for the relative URIs to resolve.
    const gltf = await cached("BoxTextured/glTF/BoxTextured.gltf", "BoxTextured.gltf");
    const bin = await cached("BoxTextured/glTF/BoxTextured0.bin", "BoxTextured0.bin");
    const png = await cached("BoxTextured/glTF/CesiumLogoFlat.png", "CesiumLogoFlat.png");
    boxTextured = gltf && bin && png ? gltf : null;
}, 120_000);

describe("Khronos sample assets", () => {
    it("imports DamagedHelmet.glb — GLB container, five textures in the binary chunk", async () => {
        if (!helmet) {
            console.warn("skipping: DamagedHelmet.glb unavailable (offline?)");
            return;
        }
        const manifest = await inspectGltf(helmet);
        expect(manifest.isBinary).toBe(true);
        expect(manifest.counts.images).toBe(5);
        // Every resource is inside the container — nothing to resolve on disk.
        for (const r of manifest.resources) {
            expect([GltfResourceSource.BinaryChunk, GltfResourceSource.BufferView]).toContain(r.source);
        }

        const asset = await loadGltf(device, helmet);
        expect(asset.meshes).toHaveLength(1);
        const prim = asset.meshes[0]!.primitives[0]!;
        expect(prim.mode).toBe(GltfPrimitiveMode.Triangles);
        expect(prim.gpuTopology).toBe("triangle-list");
        expect(prim.vertexCount).toBeGreaterThan(10_000);
        expect(prim.indexCount).toBeGreaterThan(30_000);
        // Worth pinning because it is the case the rule is easy to get
        // backwards: this mesh has ~46 000 *indices* but only ~14 500
        // *vertices*, so `Uint16` is correct. The width follows the vertex
        // range, not the index count.
        expect(prim.indexFormat).toBe(GltfIndexFormat.Uint16);
        expect(prim.vertexCount).toBeLessThan(65_536);

        // The mesh ships POSITION/NORMAL/TEXCOORD_0 and no TANGENT.
        const names = prim.layout.attributes.map((a) => a.name).sort();
        expect(names).toEqual(["NORMAL", "POSITION", "TEXCOORD_0"]);
        expect(prim.layout.arrayStride).toBe(32);

        expect(asset.textures).toHaveLength(5);
        for (const t of asset.textures) {
            expect(t.encoding).toBe(GltfImageEncoding.Jpeg);
            expect(t.texture!.width).toBe(2048);
        }
        // Base colour and emissive are sRGB; normal / AO / metallic-roughness
        // are data and must not be transfer-decoded.
        const srgb = asset.textures.filter((t) => t.colorSpace === ImageColorSpace.Srgb);
        expect(srgb).toHaveLength(2);

        const mat = asset.materials[asset.meshes[0]!.primitives[0]!.material]!;
        expect(mat.baseColorTexture).toBeDefined();
        expect(mat.normalTexture).toBeDefined();
        expect(mat.occlusionTexture).toBeDefined();
        expect(mat.metallicRoughnessTexture).toBeDefined();
        expect(mat.emissiveTexture).toBeDefined();
    }, 60_000);

    it("gives DamagedHelmet a full 48-byte layout under Standard, tangents included", async () => {
        if (!helmet) {
            return;
        }
        const asset = await loadGltf(device, helmet, {
            vertexLayout: GltfVertexLayoutMode.Standard,
            loadImages: false,
        });
        const prim = asset.meshes[0]!.primitives[0]!;
        expect(prim.layout.arrayStride).toBe(48);
        expect(prim.layout.attributes.map((a) => a.semantic)).toEqual([
            GltfAttributeSemantic.Position,
            GltfAttributeSemantic.Normal,
            GltfAttributeSemantic.Tangent,
            GltfAttributeSemantic.TexCoord,
        ]);
    }, 60_000);

    it("imports BoxTextured — separate .gltf, .bin and .png sidecars", async () => {
        if (!boxTextured) {
            console.warn("skipping: BoxTextured unavailable (offline?)");
            return;
        }
        const manifest = await inspectGltf(boxTextured);
        expect(manifest.isBinary).toBe(false);
        const external = manifest.resources.filter((r) => r.source === GltfResourceSource.External);
        expect(external.map((r) => r.uri).sort()).toEqual(["BoxTextured0.bin", "CesiumLogoFlat.png"]);
        // The image's resolved path is what an override would otherwise replace.
        const image = manifest.resources.find((r) => r.kind === GltfResourceKind.Image)!;
        expect(image.resolvedPath).toBe(join(CACHE, "CesiumLogoFlat.png"));

        const asset = await loadGltf(device, boxTextured);
        expect(asset.textures).toHaveLength(1);
        expect(asset.textures[0]!.encoding).toBe(GltfImageEncoding.Png);
        expect(asset.textures[0]!.colorSpace).toBe(ImageColorSpace.Srgb);
        expect(asset.textures[0]!.texture!.width).toBe(256);
        // A box: 24 vertices (4 per face, split for per-face normals/UVs).
        expect(asset.meshes[0]!.primitives[0]!.vertexCount).toBe(24);
    }, 60_000);

    it("imports AnimatedMorphCube — morph targets driven by a real weights track", async () => {
        if (!morphCube) {
            console.warn("skipping: AnimatedMorphCube.glb unavailable (offline?)");
            return;
        }
        const asset = await loadGltf(device, morphCube);
        const prim = asset.meshes[0]!.primitives[0]!;
        expect(prim.morphTargets.length).toBe(2);
        // Morph locations continue past the base layout's rather than colliding
        // with it at 0.
        const baseMax = Math.max(...prim.layout.attributes.map((a) => a.shaderLocation));
        for (const t of prim.morphTargets) {
            for (const a of t.layout.attributes) {
                expect(a.shaderLocation).toBeGreaterThan(baseMax);
            }
        }

        expect(asset.animations).toHaveLength(1);
        const sampler = asset.animations[0]!.samplers[0]!;
        expect(asset.animations[0]!.duration).toBeGreaterThan(0);
        // A weights track has one component per morph target.
        expect(sampler.components).toBe(2);
        if (sampler.interpolation === GltfInterpolation.CubicSpline) {
            expect(sampler.valuesPerKeyframe).toBe(6);
        } else {
            expect(sampler.valuesPerKeyframe).toBe(2);
        }
        expect(sampler.output.length).toBe(sampler.input.length * sampler.valuesPerKeyframe);
    }, 60_000);

    it("imports RiggedSimple — a skin with real inverse bind matrices", async () => {
        if (!rigged) {
            console.warn("skipping: RiggedSimple.glb unavailable (offline?)");
            return;
        }
        const asset = await loadGltf(device, rigged);
        expect(asset.skins).toHaveLength(1);
        const skin = asset.skins[0]!;
        expect(skin.joints.length).toBeGreaterThan(0);
        expect(skin.inverseBindMatrices!.length).toBe(skin.joints.length * 16);
        // Every joint index must name a real node.
        for (const j of skin.joints) {
            expect(asset.nodes[j]).toBeDefined();
        }
        // The skinned primitive carries JOINTS_0/WEIGHTS_0, and joints are
        // widened to uint16x4 whatever the file stored them as.
        const prim = asset.meshes[0]!.primitives[0]!;
        const joints = prim.layout.attributes.find((a) => a.semantic === GltfAttributeSemantic.Joints)!;
        expect(joints.format).toBe("uint16x4");
        expect(prim.layout.attributes.some((a) => a.semantic === GltfAttributeSemantic.Weights)).toBe(true);
        // The node referencing the skin is the one the renderer has to find.
        expect(asset.nodes.some((n) => n.skin === 0)).toBe(true);
    }, 60_000);

    it("imports SimpleSparseAccessor — a sparse accessor written by someone else", async () => {
        if (!sparse) {
            console.warn("skipping: SimpleSparseAccessor.gltf unavailable (offline?)");
            return;
        }
        const manifest = await inspectGltf(sparse);
        // The embedded variant carries its buffer as a data: URI.
        expect(manifest.resources[0]!.source).toBe(GltfResourceSource.DataUri);

        const asset = await loadGltf(device, sparse, {
            extraVertexBufferUsage: GPUBufferUsage.COPY_SRC,
        });
        const prim = asset.meshes[0]!.primitives[0]!;
        expect(prim.vertexCount).toBe(14);

        // The base accessor is a flat 7x2 grid: every y is 0 or 1. The sparse
        // block replaces vertices 8, 10 and 12 with y = 2, 3, 4. So reading a 2
        // at vertex 8 is proof the substitution ran — an importer that ignored
        // `sparse` returns the flat grid, with no error and the right vertex
        // count.
        const v = await readF32(device, prim.vertexBuffer, 42);
        expect(v[8 * 3 + 1]).toBe(2);
        expect(v[10 * 3 + 1]).toBe(3);
        expect(v[12 * 3 + 1]).toBe(4);
        expect(v[9 * 3 + 1]).toBe(1); // untouched neighbour
    }, 60_000);
});
