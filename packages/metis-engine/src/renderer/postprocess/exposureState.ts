import { type GpuBuffer, GPUBufferUsage, type GpuDevice } from "metis-native";

/**
 * A single persistent f32 in a storage buffer: the current exposure
 * multiplier applied by `TonemapPass`. In the default chain
 * (`createDefaultPostProcessPipeline`) `AutoExposurePass` overwrites it every
 * frame from a compute shader; `set()` seeds the initial value, and is also
 * how to pin a fixed manual exposure if the auto-exposure pass is left out.
 */
export class ExposureState {
    /** The 4-byte storage buffer, bound read-write by auto-exposure and read-only by the tonemap. */
    readonly buffer: GpuBuffer;

    /** @param initial starting exposure multiplier; auto-exposure adapts away from it over the first frames. */
    constructor(device: GpuDevice, initial = 1.0) {
        this.buffer = device.createBuffer({
            label: "metis-engine/exposure",
            size: 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.set(device, initial);
    }

    /**
     * Overwrites the exposure multiplier. With `AutoExposurePass` in the chain
     * this is only a seed — it gets recomputed next frame. Without it, this is
     * the manual exposure control.
     */
    set(device: GpuDevice, value: number) {
        const bytes = new Float32Array([value]);
        device.queue.writeBuffer(this.buffer, 0, new Uint8Array(bytes.buffer));
    }

    destroy() {
        this.buffer.destroy();
    }
}
