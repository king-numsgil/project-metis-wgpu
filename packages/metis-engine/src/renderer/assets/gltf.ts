import {
    GltfAlphaMode,
    type GltfAsset,
    GltfIndexFormat,
    type GltfMaterial,
    GltfVertexLayoutMode,
    type GltfTexture,
    GPUBufferUsage,
    type GpuDevice,
    type GpuTextureView,
    loadGltf as loadGltfNative,
} from "metis-native";
import { Mat4 } from "metis-data";
import { type Mat4f, mat4f, quatf } from "../math/types.ts";
import { Material, type MaterialParams } from "../scene/material.ts";
import { Mesh } from "../scene/mesh.ts";
import { SceneInstance } from "../scene/scene.ts";

/**
 * glTF 2.0 import, as a thin adapter over `metis-native`'s importer.
 *
 * **This file used to be the importer.** It was ~150 hand-rolled lines that read
 * a `.gltf`'s JSON, walked its accessors, and handled a deliberately narrow
 * subset: one external `.bin` (no `.glb`, no `data:` URIs), `f32`
 * POSITION/NORMAL/optional-TEXCOORD_0, `u16`/`u32` indices, no textures, no
 * tangents, and a throw for anything else. That whole reader is gone; the
 * parsing, accessor decoding, texture decoding and GPU upload now happen in Rust
 * (`metis-native/src/gltf/`), off the JS thread, with the full spec behind it —
 * sparse accessors, interleaved `byteStride`, quantised attributes, morph
 * targets, skins, animations, `KHR_*` material extensions.
 *
 * What is left here is the part that is genuinely this engine's: turning a
 * `GltfAsset` into `SceneInstance`s, which means the node-hierarchy walk and the
 * `GltfMaterial` → {@link Material} mapping. Everything above that line lives in
 * the native importer, and the native one is where a glTF feature gets added.
 *
 * ## The one thing this adapter asks the importer for
 *
 * `GltfVertexLayoutMode.Standard`. The engine has exactly one vertex layout
 * ({@link MESH_VERTEX_LAYOUT}, stride 48) and one forward pipeline built against
 * it, so a per-primitive layout would mean a pipeline variant per mesh. Standard
 * mode guarantees position/normal/tangent/uv at locations 0-3 whatever the file
 * actually contains — synthesising normals and tangents when they are missing,
 * which is also what closes the old loader's "fabricates an arbitrary
 * perpendicular tangent" limitation. The buffers it produces are already in this
 * engine's layout, so `Mesh` adopts them rather than re-uploading.
 *
 * ## What still isn't wired, and why
 *
 * `Material` has separate `metallicTexture`/`roughnessTexture` slots and glTF
 * has one packed `metallicRoughnessTexture` (metallic in blue, roughness in
 * green). The same handle is bound to both slots and `forward.wgsl` reads the
 * matching channel from each — see the comment there. Skins, morph targets and
 * animations come back on the `GltfAsset` and are **not** consumed: the renderer
 * has no skinning or morph pipeline, so wiring them here would be inventing an
 * API for something that cannot draw yet. Use {@link loadGltfAsset} to reach
 * them.
 */

/** Options forwarded to the native importer, minus the ones this adapter fixes. */
export interface LoadGltfOptions {
    /** Debug-label prefix for created GPU resources. Defaults to the file name. */
    label?: string;
    /** Skip texture decoding entirely — factors only, and much faster. */
    loadImages?: boolean;
    /** `maxAnisotropy` for the samplers the importer creates. Defaults to 1. */
    maxAnisotropy?: number;
}

/**
 * Import a `.gltf` or `.glb` and return the raw `GltfAsset` — the whole scene
 * graph plus GPU handles, exactly as `metis-native` produced it.
 *
 * Reach for this when you need what {@link loadGltf} throws away: animations,
 * skins, morph targets, cameras, `KHR_lights_punctual` lights, per-material
 * extension data, or the node hierarchy itself rather than a flattened instance
 * list.
 */
export async function loadGltfAsset(
    device: GpuDevice,
    gltfPath: string,
    options: LoadGltfOptions = {},
): Promise<GltfAsset> {
    return await loadGltfNative(device, gltfPath, {
        label: options.label,
        loadImages: options.loadImages,
        maxAnisotropy: options.maxAnisotropy,
        // The engine draws every mesh with one pipeline, so every mesh needs one
        // layout. See this file's header.
        vertexLayout: GltfVertexLayoutMode.Standard,
    });
}

