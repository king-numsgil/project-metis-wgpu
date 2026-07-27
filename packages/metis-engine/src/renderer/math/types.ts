import type {
    F32Descriptor,
    MatMemoryBuffer,
    VecMemoryBuffer,
} from "metis-data";

/**
 * Short names for the `metis-data` buffer types the renderer works in.
 *
 * `VecMemoryBuffer<F32Descriptor, 3>` is accurate but unreadable at every
 * signature, and the renderer is f32 throughout — the GPU is the consumer, and
 * nothing here needs f64 (the eventual camera-relative rebase keeps its
 * authoritative f64 positions on the sim side, not in these types).
 *
 * These replaced wgpu-matrix's `Vec3Arg`/`Mat4Arg`. The important difference is
 * not the name: a `Vec3f` is a **view over an `ArrayBuffer`**, not a bare
 * `Float32Array`, which is what lets a computed matrix be written straight into
 * a GPU staging buffer with no copy (see `shading/gpuLayouts.ts`).
 */
export type Vec2f = VecMemoryBuffer<F32Descriptor, 2>;
export type Vec3f = VecMemoryBuffer<F32Descriptor, 3>;
export type Vec4f = VecMemoryBuffer<F32Descriptor, 4>;
export type Mat3f = MatMemoryBuffer<F32Descriptor, 3>;
export type Mat4f = MatMemoryBuffer<F32Descriptor, 4>;
/** A quaternion is a `Vec4` by storage; the distinction is which ops you apply. */
export type Quatf = VecMemoryBuffer<F32Descriptor, 4>;
