import {
    allocate,
    F32,
    type F32Descriptor,
    Mat,
    type MatMemoryBuffer,
    PackingType,
    Vec,
    type VecMemoryBuffer,
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

// ── Constructors ────────────────────────────────────────────────────────────
//
// `Vec3.create(F32, x, y, z)` spelled out at every scene-setup call site is
// noise: the scalar is never anything but F32 here. These wrap that, and pin
// the *packing* — which the buffer types above deliberately do not carry.
//
// **Packing matters for `mat3f` and nothing else.** A mat4 is laid out
// identically under Dense and Std140 (four 16-byte columns either way), but a
// Dense mat3 packs its columns at 12 bytes where std140 pads them to 16. Since
// `MatMemoryBuffer<F32Descriptor, 3>` doesn't encode packing, a Dense mat3
// would type-check perfectly and then write the normal matrix into a GPU
// staging buffer at the wrong column stride — silently, and only for mat3. So
// `mat3f` allocates std140 and there is no Dense alternative offered.

/** A `Vec2f`, defaulting to the origin. */
export function vec2f(x = 0, y = 0): Vec2f {
    const v = allocate(Vec(F32, 2));
    const a = v.view();
    a[0] = x; a[1] = y;
    return v;
}

/** A `Vec3f`, defaulting to the origin. */
export function vec3f(x = 0, y = 0, z = 0): Vec3f {
    const v = allocate(Vec(F32, 3));
    const a = v.view();
    a[0] = x; a[1] = y; a[2] = z;
    return v;
}

/** A `Vec4f`, defaulting to all-zero. */
export function vec4f(x = 0, y = 0, z = 0, w = 0): Vec4f {
    const v = allocate(Vec(F32, 4));
    const a = v.view();
    a[0] = x; a[1] = y; a[2] = z; a[3] = w;
    return v;
}

/** An identity `Quatf` (`[0, 0, 0, 1]`) unless components are given. */
export function quatf(x = 0, y = 0, z = 0, w = 1): Quatf {
    return vec4f(x, y, z, w);
}

/** An identity `Mat4f`. Use as scratch for the out-first `Mat4.set*` ops. */
export function mat4f(): Mat4f {
    const m = allocate(Mat(F32, 4));
    const a = m.view();
    a[0] = 1; a[5] = 1; a[10] = 1; a[15] = 1;
    return m;
}

/** An identity `Mat3f`, **std140-packed** — see the packing note above. */
export function mat3f(): Mat3f {
    const m = allocate(Mat(F32, 3, PackingType.Std140));
    const a = m.view();
    const c = m.columnElements;
    a[0] = 1; a[c + 1] = 1; a[2 * c + 2] = 1;
    return m;
}
