import { allocate, F32, type ScalarDescriptor, Vec, type VecMemoryBuffer } from "metis-data";
import type { TupleOf } from "type-fest";
import { Vec3 } from "./vec3.ts";

import { Vec4 } from "./vec4.ts";

// ============================================================================
// Quat Math Object (operates on Vec4 buffers)
// ============================================================================
export const Quat = {
    /**
     * Create an identity quaternion [0, 0, 0, 1].
     */
    identity<S extends ScalarDescriptor>(
        scalar: S = F32 as S,
    ): VecMemoryBuffer<S, 4> {
        const descriptor = Vec(scalar, 4);
        const buffer = allocate(descriptor);
        buffer.set([0, 0, 0, 1] as TupleOf<4, number>);
        return buffer;
    },

    /**
     * Create a quaternion from explicit x, y, z, w components.
     */
    create<S extends ScalarDescriptor>(
        scalar: S = F32 as S,
        x = 0,
        y = 0,
        z = 0,
        w = 1,
    ): VecMemoryBuffer<S, 4> {
        const descriptor = Vec(scalar, 4);
        const buffer = allocate(descriptor);
        buffer.set([x, y, z, w] as TupleOf<4, number>);
        return buffer;
    },

    /**
     * Clone a quaternion into a new buffer.
     */
    clone<S extends ScalarDescriptor>(
        q: VecMemoryBuffer<S, 4>,
    ): VecMemoryBuffer<S, 4> {
        return Vec4.clone(q);
    },

    /**
     * Copy values from one quaternion to another.
     */
    copy<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 4>,
        q: VecMemoryBuffer<S, 4>,
    ): VecMemoryBuffer<S, 4> {
        return Vec4.copy(out, q);
    },

    /**
     * Set a quaternion to the identity quaternion.
     */
    setIdentity<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 4>,
    ): VecMemoryBuffer<S, 4> {
        out.set([0, 0, 0, 1] as TupleOf<4, number>);
        return out;
    },

    /**
     * Set quaternion components.
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
     * Create a quaternion from an axis and angle (in radians).
     */
    fromAxisAngle<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 4>,
        axis: VecMemoryBuffer<S, 3>,
        angle: number,
    ): VecMemoryBuffer<S, 4> {
        const halfAngle = angle * 0.5;
        const s = Math.sin(halfAngle);
        const [x, y, z] = axis.get();
        out.set([
            x * s,
            y * s,
            z * s,
            Math.cos(halfAngle),
        ] as TupleOf<4, number>);
        return out;
    },

    /**
     * Get the axis and angle from a quaternion.
     */
    toAxisAngle<S extends ScalarDescriptor>(
        q: VecMemoryBuffer<S, 4>,
        outAxis: VecMemoryBuffer<S, 3>,
    ): number {
        const [x, y, z, w] = q.get();
        const angle = 2 * Math.acos(w);
        const s = Math.sqrt(1 - w * w);

        if (s < 0.001) {
            outAxis.set([x, y, z] as TupleOf<3, number>);
        } else {
            outAxis.set([x / s, y / s, z / s] as TupleOf<3, number>);
        }

        return angle;
    },

    /**
     * Create a quaternion from Euler angles (in radians), order **XYZ**: the
     * composed rotation is qX·qY·qZ, i.e. Z is applied first, then Y, then X.
     * This matches metis-engine's `T · Rx · Ry · Rz` Transform convention.
     */
    fromEuler<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 4>,
        x: number,
        y: number,
        z: number,
    ): VecMemoryBuffer<S, 4> {
        const halfX = x * 0.5;
        const halfY = y * 0.5;
        const halfZ = z * 0.5;

        const sx = Math.sin(halfX);
        const cx = Math.cos(halfX);
        const sy = Math.sin(halfY);
        const cy = Math.cos(halfY);
        const sz = Math.sin(halfZ);
        const cz = Math.cos(halfZ);

        out.set([
            sx * cy * cz + cx * sy * sz,
            cx * sy * cz - sx * cy * sz,
            cx * cy * sz + sx * sy * cz,
            cx * cy * cz - sx * sy * sz,
        ] as TupleOf<4, number>);
        return out;
    },

    /**
     * Multiply two quaternions: out = a * b
     */
    multiply<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 4>,
        a: VecMemoryBuffer<S, 4>,
        b: VecMemoryBuffer<S, 4>,
    ): VecMemoryBuffer<S, 4> {
        const [ax, ay, az, aw] = a.get();
        const [bx, by, bz, bw] = b.get();

        out.set([
            ax * bw + aw * bx + ay * bz - az * by,
            ay * bw + aw * by + az * bx - ax * bz,
            az * bw + aw * bz + ax * by - ay * bx,
            aw * bw - ax * bx - ay * by - az * bz,
        ] as TupleOf<4, number>);
        return out;
    },

    /**
     * Rotate a quaternion by another quaternion.
     */
    rotate<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 4>,
        a: VecMemoryBuffer<S, 4>,
        b: VecMemoryBuffer<S, 4>,
    ): VecMemoryBuffer<S, 4> {
        return Quat.multiply(out, a, b);
    },

    /**
     * Rotate a quaternion around the X axis.
     */
    rotateX<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 4>,
        q: VecMemoryBuffer<S, 4>,
        angle: number,
    ): VecMemoryBuffer<S, 4> {
        const halfAngle = angle * 0.5;
        const [qx, qy, qz, qw] = q.get();
        const bx = Math.sin(halfAngle);
        const bw = Math.cos(halfAngle);

        out.set([
            qx * bw + qw * bx,
            qy * bw + qz * bx,
            qz * bw - qy * bx,
            qw * bw - qx * bx,
        ] as TupleOf<4, number>);
        return out;
    },

    /**
     * Rotate a quaternion around the Y axis.
     */
    rotateY<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 4>,
        q: VecMemoryBuffer<S, 4>,
        angle: number,
    ): VecMemoryBuffer<S, 4> {
        const halfAngle = angle * 0.5;
        const [qx, qy, qz, qw] = q.get();
        const by = Math.sin(halfAngle);
        const bw = Math.cos(halfAngle);

        out.set([
            qx * bw - qz * by,
            qy * bw + qw * by,
            qz * bw + qx * by,
            qw * bw - qy * by,
        ] as TupleOf<4, number>);
        return out;
    },

    /**
     * Rotate a quaternion around the Z axis.
     */
    rotateZ<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 4>,
        q: VecMemoryBuffer<S, 4>,
        angle: number,
    ): VecMemoryBuffer<S, 4> {
        const halfAngle = angle * 0.5;
        const [qx, qy, qz, qw] = q.get();
        const bz = Math.sin(halfAngle);
        const bw = Math.cos(halfAngle);

        out.set([
            qx * bw + qy * bz,
            qy * bw - qx * bz,
            qz * bw + qw * bz,
            qw * bw - qz * bz,
        ] as TupleOf<4, number>);
        return out;
    },

    /**
     * Calculate the dot product of two quaternions.
     */
    dot<S extends ScalarDescriptor>(
        a: VecMemoryBuffer<S, 4>,
        b: VecMemoryBuffer<S, 4>,
    ): number {
        return Vec4.dot(a, b);
    },

    /**
     * Calculate the length of a quaternion.
     */
    length<S extends ScalarDescriptor>(q: VecMemoryBuffer<S, 4>): number {
        return Vec4.length(q);
    },

    /**
     * Calculate the squared length of a quaternion.
     */
    lengthSquared<S extends ScalarDescriptor>(q: VecMemoryBuffer<S, 4>): number {
        return Vec4.lengthSquared(q);
    },

    /**
     * Normalize a quaternion.
     */
    normalize<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 4>,
        q: VecMemoryBuffer<S, 4>,
    ): VecMemoryBuffer<S, 4> {
        return Vec4.normalize(out, q);
    },

    /**
     * Calculate the conjugate of a quaternion: out = [−x, −y, −z, w]
     */
    conjugate<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 4>,
        q: VecMemoryBuffer<S, 4>,
    ): VecMemoryBuffer<S, 4> {
        const [x, y, z, w] = q.get();
        out.set([-x, -y, -z, w] as TupleOf<4, number>);
        return out;
    },

    /**
     * Calculate the inverse of a quaternion.
     */
    invert<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 4>,
        q: VecMemoryBuffer<S, 4>,
    ): VecMemoryBuffer<S, 4> {
        const [x, y, z, w] = q.get();
        const dot = x * x + y * y + z * z + w * w;

        if (dot === 0) {
            out.set([0, 0, 0, 0] as TupleOf<4, number>);
        } else {
            const invDot = 1.0 / dot;
            out.set([
                -x * invDot,
                -y * invDot,
                -z * invDot,
                w * invDot,
            ] as TupleOf<4, number>);
        }
        return out;
    },

    /**
     * Spherical linear interpolation between two quaternions.
     */
    slerp<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 4>,
        a: VecMemoryBuffer<S, 4>,
        b: VecMemoryBuffer<S, 4>,
        t: number,
    ): VecMemoryBuffer<S, 4> {
        const [ax, ay, az, aw] = a.get();
        let [bx, by, bz, bw] = b.get();

        let cosom = ax * bx + ay * by + az * bz + aw * bw;

        // If negative dot, negate one quaternion to take shorter path
        if (cosom < 0) {
            cosom = -cosom;
            bx = -bx;
            by = -by;
            bz = -bz;
            bw = -bw;
        }

        let scale0: number;
        let scale1: number;

        if (1 - cosom > 0.000001) {
            // Standard case (slerp)
            const omega = Math.acos(cosom);
            const sinom = Math.sin(omega);
            scale0 = Math.sin((1 - t) * omega) / sinom;
            scale1 = Math.sin(t * omega) / sinom;
        } else {
            // Quaternions are very close, use linear interpolation
            scale0 = 1 - t;
            scale1 = t;
        }

        out.set([
            scale0 * ax + scale1 * bx,
            scale0 * ay + scale1 * by,
            scale0 * az + scale1 * bz,
            scale0 * aw + scale1 * bw,
        ] as TupleOf<4, number>);
        return out;
    },

    /**
     * Linear interpolation between two quaternions (not normalized).
     */
    lerp<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 4>,
        a: VecMemoryBuffer<S, 4>,
        b: VecMemoryBuffer<S, 4>,
        t: number,
    ): VecMemoryBuffer<S, 4> {
        return Vec4.lerp(out, a, b, t);
    },

    /**
     * Create a quaternion that rotates from direction 'from' to direction 'to'.
     */
    fromRotationTo<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 4>,
        from: VecMemoryBuffer<S, 3>,
        to: VecMemoryBuffer<S, 3>,
    ): VecMemoryBuffer<S, 4> {
        const [fx, fy, fz] = from.get();
        const [tx, ty, tz] = to.get();

        const dot = fx * tx + fy * ty + fz * tz;

        if (dot < -0.999999) {
            // Vectors are opposite, pick an arbitrary axis
            let axis = Vec3.create(from.type.scalar, 1, 0, 0);
            const tmpCross = Vec3.create(from.type.scalar);
            Vec3.cross(tmpCross, from, axis);

            if (Vec3.length(tmpCross) < 0.000001) {
                axis = Vec3.create(from.type.scalar, 0, 1, 0);
                Vec3.cross(tmpCross, from, axis);
            }

            Vec3.normalize(tmpCross, tmpCross);
            return Quat.fromAxisAngle(out, tmpCross, Math.PI);
        } else if (dot > 0.999999) {
            // Vectors are parallel
            out.set([0, 0, 0, 1] as TupleOf<4, number>);
            return out;
        } else {
            const crossX = fy * tz - fz * ty;
            const crossY = fz * tx - fx * tz;
            const crossZ = fx * ty - fy * tx;

            out.set([
                crossX,
                crossY,
                crossZ,
                1 + dot,
            ] as TupleOf<4, number>);
            return Quat.normalize(out, out);
        }
    },

    /**
     * Get the rotation angle (in radians) of a quaternion.
     */
    getAngle<S extends ScalarDescriptor>(q: VecMemoryBuffer<S, 4>): number {
        const [, , , w] = q.get();
        return 2 * Math.acos(Math.min(Math.abs(w), 1));
    },

    /**
     * Check if two quaternions are equal.
     */
    equals<S extends ScalarDescriptor>(
        a: VecMemoryBuffer<S, 4>,
        b: VecMemoryBuffer<S, 4>,
    ): boolean {
        return Vec4.equals(a, b);
    },
};
