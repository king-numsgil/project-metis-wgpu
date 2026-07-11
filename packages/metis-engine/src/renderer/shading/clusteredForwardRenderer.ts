import {
    type GpuBindGroupLayout,
    type GpuBuffer,
    GPUBufferUsage,
    type GpuCommandEncoder,
    type GpuDevice,
    type GpuRenderPipeline,
    GPUShaderStage,
} from "bun-webgpu-rs";
import { AmbientOcclusion } from "../ao/ambientOcclusion.ts";
import { AoTechnique } from "../ao/aoConfig.ts";
import { DEPTH_FORMAT, HDR_COLOR_FORMAT, MSAA_SAMPLE_COUNT, type RenderTargets } from "../rhi/targets.ts";
import { MESH_VERTEX_LAYOUT } from "../scene/mesh.ts";
import type { Scene } from "../scene/scene.ts";
import { LightCuller } from "./lightCuller.ts";
import { CASCADE_SPLIT_LAMBDA_DEFAULT, SHADOW_DISTANCE_DEFAULT, ShadowCascades } from "./shadowCascades.ts";
import { Std140Writer } from "./std140.ts";
import commonWgsl from "./wgsl/common.wgsl" with { type: "text" };
import forwardWgsl from "./wgsl/forward.wgsl" with { type: "text" };

/**
 * Depth-tested clustered-forward PBR pass: every fragment sees the directional
 * sun + flat ambient (group 0/1/2 — camera, material, model) plus whatever
 * point lights the cluster-culling pass assigned to its cluster (group 3).
 *
 * This class owns the forward pipeline + camera/environment uniforms and
 * orchestrates the frame; the two heavier subsystems live in collaborators it
 * constructs: `LightCuller` (group-3 cluster light lists — the two compute
 * passes) and `ShadowCascades` (the 4-cascade directional shadow). `Ambient
 * Occlusion` is the third. `render()` wires all three into the forward pass's
 * frame bind group.
 */
export class ClusteredForwardRenderer {
    readonly frameBindGroupLayout: GpuBindGroupLayout;
    readonly materialBindGroupLayout: GpuBindGroupLayout;
    readonly modelBindGroupLayout: GpuBindGroupLayout;
    /** Screen-space ambient occlusion (None/SSAO/HBAO). Set `.technique` to switch; applied to the ambient term only. */
    readonly ao: AmbientOcclusion;
    /**
     * Far reach of the shadowed region, in world units. The 4 cascades are fit
     * to the camera frustum over `[camera.near, shadowDistance]`; geometry
     * beyond it casts/receives no directional shadow (renders fully sunlit).
     * Keep this to the distance shadows are actually legible — the cascades
     * subdivide it, so a needlessly large value coarsens every cascade.
     */
    shadowDistance = SHADOW_DISTANCE_DEFAULT;
    /**
     * Practical-split blend (`1` = logarithmic → tight near cascade, `0` =
     * uniform). Higher biases resolution toward the camera; `0.85` keeps
     * cascade 0 crisp without starving the far cascades.
     */
    cascadeSplitLambda = CASCADE_SPLIT_LAMBDA_DEFAULT;

    private readonly device: GpuDevice;
    private readonly pipeline: GpuRenderPipeline;
    private readonly cameraBuffer: GpuBuffer;
    private readonly environmentBuffer: GpuBuffer;
    private readonly culler: LightCuller;
    private readonly shadows: ShadowCascades;

