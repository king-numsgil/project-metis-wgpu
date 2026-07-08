import {
    type GpuBindGroup,
    type GpuBindGroupLayout,
    type GpuBuffer,
    type GpuCommandEncoder,
    type GpuComputePipeline,
    type GpuDevice,
    type GpuRenderPipeline,
    type GpuSampler,
    type GpuTexture,
    type GpuTextureView,
    GPUBufferUsage,
    GPUShaderStage,
    GPUTextureUsage,
} from "bun-webgpu-rs";
import { mat4, type Mat4Arg, vec3 } from "wgpu-matrix";
import clusterBuildWgsl from "./wgsl/cluster_build.wgsl" with { type: "text" };
import commonWgsl from "./wgsl/common.wgsl" with { type: "text" };
import forwardWgsl from "./wgsl/forward.wgsl" with { type: "text" };
import lightCullWgsl from "./wgsl/light_cull.wgsl" with { type: "text" };
import shadowWgsl from "./wgsl/shadow.wgsl" with { type: "text" };
import shadowResolveWgsl from "./wgsl/shadow_resolve.wgsl" with { type: "text" };
import { DEPTH_FORMAT, HDR_COLOR_FORMAT, MSAA_SAMPLE_COUNT, type RenderTargets } from "../rhi/targets";
import { MESH_VERTEX_LAYOUT } from "../scene/mesh";
import type { Scene } from "../scene/scene";
import {
    CLUSTER_COUNT_X,
    CLUSTER_COUNT_Y,
    CLUSTER_COUNT_Z,
    COMPUTE_WORKGROUP_SIZE,
    MAX_LIGHTS_PER_CLUSTER,
    MAX_POINT_LIGHTS,
    NUM_CLUSTERS,
} from "./clusterConfig";
import { Std140Writer } from "./std140";

const CLUSTER_PARAMS_SIZE = 112; // mat4 invProj + vec4 + vec4<u32> + vec4<u32>
const POINT_LIGHT_STRIDE = 48; // vec3+f32, vec3+f32, vec3+f32(pad)
const CLUSTER_AABB_STRIDE = 32; // vec3+pad, vec3+pad
const DISPATCH_GROUPS = Math.ceil(NUM_CLUSTERS / COMPUTE_WORKGROUP_SIZE);

// 2048 (down from 4096) after roomBox switched to solid-slab walls: with
// thick occluders, corner depth gaps are ~wall-thickness (100x the moment
// reconstruction's threshold), so the map no longer needs extreme resolution
// to hide corner ambiguity — and the 4x-MSAA moment resolve keeps shadow
// edges smooth at sub-texel precision. VRAM: 2048² rgba32float moments +
// 2048² 4x depth32float = ~134 MB total (was ~536 MB at 4096²). Keep
// forward.wgsl's SHADOW_TEXEL_SIZE in sync.
const SHADOW_MAP_SIZE = 2048;
// Moments texture (E[z]..E[z^4], see forward.wgsl's computeMsmOcclusion) +
// a separate, unsampled depth attachment used only for the shadow pass's own
// nearest-fragment-wins z-test. rgba32float, not rgba16float: this renderer's
// worst-case corner geometry needs to resolve occluder-depth gaps as small as
// ~0.0003 (in [0,1] shadow-space depth) — smaller than rgba16float's own
// rounding error at that magnitude (~0.0002), which was directly verified
// (via real shadow-map texel readback) to corrupt exactly the gaps that
// matter, regardless of the reconstruction math or filtering. Hardware
// bilinear filtering (which needs a filterable format) was tried and did NOT
// help here either — filtering blends real, different depths from both
// sides of the corner into an ambiguous intermediate value, measurably
// widening the leak rather than softening it. See math/Clustered forward
// formulas.md's Formula 6 for the full investigation and data.
const SHADOW_MOMENTS_FORMAT = "rgba32float" as const;
const SHADOW_DEPTH_FORMAT = "depth32float" as const;
// The shadow pass rasterizes depth-only at 4x MSAA; shadow_resolve.wgsl then
// averages the sub-texel samples' moments into the rgba32float map. This
// anti-aliases shadow boundaries at sub-texel precision — without it, every
// texel is a pure single-depth delta and any shadow feature's edge (most
// visibly the residual band at a concave corner) quantizes to whole texels,
// showing up as a blocky staircase under close zoom. Keep in sync with
// shadow_resolve.wgsl's SHADOW_MSAA_SAMPLES.
const SHADOW_MSAA_SAMPLES = 4;
/** Small safety margin added on top of each mesh's own bounding radius. */
const SHADOW_BOUNDS_PADDING = 1;
const SHADOW_MIN_RADIUS = 4;

