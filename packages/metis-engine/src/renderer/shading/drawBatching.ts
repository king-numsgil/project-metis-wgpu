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

/** Shared `forEachDrawRun` filter: the shadow passes draw only casters. */
export const castsShadow = (instance: SceneInstance) => instance.castsShadow;

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
     * Whether the most recent {@link update} rebuilt the order rather than
     * returning the previous one unchanged.
     *
     * Anything the renderer caches **per draw-order slot** has to invalidate on
     * this: a re-sort moves instances between slots, so slot *i* may now hold a
     * different instance than the value cached against it. The per-frame
     * bounding spheres are exactly that, and they are otherwise keyed only on
     * whether an instance *moved* — which a re-sort does not make true.
     */
    resorted = true;

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
            this.resorted = false;
            return this.ordered;
        }
        this.resorted = true;
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
 * Walks the frame's draw order and calls `emit` once per **instanced draw run**:
 * a maximal span of consecutive instances that share a mesh (and a material, if
 * `groupByMaterial`) and that `include` accepts.
 *
 * `firstInstance` is the run's start index in the draw order, which is also its
 * slot in the shared model array — see `modelBuffer.ts` for why those must be
 * the same number.
 *
 * **A run breaks at every gap, and that is the whole design decision here.**
 * Passes that draw a subset — the cascades skip non-casters, the spot passes
 * frustum-cull — cannot renumber their instances, because `instance_index`
 * indexes the frame-wide array. So a rejected instance splits the run rather
 * than being compacted out. The consequence is that a *scattered* cull pattern
 * yields more, smaller draws than a contiguous one, and in the pathological case
 * (every other instance rejected) instancing degrades to one draw per instance —
 * i.e. exactly the pre-instancing cost, never worse. Compacting instead would
 * need a per-pass index-remap buffer and an extra indirection in every vertex
 * shader; that is a real option if a spot-heavy scene ever shows it mattering,
 * and it is not built.
 *
 * @param include filter, receiving the instance and its draw-order index.
 *   **Must be pure and cheap: an instance at a run boundary is tested twice** —
 *   once as the reason a run ended, once as the candidate that starts the next
 *   one. A predicate that counts, mutates, or does real work (a frustum test)
 *   must precompute into a lookup and have this read it; `SpotShadows` does
 *   exactly that, and its drawn/candidate counters would double-count otherwise.
 * @param groupByMaterial `true` for the forward pass, which binds a material per
 *   run. The depth-only passes pass `false` — no material is involved, so their
 *   runs are longer, which is exactly why `DrawOrder` sorts mesh-major.
 */
export function forEachDrawRun(
    instances: readonly SceneInstance[],
    include: ((instance: SceneInstance, index: number) => boolean) | null,
    groupByMaterial: boolean,
    emit: (mesh: Mesh, material: Material, firstInstance: number, instanceCount: number) => void,
): void {
    let i = 0;
    while (i < instances.length) {
        const first = instances[i]!;
        if (include && !include(first, i)) {
            i++;
            continue;
        }
        let count = 1;
        while (i + count < instances.length) {
            const next = instances[i + count]!;
            if (next.mesh !== first.mesh || (groupByMaterial && next.material !== first.material)) {
                break;
            }
            if (include && !include(next, i + count)) {
                break;
            }
            count++;
        }
        emit(first.mesh, first.material, i, count);
        i += count;
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
     * Note this also skips `Material.getBindGroup`, which is where a material's
     * uniform buffer is uploaded — so a material whose factors are mutated
     * *between two draws that share it* would not see the second change until
     * something else is bound in between. Materials are shared, immutable-ish
     * shading parameters; mutating one mid-frame is already meaningless, since
     * every draw sharing it reads one buffer.
     *
     * That upload is itself now conditional on the factors having changed, so a
     * skipped bind saves a `setBindGroup` and an unchanged material costs no
     * `writeBuffer` even when it *is* bound — the two are independent.
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