/**
 * Load a `.gltf`/`.glb` into ready-to-add `SceneInstance`s — one per
 * mesh-primitive-bearing node, with the node's world matrix baked into
 * `modelMatrixOverride`. Meshes and materials are shared across nodes that
 * reference the same ones.
 *
 * The instances are *not* added to any `Scene` — push them onto
 * `scene.instances` yourself.
 *
 * A primitive whose topology WebGPU cannot draw (`gpuTopology === null`, only
 * possible for a `LINE_LOOP`/`TRIANGLE_FAN` the importer was told not to
 * rewrite) or that is not a triangle list is skipped with a warning: the forward
 * pipeline is triangle-list only, and drawing a line strip through it would be a
 * validation error this binding does not throw on.
 *
 * @throws if the file is malformed, a resource is missing, or it requires a glTF
 *   extension the native importer does not implement — see its `gltf/mod.rs`.
 */
export async function loadGltf(
    device: GpuDevice,
    gltfPath: string,
    options: LoadGltfOptions = {},
): Promise<SceneInstance[]> {
    const asset = await loadGltfAsset(device, gltfPath, options);
    return instancesFromAsset(device, asset);
}

/** The {@link loadGltf} half that works on an already-loaded {@link GltfAsset}. */
export function instancesFromAsset(device: GpuDevice, asset: GltfAsset): SceneInstance[] {
    const views = new Map<number, GpuTextureView>();
    const textureView = (index: number | undefined | null): GpuTextureView | undefined => {
        if (index === undefined || index === null) {
            return undefined;
        }
        const existing = views.get(index);
        if (existing) {
            return existing;
        }
        const entry: GltfTexture | undefined = asset.textures[index];
        if (!entry?.texture) {
            return undefined;
        }
        const view = entry.texture.createView();
        views.set(index, view);
        return view;
    };

    const materials = asset.materials.map((m) => toMaterial(m, textureView));

    // One Mesh per (mesh, primitive) pair — glTF's "mesh" is a group of
    // primitives with independent materials, which is a SceneInstance each.
    const meshes = asset.meshes.map((mesh, meshIndex) =>
        mesh.primitives.map((prim, primIndex) => {
            if (prim.gpuTopology !== "triangle-list") {
                console.warn(
                    `metis-engine gltf: skipping mesh ${meshIndex} primitive ${primIndex} — ` +
                    `topology ${prim.gpuTopology ?? "unsupported"} cannot go through the forward pipeline`,
                );
                return null;
            }
            const indexBuffer = prim.indexBuffer ?? sequentialIndices(device, prim.vertexCount);
            return {
                mesh: new Mesh(
                    device,
                    {
                        vertexBuffer: prim.vertexBuffer,
                        indexBuffer,
                        indexCount: prim.indexBuffer ? prim.indexCount : prim.vertexCount,
                        indexFormat: prim.indexBuffer
                            ? prim.indexFormat === GltfIndexFormat.Uint16 ? "uint16" : "uint32"
                            : "uint32",
                        boundingRadius: boundingRadius(prim.min, prim.max),
                    },
                    `gltf-mesh-${meshIndex}-${primIndex}`,
                ),
                material: prim.material,
            };
        }),
    );

    const instances: SceneInstance[] = [];
    const visit = (nodeIndex: number, parentWorld: Mat4f) => {
        const node = asset.nodes[nodeIndex];
        if (!node) {
            return;
        }
        const world = Mat4.multiply(mat4f(), parentWorld, nodeLocalMatrix(node));

        if (node.mesh !== undefined && node.mesh !== null) {
            for (const entry of meshes[node.mesh] ?? []) {
                if (!entry) {
                    continue;
                }
                const instance = new SceneInstance(entry.mesh, materials[entry.material]!);
                // A node's world matrix comes from an arbitrary quaternion plus
                // non-uniform scale, which cannot be losslessly decomposed back
                // into Transform's position/Euler-rotation/scale fields —
                // `modelMatrixOverride` bypasses that decomposition entirely.
                instance.modelMatrixOverride = Mat4.copy(mat4f(), world);
                instances.push(instance);
            }
        }

        for (const child of node.children) {
            visit(child, world);
        }
    };

    const scene = asset.scenes[asset.defaultScene ?? 0];
    for (const root of scene?.nodes ?? []) {
        visit(root, mat4f());
    }
    return instances;
}

