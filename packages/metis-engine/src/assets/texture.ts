import {
    type GPUTextureFormat,
    type GpuDevice,
    type GpuSampler,
    type GpuTexture,
    type GpuTextureView,
    GPUTextureUsage,
} from "bun-webgpu-rs";
import { decodePng } from "./png";

export interface LoadedTexture {
    texture: GpuTexture;
    view: GpuTextureView;
}

/**
 * Loads a PNG from disk into a GPU texture. `srgb` should be `true` for
 * color data (albedo, emissive) and `false` for data maps (normal,
 * metallic, roughness) — see math/PBR shading formulas.md.
 */
export async function loadTexture(device: GpuDevice, path: string, options?: { srgb?: boolean; label?: string }): Promise<LoadedTexture> {
    const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
    const image = decodePng(bytes);
    const format: GPUTextureFormat = options?.srgb ? "rgba8unorm-srgb" : "rgba8unorm";

    const texture = device.createTexture({
        label: options?.label ?? path,
        size: { width: image.width, height: image.height },
        format,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
        { texture },
        image.pixels,
        { bytesPerRow: image.width * 4, rowsPerImage: image.height },
        { width: image.width, height: image.height },
    );

    return { texture, view: texture.createView() };
}

function createSolidTexture(device: GpuDevice, rgba: [number, number, number, number], srgb: boolean, label: string): GpuTextureView {
    const format: GPUTextureFormat = srgb ? "rgba8unorm-srgb" : "rgba8unorm";
    const texture = device.createTexture({
        label,
        size: { width: 1, height: 1 },
        format,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture({ texture }, new Uint8Array(rgba), { bytesPerRow: 4 }, { width: 1, height: 1 });
    return texture.createView();
}

export interface MaterialDefaults {
    sampler: GpuSampler;
    /** 1x1 white, sRGB — multiply-identity for baseColorFactor. */
    albedo: GpuTextureView;
    /** 1x1 flat tangent-space normal (0.5,0.5,1 packed), linear — reproduces the unperturbed vertex normal. */
    normal: GpuTextureView;
    /** 1x1 white, linear — multiply-identity for metallicFactor. */
    metallic: GpuTextureView;
    /** 1x1 white, linear — multiply-identity for roughnessFactor. */
    roughness: GpuTextureView;
    /** 1x1 white, sRGB — multiply-identity for emissiveFactor. */
    emissive: GpuTextureView;
}

const defaultsCache = new WeakMap<GpuDevice, MaterialDefaults>();

/**
 * Every material always binds a full set of 5 textures + 1 sampler (no
 * conditional bind-group layouts) — materials without a given map fall back
 * to one of these neutral 1x1 placeholders, so sampling one is always a
 * mathematical no-op against the material's own factors.
 */
export function getMaterialDefaults(device: GpuDevice): MaterialDefaults {
    let defaults = defaultsCache.get(device);
    if (defaults) return defaults;

    defaults = {
        sampler: device.createSampler({
            magFilter: "linear",
            minFilter: "linear",
            addressModeU: "repeat",
            addressModeV: "repeat",
        }),
        albedo: createSolidTexture(device, [255, 255, 255, 255], true, "metis-engine/default-albedo"),
        normal: createSolidTexture(device, [128, 128, 255, 255], false, "metis-engine/default-normal"),
        metallic: createSolidTexture(device, [255, 255, 255, 255], false, "metis-engine/default-metallic"),
        roughness: createSolidTexture(device, [255, 255, 255, 255], false, "metis-engine/default-roughness"),
        emissive: createSolidTexture(device, [255, 255, 255, 255], true, "metis-engine/default-emissive"),
    };
    defaultsCache.set(device, defaults);
    return defaults;
}
