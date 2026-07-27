import { allocate, F32, Mat, type MatMemoryBuffer, type ScalarDescriptor, type VecMemoryBuffer } from "metis-data";
import type { TupleOf } from "type-fest";

import { Quat } from "./quat.ts";

// ============================================================================
// Mat4 Math Object
// ============================================================================
export const Mat4 = {
    /**
     * Create a new 4x4 matrix memory buffer initialized with the given values.
     * Values are provided in column-major order: [m00, m01, m02, m03, m10, m11, m12, m13, m20, m21, m22, m23, m30, m31, m32, m33]
     */
    create<S extends ScalarDescriptor>(
        scalar: S = F32 as S,
        m00 = 1, m01 = 0, m02 = 0, m03 = 0,
        m10 = 0, m11 = 1, m12 = 0, m13 = 0,
        m20 = 0, m21 = 0, m22 = 1, m23 = 0,
        m30 = 0, m31 = 0, m32 = 0, m33 = 1,
    ): MatMemoryBuffer<S, 4> {
        const descriptor = Mat(scalar, 4);
        const buffer = allocate(descriptor);
        buffer.set(0, [m00, m01, m02, m03] as TupleOf<4, number>);
        buffer.set(1, [m10, m11, m12, m13] as TupleOf<4, number>);
        buffer.set(2, [m20, m21, m22, m23] as TupleOf<4, number>);
        buffer.set(3, [m30, m31, m32, m33] as TupleOf<4, number>);
        return buffer;
    },

    /**
     * Clone a Mat4 into a new buffer.
     */
    clone<S extends ScalarDescriptor>(
        m: MatMemoryBuffer<S, 4>,
    ): MatMemoryBuffer<S, 4> {
        const descriptor = Mat(m.type.scalar, 4);
        const buffer = allocate(descriptor);
        buffer.set(0, m.get(0));
        buffer.set(1, m.get(1));
        buffer.set(2, m.get(2));
        buffer.set(3, m.get(3));
        return buffer;
    },

    /**
     * Copy values from one Mat4 to another.
     */
    copy<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 4>,
        m: MatMemoryBuffer<S, 4>,
    ): MatMemoryBuffer<S, 4> {
        out.set(0, m.get(0));
        out.set(1, m.get(1));
        out.set(2, m.get(2));
        out.set(3, m.get(3));
        return out;
    },

    /**
     * Set the components of a Mat4.
     * Values are provided in column-major order: [m00, m01, m02, m03, m10, m11, m12, m13, m20, m21, m22, m23, m30, m31, m32, m33]
     */
    set<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 4>,
        m00: number, m01: number, m02: number, m03: number,
        m10: number, m11: number, m12: number, m13: number,
        m20: number, m21: number, m22: number, m23: number,
        m30: number, m31: number, m32: number, m33: number,
    ): MatMemoryBuffer<S, 4> {
        out.set(0, [m00, m01, m02, m03] as TupleOf<4, number>);
        out.set(1, [m10, m11, m12, m13] as TupleOf<4, number>);
        out.set(2, [m20, m21, m22, m23] as TupleOf<4, number>);
        out.set(3, [m30, m31, m32, m33] as TupleOf<4, number>);
        return out;
    },

    /**
     * Create a 4x4 identity matrix.
     */
    identity<S extends ScalarDescriptor>(
        scalar: S = F32 as S,
    ): MatMemoryBuffer<S, 4> {
        const descriptor = Mat(scalar, 4);
        const buffer = allocate(descriptor);
        buffer.set(0, [1, 0, 0, 0] as TupleOf<4, number>);
        buffer.set(1, [0, 1, 0, 0] as TupleOf<4, number>);
        buffer.set(2, [0, 0, 1, 0] as TupleOf<4, number>);
        buffer.set(3, [0, 0, 0, 1] as TupleOf<4, number>);
        return buffer;
    },

    /**
     * Add two 4x4 matrices: out = a + b
     */
    add<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 4>,
        a: MatMemoryBuffer<S, 4>,
        b: MatMemoryBuffer<S, 4>,
    ): MatMemoryBuffer<S, 4> {
        const aCol0 = a.get(0);
        const aCol1 = a.get(1);
        const aCol2 = a.get(2);
        const aCol3 = a.get(3);
        const bCol0 = b.get(0);
        const bCol1 = b.get(1);
        const bCol2 = b.get(2);
        const bCol3 = b.get(3);

        out.set(0, [
            aCol0[0]! + bCol0[0]!,
            aCol0[1]! + bCol0[1]!,
            aCol0[2]! + bCol0[2]!,
            aCol0[3]! + bCol0[3]!,
        ] as TupleOf<4, number>);
        out.set(1, [
            aCol1[0]! + bCol1[0]!,
            aCol1[1]! + bCol1[1]!,
            aCol1[2]! + bCol1[2]!,
            aCol1[3]! + bCol1[3]!,
        ] as TupleOf<4, number>);
        out.set(2, [
            aCol2[0]! + bCol2[0]!,
            aCol2[1]! + bCol2[1]!,
            aCol2[2]! + bCol2[2]!,
            aCol2[3]! + bCol2[3]!,
        ] as TupleOf<4, number>);
        out.set(3, [
            aCol3[0]! + bCol3[0]!,
            aCol3[1]! + bCol3[1]!,
            aCol3[2]! + bCol3[2]!,
            aCol3[3]! + bCol3[3]!,
        ] as TupleOf<4, number>);
        return out;
    },

    /**
     * Subtract two 4x4 matrices: out = a - b
     */
    subtract<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 4>,
        a: MatMemoryBuffer<S, 4>,
        b: MatMemoryBuffer<S, 4>,
    ): MatMemoryBuffer<S, 4> {
        const aCol0 = a.get(0);
        const aCol1 = a.get(1);
        const aCol2 = a.get(2);
        const aCol3 = a.get(3);
        const bCol0 = b.get(0);
        const bCol1 = b.get(1);
        const bCol2 = b.get(2);
        const bCol3 = b.get(3);

        out.set(0, [
            aCol0[0]! - bCol0[0]!,
            aCol0[1]! - bCol0[1]!,
            aCol0[2]! - bCol0[2]!,
            aCol0[3]! - bCol0[3]!,
        ] as TupleOf<4, number>);
        out.set(1, [
            aCol1[0]! - bCol1[0]!,
            aCol1[1]! - bCol1[1]!,
            aCol1[2]! - bCol1[2]!,
            aCol1[3]! - bCol1[3]!,
        ] as TupleOf<4, number>);
        out.set(2, [
            aCol2[0]! - bCol2[0]!,
            aCol2[1]! - bCol2[1]!,
            aCol2[2]! - bCol2[2]!,
            aCol2[3]! - bCol2[3]!,
        ] as TupleOf<4, number>);
        out.set(3, [
            aCol3[0]! - bCol3[0]!,
            aCol3[1]! - bCol3[1]!,
            aCol3[2]! - bCol3[2]!,
            aCol3[3]! - bCol3[3]!,
        ] as TupleOf<4, number>);
        return out;
    },

    /**
     * Multiply two 4x4 matrices: out = a * b
     */
    multiply<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 4>,
        a: MatMemoryBuffer<S, 4>,
        b: MatMemoryBuffer<S, 4>,
    ): MatMemoryBuffer<S, 4> {
        // View-based: reads and writes go through the cached typed arrays, with
        // no per-column tuple. `ac`/`bc`/`oc` are column strides in *elements*
        // — under Std140 that is not always N (see MatMemoryBuffer.columnElements).
        const av = a.view(), bv = b.view(), ov = out.view();
        const ac = a.columnElements, bc = b.columnElements, oc = out.columnElements;

        // Every operand is read into locals BEFORE any output is written, which
        // is what makes `out` safe to alias with `a` or `b` — each output column
        // depends on all four input columns, so writing column 0 early would
        // corrupt the rest. Pinned by test/aliasingMat.test.ts.
        const a00 = av[0] as number, a01 = av[1] as number, a02 = av[2] as number, a03 = av[3] as number;
        const a10 = av[ac] as number, a11 = av[ac + 1] as number, a12 = av[ac + 2] as number, a13 = av[ac + 3] as number;
        const a20 = av[2 * ac] as number, a21 = av[2 * ac + 1] as number, a22 = av[2 * ac + 2] as number, a23 = av[2 * ac + 3] as number;
        const a30 = av[3 * ac] as number, a31 = av[3 * ac + 1] as number, a32 = av[3 * ac + 2] as number, a33 = av[3 * ac + 3] as number;

        const b00 = bv[0] as number, b01 = bv[1] as number, b02 = bv[2] as number, b03 = bv[3] as number;
        const b10 = bv[bc] as number, b11 = bv[bc + 1] as number, b12 = bv[bc + 2] as number, b13 = bv[bc + 3] as number;
        const b20 = bv[2 * bc] as number, b21 = bv[2 * bc + 1] as number, b22 = bv[2 * bc + 2] as number, b23 = bv[2 * bc + 3] as number;
        const b30 = bv[3 * bc] as number, b31 = bv[3 * bc + 1] as number, b32 = bv[3 * bc + 2] as number, b33 = bv[3 * bc + 3] as number;

        // Column-major: result column j = sum over k of (a column k) * b[j][k].
        ov[0] = a00 * b00 + a10 * b01 + a20 * b02 + a30 * b03;
        ov[1] = a01 * b00 + a11 * b01 + a21 * b02 + a31 * b03;
        ov[2] = a02 * b00 + a12 * b01 + a22 * b02 + a32 * b03;
        ov[3] = a03 * b00 + a13 * b01 + a23 * b02 + a33 * b03;

        ov[oc] = a00 * b10 + a10 * b11 + a20 * b12 + a30 * b13;
        ov[oc + 1] = a01 * b10 + a11 * b11 + a21 * b12 + a31 * b13;
        ov[oc + 2] = a02 * b10 + a12 * b11 + a22 * b12 + a32 * b13;
        ov[oc + 3] = a03 * b10 + a13 * b11 + a23 * b12 + a33 * b13;

        ov[2 * oc] = a00 * b20 + a10 * b21 + a20 * b22 + a30 * b23;
        ov[2 * oc + 1] = a01 * b20 + a11 * b21 + a21 * b22 + a31 * b23;
        ov[2 * oc + 2] = a02 * b20 + a12 * b21 + a22 * b22 + a32 * b23;
        ov[2 * oc + 3] = a03 * b20 + a13 * b21 + a23 * b22 + a33 * b23;

        ov[3 * oc] = a00 * b30 + a10 * b31 + a20 * b32 + a30 * b33;
        ov[3 * oc + 1] = a01 * b30 + a11 * b31 + a21 * b32 + a31 * b33;
        ov[3 * oc + 2] = a02 * b30 + a12 * b31 + a22 * b32 + a32 * b33;
        ov[3 * oc + 3] = a03 * b30 + a13 * b31 + a23 * b32 + a33 * b33;
        return out;
    },

    /**
     * Multiply a 4x4 matrix by a scalar: out = m * s
     */
    scale<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 4>,
        m: MatMemoryBuffer<S, 4>,
        s: number,
    ): MatMemoryBuffer<S, 4> {
        const mCol0 = m.get(0);
        const mCol1 = m.get(1);
        const mCol2 = m.get(2);
        const mCol3 = m.get(3);

        out.set(0, [
            mCol0[0]! * s,
            mCol0[1]! * s,
            mCol0[2]! * s,
            mCol0[3]! * s,
        ] as TupleOf<4, number>);
        out.set(1, [
            mCol1[0]! * s,
            mCol1[1]! * s,
            mCol1[2]! * s,
            mCol1[3]! * s,
        ] as TupleOf<4, number>);
        out.set(2, [
            mCol2[0]! * s,
            mCol2[1]! * s,
            mCol2[2]! * s,
            mCol2[3]! * s,
        ] as TupleOf<4, number>);
        out.set(3, [
            mCol3[0]! * s,
            mCol3[1]! * s,
            mCol3[2]! * s,
            mCol3[3]! * s,
        ] as TupleOf<4, number>);
        return out;
    },

    /**
     * Calculate the determinant of a 4x4 matrix.
     */
    determinant<S extends ScalarDescriptor>(m: MatMemoryBuffer<S, 4>): number {
        const [m00, m01, m02, m03] = m.get(0);
        const [m10, m11, m12, m13] = m.get(1);
        const [m20, m21, m22, m23] = m.get(2);
        const [m30, m31, m32, m33] = m.get(3);

        // Using cofactor expansion along first row
        return m00 * (m11 * (m22 * m33 - m23 * m32) - m12 * (m21 * m33 - m23 * m31) + m13 * (m21 * m32 - m22 * m31)) -
            m01 * (m10 * (m22 * m33 - m23 * m32) - m12 * (m20 * m33 - m23 * m30) + m13 * (m20 * m32 - m22 * m30)) +
            m02 * (m10 * (m21 * m33 - m23 * m31) - m11 * (m20 * m33 - m23 * m30) + m13 * (m20 * m31 - m21 * m30)) -
            m03 * (m10 * (m21 * m32 - m22 * m31) - m11 * (m20 * m32 - m22 * m30) + m12 * (m20 * m31 - m21 * m30));
    },

    /**
     * Calculate the inverse of a 4x4 matrix: out = m^-1
     */
    invert<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 4>,
        m: MatMemoryBuffer<S, 4>,
    ): MatMemoryBuffer<S, 4> {
        const mv = m.view(), ov = out.view();
        const mc = m.columnElements, oc = out.columnElements;

        // All 16 read before any write — `out` may alias `m`.
        const m00 = mv[0] as number, m01 = mv[1] as number, m02 = mv[2] as number, m03 = mv[3] as number;
        const m10 = mv[mc] as number, m11 = mv[mc + 1] as number, m12 = mv[mc + 2] as number, m13 = mv[mc + 3] as number;
        const m20 = mv[2 * mc] as number, m21 = mv[2 * mc + 1] as number, m22 = mv[2 * mc + 2] as number, m23 = mv[2 * mc + 3] as number;
        const m30 = mv[3 * mc] as number, m31 = mv[3 * mc + 1] as number, m32 = mv[3 * mc + 2] as number, m33 = mv[3 * mc + 3] as number;

        // 2x2 minors of the bottom two rows, each used several times below. The
        // previous version recomputed every one of these inline — the same
        // subexpression appears up to six times across the adjugate.
        const s0 = m22 * m33 - m23 * m32;
        const s1 = m21 * m33 - m23 * m31;
        const s2 = m21 * m32 - m22 * m31;
        const s3 = m20 * m33 - m23 * m30;
        const s4 = m20 * m32 - m22 * m30;
        const s5 = m20 * m31 - m21 * m30;
        const s6 = m12 * m33 - m13 * m32;
        const s7 = m11 * m33 - m13 * m31;
        const s8 = m11 * m32 - m12 * m31;
        const s9 = m10 * m33 - m13 * m30;
        const s10 = m10 * m32 - m12 * m30;
        const s11 = m10 * m31 - m11 * m30;
        const s12 = m12 * m23 - m13 * m22;
        const s13 = m11 * m23 - m13 * m21;
        const s14 = m11 * m22 - m12 * m21;
        const s15 = m10 * m23 - m13 * m20;
        const s16 = m10 * m22 - m12 * m20;
        const s17 = m10 * m21 - m11 * m20;

        const c0 = m11 * s0 - m12 * s1 + m13 * s2;
        const c1 = m10 * s0 - m12 * s3 + m13 * s4;
        const c2 = m10 * s1 - m11 * s3 + m13 * s5;
        const c3 = m10 * s2 - m11 * s4 + m12 * s5;

        const det = m00 * c0 - m01 * c1 + m02 * c2 - m03 * c3;

        if (det === 0) {
            // Not invertible — zero matrix, matching the previous behaviour.
            for (let col = 0; col < 4; col++) {
                ov[col * oc] = 0;
                ov[col * oc + 1] = 0;
                ov[col * oc + 2] = 0;
                ov[col * oc + 3] = 0;
            }
            return out;
        }

        const invDet = 1 / det;

        // Adjugate (transpose of the cofactor matrix), scaled by 1/det.
        ov[0] = c0 * invDet;
        ov[1] = (-m01 * s0 + m02 * s1 - m03 * s2) * invDet;
        ov[2] = (m01 * s6 - m02 * s7 + m03 * s8) * invDet;
        ov[3] = (-m01 * s12 + m02 * s13 - m03 * s14) * invDet;

        ov[oc] = -c1 * invDet;
        ov[oc + 1] = (m00 * s0 - m02 * s3 + m03 * s4) * invDet;
        ov[oc + 2] = (-m00 * s6 + m02 * s9 - m03 * s10) * invDet;
        ov[oc + 3] = (m00 * s12 - m02 * s15 + m03 * s16) * invDet;

        ov[2 * oc] = c2 * invDet;
        ov[2 * oc + 1] = (-m00 * s1 + m01 * s3 - m03 * s5) * invDet;
        ov[2 * oc + 2] = (m00 * s7 - m01 * s9 + m03 * s11) * invDet;
        ov[2 * oc + 3] = (-m00 * s13 + m01 * s15 - m03 * s17) * invDet;

        ov[3 * oc] = -c3 * invDet;
        ov[3 * oc + 1] = (m00 * s2 - m01 * s4 + m02 * s5) * invDet;
        ov[3 * oc + 2] = (-m00 * s8 + m01 * s10 - m02 * s11) * invDet;
        ov[3 * oc + 3] = (m00 * s14 - m01 * s16 + m02 * s17) * invDet;
        return out;
    },

    /**
     * Calculate the transpose of a 4x4 matrix: out = m^T
     */
    transpose<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 4>,
        m: MatMemoryBuffer<S, 4>,
    ): MatMemoryBuffer<S, 4> {
        const [m00, m01, m02, m03] = m.get(0);
        const [m10, m11, m12, m13] = m.get(1);
        const [m20, m21, m22, m23] = m.get(2);
        const [m30, m31, m32, m33] = m.get(3);

        out.set(0, [m00, m10, m20, m30] as TupleOf<4, number>);
        out.set(1, [m01, m11, m21, m31] as TupleOf<4, number>);
        out.set(2, [m02, m12, m22, m32] as TupleOf<4, number>);
        out.set(3, [m03, m13, m23, m33] as TupleOf<4, number>);
        return out;
    },

    /**
     * Check if two 4x4 matrices are equal.
     */
    equals<S extends ScalarDescriptor>(
        a: MatMemoryBuffer<S, 4>,
        b: MatMemoryBuffer<S, 4>,
    ): boolean {
        const aCol0 = a.get(0);
        const aCol1 = a.get(1);
        const aCol2 = a.get(2);
        const aCol3 = a.get(3);
        const bCol0 = b.get(0);
        const bCol1 = b.get(1);
        const bCol2 = b.get(2);
        const bCol3 = b.get(3);

        return aCol0[0] === bCol0[0] && aCol0[1] === bCol0[1] && aCol0[2] === bCol0[2] && aCol0[3] === bCol0[3] &&
            aCol1[0] === bCol1[0] && aCol1[1] === bCol1[1] && aCol1[2] === bCol1[2] && aCol1[3] === bCol1[3] &&
            aCol2[0] === bCol2[0] && aCol2[1] === bCol2[1] && aCol2[2] === bCol2[2] && aCol2[3] === bCol2[3] &&
            aCol3[0] === bCol3[0] && aCol3[1] === bCol3[1] && aCol3[2] === bCol3[2] && aCol3[3] === bCol3[3];
    },

    // ============================================================================
    // Transform Functions
    // ============================================================================

    /**
     * Create a 4x4 translation matrix.
     */
    translation<S extends ScalarDescriptor>(
        scalar: S = F32 as S,
        x: number,
        y: number,
        z: number,
    ): MatMemoryBuffer<S, 4> {
        const descriptor = Mat(scalar, 4);
        const buffer = allocate(descriptor);
        buffer.set(0, [1, 0, 0, 0] as TupleOf<4, number>);
        buffer.set(1, [0, 1, 0, 0] as TupleOf<4, number>);
        buffer.set(2, [0, 0, 1, 0] as TupleOf<4, number>);
        buffer.set(3, [x, y, z, 1] as TupleOf<4, number>);
        return buffer;
    },

    /**
     * Create a 4x4 rotation matrix from a quaternion.
     */
    rotation<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 4>,
        q: VecMemoryBuffer<S, 4>,
    ): MatMemoryBuffer<S, 4> {
        const [x, y, z, w] = q.get();

        const xx = x * x;
        const yy = y * y;
        const zz = z * z;
        const xy = x * y;
        const xz = x * z;
        const yz = y * z;
        const wx = w * x;
        const wy = w * y;
        const wz = w * z;

        out.set(0, [
            1 - 2 * (yy + zz),
            2 * (xy + wz),
            2 * (xz - wy),
            0,
        ] as TupleOf<4, number>);
        out.set(1, [
            2 * (xy - wz),
            1 - 2 * (xx + zz),
            2 * (yz + wx),
            0,
        ] as TupleOf<4, number>);
        out.set(2, [
            2 * (xz + wy),
            2 * (yz - wx),
            1 - 2 * (xx + yy),
            0,
        ] as TupleOf<4, number>);
        out.set(3, [0, 0, 0, 1] as TupleOf<4, number>);
        return out;
    },

    /**
     * Create a 4x4 rotation matrix from axis and angle (in radians).
     */
    fromAxisAngle<S extends ScalarDescriptor>(
        scalar: S = F32 as S,
        axis: VecMemoryBuffer<S, 3>,
        angle: number,
    ): MatMemoryBuffer<S, 4> {
        const tempQuat = Quat.create(scalar);
        const result = Mat4.identity(scalar);
        Quat.fromAxisAngle(tempQuat, axis, angle);
        return Mat4.rotation(result, tempQuat);
    },

    /**
     * Create a 4x4 rotation matrix from Euler angles (in radians), order **XYZ**
     * (qX·qY·qZ — Z applied first, then Y, then X; matches metis-engine's Transform).
     */
    fromEuler<S extends ScalarDescriptor>(
        scalar: S = F32 as S,
        x: number,
        y: number,
        z: number,
    ): MatMemoryBuffer<S, 4> {
        const tempQuat = Quat.create(scalar);
        const result = Mat4.identity(scalar);
        Quat.fromEuler(tempQuat, x, y, z);
        return Mat4.rotation(result, tempQuat);
    },

    /**
     * Create a 4x4 scaling matrix.
     */
    scaling<S extends ScalarDescriptor>(
        scalar: S = F32 as S,
        x: number,
        y: number,
        z: number,
    ): MatMemoryBuffer<S, 4> {
        const descriptor = Mat(scalar, 4);
        const buffer = allocate(descriptor);
        buffer.set(0, [x, 0, 0, 0] as TupleOf<4, number>);
        buffer.set(1, [0, y, 0, 0] as TupleOf<4, number>);
        buffer.set(2, [0, 0, z, 0] as TupleOf<4, number>);
        buffer.set(3, [0, 0, 0, 1] as TupleOf<4, number>);
        return buffer;
    },

    /**
     * Create a 4x4 uniform scaling matrix.
     */
    uniformScaling<S extends ScalarDescriptor>(
        scalar: S = F32 as S,
        scale: number,
    ): MatMemoryBuffer<S, 4> {
        return Mat4.scaling(scalar, scale, scale, scale);
    },

    /**
     * Create a 4x4 look-at view matrix.
     */
    lookAt<S extends ScalarDescriptor>(
        scalar: S = F32 as S,
        eye: VecMemoryBuffer<S, 3>,
        center: VecMemoryBuffer<S, 3>,
        up: VecMemoryBuffer<S, 3>,
    ): MatMemoryBuffer<S, 4> {
        const [ex, ey, ez] = eye.get();
        const [cx, cy, cz] = center.get();
        const [ux, uy, uz] = up.get();

        // Calculate forward vector
        let fx = cx - ex;
        let fy = cy - ey;
        let fz = cz - ez;

        // Normalize forward vector
        let fLen = Math.sqrt(fx * fx + fy * fy + fz * fz);
        if (fLen > 0.000001) {
            fx /= fLen;
            fy /= fLen;
            fz /= fLen;
        }

        // Calculate right vector (cross product of forward and up)
        let rx = fy * uz - fz * uy;
        let ry = fz * ux - fx * uz;
        let rz = fx * uy - fy * ux;

        // Normalize right vector
        let rLen = Math.sqrt(rx * rx + ry * ry + rz * rz);
        if (rLen > 0.000001) {
            rx /= rLen;
            ry /= rLen;
            rz /= rLen;
        }

        // Calculate true up vector (cross product of right and forward)
        let tx = ry * fz - rz * fy;
        let ty = rz * fx - rx * fz;
        let tz = rx * fy - ry * fx;

        const descriptor = Mat(scalar, 4);
        const buffer = allocate(descriptor);
        buffer.set(0, [rx, tx, -fx, 0] as TupleOf<4, number>);
        buffer.set(1, [ry, ty, -fy, 0] as TupleOf<4, number>);
        buffer.set(2, [rz, tz, -fz, 0] as TupleOf<4, number>);
        buffer.set(3, [-(rx * ex + ry * ey + rz * ez), -(tx * ex + ty * ey + tz * ez), fx * ex + fy * ey + fz * ez, 1] as TupleOf<4, number>);
        return buffer;
    },

    /**
     * Create a 4x4 right-handed perspective projection matrix for **WebGPU**
     * (clip-space depth range z ∈ [0, 1], NOT OpenGL's [-1, 1]). The camera looks
     * down -z; view-space `-near` maps to ndc.z = 0 and `-far` to ndc.z = 1.
     * Pass `far = Infinity` for an infinite far plane (near → 0, ∞ → 1).
     */
    perspective<S extends ScalarDescriptor>(
        scalar: S = F32 as S,
        fovy: number,
        aspect: number,
        near: number,
        far: number,
    ): MatMemoryBuffer<S, 4> {
        const f = 1.0 / Math.tan(0.5 * fovy);

        const descriptor = Mat(scalar, 4);
        const buffer = allocate(descriptor);
        buffer.set(0, [f / aspect, 0, 0, 0] as TupleOf<4, number>);
        buffer.set(1, [0, f, 0, 0] as TupleOf<4, number>);
        if (far === Infinity) {
            buffer.set(2, [0, 0, -1, -1] as TupleOf<4, number>);
            buffer.set(3, [0, 0, -near, 0] as TupleOf<4, number>);
        } else {
            const nf = 1 / (near - far);
            buffer.set(2, [0, 0, far * nf, -1] as TupleOf<4, number>);
            buffer.set(3, [0, 0, far * near * nf, 0] as TupleOf<4, number>);
        }
        return buffer;
    },

    /**
     * Create a 4x4 **reverse-Z** right-handed perspective matrix for WebGPU:
     * view-space `-near` maps to ndc.z = 1 and `-far` (or infinity) to ndc.z = 0.
     * This is *the* projection for a large-depth-range scene — pairing it with a
     * `depth32float` buffer and `depthCompare: "greater"` (clear 0.0) gives near-
     * constant relative depth precision from centimetres to astronomical range
     * (see metis-engine's reverse-Z notes).
     *
     * `far` defaults to `Infinity` (the common case): the far plane then cancels
     * out entirely and costs no precision. With infinite far, ndc.z == near / (-view.z).
     */
    perspectiveReverseZ<S extends ScalarDescriptor>(
        scalar: S = F32 as S,
        fovy: number,
        aspect: number,
        near: number,
        far: number = Infinity,
    ): MatMemoryBuffer<S, 4> {
        const f = 1.0 / Math.tan(0.5 * fovy);

        const descriptor = Mat(scalar, 4);
        const buffer = allocate(descriptor);
        buffer.set(0, [f / aspect, 0, 0, 0] as TupleOf<4, number>);
        buffer.set(1, [0, f, 0, 0] as TupleOf<4, number>);
        if (far === Infinity) {
            buffer.set(2, [0, 0, 0, -1] as TupleOf<4, number>);
            buffer.set(3, [0, 0, near, 0] as TupleOf<4, number>);
        } else {
            const rangeInv = 1 / (far - near);
            buffer.set(2, [0, 0, near * rangeInv, -1] as TupleOf<4, number>);
            buffer.set(3, [0, 0, far * near * rangeInv, 0] as TupleOf<4, number>);
        }
        return buffer;
    },

    /**
     * Create a 4x4 orthographic projection matrix for **WebGPU** (clip-space
     * depth range z ∈ [0, 1], NOT OpenGL's [-1, 1]). View-space `-near` maps to
     * ndc.z = 0 and `-far` to ndc.z = 1.
     */
    orthographic<S extends ScalarDescriptor>(
        scalar: S = F32 as S,
        left: number,
        right: number,
        bottom: number,
        top: number,
        near: number,
        far: number,
    ): MatMemoryBuffer<S, 4> {
        const lr = 1 / (left - right);
        const bt = 1 / (bottom - top);
        const nf = 1 / (near - far);

        const descriptor = Mat(scalar, 4);
        const buffer = allocate(descriptor);
        buffer.set(0, [-2 * lr, 0, 0, 0] as TupleOf<4, number>);
        buffer.set(1, [0, -2 * bt, 0, 0] as TupleOf<4, number>);
        buffer.set(2, [0, 0, nf, 0] as TupleOf<4, number>);
        buffer.set(3, [(left + right) * lr, (top + bottom) * bt, near * nf, 1] as TupleOf<4, number>);
        return buffer;
    },

    /**
     * Translate a 4x4 matrix by (x, y, z).
     */
    translate<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 4>,
        m: MatMemoryBuffer<S, 4>,
        x: number,
        y: number,
        z: number,
    ): MatMemoryBuffer<S, 4> {
        const mCol0 = m.get(0);
        const mCol1 = m.get(1);
        const mCol2 = m.get(2);
        const mCol3 = m.get(3);

        out.set(0, mCol0);
        out.set(1, mCol1);
        out.set(2, mCol2);
        out.set(3, [
            mCol3[0]! + mCol0[0]! * x + mCol1[0]! * y + mCol2[0]! * z,
            mCol3[1]! + mCol0[1]! * x + mCol1[1]! * y + mCol2[1]! * z,
            mCol3[2]! + mCol0[2]! * x + mCol1[2]! * y + mCol2[2]! * z,
            mCol3[3]! + mCol0[3]! * x + mCol1[3]! * y + mCol2[3]! * z,
        ] as TupleOf<4, number>);
        return out;
    },

    /**
     * Rotate a 4x4 matrix by a quaternion.
     */
    rotate<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 4>,
        m: MatMemoryBuffer<S, 4>,
        q: VecMemoryBuffer<S, 4>,
    ): MatMemoryBuffer<S, 4> {
        const rotationMatrix = Mat4.identity(m.type.scalar);
        Mat4.rotation(rotationMatrix, q);
        return Mat4.multiply(out, m, rotationMatrix);
    },

    /**
     * Scale a 4x4 matrix by (x, y, z).
     */
    scaleMatrix<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 4>,
        m: MatMemoryBuffer<S, 4>,
        x: number,
        y: number,
        z: number,
    ): MatMemoryBuffer<S, 4> {
        const mCol0 = m.get(0);
        const mCol1 = m.get(1);
        const mCol2 = m.get(2);
        const mCol3 = m.get(3);

        out.set(0, [
            mCol0[0]! * x,
            mCol0[1]! * x,
            mCol0[2]! * x,
            mCol0[3]! * x,
        ] as TupleOf<4, number>);
        out.set(1, [
            mCol1[0]! * y,
            mCol1[1]! * y,
            mCol1[2]! * y,
            mCol1[3]! * y,
        ] as TupleOf<4, number>);
        out.set(2, [
            mCol2[0]! * z,
            mCol2[1]! * z,
            mCol2[2]! * z,
            mCol2[3]! * z,
        ] as TupleOf<4, number>);
        out.set(3, mCol3);
        return out;
    },

    /**
     * Create a 4x4 matrix from translation, rotation, and scale components (TRS).
     * Combines translation (tx, ty, tz), rotation (quaternion), and scale (sx, sy, sz)
     * into a single transformation matrix: T * R * S
     */
    /**
     * Compose translation * rotation * scale into `out` — the out-first,
     * allocation-free counterpart to {@link fromTRS}.
     *
     * Identical result to `fromTRS`, which builds three intermediate matrices
     * and multiplies them. That is fine for setup, but this is the shape a
     * renderer calls per instance per frame, so it writes the closed form
     * directly: the rotation's columns scaled by `sx`/`sy`/`sz`, plus the
     * translation column. Safe when `out` aliases nothing else (`q` is only
     * read).
     *
     * The quaternion convention matches {@link rotation} exactly — change one
     * and this silently disagrees with it.
     */
    composeTRS<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 4>,
        tx: number,
        ty: number,
        tz: number,
        q: VecMemoryBuffer<S, 4>,
        sx: number,
        sy: number,
        sz: number,
    ): MatMemoryBuffer<S, 4> {
        const qv = q.view();
        const x = qv[0] as number, y = qv[1] as number, z = qv[2] as number, w = qv[3] as number;
        const ov = out.view();
        const c = out.columnElements;

        const xx = x * x, yy = y * y, zz = z * z;
        const xy = x * y, xz = x * z, yz = y * z;
        const wx = w * x, wy = w * y, wz = w * z;

        ov[0] = (1 - 2 * (yy + zz)) * sx;
        ov[1] = (2 * (xy + wz)) * sx;
        ov[2] = (2 * (xz - wy)) * sx;
        ov[3] = 0;

        ov[c] = (2 * (xy - wz)) * sy;
        ov[c + 1] = (1 - 2 * (xx + zz)) * sy;
        ov[c + 2] = (2 * (yz + wx)) * sy;
        ov[c + 3] = 0;

        ov[2 * c] = (2 * (xz + wy)) * sz;
        ov[2 * c + 1] = (2 * (yz - wx)) * sz;
        ov[2 * c + 2] = (1 - 2 * (xx + yy)) * sz;
        ov[2 * c + 3] = 0;

        ov[3 * c] = tx;
        ov[3 * c + 1] = ty;
        ov[3 * c + 2] = tz;
        ov[3 * c + 3] = 1;
        return out;
    },

    fromTRS<S extends ScalarDescriptor>(
        scalar: S = F32 as S,
        tx: number,
        ty: number,
        tz: number,
        q: VecMemoryBuffer<S, 4>,
        sx: number,
        sy: number,
        sz: number,
    ): MatMemoryBuffer<S, 4> {
        const scaling = Mat4.scaling(scalar, sx, sy, sz);
        const rotation = Mat4.identity(scalar);
        Mat4.rotation(rotation, q);
        const translation = Mat4.translation(scalar, tx, ty, tz);

        const temp = Mat4.create(scalar);
        Mat4.multiply(temp, translation, rotation);
        return Mat4.multiply(temp, temp, scaling);
    },

    /**
     * Decompose a 4x4 matrix into translation, rotation, and scale components.
     * Returns [translation, rotation, scale] where translation is a Vec3, rotation is a Quat (Vec4), and scale is a Vec3
     */
    decompose<S extends ScalarDescriptor>(
        m: MatMemoryBuffer<S, 4>,
        outTranslation: VecMemoryBuffer<S, 3>,
        outRotation: VecMemoryBuffer<S, 4>,
        outScale: VecMemoryBuffer<S, 3>,
    ): [VecMemoryBuffer<S, 3>, VecMemoryBuffer<S, 4>, VecMemoryBuffer<S, 3>] {
        const mCol0 = m.get(0);
        const mCol1 = m.get(1);
        const mCol2 = m.get(2);
        const mCol3 = m.get(3);

        // Extract translation
        outTranslation.set([mCol3[0]!, mCol3[1]!, mCol3[2]!] as TupleOf<3, number>);

        // Extract scale
        const scaleX = Math.sqrt(mCol0[0]! * mCol0[0]! + mCol0[1]! * mCol0[1]! + mCol0[2]! * mCol0[2]!);
        const scaleY = Math.sqrt(mCol1[0]! * mCol1[0]! + mCol1[1]! * mCol1[1]! + mCol1[2]! * mCol1[2]!);
        const scaleZ = Math.sqrt(mCol2[0]! * mCol2[0]! + mCol2[1]! * mCol2[1]! + mCol2[2]! * mCol2[2]!);
        outScale.set([scaleX, scaleY, scaleZ] as TupleOf<3, number>);

        // Extract rotation by creating a pure rotation matrix
        const invScaleX = scaleX > 0.000001 ? 1 / scaleX : 0;
        const invScaleY = scaleY > 0.000001 ? 1 / scaleY : 0;
        const invScaleZ = scaleZ > 0.000001 ? 1 / scaleZ : 0;

        const rotationMatrix = Mat4.create(outRotation.type.scalar,
            mCol0[0]! * invScaleX, mCol0[1]! * invScaleX, mCol0[2]! * invScaleX, 0,
            mCol1[0]! * invScaleY, mCol1[1]! * invScaleY, mCol1[2]! * invScaleY, 0,
            mCol2[0]! * invScaleZ, mCol2[1]! * invScaleZ, mCol2[2]! * invScaleZ, 0,
            0, 0, 0, 1,
        );

        // Convert rotation matrix to quaternion
        Mat4.toQuat(outRotation, rotationMatrix);

        return [outTranslation, outRotation, outScale];
    },

    /**
     * Extract the translation vector from a 4x4 matrix.
     */
    getTranslation<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 3>,
        m: MatMemoryBuffer<S, 4>,
    ): VecMemoryBuffer<S, 3> {
        const mCol3 = m.get(3);
        out.set([mCol3[0]!, mCol3[1]!, mCol3[2]!] as TupleOf<3, number>);
        return out;
    },

    /**
     * Extract the rotation quaternion from a 4x4 matrix.
     */
    getRotation<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 4>,
        m: MatMemoryBuffer<S, 4>,
    ): VecMemoryBuffer<S, 4> {
        return Mat4.toQuat(out, m);
    },

    /**
     * Extract scale factors from a 4x4 matrix.
     */
    getScale<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 3>,
        m: MatMemoryBuffer<S, 4>,
    ): VecMemoryBuffer<S, 3> {
        const mCol0 = m.get(0);
        const mCol1 = m.get(1);
        const mCol2 = m.get(2);

        const scaleX = Math.sqrt(mCol0[0]! * mCol0[0]! + mCol0[1]! * mCol0[1]! + mCol0[2]! * mCol0[2]!);
        const scaleY = Math.sqrt(mCol1[0]! * mCol1[0]! + mCol1[1]! * mCol1[1]! + mCol1[2]! * mCol1[2]!);
        const scaleZ = Math.sqrt(mCol2[0]! * mCol2[0]! + mCol2[1]! * mCol2[1]! + mCol2[2]! * mCol2[2]!);

        out.set([scaleX, scaleY, scaleZ] as TupleOf<3, number>);
        return out;
    },

    /**
     * Extract the 3x3 rotation/scaling part from a 4x4 matrix.
     */
    getLinearTransform<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 3>,
        m: MatMemoryBuffer<S, 4>,
    ): MatMemoryBuffer<S, 3> {
        const mCol0 = m.get(0);
        const mCol1 = m.get(1);
        const mCol2 = m.get(2);

        out.set(0, [mCol0[0]!, mCol0[1]!, mCol0[2]!] as TupleOf<3, number>);
        out.set(1, [mCol1[0]!, mCol1[1]!, mCol1[2]!] as TupleOf<3, number>);
        out.set(2, [mCol2[0]!, mCol2[1]!, mCol2[2]!] as TupleOf<3, number>);
        return out;
    },

    // ============================================================================
    // Quaternion Conversion Functions
    // ============================================================================

    /**
     * Convert a 4x4 matrix to a quaternion.
     * Assumes the matrix contains only rotation (no scaling or shearing).
     */
    toQuat<S extends ScalarDescriptor>(
        out: VecMemoryBuffer<S, 4>,
        m: MatMemoryBuffer<S, 4>,
    ): VecMemoryBuffer<S, 4> {
        // Column-major storage: m.get(c)[r] is the element at row r, column c.
        // Name locals as true mRC = M[row][col] so the extraction below (standard
        // Shoemake) is correct — reading these as columns is exactly the transpose
        // bug that used to make toQuat return the conjugate.
        const c0 = m.get(0);
        const c1 = m.get(1);
        const c2 = m.get(2);
        const m00 = c0[0]!, m10 = c0[1]!, m20 = c0[2]!;
        const m01 = c1[0]!, m11 = c1[1]!, m21 = c1[2]!;
        const m02 = c2[0]!, m12 = c2[1]!, m22 = c2[2]!;

        const trace = m00 + m11 + m22;

        if (trace > 0) {
            const s = Math.sqrt(trace + 1.0) * 2; // s = 4 * qw
            out.set([
                (m21 - m12) / s,
                (m02 - m20) / s,
                (m10 - m01) / s,
                0.25 * s,
            ] as TupleOf<4, number>);
        } else if ((m00 > m11) && (m00 > m22)) {
            const s = Math.sqrt(1.0 + m00 - m11 - m22) * 2; // s = 4 * qx
            out.set([
                0.25 * s,
                (m01 + m10) / s,
                (m02 + m20) / s,
                (m21 - m12) / s,
            ] as TupleOf<4, number>);
        } else if (m11 > m22) {
            const s = Math.sqrt(1.0 + m11 - m00 - m22) * 2; // s = 4 * qy
            out.set([
                (m01 + m10) / s,
                0.25 * s,
                (m12 + m21) / s,
                (m02 - m20) / s,
            ] as TupleOf<4, number>);
        } else {
            const s = Math.sqrt(1.0 + m22 - m00 - m11) * 2; // s = 4 * qz
            out.set([
                (m02 + m20) / s,
                (m12 + m21) / s,
                0.25 * s,
                (m10 - m01) / s,
            ] as TupleOf<4, number>);
        }
        return out;
    },

    /**
     * Convert a quaternion to a 4x4 rotation matrix.
     * This is an alias for the rotation method.
     */
    fromQuat<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 4>,
        q: VecMemoryBuffer<S, 4>,
    ): MatMemoryBuffer<S, 4> {
        return Mat4.rotation(out, q);
    },
};
