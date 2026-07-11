import { allocate, F32, type ScalarDescriptor, Vec, type VecMemoryBuffer } from "metis-data";
import type { TupleOf } from "type-fest";

// ============================================================================
// Vec2 Math Object
// ============================================================================
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
        buffer.set([x, y] as TupleOf<2, number>);
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
        buffer.set(v.get());
        return buffer;
    },

    /**
     * Copy values from one Vec2 to another.
     */
    copy<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 2>,
        v: VecMemoryBuffer<S, 2>,
    ): VecMemoryBuffer<S, 2> {
        out.set(v.get());
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
        out.set([x, y] as TupleOf<2, number>);
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
        const [ax, ay] = a.get();
        const [bx, by] = b.get();
        out.set([ax + bx, ay + by] as TupleOf<2, number>);
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
        const [ax, ay] = a.get();
        const [bx, by] = b.get();
        out.set([ax - bx, ay - by] as TupleOf<2, number>);
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
        const [ax, ay] = a.get();
        const [bx, by] = b.get();
        out.set([ax * bx, ay * by] as TupleOf<2, number>);
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
        const [ax, ay] = a.get();
        const [bx, by] = b.get();
        out.set([ax / bx, ay / by] as TupleOf<2, number>);
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
        const [x, y] = v.get();
        out.set([x * s, y * s] as TupleOf<2, number>);
        return out;
    },

    /**
     * Calculate the dot product of two Vec2s.
     */
    dot<S extends ScalarDescriptor>(
        a: VecMemoryBuffer<S, 2>,
        b: VecMemoryBuffer<S, 2>,
    ): number {
        const [ax, ay] = a.get();
        const [bx, by] = b.get();
        return ax * bx + ay * by;
    },

    /**
     * Calculate the cross product magnitude (z-component) of two Vec2s.
     */
    cross<S extends ScalarDescriptor>(
        a: VecMemoryBuffer<S, 2>,
        b: VecMemoryBuffer<S, 2>,
    ): number {
        const [ax, ay] = a.get();
        const [bx, by] = b.get();
        return ax * by - ay * bx;
    },

    /**
     * Calculate the length (magnitude) of a Vec2.
     */
    length<S extends ScalarDescriptor>(v: VecMemoryBuffer<S, 2>): number {
        const [x, y] = v.get();
        return Math.sqrt(x * x + y * y);
    },

    /**
     * Calculate the squared length of a Vec2.
     */
    lengthSquared<S extends ScalarDescriptor>(v: VecMemoryBuffer<S, 2>): number {
        const [x, y] = v.get();
        return x * x + y * y;
    },

    /**
     * Calculate the distance between two Vec2s.
     */
    distance<S extends ScalarDescriptor>(
        a: VecMemoryBuffer<S, 2>,
        b: VecMemoryBuffer<S, 2>,
    ): number {
        const [ax, ay] = a.get();
        const [bx, by] = b.get();
        const dx = bx - ax;
        const dy = by - ay;
        return Math.sqrt(dx * dx + dy * dy);
    },

    /**
     * Calculate the squared distance between two Vec2s.
     */
    distanceSquared<S extends ScalarDescriptor>(
        a: VecMemoryBuffer<S, 2>,
        b: VecMemoryBuffer<S, 2>,
    ): number {
        const [ax, ay] = a.get();
        const [bx, by] = b.get();
        const dx = bx - ax;
        const dy = by - ay;
        return dx * dx + dy * dy;
    },

    /**
     * Normalize a Vec2: out = v / |v|
     */
    normalize<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 2>,
        v: VecMemoryBuffer<S, 2>,
    ): VecMemoryBuffer<S, 2> {
        const [x, y] = v.get();
        const len = Math.sqrt(x * x + y * y);
        if (len > 0) {
            out.set([x / len, y / len] as TupleOf<2, number>);
        } else {
            out.set([0, 0] as TupleOf<2, number>);
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
        const [x, y] = v.get();
        out.set([-x, -y] as TupleOf<2, number>);
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
        const [ax, ay] = a.get();
        const [bx, by] = b.get();
        out.set([
            ax + t * (bx - ax),
            ay + t * (by - ay),
        ] as TupleOf<2, number>);
        return out;
    },

    /**
     * Rotate a Vec2 by an angle (in radians).
     */
    rotate<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 2>,
        v: VecMemoryBuffer<S, 2>,
        angle: number,
    ): VecMemoryBuffer<S, 2> {
        const [x, y] = v.get();
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        out.set([
            x * c - y * s,
            x * s + y * c,
        ] as TupleOf<2, number>);
        return out;
    },

    /**
     * Get the angle of a Vec2 (in radians).
     */
    angle<S extends ScalarDescriptor>(v: VecMemoryBuffer<S, 2>): number {
        const [x, y] = v.get();
        return Math.atan2(y, x);
    },

    /**
     * Check if two Vec2s are equal.
     */
    equals<S extends ScalarDescriptor>(
        a: VecMemoryBuffer<S, 2>,
        b: VecMemoryBuffer<S, 2>,
    ): boolean {
        const [ax, ay] = a.get();
        const [bx, by] = b.get();
        return ax === bx && ay === by;
    },
};
