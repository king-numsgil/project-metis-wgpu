import { type GpuBuffer, GPUBufferUsage, type GpuDevice } from "bun-webgpu-rs";

/**
 * A single persistent f32 in a storage buffer: the current exposure
 * multiplier applied by `TonemapPass`. In the default chain
 * (`createDefaultPostProcessPipeline`) `AutoExposurePass` overwrites it every
 * frame from a compute shader; `set()` seeds the initial value, and is also
 * how to pin a fixed manual exposure if the auto-exposure pass is left out.
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
