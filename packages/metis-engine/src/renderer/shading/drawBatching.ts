import type { GpuBindGroupLayout, GpuDevice, GpuRenderPassEncoder } from "metis-native";
import type { Material } from "../scene/material.ts";
import type { Mesh } from "../scene/mesh.ts";
import type { SceneInstance } from "../scene/scene.ts";

/**
 * Draw-call batching: **sort** instances so draws sharing GPU state are
 * adjacent, then **skip** the binds a previous draw already made.
 *
 * The two halves only work together and that is why they live in one file.
 * Skipping redundant binds without sorting catches only whatever adjacency the
 * caller happened to build; sorting without skipping reorders draws and saves
 * nothing. Splitting them across files would let one be changed without the
 * other and quietly halve the win.
 *
 * ## Why this exists
 *
 * Encoding cost in this engine is **per call, not per triangle** — every
 * `setBindGroup`/`setVertexBuffer`/`setIndexBuffer`/`draw` is a JS -> napi ->
 * Rust -> wgpu crossing, and 400 helmets encode exactly like 400 cubes. The
 * per-frame call count is `instances x passes-that-draw-them x calls-per-draw`,
 * and with four cascades, four spot layers, a depth prepass and the forward
 * pass, the middle term is ~10. This attacks the third term.
 *
 * `bench/lights.ts --helmets 100` is the case that motivated it: 100 of its 101
 * instances share **one** `Mesh` and **one** `Material`, and every one of them
 * was re-binding identical state. Worth knowing:
 * `Material.getBindGroup` uploads its uniform buffer on *every* call, so a
 * skipped material bind saves a `writeBuffer` as well as a `setBindGroup` — two
 * crossings, not one.
 *
 * ## What it is worth, measured
 *
 * ~20% of CPU encode at 400 helmets — **but only once the per-instance model
 * uniform stops being re-uploaded in every pass.** Measured 2x2 at 400 helmets,
 * 320x240 (small on purpose — see below):
 *
 * | | sort off | sort on |
 * |---|---|---|
 * | model upload per pass | ~80 ms | ~63 ms |
 * | model upload per frame | ~52 ms | ~38 ms |
 *
 * The first measurement of this change at 1280x720 read as *zero*, and that was
 * a measurement artifact worth remembering: on an integrated GPU the CPU and GPU
 * share memory bandwidth, and `queue.writeBuffer` goes through wgpu's staging
 * belt, so a saturated GPU inflates and destabilises the CPU encode number it is
 * supposedly independent of. **Isolate CPU encode by shrinking the render
 * target, not the scene** — `--width 320 --height 240` keeps every draw call and
 * removes the contention.
 *
 * ## What it does not do
 *
 * Nothing here reduces the *number of draws* — that is instancing or indirect
 * drawing, and both are larger changes. Nor does it touch the per-instance model
 * uniform, which is unique per draw and still costs a `writeBuffer` plus a
 * `setBindGroup` in every pass that draws it. That upload is the larger cost of
 * the two (~35% on its own), and it is redundant work rather than necessary
 * work: the same bytes are uploaded 6-10 times per frame because
 * `SceneInstance.getModelBindGroup` both computes and uploads, and every pass
 * calls it. Splitting those two jobs is the next change.
 */

/** Sort key: mesh first, material second. See {@link DrawOrder} for why that order. */
function compareInstances(a: SceneInstance, b: SceneInstance): number {
    return a.mesh.id - b.mesh.id || a.material.id - b.material.id;
}

/**
 * The frame's instances, ordered so identical GPU state is contiguous, and
 * re-sorted only when the instance set actually changes.
 *
 * **Mesh is the primary key, material the secondary.** Of the ~10 passes that
 * walk this list, eight (four cascades, four spot layers) and the depth prepass
 * bind *only* a mesh — no material is involved in a depth-only pass — so mesh
 * coherence pays in every pass while material coherence pays in one. Sorting
 * material-major would optimise the single pass that has both and pessimise the
 * rest.
 *
 * **A stale order is a missed optimisation, never a wrong picture.** Change
 * detection compares instance *identity*, so mutating an existing instance's
 * `mesh` or `material` in place does not trigger a re-sort — the draws then sit
 * in a suboptimal order and rebind more than they need to, which is exactly as
 * correct as not sorting at all. That is the reason this is allowed to be a
 * cheap check rather than a deep one.
 */
export class DrawOrder {
    private readonly ordered: SceneInstance[] = [];
    /** Last input, by reference, to detect a changed instance set without a deep compare. */
    private readonly previous: SceneInstance[] = [];

    /**
     * Returns the sorted view of `instances`. The result is **owned by this
     * object and reused across frames** — read it within the frame, do not
     * retain it, and never mutate it.
     *
     * `instances` itself is never modified: `Scene.instances` is the caller's
     * array and sorting it in place would be a visible side effect of rendering.
     */
    update(instances: readonly SceneInstance[]): readonly SceneInstance[] {
        if (this.matchesPrevious(instances)) {
            return this.ordered;
        }
        this.previous.length = 0;
        this.ordered.length = 0;
        for (let i = 0; i < instances.length; i++) {
            this.previous.push(instances[i]!);
            this.ordered.push(instances[i]!);
        }
        this.ordered.sort(compareInstances);
        return this.ordered;
    }

    private matchesPrevious(instances: readonly SceneInstance[]): boolean {
        if (instances.length !== this.previous.length) {
            return false;
        }
        for (let i = 0; i < instances.length; i++) {
            if (instances[i] !== this.previous[i]) {
                return false;
            }
        }
        return true;
    }
}

/**
 * Tracks what is currently bound **inside one render pass**, so a draw can skip
 * a bind an earlier draw already made.
 *
 * **`begin()` must be called at the start of every pass.** Bind state does not
 * survive `beginRenderPass` — a fresh pass starts with nothing bound — so a
 * tracker carried from the previous pass would skip binds that were never made
 * and draw with whatever the driver had left over. That is a validation error at
 * best and silently wrong geometry at worst, which is why the reset is a
 * separate explicit call and not something inferred here.
 */
export class PassBinder {
    private mesh: Mesh | null = null;
    private material: Material | null = null;

    /** Forgets all tracked state. Call immediately after `beginRenderPass`. */
    begin() {
        this.mesh = null;
        this.material = null;
    }

    /** `mesh.bind(pass)`, skipped when this mesh's buffers are already bound. */
    setMesh(pass: GpuRenderPassEncoder, mesh: Mesh) {
        if (this.mesh === mesh) {
            return;
        }
        this.mesh = mesh;
        mesh.bind(pass);
    }

    /**
     * Binds `material` at `slot`, skipped when it is already bound.
     *
     * Note this also skips `Material.getBindGroup`, which uploads the material's
     * uniform buffer every call — so a material whose factors are mutated
     * *between two draws that share it* would not see the second change until
     * something else is bound in between. Materials are shared, immutable-ish
     * shading parameters; mutating one mid-frame is already meaningless, since
     * every draw sharing it reads one buffer.
     */
    setMaterial(
        pass: GpuRenderPassEncoder,
        slot: number,
        material: Material,
        device: GpuDevice,
        layout: GpuBindGroupLayout,
    ) {
        if (this.material === material) {
            return;
        }
        this.material = material;
        pass.setBindGroup(slot, material.getBindGroup(device, layout));
    }
}
