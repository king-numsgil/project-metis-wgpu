// Coverage for **immediates** — small inline uniforms set directly on a pass,
// with no buffer and no bind group. What every other API still calls push
// constants; wgpu 30 renamed them after the WebGPU spec, and this binding
// followed (`immediates` feature, `maxImmediateSize` limit, `var<immediate>` in
// WGSL, `pass.setImmediates()`).
//
// Nothing in the monorepo uses them, which is exactly why they need a test: the
// whole path — feature name, limit, pipeline-layout size, the pass call, and
// the WGSL address space — was rewritten in the wgpu 30 upgrade and had no
// consumer to catch a mistake. So this drives colour through an immediate and
// reads the pixels back, rather than checking that the calls fail to throw.
//
// The last test is the load-bearing one. An implementation that ignored the
// offset, or uploaded the immediate once at pipeline creation instead of per
// draw, would pass everything before it.
import { beforeAll, describe, expect, it } from "bun:test";
import {
    GPUTextureUsage,
    type GpuAdapter,
    type GpuDevice,
    readTexturePixels,
    requestAdapter,
} from "../index.js";

const SIZE = 64;
const IMMEDIATE_BYTES = 16; // one vec4<f32>

const SHADER = `
struct Immediates { color: vec4<f32> }
var<immediate> pc: Immediates;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    // Oversized triangle covering the whole target; scissor selects the region.
    var p = array<vec2<f32>, 3>(vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
    return vec4<f32>(p[i], 0.0, 1.0);
}

@fragment fn fs() -> @location(0) vec4<f32> { return pc.color; }
`;

let adapter: GpuAdapter | null = null;
let device: GpuDevice | null = null;
let supported = false;

beforeAll(async () => {
    adapter = await requestAdapter();
    if (!adapter) return;
    supported = adapter.features.has("immediates");
    if (!supported) return;
    device = await adapter.requestDevice({
        label: "immediates-test",
        requiredFeatures: ["immediates"],
        requiredLimits: { maxImmediateSize: IMMEDIATE_BYTES },
    });
});

/** RGBA8 bytes for a colour, as the shader will receive them. */
function rgba(r: number, g: number, b: number, a = 1) {
    return new Uint8Array(new Float32Array([r, g, b, a]).buffer);
}

