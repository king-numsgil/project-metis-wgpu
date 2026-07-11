import { allocate, F32, type ScalarDescriptor, Vec, type VecMemoryBuffer } from "metis-data";
import type { TupleOf } from "type-fest";

// ============================================================================
// Vec4 Math Object
// ============================================================================
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
        buffer.set([x, y, z, w] as TupleOf<4, number>);
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
        buffer.set(v.get());
        return buffer;
    },

    /**
     * Copy values from one Vec4 to another.
     */
    copy<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 4>,
        v: VecMemoryBuffer<S, 4>,
    ): VecMemoryBuffer<S, 4> {
        out.set(v.get());
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
        out.set([x, y, z, w] as TupleOf<4, number>);
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
        const [ax, ay, az, aw] = a.get();
        const [bx, by, bz, bw] = b.get();
        out.set([ax + bx, ay + by, az + bz, aw + bw] as TupleOf<4, number>);
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
        const [ax, ay, az, aw] = a.get();
        const [bx, by, bz, bw] = b.get();
        out.set([ax - bx, ay - by, az - bz, aw - bw] as TupleOf<4, number>);
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
        const [ax, ay, az, aw] = a.get();
        const [bx, by, bz, bw] = b.get();
        out.set([ax * bx, ay * by, az * bz, aw * bw] as TupleOf<4, number>);
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
        const [ax, ay, az, aw] = a.get();
        const [bx, by, bz, bw] = b.get();
        out.set([ax / bx, ay / by, az / bz, aw / bw] as TupleOf<4, number>);
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
        const [x, y, z, w] = v.get();
        out.set([x * s, y * s, z * s, w * s] as TupleOf<4, number>);
        return out;
    },

    /**
     * Calculate the dot product of two Vec4s.
     */
    dot<S extends ScalarDescriptor>(
        a: VecMemoryBuffer<S, 4>,
        b: VecMemoryBuffer<S, 4>,
    ): number {
        const [ax, ay, az, aw] = a.get();
        const [bx, by, bz, bw] = b.get();
        return ax * bx + ay * by + az * bz + aw * bw;
    },

    /**
     * Calculate the length (magnitude) of a Vec4.
     */
    length<S extends ScalarDescriptor>(v: VecMemoryBuffer<S, 4>): number {
        const [x, y, z, w] = v.get();
        return Math.sqrt(x * x + y * y + z * z + w * w);
    },

    /**
     * Calculate the squared length of a Vec4.
     */
    lengthSquared<S extends ScalarDescriptor>(v: VecMemoryBuffer<S, 4>): number {
        const [x, y, z, w] = v.get();
        return x * x + y * y + z * z + w * w;
    },

    /**
     * Normalize a Vec4: out = v / |v|
     */
    normalize<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 4>,
        v: VecMemoryBuffer<S, 4>,
    ): VecMemoryBuffer<S, 4> {
        const [x, y, z, w] = v.get();
        const len = Math.sqrt(x * x + y * y + z * z + w * w);
        if (len > 0) {
            out.set([x / len, y / len, z / len, w / len] as TupleOf<4, number>);
        } else {
            out.set([0, 0, 0, 0] as TupleOf<4, number>);
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
        const [x, y, z, w] = v.get();
        out.set([-x, -y, -z, -w] as TupleOf<4, number>);
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
        const [ax, ay, az, aw] = a.get();
        const [bx, by, bz, bw] = b.get();
        out.set([
            ax + t * (bx - ax),
            ay + t * (by - ay),
            az + t * (bz - az),
            aw + t * (bw - aw),
        ] as TupleOf<4, number>);
        return out;
    },

    /**
     * Check if two Vec4s are equal.
     */
    equals<S extends ScalarDescriptor>(
        a: VecMemoryBuffer<S, 4>,
        b: VecMemoryBuffer<S, 4>,
    ): boolean {
        const [ax, ay, az, aw] = a.get();
        const [bx, by, bz, bw] = b.get();
        return ax === bx && ay === by && az === bz && aw === bw;
    },
};
