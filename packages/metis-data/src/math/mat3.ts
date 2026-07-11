import { allocate, F32, Mat, type MatMemoryBuffer, type ScalarDescriptor } from "metis-data";
import type { TupleOf } from "type-fest";

// ============================================================================
// Mat3 Math Object
// ============================================================================
export const Mat3 = {
    /**
     * Create a new 3x3 matrix memory buffer initialized with the given values.
     * Values are provided in column-major order: [m00, m01, m02, m10, m11, m12, m20, m21, m22]
     */
    create<S extends ScalarDescriptor>(
        scalar: S = F32 as S,
        m00 = 1, m01 = 0, m02 = 0,
        m10 = 0, m11 = 1, m12 = 0,
        m20 = 0, m21 = 0, m22 = 1,
    ): MatMemoryBuffer<S, 3> {
        const descriptor = Mat(scalar, 3);
        const buffer = allocate(descriptor);
        buffer.set(0, [m00, m01, m02] as TupleOf<3, number>);
        buffer.set(1, [m10, m11, m12] as TupleOf<3, number>);
        buffer.set(2, [m20, m21, m22] as TupleOf<3, number>);
        return buffer;
    },

    /**
     * Clone a Mat3 into a new buffer.
     */
    clone<S extends ScalarDescriptor>(
        m: MatMemoryBuffer<S, 3>,
    ): MatMemoryBuffer<S, 3> {
        const descriptor = Mat(m.type.scalar, 3);
        const buffer = allocate(descriptor);
        buffer.set(0, m.get(0));
        buffer.set(1, m.get(1));
        buffer.set(2, m.get(2));
        return buffer;
    },

    /**
     * Copy values from one Mat3 to another.
     */
    copy<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 3>,
        m: MatMemoryBuffer<S, 3>,
    ): MatMemoryBuffer<S, 3> {
        out.set(0, m.get(0));
        out.set(1, m.get(1));
        out.set(2, m.get(2));
        return out;
    },

    /**
     * Set the components of a Mat3.
     * Values are provided in column-major order: [m00, m01, m02, m10, m11, m12, m20, m21, m22]
     */
    set<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 3>,
        m00: number, m01: number, m02: number,
        m10: number, m11: number, m12: number,
        m20: number, m21: number, m22: number,
    ): MatMemoryBuffer<S, 3> {
        out.set(0, [m00, m01, m02] as TupleOf<3, number>);
        out.set(1, [m10, m11, m12] as TupleOf<3, number>);
        out.set(2, [m20, m21, m22] as TupleOf<3, number>);
        return out;
    },

    /**
     * Create a 3x3 identity matrix.
     */
    identity<S extends ScalarDescriptor>(
        scalar: S = F32 as S,
    ): MatMemoryBuffer<S, 3> {
        const descriptor = Mat(scalar, 3);
        const buffer = allocate(descriptor);
        buffer.set(0, [1, 0, 0] as TupleOf<3, number>);
        buffer.set(1, [0, 1, 0] as TupleOf<3, number>);
        buffer.set(2, [0, 0, 1] as TupleOf<3, number>);
        return buffer;
    },

    /**
     * Add two 3x3 matrices: out = a + b
     */
    add<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 3>,
        a: MatMemoryBuffer<S, 3>,
        b: MatMemoryBuffer<S, 3>,
    ): MatMemoryBuffer<S, 3> {
        const aCol0 = a.get(0);
        const aCol1 = a.get(1);
        const aCol2 = a.get(2);
        const bCol0 = b.get(0);
        const bCol1 = b.get(1);
        const bCol2 = b.get(2);

        out.set(0, [
            aCol0[0]! + bCol0[0]!,
            aCol0[1]! + bCol0[1]!,
            aCol0[2]! + bCol0[2]!,
        ] as TupleOf<3, number>);
        out.set(1, [
            aCol1[0]! + bCol1[0]!,
            aCol1[1]! + bCol1[1]!,
            aCol1[2]! + bCol1[2]!,
        ] as TupleOf<3, number>);
        out.set(2, [
            aCol2[0]! + bCol2[0]!,
            aCol2[1]! + bCol2[1]!,
            aCol2[2]! + bCol2[2]!,
        ] as TupleOf<3, number>);
        return out;
    },

    /**
     * Subtract two 3x3 matrices: out = a - b
     */
    subtract<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 3>,
        a: MatMemoryBuffer<S, 3>,
        b: MatMemoryBuffer<S, 3>,
    ): MatMemoryBuffer<S, 3> {
        const aCol0 = a.get(0);
        const aCol1 = a.get(1);
        const aCol2 = a.get(2);
        const bCol0 = b.get(0);
        const bCol1 = b.get(1);
        const bCol2 = b.get(2);

        out.set(0, [
            aCol0[0]! - bCol0[0]!,
            aCol0[1]! - bCol0[1]!,
            aCol0[2]! - bCol0[2]!,
        ] as TupleOf<3, number>);
        out.set(1, [
            aCol1[0]! - bCol1[0]!,
            aCol1[1]! - bCol1[1]!,
            aCol1[2]! - bCol1[2]!,
        ] as TupleOf<3, number>);
        out.set(2, [
            aCol2[0]! - bCol2[0]!,
            aCol2[1]! - bCol2[1]!,
            aCol2[2]! - bCol2[2]!,
        ] as TupleOf<3, number>);
        return out;
    },

    /**
     * Multiply two 3x3 matrices: out = a * b
     */
    multiply<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 3>,
        a: MatMemoryBuffer<S, 3>,
        b: MatMemoryBuffer<S, 3>,
    ): MatMemoryBuffer<S, 3> {
        const aCol0 = a.get(0);
        const aCol1 = a.get(1);
        const aCol2 = a.get(2);
        const bCol0 = b.get(0);
        const bCol1 = b.get(1);
        const bCol2 = b.get(2);

        // Matrix multiplication: result[i][j] = sum(a[i][k] * b[k][j])
        // Since we store in column-major: result[j][i] = sum(a[k][i] * b[j][k])
        out.set(0, [
            aCol0[0]! * bCol0[0]! + aCol1[0]! * bCol0[1]! + aCol2[0]! * bCol0[2]!,
            aCol0[1]! * bCol0[0]! + aCol1[1]! * bCol0[1]! + aCol2[1]! * bCol0[2]!,
            aCol0[2]! * bCol0[0]! + aCol1[2]! * bCol0[1]! + aCol2[2]! * bCol0[2]!,
        ] as TupleOf<3, number>);
        out.set(1, [
            aCol0[0]! * bCol1[0]! + aCol1[0]! * bCol1[1]! + aCol2[0]! * bCol1[2]!,
            aCol0[1]! * bCol1[0]! + aCol1[1]! * bCol1[1]! + aCol2[1]! * bCol1[2]!,
            aCol0[2]! * bCol1[0]! + aCol1[2]! * bCol1[1]! + aCol2[2]! * bCol1[2]!,
        ] as TupleOf<3, number>);
        out.set(2, [
            aCol0[0]! * bCol2[0]! + aCol1[0]! * bCol2[1]! + aCol2[0]! * bCol2[2]!,
            aCol0[1]! * bCol2[0]! + aCol1[1]! * bCol2[1]! + aCol2[1]! * bCol2[2]!,
            aCol0[2]! * bCol2[0]! + aCol1[2]! * bCol2[1]! + aCol2[2]! * bCol2[2]!,
        ] as TupleOf<3, number>);
        return out;
    },

    /**
     * Multiply a 3x3 matrix by a scalar: out = m * s
     */
    scale<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 3>,
        m: MatMemoryBuffer<S, 3>,
        s: number,
    ): MatMemoryBuffer<S, 3> {
        const mCol0 = m.get(0);
        const mCol1 = m.get(1);
        const mCol2 = m.get(2);

        out.set(0, [
            mCol0[0]! * s,
            mCol0[1]! * s,
            mCol0[2]! * s,
        ] as TupleOf<3, number>);
        out.set(1, [
            mCol1[0]! * s,
            mCol1[1]! * s,
            mCol1[2]! * s,
        ] as TupleOf<3, number>);
        out.set(2, [
            mCol2[0]! * s,
            mCol2[1]! * s,
            mCol2[2]! * s,
        ] as TupleOf<3, number>);
        return out;
    },

    /**
     * Calculate the determinant of a 3x3 matrix.
     */
    determinant<S extends ScalarDescriptor>(m: MatMemoryBuffer<S, 3>): number {
        const [m00, m01, m02] = m.get(0);
        const [m10, m11, m12] = m.get(1);
        const [m20, m21, m22] = m.get(2);

        return m00 * (m11 * m22 - m12 * m21) -
            m10 * (m01 * m22 - m02 * m21) +
            m20 * (m01 * m12 - m02 * m11);
    },

    /**
     * Calculate the inverse of a 3x3 matrix: out = m^-1
     */
    invert<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 3>,
        m: MatMemoryBuffer<S, 3>,
    ): MatMemoryBuffer<S, 3> {
        const [m00, m01, m02] = m.get(0);
        const [m10, m11, m12] = m.get(1);
        const [m20, m21, m22] = m.get(2);

        const det = m00 * (m11 * m22 - m12 * m21) -
            m10 * (m01 * m22 - m02 * m21) +
            m20 * (m01 * m12 - m02 * m11);

        if (det === 0) {
            out.set(0, [0, 0, 0] as TupleOf<3, number>);
            out.set(1, [0, 0, 0] as TupleOf<3, number>);
            out.set(2, [0, 0, 0] as TupleOf<3, number>);
            return out;
        }

        const invDet = 1 / det;

        out.set(0, [
            (m11 * m22 - m12 * m21) * invDet,
            (m02 * m21 - m01 * m22) * invDet,
            (m01 * m12 - m02 * m11) * invDet,
        ] as TupleOf<3, number>);
        out.set(1, [
            (m12 * m20 - m10 * m22) * invDet,
            (m00 * m22 - m02 * m20) * invDet,
            (m02 * m10 - m00 * m12) * invDet,
        ] as TupleOf<3, number>);
        out.set(2, [
            (m10 * m21 - m11 * m20) * invDet,
            (m01 * m20 - m00 * m21) * invDet,
            (m00 * m11 - m01 * m10) * invDet,
        ] as TupleOf<3, number>);
        return out;
    },

    /**
     * Calculate the transpose of a 3x3 matrix: out = m^T
     */
    transpose<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 3>,
        m: MatMemoryBuffer<S, 3>,
    ): MatMemoryBuffer<S, 3> {
        const [m00, m01, m02] = m.get(0);
        const [m10, m11, m12] = m.get(1);
        const [m20, m21, m22] = m.get(2);

        out.set(0, [m00, m10, m20] as TupleOf<3, number>);
        out.set(1, [m01, m11, m21] as TupleOf<3, number>);
        out.set(2, [m02, m12, m22] as TupleOf<3, number>);
        return out;
    },

    /**
     * Calculate the adjugate (classical adjoint) of a 3x3 matrix.
     */
    adjugate<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 3>,
        m: MatMemoryBuffer<S, 3>,
    ): MatMemoryBuffer<S, 3> {
        const [m00, m01, m02] = m.get(0);
        const [m10, m11, m12] = m.get(1);
        const [m20, m21, m22] = m.get(2);

        out.set(0, [
            m11 * m22 - m12 * m21,
            m02 * m21 - m01 * m22,
            m01 * m12 - m02 * m11,
        ] as TupleOf<3, number>);
        out.set(1, [
            m12 * m20 - m10 * m22,
            m00 * m22 - m02 * m20,
            m02 * m10 - m00 * m12,
        ] as TupleOf<3, number>);
        out.set(2, [
            m10 * m21 - m11 * m20,
            m01 * m20 - m00 * m21,
            m00 * m11 - m01 * m10,
        ] as TupleOf<3, number>);
        return out;
    },

    /**
     * Check if two 3x3 matrices are equal.
     */
    equals<S extends ScalarDescriptor>(
        a: MatMemoryBuffer<S, 3>,
        b: MatMemoryBuffer<S, 3>,
    ): boolean {
        const aCol0 = a.get(0);
        const aCol1 = a.get(1);
        const aCol2 = a.get(2);
        const bCol0 = b.get(0);
        const bCol1 = b.get(1);
        const bCol2 = b.get(2);

        return aCol0[0] === bCol0[0] && aCol0[1] === bCol0[1] && aCol0[2] === bCol0[2] &&
            aCol1[0] === bCol1[0] && aCol1[1] === bCol1[1] && aCol1[2] === bCol1[2] &&
            aCol2[0] === bCol2[0] && aCol2[1] === bCol2[1] && aCol2[2] === bCol2[2];
    },

    // ============================================================================
    // Transform Functions
    // ============================================================================

    /**
     * Create a 3x3 translation matrix.
     */
    translation<S extends ScalarDescriptor>(
        scalar: S = F32 as S,
        x: number,
        y: number,
    ): MatMemoryBuffer<S, 3> {
        const descriptor = Mat(scalar, 3);
        const buffer = allocate(descriptor);
        buffer.set(0, [1, 0, 0] as TupleOf<3, number>);
        buffer.set(1, [0, 1, 0] as TupleOf<3, number>);
        buffer.set(2, [x, y, 1] as TupleOf<3, number>);
        return buffer;
    },

    /**
     * Create a 3x3 rotation matrix (2D rotation).
     */
    rotation<S extends ScalarDescriptor>(
        scalar: S = F32 as S,
        angle: number,
    ): MatMemoryBuffer<S, 3> {
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const descriptor = Mat(scalar, 3);
        const buffer = allocate(descriptor);
        buffer.set(0, [c, s, 0] as TupleOf<3, number>);
        buffer.set(1, [-s, c, 0] as TupleOf<3, number>);
        buffer.set(2, [0, 0, 1] as TupleOf<3, number>);
        return buffer;
    },

    /**
     * Create a 3x3 scaling matrix.
     */
    scaling<S extends ScalarDescriptor>(
        scalar: S = F32 as S,
        x: number,
        y: number,
    ): MatMemoryBuffer<S, 3> {
        const descriptor = Mat(scalar, 3);
        const buffer = allocate(descriptor);
        buffer.set(0, [x, 0, 0] as TupleOf<3, number>);
        buffer.set(1, [0, y, 0] as TupleOf<3, number>);
        buffer.set(2, [0, 0, 1] as TupleOf<3, number>);
        return buffer;
    },

    /**
     * Create a 3x3 uniform scaling matrix.
     */
    uniformScaling<S extends ScalarDescriptor>(
        scalar: S = F32 as S,
        scale: number,
    ): MatMemoryBuffer<S, 3> {
        const descriptor = Mat(scalar, 3);
        const buffer = allocate(descriptor);
        buffer.set(0, [scale, 0, 0] as TupleOf<3, number>);
        buffer.set(1, [0, scale, 0] as TupleOf<3, number>);
        buffer.set(2, [0, 0, 1] as TupleOf<3, number>);
        return buffer;
    },

    /**
     * Create a 3x3 shear matrix.
     */
    shear<S extends ScalarDescriptor>(
        scalar: S = F32 as S,
        xShear: number,
        yShear: number,
    ): MatMemoryBuffer<S, 3> {
        const descriptor = Mat(scalar, 3);
        const buffer = allocate(descriptor);
        buffer.set(0, [1, yShear, 0] as TupleOf<3, number>);
        buffer.set(1, [xShear, 1, 0] as TupleOf<3, number>);
        buffer.set(2, [0, 0, 1] as TupleOf<3, number>);
        return buffer;
    },

    /**
     * Create a 3x3 reflection matrix across the X axis.
     */
    reflectX<S extends ScalarDescriptor>(
        scalar: S = F32 as S,
    ): MatMemoryBuffer<S, 3> {
        const descriptor = Mat(scalar, 3);
        const buffer = allocate(descriptor);
        buffer.set(0, [1, 0, 0] as TupleOf<3, number>);
        buffer.set(1, [0, -1, 0] as TupleOf<3, number>);
        buffer.set(2, [0, 0, 1] as TupleOf<3, number>);
        return buffer;
    },

    /**
     * Create a 3x3 reflection matrix across the Y axis.
     */
    reflectY<S extends ScalarDescriptor>(
        scalar: S = F32 as S,
    ): MatMemoryBuffer<S, 3> {
        const descriptor = Mat(scalar, 3);
        const buffer = allocate(descriptor);
        buffer.set(0, [-1, 0, 0] as TupleOf<3, number>);
        buffer.set(1, [0, 1, 0] as TupleOf<3, number>);
        buffer.set(2, [0, 0, 1] as TupleOf<3, number>);
        return buffer;
    },

    /**
     * Create a 3x3 reflection matrix across the origin.
     */
    reflectOrigin<S extends ScalarDescriptor>(
        scalar: S = F32 as S,
    ): MatMemoryBuffer<S, 3> {
        const descriptor = Mat(scalar, 3);
        const buffer = allocate(descriptor);
        buffer.set(0, [-1, 0, 0] as TupleOf<3, number>);
        buffer.set(1, [0, -1, 0] as TupleOf<3, number>);
        buffer.set(2, [0, 0, 1] as TupleOf<3, number>);
        return buffer;
    },

    /**
     * Translate a 3x3 matrix by (x, y).
     */
    translate<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 3>,
        m: MatMemoryBuffer<S, 3>,
        x: number,
        y: number,
    ): MatMemoryBuffer<S, 3> {
        const mCol0 = m.get(0);
        const mCol1 = m.get(1);
        const mCol2 = m.get(2);

        out.set(0, mCol0);
        out.set(1, mCol1);
        out.set(2, [
            mCol2[0]! + mCol0[0]! * x + mCol1[0]! * y,
            mCol2[1]! + mCol0[1]! * x + mCol1[1]! * y,
            mCol2[2]! + mCol0[2]! * x + mCol1[2]! * y,
        ] as TupleOf<3, number>);
        return out;
    },

    /**
     * Rotate a 3x3 matrix by the given angle (2D rotation).
     */
    rotate<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 3>,
        m: MatMemoryBuffer<S, 3>,
        angle: number,
    ): MatMemoryBuffer<S, 3> {
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const mCol0 = m.get(0);
        const mCol1 = m.get(1);
        const mCol2 = m.get(2);

        out.set(0, [
            mCol0[0]! * c + mCol1[0]! * s,
            mCol0[1]! * c + mCol1[1]! * s,
            mCol0[2]! * c + mCol1[2]! * s,
        ] as TupleOf<3, number>);
        out.set(1, [
            mCol0[0]! * -s + mCol1[0]! * c,
            mCol0[1]! * -s + mCol1[1]! * c,
            mCol0[2]! * -s + mCol1[2]! * c,
        ] as TupleOf<3, number>);
        out.set(2, mCol2);
        return out;
    },

    /**
     * Scale a 3x3 matrix by (x, y).
     */
    scaleMatrix<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 3>,
        m: MatMemoryBuffer<S, 3>,
        x: number,
        y: number,
    ): MatMemoryBuffer<S, 3> {
        const mCol0 = m.get(0);
        const mCol1 = m.get(1);
        const mCol2 = m.get(2);

        out.set(0, [
            mCol0[0]! * x,
            mCol0[1]! * x,
            mCol0[2]! * x,
        ] as TupleOf<3, number>);
        out.set(1, [
            mCol1[0]! * y,
            mCol1[1]! * y,
            mCol1[2]! * y,
        ] as TupleOf<3, number>);
        out.set(2, mCol2);
        return out;
    },

    /**
     * Create a 3x3 matrix from translation, rotation, and scale components (TRS).
     * Combines translation (tx, ty), rotation (angle in radians), and scale (sx, sy)
     * into a single transformation matrix: T * R * S
     */
    fromTRS<S extends ScalarDescriptor>(
        scalar: S = F32 as S,
        tx: number,
        ty: number,
        angle: number,
        sx: number,
        sy: number,
    ): MatMemoryBuffer<S, 3> {
        const c = Math.cos(angle);
        const s = Math.sin(angle);

        const descriptor = Mat(scalar, 3);
        const buffer = allocate(descriptor);

        // T * R * S combined matrix
        // Translation is applied after rotation and scaling
        const m00 = sx * c;
        const m01 = sx * s;
        const m10 = -sy * s;
        const m11 = sy * c;

        buffer.set(0, [m00, m01, 0] as TupleOf<3, number>);
        buffer.set(1, [m10, m11, 0] as TupleOf<3, number>);
        buffer.set(2, [tx, ty, 1] as TupleOf<3, number>);
        return buffer;
    },

    /**
     * Decompose a 3x3 matrix into translation, rotation, scale components.
     * Returns [tx, ty, angle, sx, sy]
     */
    decompose<S extends ScalarDescriptor>(m: MatMemoryBuffer<S, 3>): [number, number, number, number, number] {
        const mCol0 = m.get(0);
        const mCol1 = m.get(1);
        const mCol2 = m.get(2);

        // Extract translation
        const tx = mCol2[0]!;
        const ty = mCol2[1]!;

        // Extract scale
        const sx = Math.sqrt(mCol0[0]! * mCol0[0]! + mCol0[1]! * mCol0[1]!);
        const sy = Math.sqrt(mCol1[0]! * mCol1[0]! + mCol1[1]! * mCol1[1]!);

        // Extract rotation (assuming no shear)
        const angle = Math.atan2(mCol0[1]! / sx, mCol0[0]! / sx);

        return [tx, ty, angle, sx, sy];
    },

    /**
     * Extract the translation vector from a 3x3 matrix.
     */
    getTranslation<S extends ScalarDescriptor>(m: MatMemoryBuffer<S, 3>): [number, number] {
        return [m.get(2)[0]!, m.get(2)[1]!];
    },

    /**
     * Extract the rotation angle from a 3x3 matrix (assuming no shear).
     */
    getRotation<S extends ScalarDescriptor>(m: MatMemoryBuffer<S, 3>): number {
        const mCol0 = m.get(0);
        return Math.atan2(mCol0[1]!, mCol0[0]!);
    },

    /**
     * Extract scale factors from a 3x3 matrix.
     */
    getScale<S extends ScalarDescriptor>(m: MatMemoryBuffer<S, 3>): [number, number] {
        const mCol0 = m.get(0);
        const mCol1 = m.get(1);

        const scaleX = Math.sqrt(mCol0[0]! * mCol0[0]! + mCol0[1]! * mCol0[1]!);
        const scaleY = Math.sqrt(mCol1[0]! * mCol1[0]! + mCol1[1]! * mCol1[1]!);
        return [scaleX, scaleY];
    },

    /**
     * Extract the 2x2 rotation/scaling part from a 3x3 matrix.
     */
    getLinearTransform<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 2>,
        m: MatMemoryBuffer<S, 3>,
    ): MatMemoryBuffer<S, 2> {
        const mCol0 = m.get(0);
        const mCol1 = m.get(1);

        out.set(0, [mCol0[0]!, mCol0[1]!] as TupleOf<2, number>);
        out.set(1, [mCol1[0]!, mCol1[1]!] as TupleOf<2, number>);
        return out;
    },
};
