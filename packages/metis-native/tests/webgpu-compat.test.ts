// Coverage for the WebGPU-spec compatibility layer (webgpu.js) — the package's
// public entry. Imports through ../webgpu.js (not ../index.js) so the JS
// augmentations are in effect.
import { beforeAll, describe, expect, it } from "bun:test";
import {
    type GpuAdapter,
    type GpuDevice,
    GPUBufferUsage,
    GPUError,
    GPUTextureUsage,
    GPUValidationError,
    requestAdapter,
} from "../webgpu.js";

let adapter: GpuAdapter | null = null;
let device: GpuDevice | null = null;

beforeAll(async () => {
    adapter = await requestAdapter();
    if (adapter) {
        device = await adapter.requestDevice({ label: "compat-device" });
    }
});

describe("labels are read-write on resources", () => {
    it("buffer/texture/shader labels round-trip and are settable", () => {
        if (!device) return;

        const buf = device.createBuffer({ label: "vtx", size: 16, usage: GPUBufferUsage.COPY_SRC });
        expect(buf.label).toBe("vtx");
        buf.label = "renamed";
        expect(buf.label).toBe("renamed");
        buf.destroy();

        const tex = device.createTexture({
            label: "tex",
            size: { width: 4, height: 4 },
            format: "rgba8unorm",
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        expect(tex.label).toBe("tex");
        const view = tex.createView({ label: "view" });
        expect(view.label).toBe("view");
        tex.destroy();

        const shader = device.createShaderModule({ label: "sh", code: "@compute @workgroup_size(1) fn main() {}" });
        expect(shader.label).toBe("sh");
        shader.label = "sh2";
        expect(shader.label).toBe("sh2");
    });
});

describe("GPUError subclasses", () => {
    it("popErrorScope resolves a GPUValidationError instance on a validation error", async () => {
        if (!device) return;
        device.pushErrorScope("validation");
        // Provoke a validation error: a bad WGSL shader module.
        device.createShaderModule({ code: "this is not valid wgsl" });
        const err = await device.popErrorScope();
        expect(err).not.toBeNull();
        expect(err instanceof GPUValidationError).toBe(true);
        expect(err instanceof GPUError).toBe(true);
        expect(typeof err!.message).toBe("string");
        expect(err!.type).toBe("validation"); // retained convenience
    });

    it("popErrorScope resolves null when the scope is clean", async () => {
        if (!device) return;
        device.pushErrorScope("validation");
        expect(await device.popErrorScope()).toBeNull();
    });
});

describe("GpuSupportedFeatures is iterable", () => {
    it("for...of and spread work over device.features", () => {
        if (!device) return;
        const viaSpread = [...device.features];
        const viaKeys = device.features.keys();
        expect(viaSpread.sort()).toEqual([...viaKeys].sort());
        let count = 0;
        for (const _ of device.features) count++;
        expect(count).toBe(device.features.size);
    });
});

describe("device.lost + uncapturederror", () => {
    it("device.lost is a stable, memoized promise", () => {
        if (!device) return;
        expect(device.lost).toBe(device.lost);
    });

    it("onuncapturederror is readable after being set", () => {
        if (!device) return;
        const handler = () => {};
        device.onuncapturederror = handler;
        expect(device.onuncapturederror).toBe(handler);
        device.onuncapturederror = null as unknown as typeof handler;
        expect(device.onuncapturederror).toBeNull();
    });

    it("addEventListener('uncapturederror') is present", () => {
        if (!device) return;
        expect(typeof device.addEventListener).toBe("function");
        expect(typeof device.removeEventListener).toBe("function");
    });
});
