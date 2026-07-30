import {
    ArrayOf,
    F32,
    type F32Descriptor,
    Mat,
    type MatMemoryBuffer,
    PackingType,
    StructOf,
    U32,
    Vec,
    type VecMemoryBuffer,
    wrap,
} from "metis-data";
import { MAX_LIGHTS } from "./clusterConfig.ts";
import { CASCADE_COUNT, MAX_SHADOW_SPOTS } from "./shadowConfig.ts";

/**
 * Every uniform and storage struct the renderer uploads, as `metis-data`
 * descriptors.
 *
 * **This file is the TypeScript half of `wgsl/common.wgsl`.** Each descriptor
 * below has a struct declaration over there with the same name and field order,
 * and the two must agree byte for byte. Keeping them in one file makes that a
 * diff you can actually perform — before this, the layouts were hand-packed by
 * `Std140Writer` and their sizes lived as seven magic numbers scattered across
 * five files (`CLUSTER_PARAMS_SIZE = 128`, `CASCADE_FORWARD_SIZE = 304`, …),
 * each with a comment asking the reader to trust an arithmetic they couldn't
 * check.
 *
 * Sizes are now *derived*: `CameraUniforms.byteSize` is computed from the
 * members, so adding a field can't silently leave a buffer too small. The one
 * thing still requiring care is the field *order and types* matching the WGSL —
 * metis-data validates the packing rules, not your agreement with the shader.
 *
 * **Packing must be passed to every member, not just the struct** — it isn't
 * inherited, and a `Dense` member inside a `Std140` struct under-aligns and
 * disagrees with the shader silently. metis-data throws on the mismatch for
 * composite members, which is the guard rail; scalars are layout-invariant and
 * never need it.
 *
 * Uniform blocks (`var<uniform>`) use {@link STD140}; storage buffers
 * (`var<storage>`) use {@link STD430}. For everything here except the light
 * array the two are identical, since every member aligns to 16 anyway.
 */

/** Packing for `var<uniform>` bindings. */
const STD140 = PackingType.Std140;
/** Packing for `var<storage>` bindings. */
const STD430 = PackingType.Std430;

const Vec3f = Vec(F32, 3, STD140);
/** std430 `vec3<f32>` — the `GpuLight` members' packing. */
const Vec3fStorage = Vec(F32, 3, STD430);
const Vec4f = Vec(F32, 4, STD140);
const Vec4u = Vec(U32, 4, STD140);
const Mat4f = Mat(F32, 4, STD140);
const Mat3f = Mat(F32, 3, STD140);

// ── Frame uniforms (group 0) ────────────────────────────────────────────────

/** `CameraUniforms` — binding 0. 144 bytes. */
export const CameraUniforms = StructOf({
    viewProj: Mat4f,
    view: Mat4f,
    position: Vec3f,
}, STD140);

/**
 * `EnvironmentUniforms` — binding 1. 48 bytes.
 *
 * Colour and intensity share a vec4 because WGSL would pad them apart anyway:
 * `sunColor` is xyz, `sunIntensity` is w.
 */
export const EnvironmentUniforms = StructOf({
    sunDirection: Vec3f,
    sunColorIntensity: Vec4f,
    ambientColorIntensity: Vec4f,
}, STD140);

// ── Per-instance (group 2) ──────────────────────────────────────────────────

/**
 * `ModelUniforms` — 112 bytes.
 *
 * `normalMatrix` is a std140 `mat3x3`, i.e. **three vec4 columns, 48 bytes** —
 * not 36. Two earlier paths got this right only by coincidence rather than by
 * declaration, so it is worth stating: here the padding *is* the layout, and
 * `stage().mat3()` hands back a buffer that already knows it. A Dense mat3
 * (12-byte columns) written into this slot type-checks and is silently wrong.
 */
export const ModelUniforms = StructOf({
    model: Mat4f,
    normalMatrix: Mat3f,
}, STD140);

// ── The instanced model array (a storage buffer, hence Std430) ───────────────
const Mat4fStorage = Mat(F32, 4, STD430);
const Mat3fStorage = Mat(F32, 3, STD430);

