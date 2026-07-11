import { allocate, F32, type ScalarDescriptor, Vec, type VecMemoryBuffer } from "metis-data";
import type { TupleOf } from "type-fest";

// ============================================================================
// Vec3 Math Object
// ============================================================================
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
        buffer.set([x, y, z] as TupleOf<3, number>);
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
        buffer.set(v.get());
        return buffer;
    },

    /**
     * Copy values from one Vec3 to another.
     */
    copy<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 3>,
        v: VecMemoryBuffer<S, 3>,
    ): VecMemoryBuffer<S, 3> {
        out.set(v.get());
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
        out.set([x, y, z] as TupleOf<3, number>);
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
        const [ax, ay, az] = a.get();
        const [bx, by, bz] = b.get();
        out.set([ax + bx, ay + by, az + bz] as TupleOf<3, number>);
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
        const [ax, ay, az] = a.get();
        const [bx, by, bz] = b.get();
        out.set([ax - bx, ay - by, az - bz] as TupleOf<3, number>);
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
        const [ax, ay, az] = a.get();
        const [bx, by, bz] = b.get();
        out.set([ax * bx, ay * by, az * bz] as TupleOf<3, number>);
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
        const [ax, ay, az] = a.get();
        const [bx, by, bz] = b.get();
        out.set([ax / bx, ay / by, az / bz] as TupleOf<3, number>);
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
        const [x, y, z] = v.get();
        out.set([x * s, y * s, z * s] as TupleOf<3, number>);
        return out;
    },

    /**
     * Calculate the dot product of two Vec3s.
     */
    dot<S extends ScalarDescriptor>(
        a: VecMemoryBuffer<S, 3>,
        b: VecMemoryBuffer<S, 3>,
    ): number {
        const [ax, ay, az] = a.get();
        const [bx, by, bz] = b.get();
        return ax * bx + ay * by + az * bz;
    },

    /**
     * Calculate the cross product of two Vec3s: out = a × b
     */
    cross<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 3>,
        a: VecMemoryBuffer<S, 3>,
        b: VecMemoryBuffer<S, 3>,
    ): VecMemoryBuffer<S, 3> {
        const [ax, ay, az] = a.get();
        const [bx, by, bz] = b.get();
        out.set([
            ay * bz - az * by,
            az * bx - ax * bz,
            ax * by - ay * bx,
        ] as TupleOf<3, number>);
        return out;
    },

    /**
     * Calculate the length (magnitude) of a Vec3.
     */
    length<S extends ScalarDescriptor>(v: VecMemoryBuffer<S, 3>): number {
        const [x, y, z] = v.get();
        return Math.sqrt(x * x + y * y + z * z);
    },

    /**
     * Calculate the squared length of a Vec3.
     */
    lengthSquared<S extends ScalarDescriptor>(v: VecMemoryBuffer<S, 3>): number {
        const [x, y, z] = v.get();
        return x * x + y * y + z * z;
    },

    /**
     * Calculate the distance between two Vec3s.
     */
    distance<S extends ScalarDescriptor>(
        a: VecMemoryBuffer<S, 3>,
        b: VecMemoryBuffer<S, 3>,
    ): number {
        const [ax, ay, az] = a.get();
        const [bx, by, bz] = b.get();
        const dx = bx - ax;
        const dy = by - ay;
        const dz = bz - az;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    },

    /**
     * Calculate the squared distance between two Vec3s.
     */
    distanceSquared<S extends ScalarDescriptor>(
        a: VecMemoryBuffer<S, 3>,
        b: VecMemoryBuffer<S, 3>,
    ): number {
        const [ax, ay, az] = a.get();
        const [bx, by, bz] = b.get();
        const dx = bx - ax;
        const dy = by - ay;
        const dz = bz - az;
        return dx * dx + dy * dy + dz * dz;
    },

    /**
     * Normalize a Vec3: out = v / |v|
     */
    normalize<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 3>,
        v: VecMemoryBuffer<S, 3>,
    ): VecMemoryBuffer<S, 3> {
        const [x, y, z] = v.get();
        const len = Math.sqrt(x * x + y * y + z * z);
        if (len > 0) {
            out.set([x / len, y / len, z / len] as TupleOf<3, number>);
        } else {
            out.set([0, 0, 0] as TupleOf<3, number>);
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
        const [x, y, z] = v.get();
        out.set([-x, -y, -z] as TupleOf<3, number>);
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
        const [ax, ay, az] = a.get();
        const [bx, by, bz] = b.get();
        out.set([
            ax + t * (bx - ax),
            ay + t * (by - ay),
            az + t * (bz - az),
        ] as TupleOf<3, number>);
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
        const [x, y, z] = v.get();
        const [qx, qy, qz, qw] = q.get();

        // Calculate quat * vec
        const ix = qw * x + qy * z - qz * y;
        const iy = qw * y + qz * x - qx * z;
        const iz = qw * z + qx * y - qy * x;
        const iw = -qx * x - qy * y - qz * z;

        // Calculate result * inverse quat
        out.set([
            ix * qw + iw * -qx + iy * -qz - iz * -qy,
            iy * qw + iw * -qy + iz * -qx - ix * -qz,
            iz * qw + iw * -qz + ix * -qy - iy * -qx,
        ] as TupleOf<3, number>);
        return out;
    },

    /**
     * Check if two Vec3s are equal.
     */
    equals<S extends ScalarDescriptor>(
        a: VecMemoryBuffer<S, 3>,
        b: VecMemoryBuffer<S, 3>,
    ): boolean {
        const [ax, ay, az] = a.get();
        const [bx, by, bz] = b.get();
        return ax === bx && ay === by && az === bz;
    },
};
