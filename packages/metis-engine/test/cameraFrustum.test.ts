// Camera-frustum culling against this engine's *reverse-Z, infinite-far*
// projection — which is not the matrix Gribb-Hartmann is usually explained with,
// and the difference is invisible until something vanishes.
//
// `Camera.projectionMatrix()` maps near -> ndc.z = 1 and infinity -> 0, so:
//
//   - the slot `frustumFromViewProj` labels **near** (`row2`) is
//     `(0, 0, 0, near)` — a **zero normal**, a degenerate plane that can never
//     reject anything;
//   - the slot it labels **far** (`row3 - row2`) is the *actual near plane*, and
//     is what rejects geometry behind the camera;
//   - there is no far plane at all, correctly, because the projection has none.
//
// So the extraction works, by luck rather than by design, and these tests exist
// so that stays true. Anyone "fixing" the labels, adding a finite far plane, or
// switching to the OpenGL `[-1, 1]` form will break camera culling in a way that
// looks like objects popping out of existence, not like a maths error.
import { expect, test } from "bun:test";
import { Camera, mat4f, vec3f } from "metis-engine/renderer";
import { Mat4 } from "metis-data";
import { frustumFromViewProj, sphereInFrustum } from "../src/renderer/math/frustum.ts";

/** The frustum for a camera at the origin looking down -Z. */
function cameraFrustum() {
    const camera = new Camera();
    camera.position = vec3f(0, 0, 0);
    camera.target = vec3f(0, 0, -1);
    camera.up = vec3f(0, 1, 0);
    camera.setAspectFromSize(1280, 720);
    const viewProj = Mat4.multiply(mat4f(), camera.projectionMatrix(mat4f()), camera.viewMatrix(mat4f()));
    return frustumFromViewProj(viewProj);
}

test("geometry in front of the camera survives", () => {
    const f = cameraFrustum();
    expect(sphereInFrustum(f, 0, 0, -10, 1)).toBe(true);
});

test("geometry behind the camera is culled", () => {
    const f = cameraFrustum();
    // The whole point of camera culling, and the case that only works because
    // the real near plane lands in the "far" slot. Well behind, so no radius
    // slop can save it.
    expect(sphereInFrustum(f, 0, 0, 50, 1)).toBe(false);
    expect(sphereInFrustum(f, 0, 0, 10, 1)).toBe(false);
});

test("geometry far off to the side is culled", () => {
    const f = cameraFrustum();
    expect(sphereInFrustum(f, 500, 0, -10, 1)).toBe(false);
    expect(sphereInFrustum(f, 0, 500, -10, 1)).toBe(false);
});

test("nothing is ever culled for being too far away", () => {
    const f = cameraFrustum();
    // The projection's far plane is at infinity, so distance alone must never
    // reject. A finite far plane introduced here would silently start culling
    // distant geometry — in a space sim, the planet.
    expect(sphereInFrustum(f, 0, 0, -1e6, 1)).toBe(true);
    expect(sphereInFrustum(f, 0, 0, -1e9, 1)).toBe(true);
});

test("a large sphere straddling the near plane is kept", () => {
    const f = cameraFrustum();
    // Conservative direction: partially visible must mean drawn. A sphere
    // centred behind the camera but big enough to reach in front of it is
    // visible, and culling it would clip geometry off the edge of the screen.
    expect(sphereInFrustum(f, 0, 0, 5, 20)).toBe(true);
});

test("the degenerate near slot rejects nothing on its own", () => {
    const f = cameraFrustum();
    // Plane 4 is `row2` = (0, 0, 0, near): zero normal, positive distance.
    // Asserted directly because if a future projection change gives it a real
    // normal, the *other* five planes would still pass these tests while this
    // one quietly started culling everything in front of the camera.
    const nx = f[16]!;
    const ny = f[17]!;
    const nz = f[18]!;
    const d = f[19]!;
    expect(Math.hypot(nx, ny, nz)).toBeCloseTo(0, 6);
    expect(d).toBeGreaterThan(0);
});
