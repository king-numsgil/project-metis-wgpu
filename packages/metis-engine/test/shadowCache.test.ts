// The cascade shadow-map cache: skipping a cascade's depth pass when nothing
// that feeds it changed.
//
// **The oracle is always the same scene rendered with `cacheEnabled = false`.**
// A cached render compared against itself proves nothing, and a single-frame
// render proves less than nothing here: the cache cannot skip on frame 1 (its
// stored matrices are NaN), so any test that renders one frame is testing the
// uncached path while believing it tested the cached one. Every case below
// therefore renders **several** frames and compares the last one.
//
// The invalidation test is the load-bearing one, and it is written so that
// breaking `castersChanged` fails it: with invalidation removed, the moved cube
// keeps casting its shadow from where it used to be, which is a large, obvious
// pixel difference — and exactly the "renders plausibly while being wrong"
// failure this package keeps documenting.
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
import { Vec3 } from "metis-data";
import { vec3f } from "metis-engine/renderer";

const W = 256;
const H = 192;
/** Enough frames that frames 2..N are all cache hits when the scene is static. */
const FRAMES = 4;

/** What `readTexturePixels` hands back — not narrowed to `Uint8Array<ArrayBuffer>`. */
type Pixels = Awaited<ReturnType<typeof readTexturePixels>>;

interface CacheResult {
    pixels: Pixels;
    /** Cascades re-rendered on the final frame. */
    lastRendered: number;
}

/**
 * Renders `FRAMES` frames of a cube-on-a-deck scene lit by the sun.
 *
 * @param cacheEnabled the thing under test.
 * @param moveOnFinalFrame displaces the caster before the last frame — the
 *   invalidation case. The deck shadow must follow it.
 */
async function renderFrames(cacheEnabled: boolean, moveOnFinalFrame: boolean): Promise<CacheResult> {
    const ctx = await RenderContext.createOffscreen({width: W, height: H, label: "shadow-cache-test"});
    const forward = new ClusteredForwardRenderer(ctx.device);
    const post = createDefaultPostProcessPipeline(ctx.device);
    forward.shadows.cacheEnabled = cacheEnabled;

    const scene = new Scene();
    // Sun only: the deck's brightness is then a direct readout of the cascade
    // shadow, with no local light washing it out.
    scene.environment = createExteriorEnvironment({ambientIntensity: 0.02, sunIntensity: 3.0});
    scene.camera.position = vec3f(0, 6, 9);
    scene.camera.target = vec3f(0, 0, 0);
    scene.camera.setAspectFromSize(W, H);

    scene.add(
        new Mesh(ctx.device, plane(20, 20), "deck"),
        new Material({baseColor: [0.8, 0.8, 0.8, 1], metallic: 0, roughness: 0.9}),
        {position: vec3f(0, -1, 0)},
    );
    const caster = scene.add(
        new Mesh(ctx.device, cube(1.6, 1.6, 1.6), "caster"),
        new Material({baseColor: [0.8, 0.8, 0.8, 1], metallic: 0, roughness: 0.9}),
        {position: vec3f(-2.5, 0.4, 0)},
    );

    let pixels: Pixels = new Uint8Array(0);
    for (let f = 0; f < FRAMES; f++) {
        if (moveOnFinalFrame && f === FRAMES - 1) {
            // Straight across the deck, so the shadow's new position does not
            // overlap its old one at all.
            Vec3.set(caster.transform.position, 2.5, 0.4, 0);
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
        if (f === FRAMES - 1) {
            pixels = await readTexturePixels(ctx.device, ctx.captureTexture!);
        }
    }

    const result = {pixels, lastRendered: forward.shadows.lastRenderedCascades};
    forward.destroy();
    post.pipeline.destroy();
    ctx.destroy();
    return result;
}

/** Count of pixels whose max channel delta exceeds `tolerance`. */
function differingPixels(a: Pixels, b: Pixels, tolerance = 0): number {
    let n = 0;
    for (let i = 0; i < a.length; i += 4) {
        const d = Math.max(
            Math.abs(a[i]! - b[i]!),
            Math.abs(a[i + 1]! - b[i + 1]!),
            Math.abs(a[i + 2]! - b[i + 2]!),
        );
        if (d > tolerance) {
            n++;
        }
    }
    return n;
}

test("a static scene's cached frame is byte-identical to the uncached one", async () => {
    const cached = await renderFrames(true, false);
    const uncached = await renderFrames(false, false);

    // Not "close" — identical. The cache reuses a depth map rendered from a
    // bit-identical viewProj, so there is no numeric drift to allow for. Any
    // tolerance here would hide the exact class of bug this is checking for.
    expect(differingPixels(cached.pixels, uncached.pixels)).toBe(0);
});

test("a static scene skips every cascade once warmed up", async () => {
    const cached = await renderFrames(true, false);
    // The point of the whole change: by the final frame nothing is re-rendered.
    // Without this the test above would pass just as happily with a cache that
    // never hits, which is the failure mode that looks like success.
    expect(cached.lastRendered).toBe(0);

    const uncached = await renderFrames(false, false);
    expect(uncached.lastRendered).toBe(4);
});

test("moving a caster invalidates the cache and the shadow follows it", async () => {
    const cached = await renderFrames(true, true);
    const uncached = await renderFrames(false, true);

    // The mutation check: delete the `modelChanged` term from
    // `ShadowCascades.castersChanged` and this is what fails — the cached run
    // keeps drawing the shadow at the cube's old position.
    expect(differingPixels(cached.pixels, uncached.pixels)).toBe(0);
    // ...and the invalidation must actually have fired, rather than the two
    // agreeing because the cache never engaged.
    expect(cached.lastRendered).toBe(4);
});

test("the moved caster's shadow is somewhere genuinely different", async () => {
    // Guards the test above against being vacuous. If the cube's displacement
    // produced no visible change, "cached matches uncached" would hold no matter
    // how broken invalidation was.
    const stationary = await renderFrames(false, false);
    const moved = await renderFrames(false, true);
    expect(differingPixels(stationary.pixels, moved.pixels, 8)).toBeGreaterThan(200);
});
