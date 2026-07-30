import {
    type GpuBuffer,
    GPUBufferUsage,
    type GpuDevice,
    type GPUIndexFormat,
    type GpuRenderPassEncoder,
    type GpuVertexBufferLayout,
} from "metis-native";
import type { MeshData } from "../assets/primitives.ts";

/**
 * `[px,py,pz, nx,ny,nz, tx,ty,tz,tw, u,v]` per vertex, stride 48 bytes —
 * matches assets/primitives.ts's MeshBuilder output. `tangent.w` is the
 * bitangent sign (+1/-1) per the standard glTF/MikkTSpace convention,
 * consumed by forward.wgsl to build the TBN basis for normal mapping.
 */
export const MESH_VERTEX_LAYOUT: GpuVertexBufferLayout = {
    arrayStride: 48,
    attributes: [
        {shaderLocation: 0, offset: 0, format: "float32x3"},
        {shaderLocation: 1, offset: 12, format: "float32x3"},
        {shaderLocation: 2, offset: 24, format: "float32x4"},
        {shaderLocation: 3, offset: 40, format: "float32x2"},
    ],
};

function toBytes(view: Float32Array | Uint32Array): Uint8Array {
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

let nextMeshId = 0;

/**
 * Pre-built GPU buffers to wrap in a `Mesh`, instead of vertex data to upload.
 *
 * This is the glTF path: `metis-native`'s importer has already interleaved and
 * uploaded the geometry (in {@link MESH_VERTEX_LAYOUT}'s exact layout, via its
 * `GltfVertexLayoutMode.Standard`), so re-uploading it here would be a pointless
 * round trip through the CPU. `boundingRadius` comes with it because it cannot
 * be recomputed once the data is on the GPU — the importer reports the glTF
 * POSITION accessor's declared `min`/`max`, which is where it comes from.
 */
export interface ImportedMeshBuffers {
    vertexBuffer: GpuBuffer;
    indexBuffer: GpuBuffer;
    indexCount: number;
    indexFormat: GPUIndexFormat;
    /** Max local-space distance from the origin; see {@link Mesh.boundingRadius}. */
    boundingRadius: number;
}

/**
 * GPU vertex + index buffers for one piece of geometry, uploaded once at
 * construction (or adopted from {@link ImportedMeshBuffers}). Immutable
 * afterwards — there is no update path; rebuild a `Mesh` if the geometry changes.
 *
 * Freely shared between `SceneInstance`s (that's the point: per-instance state
 * lives in the instance's model matrix, not here).
 *
 * **Triangles must wind CCW as seen from the outside** — the forward pipeline
 * culls back faces. Getting this wrong renders the interior of a solid with
 * outward normals attached to the far side, which reads as lights appearing on
 * the wrong side and specular vanishing, not as an obviously broken mesh (see
 * `uvSphere` in assets/primitives.ts for the shipped instance of that bug).
 */
export class Mesh {
    /**
     * Process-unique, monotonically increasing. Exists so draw sorting has an
     * integer key (see `shading/drawBatching.ts`) instead of hashing object
     * identity every frame. Not stable across runs and not meaningful to
     * compare for anything but grouping.
     */
    readonly id: number = nextMeshId++;
    readonly vertexBuffer: GpuBuffer;
    readonly indexBuffer: GpuBuffer;
    readonly indexCount: number;
    /**
     * Index element width. `"uint32"` for everything `assets/primitives.ts`
     * builds; glTF meshes are commonly `"uint16"`, and binding the wrong one
     * reads pairs of indices as one and draws confetti rather than failing.
     */
    readonly indexFormat: GPUIndexFormat;
    /** Max local-space distance from (0,0,0) across all vertices — used to fit the shadow frustum around a mesh even when it isn't centered on its own origin (e.g. a room's floor at y=0). */
    readonly boundingRadius: number;
    /** Debug name, as passed to the constructor. Names this mesh's GPU buffers and its per-draw zone in the profiler tree. */
    readonly label: string | undefined;

    /**
     * @param source either interleaved vertices in {@link MESH_VERTEX_LAYOUT}'s
     *   layout plus u32 indices, or {@link ImportedMeshBuffers} to adopt
     *   buffers something else already uploaded.
     * @param label debug name for the GPU buffers and the profiler's per-draw zone.
     */
    constructor(device: GpuDevice, source: MeshData | ImportedMeshBuffers, label?: string) {
        this.label = label;
        if (!("vertices" in source)) {
            this.vertexBuffer = source.vertexBuffer;
            this.indexBuffer = source.indexBuffer;
            this.indexCount = source.indexCount;
            this.indexFormat = source.indexFormat;
            this.boundingRadius = source.boundingRadius;
            return;
        }
        const data = source;
        this.indexFormat = "uint32";
        let maxDistSq = 0;
        for (let i = 0; i < data.vertices.length; i += 12) {
            const x = data.vertices[i]!;
            const y = data.vertices[i + 1]!;
            const z = data.vertices[i + 2]!;
            const distSq = x * x + y * y + z * z;
            if (distSq > maxDistSq) {
                maxDistSq = distSq;
            }
        }
        this.boundingRadius = Math.sqrt(maxDistSq);

        this.vertexBuffer = device.createBuffer({
            label: label ? `${label}/vertices` : undefined,
            size: data.vertices.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Uint8Array(this.vertexBuffer.getMappedRange()).set(toBytes(data.vertices));
        this.vertexBuffer.unmap();

        this.indexBuffer = device.createBuffer({
            label: label ? `${label}/indices` : undefined,
            size: data.indices.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Uint8Array(this.indexBuffer.getMappedRange()).set(toBytes(data.indices));
        this.indexBuffer.unmap();

        this.indexCount = data.indices.length;
    }

    /** Sets this mesh's vertex + index buffers on `pass`. Call before {@link draw}. */
    bind(pass: GpuRenderPassEncoder) {
        pass.setVertexBuffer(0, this.vertexBuffer);
        pass.setIndexBuffer(this.indexBuffer, this.indexFormat);
    }

    /**
     * Issues the indexed draw. Requires a prior {@link bind} on the same pass.
     *
     * `firstInstance` is the base of `@builtin(instance_index)` in the vertex
     * shader, which every pass uses to index the frame's shared model array —
     * so it is the run's start position in the renderer's draw order, not a
     * decoration. See `shading/modelBuffer.ts`.
     */
    draw(pass: GpuRenderPassEncoder, instanceCount = 1, firstInstance = 0) {
        pass.drawIndexed(this.indexCount, instanceCount, 0, 0, firstInstance);
    }

    /** Releases both buffers. Every instance referencing this mesh becomes unusable. */
    destroy() {
        this.vertexBuffer.destroy();
        this.indexBuffer.destroy();
    }
}