/**
 * Depth-tested clustered-forward PBR pass: every fragment sees the
 * directional sun + flat ambient (group 0/1/2 — camera, material, model)
 * plus whatever point lights the two compute passes below assigned to its
 * cluster (group 3). This is the first depth/vertex-buffer/multi-bind-group
 * pipeline in the repo — see bun-webgpu-rs/tests/render*.test.ts, which
 * never go beyond a hardcoded no-vertex-buffer triangle.
 */
export class ClusteredForwardRenderer {
    private readonly device: GpuDevice;
    private readonly pipeline: GpuRenderPipeline;

    readonly frameBindGroupLayout: GpuBindGroupLayout;
    readonly materialBindGroupLayout: GpuBindGroupLayout;
    readonly modelBindGroupLayout: GpuBindGroupLayout;

    private readonly cameraBuffer: GpuBuffer;
    private readonly environmentBuffer: GpuBuffer;
    private readonly frameBindGroup: GpuBindGroup;

    // Clustered light culling — see math/Clustered forward formulas.md.
    private readonly clusterParamsBuffer: GpuBuffer;
    private readonly lightsBuffer: GpuBuffer;
    private readonly clusterAABBsBuffer: GpuBuffer;
    private readonly clusterLightCountsBuffer: GpuBuffer;
    private readonly clusterLightIndicesBuffer: GpuBuffer;

    private readonly clusterBuildPipeline: GpuComputePipeline;
    private readonly clusterBuildBindGroup: GpuBindGroup;
    private readonly lightCullPipeline: GpuComputePipeline;
    private readonly lightCullBindGroup: GpuBindGroup;
    private readonly clusterLightsBindGroup: GpuBindGroup;

    // Directional shadow map — single fixed orthographic frustum re-fit to
    // the scene's bounding sphere every frame. See
    // math/Clustered forward formulas.md.
    private readonly shadowMap: GpuTexture;
    private readonly shadowMapView: GpuTextureView;
    private readonly shadowDepthMap: GpuTexture;
    private readonly shadowDepthMapView: GpuTextureView;
    private readonly shadowSampler: GpuSampler;
    private readonly shadowUniformBuffer: GpuBuffer;
    private readonly shadowPipeline: GpuRenderPipeline;
    private readonly shadowFrameBindGroup: GpuBindGroup;
    private readonly shadowResolvePipeline: GpuRenderPipeline;
    private readonly shadowResolveBindGroup: GpuBindGroup;

