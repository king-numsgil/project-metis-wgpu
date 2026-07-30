// Camera-frustum culling in the forward/prepass/AO passes.
//
// The oracle is the same scene rendered with `frustumCulling = false`. Two
// things have to hold at once, and testing either alone is worthless:
//
//   1. the image is **identical** — culling may not change a pixel;
//   2. the cull actually **engaged** — otherwise (1) passes trivially, which is
//      precisely how a cull that rejects nothing looks like a cull that works.
//
// The fixtures cannot cover this: every scene they render has all its geometry
// on screen, so nothing is ever rejected. That is why the scene below
// deliberately puts most of its instances behind the camera.
import { expect, test } from "bun:test";
import { readTexturePixels } from "metis-native";
import {
    ClusteredForwardRenderer,
    createDefaultPostProcessPipeline,
    createExteriorEnvironment,
    cube,
    Material,
    Mesh,
    plane,
    RenderContext,
    Scene,
} from "metis-engine/renderer";
import { vec3f } from "metis-engine/renderer";

const W = 256;
const H = 192;

type Pixels = Awaited<ReturnType<typeof readTexturePixels>>;

interface CullResult {
    pixels: Pixels;
    drawn: number;
    candidates: number;
}

/**
 * A deck and one visible box in front of the camera, plus `offscreen` boxes
 * parked well behind it — geometry that is genuinely in the scene, genuinely
 * drawable, and genuinely invisible.
 */
async function render(frustumCulling: boolean, offscreen: number): Promise<CullResult> {
    const ctx = await RenderContext.createOffscreen({width: W, height: H, label: "frustum-cull-test"});
    const forward = new ClusteredForwardRenderer(ctx.device);
    const post = createDefaultPostProcessPipeline(ctx.device);
    forward.frustumCulling = frustumCulling;

    const scene = new Scene();
    scene.environment = createExteriorEnvironment({ambientIntensity: 0.05, sunIntensity: 3.0});
    scene.camera.position = vec3f(0, 4, 8);
    scene.camera.target = vec3f(0, 0, 0);
    scene.camera.setAspectFromSize(W, H);

    const boxMesh = new Mesh(ctx.device, cube(1.5, 1.5, 1.5), "box");
    const material = new Material({baseColor: [0.8, 0.8, 0.8, 1], metallic: 0, roughness: 0.9});
    scene.add(new Mesh(ctx.device, plane(20, 20), "deck"), material, {position: vec3f(0, -1, 0)});
    scene.add(boxMesh, material, {position: vec3f(0, 0, 0)});
    // A STRADDLER: centre well outside the left frustum plane, but big enough
    // that it reaches into view. Without it this file cannot detect a cull that
    // is too aggressive — every other instance is either wholly inside or wholly
    // behind the camera, so ignoring the bounding radius entirely still passes.
    // Verified by mutation: zeroing the radius in the cull test makes this
    // vanish and fails the image comparisons below.
    scene.add(new Mesh(ctx.device, cube(12, 6, 6), "straddler"), material, {position: vec3f(-12, 0, 0)});

    for (let i = 0; i < offscreen; i++) {
        // Straight back past the camera, far enough that no bounding radius
        // reaches the near plane. They cast no shadow, so the sun cannot
        // reintroduce them into the image through the cascades — this test is
        // about the camera passes only.
        scene.add(boxMesh, material, {position: vec3f(0, 0, 60 + i * 4)}).castsShadow = false;
    }

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
    const result = {
        pixels,
        drawn: forward.lastDrawnInstances,
        candidates: forward.lastCandidateInstances,
    };
    forward.destroy();
    post.pipeline.destroy();
    ctx.destroy();
    return result;
}

function differingPixels(a: Pixels, b: Pixels): number {
    let n = 0;
    for (let i = 0; i < a.length; i += 4) {
        if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) {
            n++;
        }
    }
    return n;
}

test("culling rejects geometry behind the camera", async () => {
    const culled = await render(true, 20);
    // 22 instances, 20 of them behind the camera. If this ever reads 22 the
    // image test below becomes vacuous.
    expect(culled.candidates).toBe(23);
    // deck + box + straddler; the 20 behind the camera are gone.
    expect(culled.drawn).toBe(3);
});

test("culling changes no pixels", async () => {
    const culled = await render(true, 20);
    const uncalled = await render(false, 20);

    // Byte-identical, not "close". Off-screen geometry contributes nothing, so
    // removing it must be exactly a no-op — any tolerance would hide a cull that
    // is slightly too aggressive at the frustum edge.
    expect(differingPixels(culled.pixels, uncalled.pixels)).toBe(0);
});

test("visible geometry is never culled", async () => {
    // The failure mode that matters: a cull that also rejects what you can see.
    // Compared against a scene with no off-screen geometry at all, so the two
    // differ only in what culling had the opportunity to remove.
    const withCull = await render(true, 20);
    const noExtras = await render(false, 0);
    expect(differingPixels(withCull.pixels, noExtras.pixels)).toBe(0);
    expect(withCull.drawn).toBe(3);
});

test("culling off draws everything", async () => {
    const uncalled = await render(false, 20);
    expect(uncalled.drawn).toBe(23);
    expect(uncalled.candidates).toBe(23);
});
