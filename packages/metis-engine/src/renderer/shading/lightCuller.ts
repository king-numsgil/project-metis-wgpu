import {
    type GpuBindGroup,
    type GpuBindGroupLayout,
    type GpuBuffer,
    GPUBufferUsage,
    type GpuCommandEncoder,
    type GpuComputePipeline,
    type GpuDevice,
    GPUShaderStage,
} from "bun-webgpu-rs";
import { mat4, vec3 } from "wgpu-matrix";
import type { GpuProfiler } from "../debug/gpuProfiler.ts";
import type { RenderTargets } from "../rhi/targets.ts";
import type { Scene } from "../scene/scene.ts";
import {
    CLUSTER_COUNT_X,
    CLUSTER_COUNT_Y,
    CLUSTER_COUNT_Z,
    COMPUTE_WORKGROUP_SIZE,
    MAX_LIGHTS_PER_CLUSTER,
    MAX_POINT_LIGHTS,
    NUM_CLUSTERS,
} from "./clusterConfig.ts";
import { Std140Writer } from "./std140.ts";
import clusterBuildWgsl from "./wgsl/cluster_build.wgsl" with { type: "text" };
import commonWgsl from "./wgsl/common.wgsl" with { type: "text" };
import lightCullWgsl from "./wgsl/light_cull.wgsl" with { type: "text" };

const CLUSTER_PARAMS_SIZE = 112; // mat4 invProj + vec4 + vec4<u32> + vec4<u32>
const POINT_LIGHT_STRIDE = 48; // vec3+f32, vec3+f32, vec3+f32(pad)
const CLUSTER_AABB_STRIDE = 32; // vec3+pad, vec3+pad
const DISPATCH_GROUPS = Math.ceil(NUM_CLUSTERS / COMPUTE_WORKGROUP_SIZE);

/**
 * Clustered light culling — the two compute passes that let the forward pass
 * shade only the point lights touching each fragment's cluster. See
 * math/Clustered forward formulas.md.
 *
 * `cluster_build` divides the view frustum into the fixed
 * `CLUSTER_COUNT_X×Y×Z` grid (exponential Z slicing) and writes each cluster's
 * view-space AABB; `light_cull` sphere-tests every light against every cluster
 * and writes a per-cluster light-index list. The forward pass reads that list
 * via `bindGroup` (its group 3); build the forward pipeline's group-3 layout
 * from `bindGroupLayout`.
 */
export class LightCuller {
    /** Group-3 layout for the forward pipeline (uniform + 3 read-only storage buffers). */
    readonly bindGroupLayout: GpuBindGroupLayout;
    /** The group-3 bind group the forward pass sets. */
    readonly bindGroup: GpuBindGroup;

    private readonly device: GpuDevice;
    private readonly clusterParamsBuffer: GpuBuffer;
    private readonly lightsBuffer: GpuBuffer;
    private readonly clusterAABBsBuffer: GpuBuffer;
    private readonly clusterLightCountsBuffer: GpuBuffer;
    private readonly clusterLightIndicesBuffer: GpuBuffer;

    private readonly buildPipeline: GpuComputePipeline;
    private readonly buildBindGroup: GpuBindGroup;
    private readonly cullPipeline: GpuComputePipeline;
    private readonly cullBindGroup: GpuBindGroup;

