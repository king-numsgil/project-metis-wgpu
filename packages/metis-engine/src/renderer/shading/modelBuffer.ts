import { type GpuBindGroup, type GpuBindGroupLayout, type GpuBuffer, GPUBufferUsage, type GpuDevice } from "metis-native";
import type { SceneInstance } from "../scene/scene.ts";
import { stageModelArray } from "./gpuLayouts.ts";

/**
 * The frame's model + normal matrices, as **one storage buffer** that every
 * vertex shader indexes by `@builtin(instance_index)`.
 *
 * ## Why this replaced a buffer per instance
 *
 * Each `SceneInstance` used to own a uniform buffer and a bind group, so every
 * draw needed its own `setBindGroup` — which meant the draw count could never
 * drop below the instance count, however well the instances were sorted. With
 * one array bound once per pass, a run of instances sharing a mesh (and, in the
 * forward pass, a material) collapses into a **single instanced draw**, and the
 * per-frame call count stops scaling with instance count.
 *
 * ## The invariant that makes it work
 *
 * **Slot `i` holds the instance at position `i` of the frame's draw order.**
 * `DrawOrder` produces that order, `update()` writes the slots in it, and each
 * pass issues `drawIndexed(..., firstInstance = run start)` — WebGPU then makes
 * `@builtin(instance_index)` count from that base, so it lands on the right
 * slot. Everything downstream depends on those three agreeing; the shared list
 * is `ClusteredForwardRenderer.render()`'s single `instances` array precisely so
 * they cannot drift apart.
 *
 * A consequence worth knowing: a pass that draws a *subset* (the cascades skip
 * non-casters, the spot passes frustum-cull) cannot renumber. It has to break
 * its runs at the gaps and keep the original indices, which is what
 * `forEachDrawRun` does. Renumbering per pass would need a second indirection
 * buffer per pass, and was not worth it — see CLAUDE.md "Instanced draws".
 *
 * ## Upload
 *
 * One `writeBuffer` for the whole array per frame, skipped entirely when no
 * instance moved. The per-instance change detection lives on `SceneInstance`
 * (`modelChanged`), because `ShadowCascades` needs it per instance too.
 */
export class ModelBuffer {
    private readonly device: GpuDevice;
    private readonly layout: GpuBindGroupLayout;
    private buffer: GpuBuffer | null = null;
    private bindGroupInternal: GpuBindGroup | null = null;
    private staging: ReturnType<typeof stageModelArray> | null = null;
    private capacity = 0;

    constructor(device: GpuDevice, layout: GpuBindGroupLayout) {
        this.device = device;
        this.layout = layout;
    }

    /**
     * The bind group to set once per pass. Valid only after {@link update} —
     * before that there is no buffer to bind, and binding nothing is a
     * validation error rather than a visible one.
     */
    get bindGroup(): GpuBindGroup {
        if (!this.bindGroupInternal) {
            throw new Error("ModelBuffer.bindGroup read before update() — call update() once per frame first.");
        }
        return this.bindGroupInternal;
    }

    /**
     * Writes every instance's matrices into its draw-order slot and uploads the
     * array, growing first if needed.
     *
     * Returns `true` when at least one instance moved. Callers that cache work
     * keyed on geometry (`ShadowCascades`) can use it, though they generally
     * want the per-instance `modelChanged` instead.
     */
    update(instances: readonly SceneInstance[]): boolean {
        this.ensureCapacity(instances.length);
        const staging = this.staging!;
        let anyChanged = false;
        for (let i = 0; i < instances.length; i++) {
            const slot = staging.elements[i]!;
            if (instances[i]!.writeModel(slot.model, slot.normalMatrix)) {
                anyChanged = true;
            }
        }
        // One crossing for the whole frame's transforms, and none at all when
        // nothing moved — the GPU buffer still holds exactly these bytes.
        if (anyChanged) {
            this.device.queue.writeBuffer(this.buffer!, 0, staging.bytes);
        }
        return anyChanged;
    }

    /**
     * Grows to hold `count` instances, in powers of two.
     *
     * Growth reallocates the buffer *and* the bind group, and — because the
     * staging is reallocated with them — invalidates every element view. That is
     * why `update` re-reads `staging.elements` rather than caching it: a stale
     * view would write into a discarded `ArrayBuffer` and the upload would
     * silently carry last frame's transforms.
     */
    private ensureCapacity(count: number) {
        if (count <= this.capacity && this.staging) {
            return;
        }
        let capacity = Math.max(this.capacity, 1);
        while (capacity < count) {
            capacity *= 2;
        }
        this.buffer?.destroy();
        this.staging = stageModelArray(capacity);
        this.capacity = capacity;
        this.buffer = this.device.createBuffer({
            label: "metis-engine/model-array",
            size: this.staging.byteSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.bindGroupInternal = this.device.createBindGroup({
            label: "metis-engine/model-array-bind-group",
            layout: this.layout,
            entries: [{binding: 0, buffer: {buffer: this.buffer}}],
        });
    }

    destroy() {
        this.buffer?.destroy();
        this.buffer = null;
        this.bindGroupInternal = null;
        this.staging = null;
        this.capacity = 0;
    }
}
