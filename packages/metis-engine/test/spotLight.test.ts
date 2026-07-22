// Spot lights: does `outerAngle` mean what the API says it means?
//
// The failure this exists to catch is a *semantic* one, not a crash: confusing
// the cone's half-angle with its full angle, or the angle with its cosine,
// produces a perfectly plausible-looking render — a cone, correctly shaped,
// simply the wrong size. Comparing two cones can't catch it either, because the
// ratio between two cones is nearly identical under the half/full-angle
// confusion (tan15/tan25 = 0.575 vs tan7.5/tan12.5 = 0.594). Only an absolute
// measurement settles it, which is what this does: render a hard-edged cone
// straight at a wall, find the lit boundary, and convert it back to an angle.
import { expect, test } from "bun:test";
import { readTexturePixels } from "metis-native";
import {
    ClusteredForwardRenderer,
    createDefaultPostProcessPipeline,
    createExteriorEnvironment,
    cube,
    type Light,
    Material,
    Mesh,
    RenderContext,
    Scene,
} from "metis-engine/renderer";
import { vec3 } from "wgpu-matrix";

const W = 320;
const H = 240;
/** Distance from the camera/light to the wall. */
const WALL_DEPTH = 4;

/**
 * Renders one light against a flat wall and returns the centre scanline's
 * luminance, left-to-right, plus the camera's horizontal half-angle tangent
 * (needed to turn a pixel column back into a world-space angle).
 */
async function scanlineOf(light: Light): Promise<{luma: number[]; tanHalfX: number}> {
    const ctx = await RenderContext.createOffscreen({width: W, height: H, label: "spot-test"});
    const forward = new ClusteredForwardRenderer(ctx.device);
    const post = createDefaultPostProcessPipeline(ctx.device);

    const scene = new Scene();
    // The light under test is the *only* light: outside its cone the wall must
    // be genuinely black, so the boundary is unambiguous.
    scene.environment = createExteriorEnvironment({ambientIntensity: 0.0, sunIntensity: 0.0});
    scene.camera.position = vec3.create(0, 0, 0);
    scene.camera.target = vec3.create(0, 0, -1);
    scene.camera.near = 0.01;
    scene.camera.setAspectFromSize(W, H);

    // A wall filling the view. The light sits at the camera, aimed at it, so
    // the lit region is centred and its radius is WALL_DEPTH * tan(outerAngle).
    scene.add(
        new Mesh(ctx.device, cube(40, 40, 0.1), "wall"),
        new Material({baseColor: [0.8, 0.8, 0.8, 1], metallic: 0, roughness: 0.9}),
        {position: vec3.create(0, 0, -WALL_DEPTH - 0.05)},
    );
    scene.lights.push(light);

    const frame = ctx.beginFrame();
    const encoder = ctx.device.createCommandEncoder();
    forward.render(encoder, ctx.targets, scene);
    post.pipeline.run(encoder, {
        device: ctx.device,
        hdrColorView: ctx.targets.hdrColorResolvedView,
        depthView: ctx.targets.depthView,
        outputView: frame.view,
        outputFormat: frame.format,
        width: W,
        height: H,
        deltaTime: 1 / 30,
    });
    ctx.device.queue.submit([encoder.finish()]);
    await ctx.device.queue.onSubmittedWorkDone();
    frame.present();

    const pixels = await readTexturePixels(ctx.device, ctx.captureTexture!);
    const row = Math.floor(H / 2);
    const luma: number[] = [];
    for (let x = 0; x < W; x++) {
        const i = (row * W + x) * 4;
        luma.push(0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!);
    }

    const tanHalfY = Math.tan(scene.camera.fovYRadians / 2);
    forward.destroy();
    post.pipeline.destroy();
    ctx.destroy();
    return {luma, tanHalfX: tanHalfY * scene.camera.aspect};
}

/** Half-angle of the lit cone, in degrees, measured off the rendered scanline. */
function measuredHalfAngleDeg(luma: number[], tanHalfX: number): number {
    const max = Math.max(...luma);
    // Half of peak brightness. The cone's own 1/d² and N·L falloff only dims the
    // rim to ~0.83 of centre, so this threshold sits well inside the hard edge.
    const threshold = max * 0.5;
    let lastLit = -1;
    for (let x = Math.floor(W / 2); x < W; x++) {
        if (luma[x]! >= threshold) lastLit = x;
    }
    if (lastLit < 0) throw new Error("no lit pixels right of centre");
    const ndcX = ((lastLit + 0.5) / W) * 2 - 1;
    return (Math.atan(ndcX * tanHalfX) * 180) / Math.PI;
}

test("outerAngle is the cone's half-angle, in radians", async () => {
    const outerDeg = 20;
    const rad = (outerDeg * Math.PI) / 180;
    const {luma, tanHalfX} = await scanlineOf({
        kind: "spot",
        position: vec3.create(0, 0, 0),
        direction: vec3.create(0, 0, -1),
        color: [1, 1, 1],
        intensity: 30,
        range: 20,
        // Hard edge (inner == outer) so the boundary is a step, not a gradient.
        innerAngle: rad,
        outerAngle: rad,
    });

    const measured = measuredHalfAngleDeg(luma, tanHalfX);
    // Pixel quantisation at this resolution is ~0.24 deg; 1.5 is comfortable
    // margin while still failing a half-vs-full-angle confusion (which would
    // read 10 or 40 deg, not 20).
    expect(Math.abs(measured - outerDeg)).toBeLessThan(1.5);
});

test("a spot light is dark outside its cone", async () => {
    const rad = (20 * Math.PI) / 180;
    const {luma} = await scanlineOf({
        kind: "spot",
        position: vec3.create(0, 0, 0),
        direction: vec3.create(0, 0, -1),
        color: [1, 1, 1],
        intensity: 30,
        range: 20,
        innerAngle: rad,
        outerAngle: rad,
    });
    // The frame's outermost columns are far outside a 20 deg cone.
    expect(luma[0]).toBeLessThan(1);
    expect(luma[W - 1]).toBeLessThan(1);
    expect(Math.max(...luma)).toBeGreaterThan(20);
});

test("a point light is unaffected by the spot encoding", async () => {
    // The control for the branchless `cosOuter = -2` encoding: a point light
    // must light the whole wall, edge to edge. If that encoding ever regresses,
    // this goes black.
    const {luma} = await scanlineOf({
        kind: "point",
        position: vec3.create(0, 0, 0),
        color: [1, 1, 1],
        intensity: 30,
        range: 20,
    });
    expect(luma[0]).toBeGreaterThan(1);
    expect(luma[W - 1]).toBeGreaterThan(1);
    expect(luma[Math.floor(W / 2)]).toBeGreaterThan(20);
});
