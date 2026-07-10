import { mat4, type Mat4Arg, vec3, type Vec3Arg } from "wgpu-matrix";

/**
 * A look-at perspective camera using a **reverse-Z, infinite-far** projection
 * (near -> ndc.z 1, infinity -> ndc.z 0, so `ndc.z == near / viewDepth` exactly).
 *
 * Paired with the engine's `depth32float` depth buffer this gives ~constant
 * *relative* depth precision (~2^-24, i.e. gap/z ~= 6e-8) at every distance —
 * effectively a logarithmic depth buffer for free, with no `frag_depth` writes
 * and early-Z intact. Because the far plane cancels out of `near/z`, there is
 * no `far` field at all: the projection extends to infinity at zero precision
 * cost, and `near` can be pushed very close (the resolvable world gap is
 * `~z * 2^-24`, independent of `near`).
 *
 * Consequences callers must respect:
 * - The forward/AO pipelines use `depthCompare: "greater"` and clear depth to
 *   `0.0`. Anything reading the depth buffer tests background as `depth <= 0`,
 *   not `>= 1`.
 * - Light clustering needs a *finite* depth range, so it uses `clusterFar`
 *   (not the projection's far, which doesn't exist). See `clusterFar`.
 */
export class Camera {
    position: Vec3Arg = vec3.create(0, 0, 5);
    target: Vec3Arg = vec3.create(0, 0, 0);
    up: Vec3Arg = vec3.create(0, 1, 0);
    fovYRadians = Math.PI / 4;
    aspect = 16 / 9;
    /** Near plane. Cheap to make small under reverse-Z — it does not cost distant precision. */
    near = 0.01;
    /**
     * Far distance of the **clustered light grid** only — not a clip plane
     * (the projection is infinite). Point lights farther than this are not
     * culled into any cluster and so contribute nothing; geometry beyond it
     * still renders, lit by the sun/ambient.
     *
     * The 24 Z slices are distributed exponentially over `[near, clusterFar]`,
     * so widening this range coarsens Z-slice resolution everywhere
     * (slices-per-doubling = `CLUSTER_COUNT_Z / log2(clusterFar / near)`).
     * Lower it for a tight indoor scene; raise it only if distant point lights
     * genuinely matter.
     */
    clusterFar = 1000;

    setAspectFromSize(width: number, height: number) {
        this.aspect = width / Math.max(1, height);
    }

    viewMatrix(dst?: Mat4Arg): Mat4Arg {
        return mat4.lookAt(this.position, this.target, this.up, dst);
    }

    /** Reverse-Z with an infinite far plane (`zFar` omitted). Maps near -> 1, infinity -> 0. */
    projectionMatrix(dst?: Mat4Arg): Mat4Arg {
        return mat4.perspectiveReverseZ(this.fovYRadians, this.aspect, this.near, undefined, dst);
    }

    viewProjectionMatrix(dst?: Mat4Arg): Mat4Arg {
        const v = this.viewMatrix();
        const p = this.projectionMatrix();
        return mat4.multiply(p, v, dst);
    }
}
