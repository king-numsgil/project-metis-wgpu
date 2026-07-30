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
 * Roughly a fifth of CPU encode at `--helmets 400`. Re-measure with
 * `bun run bench:lights --helmets 400`; there is no toggle, so an A/B means
 * reverting `DrawOrder.update` to return its input unsorted.
 *
 * The first measurement of this read as *zero*, on an Intel iGPU laptop, and the
 * diagnosis was contention: an integrated GPU shares memory bandwidth with the
 * CPU and `queue.writeBuffer` goes through wgpu's staging belt, so a saturated
 * GPU destabilises the CPU encode number it is supposedly independent of. The
 * workaround was to isolate encode by shrinking the render target rather than the
 * scene (`--width 320 --height 240` keeps every draw call).
 *
 * **That workaround is machine-specific — check before applying it.** On a
 * discrete GPU (GTX 1070) encode measures identically at 320x240 and 1280x720 at
 * every helmet count: no shared bandwidth, no contention, and shrinking the
 * target just costs you a realistic scene.
 *
 * ## What it does not do
 *
 * Nothing here reduces the *number of draws* — that is instancing or indirect
 * drawing, and both are larger changes. It also no longer has the larger cost
 * hiding behind it: the per-instance model uniform used to be recomputed and
 * re-uploaded in every pass, and is now prepared once per frame (see
 * `SceneInstance.prepareModel` and CLAUDE.md "The model uniform is computed once
 * per frame"). Instancing is the remaining item.
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
