// Shared demo/fixture asset helpers — downloads + caches a real CC0 PBR
import { type GpuDevice, GPUTextureUsage, type GpuTextureView } from "metis-native";
import { loadTexture } from "metis-engine/renderer";
// texture set once (Poly Haven's "metal_plate_02", via its public file API)
// and generates a synthetic emissive "instrument panel" texture, so both the
// headless fixture (test/fixture.ts) and the interactive windowed demos
// (examples/*-demo.ts) can showcase albedo/normal/metallic/roughness/
// emissive textures without duplicating the download/decode logic.
import { mkdirSync } from "node:fs";

const CACHE_DIR = new URL(".asset-cache/metal_plate_02/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const POLYHAVEN_BASE = "https://dl.polyhaven.org/file/ph-assets/Textures/png/1k/metal_plate_02/";
const POLYHAVEN_FILES = {
    albedo: "metal_plate_02_diff_1k.png",
    normal: "metal_plate_02_nor_gl_1k.png",
    roughness: "metal_plate_02_rough_1k.png",
    metal: "metal_plate_02_metal_1k.png",
};

export interface MetalPlateTextures {
    albedo: GpuTextureView;
    normal: GpuTextureView;
    metallic: GpuTextureView;
    roughness: GpuTextureView;
}

/** Downloads (once, cached under examples/.asset-cache/, gitignored) and loads Poly Haven's CC0 "metal_plate_02" PBR set. */
export async function loadMetalPlateTextures(device: GpuDevice): Promise<MetalPlateTextures> {
    mkdirSync(CACHE_DIR, {recursive: true});
    const paths = {} as Record<keyof typeof POLYHAVEN_FILES, string>;
    for (const [key, file] of Object.entries(POLYHAVEN_FILES) as [keyof typeof POLYHAVEN_FILES, string][]) {
        const dest = `${CACHE_DIR}${file}`;
        if (!(await Bun.file(dest).exists())) {
            console.log(`downloading ${file}...`);
            const response = await fetch(`${POLYHAVEN_BASE}${file}`);
            if (!response.ok) {
                throw new Error(`failed to download ${file}: ${response.status}`);
            }
            await Bun.write(dest, await response.arrayBuffer());
        }
        paths[key] = dest;
    }

    const [albedo, normal, metal, roughness] = await Promise.all([
        loadTexture(device, paths.albedo, {srgb: true, label: "metal-plate-albedo"}),
        loadTexture(device, paths.normal, {srgb: false, label: "metal-plate-normal"}),
        loadTexture(device, paths.metal, {srgb: false, label: "metal-plate-metallic"}),
        loadTexture(device, paths.roughness, {srgb: false, label: "metal-plate-roughness"}),
    ]);
    return {albedo: albedo.view, normal: normal.view, metallic: metal.view, roughness: roughness.view};
}

/**
 * A synthetic "instrument panel" emissive texture — not a downloaded asset
 * (no suitable small CC0 emissive-only PNG was sourced), but real GPU
 * texture data exercising the same emissiveTexture sampling path an actual
 * cockpit-screen texture would use.
 */
export function makeEmissivePanelTexture(device: GpuDevice): GpuTextureView {
    const size = 64;
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4;
            const cellX = x % 16;
            const cellY = y % 16;
            const inButton = cellX > 2 && cellX < 13 && cellY > 2 && cellY < 13;
            const on = inButton && (Math.floor(x / 16) + Math.floor(y / 16)) % 2 === 0;
            if (on) {
                pixels.set([60, 220, 255, 255], i);
            } else {
                pixels.set([0, 0, 0, 255], i);
            }
        }
    }
    const texture = device.createTexture({
        label: "metis-engine/synthetic-emissive-panel",
        size: {width: size, height: size},
        format: "rgba8unorm-srgb",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture({texture}, pixels, {bytesPerRow: size * 4}, {width: size, height: size});
    return texture.createView();
}
