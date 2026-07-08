import {
    type GPUTextureFormat,
    type GpuDevice,
    type GpuSampler,
    type GpuTexture,
    type GpuTextureView,
    GPUTextureUsage,
    ImageColorSpace,
    sdlImageLoadTexture,
} from "bun-webgpu-rs";

export interface LoadedTexture {
    texture: GpuTexture;
    view: GpuTextureView;
}

/**
 * Loads an image file into a GPU texture via bun-webgpu-rs's SDL3_image binding
 * (`sdlImageLoadTexture`), which decodes *and* uploads entirely in Rust — the
 * pixel bytes never cross the FFI boundary. Handles PNG/JPG/WebP/… (whatever
 * SDL_image was built with), replacing the engine's former hand-rolled PNG
 * decoder. Async: the decode + upload run on a native worker thread, so a big
 * texture doesn't stall the frame loop, and `Promise.all` of several loads
 * decodes them in parallel.
 *
 * `srgb` should be `true` for colour data (albedo, emissive) and `false` for
 * data maps (normal, metallic, roughness) — see math/PBR shading formulas.md.
 */
export async function loadTexture(device: GpuDevice, path: string, options?: { srgb?: boolean; label?: string }): Promise<LoadedTexture> {
    const texture = await sdlImageLoadTexture(device, path, {
        label: options?.label ?? path,
        colorSpace: options?.srgb ? ImageColorSpace.Srgb : ImageColorSpace.Linear,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
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
