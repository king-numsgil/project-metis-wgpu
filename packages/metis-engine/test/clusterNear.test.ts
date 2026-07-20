// Geometry closer than `Camera.clusterNear` must still be lit correctly.
//
// The cluster grid slices [clusterNear, clusterFar], and `clusterZIndex` clamps
// anything nearer into slice 0. If slice 0's AABB were built from `clusterNear`
// (rather than the true camera near), a fragment at depth 0.5 would read a light
// list assembled for the [2.0, 2.4] shell and silently lose every light near it
// — geometry going dark, or popping as the camera moves. cluster_build.wgsl
// widens slice 0 down to the real near plane to prevent that; this pins it.
//
// The oracle is the renderer's own behaviour at a tiny clusterNear, which is
// what it did before the decoupling. Clustering only decides *which* lights are
// evaluated — an out-of-range light contributes exactly zero either way — so a
// correct implementation must shade identically at any clusterNear. Any
// difference means lights were lost.
import { expect, test } from "bun:test";
import { readTexturePixels } from "bun-webgpu-rs";
import {
    ClusteredForwardRenderer,
    createDefaultPostProcessPipeline,
    createExteriorEnvironment,
    cube,
    Material,
    Mesh,
    RenderContext,
    Scene,
} from "metis-engine/renderer";
import { vec3 } from "wgpu-matrix";

const W = 160;
const H = 120;

/** Mean luminance of the rendered frame at a given clusterNear / wall distance. */
async function meanLuma(clusterNear: number, wallDepth: number): Promise<number> {
    const ctx = await RenderContext.createOffscreen({width: W, height: H, label: "cluster-near-test"});
    const forward = new ClusteredForwardRenderer(ctx.device);
    const post = createDefaultPostProcessPipeline(ctx.device);

    const scene = new Scene();
    // Sun AND ambient off: the point light is the *only* light source, so if
    // clustering loses it the frame goes black rather than merely dimmer.
    scene.environment = createExteriorEnvironment({ambientIntensity: 0.0, sunIntensity: 0.0});
    scene.camera.position = vec3.create(0, 0, 0);
    scene.camera.target = vec3.create(0, 0, -1);
    scene.camera.near = 0.01;
    scene.camera.clusterNear = clusterNear;
    scene.camera.clusterFar = 200;
    scene.camera.setAspectFromSize(W, H);

    // A wall filling the view at `wallDepth`, with a point light just in front.
    //
    // `range` is deliberately SMALL relative to clusterNear. An earlier version
    // used range 8, which made the test vacuous: the light's sphere still
    // reached a wrongly-placed slice 0 at [2.0, 2.42], so it was assigned
    // anyway and the test passed even with the catch-all deleted. At range 0.6
    // a light sitting at depth 0.4 cannot reach 2.0, so a missing catch-all
    // genuinely drops it.
    scene.add(
        new Mesh(ctx.device, cube(40, 40, 0.1), "wall"),
        new Material({baseColor: [0.8, 0.8, 0.8, 1], metallic: 0, roughness: 0.9}),
        {position: vec3.create(0, 0, -wallDepth - 0.05)},
    );
    scene.pointLights.push({
        position: vec3.create(0, 0, -wallDepth + 0.1),
        color: [1, 1, 1],
        intensity: 3,
        range: 0.6,
    });

    ctx.device.pushErrorScope("validation");
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
        deltaTime: 1 / 60,
    });
    ctx.device.queue.submit([encoder.finish()]);
    await ctx.device.queue.onSubmittedWorkDone();
    const err = await ctx.device.popErrorScope();
    if (err) {
        throw new Error(`validation error: ${err.message}`);
    }
    frame.present();

    const pixels = await readTexturePixels(ctx.device, ctx.captureTexture!);
    // Only the centre 20% box, where the (deliberately small-range) light is.
    // A whole-frame mean would depend on how much of the frame the lit disc
    // covers, which changes with wall distance — making the far cases fail for
    // reasons unrelated to clustering.
    const x0 = Math.floor(W * 0.4);
    const x1 = Math.ceil(W * 0.6);
    const y0 = Math.floor(H * 0.4);
    const y1 = Math.ceil(H * 0.6);
    let sum = 0;
    let n = 0;
    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            const i = (y * W + x) * 4;
            sum += 0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!;
            n++;
        }
    }
    forward.destroy();
    post.pipeline.destroy();
    ctx.destroy();
    return sum / n / 255;
}

test("geometry nearer than clusterNear keeps its point lights", async () => {
    // 0.5 is well inside the default clusterNear (2.0) — the case slice 0's
    // catch-all exists for. Without it, the light is culled away and the wall
    // goes black.
    const reference = await meanLuma(0.01, 0.5); // pre-decoupling behaviour
    const decoupled = await meanLuma(2.0, 0.5);

    expect(reference).toBeGreaterThan(0.02); // the scene is genuinely lit
    expect(decoupled).toBeCloseTo(reference, 3);
}, 120_000);

test("geometry beyond clusterNear is unaffected", async () => {
    const reference = await meanLuma(0.01, 12);
    const decoupled = await meanLuma(2.0, 12);
    expect(reference).toBeGreaterThan(0.02);
    expect(decoupled).toBeCloseTo(reference, 3);
}, 120_000);

test("geometry straddling the clusterNear boundary is unaffected", async () => {
    for (const depth of [1.8, 2.0, 2.2]) {
        const reference = await meanLuma(0.01, depth);
        const decoupled = await meanLuma(2.0, depth);
        expect(reference).toBeGreaterThan(0.02);
        expect(decoupled).toBeCloseTo(reference, 3);
    }
}, 180_000);