    constructor(device: GpuDevice) {
        this.device = device;

        this.frameBindGroupLayout = device.createBindGroupLayout({
            label: "metis-engine/frame-bgl",
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: {bindingType: "uniform"},
                },
                {binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: {bindingType: "uniform"}},
                {binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {sampleType: "unfilterable-float"}}, // cascade0 moments
                {binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: {samplerType: "non-filtering"}}, // moments sampler
                {binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: {bindingType: "uniform"}}, // cascade uniforms
                {binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: {sampleType: "unfilterable-float"}}, // AO
                // Cascades 1..N: depth array + comparison sampler (hardware PCF).
                {
                    binding: 6,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {sampleType: "depth", viewDimension: "2d-array"},
                },
                {binding: 7, visibility: GPUShaderStage.FRAGMENT, sampler: {samplerType: "comparison"}},
            ],
        });
        this.materialBindGroupLayout = device.createBindGroupLayout({
            label: "metis-engine/material-bgl",
            entries: [
                {binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {bindingType: "uniform"}},
                {binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {samplerType: "filtering"}},
                {binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {sampleType: "float"}}, // albedo
                {binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {sampleType: "float"}}, // normal
                {binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: {sampleType: "float"}}, // metallic
                {binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: {sampleType: "float"}}, // roughness
                {binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: {sampleType: "float"}}, // emissive
            ],
        });
        this.modelBindGroupLayout = device.createBindGroupLayout({
            label: "metis-engine/model-bgl",
            entries: [{binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {bindingType: "uniform"}}],
        });

        // Collaborators. The culler owns the group-3 layout the forward pipeline
        // needs; the shadow + AO subsystems both render from the model layout.
        this.culler = new LightCuller(device);
        this.shadows = new ShadowCascades(device, this.modelBindGroupLayout);
        this.ao = new AmbientOcclusion(device, this.modelBindGroupLayout);

        const pipelineLayout = device.createPipelineLayout({
            label: "metis-engine/forward-pipeline-layout",
            bindGroupLayouts: [
                this.frameBindGroupLayout,
                this.materialBindGroupLayout,
                this.modelBindGroupLayout,
                this.culler.bindGroupLayout,
            ],
        });
        const module = device.createShaderModule({
            label: "metis-engine/forward-shader",
            code: `${commonWgsl}\n${forwardWgsl}`,
        });
        this.pipeline = device.createRenderPipeline({
            label: "metis-engine/forward-pipeline",
            layout: pipelineLayout,
            vertex: {module, entryPoint: "vs", buffers: [MESH_VERTEX_LAYOUT]},
            fragment: {module, entryPoint: "fs", targets: [{format: HDR_COLOR_FORMAT}]},
            primitive: {topology: "triangle-list", cullMode: "back"},
            // "greater", not "less": Camera uses a reverse-Z projection (near -> 1,
            // infinity -> 0), which is what makes depth32float's precision land
            // where the perspective divide needs it. Paired with depthClearValue 0.
            depthStencil: {format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: "greater"},
            multisample: {count: MSAA_SAMPLE_COUNT},
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
    }

    render(encoder: GpuCommandEncoder, targets: RenderTargets, scene: Scene) {
        this.writeFrameUniforms(scene);
        this.culler.write(scene, targets);
        this.shadows.render(encoder, scene, this.shadowDistance, this.cascadeSplitLambda);
        this.culler.cull(encoder);

        // Ambient occlusion (feeds the forward pass's ambient term). `None`
        // clears the result to white so the forward multiply is a no-op.
        this.ao.ensureSize(targets.width, targets.height);
        if (this.ao.technique === AoTechnique.None) {
            this.ao.clearToWhite(encoder);
        } else {
            this.ao.render(encoder, scene, targets);
        }

        const frameBindGroup = this.device.createBindGroup({
            label: "metis-engine/frame-bind-group",
            layout: this.frameBindGroupLayout,
            entries: [
                {binding: 0, buffer: {buffer: this.cameraBuffer}},
                {binding: 1, buffer: {buffer: this.environmentBuffer}},
                {binding: 2, textureView: this.shadows.momentsView},
                {binding: 3, sampler: this.shadows.momentsSampler},
                {binding: 4, buffer: {buffer: this.shadows.uniformBuffer}},
                {binding: 5, textureView: this.ao.resultView},
                {binding: 6, textureView: this.shadows.depthArrayView},
                {binding: 7, sampler: this.shadows.compareSampler},
            ],
        });

        const pass = encoder.beginRenderPass({
            label: "metis-engine/forward-pass",
            colorAttachments: [
                {
                    view: targets.hdrColorMultisampledView,
                    resolveTarget: targets.hdrColorResolvedView,
                    loadOp: "clear",
                    storeOp: "discard", // multisampled data is only needed until it's resolved above
                    clearValue: {r: 0, g: 0, b: 0, a: 1},
                },
            ],
            depthStencilAttachment: {
                view: targets.depthView,
                depthLoadOp: "clear",
                depthStoreOp: "store",
                depthClearValue: 0.0, // reverse-Z: 0 = infinitely far = "nothing drawn"
            },
        });

        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, frameBindGroup);
        pass.setBindGroup(3, this.culler.bindGroup);

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
        this.culler.destroy();
        this.shadows.destroy();
        this.ao.destroy();
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
}