/**
 * `ModelUniforms` again, packed for a **storage** buffer — the element type of
 * the frame's `array<Model>` that every vertex shader indexes by
 * `@builtin(instance_index)`.
 *
 * **It is byte-identical to the Std140 version, and that is a coincidence worth
 * not relying on silently.** `mat4x4<f32>` is 64 bytes under both, and a
 * `mat3x3<f32>` pads its columns to 16 under both (a `vec3` aligns to 16 in
 * std430 too — `mat2x2` is where the two packings actually diverge). Declaring
 * it Std430 anyway costs nothing and means metis-data validates the rules that
 * genuinely apply to the binding, rather than rules that happen to agree today.
 */
export const ModelStorage = StructOf({
    model: Mat4fStorage,
    normalMatrix: Mat3fStorage,
}, STD430);

/**
 * Staging for `capacity` model entries, with a `Mat4f`/`Mat3f` per element
 * **aliasing the upload bytes** — so an instance's matrices are composed
 * directly into what gets uploaded, exactly as the per-instance path did before
 * instancing, but into one shared allocation.
 *
 * The element views are built once here rather than per frame: they are cheap
 * wrappers, but there are two per instance and this runs on every growth, not
 * every frame.
 */
export function stageModelArray(capacity: number): {
    bytes: Uint8Array;
    byteSize: number;
    elements: {model: MatMemoryBuffer<F32Descriptor, 4>; normalMatrix: MatMemoryBuffer<F32Descriptor, 3>}[];
} {
    const desc = ArrayOf(ModelStorage, capacity, STD430);
    const buffer = new ArrayBuffer(desc.byteSize);
    const elements = [];
    for (let i = 0; i < capacity; i++) {
        const base = desc.offsetAt(i);
        elements.push({
            model: wrap(Mat4fStorage, buffer, base + ModelStorage.offsetOf("model")),
            normalMatrix: wrap(Mat3fStorage, buffer, base + ModelStorage.offsetOf("normalMatrix")),
        });
    }
    return {bytes: new Uint8Array(buffer), byteSize: desc.byteSize, elements};
}

/**
 * `MaterialUniforms` — 48 bytes. `metallicRoughness` packs both scalars into
 * one vec4 (xy used, zw unused) exactly as the shader reads them.
 */
export const MaterialUniforms = StructOf({
    baseColor: Vec4f,
    metallicRoughness: Vec4f,
    emissive: Vec3f,
}, STD140);

// ── Clustering (group 3) ────────────────────────────────────────────────────

/**
 * `ClusterParams` — 128 bytes.
 *
 * `screenAndDepth` is `(width, height, clusterNear, clusterFar)`; `counts` is
 * the grid dimensions plus `MAX_LIGHTS_PER_CLUSTER`; `lightCount` carries the
 * live light count in x. `cameraNear` is the *true* camera near plane, which
 * slice 0's AABB is widened down to — see `Camera.clusterNear`.
 */
export const ClusterParams = StructOf({
    invProj: Mat4f,
    screenAndDepth: Vec4f,
    counts: Vec4u,
    lightCount: Vec4u,
    cameraNear: Vec4f,
}, STD140);

/**
 * One `GpuLight` — **exactly 64 bytes, and it is exactly full**.
 *
 * That fullness is load-bearing: there is no room for a shadow-map index, which
 * is why a light's *buffer index* doubles as its spot-shadow layer and why
 * `LightCuller.write` packs the shadow casters first. Adding a field here breaks
 * that arrangement, not just the size.
 *
 * A point light is encoded as a cone that cannot reject anything (`cosOuter =
 * -2`, `spotScale = 1`), so the forward loop needs no branch — see
 * `common.wgsl`'s `spotAttenuation`.
 */
export const GpuLight = StructOf({
    worldPosition: Vec(F32, 3, STD430),
    range: F32,
    viewPosition: Vec(F32, 3, STD430),
    intensity: F32,
    color: Vec(F32, 3, STD430),
    cosOuter: F32,
    worldDirection: Vec(F32, 3, STD430),
    spotScale: F32,
}, STD430);

