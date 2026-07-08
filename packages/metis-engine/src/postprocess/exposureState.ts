import { GPUBufferUsage, type GpuBuffer, type GpuDevice } from "bun-webgpu-rs";

/**
 * A single persistent f32 in a storage buffer: the current exposure
 * multiplier applied by `TonemapPass`. `AutoExposurePass` (once wired in)
 * overwrites it every frame from a compute shader; until then, call `set()`
 * for a fixed manual exposure.
 */
export class ExposureState {
    readonly buffer: GpuBuffer;

    constructor(device: GpuDevice, initial = 1.0) {
        this.buffer = device.createBuffer({
            label: "metis-engine/exposure",
            size: 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.set(device, initial);
    }

    set(device: GpuDevice, value: number) {
        const bytes = new Float32Array([value]);
        device.queue.writeBuffer(this.buffer, 0, new Uint8Array(bytes.buffer));
    }

    destroy() {
        this.buffer.destroy();
    }
}
