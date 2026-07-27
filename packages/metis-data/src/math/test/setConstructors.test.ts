import { describe, expect, test } from "bun:test";
import { F32, Mat4, Vec3 } from "metis-data";

/**
 * The out-first matrix constructors (`setLookAt`, `setPerspective`,
 * `setPerspectiveReverseZ`, `setOrthographic`) exist so a renderer can build a
 * view or projection per frame without allocating. Their allocating twins
 * delegate to them, so the two cannot drift in *arithmetic* — but they can
 * still drift in *coverage*: an out-first constructor that skips a component
 * leaves whatever the scratch buffer held there, which is exactly the bug an
 * allocating constructor (starting from fresh zeroed memory) cannot have.
 *
 * So the assertion that matters is the one made against a **dirty** `out`.
 */
const close = (a: number, b: number, eps = 1e-5) => Math.abs(a - b) < eps;

function expectSame(a: ReturnType<typeof Mat4.create>, b: ReturnType<typeof Mat4.create>) {
    const av = a.view(), bv = b.view();
    for (let i = 0; i < 16; i++) {
        expect(close(av[i] as number, bv[i] as number)).toBe(true);
    }
}

/** A matrix with no zero component, so a skipped write shows up as garbage. */
function dirty() {
    const m = Mat4.create(F32);
    const v = m.view();
    for (let i = 0; i < 16; i++) v[i] = 100 + i;
    return m;
}

describe("Mat4.setLookAt", () => {
    const cases: Array<[string, [number, number, number], [number, number, number], [number, number, number]]> = [
        ["axis-aligned", [0, 0, 5], [0, 0, 0], [0, 1, 0]],
        ["oblique", [3, -2, 8], [1, 1, 1], [0, 1, 0]],
        ["tilted up vector", [10, 10, 10], [0, 0, 0], [0.2, 0.9, -0.3]],
        ["looking down -y", [0, 20, 0], [0, 0, 0], [0, 0, -1]],
    ];

    for (const [name, e, c, u] of cases) {
        test(`matches lookAt — ${name}`, () => {
            const eye = Vec3.create(F32, e[0], e[1], e[2]);
            const center = Vec3.create(F32, c[0], c[1], c[2]);
            const up = Vec3.create(F32, u[0], u[1], u[2]);
            const want = Mat4.lookAt(F32, eye, center, up);
            expectSame(Mat4.setLookAt(dirty(), eye, center, up), want);
        });
    }
});

describe("Mat4.setPerspective", () => {
    const cases: Array<[string, number, number, number, number]> = [
        ["standard", Math.PI / 4, 16 / 9, 0.1, 1000],
        ["wide fov, square", 2.0, 1, 0.01, 50],
        ["infinite far", Math.PI / 3, 4 / 3, 0.5, Infinity],
    ];

    for (const [name, fovy, aspect, near, far] of cases) {
        test(`matches perspective — ${name}`, () => {
            expectSame(
                Mat4.setPerspective(dirty(), fovy, aspect, near, far),
                Mat4.perspective(F32, fovy, aspect, near, far),
            );
        });
    }
});

describe("Mat4.setPerspectiveReverseZ", () => {
    const cases: Array<[string, number, number, number, number | undefined]> = [
        ["infinite far (default)", Math.PI / 4, 16 / 9, 0.01, undefined],
        ["explicit infinite far", Math.PI / 4, 16 / 9, 0.01, Infinity],
        ["finite far", Math.PI / 3, 1, 0.1, 500],
    ];

    for (const [name, fovy, aspect, near, far] of cases) {
        test(`matches perspectiveReverseZ — ${name}`, () => {
            expectSame(
                far === undefined
                    ? Mat4.setPerspectiveReverseZ(dirty(), fovy, aspect, near)
                    : Mat4.setPerspectiveReverseZ(dirty(), fovy, aspect, near, far),
                far === undefined
                    ? Mat4.perspectiveReverseZ(F32, fovy, aspect, near)
                    : Mat4.perspectiveReverseZ(F32, fovy, aspect, near, far),
            );
        });
    }

    test("near maps to ndc.z = 1 and infinity to 0", () => {
        // The engine's whole depth setup rests on this, so pin it directly
        // rather than only against the allocating twin.
        const m = Mat4.setPerspectiveReverseZ(dirty(), Math.PI / 4, 1, 0.5);
        const atNear = Vec3.create(F32);
        Vec3.transformMat4(atNear, Vec3.create(F32, 0, 0, -0.5), m);
        expect(close(atNear.getComponent(2), 1)).toBe(true);

        const farAway = Vec3.create(F32);
        Vec3.transformMat4(farAway, Vec3.create(F32, 0, 0, -1e9), m);
        expect(close(farAway.getComponent(2), 0, 1e-6)).toBe(true);
    });
});

describe("Mat4.setOrthographic", () => {
    const cases: Array<[string, number, number, number, number, number, number]> = [
        ["symmetric", -10, 10, -10, 10, 0.1, 100],
        ["off-centre", -3, 7, -2, 9, 1, 40],
        ["shadow-cascade shaped", -50, 50, -50, 50, -200, 200],
    ];

    for (const [name, l, r, b, t, n, f] of cases) {
        test(`matches orthographic — ${name}`, () => {
            expectSame(
                Mat4.setOrthographic(dirty(), l, r, b, t, n, f),
                Mat4.orthographic(F32, l, r, b, t, n, f),
            );
        });
    }
});

describe("the out-first constructors allocate nothing", () => {
    test("repeated calls reuse out", () => {
        const eye = Vec3.create(F32, 0, 0, 5);
        const center = Vec3.create(F32, 0, 0, 0);
        const up = Vec3.create(F32, 0, 1, 0);
        const out = Mat4.create(F32);
        const buf = out.buffer;

        for (let i = 0; i < 100; i++) {
            Mat4.setLookAt(out, eye, center, up);
            Mat4.setPerspectiveReverseZ(out, 1, 1, 0.1);
            Mat4.setPerspective(out, 1, 1, 0.1, 100);
            Mat4.setOrthographic(out, -1, 1, -1, 1, 0, 1);
        }
        expect(out.buffer).toBe(buf);
    });
});
