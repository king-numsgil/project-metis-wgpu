// Per-cascade shadow-caster culling (`ShadowCascades.cullPerCascade`).
//
// The oracle is **an A/B against the same scene with culling off**. Culling may
// only ever change *what is drawn*, never what is seen, so cull-on must be
// pixel-identical to cull-off. That check alone passes trivially when the cull
// rejects nothing, so every case here pairs it with "and it actually rejected
// something" — the same trap `frustumCull.test.ts` documents.
//
// The case that matters is the **low sun**. The sweep test keeps a caster in a
// cascade when its shadow can reach that cascade's receivers, and at a grazing
// sun angle a near occluder's shadow stretches into the far cascades. A test
// with an overhead sun cannot tell a correct sweep from one that simply drops
// everything outside its own slice; the two agree there and disagree here.
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

const W = 320;
const H = 240;

interface CullResult {
    pixels: Uint8Array;
    drawn: number;
    candidates: number;
}

/**
 * A long ground plane with a row of blockers marching away from the camera,
 * under a sun of the given direction. Rendered with per-cascade culling on or
 * off; everything else is identical.
 */
async function render(cullPerCascade: boolean, sun: [number, number, number]): Promise<CullResult> {
    const ctx = await RenderContext.createOffscreen({width: W, height: H, label: "cascade-cull-test"});
    const forward = new ClusteredForwardRenderer(ctx.device);
    const post = createDefaultPostProcessPipeline(ctx.device);
    forward.shadows.cullPerCascade = cullPerCascade;

    const scene = new Scene();
    scene.environment = createExteriorEnvironment({ambientIntensity: 0.05, sunIntensity: 3.0});
    scene.environment.sunDirection = vec3f(...sun);
    // Looking down a long corridor of ground, so the view spans several
    // cascades and there is genuinely distant geometry to cull against.
    scene.camera.position = vec3f(0, 6, 40);
    scene.camera.target = vec3f(0, 0, -60);
    scene.camera.setAspectFromSize(W, H);

    const groundMat = new Material({baseColor: [0.75, 0.75, 0.78, 1], metallic: 0, roughness: 0.9});
    scene.add(new Mesh(ctx.device, plane(400, 400), "ground"), groundMat, {position: vec3f(0, 0, 0)});

    // Blockers from near the camera out to well beyond the near cascades, so
    // different instances belong to different cascades' receiver regions.
    const blockerMesh = new Mesh(ctx.device, cube(2, 6, 2), "blocker");
    const blockerMat = new Material({baseColor: [0.8, 0.8, 0.8, 1], metallic: 0, roughness: 0.9});
    for (let i = 0; i < 24; i++) {
        scene.add(blockerMesh, blockerMat, {position: vec3f(((i % 4) - 1.5) * 9, 3, 30 - i * 7)});
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
        pixels: Uint8Array.from(pixels),
        drawn: forward.shadows.lastDrawnInstances,
        candidates: forward.shadows.lastCandidateInstances,
    };
    forward.destroy();
    post.pipeline.destroy();
    ctx.destroy();
    return result;
}

function differingPixels(a: Uint8Array, b: Uint8Array): number {
    let n = 0;
    for (let i = 0; i < a.length; i += 4) {
        if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) {
            n++;
        }
    }
    return n;
}

// A high sun: shadows are short and stay near their casters, so the sweep test
// can reject aggressively. This is the case that proves the win is real.
const HIGH_SUN: [number, number, number] = [-0.15, -1, -0.2];
// A grazing sun: shadows are long and reach far down the corridor, so casters
// near the camera legitimately belong in the *far* cascades' maps. This is the
// case that proves the sweep is not just "keep what is in my own slice".
const LOW_SUN: [number, number, number] = [-0.12, -0.16, -1];

test("per-cascade culling changes no pixels, and actually rejects something", async () => {
    const off = await render(false, HIGH_SUN);
    const on = await render(true, HIGH_SUN);

    // Both halves are required. Identical-pixels alone passes for a cull that
    // rejects nothing; rejected-something alone passes for one that wrongly
    // deletes shadows.
    expect(differingPixels(off.pixels, on.pixels)).toBe(0);
    expect(on.drawn).toBeLessThan(on.candidates);
});

test("a low sun keeps near casters in the far cascades", async () => {
    // **This is the mutation check for the sweep test.** The shadows here run
    // far down the corridor, so casters close to the camera must survive into
    // cascades whose receivers are a long way off. Breaking the sweep so it
    // keeps only casters inside their own cascade's slice — which is the
    // intuitive-but-wrong "cascade 2 already handled it" rule — deletes those
    // long shadows, and this comparison fails on thousands of pixels.
    const off = await render(false, LOW_SUN);
    const on = await render(true, LOW_SUN);

    expect(differingPixels(off.pixels, on.pixels)).toBe(0);
    // The scene must genuinely contain long shadows, or the case above is
    // vacuous: with a grazing sun the cull has to keep markedly more casters
    // than it does with an overhead one.
    const high = await render(true, HIGH_SUN);
    expect(on.drawn).toBeGreaterThan(high.drawn);
});
