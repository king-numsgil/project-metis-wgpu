import { beforeAll, describe, expect, it } from "bun:test";
import {
    type GpuAdapter,
    GPUBufferUsage,
    type GpuDevice,
    GPUMapMode,
    GPUShaderStage,
    GPUTextureUsage,
    requestAdapter,
} from "../index.js";

let adapter: GpuAdapter | null = null;
let device: GpuDevice | null = null;

beforeAll(async () => {
    adapter = await requestAdapter();
    if (adapter) {
        device = await adapter.requestDevice({label: "test-device"});
    }
});

// ── Adapter ───────────────────────────────────────────────────────────────────

describe("requestAdapter", () => {
    it("returns an adapter or null", async () => {
        const a = await requestAdapter();
        // null is a valid result on headless CI without a GPU
        expect(a === null || typeof a === "object").toBe(true);
    });

    it("adapter has a spec-compliant setlike features collection", () => {
        if (!adapter) {
            return;
        }
        // GPUSupportedFeatures is setlike (has/size/keys), not an Array — mirror the WebGPU spec.
        const features = adapter.features;
        expect(typeof features.size).toBe("number");
        expect(typeof features.has).toBe("function");
        expect(Array.isArray(features.keys())).toBe(true);
        expect(features.has("__definitely_not_a_real_feature__")).toBe(false);
    });

    it("adapter has limits object", () => {
        if (!adapter) {
            return;
        }
        const l = adapter.limits;
        expect(typeof l.maxTextureDimension2D).toBe("number");
        expect(l.maxTextureDimension2D).toBeGreaterThan(0);
    });

    it("adapter has info", () => {
        if (!adapter) {
            return;
        }
        const info = adapter.info;
        expect(typeof info.vendor).toBe("string");
        expect(typeof info.backendType).toBe("string");
    });

    it("accepts power preference low-power", async () => {
        const a = await requestAdapter({powerPreference: "low-power"});
        expect(a === null || typeof a === "object").toBe(true);
    });

    it("accepts power preference high-performance", async () => {
        const a = await requestAdapter({powerPreference: "high-performance"});
        expect(a === null || typeof a === "object").toBe(true);
    });
});

// ── Device ────────────────────────────────────────────────────────────────────

describe("requestDevice", () => {
    it("returns a device", () => {
        if (!adapter) {
            return;
        }
        expect(device).not.toBeNull();
    });

    it("device has label", () => {
        if (!device) {
            return;
        }
        expect(device.label).toBe("test-device");
    });

    it("device has queue", () => {
        if (!device) {
            return;
        }
        expect(device.queue).toBeDefined();
    });

    it("device has limits", () => {
        if (!device) {
            return;
        }
        expect(device.limits.maxComputeWorkgroupsPerDimension).toBeGreaterThan(0);
    });

    it("device.poll returns boolean", () => {
        if (!device) {
            return;
        }
        const result = device.poll();
        expect(typeof result).toBe("boolean");
    });
});

// ── Buffer ────────────────────────────────────────────────────────────────────

describe("GPUBuffer", () => {
    it("creates a buffer", () => {
        if (!device) {
            return;
        }
        const buf = device.createBuffer({
            size: 256,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
        expect(buf).toBeDefined();
        expect(buf.size).toBe(256);
        expect(buf.mapState).toBe("unmapped");
        buf.destroy();
    });

    it("creates a mapped-at-creation buffer and writes", () => {
        if (!device) {
            return;
        }
        const buf = device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.COPY_SRC,
            mappedAtCreation: true,
        });
        expect(buf.mapState).toBe("mapped");
        const data = new Uint8Array([1, 2, 3, 4]);
        buf.writeMappedRange(data, 0);
        buf.unmap();
        expect(buf.mapState).toBe("unmapped");
        buf.destroy();
    });

    it("maps a buffer for reading", async () => {
        if (!device) {
            return;
        }
        const size = 64;
        const src = device.createBuffer({
            size,
            usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.MAP_WRITE,
            mappedAtCreation: true,
        });
        const initData = new Uint8Array(size).fill(42);
        src.writeMappedRange(initData);
        src.unmap();

        const dst = device.createBuffer({
            size,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });

        const encoder = device.createCommandEncoder();
        encoder.copyBufferToBuffer(src, 0, dst, 0, size);
        const cmdBuf = encoder.finish();
        device.queue.submit([cmdBuf]);

        await dst.mapAsync(GPUMapMode.READ);
        const result = dst.getMappedRange();
        expect(result).toBeInstanceOf(Uint8Array);
        expect(result[0]).toBe(42);
        expect(result[size - 1]).toBe(42);
        dst.unmap();

        src.destroy();
        dst.destroy();
    });
});

