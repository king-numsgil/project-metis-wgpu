import {
    type GpuBindGroup,
    type GpuBindGroupLayout,
    type GpuBuffer,
    GPUBufferUsage,
    type GpuCommandEncoder,
    type GpuDevice,
    type GpuRenderPipeline,
    GPUShaderStage,
    type GpuTexture,
    GPUTextureUsage,
    type GpuTextureView,
} from "metis-native";
import { Mat4 } from "metis-data";
import type { GpuProfiler } from "../debug/gpuProfiler.ts";
import type { Mat4f } from "../math/types.ts";
import type { RenderTargets } from "../rhi/targets.ts";
import { MESH_VERTEX_LAYOUT } from "../scene/mesh.ts";
import type { Scene, SceneInstance } from "../scene/scene.ts";
import { forEachDrawRun, PassBinder } from "../shading/drawBatching.ts";
import { AoUniforms, stage } from "../shading/gpuLayouts.ts";
import {
    AO_NOISE_DIM,
    AoTechnique,
    type AoTuning,
    HBAO_DEFAULTS,
    SSAO_DEFAULTS,
    SSAO_KERNEL_SIZE,
} from "./aoConfig.ts";
import { generateAoNoise, generateSsaoKernel } from "./aoKernel.ts";
import aoBlurWgsl from "./wgsl/ao_blur.wgsl" with { type: "text" };
import aoPrepassWgsl from "./wgsl/ao_prepass.wgsl" with { type: "text" };
import hbaoWgsl from "./wgsl/hbao.wgsl" with { type: "text" };
import ssaoWgsl from "./wgsl/ssao.wgsl" with { type: "text" };

