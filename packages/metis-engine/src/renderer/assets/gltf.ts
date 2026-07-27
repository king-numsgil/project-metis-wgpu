import type { GpuDevice } from "metis-native";
import { dirname, join } from "node:path";
import { Mat4, Vec3 } from "metis-data";
import { type Mat4f, mat4f, quatf, vec3f } from "../math/types.ts";
import { Material, type MaterialParams } from "../scene/material.ts";
import { Mesh } from "../scene/mesh.ts";
import { SceneInstance } from "../scene/scene.ts";
import type { MeshData } from "./primitives.ts";

/**
 * A deliberately small glTF 2.0 subset — just enough to load one of the
 * plainer Khronos sample assets, not a general-purpose importer. No
 * external glTF library is used (per the "be careful with WebGPU-stack
 * compatibility" constraint on third-party deps — this is a hand-rolled
 * ~150-line reader instead).
 *
 * Supported: a `.gltf` JSON file with one sibling binary buffer referenced
 * by a relative `uri` (no embedded base64 data URIs, no `.glb`); a node
 * hierarchy using either `matrix` or `translation`/`rotation`/`scale`;
 * triangle-list primitives with `POSITION` + `NORMAL` (required) and
 * `TEXCOORD_0` (optional, defaults to (0,0)) as `f32` accessors; `u16` or
 * `u32` indices; and `pbrMetallicRoughness` factors only — any texture
 * reference is ignored with a warning. `Material` itself *does* support
 * textures (see math/PBR shading formulas.md); this loader simply reads no
 * image data, samplers, or `TANGENT` accessor yet, so glTF textures aren't
 * wired through.
 */

interface GltfAccessor {
    bufferView: number;
    byteOffset?: number;
    componentType: number;
    count: number;
    type: "SCALAR" | "VEC2" | "VEC3" | "VEC4";
}

interface GltfBufferView {
    buffer: number;
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
}

interface GltfNode {
    children?: number[];
    mesh?: number;
    matrix?: number[];
    translation?: [number, number, number];
    rotation?: [number, number, number, number];
    scale?: [number, number, number];
}

interface GltfPrimitive {
    attributes: { POSITION: number; NORMAL: number; TEXCOORD_0?: number };
    indices: number;
    material?: number;
    mode?: number;
}

interface GltfDocument {
    scenes: { nodes: number[] }[];
    scene?: number;
    nodes: GltfNode[];
    meshes: { primitives: GltfPrimitive[] }[];
    accessors: GltfAccessor[];
    bufferViews: GltfBufferView[];
    buffers: { uri: string; byteLength: number }[];
    materials?: { pbrMetallicRoughness?: Record<string, unknown> }[];
}

const COMPONENT_SIZE: Record<number, number> = {5121: 1, 5123: 2, 5125: 4, 5126: 4};
const TYPE_COMPONENT_COUNT: Record<string, number> = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4};

function nodeLocalMatrix(node: GltfNode): Mat4f {
    const m = mat4f();
    if (node.matrix) {
        // glTF stores a node matrix column-major, same as a metis-data mat4.
        m.view().set(node.matrix);
        return m;
    }
    const t = node.translation ?? [0, 0, 0];
    const r = node.rotation ?? [0, 0, 0, 1];
    const s = node.scale ?? [1, 1, 1];
    // T * R * S, closed-form. glTF's rotation is XYZW, which is `Quatf`'s
    // storage order too.
    return Mat4.composeTRS(
        m,
        t[0]!, t[1]!, t[2]!,
        quatf(r[0]!, r[1]!, r[2]!, r[3]!),
        s[0]!, s[1]!, s[2]!,
    );
}

/**
 * Loads a `.gltf` file into ready-to-add `SceneInstance`s — one per mesh-bearing
 * node, with the node's world matrix baked into `modelMatrixOverride`. Meshes
 * and materials are deduped across nodes.
 *
 * See this file's header for the exact supported subset; it is deliberately
 * narrow. The instances are *not* added to any `Scene` — push them onto
 * `scene.instances` yourself.
 *
 * @param gltfPath path to the `.gltf`; its `.bin` is resolved relative to it.
 * @throws on anything outside the subset — multiple/embedded buffers, a
 *   non-triangle primitive mode, or an unreadable accessor.
 */
