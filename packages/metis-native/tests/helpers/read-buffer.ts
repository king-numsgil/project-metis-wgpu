// Reads a `GpuBuffer`'s contents back to the CPU, for tests that need to assert
// on the *bytes* an importer produced rather than on its metadata.
//
// This is the glTF suite's equivalent of `texture-render.ts`: without it, a test
// can only check that a buffer of a plausible size exists, which cannot catch a
// mis-strided read, a sparse substitution that never happened, or an index
// widened to the wrong width. All of those produce a correctly-sized buffer full
// of wrong numbers, and none of them raises a validation error.
//
// The buffer under test must have been created with `COPY_SRC` — `loadGltf`'s
// `extraVertexBufferUsage` / `extraIndexBufferUsage` options exist for exactly
// this, since the default usage is `VERTEX | COPY_DST`.
import { type GpuBuffer, GPUBufferUsage, type GpuDevice, GPUMapMode } from "../../index.js";

export async function readBuffer(device: GpuDevice, src: GpuBuffer, byteLength?: number): Promise<Uint8Array> {
    // Copy sizes must be a multiple of 4; the importer already rounds buffer
    // sizes up, so `src.size` is safe to use whole.
    const size = Math.ceil((byteLength ?? src.size) / 4) * 4;
    const staging = device.createBuffer({
        label: "test/readback",
        size,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(src, 0, staging, 0, size);
    device.queue.submit([encoder.finish()]);

    await staging.mapAsync(GPUMapMode.READ);
    // The mapped range aliases GPU memory and is detached by `unmap()`, so this
    // has to copy out before unmapping — see metis-native's DOC.md §4.
    const copy = new Uint8Array(staging.getMappedRange()).slice(0, byteLength ?? size);
    staging.unmap();
    staging.destroy();
    return copy;
}

export async function readF32(device: GpuDevice, src: GpuBuffer, count: number): Promise<Float32Array> {
    const bytes = await readBuffer(device, src, count * 4);
    return new Float32Array(bytes.buffer, bytes.byteOffset, count);
}

export async function readU16(device: GpuDevice, src: GpuBuffer, count: number): Promise<Uint16Array> {
    const bytes = await readBuffer(device, src, count * 2);
    return new Uint16Array(bytes.buffer, bytes.byteOffset, count);
}
