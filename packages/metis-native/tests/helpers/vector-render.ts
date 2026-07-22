// Minimal offscreen renderer for VectorContext geometry, so vector tests can
// assert on *pixels* rather than index counts. A non-zero index count only
// proves the tessellator emitted something — not that it landed where it should,
// or that a path was closed/left open correctly.
//
// Deliberately self-contained: metis-native is the base package and can't
// depend on metis-engine's VectorText, which does the same job for real.
import {
    GPUBufferUsage,
    type GpuDevice,
    GPUShaderStage,
    type GpuTexture,
    GPUTextureUsage,
    type VectorContext,
} from "../../index.js";

const SHADER = /* wgsl */ `
struct U { size: vec2<f32>, pad: vec2<f32> };
@group(0) @binding(0) var<uniform> u: U;

@vertex
fn vs(@location(0) pos: vec2<f32>, @location(1) uv: vec2<f32>) -> @builtin(position) vec4<f32> {
    // VectorContext works in pixel space, y-down from the top-left; map that to NDC.
    let ndc = vec2<f32>(pos.x / u.size.x * 2.0 - 1.0, 1.0 - pos.y / u.size.y * 2.0);
    return vec4<f32>(ndc, 0.0, 1.0);
}

@fragment
fn fs() -> @location(0) vec4<f32> {
    return vec4<f32>(1.0, 1.0, 1.0, 1.0);
}
`;

export interface VectorRenderer {
    /** Flushes `ctx` and renders every draw call in white on black. Returns RGBA pixels. */
    render(ctx: VectorContext): Promise<Uint8Array>;
    destroy(): void;
}

/** Builds a reusable offscreen renderer at `width` x `height`. */
export function createVectorRenderer(device: GpuDevice, width: number, height: number): VectorRenderer {
    const format = "rgba8unorm" as const;
    const bindGroupLayout = device.createBindGroupLayout({
        entries: [{binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {bindingType: "uniform"}}],
    });
    const module = device.createShaderModule({code: SHADER});
    const pipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({bindGroupLayouts: [bindGroupLayout]}),
        vertex: {
            module,
            entryPoint: "vs",
            buffers: [
                {
                    arrayStride: 16,
                    attributes: [
                        {shaderLocation: 0, offset: 0, format: "float32x2"},
                        {shaderLocation: 1, offset: 8, format: "float32x2"},
                    ],
                },
            ],
        },
        fragment: {module, entryPoint: "fs", targets: [{format}]},
        primitive: {topology: "triangle-list"},
    });

    const uniform = device.createBuffer({size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
    device.queue.writeBuffer(uniform, 0, new Uint8Array(new Float32Array([width, height, 0, 0]).buffer));
    const bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [{binding: 0, buffer: {buffer: uniform}}],
    });

    const target: GpuTexture = device.createTexture({
        size: {width, height},
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });

    return {
        async render(ctx: VectorContext): Promise<Uint8Array> {
            ctx.flush();
            const encoder = device.createCommandEncoder();
            const pass = encoder.beginRenderPass({
                colorAttachments: [
                    {view: target.createView(), loadOp: "clear", storeOp: "store", clearValue: {r: 0, g: 0, b: 0, a: 1}},
                ],
            });
            const calls = ctx.drawCalls;
            if (calls.length > 0) {
                pass.setPipeline(pipeline);
                pass.setBindGroup(0, bindGroup);
                ctx.bindBuffers(pass);
                for (const call of calls) {
                    pass.drawIndexed(call.indexCount, 1, call.firstIndex);
                }
            }
            pass.end();
            device.queue.submit([encoder.finish()]);
            return readback(device, target, width, height);
        },
        destroy() {
            uniform.destroy();
            target.destroy();
        },
    };
}

/** Tight RGBA readback (handles the 256-byte bytesPerRow alignment requirement). */
async function readback(device: GpuDevice, texture: GpuTexture, width: number, height: number): Promise<Uint8Array> {
    const unpadded = width * 4;
    const padded = Math.ceil(unpadded / 256) * 256;
    const buffer = device.createBuffer({
        size: padded * height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer(
        {texture},
        {buffer, bytesPerRow: padded, rowsPerImage: height},
        {width, height, depthOrArrayLayers: 1},
    );
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();

    await buffer.mapAsync(1 /* GPUMapMode.READ */);
    const mapped = buffer.getMappedRange();
    const out = new Uint8Array(unpadded * height);
    for (let y = 0; y < height; y++) {
        out.set(mapped.subarray(y * padded, y * padded + unpadded), y * unpadded);
    }
    buffer.unmap();
    buffer.destroy();
    return out;
}

/** Pixel helpers — geometry is drawn white on black, so "lit" means "covered". */
export function makeProbe(pixels: Uint8Array, width: number) {
    return {
        /** Red channel at (x, y), 0..255. Anti-aliased edges land in between. */
        at(x: number, y: number): number {
            return pixels[(y * width + x) * 4]!;
        },
        /** True when the pixel is solidly covered. */
        lit(x: number, y: number): boolean {
            return pixels[(y * width + x) * 4]! > 128;
        },
        /** True when the pixel is untouched background. */
        dark(x: number, y: number): boolean {
            return pixels[(y * width + x) * 4]! < 32;
        },
        count(): number {
            let n = 0;
            for (let i = 0; i < pixels.length; i += 4) {
                if (pixels[i]! > 128) {
                    n++;
                }
            }
            return n;
        },
        /** Tight bounding box of lit pixels, or null if nothing was drawn. */
        bounds(): {minX: number; minY: number; maxX: number; maxY: number} | null {
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            const height = pixels.length / 4 / width;
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    if (pixels[(y * width + x) * 4]! > 128) {
                        minX = Math.min(minX, x);
                        minY = Math.min(minY, y);
                        maxX = Math.max(maxX, x);
                        maxY = Math.max(maxY, y);
                    }
                }
            }
            return minX === Infinity ? null : {minX, minY, maxX, maxY};
        },
    };
}
