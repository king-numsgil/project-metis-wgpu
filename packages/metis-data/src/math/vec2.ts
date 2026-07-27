import { allocate, F32, type MatMemoryBuffer, type ScalarDescriptor, Vec, type VecMemoryBuffer } from "metis-data";

// ============================================================================
// Vec2 Math Object
// ============================================================================
//
// View-based, allocation-free, and alias-safe — see the note at the top of
// vec3.ts for why (it is the reference implementation of this style).
export const Vec2 = {
    /**
     * Create a new Vec2 memory buffer initialized with the given values.
     */
    create<S extends ScalarDescriptor>(
        scalar: S = F32 as S,
        x = 0,
        y = 0,
    ): VecMemoryBuffer<S, 2> {
        const descriptor = Vec(scalar, 2);
        const buffer = allocate(descriptor);
        const v = buffer.view();
        v[0] = x;
        v[1] = y;
        return buffer;
    },

    /**
     * Clone a Vec2 into a new buffer.
     */
    clone<S extends ScalarDescriptor>(
        v: VecMemoryBuffer<S, 2>,
    ): VecMemoryBuffer<S, 2> {
        const descriptor = Vec(v.type.scalar, 2);
        const buffer = allocate(descriptor);
        buffer.view().set(v.view());
        return buffer;
    },

    /**
     * Copy values from one Vec2 to another.
     */
    copy<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 2>,
        v: VecMemoryBuffer<S, 2>,
    ): VecMemoryBuffer<S, 2> {
        out.view().set(v.view());
        return out;
    },

    /**
     * Set the components of a Vec2.
     */
    set<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 2>,
        x: number,
        y: number,
    ): VecMemoryBuffer<S, 2> {
        const o = out.view();
        o[0] = x;
        o[1] = y;
        return out;
    },

    /**
     * Add two Vec2s: out = a + b
     */
    add<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 2>,
        a: VecMemoryBuffer<S, 2>,
        b: VecMemoryBuffer<S, 2>,
    ): VecMemoryBuffer<S, 2> {
        const av = a.view(), bv = b.view(), o = out.view();
        const ax = av[0] as number, ay = av[1] as number;
        const bx = bv[0] as number, by = bv[1] as number;
        o[0] = ax + bx;
        o[1] = ay + by;
        return out;
    },

    /**
     * Subtract two Vec2s: out = a - b
     */
    subtract<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 2>,
        a: VecMemoryBuffer<S, 2>,
        b: VecMemoryBuffer<S, 2>,
    ): VecMemoryBuffer<S, 2> {
        const av = a.view(), bv = b.view(), o = out.view();
        const ax = av[0] as number, ay = av[1] as number;
        const bx = bv[0] as number, by = bv[1] as number;
        o[0] = ax - bx;
        o[1] = ay - by;
        return out;
    },

    /**
     * Multiply two Vec2s component-wise: out = a * b
     */
    multiply<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 2>,
        a: VecMemoryBuffer<S, 2>,
        b: VecMemoryBuffer<S, 2>,
    ): VecMemoryBuffer<S, 2> {
        const av = a.view(), bv = b.view(), o = out.view();
        const ax = av[0] as number, ay = av[1] as number;
        const bx = bv[0] as number, by = bv[1] as number;
        o[0] = ax * bx;
        o[1] = ay * by;
        return out;
    },

    /**
     * Divide two Vec2s component-wise: out = a / b
     */
    divide<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 2>,
        a: VecMemoryBuffer<S, 2>,
        b: VecMemoryBuffer<S, 2>,
    ): VecMemoryBuffer<S, 2> {
        const av = a.view(), bv = b.view(), o = out.view();
        const ax = av[0] as number, ay = av[1] as number;
        const bx = bv[0] as number, by = bv[1] as number;
        o[0] = ax / bx;
        o[1] = ay / by;
        return out;
    },

    /**
     * Scale a Vec2 by a scalar: out = v * s
     */
    scale<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 2>,
        v: VecMemoryBuffer<S, 2>,
        s: number,
    ): VecMemoryBuffer<S, 2> {
        const vv = v.view(), o = out.view();
        const x = vv[0] as number, y = vv[1] as number;
        o[0] = x * s;
        o[1] = y * s;
        return out;
    },

    /**
     * Calculate the dot product of two Vec2s.
     */
    dot<S extends ScalarDescriptor>(
        a: VecMemoryBuffer<S, 2>,
        b: VecMemoryBuffer<S, 2>,
    ): number {
        const av = a.view(), bv = b.view();
        return (av[0] as number) * (bv[0] as number) + (av[1] as number) * (bv[1] as number);
    },

    /**
     * 2D cross product — the scalar z of the 3D cross product.
     */
    cross<S extends ScalarDescriptor>(
        a: VecMemoryBuffer<S, 2>,
        b: VecMemoryBuffer<S, 2>,
    ): number {
        const av = a.view(), bv = b.view();
        return (av[0] as number) * (bv[1] as number) - (av[1] as number) * (bv[0] as number);
    },

    /**
     * Calculate the length (magnitude) of a Vec2.
     */
    length<S extends ScalarDescriptor>(v: VecMemoryBuffer<S, 2>): number {
        const vv = v.view();
        const x = vv[0] as number, y = vv[1] as number;
        return Math.sqrt(x * x + y * y);
    },

    /**
     * Calculate the squared length of a Vec2.
     */
    lengthSquared<S extends ScalarDescriptor>(v: VecMemoryBuffer<S, 2>): number {
        const vv = v.view();
        const x = vv[0] as number, y = vv[1] as number;
        return x * x + y * y;
    },

    /**
     * Calculate the distance between two Vec2s.
     */
    distance<S extends ScalarDescriptor>(
        a: VecMemoryBuffer<S, 2>,
        b: VecMemoryBuffer<S, 2>,
    ): number {
        const av = a.view(), bv = b.view();
        const dx = (bv[0] as number) - (av[0] as number);
        const dy = (bv[1] as number) - (av[1] as number);
        return Math.sqrt(dx * dx + dy * dy);
    },

    /**
     * Calculate the squared distance between two Vec2s.
     */
    distanceSquared<S extends ScalarDescriptor>(
        a: VecMemoryBuffer<S, 2>,
        b: VecMemoryBuffer<S, 2>,
    ): number {
        const av = a.view(), bv = b.view();
        const dx = (bv[0] as number) - (av[0] as number);
        const dy = (bv[1] as number) - (av[1] as number);
        return dx * dx + dy * dy;
    },

    /**
     * Normalize a Vec2: out = v / |v|. A zero-length vector yields zero rather
     * than NaN.
     */
    normalize<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 2>,
        v: VecMemoryBuffer<S, 2>,
    ): VecMemoryBuffer<S, 2> {
        const vv = v.view(), o = out.view();
        const x = vv[0] as number, y = vv[1] as number;
        const len = Math.sqrt(x * x + y * y);
        if (len > 0) {
            const inv = 1 / len;
            o[0] = x * inv;
            o[1] = y * inv;
        } else {
            o[0] = 0;
            o[1] = 0;
        }
        return out;
    },

    /**
     * Negate a Vec2: out = -v
     */
    negate<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 2>,
        v: VecMemoryBuffer<S, 2>,
    ): VecMemoryBuffer<S, 2> {
        const vv = v.view(), o = out.view();
        const x = vv[0] as number, y = vv[1] as number;
        o[0] = -x;
        o[1] = -y;
        return out;
    },

    /**
     * Linear interpolation between two Vec2s: out = a + t * (b - a)
     */
    lerp<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 2>,
        a: VecMemoryBuffer<S, 2>,
        b: VecMemoryBuffer<S, 2>,
        t: number,
    ): VecMemoryBuffer<S, 2> {
        const av = a.view(), bv = b.view(), o = out.view();
        const ax = av[0] as number, ay = av[1] as number;
        const bx = bv[0] as number, by = bv[1] as number;
        o[0] = ax + t * (bx - ax);
        o[1] = ay + t * (by - ay);
        return out;
    },

    /**
     * Rotate a Vec2 by an angle (in radians).
     *
     * Safe when `out` aliases `v` — both components are read before either is
     * written, which this op genuinely needs.
     */
    rotate<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 2>,
        v: VecMemoryBuffer<S, 2>,
        angle: number,
    ): VecMemoryBuffer<S, 2> {
        const vv = v.view(), o = out.view();
        const x = vv[0] as number, y = vv[1] as number;
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        o[0] = x * c - y * s;
        o[1] = x * s + y * c;
        return out;
    },

    /**
     * Get the angle of a Vec2 (in radians).
     */
    angle<S extends ScalarDescriptor>(v: VecMemoryBuffer<S, 2>): number {
        const vv = v.view();
        return Math.atan2(vv[1] as number, vv[0] as number);
    },

    /**
     * Transform a Vec2 as a **point** by a Mat3 2D transform: `out = (m *
     * vec3(v, 1)).xy`.
     *
     * Pairs with `Mat3.fromTRS`/`translation`/`rotation`/`scaling`, which build
     * 2D affine transforms. The translation column applies — for a direction
     * (a velocity, a normal) use {@link transformMat2}.
     */
    transformMat3<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 2>,
        v: VecMemoryBuffer<S, 2>,
        m: MatMemoryBuffer<S, 3>,
    ): VecMemoryBuffer<S, 2> {
        const mv = m.view(), vv = v.view(), o = out.view();
        const c = m.columnElements;
        const x = vv[0] as number, y = vv[1] as number;

        const rx = (mv[0] as number) * x + (mv[c] as number) * y + (mv[2 * c] as number);
        const ry = (mv[1] as number) * x + (mv[c + 1] as number) * y + (mv[2 * c + 1] as number);

        o[0] = rx;
        o[1] = ry;
        return out;
    },

    /**
     * Transform a Vec2 as a **direction** by a Mat2: `out = m * v`.
     */
    transformMat2<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 2>,
        v: VecMemoryBuffer<S, 2>,
        m: MatMemoryBuffer<S, 2>,
    ): VecMemoryBuffer<S, 2> {
        const mv = m.view(), vv = v.view(), o = out.view();
        const c = m.columnElements;
        const x = vv[0] as number, y = vv[1] as number;

        const rx = (mv[0] as number) * x + (mv[c] as number) * y;
        const ry = (mv[1] as number) * x + (mv[c + 1] as number) * y;

        o[0] = rx;
        o[1] = ry;
        return out;
    },

    /**
     * Check if two Vec2s are equal.
     */
    equals<S extends ScalarDescriptor>(
        a: VecMemoryBuffer<S, 2>,
        b: VecMemoryBuffer<S, 2>,
    ): boolean {
        const av = a.view(), bv = b.view();
        return av[0] === bv[0] && av[1] === bv[1];
    },
};