    constructor(device: GpuDevice) {
        this.device = device;

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

        const buildBGL = device.createBindGroupLayout({
            label: "metis-engine/cluster-build-bgl",
            entries: [
                {binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: {bindingType: "uniform"}},
                {binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: {bindingType: "storage"}},
            ],
        });
        this.buildBindGroup = device.createBindGroup({
            label: "metis-engine/cluster-build-bind-group",
            layout: buildBGL,
            entries: [
                {binding: 0, buffer: {buffer: this.clusterParamsBuffer}},
                {binding: 1, buffer: {buffer: this.clusterAABBsBuffer}},
            ],
        });
        this.buildPipeline = device.createComputePipeline({
            label: "metis-engine/cluster-build-pipeline",
            layout: device.createPipelineLayout({bindGroupLayouts: [buildBGL]}),
            compute: {
                module: device.createShaderModule({
                    label: "metis-engine/cluster-build-shader",
                    code: `${commonWgsl}\n${clusterBuildWgsl}`,
                }),
                entryPoint: "build",
            },
        });

        const cullBGL = device.createBindGroupLayout({
            label: "metis-engine/light-cull-bgl",
            entries: [
                {binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: {bindingType: "uniform"}},
                {binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: {bindingType: "read-only-storage"}},
                {binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: {bindingType: "read-only-storage"}},
                {binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: {bindingType: "storage"}},
                {binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: {bindingType: "storage"}},
            ],
        });
        this.cullBindGroup = device.createBindGroup({
            label: "metis-engine/light-cull-bind-group",
            layout: cullBGL,
            entries: [
                {binding: 0, buffer: {buffer: this.clusterParamsBuffer}},
                {binding: 1, buffer: {buffer: this.lightsBuffer}},
                {binding: 2, buffer: {buffer: this.clusterAABBsBuffer}},
                {binding: 3, buffer: {buffer: this.clusterLightCountsBuffer}},
                {binding: 4, buffer: {buffer: this.clusterLightIndicesBuffer}},
            ],
        });
        this.cullPipeline = device.createComputePipeline({
            label: "metis-engine/light-cull-pipeline",
            layout: device.createPipelineLayout({bindGroupLayouts: [cullBGL]}),
            compute: {
                module: device.createShaderModule({
                    label: "metis-engine/light-cull-shader",
                    code: `${commonWgsl}\n${lightCullWgsl}`,
                }),
                entryPoint: "cull",
            },
        });

        this.bindGroupLayout = device.createBindGroupLayout({
            label: "metis-engine/cluster-lights-bgl",
            entries: [
                {binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {bindingType: "uniform"}},
                {binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: {bindingType: "read-only-storage"}},
                {binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: {bindingType: "read-only-storage"}},
                {binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: {bindingType: "read-only-storage"}},
            ],
        });
        this.bindGroup = device.createBindGroup({
            label: "metis-engine/cluster-lights-bind-group",
            layout: this.bindGroupLayout,
            entries: [
                {binding: 0, buffer: {buffer: this.clusterParamsBuffer}},
                {binding: 1, buffer: {buffer: this.lightsBuffer}},
                {binding: 2, buffer: {buffer: this.clusterLightCountsBuffer}},
                {binding: 3, buffer: {buffer: this.clusterLightIndicesBuffer}},
            ],
        });
    }

    /** Uploads the cluster params + packed point-light array for this frame. Call before `cull`. */
    write(scene: Scene, targets: RenderTargets) {
        const invProj = mat4.invert(scene.camera.projectionMatrix());
        const params = new Std140Writer();
        params.mat4(invProj);
        // clusterFar, not a projection far plane — the reverse-Z projection is
        // infinite. The cluster grid needs a finite range to slice
        // exponentially; lights past it simply aren't culled into any cluster.
        params.vec4(targets.width, targets.height, scene.camera.near, scene.camera.clusterFar);
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

    /** Records the cluster-build + light-cull compute passes. Call after `write`, before the forward pass. */
    cull(encoder: GpuCommandEncoder, profiler?: GpuProfiler) {
        const buildPass = encoder.beginComputePass({
            label: "metis-engine/cluster-build-pass",
            timestampWrites: profiler?.pass("cluster-build"),
        });
        buildPass.setPipeline(this.buildPipeline);
        buildPass.setBindGroup(0, this.buildBindGroup);
        buildPass.dispatchWorkgroups(DISPATCH_GROUPS);
        buildPass.end();

        const cullPass = encoder.beginComputePass({
            label: "metis-engine/light-cull-pass",
            timestampWrites: profiler?.pass("light-cull"),
        });
        cullPass.setPipeline(this.cullPipeline);
        cullPass.setBindGroup(0, this.cullBindGroup);
        cullPass.dispatchWorkgroups(DISPATCH_GROUPS);
        cullPass.end();
    }

    destroy() {
        this.clusterParamsBuffer.destroy();
        this.lightsBuffer.destroy();
        this.clusterAABBsBuffer.destroy();
        this.clusterLightCountsBuffer.destroy();
        this.clusterLightIndicesBuffer.destroy();
    }
}
