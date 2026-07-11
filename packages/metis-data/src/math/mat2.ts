import { allocate, F32, Mat, type MatMemoryBuffer, type ScalarDescriptor } from "metis-data";
import type { TupleOf } from "type-fest";

// ============================================================================
// Mat2 Math Object
// ============================================================================
export const Mat2 = {
    /**
     * Create a new 2x2 matrix memory buffer initialized with the given values.
     * Values are provided in column-major order: [m00, m01, m10, m11]
     */
    create<S extends ScalarDescriptor>(
        scalar: S = F32 as S,
        m00 = 1, m01 = 0,
        m10 = 0, m11 = 1,
    ): MatMemoryBuffer<S, 2> {
        const descriptor = Mat(scalar, 2);
        const buffer = allocate(descriptor);
        buffer.set(0, [m00, m01] as TupleOf<2, number>);
        buffer.set(1, [m10, m11] as TupleOf<2, number>);
        return buffer;
    },

    /**
     * Clone a Mat2 into a new buffer.
     */
    clone<S extends ScalarDescriptor>(
        m: MatMemoryBuffer<S, 2>,
    ): MatMemoryBuffer<S, 2> {
        const descriptor = Mat(m.type.scalar, 2);
        const buffer = allocate(descriptor);
        buffer.set(0, m.get(0));
        buffer.set(1, m.get(1));
        return buffer;
    },

    /**
     * Copy values from one Mat2 to another.
     */
    copy<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 2>,
        m: MatMemoryBuffer<S, 2>,
    ): MatMemoryBuffer<S, 2> {
        out.set(0, m.get(0));
        out.set(1, m.get(1));
        return out;
    },

    /**
     * Set the components of a Mat2.
     * Values are provided in column-major order: [m00, m01, m10, m11]
     */
    set<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 2>,
        m00: number, m01: number,
        m10: number, m11: number,
    ): MatMemoryBuffer<S, 2> {
        out.set(0, [m00, m01] as TupleOf<2, number>);
        out.set(1, [m10, m11] as TupleOf<2, number>);
        return out;
    },

    /**
     * Create a 2x2 identity matrix.
     */
    identity<S extends ScalarDescriptor>(
        scalar: S = F32 as S,
    ): MatMemoryBuffer<S, 2> {
        const descriptor = Mat(scalar, 2);
        const buffer = allocate(descriptor);
        buffer.set(0, [1, 0] as TupleOf<2, number>);
        buffer.set(1, [0, 1] as TupleOf<2, number>);
        return buffer;
    },

    /**
     * Add two 2x2 matrices: out = a + b
     */
    add<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 2>,
        a: MatMemoryBuffer<S, 2>,
        b: MatMemoryBuffer<S, 2>,
    ): MatMemoryBuffer<S, 2> {
        const aCol0 = a.get(0);
        const aCol1 = a.get(1);
        const bCol0 = b.get(0);
        const bCol1 = b.get(1);

        out.set(0, [
            aCol0[0]! + bCol0[0]!,
            aCol0[1]! + bCol0[1]!,
        ] as TupleOf<2, number>);
        out.set(1, [
            aCol1[0]! + bCol1[0]!,
            aCol1[1]! + bCol1[1]!,
        ] as TupleOf<2, number>);
        return out;
    },

    /**
     * Subtract two 2x2 matrices: out = a - b
     */
    subtract<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 2>,
        a: MatMemoryBuffer<S, 2>,
        b: MatMemoryBuffer<S, 2>,
    ): MatMemoryBuffer<S, 2> {
        const aCol0 = a.get(0);
        const aCol1 = a.get(1);
        const bCol0 = b.get(0);
        const bCol1 = b.get(1);

        out.set(0, [
            aCol0[0]! - bCol0[0]!,
            aCol0[1]! - bCol0[1]!,
        ] as TupleOf<2, number>);
        out.set(1, [
            aCol1[0]! - bCol1[0]!,
            aCol1[1]! - bCol1[1]!,
        ] as TupleOf<2, number>);
        return out;
    },

    /**
     * Multiply two 2x2 matrices: out = a * b
     */
    multiply<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 2>,
        a: MatMemoryBuffer<S, 2>,
        b: MatMemoryBuffer<S, 2>,
    ): MatMemoryBuffer<S, 2> {
        const aCol0 = a.get(0);
        const aCol1 = a.get(1);
        const bCol0 = b.get(0);
        const bCol1 = b.get(1);

        // Matrix multiplication: result[i][j] = sum(a[i][k] * b[k][j])
        // Since we store in column-major: result[j][i] = sum(a[k][i] * b[j][k])
        out.set(0, [
            aCol0[0]! * bCol0[0]! + aCol1[0]! * bCol0[1]!,
            aCol0[1]! * bCol0[0]! + aCol1[1]! * bCol0[1]!,
        ] as TupleOf<2, number>);
        out.set(1, [
            aCol0[0]! * bCol1[0]! + aCol1[0]! * bCol1[1]!,
            aCol0[1]! * bCol1[0]! + aCol1[1]! * bCol1[1]!,
        ] as TupleOf<2, number>);
        return out;
    },

    /**
     * Multiply a 2x2 matrix by a scalar: out = m * s
     */
    scale<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 2>,
        m: MatMemoryBuffer<S, 2>,
        s: number,
    ): MatMemoryBuffer<S, 2> {
        const mCol0 = m.get(0);
        const mCol1 = m.get(1);

        out.set(0, [
            mCol0[0]! * s,
            mCol0[1]! * s,
        ] as TupleOf<2, number>);
        out.set(1, [
            mCol1[0]! * s,
            mCol1[1]! * s,
        ] as TupleOf<2, number>);
        return out;
    },

    /**
     * Calculate the determinant of a 2x2 matrix.
     */
    determinant<S extends ScalarDescriptor>(m: MatMemoryBuffer<S, 2>): number {
        const [m00, m01] = m.get(0);
        const [m10, m11] = m.get(1);
        return m00 * m11 - m10 * m01;
    },

    /**
     * Calculate the inverse of a 2x2 matrix: out = m^-1
     */
    invert<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 2>,
        m: MatMemoryBuffer<S, 2>,
    ): MatMemoryBuffer<S, 2> {
        const [m00, m01] = m.get(0);
        const [m10, m11] = m.get(1);

        const det = m00 * m11 - m10 * m01;

        if (det === 0) {
            out.set(0, [0, 0] as TupleOf<2, number>);
            out.set(1, [0, 0] as TupleOf<2, number>);
            return out;
        }

        const invDet = 1 / det;
        out.set(0, [m11 * invDet, -m01 * invDet] as TupleOf<2, number>);
        out.set(1, [-m10 * invDet, m00 * invDet] as TupleOf<2, number>);
        return out;
    },

    /**
     * Calculate the transpose of a 2x2 matrix: out = m^T
     */
    transpose<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 2>,
        m: MatMemoryBuffer<S, 2>,
    ): MatMemoryBuffer<S, 2> {
        const [m00, m01] = m.get(0);
        const [m10, m11] = m.get(1);

        out.set(0, [m00, m10] as TupleOf<2, number>);
        out.set(1, [m01, m11] as TupleOf<2, number>);
        return out;
    },

    /**
     * Calculate the adjugate (classical adjoint) of a 2x2 matrix.
     */
    adjugate<S extends ScalarDescriptor>(
        out: MatMemoryBuffer<S, 2>,
        m: MatMemoryBuffer<S, 2>,
    ): MatMemoryBuffer<S, 2> {
        const [m00, m01] = m.get(0);
        const [m10, m11] = m.get(1);

        out.set(0, [m11, -m01] as TupleOf<2, number>);
        out.set(1, [-m10, m00] as TupleOf<2, number>);
        return out;
    },

    /**
     * Check if two 2x2 matrices are equal.
     */
    equals<S extends ScalarDescriptor>(
        a: MatMemoryBuffer<S, 2>,
        b: MatMemoryBuffer<S, 2>,
    ): boolean {
        const aCol0 = a.get(0);
        const aCol1 = a.get(1);
        const bCol0 = b.get(0);
        const bCol1 = b.get(1);

        return aCol0[0] === bCol0[0] &&
            aCol0[1] === bCol0[1] &&
            aCol1[0] === bCol1[0] &&
            aCol1[1] === bCol1[1];
    },

    /**
     * Extract the rotation angle from a 2x2 matrix (assumes pure rotation matrix).
     */
    rotation<S extends ScalarDescriptor>(m: MatMemoryBuffer<S, 2>): number {
        const [m00, m01] = m.get(0);
        return Math.atan2(m01, m00);
    },

    /**
     * Extract scale factors from a 2x2 matrix.
     */
    scaleFactors<S extends ScalarDescriptor>(m: MatMemoryBuffer<S, 2>): [x: number, y: number] {
        const [m00, m01] = m.get(0);
        const [m10, m11] = m.get(1);

        const scaleX = Math.sqrt(m00 * m00 + m01 * m01);
        const scaleY = Math.sqrt(m10 * m10 + m11 * m11);
        return [scaleX, scaleY];
    },
};
