import { allocate, F32, type MatMemoryBuffer, type ScalarDescriptor, Vec, type VecMemoryBuffer } from "metis-data";

// ============================================================================
// Vec4 Math Object
// ============================================================================
//
// View-based, allocation-free, and alias-safe — see the note at the top of
// vec3.ts for why (it is the reference implementation of this style).
export const Vec4 = {
    /**
     * Create a new Vec4 memory buffer initialized with the given values.
     */
    create<S extends ScalarDescriptor>(
        scalar: S = F32 as S,
        x = 0,
        y = 0,
        z = 0,
        w = 0,
    ): VecMemoryBuffer<S, 4> {
        const descriptor = Vec(scalar, 4);
        const buffer = allocate(descriptor);
        const v = buffer.view();
        v[0] = x;
        v[1] = y;
        v[2] = z;
        v[3] = w;
        return buffer;
    },

    /**
     * Clone a Vec4 into a new buffer.
     */
    clone<S extends ScalarDescriptor>(
        v: VecMemoryBuffer<S, 4>,
    ): VecMemoryBuffer<S, 4> {
        const descriptor = Vec(v.type.scalar, 4);
        const buffer = allocate(descriptor);
        buffer.view().set(v.view());
        return buffer;
    },

    /**
     * Copy values from one Vec4 to another.
     */
    copy<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 4>,
        v: VecMemoryBuffer<S, 4>,
    ): VecMemoryBuffer<S, 4> {
        out.view().set(v.view());
        return out;
    },

    /**
     * Set the components of a Vec4.
     */
    set<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 4>,
        x: number,
        y: number,
        z: number,
        w: number,
    ): VecMemoryBuffer<S, 4> {
        const o = out.view();
        o[0] = x;
        o[1] = y;
        o[2] = z;
        o[3] = w;
        return out;
    },

    /**
     * Add two Vec4s: out = a + b
     */
    add<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 4>,
        a: VecMemoryBuffer<S, 4>,
        b: VecMemoryBuffer<S, 4>,
    ): VecMemoryBuffer<S, 4> {
        const av = a.view(), bv = b.view(), o = out.view();
        const ax = av[0] as number, ay = av[1] as number, az = av[2] as number, aw = av[3] as number;
        const bx = bv[0] as number, by = bv[1] as number, bz = bv[2] as number, bw = bv[3] as number;
        o[0] = ax + bx;
        o[1] = ay + by;
        o[2] = az + bz;
        o[3] = aw + bw;
        return out;
    },

    /**
     * Subtract two Vec4s: out = a - b
     */
    subtract<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 4>,
        a: VecMemoryBuffer<S, 4>,
        b: VecMemoryBuffer<S, 4>,
    ): VecMemoryBuffer<S, 4> {
        const av = a.view(), bv = b.view(), o = out.view();
        const ax = av[0] as number, ay = av[1] as number, az = av[2] as number, aw = av[3] as number;
        const bx = bv[0] as number, by = bv[1] as number, bz = bv[2] as number, bw = bv[3] as number;
        o[0] = ax - bx;
        o[1] = ay - by;
        o[2] = az - bz;
        o[3] = aw - bw;
        return out;
    },

    /**
     * Multiply two Vec4s component-wise: out = a * b
     */
    multiply<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 4>,
        a: VecMemoryBuffer<S, 4>,
        b: VecMemoryBuffer<S, 4>,
    ): VecMemoryBuffer<S, 4> {
        const av = a.view(), bv = b.view(), o = out.view();
        const ax = av[0] as number, ay = av[1] as number, az = av[2] as number, aw = av[3] as number;
        const bx = bv[0] as number, by = bv[1] as number, bz = bv[2] as number, bw = bv[3] as number;
        o[0] = ax * bx;
        o[1] = ay * by;
        o[2] = az * bz;
        o[3] = aw * bw;
        return out;
    },

    /**
     * Divide two Vec4s component-wise: out = a / b
     */
    divide<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 4>,
        a: VecMemoryBuffer<S, 4>,
        b: VecMemoryBuffer<S, 4>,
    ): VecMemoryBuffer<S, 4> {
        const av = a.view(), bv = b.view(), o = out.view();
        const ax = av[0] as number, ay = av[1] as number, az = av[2] as number, aw = av[3] as number;
        const bx = bv[0] as number, by = bv[1] as number, bz = bv[2] as number, bw = bv[3] as number;
        o[0] = ax / bx;
        o[1] = ay / by;
        o[2] = az / bz;
        o[3] = aw / bw;
        return out;
    },

    /**
     * Scale a Vec4 by a scalar: out = v * s
     */
    scale<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 4>,
        v: VecMemoryBuffer<S, 4>,
        s: number,
    ): VecMemoryBuffer<S, 4> {
        const vv = v.view(), o = out.view();
        const x = vv[0] as number, y = vv[1] as number, z = vv[2] as number, w = vv[3] as number;
        o[0] = x * s;
        o[1] = y * s;
        o[2] = z * s;
        o[3] = w * s;
        return out;
    },

    /**
     * Calculate the dot product of two Vec4s.
     */
    dot<S extends ScalarDescriptor>(
        a: VecMemoryBuffer<S, 4>,
        b: VecMemoryBuffer<S, 4>,
    ): number {
        const av = a.view(), bv = b.view();
        return (av[0] as number) * (bv[0] as number)
            + (av[1] as number) * (bv[1] as number)
            + (av[2] as number) * (bv[2] as number)
            + (av[3] as number) * (bv[3] as number);
    },

    /**
     * Calculate the length (magnitude) of a Vec4.
     */
    length<S extends ScalarDescriptor>(v: VecMemoryBuffer<S, 4>): number {
        const vv = v.view();
        const x = vv[0] as number, y = vv[1] as number, z = vv[2] as number, w = vv[3] as number;
        return Math.sqrt(x * x + y * y + z * z + w * w);
    },

    /**
     * Calculate the squared length of a Vec4.
     */
    lengthSquared<S extends ScalarDescriptor>(v: VecMemoryBuffer<S, 4>): number {
        const vv = v.view();
        const x = vv[0] as number, y = vv[1] as number, z = vv[2] as number, w = vv[3] as number;
        return x * x + y * y + z * z + w * w;
    },

    /**
     * Normalize a Vec4: out = v / |v|. A zero-length vector yields zero rather
     * than NaN.
     */
    normalize<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 4>,
        v: VecMemoryBuffer<S, 4>,
    ): VecMemoryBuffer<S, 4> {
        const vv = v.view(), o = out.view();
        const x = vv[0] as number, y = vv[1] as number, z = vv[2] as number, w = vv[3] as number;
        const len = Math.sqrt(x * x + y * y + z * z + w * w);
        if (len > 0) {
            const inv = 1 / len;
            o[0] = x * inv;
            o[1] = y * inv;
            o[2] = z * inv;
            o[3] = w * inv;
        } else {
            o[0] = 0;
            o[1] = 0;
            o[2] = 0;
            o[3] = 0;
        }
        return out;
    },

    /**
     * Negate a Vec4: out = -v
     */
    negate<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 4>,
        v: VecMemoryBuffer<S, 4>,
    ): VecMemoryBuffer<S, 4> {
        const vv = v.view(), o = out.view();
        const x = vv[0] as number, y = vv[1] as number, z = vv[2] as number, w = vv[3] as number;
        o[0] = -x;
        o[1] = -y;
        o[2] = -z;
        o[3] = -w;
        return out;
    },

    /**
     * Linear interpolation between two Vec4s: out = a + t * (b - a)
     */
    lerp<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 4>,
        a: VecMemoryBuffer<S, 4>,
        b: VecMemoryBuffer<S, 4>,
        t: number,
    ): VecMemoryBuffer<S, 4> {
        const av = a.view(), bv = b.view(), o = out.view();
        const ax = av[0] as number, ay = av[1] as number, az = av[2] as number, aw = av[3] as number;
        const bx = bv[0] as number, by = bv[1] as number, bz = bv[2] as number, bw = bv[3] as number;
        o[0] = ax + t * (bx - ax);
        o[1] = ay + t * (by - ay);
        o[2] = az + t * (bz - az);
        o[3] = aw + t * (bw - aw);
        return out;
    },

    /**
     * Transform a Vec4 by a Mat4: `out = m * v`.
     *
     * The raw homogeneous product with **no `w` divide** — `out.w` is the
     * computed `w`, left for the caller to use or divide by. This is the form
     * you want when the `w` itself is the answer (clip-space positions, plane
     * equations, frustum-plane extraction) rather than a point to be projected;
     * for the projected point, {@link Vec3.transformMat4} does the divide.
     */
    transformMat4<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 4>,
        v: VecMemoryBuffer<S, 4>,
        m: MatMemoryBuffer<S, 4>,
    ): VecMemoryBuffer<S, 4> {
        const mv = m.view(), vv = v.view(), o = out.view();
        const c = m.columnElements;
        const x = vv[0] as number, y = vv[1] as number, z = vv[2] as number, w = vv[3] as number;

        const rx = (mv[0] as number) * x + (mv[c] as number) * y + (mv[2 * c] as number) * z + (mv[3 * c] as number) * w;
        const ry = (mv[1] as number) * x + (mv[c + 1] as number) * y + (mv[2 * c + 1] as number) * z + (mv[3 * c + 1] as number) * w;
        const rz = (mv[2] as number) * x + (mv[c + 2] as number) * y + (mv[2 * c + 2] as number) * z + (mv[3 * c + 2] as number) * w;
        const rw = (mv[3] as number) * x + (mv[c + 3] as number) * y + (mv[2 * c + 3] as number) * z + (mv[3 * c + 3] as number) * w;

        o[0] = rx;
        o[1] = ry;
        o[2] = rz;
        o[3] = rw;
        return out;
    },

    /**
     * Check if two Vec4s are equal.
     */
    equals<S extends ScalarDescriptor>(
        a: VecMemoryBuffer<S, 4>,
        b: VecMemoryBuffer<S, 4>,
    ): boolean {
        const av = a.view(), bv = b.view();
        return av[0] === bv[0] && av[1] === bv[1] && av[2] === bv[2] && av[3] === bv[3];
    },
};
