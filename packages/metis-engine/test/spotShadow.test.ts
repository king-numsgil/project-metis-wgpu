// Spot-light shadows, and the frustum culling that makes them affordable.
//
// The oracle throughout is an **A/B against the same scene with `castsShadow`
// off**. A single shadowed render proves very little: "everything got darker"
// and "nothing is shadowed" both produce a plausible image. The difference
// between two otherwise-identical renders is the only thing that isolates the
// shadow.
import { expect, test } from "bun:test";
import { readTexturePixels } from "metis-native";
import {
    ClusteredForwardRenderer,
    createDefaultPostProcessPipeline,
    createExteriorEnvironment,
    cube,
    MAX_SHADOW_SPOTS,
    Material,
    Mesh,
    plane,
    RenderContext,
    Scene,
    type SpotLight,
} from "metis-engine/renderer";

import { Mat4 } from "metis-data";
import { mat4f, vec3f } from "metis-engine/renderer";
import { frustumFromViewProj, sphereInFrustum } from "../src/renderer/math/frustum.ts";

const W = 256;
const H = 192;

interface RenderResult {
    /** Mean luminance of the deck region (the bottom half of the frame). */
    deckLuma: number;
    drawn: number;
    candidates: number;
}

/**
 * A spot aimed down at a deck with a blocker slab suspended in the beam. The
 * light is offset from the blocker so the shadow lands beside it rather than
 * directly underneath, where the blocker itself would hide it.
 */
async function renderBlockedSpot(castsShadow: boolean, extraDistantBoxes = 0): Promise<RenderResult> {
    const ctx = await RenderContext.createOffscreen({width: W, height: H, label: "spot-shadow-test"});
    const forward = new ClusteredForwardRenderer(ctx.device);
    const post = createDefaultPostProcessPipeline(ctx.device);

    const scene = new Scene();
    // The spot is the only meaningful light, so the deck's brightness is a
    // direct readout of how much of it the shadow covers.
    scene.environment = createExteriorEnvironment({ambientIntensity: 0.0, sunIntensity: 0.0});
    scene.camera.position = vec3f(0, 5, 7);
    scene.camera.target = vec3f(0, 0, 0);
    scene.camera.setAspectFromSize(W, H);

    scene.add(
        new Mesh(ctx.device, plane(20, 20), "deck"),
        new Material({baseColor: [0.8, 0.8, 0.8, 1], metallic: 0, roughness: 0.9}),
        {position: vec3f(0, -1, 0)},
    );
    scene.add(
        new Mesh(ctx.device, cube(2.2, 0.3, 2.2), "blocker"),
        new Material({baseColor: [0.8, 0.8, 0.8, 1], metallic: 0, roughness: 0.9}),
        {position: vec3f(0, 1.2, 0)},
    );

    // Optional far-away geometry, used only to prove the frustum cull rejects
    // things outside the cone. Placed far outside any light's reach.
    for (let i = 0; i < extraDistantBoxes; i++) {
        scene.add(
            new Mesh(ctx.device, cube(1, 1, 1), `distant-${i}`),
            new Material({baseColor: [0.8, 0.8, 0.8, 1], metallic: 0, roughness: 0.9}),
            {position: vec3f(500 + i * 10, 0, 500)},
        );
    }

    const spot: SpotLight = {
        kind: "spot",
        position: vec3f(0, 5, 0),
        direction: vec3f(0, -1, 0),
        color: [1, 1, 1],
        intensity: 120,
        range: 20,
        innerAngle: (18 * Math.PI) / 180,
        outerAngle: (38 * Math.PI) / 180,
        castsShadow,
    };
    scene.lights.push(spot);

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
    // Bottom half only — that's deck, below the suspended blocker, which keeps
    // the blocker's own surface out of the measurement.
    let sum = 0;
    let n = 0;
    for (let y = Math.floor(H / 2); y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            sum += 0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!;
            n++;
        }
    }

    const result = {
        deckLuma: sum / n,
        drawn: forward.spotShadows.lastDrawnInstances,
        candidates: forward.spotShadows.lastCandidateInstances,
    };
    forward.destroy();
    post.pipeline.destroy();
    ctx.destroy();
    return result;
}

/**
 * The same scene rendered over several frames through **one** renderer, with
 * `castsShadow` toggled per frame. Returns each frame's deck luminance.
 *
 * Every other test here builds a fresh renderer per case, which cannot see any
 * state a renderer carries *between* frames. Spot-shadow layers do carry such
 * state: an unused layer is cleared once and then skipped while it stays unused
 * (`SpotShadows.layerCleared`), so the interesting cases are the transitions —
 * a layer going idle, and an idle layer being put back to work.
 */