export async function loadGltf(device: GpuDevice, gltfPath: string): Promise<SceneInstance[]> {
    const doc = JSON.parse(await Bun.file(gltfPath).text()) as GltfDocument;
    const dir = dirname(gltfPath);

    if (doc.buffers.length !== 1 || !doc.buffers[0]!.uri) {
        throw new Error("metis-engine gltf loader: only a single external-buffer .gltf is supported");
    }
    const binary = await Bun.file(join(dir, doc.buffers[0]!.uri)).arrayBuffer();

    const readAccessor = (index: number): {
        data: Float32Array | Uint16Array | Uint32Array;
        componentCount: number
    } => {
        const accessor = doc.accessors[index]!;
        const view = doc.bufferViews[accessor.bufferView]!;
        const componentCount = TYPE_COMPONENT_COUNT[accessor.type]!;
        const componentSize = COMPONENT_SIZE[accessor.componentType]!;
        const elementSize = componentCount * componentSize;
        const stride = view.byteStride ?? elementSize;
        const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);

        const Ctor = accessor.componentType === 5126 ? Float32Array : accessor.componentType === 5125 ? Uint32Array : Uint16Array;
        const out = new Ctor(accessor.count * componentCount);
        for (let i = 0; i < accessor.count; i++) {
            const elementOffset = base + i * stride;
            const src = new Ctor(binary, elementOffset, componentCount);
            out.set(src, i * componentCount);
        }
        return {data: out, componentCount};
    };

    const meshCache = new Map<number, Mesh>();
    const materialCache = new Map<number, Material>();

    const getMesh = (meshIndex: number): Mesh => {
        let mesh = meshCache.get(meshIndex);
        if (mesh) {
            return mesh;
        }

        const primitive = doc.meshes[meshIndex]!.primitives[0]!;
        if (primitive.mode !== undefined && primitive.mode !== 4) {
            throw new Error(`metis-engine gltf loader: unsupported primitive mode ${primitive.mode} (only TRIANGLES)`);
        }

        const positions = readAccessor(primitive.attributes.POSITION).data as Float32Array;
        const normals = readAccessor(primitive.attributes.NORMAL).data as Float32Array;
        const uvs =
            primitive.attributes.TEXCOORD_0 !== undefined
                ? (readAccessor(primitive.attributes.TEXCOORD_0).data as Float32Array)
                : null;
        const indicesRaw = readAccessor(primitive.indices).data;

        // This loader doesn't read a TANGENT accessor (out of scope — see
        // this file's doc comment), so normal mapping on loaded glTF content
        // isn't meaningful yet; an arbitrary-but-consistent perpendicular
        // vector keeps the TBN basis in forward.wgsl well-defined either way.
        const vertexCount = positions.length / 3;
        const vertices = new Float32Array(vertexCount * 12);
        for (let i = 0; i < vertexCount; i++) {
            const nx = normals[i * 3 + 0]!;
            const ny = normals[i * 3 + 1]!;
            const nz = normals[i * 3 + 2]!;
            const up = Math.abs(ny) > 0.99 ? vec3f(1, 0, 0) : vec3f(0, 1, 0);
            const tangent = Vec3.normalize(vec3f(), Vec3.cross(vec3f(), up, vec3f(nx, ny, nz))).view();
            vertices[i * 12 + 0] = positions[i * 3 + 0]!;
            vertices[i * 12 + 1] = positions[i * 3 + 1]!;
            vertices[i * 12 + 2] = positions[i * 3 + 2]!;
            vertices[i * 12 + 3] = nx;
            vertices[i * 12 + 4] = ny;
            vertices[i * 12 + 5] = nz;
            vertices[i * 12 + 6] = tangent[0]!;
            vertices[i * 12 + 7] = tangent[1]!;
            vertices[i * 12 + 8] = tangent[2]!;
            vertices[i * 12 + 9] = 1;
            vertices[i * 12 + 10] = uvs ? uvs[i * 2 + 0]! : 0;
            vertices[i * 12 + 11] = uvs ? uvs[i * 2 + 1]! : 0;
        }
        const indices = indicesRaw instanceof Uint32Array ? indicesRaw : Uint32Array.from(indicesRaw);

        const data: MeshData = {vertices, indices};
        mesh = new Mesh(device, data, `gltf-mesh-${meshIndex}`);
        meshCache.set(meshIndex, mesh);
        return mesh;
    };

    const getMaterial = (materialIndex: number | undefined): Material => {
        const key = materialIndex ?? -1;
        let material = materialCache.get(key);
        if (material) {
            return material;
        }

        const pbr = (materialIndex !== undefined ? doc.materials?.[materialIndex]?.pbrMetallicRoughness : undefined) ?? {};
        if ("baseColorTexture" in pbr || "metallicRoughnessTexture" in pbr) {
            console.warn(`metis-engine gltf loader: material ${materialIndex} references a texture — ignored, factors only`);
        }
        const params: MaterialParams = {
            baseColor: (pbr.baseColorFactor as [number, number, number, number]) ?? [1, 1, 1, 1],
            metallic: (pbr.metallicFactor as number) ?? 1,
            roughness: (pbr.roughnessFactor as number) ?? 1,
        };
        material = new Material(params);
        materialCache.set(key, material);
        return material;
    };

    const sceneNodes = doc.scenes[doc.scene ?? 0]!.nodes;
    const instances: SceneInstance[] = [];

    // Node world matrices come from an arbitrary quaternion rotation +
    // non-uniform scale, which can't be losslessly decomposed back into
    // Transform's position/Euler-rotation/scale fields — SceneInstance's
    // `modelMatrixOverride` bypasses that decomposition entirely.
    const visit = (nodeIndex: number, parentWorld: Mat4f) => {
        const node = doc.nodes[nodeIndex]!;
        const world = Mat4.multiply(mat4f(), parentWorld, nodeLocalMatrix(node));

        if (node.mesh !== undefined) {
            const primitive = doc.meshes[node.mesh]!.primitives[0]!;
            const instance = new SceneInstance(getMesh(node.mesh), getMaterial(primitive.material));
            instance.modelMatrixOverride = Mat4.copy(mat4f(), world);
            instances.push(instance);
        }

        for (const child of node.children ?? []) {
            visit(child, world);
        }
    };

    for (const rootIndex of sceneNodes) {
        visit(rootIndex, mat4f());
    }

    return instances;
}
