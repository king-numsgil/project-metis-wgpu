import {
    type GpuBindGroup,
    type GpuBindGroupLayout,
    type GpuBuffer,
    GPUBufferUsage,
    type GpuDevice,
    type GpuTextureView,
} from "bun-webgpu-rs";
import { getMaterialDefaults } from "../assets/texture.ts";
import { Std140Writer } from "../shading/std140.ts";

export interface MaterialParams {
    baseColor?: [number, number, number, number];
    metallic?: number;
    roughness?: number;
    emissive?: [number, number, number];
    /** Multiplied by `baseColor` (sRGB source data — see math/PBR shading formulas.md). */
    albedoTexture?: GpuTextureView;
    /** Tangent-space normal map (linear, `[0,1]` packed to `[-1,1]` in the shader). */
    normalTexture?: GpuTextureView;
    /** Red channel multiplied by `metallic` (linear). */
    metallicTexture?: GpuTextureView;
    /** Red channel multiplied by `roughness` (linear). */
    roughnessTexture?: GpuTextureView;
    /** Multiplied by `emissive` (sRGB source data). */
    emissiveTexture?: GpuTextureView;
}

/**
 * A metallic-roughness PBR material (glTF-style factors), optionally
 * textured. Every material binds a full set of 5 textures + 1 sampler
 * regardless of whether it has real ones — see assets/texture.ts's
 * `getMaterialDefaults` for why (fixed bind-group layout, no shader
 * branching on "has texture" flags).
 */
export class Material {
    baseColor: [number, number, number, number];
    metallic: number;
    roughness: number;
    emissive: [number, number, number];

    albedoTexture?: GpuTextureView;
    normalTexture?: GpuTextureView;
    metallicTexture?: GpuTextureView;
    roughnessTexture?: GpuTextureView;
    emissiveTexture?: GpuTextureView;

    private buffer: GpuBuffer | null = null;
    private bindGroup: GpuBindGroup | null = null;

    constructor(params?: MaterialParams) {
        this.baseColor = params?.baseColor ?? [1, 1, 1, 1];
        this.metallic = params?.metallic ?? 0.0;
        this.roughness = params?.roughness ?? 0.5;
        this.emissive = params?.emissive ?? [0, 0, 0];
        this.albedoTexture = params?.albedoTexture;
        this.normalTexture = params?.normalTexture;
        this.metallicTexture = params?.metallicTexture;
        this.roughnessTexture = params?.roughnessTexture;
        this.emissiveTexture = params?.emissiveTexture;
    }

    /** Uploads current factors and returns a bind group for group(1) of the forward pipeline. Cheap to call every frame. */
    getBindGroup(device: GpuDevice, layout: GpuBindGroupLayout): GpuBindGroup {
        const w = new Std140Writer();
        w.vec4(this.baseColor[0], this.baseColor[1], this.baseColor[2], this.baseColor[3]);
        w.vec4(this.metallic, this.roughness, 0, 0);
        w.vec3(this.emissive);
        const bytes = w.toBytes();

        if (!this.buffer) {
            const defaults = getMaterialDefaults(device);
            this.buffer = device.createBuffer({
                label: "metis-engine/material",
                size: bytes.byteLength,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
            this.bindGroup = device.createBindGroup({
                label: "metis-engine/material-bind-group",
                layout,
                entries: [
                    {binding: 0, buffer: {buffer: this.buffer}},
                    {binding: 1, sampler: defaults.sampler},
                    {binding: 2, textureView: this.albedoTexture ?? defaults.albedo},
                    {binding: 3, textureView: this.normalTexture ?? defaults.normal},
                    {binding: 4, textureView: this.metallicTexture ?? defaults.metallic},
                    {binding: 5, textureView: this.roughnessTexture ?? defaults.roughness},
                    {binding: 6, textureView: this.emissiveTexture ?? defaults.emissive},
                ],
            });
        }

        device.queue.writeBuffer(this.buffer, 0, bytes);
        return this.bindGroup!;
    }

    destroy() {
        this.buffer?.destroy();
        this.buffer = null;
        this.bindGroup = null;
    }
}
