// Coverage for `depthSlice` on a render pass colour attachment.
//
// `depthSlice` selects which z-slice of a **3D** texture view a colour
// attachment renders into. It arrived with the wgpu 30 upgrade — wgpu 30 made
// it a required field on `RenderPassColorAttachment`, and rather than hardcode
// `None` the binding exposes it, since the WebGPU spec has it too.
//
// The interesting test is the last one. The first three only check that wgpu
// *accepts* or *rejects* the descriptor, and an implementation that ignored the
// caller's value and always passed slice 0 would sail through all three. Only
// rendering distinct colours into distinct slices and reading them back proves
// the number is actually plumbed through.
import { beforeAll, describe, expect, it } from "bun:test";
import {
    GPUTextureUsage,
    type GpuDevice,
    readTexturePixels,
    requestAdapter,
} from "../index.js";

const SIZE = 8;
const DEPTH = 4;

let device: GpuDevice | null = null;

beforeAll(async () => {
    const adapter = await requestAdapter();
    if (!adapter) return;
    device = await adapter.requestDevice({ label: "depth-slice-test" });
});

function volume(dev: GpuDevice) {
    return dev.createTexture({
        size: { width: SIZE, height: SIZE, depthOrArrayLayers: DEPTH },
        dimension: "3d",
        format: "rgba8unorm",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
}

/** Clears one slice of `view` to `color`, returning any validation error. */
async function clearSlice(
    dev: GpuDevice,
    view: ReturnType<GpuDevice["createTexture"]>["createView"] extends never ? never : any,
    depthSlice: number | undefined,
    color: { r: number; g: number; b: number; a: number },
) {
    dev.pushErrorScope("validation");
    const encoder = dev.createCommandEncoder();
    encoder
        .beginRenderPass({
            colorAttachments: [
                { view, depthSlice, loadOp: "clear", storeOp: "store", clearValue: color },
            ],
        })
        .end();
    dev.queue.submit([encoder.finish()]);
    return await dev.popErrorScope();
}

describe("depthSlice", () => {
    it("accepts a 3D view when depthSlice is provided", async () => {
        if (!device) return;
        const view = volume(device).createView({ dimension: "3d" });
        const err = await clearSlice(device, view, 2, { r: 1, g: 0, b: 0, a: 1 });
        expect(err).toBeNull();
    });

    it("rejects a 3D view with no depthSlice", async () => {
        if (!device) return;
        const view = volume(device).createView({ dimension: "3d" });
        const err = await clearSlice(device, view, undefined, { r: 1, g: 0, b: 0, a: 1 });
        expect(err).not.toBeNull();
        expect(err!.message).toMatch(/3D and requires depth slice/i);
    });

    it("rejects a depthSlice on a view that is not 3D", async () => {
        if (!device) return;
        const view = device
            .createTexture({
                size: { width: SIZE, height: SIZE },
                format: "rgba8unorm",
                usage: GPUTextureUsage.RENDER_ATTACHMENT,
            })
            .createView();
        const err = await clearSlice(device, view, 0, { r: 0, g: 0, b: 0, a: 1 });
        expect(err).not.toBeNull();
        expect(err!.message).toMatch(/not 3D/i);
    });

    // The one that matters. Each slice gets a different colour, then each is
    // copied out to its own 2D texture and read back. If `depthSlice` were
    // dropped on the floor (or hardcoded to 0), every slice would come back the
    // colour of whichever clear ran last, and this fails while the three tests
    // above still pass.
    it("renders into the slice it names, not slice 0", async () => {
        if (!device) return;
        const tex = volume(device);
        const view = tex.createView({ dimension: "3d" });

        const colors = [
            { r: 1, g: 0, b: 0, a: 1 }, // slice 0 — red
            { r: 0, g: 1, b: 0, a: 1 }, // slice 1 — green
            { r: 0, g: 0, b: 1, a: 1 }, // slice 2 — blue
            { r: 1, g: 1, b: 0, a: 1 }, // slice 3 — yellow
        ];

        device.pushErrorScope("validation");
        for (let z = 0; z < DEPTH; z++) {
            const encoder = device.createCommandEncoder();
            encoder
                .beginRenderPass({
                    colorAttachments: [
                        {
                            view,
                            depthSlice: z,
                            loadOp: "clear",
                            storeOp: "store",
                            clearValue: colors[z]!,
                        },
                    ],
                })
                .end();
            device.queue.submit([encoder.finish()]);
        }
        expect(await device.popErrorScope()).toBeNull();

        const expected = [
            [255, 0, 0, 255],
            [0, 255, 0, 255],
            [0, 0, 255, 255],
            [255, 255, 0, 255],
        ];

        for (let z = 0; z < DEPTH; z++) {
            // readTexturePixels only handles 2D, so lift the slice out first.
            const flat = device.createTexture({
                size: { width: SIZE, height: SIZE },
                format: "rgba8unorm",
                usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
            });
            const encoder = device.createCommandEncoder();
            encoder.copyTextureToTexture(
                { texture: tex, origin: { x: 0, y: 0, z } },
                { texture: flat },
                { width: SIZE, height: SIZE, depthOrArrayLayers: 1 },
            );
            device.queue.submit([encoder.finish()]);

            const px = await readTexturePixels(device, flat);
            expect([px[0], px[1], px[2], px[3]]).toEqual(expected[z]!);
        }
    });
});
