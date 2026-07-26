// Coverage for render bundles — pre-recorded, replayable render commands.
//
// The load-bearing test is "a bundle's draw actually reaches the framebuffer":
// this binding records commands into a `Vec` and replays them into a real wgpu
// encoder inside `finish()` (the encoder is `!Send`, so it can't be held — see
// src/gpu/render_bundle.rs). An implementation that dropped the recorded list on
// the floor would still hand back a plausible `GpuRenderBundle` and raise no
// validation error; only reading pixels back proves the commands ran.
import { beforeAll, describe, expect, it } from "bun:test";
import {
    type GpuDevice,
    type GpuRenderPipeline,
    GPUTextureUsage,
    readTexturePixels,
    requestAdapter,
} from "../index.js";

const SIZE = 4;
const FORMAT = "rgba8unorm";

let device: GpuDevice | null = null;
let pipeline: GpuRenderPipeline | null = null;

const SHADER = /* wgsl */ `
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
    return vec4<f32>(p[i], 0.0, 1.0);
}
@fragment fn fs() -> @location(0) vec4<f32> { return vec4<f32>(0.0, 1.0, 0.0, 1.0); }
`;

beforeAll(async () => {
    const adapter = await requestAdapter();
    if (!adapter) return;
    device = await adapter.requestDevice({ label: "render-bundle-test" });
    const module = device.createShaderModule({ code: SHADER, label: "bundle-shader" });
    pipeline = device.createRenderPipeline({
        label: "bundle-pipeline",
        layout: "auto",
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint: "fs", targets: [{ format: FORMAT }] },
    });
});

function target(dev: GpuDevice) {
    return dev.createTexture({
        size: { width: SIZE, height: SIZE },
        format: FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
}

/** Clear `tex` to red, then execute `bundles` into it. Returns RGBA of pixel 0. */
async function renderWithBundles(dev: GpuDevice, tex: ReturnType<typeof target>, bundles: unknown[]) {
    const encoder = dev.createCommandEncoder();
    const pass = encoder.beginRenderPass({
        colorAttachments: [
            {
                view: tex.createView(),
                loadOp: "clear",
                storeOp: "store",
                clearValue: { r: 1, g: 0, b: 0, a: 1 },
            },
        ],
    });
    pass.executeBundles(bundles as never);
    pass.end();
    dev.queue.submit([encoder.finish()]);
    await dev.queue.onSubmittedWorkDone();
    const px = await readTexturePixels(dev, tex);
    return [px[0], px[1], px[2], px[3]];
}

describe("GpuRenderBundleEncoder", () => {
    it("records and finishes into a GpuRenderBundle", () => {
        if (!device || !pipeline) return;
        const enc = device.createRenderBundleEncoder({ colorFormats: [FORMAT] });
        enc.setPipeline(pipeline);
        enc.draw(3);
        const bundle = enc.finish({ label: "tri" });
        expect(bundle).toBeDefined();
        expect(bundle.label).toBe("tri");
        bundle.label = "renamed";
        expect(bundle.label).toBe("renamed");
    });

    it("a bundle's draw actually reaches the framebuffer", async () => {
        if (!device || !pipeline) return;
        const enc = device.createRenderBundleEncoder({ colorFormats: [FORMAT] });
        enc.setPipeline(pipeline);
        enc.draw(3);
        const bundle = enc.finish();

        const tex = target(device);
        const [r, g, b, a] = await renderWithBundles(device, tex, [bundle]);
        // Cleared red, bundle paints green over it.
        expect([r, g, b, a]).toEqual([0, 255, 0, 255]);
        tex.destroy();
    });

    it("executing no bundles leaves the clear untouched (control)", async () => {
        if (!device) return;
        const tex = target(device);
        const [r, g, b, a] = await renderWithBundles(device, tex, []);
        expect([r, g, b, a]).toEqual([255, 0, 0, 255]);
        tex.destroy();
    });

    it("one bundle is reusable across separate passes — the point of bundles", async () => {
        if (!device || !pipeline) return;
        const enc = device.createRenderBundleEncoder({ colorFormats: [FORMAT] });
        enc.setPipeline(pipeline);
        enc.draw(3);
        const bundle = enc.finish();

        const a = target(device);
        const b = target(device);
        expect(await renderWithBundles(device, a, [bundle])).toEqual([0, 255, 0, 255]);
        expect(await renderWithBundles(device, b, [bundle])).toEqual([0, 255, 0, 255]);
        a.destroy();
        b.destroy();
    });

    it("finish() twice throws, and recording after finish throws", () => {
        if (!device || !pipeline) return;
        const enc = device.createRenderBundleEncoder({ colorFormats: [FORMAT] });
        enc.setPipeline(pipeline);
        enc.draw(3);
        enc.finish();
        expect(() => enc.finish()).toThrow(/already finished/i);
        expect(() => enc.draw(3)).toThrow(/already finished/i);
    });

    it("a format mismatch against the executing pass is a validation error", async () => {
        if (!device || !pipeline) return;
        // Bundle compiled for bgra8unorm, executed in an rgba8unorm pass.
        const enc = device.createRenderBundleEncoder({ colorFormats: ["bgra8unorm"] });
        const bundle = enc.finish();

        device.pushErrorScope("validation");
        const tex = target(device);
        await renderWithBundles(device, tex, [bundle]);
        const err = await device.popErrorScope();
        expect(err).not.toBeNull();
        tex.destroy();
    });

    it("accepts a depth-stencil format and sample count in the descriptor", () => {
        if (!device) return;
        const enc = device.createRenderBundleEncoder({
            label: "with-depth",
            colorFormats: [FORMAT],
            depthStencilFormat: "depth32float",
            sampleCount: 1,
            depthReadOnly: true,
        });
        expect(enc.finish()).toBeDefined();
    });

    it("a null colour-format slot is allowed alongside a real attachment", () => {
        if (!device) return;
        const enc = device.createRenderBundleEncoder({ colorFormats: [FORMAT, null] });
        expect(enc.finish()).toBeDefined();
    });

    it("rejects a layout with no attachments instead of panicking wgpu", () => {
        if (!device) return;
        // wgpu panics inside finish() on an attachment-less layout, and a Rust
        // panic across napi aborts the process — so the binding rejects it up
        // front. Mutation-checked: removing that guard aborts the test runner.
        expect(() => device!.createRenderBundleEncoder({ colorFormats: [null] })).toThrow(
            /at least one non-null entry|depthStencilFormat/i,
        );
        expect(() => device!.createRenderBundleEncoder({ colorFormats: [] })).toThrow(
            /at least one non-null entry|depthStencilFormat/i,
        );
    });
});
