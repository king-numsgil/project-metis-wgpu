// Renders a texture to an offscreen rgba8unorm target so tests can assert on
// **pixels**. This is the only way to inspect a block-compressed texture:
// `readTexturePixels` rejects BC formats on purpose (undoing the block encoding
// would mean shipping a BC decoder), so sampling it through a pipeline and
// reading back the *result* is the supported route.
//
// Why it matters for the KTX2 loader: without sampling, a test can only observe
// that a `GpuTexture` came back with plausible dimensions and that no validation
// error fired. That cannot catch mip levels uploaded into the wrong slots, or
// block data landing at the wrong offset — the bytes are never looked at. This
// helper makes the content observable, one mip level at a time.
//
// Same shape and rationale as `vector-render.ts` next door.
import {
    GPUBufferUsage,
    type GpuDevice,
    GPUShaderStage,
    type GpuTexture,
    GPUTextureUsage,
    readTexturePixels,
} from "../../index.js";

const SHADER = /* wgsl */ `
@group(0) @binding(0) var t: texture_2d<f32>;
@group(0) @binding(1) var s: sampler;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    // Oversized triangle covering the viewport — no vertex buffer needed.
    var p = array<vec2<f32>, 3>(vec2(-1.0, -3.0), vec2(-1.0, 1.0), vec2(3.0, 1.0));
    return vec4<f32>(p[i], 0.0, 1.0);
}

struct U { size: vec2<f32>, pad: vec2<f32> };
@group(0) @binding(2) var<uniform> u: U;

@fragment
fn fs(@builtin(position) c: vec4<f32>) -> @location(0) vec4<f32> {
    // The bound view has exactly one mip level, so LOD 0 is that level.
    return textureSampleLevel(t, s, c.xy / u.size, 0.0);
}
`;

export interface TextureRenderer {
    /**
     * Samples `texture` at mip `level`, stretched across the full output, and
     * returns tight RGBA8 pixels of the result.
     *
     * The output is always the renderer's own size regardless of which mip is
     * sampled, so a 1x1 mip comes back as a uniform image — which makes "the
     * last mip is flat grey" a direct assertion.
     */
    sample(texture: GpuTexture, level?: number): Promise<Uint8Array>;
    destroy(): void;
}

export function createTextureRenderer(device: GpuDevice, width: number, height: number): TextureRenderer {
    const bindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { bindingType: "uniform" } },
        ],
    });
    const module = device.createShaderModule({ code: SHADER });
    const pipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint: "fs", targets: [{ format: "rgba8unorm" }] },
        primitive: { topology: "triangle-list" },
    });

    // GPUBufferUsage, not GPUTextureUsage — both define COPY_DST with different
    // values, and mixing them here silently requests MAP_WRITE instead.
    const uniform = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    });
    // writeBuffer takes raw bytes: view the floats, don't convert them (this
    // repo has lost a session to `new Float32Array(u8)` converting *values*).
    const dims = new Float32Array([width, height, 0, 0]);
    device.queue.writeBuffer(uniform, 0, new Uint8Array(dims.buffer));

    // Nearest filtering: a linear filter would blend across quadrant edges and
    // turn exact colour assertions into approximate ones for no benefit.
    const sampler = device.createSampler({ magFilter: "nearest", minFilter: "nearest" });

    const target = device.createTexture({
        label: "texture-render-target",
        size: { width, height },
        format: "rgba8unorm",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });

    return {
        async sample(texture, level = 0) {
            // A single-level view, so the shader's LOD 0 is the level asked for.
            const view = texture.createView({ baseMipLevel: level, mipLevelCount: 1 });
            const bindGroup = device.createBindGroup({
                layout: bindGroupLayout,
                entries: [
                    { binding: 0, textureView: view },
                    { binding: 1, sampler },
                    { binding: 2, buffer: { buffer: uniform } },
                ],
            });
            const encoder = device.createCommandEncoder();
            const pass = encoder.beginRenderPass({
                colorAttachments: [
                    {
                        view: target.createView(),
                        loadOp: "clear",
                        storeOp: "store",
                        clearValue: { r: 0, g: 0, b: 0, a: 1 },
                    },
                ],
            });
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, bindGroup);
            pass.draw(3);
            pass.end();
            device.queue.submit([encoder.finish()]);
            return await readTexturePixels(device, target);
        },
        destroy() {
            target.destroy();
            uniform.destroy();
        },
    };
}

/** RGB triple at `(x, y)` in a tight RGBA8 buffer of row length `width`. */
export function pixelAt(px: Uint8Array, width: number, x: number, y: number): [number, number, number] {
    const i = (y * width + x) * 4;
    return [px[i] as number, px[i + 1] as number, px[i + 2] as number];
}
