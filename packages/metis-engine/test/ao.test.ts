// Ambient occlusion tests. Two layers:
//   1. Pure-math unit tests of the SSAO hemisphere kernel + rotation noise
//      generators (no GPU) — these validate the sampling distribution that's
//      easy to get subtly wrong and impossible to eyeball.
//   2. A GPU integration test (skipped when no adapter is present) that renders
//      a box resting on a floor lit *only* by ambient, then asserts each
//      technique darkens the contact creases relative to `None` — with the
//      forward/AO passes wrapped in a validation error scope, so a broken WGSL
//      shader fails loudly instead of silently rendering garbage (see
//      packages/metis-engine/CLAUDE.md's note on swallowed wgpu errors).
import { requestAdapter } from "bun-webgpu-rs";
import { takeScreenshot } from "bun-webgpu-rs/tests/helpers/screenshot.ts";
import { describe, expect, it } from "bun:test";
import {
    AO_NOISE_DIM,
    AoTechnique,
    ClusteredForwardRenderer,
    createInteriorEnvironment,
    cube,
    ExposureState,
    generateAoNoise,
    generateSsaoKernel,
    Material,
    Mesh,
    mulberry32,
    plane,
    PostProcessPipeline,
    RenderContext,
    Scene,
    SSAO_KERNEL_SIZE,
    TonemapPass,
} from "metis-engine/renderer";
import { vec3 } from "wgpu-matrix";

// ── Pure-math: SSAO kernel ──────────────────────────────────────────────────

describe("generateSsaoKernel", () => {
    const kernel = generateSsaoKernel(SSAO_KERNEL_SIZE);

    it("produces one vec4 per requested sample", () => {
        expect(kernel.length).toBe(SSAO_KERNEL_SIZE * 4);
    });

    it("keeps every sample in the +Z hemisphere (z >= 0)", () => {
        for (let i = 0; i < SSAO_KERNEL_SIZE; i++) {
            expect(kernel[i * 4 + 2]).toBeGreaterThanOrEqual(0);
        }
    });

    it("keeps every sample inside the unit sphere", () => {
        for (let i = 0; i < SSAO_KERNEL_SIZE; i++) {
            const len = Math.hypot(kernel[i * 4]!, kernel[i * 4 + 1]!, kernel[i * 4 + 2]!);
            expect(len).toBeLessThanOrEqual(1 + 1e-6);
        }
    });

    it("weights later samples farther from the origin (accelerating scale)", () => {
        const avgLen = (from: number, to: number) => {
            let sum = 0;
            for (let i = from; i < to; i++) {
                sum += Math.hypot(kernel[i * 4]!, kernel[i * 4 + 1]!, kernel[i * 4 + 2]!);
            }
            return sum / (to - from);
        };
        const q = SSAO_KERNEL_SIZE / 4;
        // First quarter should hug the origin more tightly than the last quarter.
        expect(avgLen(0, q)).toBeLessThan(avgLen(SSAO_KERNEL_SIZE - q, SSAO_KERNEL_SIZE));
    });

    it("is deterministic for a given seed", () => {
        expect(Array.from(generateSsaoKernel(8, 42))).toEqual(Array.from(generateSsaoKernel(8, 42)));
        expect(Array.from(generateSsaoKernel(8, 42))).not.toEqual(Array.from(generateSsaoKernel(8, 43)));
    });
});

// ── Pure-math: rotation noise ───────────────────────────────────────────────

describe("generateAoNoise", () => {
    const noise = generateAoNoise(AO_NOISE_DIM);

    it("produces one vec4 per tile texel", () => {
        expect(noise.length).toBe(AO_NOISE_DIM * AO_NOISE_DIM * 4);
    });

    it("lies in the tangent plane (z == 0) with x,y in [-1,1]", () => {
        for (let i = 0; i < AO_NOISE_DIM * AO_NOISE_DIM; i++) {
            expect(noise[i * 4 + 2]).toBe(0);
            expect(Math.abs(noise[i * 4]!)).toBeLessThanOrEqual(1);
            expect(Math.abs(noise[i * 4 + 1]!)).toBeLessThanOrEqual(1);
        }
    });
});

