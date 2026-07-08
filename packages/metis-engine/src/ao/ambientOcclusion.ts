import {
    type GpuBindGroup,
    type GpuBindGroupLayout,
    type GpuBuffer,
    type GpuCommandEncoder,
    type GpuDevice,
    type GpuRenderPipeline,
    type GpuTexture,
    type GpuTextureView,
    GPUBufferUsage,
    GPUShaderStage,
    GPUTextureUsage,
} from "bun-webgpu-rs";
import { mat4 } from "wgpu-matrix";
import aoBlurWgsl from "./wgsl/ao_blur.wgsl" with { type: "text" };
import aoPrepassWgsl from "./wgsl/ao_prepass.wgsl" with { type: "text" };
import hbaoWgsl from "./wgsl/hbao.wgsl" with { type: "text" };
import ssaoWgsl from "./wgsl/ssao.wgsl" with { type: "text" };
import { MESH_VERTEX_LAYOUT } from "../scene/mesh";
import type { RenderTargets } from "../rhi/targets";
import type { Scene } from "../scene/scene";
import { Std140Writer } from "../shading/std140";
import {
    AO_NOISE_DIM,
    AoTechnique,
    type AoTuning,
    HBAO_DEFAULTS,
    SSAO_DEFAULTS,
    SSAO_KERNEL_SIZE,
} from "./aoConfig";
import { generateAoNoise, generateSsaoKernel } from "./aoKernel";

const NORMAL_FORMAT = "rgba16float" as const;
const DEPTH_FORMAT = "depth32float" as const;
const AO_FORMAT = "r8unorm" as const;

const AO_UNIFORMS_SIZE = 288; // 4 * mat4 (256) + 2 * vec4 (32)
const KERNEL_BUFFER_SIZE = SSAO_KERNEL_SIZE * 16; // vec4 per sample
const NOISE_BUFFER_SIZE = AO_NOISE_DIM * AO_NOISE_DIM * 16; // vec4 per texel

/**
 * Screen-space ambient occlusion subsystem, owned by `ClusteredForwardRenderer`.
 * Runs three passes when active: a geometry prepass (view-space normals +
 * depth), the selected AO technique (SSAO or HBAO) into a raw occlusion buffer,
 * and a box blur into `resultView`, which the forward pass multiplies into its
 * ambient term. See math/Ambient occlusion formulas.md.
 *
 * The `None` technique produces no passes — the renderer clears `resultView` to
 * white (`clearToWhite`) so the forward shader can multiply unconditionally.
 */
export class AmbientOcclusion {
    private readonly device: GpuDevice;

    private _technique: AoTechnique = AoTechnique.None;
    /** Occlusion radius (world units), self-occlusion bias, strength, and contrast — seeded per technique; see aoConfig.ts. */
    radius = SSAO_DEFAULTS.radius;
    bias = SSAO_DEFAULTS.bias;
    intensity = SSAO_DEFAULTS.intensity;
    power = SSAO_DEFAULTS.power;

    get technique(): AoTechnique {
        return this._technique;
    }
    /** Switching technique reseeds the tunable fields with that technique's defaults (they mean different things per technique — the bias especially). */
    set technique(t: AoTechnique) {
        this._technique = t;
        const defaults: AoTuning | null = t === AoTechnique.SSAO ? SSAO_DEFAULTS : t === AoTechnique.HBAO ? HBAO_DEFAULTS : null;
        if (defaults) {
            this.radius = defaults.radius;
            this.bias = defaults.bias;
            this.intensity = defaults.intensity;
            this.power = defaults.power;
        }
    }

    private width = 0;
    private height = 0;

    // Resized targets.
    private normalTex!: GpuTexture;
    private normalView!: GpuTextureView;
    private depthTex!: GpuTexture;
    private depthView!: GpuTextureView;
    private aoRawTex!: GpuTexture;
    private aoRawView!: GpuTextureView;
    private aoResultTex!: GpuTexture;
    private aoResultView!: GpuTextureView;

    // Static resources.
    private readonly uniforms: GpuBuffer;
    private readonly kernelBuffer: GpuBuffer;
    private readonly noiseBuffer: GpuBuffer;

    private readonly prepassPipeline: GpuRenderPipeline;
    private readonly ssaoPipeline: GpuRenderPipeline;
    private readonly hbaoPipeline: GpuRenderPipeline;
    private readonly blurPipeline: GpuRenderPipeline;

    private readonly prepassCameraLayout: GpuBindGroupLayout;
    private readonly prepassCameraBindGroup: GpuBindGroup;
    private readonly modelBindGroupLayout: GpuBindGroupLayout;
    private readonly samplingLayout: GpuBindGroupLayout;
    private readonly blurLayout: GpuBindGroupLayout;

    // Rebuilt on resize (they reference the sized textures).
    private samplingBindGroup!: GpuBindGroup;
    private blurBindGroup!: GpuBindGroup;

