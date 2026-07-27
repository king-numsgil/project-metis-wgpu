import {
    type GpuBindGroup,
    type GpuBindGroupLayout,
    type GpuBuffer,
    GPUBufferUsage,
    type GpuDevice,
    type GpuTextureView,
} from "metis-native";
import { getMaterialDefaults } from "../assets/texture.ts";
import { MaterialUniforms, stage } from "../shading/gpuLayouts.ts";

/** Constructor parameters for {@link Material}. Every field is optional; the defaults are a plain white dielectric. */
export interface MaterialParams {
    /** Linear RGBA albedo factor. Default `[1,1,1,1]`. Alpha is carried but nothing blends yet. */
    baseColor?: [number, number, number, number];
    /** 0 = dielectric, 1 = metal. Intermediate values aren't physical, they're a blend. Default 0. */
    metallic?: number;
    /** Perceptual roughness, 0 = mirror to 1 = fully diffuse. Default 0.5. */
    roughness?: number;
    /** Linear RGB light emitted regardless of lighting. Not a light source — it lights nothing else. Default `[0,0,0]`. */
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
    /** Linear RGBA albedo factor; multiplied by `albedoTexture` if present. */
    baseColor: [number, number, number, number];
    /** Metalness factor; multiplied by `metallicTexture`'s red channel if present. */
    metallic: number;
    /** Roughness factor; multiplied by `roughnessTexture`'s red channel if present. */
    roughness: number;
    /** Emissive factor; multiplied by `emissiveTexture` if present. */
    emissive: [number, number, number];

    albedoTexture?: GpuTextureView;
    normalTexture?: GpuTextureView;
    metallicTexture?: GpuTextureView;
    roughnessTexture?: GpuTextureView;
    emissiveTexture?: GpuTextureView;

    private buffer: GpuBuffer | null = null;
    private bindGroup: GpuBindGroup | null = null;
    /** Per-material CPU staging, created with the GPU buffer on first use. */
    private staging: {
        bytes: Uint8Array;
        baseColor: Float32Array;
        metallicRoughness: Float32Array;
        emissive: Float32Array;
    } | null = null;

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
        if (!this.staging) {
            const s = stage(MaterialUniforms);
            this.staging = {
                bytes: s.bytes,
                baseColor: s.f32("baseColor", 4),
                metallicRoughness: s.f32("metallicRoughness", 4),
                emissive: s.f32("emissive", 3),
            };
            const defaults = getMaterialDefaults(device);
            this.buffer = device.createBuffer({
                label: "metis-engine/material",
                size: MaterialUniforms.byteSize,
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

        const s = this.staging;
        s.baseColor.set(this.baseColor);
        s.metallicRoughness[0] = this.metallic;
        s.metallicRoughness[1] = this.roughness;
        s.emissive.set(this.emissive);

        device.queue.writeBuffer(this.buffer!, 0, s.bytes);
        return this.bindGroup!;
    }

    /**
     * Releases this material's uniform buffer. Does **not** destroy the texture
     * views it was given — those are the caller's (and the shared 1x1 defaults
     * are cached per device and outlive any one material).
     */
    destroy() {
        this.buffer?.destroy();
        this.buffer = null;
        this.bindGroup = null;
        this.staging = null;
    }
}
