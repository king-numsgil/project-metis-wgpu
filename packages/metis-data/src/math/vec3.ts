import { allocate, F32, type MatMemoryBuffer, type ScalarDescriptor, Vec, type VecMemoryBuffer } from "metis-data";

// ============================================================================
// Vec3 Math Object
// ============================================================================
//
// Every op reads its operands through the buffer's **cached** `view()` and
// writes components individually. It deliberately does NOT use `get()`/`set()`:
// `get()` builds a detached tuple on every call and `set()` takes an array
// literal, which cost 3 short-lived allocations per op and measured 10-30x
// slower than indexing the view (`bun run bench/mathAlloc.ts`).
//
// **Operands are read into locals before anything is written.** That is what
// makes `out` safe to alias with an input — `Vec3.cross(a, a, b)` would
// otherwise poison its own remaining components mid-computation. The old
// `get()` style got this for free by snapshotting; here it is deliberate.
// `src/math/test/aliasing.test.ts` pins it.
export const Vec3 = {
    /**
     * Create a new Vec3 memory buffer initialized with the given values.
     */
    create<S extends ScalarDescriptor>(
        scalar: S = F32 as S,
        x = 0,
        y = 0,
        z = 0,
    ): VecMemoryBuffer<S, 3> {
        const descriptor = Vec(scalar, 3);
        const buffer = allocate(descriptor);
        const v = buffer.view();
        v[0] = x;
        v[1] = y;
        v[2] = z;
        return buffer;
    },

    /**
     * Clone a Vec3 into a new buffer.
     */
    clone<S extends ScalarDescriptor>(
        v: VecMemoryBuffer<S, 3>,
    ): VecMemoryBuffer<S, 3> {
        const descriptor = Vec(v.type.scalar, 3);
        const buffer = allocate(descriptor);
        buffer.view().set(v.view());
        return buffer;
    },

    /**
     * Copy values from one Vec3 to another.
     */
    copy<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 3>,
        v: VecMemoryBuffer<S, 3>,
    ): VecMemoryBuffer<S, 3> {
        out.view().set(v.view());
        return out;
    },

    /**
     * Set the components of a Vec3.
     */
    set<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 3>,
        x: number,
        y: number,
        z: number,
    ): VecMemoryBuffer<S, 3> {
        const o = out.view();
        o[0] = x;
        o[1] = y;
        o[2] = z;
        return out;
    },

    /**
     * Add two Vec3s: out = a + b
     */
    add<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 3>,
        a: VecMemoryBuffer<S, 3>,
        b: VecMemoryBuffer<S, 3>,
    ): VecMemoryBuffer<S, 3> {
        const av = a.view(), bv = b.view(), o = out.view();
        const ax = av[0] as number, ay = av[1] as number, az = av[2] as number;
        const bx = bv[0] as number, by = bv[1] as number, bz = bv[2] as number;
        o[0] = ax + bx;
        o[1] = ay + by;
        o[2] = az + bz;
        return out;
    },

    /**
     * Subtract two Vec3s: out = a - b
     */
    subtract<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 3>,
        a: VecMemoryBuffer<S, 3>,
        b: VecMemoryBuffer<S, 3>,
    ): VecMemoryBuffer<S, 3> {
        const av = a.view(), bv = b.view(), o = out.view();
        const ax = av[0] as number, ay = av[1] as number, az = av[2] as number;
        const bx = bv[0] as number, by = bv[1] as number, bz = bv[2] as number;
        o[0] = ax - bx;
        o[1] = ay - by;
        o[2] = az - bz;
        return out;
    },

    /**
     * Multiply two Vec3s component-wise: out = a * b
     */
    multiply<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 3>,
        a: VecMemoryBuffer<S, 3>,
        b: VecMemoryBuffer<S, 3>,
    ): VecMemoryBuffer<S, 3> {
        const av = a.view(), bv = b.view(), o = out.view();
        const ax = av[0] as number, ay = av[1] as number, az = av[2] as number;
        const bx = bv[0] as number, by = bv[1] as number, bz = bv[2] as number;
        o[0] = ax * bx;
        o[1] = ay * by;
        o[2] = az * bz;
        return out;
    },

    /**
     * Divide two Vec3s component-wise: out = a / b
     */
    divide<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 3>,
        a: VecMemoryBuffer<S, 3>,
        b: VecMemoryBuffer<S, 3>,
    ): VecMemoryBuffer<S, 3> {
        const av = a.view(), bv = b.view(), o = out.view();
        const ax = av[0] as number, ay = av[1] as number, az = av[2] as number;
        const bx = bv[0] as number, by = bv[1] as number, bz = bv[2] as number;
        o[0] = ax / bx;
        o[1] = ay / by;
        o[2] = az / bz;
        return out;
    },

    /**
     * Scale a Vec3 by a scalar: out = v * s
     */
    scale<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 3>,
        v: VecMemoryBuffer<S, 3>,
        s: number,
    ): VecMemoryBuffer<S, 3> {
        const vv = v.view(), o = out.view();
        const x = vv[0] as number, y = vv[1] as number, z = vv[2] as number;
        o[0] = x * s;
        o[1] = y * s;
        o[2] = z * s;
        return out;
    },

    /**
     * Calculate the dot product of two Vec3s.
     */
    dot<S extends ScalarDescriptor>(
        a: VecMemoryBuffer<S, 3>,
        b: VecMemoryBuffer<S, 3>,
    ): number {
        const av = a.view(), bv = b.view();
        return (av[0] as number) * (bv[0] as number)
            + (av[1] as number) * (bv[1] as number)
            + (av[2] as number) * (bv[2] as number);
    },

    /**
     * Calculate the cross product of two Vec3s: out = a × b
     *
     * Safe when `out` aliases `a` or `b` — every component is read before any
     * is written, which for this op is load-bearing rather than incidental.
     */
    cross<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 3>,
        a: VecMemoryBuffer<S, 3>,
        b: VecMemoryBuffer<S, 3>,
    ): VecMemoryBuffer<S, 3> {
        const av = a.view(), bv = b.view(), o = out.view();
        const ax = av[0] as number, ay = av[1] as number, az = av[2] as number;
        const bx = bv[0] as number, by = bv[1] as number, bz = bv[2] as number;
        o[0] = ay * bz - az * by;
        o[1] = az * bx - ax * bz;
        o[2] = ax * by - ay * bx;
        return out;
    },

    /**
     * Calculate the length (magnitude) of a Vec3.
     */
    length<S extends ScalarDescriptor>(v: VecMemoryBuffer<S, 3>): number {
        const vv = v.view();
        const x = vv[0] as number, y = vv[1] as number, z = vv[2] as number;
        return Math.sqrt(x * x + y * y + z * z);
    },

    /**
     * Calculate the squared length of a Vec3.
     */
    lengthSquared<S extends ScalarDescriptor>(v: VecMemoryBuffer<S, 3>): number {
        const vv = v.view();
        const x = vv[0] as number, y = vv[1] as number, z = vv[2] as number;
        return x * x + y * y + z * z;
    },

    /**
     * Calculate the distance between two Vec3s.
     */
    distance<S extends ScalarDescriptor>(
        a: VecMemoryBuffer<S, 3>,
        b: VecMemoryBuffer<S, 3>,
    ): number {
        const av = a.view(), bv = b.view();
        const dx = (bv[0] as number) - (av[0] as number);
        const dy = (bv[1] as number) - (av[1] as number);
        const dz = (bv[2] as number) - (av[2] as number);
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    },

    /**
     * Calculate the squared distance between two Vec3s.
     */
    distanceSquared<S extends ScalarDescriptor>(
        a: VecMemoryBuffer<S, 3>,
        b: VecMemoryBuffer<S, 3>,
    ): number {
        const av = a.view(), bv = b.view();
        const dx = (bv[0] as number) - (av[0] as number);
        const dy = (bv[1] as number) - (av[1] as number);
        const dz = (bv[2] as number) - (av[2] as number);
        return dx * dx + dy * dy + dz * dz;
    },

    /**
     * Normalize a Vec3: out = v / |v|. A zero-length vector yields zero rather
     * than NaN.
     */
    normalize<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 3>,
        v: VecMemoryBuffer<S, 3>,
    ): VecMemoryBuffer<S, 3> {
        const vv = v.view(), o = out.view();
        const x = vv[0] as number, y = vv[1] as number, z = vv[2] as number;
        const len = Math.sqrt(x * x + y * y + z * z);
        if (len > 0) {
            const inv = 1 / len;
            o[0] = x * inv;
            o[1] = y * inv;
            o[2] = z * inv;
        } else {
            o[0] = 0;
            o[1] = 0;
            o[2] = 0;
        }
        return out;
    },

    /**
     * Negate a Vec3: out = -v
     */
    negate<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 3>,
        v: VecMemoryBuffer<S, 3>,
    ): VecMemoryBuffer<S, 3> {
        const vv = v.view(), o = out.view();
        const x = vv[0] as number, y = vv[1] as number, z = vv[2] as number;
        o[0] = -x;
        o[1] = -y;
        o[2] = -z;
        return out;
    },

    /**
     * Linear interpolation between two Vec3s: out = a + t * (b - a)
     */
    lerp<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 3>,
        a: VecMemoryBuffer<S, 3>,
        b: VecMemoryBuffer<S, 3>,
        t: number,
    ): VecMemoryBuffer<S, 3> {
        const av = a.view(), bv = b.view(), o = out.view();
        const ax = av[0] as number, ay = av[1] as number, az = av[2] as number;
        const bx = bv[0] as number, by = bv[1] as number, bz = bv[2] as number;
        o[0] = ax + t * (bx - ax);
        o[1] = ay + t * (by - ay);
        o[2] = az + t * (bz - az);
        return out;
    },

    /**
     * Transform a Vec3 by a quaternion.
     */
    transformQuat<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 3>,
        v: VecMemoryBuffer<S, 3>,
        q: VecMemoryBuffer<S, 4>,
    ): VecMemoryBuffer<S, 3> {
        const vv = v.view(), qv = q.view(), o = out.view();
        const x = vv[0] as number, y = vv[1] as number, z = vv[2] as number;
        const qx = qv[0] as number, qy = qv[1] as number, qz = qv[2] as number, qw = qv[3] as number;

        // Calculate quat * vec
        const ix = qw * x + qy * z - qz * y;
        const iy = qw * y + qz * x - qx * z;
        const iz = qw * z + qx * y - qy * x;
        const iw = -qx * x - qy * y - qz * z;

        // Calculate result * inverse quat
        o[0] = ix * qw + iw * -qx + iy * -qz - iz * -qy;
        o[1] = iy * qw + iw * -qy + iz * -qx - ix * -qz;
        o[2] = iz * qw + iw * -qz + ix * -qy - iy * -qx;
        return out;
    },

    /**
     * Transform a Vec3 as a **point** by a Mat4: `out = (m * vec4(v, 1)).xyz`,
     * divided by the resulting `w`.
     *
     * The `w` divide is what makes this correct through a projection matrix (a
     * frustum corner unprojected by an inverse-projection needs it). Through an
     * affine matrix — a view or model matrix — `w` comes out 1 and the divide is
     * a no-op, so this is also the right call for "put this world position into
     * view space". A `w` of exactly 0 (a point on the projection's plane at
     * infinity) is treated as 1 rather than producing `Infinity`.
     *
     * To transform a **direction** — a normal or an axis, where translation must
     * not apply — use {@link transformMat3} with the model's linear part, or
     * `Mat4.getLinearTransform` first. Passing a direction here silently adds
     * the translation column.
     */
    transformMat4<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 3>,
        v: VecMemoryBuffer<S, 3>,
        m: MatMemoryBuffer<S, 4>,
    ): VecMemoryBuffer<S, 3> {
        const mv = m.view(), vv = v.view(), o = out.view();
        const c = m.columnElements;
        const x = vv[0] as number, y = vv[1] as number, z = vv[2] as number;

        const w = (mv[3] as number) * x + (mv[c + 3] as number) * y + (mv[2 * c + 3] as number) * z + (mv[3 * c + 3] as number);
        const iw = w === 0 ? 1 : 1 / w;

        const rx = (mv[0] as number) * x + (mv[c] as number) * y + (mv[2 * c] as number) * z + (mv[3 * c] as number);
        const ry = (mv[1] as number) * x + (mv[c + 1] as number) * y + (mv[2 * c + 1] as number) * z + (mv[3 * c + 1] as number);
        const rz = (mv[2] as number) * x + (mv[c + 2] as number) * y + (mv[2 * c + 2] as number) * z + (mv[3 * c + 2] as number);

        o[0] = rx * iw;
        o[1] = ry * iw;
        o[2] = rz * iw;
        return out;
    },

    /**
     * Transform a Vec3 as a **direction** by a Mat3: `out = m * v`. No
     * translation, no divide.
     *
     * This is the normal-transform path: pass the inverse-transpose of the
     * model's upper 3x3 and normals stay perpendicular to the surface under
     * non-uniform scale. Feeding the plain linear part instead is the classic
     * skewed-lighting bug, and it looks plausible right up until something is
     * scaled unevenly.
     */
    transformMat3<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 3>,
        v: VecMemoryBuffer<S, 3>,
        m: MatMemoryBuffer<S, 3>,
    ): VecMemoryBuffer<S, 3> {
        const mv = m.view(), vv = v.view(), o = out.view();
        const c = m.columnElements;
        const x = vv[0] as number, y = vv[1] as number, z = vv[2] as number;

        const rx = (mv[0] as number) * x + (mv[c] as number) * y + (mv[2 * c] as number) * z;
        const ry = (mv[1] as number) * x + (mv[c + 1] as number) * y + (mv[2 * c + 1] as number) * z;
        const rz = (mv[2] as number) * x + (mv[c + 2] as number) * y + (mv[2 * c + 2] as number) * z;

        o[0] = rx;
        o[1] = ry;
        o[2] = rz;
        return out;
    },

    /**
     * Transform a Vec3 as a **direction** by a Mat4's upper 3x3, ignoring the
     * translation column and without a `w` divide.
     *
     * The convenience form of {@link transformMat3} when you already hold the
     * full matrix and its scale is uniform (under non-uniform scale a normal
     * still needs the inverse-transpose, which this does not compute).
     */
    transformMat4Upper3x3<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 3>,
        v: VecMemoryBuffer<S, 3>,
        m: MatMemoryBuffer<S, 4>,
    ): VecMemoryBuffer<S, 3> {
        const mv = m.view(), vv = v.view(), o = out.view();
        const c = m.columnElements;
        const x = vv[0] as number, y = vv[1] as number, z = vv[2] as number;

        const rx = (mv[0] as number) * x + (mv[c] as number) * y + (mv[2 * c] as number) * z;
        const ry = (mv[1] as number) * x + (mv[c + 1] as number) * y + (mv[2 * c + 1] as number) * z;
        const rz = (mv[2] as number) * x + (mv[c + 2] as number) * y + (mv[2 * c + 2] as number) * z;

        o[0] = rx;
        o[1] = ry;
        o[2] = rz;
        return out;
    },

    /**
     * Check if two Vec3s are equal.
     */
    equals<S extends ScalarDescriptor>(
        a: VecMemoryBuffer<S, 3>,
        b: VecMemoryBuffer<S, 3>,
    ): boolean {
        const av = a.view(), bv = b.view();
        return av[0] === bv[0] && av[1] === bv[1] && av[2] === bv[2];
    },
};