/** The whole light storage buffer: `array<GpuLight, MAX_LIGHTS>`. */
export const GpuLightArray = ArrayOf(GpuLight, MAX_LIGHTS, STD430);

// ── Shadows ─────────────────────────────────────────────────────────────────

/**
 * `CascadeUniforms` — 304 bytes, frame binding 4.
 *
 * `params` is `(cascadeCount, shadowMapSize, blendFraction, unused)`.
 */
export const CascadeUniforms = StructOf({
    viewProj: ArrayOf(Mat4f, CASCADE_COUNT, STD140),
    splitDepths: Vec4f,
    normalOffsets: Vec4f,
    params: Vec4f,
}, STD140);

/**
 * `SpotShadowUniforms` — 288 bytes, frame binding 3.
 *
 * `params` is `(activeCount, mapSize, normalOffsetTexels, unused)`.
 */
export const SpotShadowUniforms = StructOf({
    viewProj: ArrayOf(Mat4f, MAX_SHADOW_SPOTS, STD140),
    texelScale: Vec4f,
    params: Vec4f,
}, STD140);

/**
 * Dynamic-offset stride for the per-pass light matrix of a single shadow render
 * (one sun cascade, or one spot). Each slice holds a bare 64-byte `mat4`, padded
 * out to satisfy `minUniformBufferOffsetAlignment` — 256 covers every backend
 * this runs on.
 *
 * **This is the one layout here that is not a descriptor.** metis-data has no
 * `@size`/`@align` override, so it cannot express an array whose stride is wider
 * than its element (see its CLAUDE.md, "Known limitations"). The buffer is
 * therefore allocated raw at `count * SHADOW_RENDER_STRIDE` with one
 * `Float32Array` view per slice, built at construction. If that limitation is
 * ever lifted, this becomes an ordinary `ArrayOf`.
 */
export const SHADOW_RENDER_STRIDE = 256;

// ── Ambient occlusion ───────────────────────────────────────────────────────

/**
 * `AoUniforms` — 288 bytes.
 *
 * `screenAndDepth`'s zw (`cameraNear`, `clusterFar`) are informational: the AO
 * shaders reconstruct view position through `invProj` and read only xy.
 * `clusterFar` stands in for the projection's far plane, which is infinite under
 * reverse-Z and would poison the f32.
 */
export const AoUniforms = StructOf({
    view: Mat4f,
    viewProj: Mat4f,
    proj: Mat4f,
    invProj: Mat4f,
    screenAndDepth: Vec4f,
    tuning: Vec4f,
}, STD140);

// ── Post-process ────────────────────────────────────────────────────────────

/** `LuminanceParams` — 16 bytes: `(width, height, tileCountX, tileCount)`. */
export const LuminanceParams = StructOf({
    dims: Vec4u,
}, STD140);

/** `AutoExposureParams` — 16 bytes: `(deltaTime, adaptationTau, exposureCompensation, unused)`. */
export const AutoExposureParams = StructOf({
    params: Vec4f,
}, STD140);

// ── Text / debug ────────────────────────────────────────────────────────────

/** The `VectorText` orthographic projection — a bare 64-byte mat4. */
export const VectorTextFrame = Mat4f;

// ── Staging ─────────────────────────────────────────────────────────────────