// ── Texture ───────────────────────────────────────────────────────────────────

describe("GPUTexture", () => {
    it("creates a 2D RGBA texture", () => {
        if (!device) {
            return;
        }
        const tex = device.createTexture({
            size: {width: 64, height: 64},
            format: "rgba8unorm",
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        expect(tex.width).toBe(64);
        expect(tex.height).toBe(64);
        expect(tex.format).toBe("rgba8unorm");
        expect(tex.dimension).toBe("2d");
        tex.destroy();
    });

    it("creates a texture view", () => {
        if (!device) {
            return;
        }
        const tex = device.createTexture({
            size: {width: 4, height: 4},
            format: "rgba8unorm",
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        const view = tex.createView();
        expect(view).toBeDefined();
        tex.destroy();
    });
});

// ── Sampler ───────────────────────────────────────────────────────────────────

describe("GPUSampler", () => {
    it("creates a default sampler", () => {
        if (!device) {
            return;
        }
        const s = device.createSampler();
        expect(s).toBeDefined();
    });

    it("creates a sampler with options", () => {
        if (!device) {
            return;
        }
        const s = device.createSampler({
            magFilter: "linear",
            minFilter: "linear",
            addressModeU: "repeat",
            compare: "less",
        });
        expect(s).toBeDefined();
    });
});

// ── Shader module ─────────────────────────────────────────────────────────────

const COMPUTE_SHADER = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> output: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  output[gid.x] = f32(gid.x) * 2.0;
}
`;

describe("GPUShaderModule", () => {
    it("creates a shader module", () => {
        if (!device) {
            return;
        }
        const m = device.createShaderModule({code: COMPUTE_SHADER});
        expect(m).toBeDefined();
    });

    it("getCompilationInfo returns messages array", async () => {
        if (!device) {
            return;
        }
        const m = device.createShaderModule({code: COMPUTE_SHADER});
        const info = await m.getCompilationInfo();
        expect(Array.isArray(info.messages)).toBe(true);
        // Valid shader should have no errors
        const errors = info.messages.filter((m) => (m as any).type === "error");
        expect(errors).toHaveLength(0);
    });

    it("reports errors for invalid WGSL", async () => {
        if (!device) {
            return;
        }
        const m = device.createShaderModule({code: "this is not wgsl"});
        const info = await m.getCompilationInfo();
        expect(info.messages.length).toBeGreaterThan(0);
        expect(info.messages.some((msg) => (msg as any).type === "error")).toBe(true);
    });
});

// ── Compute pipeline ──────────────────────────────────────────────────────────

describe("GPUComputePipeline", () => {
    it("creates a compute pipeline with auto layout", () => {
        if (!device) {
            return;
        }
        const module = device.createShaderModule({code: COMPUTE_SHADER});
        const pipeline = device.createComputePipeline({
            layout: "auto",
            compute: {module, entryPoint: "main"},
        });
        expect(pipeline).toBeDefined();
    });

    it("getBindGroupLayout returns a layout", () => {
        if (!device) {
            return;
        }
        const module = device.createShaderModule({code: COMPUTE_SHADER});
        const pipeline = device.createComputePipeline({
            layout: "auto",
            compute: {module, entryPoint: "main"},
        });
        const layout = pipeline.getBindGroupLayout(0);
        expect(layout).toBeDefined();
    });

    it("runs a compute shader end-to-end", async () => {
        if (!device) {
            return;
        }

        const N = 64;
        const byteSize = N * 4;

        const module = device.createShaderModule({code: COMPUTE_SHADER});
        const pipeline = device.createComputePipeline({
            layout: "auto",
            compute: {module, entryPoint: "main"},
        });

        const storageBuffer = device.createBuffer({
            size: byteSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        const readBuffer = device.createBuffer({
            size: byteSize,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });

        const bgl = pipeline.getBindGroupLayout(0);
        const bindGroup = device.createBindGroup({
            layout: bgl,
            entries: [{binding: 0, buffer: {buffer: storageBuffer}}],
        });

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(1);
        pass.end();
        encoder.copyBufferToBuffer(storageBuffer, 0, readBuffer, 0, byteSize);
        device.queue.submit([encoder.finish()]);

        await readBuffer.mapAsync(GPUMapMode.READ);
        const raw = readBuffer.getMappedRange();
        const floats = new Float32Array(raw.buffer, raw.byteOffset, N);
        expect(floats[0]).toBe(0);
        expect(floats[1]).toBe(2);
        expect(floats[63]).toBe(126);
        readBuffer.unmap();

        storageBuffer.destroy();
        readBuffer.destroy();
    });
});

// ── Command encoder ───────────────────────────────────────────────────────────

describe("GPUCommandEncoder", () => {
    it("creates an encoder and finishes it", () => {
        if (!device) {
            return;
        }
        const enc = device.createCommandEncoder({label: "test-enc"});
        expect(enc.label).toBe("test-enc");
        const buf = enc.finish();
        expect(buf).toBeDefined();
    });

    it("copies buffer to buffer", () => {
        if (!device) {
            return;
        }
        const src = device.createBuffer({size: 16, usage: GPUBufferUsage.COPY_SRC, mappedAtCreation: true});
        src.writeMappedRange(new Uint8Array(16).fill(7));
        src.unmap();
        const dst = device.createBuffer({size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
        const enc = device.createCommandEncoder();
        enc.copyBufferToBuffer(src, 0, dst, 0, 16);
        device.queue.submit([enc.finish()]);
        src.destroy();
        dst.destroy();
    });

    it("clears a buffer", () => {
        if (!device) {
            return;
        }
        const buf = device.createBuffer({size: 64, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC});
        const enc = device.createCommandEncoder();
        enc.clearBuffer(buf, 0, 64);
        device.queue.submit([enc.finish()]);
        buf.destroy();
    });
});

// ── Query set ─────────────────────────────────────────────────────────────────

describe("GPUQuerySet", () => {
    it("creates an occlusion query set", () => {
        if (!device) {
            return;
        }
        const qs = device.createQuerySet({type: "occlusion", count: 4});
        expect(qs.type).toBe("occlusion");
        expect(qs.count).toBe(4);
        qs.destroy();
    });
});

// ── Queue ─────────────────────────────────────────────────────────────────────

describe("GPUQueue", () => {
    it("writeBuffer works", async () => {
        if (!device) {
            return;
        }
        const buf = device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        const data = new Uint8Array([10, 20, 30, 40]);
        device.queue.writeBuffer(buf, 0, data);
        await device.queue.onSubmittedWorkDone();
        await buf.mapAsync(GPUMapMode.READ);
        const result = buf.getMappedRange(0, 4);
        expect(result[0]).toBe(10);
        expect(result[3]).toBe(40);
        buf.unmap();
        buf.destroy();
    });
});

// ── Flag constants ────────────────────────────────────────────────────────────

describe("flag constants", () => {
    it("GPUBufferUsage has expected values", () => {
        expect(GPUBufferUsage.MAP_READ).toBe(0x0001);
        expect(GPUBufferUsage.VERTEX).toBe(0x0020);
        expect(GPUBufferUsage.UNIFORM).toBe(0x0040);
        expect(GPUBufferUsage.STORAGE).toBe(0x0080);
    });

    it("GPUTextureUsage has expected values", () => {
        expect(GPUTextureUsage.RENDER_ATTACHMENT).toBe(0x10);
        expect(GPUTextureUsage.TEXTURE_BINDING).toBe(0x04);
    });

    it("GPUShaderStage has expected values", () => {
        expect(GPUShaderStage.VERTEX).toBe(0x1);
        expect(GPUShaderStage.FRAGMENT).toBe(0x2);
        expect(GPUShaderStage.COMPUTE).toBe(0x4);
    });

    it("GPUMapMode has expected values", () => {
        expect(GPUMapMode.READ).toBe(0x1);
        expect(GPUMapMode.WRITE).toBe(0x2);
    });
});

// ── WebGPU spec compliance ────────────────────────────────────────────────────

describe("WebGPU spec compliance", () => {
    it("GPUAdapterInfo has isFallbackAdapter", () => {
        if (!adapter) {
            return;
        }
        expect(typeof adapter.info.isFallbackAdapter).toBe("boolean");
    });

    it("device.adapterInfo returns adapter info", () => {
        if (!device) {
            return;
        }
        const info = device.adapterInfo;
        expect(typeof info.vendor).toBe("string");
        expect(typeof info.isFallbackAdapter).toBe("boolean");
    });

    it("GPUQuerySetDescriptor uses type field", () => {
        if (!device) {
            return;
        }
        const qs = device.createQuerySet({type: "occlusion", count: 2});
        expect(qs.type).toBe("occlusion");
        qs.destroy();
    });

    it("GPUCompilationMessage has type field", async () => {
        if (!device) {
            return;
        }
        const m = device.createShaderModule({code: "bad wgsl"});
        const info = await m.getCompilationInfo();
        const msg = info.messages[0];
        expect(msg).toBeDefined();
        expect((msg as any).type).toBeDefined();
        expect(["error", "warning", "info"].includes((msg as any).type)).toBe(true);
    });

    it("pipeline layout \"auto\" string works", () => {
        if (!device) {
            return;
        }
        const module = device.createShaderModule({code: COMPUTE_SHADER});
        const pipeline = device.createComputePipeline({
            layout: "auto",
            compute: {module, entryPoint: "main"},
        });
        expect(pipeline).toBeDefined();
    });

    it("GPUBufferUsage flag values match spec", () => {
        expect(GPUBufferUsage.MAP_READ).toBe(0x0001);
        expect(GPUBufferUsage.MAP_WRITE).toBe(0x0002);
        expect(GPUBufferUsage.COPY_SRC).toBe(0x0004);
        expect(GPUBufferUsage.COPY_DST).toBe(0x0008);
        expect(GPUBufferUsage.INDEX).toBe(0x0010);
        expect(GPUBufferUsage.VERTEX).toBe(0x0020);
        expect(GPUBufferUsage.UNIFORM).toBe(0x0040);
        expect(GPUBufferUsage.STORAGE).toBe(0x0080);
        expect(GPUBufferUsage.INDIRECT).toBe(0x0100);
        expect(GPUBufferUsage.QUERY_RESOLVE).toBe(0x0200);
    });

    it("GPUTextureUsage flag values match spec", () => {
        expect(GPUTextureUsage.COPY_SRC).toBe(0x01);
        expect(GPUTextureUsage.COPY_DST).toBe(0x02);
        expect(GPUTextureUsage.TEXTURE_BINDING).toBe(0x04);
        expect(GPUTextureUsage.STORAGE_BINDING).toBe(0x08);
        expect(GPUTextureUsage.RENDER_ATTACHMENT).toBe(0x10);
        expect(GPUTextureUsage.TRANSIENT_ATTACHMENT).toBe(0x20);
    });

    it("GPUShaderStage flag values match spec", () => {
        expect(GPUShaderStage.VERTEX).toBe(0x1);
        expect(GPUShaderStage.FRAGMENT).toBe(0x2)
        expect(GPUShaderStage.COMPUTE).toBe(0x4)
    })

    it('GPUMapMode flag values match spec', () => {
        expect(GPUMapMode.READ).toBe(0x1)
        expect(GPUMapMode.WRITE).toBe(0x2)
    })

    it('GPUBuffer.mapState returns spec string values', async () => {
        if (!device) {
            return
        }
        const buf = device.createBuffer({size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST})
        expect(buf.mapState).toBe('unmapped')
        await buf.mapAsync(GPUMapMode.READ)
        expect(buf.mapState).toBe('mapped')
        buf.unmap()
        expect(buf.mapState).toBe('unmapped')
        buf.destroy()
    })
})
