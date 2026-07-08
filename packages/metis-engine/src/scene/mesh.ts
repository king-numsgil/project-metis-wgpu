import {
    type GpuBuffer,
    GPUBufferUsage,
    type GpuDevice,
    type GpuRenderPassEncoder,
    type GpuVertexBufferLayout,
} from "bun-webgpu-rs";
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

export class Mesh {
    readonly vertexBuffer: GpuBuffer;
    readonly indexBuffer: GpuBuffer;
    readonly indexCount: number;
    /** Max local-space distance from (0,0,0) across all vertices — used to fit the shadow frustum around a mesh even when it isn't centered on its own origin (e.g. a room's floor at y=0). */
    readonly boundingRadius: number;

    constructor(device: GpuDevice, data: MeshData, label?: string) {
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
        this.vertexBuffer.writeMappedRange(toBytes(data.vertices));
        this.vertexBuffer.unmap();

        this.indexBuffer = device.createBuffer({
            label: label ? `${label}/indices` : undefined,
            size: data.indices.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        this.indexBuffer.writeMappedRange(toBytes(data.indices));
        this.indexBuffer.unmap();

        this.indexCount = data.indices.length;
    }

    bind(pass: GpuRenderPassEncoder) {
        pass.setVertexBuffer(0, this.vertexBuffer);
        pass.setIndexBuffer(this.indexBuffer, "uint32");
    }

    draw(pass: GpuRenderPassEncoder, instanceCount = 1) {
        pass.drawIndexed(this.indexCount, instanceCount);
    }

    destroy() {
        this.vertexBuffer.destroy();
        this.indexBuffer.destroy();
    }
}