/**
 * A CPU-side staging buffer for one struct: the bytes to upload, plus typed
 * views onto each member at its descriptor-computed offset.
 *
 * **Why raw views rather than metis-data's `MemoryBuffer` accessors.** The
 * descriptors are the source of layout truth — every offset below comes from
 * `offsetOf`, so the packing rules and their tests still govern. But the
 * *writing* deliberately bypasses `get()`/`set()`, which allocate a tuple per
 * call (see metis-data DOC.md's allocation table). These writes happen per
 * instance per frame, so they must not allocate; a `Float32Array` at the right
 * offset is the fastest correct thing, and `.set()` on it copies a whole matrix
 * in one call.
 *
 * **{@link StructStaging.mat4} is the exception, and it is the better one where
 * it applies.** It hands back a `Mat4f` *wrapped over these very bytes*, so an
 * out-first op (`Mat4.multiply`, `Mat4.setLookAt`, `Mat4.composeTRS`) writes
 * its result **straight into the upload buffer** — no intermediate matrix and
 * no `.set()` copy at all. That is what moving the renderer's math onto
 * metis-data bought; reach for `mat4` over `f32` whenever the member is a
 * matrix a math op produces. `f32` remains right for a matrix that arrives as
 * loose floats, and for everything that isn't a matrix.
 *
 * Allocate one of these per owner at construction and rewrite it in place. The
 * old `Std140Writer` did the opposite — a fresh `number[]`, a parallel
 * `string[]` of type tags, an `ArrayBuffer`, a `DataView` and a `Uint8Array` on
 * every call, then a word-at-a-time `setFloat32` loop.
 */
export interface StructStaging {
    /** The whole struct, ready to hand to `queue.writeBuffer`. */
    readonly bytes: Uint8Array;
    /** A `Float32Array` over `member`, `count` elements long. */
    f32(member: string, count: number): Float32Array;
    /** A `Uint32Array` over `member`, `count` elements long. */
    u32(member: string, count: number): Uint32Array;
    /** A `Mat4f` **aliasing** `member` — write into it and the upload bytes are already correct. */
    mat4(member: string): MatMemoryBuffer<F32Descriptor, 4>;
    /** A std140 `Mat3f` aliasing `member` — three *vec4* columns, 48 bytes, not 36. */
    mat3(member: string): MatMemoryBuffer<F32Descriptor, 3>;
}

/** Allocates a {@link StructStaging} for `desc`. Call once, at construction. */
export function stage(desc: { byteSize: number; offsetOf(name: string): number }): StructStaging {
    const buffer = new ArrayBuffer(desc.byteSize);
    return {
        bytes: new Uint8Array(buffer),
        f32: (member, count) => new Float32Array(buffer, desc.offsetOf(member), count),
        u32: (member, count) => new Uint32Array(buffer, desc.offsetOf(member), count),
        mat4: (member) => wrap(Mat4f, buffer, desc.offsetOf(member)),
        mat3: (member) => wrap(Mat3f, buffer, desc.offsetOf(member)),
    };
}

/**
 * A `Mat4f` over an arbitrary `ArrayBuffer` at `byteOffset` — for the one
 * layout that isn't a descriptor: the 256-byte-strided shadow render slices
 * (see {@link SHADOW_RENDER_STRIDE}). Same zero-copy property as
 * {@link StructStaging.mat4}.
 */
export function wrapMat4(buffer: ArrayBuffer, byteOffset: number): MatMemoryBuffer<F32Descriptor, 4> {
    return wrap(Mat4f, buffer, byteOffset);
}

/**
 * Staging for a whole `ArrayOf(...)` allocation, addressed by element index.
 *
 * `elementF32(i, member, count)` views one member of element *i*. Element
 * striding uses the descriptor's `arrayPitch`, which is the part that is easy to
 * get wrong by hand — under Std140 an array's element pitch is padded up to 16
 * even when the element itself is smaller.
 */
export function stageArray(
    desc: { byteSize: number; offsetAt(index: number): number },
    element: { offsetOf(name: string): number },
): {
    bytes: Uint8Array;
    elementF32(index: number, member: string, count: number): Float32Array;
    elementVec3(index: number, member: string): VecMemoryBuffer<F32Descriptor, 3>;
} {
    const buffer = new ArrayBuffer(desc.byteSize);
    return {
        bytes: new Uint8Array(buffer),
        elementF32: (index, member, count) =>
            new Float32Array(buffer, desc.offsetAt(index) + element.offsetOf(member), count),
        // Aliases the same bytes as `elementF32`, so a vec3 op can write xyz
        // while the paired scalar in the 16-byte slot is written through the
        // 4-element f32 view — no intermediate vector on the light loop.
        elementVec3: (index, member) =>
            wrap(Vec3fStorage, buffer, desc.offsetAt(index) + element.offsetOf(member)),
    };
}