async function renderToggleSequence(castsShadowPerFrame: boolean[]): Promise<number[]> {
    const ctx = await RenderContext.createOffscreen({width: W, height: H, label: "spot-shadow-toggle-test"});
    const forward = new ClusteredForwardRenderer(ctx.device);
    const post = createDefaultPostProcessPipeline(ctx.device);

    const scene = new Scene();
    scene.environment = createExteriorEnvironment({ambientIntensity: 0.0, sunIntensity: 0.0});
    scene.camera.position = vec3f(0, 5, 7);
    scene.camera.target = vec3f(0, 0, 0);
    scene.camera.setAspectFromSize(W, H);
    scene.add(
        new Mesh(ctx.device, plane(20, 20), "deck"),
        new Material({baseColor: [0.8, 0.8, 0.8, 1], metallic: 0, roughness: 0.9}),
        {position: vec3f(0, -1, 0)},
    );
    scene.add(
        new Mesh(ctx.device, cube(2.2, 0.3, 2.2), "blocker"),
        new Material({baseColor: [0.8, 0.8, 0.8, 1], metallic: 0, roughness: 0.9}),
        {position: vec3f(0, 1.2, 0)},
    );
    const spot: SpotLight = {
        kind: "spot",
        position: vec3f(0, 5, 0),
        direction: vec3f(0, -1, 0),
        color: [1, 1, 1],
        intensity: 120,
        range: 20,
        innerAngle: (18 * Math.PI) / 180,
        outerAngle: (38 * Math.PI) / 180,
        castsShadow: false,
    };
    scene.lights.push(spot);

    const lumas: number[] = [];
    for (const castsShadow of castsShadowPerFrame) {
        spot.castsShadow = castsShadow;
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
        let sum = 0;
        let n = 0;
        for (let y = Math.floor(H / 2); y < H; y++) {
            for (let x = 0; x < W; x++) {
                const i = (y * W + x) * 4;
                sum += 0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!;
                n++;
            }
        }
        lumas.push(sum / n);
    }

    forward.destroy();
    post.pipeline.destroy();
    ctx.destroy();
    return lumas;
}

test("a spot-shadow layer left idle still renders when a caster reclaims it", async () => {
    // Frame 0 has no caster, so layer 0 is cleared and marked clean; frame 1
    // turns the caster on and that layer must render again.
    //
    // **This is the mutation check for the idle-layer skip.** Dropping the
    // `i >= spots.length` term from that guard — skipping any layer merely
    // because it was cleared — leaves frame 1 sampling an empty depth map, and
    // the shadow silently does not appear. Verified failing that way before
    // this test was trusted: frame 1's luma comes back equal to frame 0's.
    const [idle, reclaimed] = await renderToggleSequence([false, true]);
    expect(reclaimed!).toBeLessThan(idle! * 0.9);
    expect(reclaimed!).toBeGreaterThan(idle! * 0.15);
});

test("a spot that stops casting leaves no shadow behind", async () => {
    // The reverse transition: a layer that was drawn into goes idle. Nothing
    // may survive of the map it held — whether because it was re-cleared or
    // because the active-count guard stops it being sampled, both of which
    // must hold for the skip to be safe.
    const [shadowed, stopped] = await renderToggleSequence([true, false]);
    expect(stopped!).toBeGreaterThan(shadowed! / 0.9);
});

test("a castsShadow spot is occluded by geometry in its beam", async () => {
    const lit = await renderBlockedSpot(false);
    const shadowed = await renderBlockedSpot(true);

    // The blocker sits in the beam, so enabling shadows must remove a real
    // chunk of light from the deck. Auto-exposure is disabled-in-effect here
    // (single frame, no adaptation time), so this compares raw brightness.
    expect(shadowed.deckLuma).toBeLessThan(lit.deckLuma * 0.9);
    // ...but must not black the deck out entirely — that would be a shadow
    // covering everything, which is just as wrong as covering nothing.
    expect(shadowed.deckLuma).toBeGreaterThan(lit.deckLuma * 0.15);
});

test("a spot without castsShadow renders no shadow pass draws", async () => {
    const lit = await renderBlockedSpot(false);
    expect(lit.drawn).toBe(0);
});

test("frustum culling rejects geometry outside the light's cone", async () => {
    // 40 boxes parked 700 units away, far outside a range-20 cone. All of them
    // are candidates; none should survive the cull.
    const withDistant = await renderBlockedSpot(true, 40);
    expect(withDistant.candidates).toBe(42); // deck + blocker + 40 distant
    // Only the deck and the blocker are in the cone.
    expect(withDistant.drawn).toBeLessThanOrEqual(2);
    expect(withDistant.drawn).toBeGreaterThan(0);
});

test("frustum planes accept what is inside and reject what is outside", () => {
    // A pure-CPU check of the plane extraction, independent of any render.
    // The WebGPU [0,1] depth convention is the easy thing to get wrong here
    // (the OpenGL form puts the near plane in the wrong place), so the near/far
    // cases are tested explicitly rather than only the side planes.
    const view = Mat4.setLookAt(mat4f(), vec3f(0, 0, 0), vec3f(0, 0, -1), vec3f(0, 1, 0));
    const proj = Mat4.setPerspective(mat4f(), Math.PI / 2, 1, 1, 100);
    const f = frustumFromViewProj(Mat4.multiply(mat4f(), proj, view));

    expect(sphereInFrustum(f, 0, 0, -50, 1)).toBe(true); // dead centre
    expect(sphereInFrustum(f, 0, 0, 50, 1)).toBe(false); // behind the camera
    expect(sphereInFrustum(f, 0, 0, -200, 1)).toBe(false); // past the far plane
    expect(sphereInFrustum(f, 0, 0, -0.1, 0.01)).toBe(false); // nearer than near
    expect(sphereInFrustum(f, 200, 0, -50, 1)).toBe(false); // far off to the side
    // Just outside the side plane, but with a radius big enough to reach in.
    expect(sphereInFrustum(f, 200, 0, -50, 190)).toBe(true);
});

test("MAX_SHADOW_SPOTS is exported and sane", () => {
    expect(MAX_SHADOW_SPOTS).toBeGreaterThan(0);
    expect(Number.isInteger(MAX_SHADOW_SPOTS)).toBe(true);
});