    constructor(device: GpuDevice) {
        this.device = device;

        this.frameBindGroupLayout = device.createBindGroupLayout({
            label: "metis-engine/frame-bgl",
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: { bindingType: "uniform" },
                },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { bindingType: "uniform" } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } },
                { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { samplerType: "non-filtering" } },
                { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { bindingType: "uniform" } },
            ],
        });
        this.materialBindGroupLayout = device.createBindGroupLayout({
            label: "metis-engine/material-bgl",
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { bindingType: "uniform" } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { samplerType: "filtering" } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } }, // albedo
                { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } }, // normal
                { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } }, // metallic
                { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } }, // roughness
                { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } }, // emissive
            ],
        });
        this.modelBindGroupLayout = device.createBindGroupLayout({
            label: "metis-engine/model-bgl",
            entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { bindingType: "uniform" } }],
        });
        const clusterLightsBindGroupLayout = device.createBindGroupLayout({
            label: "metis-engine/cluster-lights-bgl",
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { bindingType: "uniform" } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { bindingType: "read-only-storage" } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { bindingType: "read-only-storage" } },
                { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { bindingType: "read-only-storage" } },
            ],
        });

        const pipelineLayout = device.createPipelineLayout({
            label: "metis-engine/forward-pipeline-layout",
            bindGroupLayouts: [
                this.frameBindGroupLayout,
                this.materialBindGroupLayout,
                this.modelBindGroupLayout,
                clusterLightsBindGroupLayout,
            ],
        });

        const module = device.createShaderModule({
            label: "metis-engine/forward-shader",
            code: `${commonWgsl}\n${forwardWgsl}`,
        });

        this.pipeline = device.createRenderPipeline({
            label: "metis-engine/forward-pipeline",
            layout: pipelineLayout,
            vertex: { module, entryPoint: "vs", buffers: [MESH_VERTEX_LAYOUT] },
            fragment: { module, entryPoint: "fs", targets: [{ format: HDR_COLOR_FORMAT }] },
            primitive: { topology: "triangle-list", cullMode: "back" },
            depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: "less" },
            multisample: { count: MSAA_SAMPLE_COUNT },
        });

        this.cameraBuffer = device.createBuffer({
            label: "metis-engine/camera",
            size: 144, // mat4 viewProj + mat4 view + vec3 position (padded)
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.environmentBuffer = device.createBuffer({
            label: "metis-engine/environment",
            size: 48, // vec3 (padded) + vec4 + vec4
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // ── Directional shadow map (moments) ────────────────────────────────
        this.shadowMap = device.createTexture({
            label: "metis-engine/shadow-map-moments",
            size: { width: SHADOW_MAP_SIZE, height: SHADOW_MAP_SIZE },
            format: SHADOW_MOMENTS_FORMAT,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        this.shadowMapView = this.shadowMap.createView();
        // Multisampled depth target for the shadow pass; read back by the
        // moment-resolve pass (shadow_resolve.wgsl), never by the forward
        // pass.
        this.shadowDepthMap = device.createTexture({
            label: "metis-engine/shadow-map-depth",
            size: { width: SHADOW_MAP_SIZE, height: SHADOW_MAP_SIZE },
            format: SHADOW_DEPTH_FORMAT,
            sampleCount: SHADOW_MSAA_SAMPLES,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        this.shadowDepthMapView = this.shadowDepthMap.createView();
        // Non-filtering: rgba32float isn't linearly filterable without the
        // optional float32-filterable feature — see the SHADOW_MOMENTS_FORMAT
        // comment above for why filtering wasn't a net win here anyway.
        this.shadowSampler = device.createSampler({
            label: "metis-engine/shadow-sampler",
            magFilter: "nearest",
            minFilter: "nearest",
            addressModeU: "clamp-to-edge",
            addressModeV: "clamp-to-edge",
        });
        this.shadowUniformBuffer = device.createBuffer({
            label: "metis-engine/shadow-uniforms",
            size: 64, // mat4 lightViewProj
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.frameBindGroup = device.createBindGroup({
            label: "metis-engine/frame-bind-group",
            layout: this.frameBindGroupLayout,
            entries: [
                { binding: 0, buffer: { buffer: this.cameraBuffer } },
                { binding: 1, buffer: { buffer: this.environmentBuffer } },
                { binding: 2, textureView: this.shadowMapView },
                { binding: 3, sampler: this.shadowSampler },
                { binding: 4, buffer: { buffer: this.shadowUniformBuffer } },
            ],
        });

        const shadowFrameBGL = device.createBindGroupLayout({
            label: "metis-engine/shadow-frame-bgl",
            entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { bindingType: "uniform" } }],
        });
        this.shadowFrameBindGroup = device.createBindGroup({
            label: "metis-engine/shadow-frame-bind-group",
            layout: shadowFrameBGL,
            entries: [{ binding: 0, buffer: { buffer: this.shadowUniformBuffer } }],
        });
        const shadowModule = device.createShaderModule({
            label: "metis-engine/shadow-shader",
            code: `${commonWgsl}\n${shadowWgsl}`,
        });
        this.shadowPipeline = device.createRenderPipeline({
            label: "metis-engine/shadow-pipeline",
            layout: device.createPipelineLayout({ bindGroupLayouts: [shadowFrameBGL, this.modelBindGroupLayout] }),
            vertex: { module: shadowModule, entryPoint: "vs", buffers: [MESH_VERTEX_LAYOUT] },
            // Depth-only (no fragment stage): moments are computed from the
            // multisampled depth by the resolve pass below.
            // No culling: the light's viewpoint has nothing to do with the
            // main camera's, so backface culling tuned for interior-normal
            // geometry (a room shell viewed from inside) would wrongly drop
            // triangles that are front-facing to the camera but back-facing
            // to the light (e.g. viewed from outside/above through a
            // window) — exactly the geometry a shadow pass most needs.
            primitive: { topology: "triangle-list", cullMode: "none" },
            depthStencil: { format: SHADOW_DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: "less" },
            multisample: { count: SHADOW_MSAA_SAMPLES },
        });

        // Moment-resolve: multisampled shadow depth -> per-texel averaged
        // power moments (see shadow_resolve.wgsl).
        const shadowResolveBGL = device.createBindGroupLayout({
            label: "metis-engine/shadow-resolve-bgl",
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "depth", multisampled: true } },
            ],
        });
        this.shadowResolveBindGroup = device.createBindGroup({
            label: "metis-engine/shadow-resolve-bind-group",
            layout: shadowResolveBGL,
            entries: [{ binding: 0, textureView: this.shadowDepthMapView }],
        });
        const shadowResolveModule = device.createShaderModule({
            label: "metis-engine/shadow-resolve-shader",
            code: shadowResolveWgsl,
        });
        this.shadowResolvePipeline = device.createRenderPipeline({
            label: "metis-engine/shadow-resolve-pipeline",
            layout: device.createPipelineLayout({ bindGroupLayouts: [shadowResolveBGL] }),
            vertex: { module: shadowResolveModule, entryPoint: "vs" },
            fragment: { module: shadowResolveModule, entryPoint: "fs", targets: [{ format: SHADOW_MOMENTS_FORMAT }] },
            primitive: { topology: "triangle-list" },
        });

        // ── Clustered light culling resources ──────────────────────────────
        this.clusterParamsBuffer = device.createBuffer({
            label: "metis-engine/cluster-params",
            size: CLUSTER_PARAMS_SIZE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.lightsBuffer = device.createBuffer({
            label: "metis-engine/point-lights",
            size: MAX_POINT_LIGHTS * POINT_LIGHT_STRIDE,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.clusterAABBsBuffer = device.createBuffer({
            label: "metis-engine/cluster-aabbs",
            size: NUM_CLUSTERS * CLUSTER_AABB_STRIDE,
            usage: GPUBufferUsage.STORAGE,
        });
        this.clusterLightCountsBuffer = device.createBuffer({
            label: "metis-engine/cluster-light-counts",
            size: NUM_CLUSTERS * 4,
            usage: GPUBufferUsage.STORAGE,
        });
        this.clusterLightIndicesBuffer = device.createBuffer({
            label: "metis-engine/cluster-light-indices",
            size: NUM_CLUSTERS * MAX_LIGHTS_PER_CLUSTER * 4,
            usage: GPUBufferUsage.STORAGE,
        });

        const clusterBuildBGL = device.createBindGroupLayout({
            label: "metis-engine/cluster-build-bgl",
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { bindingType: "uniform" } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { bindingType: "storage" } },
            ],
        });
        this.clusterBuildBindGroup = device.createBindGroup({
            label: "metis-engine/cluster-build-bind-group",
            layout: clusterBuildBGL,
            entries: [
                { binding: 0, buffer: { buffer: this.clusterParamsBuffer } },
                { binding: 1, buffer: { buffer: this.clusterAABBsBuffer } },
            ],
        });
        this.clusterBuildPipeline = device.createComputePipeline({
            label: "metis-engine/cluster-build-pipeline",
            layout: device.createPipelineLayout({ bindGroupLayouts: [clusterBuildBGL] }),
            compute: {
                module: device.createShaderModule({
                    label: "metis-engine/cluster-build-shader",
                    code: `${commonWgsl}\n${clusterBuildWgsl}`,
                }),
                entryPoint: "build",
            },
        });

        const lightCullBGL = device.createBindGroupLayout({
            label: "metis-engine/light-cull-bgl",
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { bindingType: "uniform" } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { bindingType: "read-only-storage" } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { bindingType: "read-only-storage" } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { bindingType: "storage" } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { bindingType: "storage" } },
            ],
        });
        this.lightCullBindGroup = device.createBindGroup({
            label: "metis-engine/light-cull-bind-group",
            layout: lightCullBGL,
            entries: [
                { binding: 0, buffer: { buffer: this.clusterParamsBuffer } },
                { binding: 1, buffer: { buffer: this.lightsBuffer } },
                { binding: 2, buffer: { buffer: this.clusterAABBsBuffer } },
                { binding: 3, buffer: { buffer: this.clusterLightCountsBuffer } },
                { binding: 4, buffer: { buffer: this.clusterLightIndicesBuffer } },
            ],
        });
        this.lightCullPipeline = device.createComputePipeline({
            label: "metis-engine/light-cull-pipeline",
            layout: device.createPipelineLayout({ bindGroupLayouts: [lightCullBGL] }),
            compute: {
                module: device.createShaderModule({
                    label: "metis-engine/light-cull-shader",
                    code: `${commonWgsl}\n${lightCullWgsl}`,
                }),
                entryPoint: "cull",
            },
        });

        this.clusterLightsBindGroup = device.createBindGroup({
            label: "metis-engine/cluster-lights-bind-group",
            layout: clusterLightsBindGroupLayout,
            entries: [
                { binding: 0, buffer: { buffer: this.clusterParamsBuffer } },
                { binding: 1, buffer: { buffer: this.lightsBuffer } },
                { binding: 2, buffer: { buffer: this.clusterLightCountsBuffer } },
                { binding: 3, buffer: { buffer: this.clusterLightIndicesBuffer } },
            ],
        });
    }

    private writeFrameUniforms(scene: Scene) {
        const cam = new Std140Writer();
        cam.mat4(scene.camera.viewProjectionMatrix());
        cam.mat4(scene.camera.viewMatrix());
        cam.vec3(scene.camera.position);
        this.device.queue.writeBuffer(this.cameraBuffer, 0, cam.toBytes());

        const env = new Std140Writer();
        env.vec3(scene.environment.sunDirection);
        const sc = scene.environment.sunColor;
        env.vec4(sc[0], sc[1], sc[2], scene.environment.sunIntensity);
        const ac = scene.environment.ambientColor;
        env.vec4(ac[0], ac[1], ac[2], scene.environment.ambientIntensity);
        this.device.queue.writeBuffer(this.environmentBuffer, 0, env.toBytes());
    }

    private writeClusterData(targets: RenderTargets, scene: Scene) {
        const invProj = mat4.invert(scene.camera.projectionMatrix());
        const params = new Std140Writer();
        params.mat4(invProj);
        params.vec4(targets.width, targets.height, scene.camera.near, scene.camera.far);
        params.vec4u(CLUSTER_COUNT_X, CLUSTER_COUNT_Y, CLUSTER_COUNT_Z, MAX_LIGHTS_PER_CLUSTER);
        const lightCount = Math.min(scene.pointLights.length, MAX_POINT_LIGHTS);
        params.vec4u(lightCount, 0, 0, 0);
        this.device.queue.writeBuffer(this.clusterParamsBuffer, 0, params.toBytes());

        const view = scene.camera.viewMatrix();
        const lights = new Std140Writer();
        for (let i = 0; i < lightCount; i++) {
            const light = scene.pointLights[i]!;
            const viewPos = vec3.transformMat4(light.position, view);
            lights.vec3(light.position, light.range);
            lights.vec3(viewPos, light.intensity);
            lights.vec3(light.color, 0);
        }
        if (lightCount > 0) {
            this.device.queue.writeBuffer(this.lightsBuffer, 0, lights.toBytes());
        }
        if (scene.pointLights.length > MAX_POINT_LIGHTS) {
            console.warn(
                `metis-engine: scene has ${scene.pointLights.length} point lights, ` +
                    `only the first ${MAX_POINT_LIGHTS} are rendered (MAX_POINT_LIGHTS).`,
            );
        }
    }

    /** Fits a single orthographic shadow frustum around the scene's bounding sphere, using each mesh's own `boundingRadius` (not just instance positions — a room mesh sits at the origin but extends far past it). */
    private computeShadowViewProj(scene: Scene): Mat4Arg {
        const instances = scene.instances;
        const center = vec3.create(0, 0, 0);
        for (const instance of instances) vec3.add(center, instance.transform.position, center);
        if (instances.length > 0) vec3.scale(center, 1 / instances.length, center);

        let radius = SHADOW_MIN_RADIUS;
        for (const instance of instances) {
            const reach = vec3.distance(instance.transform.position, center) + instance.mesh.boundingRadius + SHADOW_BOUNDS_PADDING;
            radius = Math.max(radius, reach);
        }

        const sunDir = vec3.normalize(scene.environment.sunDirection);
        const up = Math.abs(sunDir[1]!) > 0.98 ? vec3.create(1, 0, 0) : vec3.create(0, 1, 0);
        const eye = vec3.subtract(center, vec3.scale(sunDir, radius * 2));
        const view = mat4.lookAt(eye, center, up);
        // Near/far hug the scene's actual span along the light: the eye sits
        // 2*radius from the bounding-sphere center, so geometry occupies
        // [radius, 3*radius] exactly (radius already includes padding). The
        // previous [0.1, 4*radius] wasted nearly half the [0,1] depth range
        // on empty space — tightening it doubles depth resolution, which
        // directly halves the world-space width of the residual band the
        // moment reconstruction can't resolve at a concave corner (see
        // forward.wgsl's computeMsmOcclusion).
        const proj = mat4.ortho(-radius, radius, -radius, radius, radius * 0.98, radius * 3.02);
        return mat4.multiply(proj, view);
    }

    private renderShadowPass(encoder: GpuCommandEncoder, scene: Scene) {
        const lightViewProj = this.computeShadowViewProj(scene);
        const w = new Std140Writer();
        w.mat4(lightViewProj);
        this.device.queue.writeBuffer(this.shadowUniformBuffer, 0, w.toBytes());

        const depthPass = encoder.beginRenderPass({
            label: "metis-engine/shadow-depth-pass",
            colorAttachments: [],
            depthStencilAttachment: {
                view: this.shadowDepthMapView,
                depthLoadOp: "clear",
                depthStoreOp: "store", // read by the moment-resolve pass below
                depthClearValue: 1.0, // z=1 (farthest) = "no occluder here"
            },
        });
        depthPass.setPipeline(this.shadowPipeline);
        depthPass.setBindGroup(0, this.shadowFrameBindGroup);
        for (const instance of scene.instances) {
            depthPass.setBindGroup(1, instance.getModelBindGroup(this.device, this.modelBindGroupLayout));
            instance.mesh.bind(depthPass);
            instance.mesh.draw(depthPass);
        }
        depthPass.end();

        const resolvePass = encoder.beginRenderPass({
            label: "metis-engine/shadow-moment-resolve-pass",
            colorAttachments: [
                {
                    view: this.shadowMapView,
                    loadOp: "clear", // fully overwritten by the fullscreen triangle
                    storeOp: "store",
                    clearValue: { r: 1, g: 1, b: 1, a: 1 },
                },
            ],
        });
        resolvePass.setPipeline(this.shadowResolvePipeline);
        resolvePass.setBindGroup(0, this.shadowResolveBindGroup);
        resolvePass.draw(3);
        resolvePass.end();
    }

    private cullLights(encoder: GpuCommandEncoder) {
        const buildPass = encoder.beginComputePass({ label: "metis-engine/cluster-build-pass" });
        buildPass.setPipeline(this.clusterBuildPipeline);
        buildPass.setBindGroup(0, this.clusterBuildBindGroup);
        buildPass.dispatchWorkgroups(DISPATCH_GROUPS);
        buildPass.end();

        const cullPass = encoder.beginComputePass({ label: "metis-engine/light-cull-pass" });
        cullPass.setPipeline(this.lightCullPipeline);
        cullPass.setBindGroup(0, this.lightCullBindGroup);
        cullPass.dispatchWorkgroups(DISPATCH_GROUPS);
        cullPass.end();
    }

    render(encoder: GpuCommandEncoder, targets: RenderTargets, scene: Scene) {
        this.writeFrameUniforms(scene);
        this.writeClusterData(targets, scene);
        this.renderShadowPass(encoder, scene);
        this.cullLights(encoder);

        const pass = encoder.beginRenderPass({
            label: "metis-engine/forward-pass",
            colorAttachments: [
                {
                    view: targets.hdrColorMultisampledView,
                    resolveTarget: targets.hdrColorResolvedView,
                    loadOp: "clear",
                    storeOp: "discard", // multisampled data is only needed until it's resolved above
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                },
            ],
            depthStencilAttachment: {
                view: targets.depthView,
                depthLoadOp: "clear",
                depthStoreOp: "store",
                depthClearValue: 1.0,
            },
        });

        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.frameBindGroup);
        pass.setBindGroup(3, this.clusterLightsBindGroup);

        for (const instance of scene.instances) {
            pass.setBindGroup(1, instance.material.getBindGroup(this.device, this.materialBindGroupLayout));
            pass.setBindGroup(2, instance.getModelBindGroup(this.device, this.modelBindGroupLayout));
            instance.mesh.bind(pass);
            instance.mesh.draw(pass);
        }

        pass.end();
    }

    destroy() {
        this.cameraBuffer.destroy();
        this.environmentBuffer.destroy();
        this.clusterParamsBuffer.destroy();
        this.lightsBuffer.destroy();
        this.clusterAABBsBuffer.destroy();
        this.clusterLightCountsBuffer.destroy();
        this.clusterLightIndicesBuffer.destroy();
        this.shadowMap.destroy();
        this.shadowDepthMap.destroy();
        this.shadowUniformBuffer.destroy();
    }
}