    constructor(device: GpuDevice, modelBindGroupLayout: GpuBindGroupLayout) {
        this.device = device;
        this.modelBindGroupLayout = modelBindGroupLayout;

        this.uniforms = device.createBuffer({
            label: "metis-engine/ao-uniforms",
            size: AO_UNIFORMS_SIZE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.kernelBuffer = device.createBuffer({
            label: "metis-engine/ao-ssao-kernel",
            size: KERNEL_BUFFER_SIZE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.noiseBuffer = device.createBuffer({
            label: "metis-engine/ao-noise",
            size: NOISE_BUFFER_SIZE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(this.kernelBuffer, 0, u8(generateSsaoKernel(SSAO_KERNEL_SIZE)));
        device.queue.writeBuffer(this.noiseBuffer, 0, u8(generateAoNoise(AO_NOISE_DIM)));

        // ── Geometry prepass pipeline ───────────────────────────────────────
        this.prepassCameraLayout = device.createBindGroupLayout({
            label: "metis-engine/ao-prepass-camera-bgl",
            entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { bindingType: "uniform" } }],
        });
        this.prepassCameraBindGroup = device.createBindGroup({
            label: "metis-engine/ao-prepass-camera-bind-group",
            layout: this.prepassCameraLayout,
            entries: [{ binding: 0, buffer: { buffer: this.uniforms } }],
        });
        const prepassModule = device.createShaderModule({ label: "metis-engine/ao-prepass-shader", code: aoPrepassWgsl });
        this.prepassPipeline = device.createRenderPipeline({
            label: "metis-engine/ao-prepass-pipeline",
            layout: device.createPipelineLayout({ bindGroupLayouts: [this.prepassCameraLayout, modelBindGroupLayout] }),
            vertex: { module: prepassModule, entryPoint: "vs", buffers: [MESH_VERTEX_LAYOUT] },
            fragment: { module: prepassModule, entryPoint: "fs", targets: [{ format: NORMAL_FORMAT }] },
            primitive: { topology: "triangle-list", cullMode: "back" },
            depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: "less" },
        });

        // ── AO sampling pipelines (SSAO / HBAO) ─────────────────────────────
        this.samplingLayout = device.createBindGroupLayout({
            label: "metis-engine/ao-sampling-bgl",
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { bindingType: "uniform" } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "depth" } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } },
                { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { bindingType: "uniform" } },
                { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { bindingType: "uniform" } },
            ],
        });
        const samplingPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [this.samplingLayout] });
        const ssaoModule = device.createShaderModule({ label: "metis-engine/ssao-shader", code: ssaoWgsl });
        this.ssaoPipeline = device.createRenderPipeline({
            label: "metis-engine/ssao-pipeline",
            layout: samplingPipelineLayout,
            vertex: { module: ssaoModule, entryPoint: "vs" },
            fragment: { module: ssaoModule, entryPoint: "fs", targets: [{ format: AO_FORMAT }] },
            primitive: { topology: "triangle-list" },
        });
        const hbaoModule = device.createShaderModule({ label: "metis-engine/hbao-shader", code: hbaoWgsl });
        this.hbaoPipeline = device.createRenderPipeline({
            label: "metis-engine/hbao-pipeline",
            layout: samplingPipelineLayout,
            vertex: { module: hbaoModule, entryPoint: "vs" },
            fragment: { module: hbaoModule, entryPoint: "fs", targets: [{ format: AO_FORMAT }] },
            primitive: { topology: "triangle-list" },
        });

        // ── Blur pipeline ───────────────────────────────────────────────────
        this.blurLayout = device.createBindGroupLayout({
            label: "metis-engine/ao-blur-bgl",
            entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } }],
        });
        const blurModule = device.createShaderModule({ label: "metis-engine/ao-blur-shader", code: aoBlurWgsl });
        this.blurPipeline = device.createRenderPipeline({
            label: "metis-engine/ao-blur-pipeline",
            layout: device.createPipelineLayout({ bindGroupLayouts: [this.blurLayout] }),
            vertex: { module: blurModule, entryPoint: "vs" },
            fragment: { module: blurModule, entryPoint: "fs", targets: [{ format: AO_FORMAT }] },
            primitive: { topology: "triangle-list" },
        });
    }

    /** The blurred occlusion factor (r8unorm), sampled by the forward pass. Valid after the first `ensureSize`. */
    get resultView(): GpuTextureView {
        return this.aoResultView;
    }

    /** (Re)allocates the screen-sized targets when the viewport changes. */
    ensureSize(width: number, height: number) {
        if (width === this.width && height === this.height && this.normalTex) return;
        this.destroyTextures();
        this.width = width;
        this.height = height;
        const size = { width, height };

        this.normalTex = this.device.createTexture({
            label: "metis-engine/ao-view-normal",
            size,
            format: NORMAL_FORMAT,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        this.normalView = this.normalTex.createView();
        this.depthTex = this.device.createTexture({
            label: "metis-engine/ao-prepass-depth",
            size,
            format: DEPTH_FORMAT,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        this.depthView = this.depthTex.createView();
        this.aoRawTex = this.device.createTexture({
            label: "metis-engine/ao-raw",
            size,
            format: AO_FORMAT,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        this.aoRawView = this.aoRawTex.createView();
        this.aoResultTex = this.device.createTexture({
            label: "metis-engine/ao-result",
            size,
            format: AO_FORMAT,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        this.aoResultView = this.aoResultTex.createView();

        this.samplingBindGroup = this.device.createBindGroup({
            label: "metis-engine/ao-sampling-bind-group",
            layout: this.samplingLayout,
            entries: [
                { binding: 0, buffer: { buffer: this.uniforms } },
                { binding: 1, textureView: this.depthView },
                { binding: 2, textureView: this.normalView },
                { binding: 3, buffer: { buffer: this.kernelBuffer } },
                { binding: 4, buffer: { buffer: this.noiseBuffer } },
            ],
        });
        this.blurBindGroup = this.device.createBindGroup({
            label: "metis-engine/ao-blur-bind-group",
            layout: this.blurLayout,
            entries: [{ binding: 0, textureView: this.aoRawView }],
        });
    }

    private writeUniforms(scene: Scene) {
        const proj = scene.camera.projectionMatrix();
        const w = new Std140Writer();
        w.mat4(scene.camera.viewMatrix());
        w.mat4(scene.camera.viewProjectionMatrix());
        w.mat4(proj);
        w.mat4(mat4.invert(proj));
        w.vec4(this.width, this.height, scene.camera.near, scene.camera.far);
        w.vec4(this.radius, this.bias, this.intensity, this.power);
        this.device.queue.writeBuffer(this.uniforms, 0, w.toBytes());
    }

    /** Clears `resultView` to white (fully open) — used when the technique is `None`. */
    clearToWhite(encoder: GpuCommandEncoder) {
        const pass = encoder.beginRenderPass({
            label: "metis-engine/ao-clear",
            colorAttachments: [
                { view: this.aoResultView, loadOp: "clear", storeOp: "store", clearValue: { r: 1, g: 1, b: 1, a: 1 } },
            ],
        });
        pass.end();
    }

    /** Runs the prepass + selected AO technique + blur, leaving the result in `resultView`. Assumes `technique !== None`. */
    render(encoder: GpuCommandEncoder, scene: Scene, _targets: RenderTargets) {
        this.writeUniforms(scene);

        // Geometry prepass -> view-space normals + depth.
        const prepass = encoder.beginRenderPass({
            label: "metis-engine/ao-prepass",
            colorAttachments: [
                { view: this.normalView, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } },
            ],
            depthStencilAttachment: {
                view: this.depthView,
                depthLoadOp: "clear",
                depthStoreOp: "store",
                depthClearValue: 1.0,
            },
        });
        prepass.setPipeline(this.prepassPipeline);
        prepass.setBindGroup(0, this.prepassCameraBindGroup);
        for (const instance of scene.instances) {
            prepass.setBindGroup(1, instance.getModelBindGroup(this.device, this.modelBindGroupLayout));
            instance.mesh.bind(prepass);
            instance.mesh.draw(prepass);
        }
        prepass.end();

        // Occlusion pass -> raw AO.
        const aoPass = encoder.beginRenderPass({
            label: "metis-engine/ao-compute",
            colorAttachments: [
                { view: this.aoRawView, loadOp: "clear", storeOp: "store", clearValue: { r: 1, g: 1, b: 1, a: 1 } },
            ],
        });
        aoPass.setPipeline(this._technique === AoTechnique.HBAO ? this.hbaoPipeline : this.ssaoPipeline);
        aoPass.setBindGroup(0, this.samplingBindGroup);
        aoPass.draw(3);
        aoPass.end();

        // Denoise blur -> result.
        const blur = encoder.beginRenderPass({
            label: "metis-engine/ao-blur",
            colorAttachments: [
                { view: this.aoResultView, loadOp: "clear", storeOp: "store", clearValue: { r: 1, g: 1, b: 1, a: 1 } },
            ],
        });
        blur.setPipeline(this.blurPipeline);
        blur.setBindGroup(0, this.blurBindGroup);
        blur.draw(3);
        blur.end();
    }

    private destroyTextures() {
        this.normalTex?.destroy();
        this.depthTex?.destroy();
        this.aoRawTex?.destroy();
        this.aoResultTex?.destroy();
    }

    destroy() {
        this.destroyTextures();
        this.uniforms.destroy();
        this.kernelBuffer.destroy();
        this.noiseBuffer.destroy();
    }
}

function u8(f32: Float32Array): Uint8Array {
    return new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
}