const NORMAL_FORMAT = "rgba16float" as const;
const DEPTH_FORMAT = "depth32float" as const;
const AO_FORMAT = "r8unorm" as const;

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
    /**
     * Occlusion sampling radius, in **world units** — the neighbourhood a point
     * can be occluded from. The one tunable here with a physical meaning, so
     * scale it with your scene's geometry.
     *
     * All four tunables are reseeded from the technique's defaults whenever
     * {@link technique} is assigned; set them *after* switching, not before.
     */
    radius = SSAO_DEFAULTS.radius;
    /** Self-occlusion guard. SSAO: a view-space depth bias. HBAO: a tangent-angle bias in radians. Different units per technique — hence the reseed. */
    bias = SSAO_DEFAULTS.bias;
    /** Strength multiplier on the raw occlusion before it darkens ambient (1 = as measured). */
    intensity = SSAO_DEFAULTS.intensity;
    /** Contrast exponent on the final AO factor; above 1 darkens creases harder. */
    power = SSAO_DEFAULTS.power;
    private readonly device: GpuDevice;
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
    /** Persistent staging, allocated once (see gpuLayouts.ts). */
    private readonly uniformBytes: Uint8Array;
    private readonly uniformStaging: {
        view: Mat4f;
        viewProj: Mat4f;
        proj: Mat4f;
        invProj: Mat4f;
        screenAndDepth: Float32Array;
        tuning: Float32Array;
    };
    private readonly kernelBuffer: GpuBuffer;
    private readonly noiseBuffer: GpuBuffer;
    private readonly prepassPipeline: GpuRenderPipeline;
    /** Pass-scoped bind tracker; `begin()` after `beginRenderPass`. */
    private readonly binder = new PassBinder();
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
            size: AoUniforms.byteSize,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        const s = stage(AoUniforms);
        this.uniformBytes = s.bytes;
        this.uniformStaging = {
            // Matrix members alias the upload bytes, so `writeUniforms`
            // computes all four straight into what gets uploaded.
            view: s.mat4("view"),
            viewProj: s.mat4("viewProj"),
            proj: s.mat4("proj"),
            invProj: s.mat4("invProj"),
            screenAndDepth: s.f32("screenAndDepth", 4),
            tuning: s.f32("tuning", 4),
        };
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
            entries: [{binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {bindingType: "uniform"}}],
        });
        this.prepassCameraBindGroup = device.createBindGroup({
            label: "metis-engine/ao-prepass-camera-bind-group",
            layout: this.prepassCameraLayout,
            entries: [{binding: 0, buffer: {buffer: this.uniforms}}],
        });
        const prepassModule = device.createShaderModule({label: "metis-engine/ao-prepass-shader", code: aoPrepassWgsl});
        this.prepassPipeline = device.createRenderPipeline({
            label: "metis-engine/ao-prepass-pipeline",
            layout: device.createPipelineLayout({bindGroupLayouts: [this.prepassCameraLayout, modelBindGroupLayout]}),
            vertex: {module: prepassModule, entryPoint: "vs", buffers: [MESH_VERTEX_LAYOUT]},
            fragment: {module: prepassModule, entryPoint: "fs", targets: [{format: NORMAL_FORMAT}]},
            primitive: {topology: "triangle-list", cullMode: "back"},
            // "greater" + clear 0: matches the forward pass's reverse-Z projection
            // (see math/camera.ts). ssao/hbao read this buffer, test background as
            // `depth <= 0`, and reconstruct view position through `invProj`/`proj`,
            // which follow whatever projection the camera produced.
            depthStencil: {format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: "greater"},
        });

        // ── AO sampling pipelines (SSAO / HBAO) ─────────────────────────────
        this.samplingLayout = device.createBindGroupLayout({
            label: "metis-engine/ao-sampling-bgl",
            entries: [
                {binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {bindingType: "uniform"}},
                {binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {sampleType: "depth"}},
                {binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {sampleType: "unfilterable-float"}},
                {binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: {bindingType: "uniform"}},
                {binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: {bindingType: "uniform"}},
            ],
        });
        const samplingPipelineLayout = device.createPipelineLayout({bindGroupLayouts: [this.samplingLayout]});
        const ssaoModule = device.createShaderModule({label: "metis-engine/ssao-shader", code: ssaoWgsl});
        this.ssaoPipeline = device.createRenderPipeline({
            label: "metis-engine/ssao-pipeline",
            layout: samplingPipelineLayout,
            vertex: {module: ssaoModule, entryPoint: "vs"},
            fragment: {module: ssaoModule, entryPoint: "fs", targets: [{format: AO_FORMAT}]},
            primitive: {topology: "triangle-list"},
        });
        const hbaoModule = device.createShaderModule({label: "metis-engine/hbao-shader", code: hbaoWgsl});
        this.hbaoPipeline = device.createRenderPipeline({
            label: "metis-engine/hbao-pipeline",
            layout: samplingPipelineLayout,
            vertex: {module: hbaoModule, entryPoint: "vs"},
            fragment: {module: hbaoModule, entryPoint: "fs", targets: [{format: AO_FORMAT}]},
            primitive: {topology: "triangle-list"},
        });

        // ── Blur pipeline ───────────────────────────────────────────────────
        this.blurLayout = device.createBindGroupLayout({
            label: "metis-engine/ao-blur-bgl",
            entries: [{binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {sampleType: "unfilterable-float"}}],
        });
        const blurModule = device.createShaderModule({label: "metis-engine/ao-blur-shader", code: aoBlurWgsl});
        this.blurPipeline = device.createRenderPipeline({
            label: "metis-engine/ao-blur-pipeline",
            layout: device.createPipelineLayout({bindGroupLayouts: [this.blurLayout]}),
            vertex: {module: blurModule, entryPoint: "vs"},
            fragment: {module: blurModule, entryPoint: "fs", targets: [{format: AO_FORMAT}]},
            primitive: {topology: "triangle-list"},
        });
    }

    private _technique: AoTechnique = AoTechnique.None;

    /** The active technique. Safe to switch at runtime — every pipeline is built up front. */
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

    /** The blurred occlusion factor (r8unorm), sampled by the forward pass. Valid after the first `ensureSize`. */
    get resultView(): GpuTextureView {
        return this.aoResultView;
    }

    /**
     * (Re)allocates the screen-sized targets when the viewport changes. Cheap
     * and idempotent when the size is unchanged, which is why the renderer calls
     * it unconditionally every frame. Must run at least once before
     * {@link resultView} is read.
     */
    ensureSize(width: number, height: number) {
        if (width === this.width && height === this.height && this.normalTex) {
            return;
        }
        this.destroyTextures();
        this.width = width;
        this.height = height;
        const size = {width, height};

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
                {binding: 0, buffer: {buffer: this.uniforms}},
                {binding: 1, textureView: this.depthView},
                {binding: 2, textureView: this.normalView},
                {binding: 3, buffer: {buffer: this.kernelBuffer}},
                {binding: 4, buffer: {buffer: this.noiseBuffer}},
            ],
        });
        this.blurBindGroup = this.device.createBindGroup({
            label: "metis-engine/ao-blur-bind-group",
            layout: this.blurLayout,
            entries: [{binding: 0, textureView: this.aoRawView}],
        });
    }

    /** Clears `resultView` to white (fully open) — used when the technique is `None`. */
    clearToWhite(encoder: GpuCommandEncoder, profiler?: GpuProfiler) {
        const pass = encoder.beginRenderPass({
            label: "metis-engine/ao-clear",
            timestampWrites: profiler?.pass("ao-clear"),
            colorAttachments: [
                {view: this.aoResultView, loadOp: "clear", storeOp: "store", clearValue: {r: 1, g: 1, b: 1, a: 1}},
            ],
        });
        pass.end();
    }

    /** Runs the prepass + selected AO technique + blur, leaving the result in `resultView`. Assumes `technique !== None`. */
    render(
        encoder: GpuCommandEncoder,
        scene: Scene,
        instances: readonly SceneInstance[],
        modelBindGroup: GpuBindGroup,
        _targets: RenderTargets,
        profiler?: GpuProfiler,
    ) {
        this.writeUniforms(scene);

        // Geometry prepass -> view-space normals + depth.
        const prepass = encoder.beginRenderPass({
            label: "metis-engine/ao-prepass",
            timestampWrites: profiler?.pass("ao-prepass"),
            colorAttachments: [
                {view: this.normalView, loadOp: "clear", storeOp: "store", clearValue: {r: 0, g: 0, b: 0, a: 0}},
            ],
            depthStencilAttachment: {
                view: this.depthView,
                depthLoadOp: "clear",
                depthStoreOp: "store",
                depthClearValue: 0.0, // reverse-Z: 0 = infinitely far = "nothing drawn"
            },
        });
        prepass.setPipeline(this.prepassPipeline);
        prepass.setBindGroup(0, this.prepassCameraBindGroup);
        prepass.setBindGroup(1, modelBindGroup);
        // Takes the frame's draw order (not `scene.instances`) and the shared
        // bind tracker, like every other pass. It did neither until instancing
        // landed — it was the one draw loop the batching work missed, and it
        // could not have been fixed in isolation anyway, since `firstInstance`
        // only means anything against the sorted order.
        this.binder.begin();
        forEachDrawRun(instances, null, false, (mesh, _material, first, count) => {
            this.binder.setMesh(prepass, mesh);
            mesh.draw(prepass, count, first);
        });
        prepass.end();

        // Occlusion pass -> raw AO.
        const aoPass = encoder.beginRenderPass({
            label: "metis-engine/ao-compute",
            timestampWrites: profiler?.pass("ao-compute"),
            colorAttachments: [
                {view: this.aoRawView, loadOp: "clear", storeOp: "store", clearValue: {r: 1, g: 1, b: 1, a: 1}},
            ],
        });
        aoPass.setPipeline(this._technique === AoTechnique.HBAO ? this.hbaoPipeline : this.ssaoPipeline);
        aoPass.setBindGroup(0, this.samplingBindGroup);
        aoPass.draw(3);
        aoPass.end();

        // Denoise blur -> result.
        const blur = encoder.beginRenderPass({
            label: "metis-engine/ao-blur",
            timestampWrites: profiler?.pass("ao-blur"),
            colorAttachments: [
                {view: this.aoResultView, loadOp: "clear", storeOp: "store", clearValue: {r: 1, g: 1, b: 1, a: 1}},
            ],
        });
        blur.setPipeline(this.blurPipeline);
        blur.setBindGroup(0, this.blurBindGroup);
        blur.draw(3);
        blur.end();
    }

    /** Releases the screen-sized targets and the kernel/noise/uniform buffers. */
    destroy() {
        this.destroyTextures();
        this.uniforms.destroy();
        this.kernelBuffer.destroy();
        this.noiseBuffer.destroy();
    }

    private writeUniforms(scene: Scene) {
        // All four matrices are computed directly into the upload bytes — no
        // intermediates, no copies. `viewProj` is built from the two above it
        // rather than via `camera.viewProjectionMatrix()`, which would recompute
        // both into the camera's own scratch first.
        const s = this.uniformStaging;
        scene.camera.viewMatrix(s.view);
        scene.camera.projectionMatrix(s.proj);
        Mat4.multiply(s.viewProj, s.proj, s.view);
        Mat4.invert(s.invProj, s.proj);
        // z/w are informational only (the AO shaders reconstruct through invProj
        // and read just params0.xy). `clusterFar` stands in for the projection's
        // far plane, which is infinite under reverse-Z and would poison the f32.
        s.screenAndDepth[0] = this.width;
        s.screenAndDepth[1] = this.height;
        s.screenAndDepth[2] = scene.camera.near;
        s.screenAndDepth[3] = scene.camera.clusterFar;
        s.tuning[0] = this.radius;
        s.tuning[1] = this.bias;
        s.tuning[2] = this.intensity;
        s.tuning[3] = this.power;
        this.device.queue.writeBuffer(this.uniforms, 0, this.uniformBytes);
    }

    private destroyTextures() {
        this.normalTex?.destroy();
        this.depthTex?.destroy();
        this.aoRawTex?.destroy();
        this.aoResultTex?.destroy();
    }
}

function u8(f32: Float32Array): Uint8Array {
    return new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
}