describe("mulberry32", () => {
    it("is reproducible and in [0,1)", () => {
        const a = mulberry32(7);
        const b = mulberry32(7);
        for (let i = 0; i < 100; i++) {
            const x = a();
            expect(x).toBe(b());
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThan(1);
        }
    });
});

// ── GPU integration ─────────────────────────────────────────────────────────

const AO_W = 256;
const AO_H = 256;

/** Renders a box-on-a-floor scene lit only by ambient, returns the mean screen luma [0,1] and any captured validation error. */
async function renderAoScene(technique: AoTechnique): Promise<{ mean: number; error: string | null }> {
    const ctx = await RenderContext.createOffscreen({width: AO_W, height: AO_H, label: `ao-${technique}`});
    const forward = new ClusteredForwardRenderer(ctx.device);
    forward.ao.technique = technique;

    // Fixed-exposure tonemap only (no auto-exposure): AO strictly darkens, so a
    // metering pass would fight the very effect we're measuring.
    const tonemap = new TonemapPass(ctx.device, new ExposureState(ctx.device, 1.0));
    const post = new PostProcessPipeline([tonemap]);

    const scene = new Scene();
    // Ambient-only: sun off, flat white fill. Then final colour ≈ albedo * AO.
    scene.environment = createInteriorEnvironment({sunIntensity: 0, ambientColor: [1, 1, 1], ambientIntensity: 1.0});
    scene.camera.position = vec3.create(2.2, 2.2, 2.2);
    scene.camera.target = vec3.create(0, 0.25, 0);
    scene.camera.setAspectFromSize(AO_W, AO_H);

    const grey = new Material({baseColor: [0.5, 0.5, 0.5, 1], metallic: 0, roughness: 1});
    scene.add(new Mesh(ctx.device, plane(6, 6), "floor"), grey);
    // Box resting on the floor (bottom face at y=0) → contact crease all around its base.
    scene.add(new Mesh(ctx.device, cube(1, 1, 1), "box"), grey, {position: vec3.create(0, 0.5, 0)});

    ctx.device.pushErrorScope("validation");
    const frame = ctx.beginFrame();
    const encoder = ctx.device.createCommandEncoder();
    forward.render(encoder, ctx.targets, scene);
    post.run(encoder, {
        device: ctx.device,
        hdrColorView: ctx.targets.hdrColorResolvedView,
        depthView: ctx.targets.depthView,
        outputView: frame.view,
        outputFormat: frame.format,
        width: AO_W,
        height: AO_H,
        deltaTime: 1 / 60,
    });
    ctx.device.queue.submit([encoder.finish()]);
    await ctx.device.queue.onSubmittedWorkDone();
    const err = await ctx.device.popErrorScope();
    frame.present();

    const pixels = await takeScreenshot(ctx.device, ctx.captureTexture!, AO_W, AO_H, `test/output/ao-${technique}.png`);
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 4) {
        sum += 0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!;
    }
    const mean = sum / (pixels.length / 4) / 255;

    forward.destroy();
    post.destroy();
    ctx.destroy();
    return {mean, error: err ? `${err.type}: ${err.message}` : null};
}

const adapter = await requestAdapter({}).catch(() => null);
const gpuIt = adapter ? it : it.skip;

describe("ambient occlusion (GPU)", () => {
    gpuIt(
        "renders every technique without validation errors, and SSAO/HBAO darken contact creases vs None",
        async () => {
            const none = await renderAoScene(AoTechnique.None);
            const ssao = await renderAoScene(AoTechnique.SSAO);
            const hbao = await renderAoScene(AoTechnique.HBAO);

            // No swallowed WGSL/pipeline validation errors in any path.
            expect(none.error).toBeNull();
            expect(ssao.error).toBeNull();
            expect(hbao.error).toBeNull();

            // The scene is actually lit (not a black frame).
            expect(none.mean).toBeGreaterThan(0.05);

            // AO only ever multiplies ambient by <= 1, so both techniques must
            // come out darker than None — the contact creases around the box.
            const margin = 0.002; // ~0.5/255 mean luma; a real, not-noise darkening
            expect(ssao.mean).toBeLessThan(none.mean - margin);
            expect(hbao.mean).toBeLessThan(none.mean - margin);
        },
        30_000,
    );
});