/**
 * The node's local transform.
 *
 * The importer always fills in *both* forms — the composed `matrix` and the
 * decomposed TRS — regardless of which the file wrote, so this can just take the
 * matrix. The TRS branch below exists only as a guard for a malformed 16-element
 * array; it is not the normal path, unlike in the hand-rolled loader this
 * replaced.
 */
function nodeLocalMatrix(node: GltfAsset["nodes"][number]): Mat4f {
    const m = mat4f();
    if (node.matrix.length === 16) {
        // glTF stores a node matrix column-major, same as a metis-data mat4.
        m.view().set(node.matrix);
        return m;
    }
    const [tx = 0, ty = 0, tz = 0] = node.translation;
    const [rx = 0, ry = 0, rz = 0, rw = 1] = node.rotation;
    const [sx = 1, sy = 1, sz = 1] = node.scale;
    return Mat4.composeTRS(m, tx, ty, tz, quatf(rx, ry, rz, rw), sx, sy, sz);
}

/**
 * Radius of the sphere at the local origin containing the primitive's AABB.
 *
 * This is the corner of `min`/`max` furthest from (0,0,0), *not* half the
 * diagonal: `Mesh.boundingRadius` is measured from the mesh's own origin, which
 * a glTF primitive is under no obligation to be centred on.
 */
function boundingRadius(min: number[] | undefined | null, max: number[] | undefined | null): number {
    if (!min || !max || min.length < 3 || max.length < 3) {
        // The importer only omits these if the file did, which glTF forbids for
        // POSITION. A zero radius fits no shadow frustum, so fall back to
        // something that at least does not silently cull the mesh.
        return 1;
    }
    let worst = 0;
    for (let corner = 0; corner < 8; corner++) {
        const x = corner & 1 ? max[0]! : min[0]!;
        const y = corner & 2 ? max[1]! : min[1]!;
        const z = corner & 4 ? max[2]! : min[2]!;
        worst = Math.max(worst, x * x + y * y + z * z);
    }
    return Math.sqrt(worst);
}

/** An index buffer of `0..count` for a non-indexed primitive, which `Mesh` requires. */
function sequentialIndices(device: GpuDevice, count: number) {
    const indices = new Uint32Array(count);
    for (let i = 0; i < count; i++) {
        indices[i] = i;
    }
    const buffer = device.createBuffer({
        label: "gltf-generated-indices",
        size: indices.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(indices.buffer));
    buffer.unmap();
    return buffer;
}

function toMaterial(
    m: GltfMaterial,
    textureView: (index: number | undefined | null) => GpuTextureView | undefined,
): Material {
    // glTF's emissiveStrength (KHR_materials_emissive_strength) scales the
    // factor rather than being a separate term, and this engine's HDR chain can
    // take values above 1 — so folding it in here is lossless.
    const strength = m.emissiveStrength;
    const params: MaterialParams = {
        baseColor: [
            m.baseColorFactor[0] ?? 1,
            m.baseColorFactor[1] ?? 1,
            m.baseColorFactor[2] ?? 1,
            m.baseColorFactor[3] ?? 1,
        ],
        metallic: m.metallicFactor,
        roughness: m.roughnessFactor,
        emissive: [
            (m.emissiveFactor[0] ?? 0) * strength,
            (m.emissiveFactor[1] ?? 0) * strength,
            (m.emissiveFactor[2] ?? 0) * strength,
        ],
        albedoTexture: textureView(m.baseColorTexture?.index),
        normalTexture: textureView(m.normalTexture?.index),
        // One packed texture, two slots: forward.wgsl reads metallic from blue
        // and roughness from green, which is glTF's channel assignment.
        metallicTexture: textureView(m.metallicRoughnessTexture?.index),
        roughnessTexture: textureView(m.metallicRoughnessTexture?.index),
        emissiveTexture: textureView(m.emissiveTexture?.index),
    };

    if (m.alphaMode !== GltfAlphaMode.Opaque) {
        // Nothing in the forward pass blends or alpha-tests yet, so a
        // transparent material renders opaque. Say so rather than letting it
        // look like a shading bug.
        console.warn(
            `metis-engine gltf: material '${m.name ?? "(unnamed)"}' uses a non-opaque alphaMode, ` +
            `which the forward pass does not implement — it will render opaque`,
        );
    }
    return new Material(params);
}