function target(dev: GpuDevice) {
    return dev.createTexture({
        size: { width: SIZE, height: SIZE },
        format: "rgba8unorm",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
}

function buildPipeline(dev: GpuDevice, immediateSize: number) {
    const module = dev.createShaderModule({ code: SHADER });
    const layout = dev.createPipelineLayout({ bindGroupLayouts: [], immediateSize });
    return dev.createRenderPipeline({
        layout,
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint: "fs", targets: [{ format: "rgba8unorm" }] },
    });
}

/** Reads the pixel at (x, y) as [r,g,b,a]. */
function pixelAt(px: Uint8Array, x: number, y: number) {
    const i = (y * SIZE + x) * 4;
    return [px[i], px[i + 1], px[i + 2], px[i + 3]];
}

describe("immediates", () => {
    it("is advertised by the adapter under its spec name", () => {
        if (!adapter) return;
        // It used to be the native-only `push-constants`. It is a WebGPU spec
        // feature now, so it lives in GPUFeatureName — asking for the old name
        // is a TypeError, which is the point of the rename.
        expect(adapter.features.has("immediates")).toBe(true);
        expect(adapter.features.has("push-constants" as never)).toBe(false);
    });

    it("reports the requested limit, not the adapter maximum", () => {
        if (!device || !adapter) return;
        // Proves `requiredLimits.maxImmediateSize` is actually plumbed through
        // rather than the adapter's value being echoed back.
        expect(device.limits.maxImmediateSize).toBe(IMMEDIATE_BYTES);
        expect(adapter.limits.maxImmediateSize).toBeGreaterThanOrEqual(IMMEDIATE_BYTES);
    });

    it("defaults the limit to 0, making the feature alone useless", async () => {
        if (!adapter || !supported) return;
        // The documented trap (DOC.md §2): requesting `immediates` without also
        // raising `maxImmediateSize` yields a device that accepts none. Pinned
        // so the doc and the behaviour cannot drift apart.
        const bare = await adapter.requestDevice({
            label: "immediates-no-limit",
            requiredFeatures: ["immediates"],
        });
        expect(bare.limits.maxImmediateSize).toBe(0);
    });

    it("drives fragment colour through an immediate", async () => {
        if (!device) return;
        const tex = target(device);
        const pipeline = buildPipeline(device, IMMEDIATE_BYTES);

        device.pushErrorScope("validation");
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: tex.createView(),
                    loadOp: "clear",
                    storeOp: "store",
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                },
            ],
        });
        pass.setPipeline(pipeline);
        pass.setImmediates(0, rgba(1, 0, 0)); // red
        pass.draw(3);
        pass.end();
        device.queue.submit([encoder.finish()]);
        expect(await device.popErrorScope()).toBeNull();

        const px = await readTexturePixels(device, tex);
        expect(pixelAt(px, SIZE / 2, SIZE / 2)).toEqual([255, 0, 0, 255]);
    });

    it("rejects setImmediates when the layout reserved no space", async () => {
        if (!device) return;
        const tex = target(device);
        const pipeline = buildPipeline(device, 0); // no immediate range declared

        device.pushErrorScope("validation");
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: tex.createView(),
                    loadOp: "clear",
                    storeOp: "store",
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                },
            ],
        });
        pass.setPipeline(pipeline);
        pass.setImmediates(0, rgba(1, 0, 0));
        pass.draw(3);
        pass.end();
        device.queue.submit([encoder.finish()]);

        expect(await device.popErrorScope()).not.toBeNull();
    });

    // Every test above writes at offset 0, so none of them can tell whether the
    // offset argument is honoured or quietly ignored — verified by mutation:
    // replacing `set_immediates(offset, ..)` with `set_immediates(0, ..)` left
    // them all green. This one writes the colour into the *second* slot of a
    // two-field block, so a dropped offset lands on the first field and the
    // shader reads back the wrong one.
    it("writes at the offset it is given", async () => {
        if (!device) return;
        const twoSlot = `
struct Immediates { unused: vec4<f32>, color: vec4<f32> }
var<immediate> pc: Immediates;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    var p = array<vec2<f32>, 3>(vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
    return vec4<f32>(p[i], 0.0, 1.0);
}
@fragment fn fs() -> @location(0) vec4<f32> { return pc.color; }
`;
        const dev = await adapter!.requestDevice({
            label: "immediates-offset",
            requiredFeatures: ["immediates"],
            requiredLimits: { maxImmediateSize: 32 },
        });
        const module = dev.createShaderModule({ code: twoSlot });
        const pipeline = dev.createRenderPipeline({
            layout: dev.createPipelineLayout({ bindGroupLayouts: [], immediateSize: 32 }),
            vertex: { module, entryPoint: "vs" },
            fragment: { module, entryPoint: "fs", targets: [{ format: "rgba8unorm" }] },
        });
        const tex = target(dev);

        dev.pushErrorScope("validation");
        const encoder = dev.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: tex.createView(),
                    loadOp: "clear",
                    storeOp: "store",
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                },
            ],
        });
        pass.setPipeline(pipeline);
        pass.setImmediates(0, rgba(0, 1, 0)); // slot 0 — green, must NOT be read
        pass.setImmediates(16, rgba(0, 0, 1)); // slot 1 — blue, the one `color` is
        pass.draw(3);
        pass.end();
        dev.queue.submit([encoder.finish()]);
        expect(await dev.popErrorScope()).toBeNull();

        const px = await readTexturePixels(dev, tex);
        expect(pixelAt(px, SIZE / 2, SIZE / 2)).toEqual([0, 0, 255, 255]);
    });

    // The one that matters: two draws in ONE pass, differing only in the
    // immediate. Scissor confines each to its own half. If immediates were
    // uploaded once per pipeline rather than per draw, both halves would come
    // back the same colour and every test above would still pass.
    it("applies a new value per draw within a single pass", async () => {
        if (!device) return;
        const tex = target(device);
        const pipeline = buildPipeline(device, IMMEDIATE_BYTES);

        device.pushErrorScope("validation");
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: tex.createView(),
                    loadOp: "clear",
                    storeOp: "store",
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                },
            ],
        });
        pass.setPipeline(pipeline);

        pass.setScissorRect(0, 0, SIZE / 2, SIZE);
        pass.setImmediates(0, rgba(1, 0, 0)); // left half red
        pass.draw(3);

        pass.setScissorRect(SIZE / 2, 0, SIZE / 2, SIZE);
        pass.setImmediates(0, rgba(0, 0, 1)); // right half blue
        pass.draw(3);

        pass.end();
        device.queue.submit([encoder.finish()]);
        expect(await device.popErrorScope()).toBeNull();

        const px = await readTexturePixels(device, tex);
        expect(pixelAt(px, SIZE / 4, SIZE / 2)).toEqual([255, 0, 0, 255]);
        expect(pixelAt(px, (SIZE * 3) / 4, SIZE / 2)).toEqual([0, 0, 255, 255]);
    });
});
