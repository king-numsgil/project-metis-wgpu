import {
    type GpuBindGroup,
    type GpuBindGroupLayout,
    type GpuBuffer,
    GPUBufferUsage,
    type GpuCommandEncoder,
    type GpuComputePipeline,
    type GpuDevice,
    GPUShaderStage,
} from "metis-native";
import { Mat4, Vec3 } from "metis-data";
import type { GpuProfiler } from "../debug/gpuProfiler.ts";
import { type Mat4f, mat4f, type Vec3f } from "../math/types.ts";
import type { RenderTargets } from "../rhi/targets.ts";
import type { Light, SpotLight } from "../scene/light.ts";
import type { Scene } from "../scene/scene.ts";
import {
    CLUSTER_COUNT_X,
    CLUSTER_COUNT_Y,
    CLUSTER_COUNT_Z,
    COMPUTE_WORKGROUP_SIZE,
    MAX_LIGHTS_PER_CLUSTER,
    MAX_LIGHTS,
    NUM_CLUSTERS,
} from "./clusterConfig.ts";
import { ClusterParams, GpuLight, GpuLightArray, stage, stageArray } from "./gpuLayouts.ts";
import clusterBuildWgsl from "./wgsl/cluster_build.wgsl" with { type: "text" };
import commonWgsl from "./wgsl/common.wgsl" with { type: "text" };
import lightCullWgsl from "./wgsl/light_cull.wgsl" with { type: "text" };

const CLUSTER_AABB_STRIDE = 32; // vec3+pad, vec3+pad — written by the shader only, no CPU layout needed
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
    private readonly paramsBytes: Uint8Array;
    private readonly paramsStaging: {
        invProj: Mat4f;
        screenAndDepth: Float32Array;
        counts: Uint32Array;
        lightCount: Uint32Array;
        cameraNear: Float32Array;
    };
    private readonly lightsBytes: Uint8Array;
    private readonly lightStaging: Array<{
        worldPositionRange: Float32Array;
        worldPosition: Vec3f;
        viewPositionIntensity: Float32Array;
        viewPosition: Vec3f;
        colorCosOuter: Float32Array;
        directionSpotScale: Float32Array;
        worldDirection: Vec3f;
    }>;
    /** Per-frame scratch, so `write` allocates no matrices. */
    private readonly viewScratch = mat4f();
    private readonly projScratch = mat4f();
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

        // Sizes and offsets come from gpuLayouts.ts; the staging buffers are
        // allocated once here and rewritten in place each frame.
        const params = stage(ClusterParams);
        this.paramsBytes = params.bytes;
        this.paramsStaging = {
            // Aliases the upload bytes — `Mat4.invert` writes its result there.
            invProj: params.mat4("invProj"),
            screenAndDepth: params.f32("screenAndDepth", 4),
            counts: params.u32("counts", 4),
            lightCount: params.u32("lightCount", 4),
            cameraNear: params.f32("cameraNear", 4),
        };
        this.paramsStaging.counts[0] = CLUSTER_COUNT_X;
        this.paramsStaging.counts[1] = CLUSTER_COUNT_Y;
        this.paramsStaging.counts[2] = CLUSTER_COUNT_Z;
        this.paramsStaging.counts[3] = MAX_LIGHTS_PER_CLUSTER;

        const lights = stageArray(GpuLightArray, GpuLight);
        this.lightsBytes = lights.bytes;
        // Per-light member views, built once. Indexing these per frame is a
        // typed-array store; the old path pushed every component onto a JS
        // number[] and then walked it with DataView.setFloat32 — 6144 calls a
        // frame at MAX_LIGHTS.
        this.lightStaging = [];
        for (let i = 0; i < MAX_LIGHTS; i++) {
            this.lightStaging.push({
                // Each vec3 is followed by its paired scalar in the same 16-byte
                // slot, so a 4-element view covers both: [x, y, z, scalar]. The
                // `Vec3f` beside it aliases the same three floats, so a vec3 op
                // writes xyz in place and the line after it stores the scalar.
                worldPositionRange: lights.elementF32(i, "worldPosition", 4),
                worldPosition: lights.elementVec3(i, "worldPosition"),
                viewPositionIntensity: lights.elementF32(i, "viewPosition", 4),
                viewPosition: lights.elementVec3(i, "viewPosition"),
                colorCosOuter: lights.elementF32(i, "color", 4),
                directionSpotScale: lights.elementF32(i, "worldDirection", 4),
                worldDirection: lights.elementVec3(i, "worldDirection"),
            });
        }

        this.clusterParamsBuffer = device.createBuffer({
            label: "metis-engine/cluster-params",
            size: ClusterParams.byteSize,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.lightsBuffer = device.createBuffer({
            label: "metis-engine/point-lights",
            size: GpuLightArray.byteSize,
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

    /**
     * Uploads the cluster params + packed light array for this frame. Call
     * before {@link cull}. Lights past `MAX_LIGHTS` are dropped with a warning.
     *
     * @param targets only its `width`/`height` are read — the grid's screen tiling.
     * @param shadowSpots exactly what `selectShadowCastingSpots` returned this
     *   frame. These are packed **first**, so a light's buffer index doubles as
     *   its spot-shadow-map layer; `SpotShadows.render` must be handed the same
     *   array, or fragments get shadowed by the wrong light's map.
     */
    write(scene: Scene, targets: RenderTargets, shadowSpots: SpotLight[] = []) {
        const p = this.paramsStaging;
        Mat4.invert(p.invProj, scene.camera.projectionMatrix(this.projScratch));
        // clusterFar, not a projection far plane — the reverse-Z projection is
        // infinite. The cluster grid needs a finite range to slice
        // exponentially; lights past it simply aren't culled into any cluster.
        // The grid slices over [clusterNear, clusterFar] — deliberately not the
        // projection's near plane, which is far too small to slice against.
        // See Camera.clusterNear.
        const clusterNear = Math.max(scene.camera.clusterNear, 1e-4);
        p.screenAndDepth[0] = targets.width;
        p.screenAndDepth[1] = targets.height;
        p.screenAndDepth[2] = clusterNear;
        p.screenAndDepth[3] = scene.camera.clusterFar;
        // `counts` is constant and was written once at construction.
        // Shadow-casting spots first, in exactly the order SpotShadows rendered
        // them: a light's buffer index doubles as its shadow-map layer, which is
        // what keeps GpuLight at 64 bytes with no shadow-index field. Get this
        // ordering wrong and fragments are shadowed by the wrong light's map —
        // a plausible-looking image, not a crash. `orderedLights` is derived
        // once per frame by the renderer and shared with SpotShadows precisely
        // so the two cannot disagree.
        const casters = new Set<Light>(shadowSpots);
        const ordered: Light[] = [...shadowSpots, ...scene.lights.filter((l) => !casters.has(l))];
        const lightCount = Math.min(ordered.length, MAX_LIGHTS);
        p.lightCount[0] = lightCount;
        // True camera near — slice 0's AABB reaches down to this so geometry
        // closer than clusterNear keeps a correct light list.
        p.cameraNear[0] = scene.camera.near;
        this.device.queue.writeBuffer(this.clusterParamsBuffer, 0, this.paramsBytes);

        const view = scene.camera.viewMatrix(this.viewScratch);
        for (let i = 0; i < lightCount; i++) {
            const light = ordered[i]!;
            const s = this.lightStaging[i]!;

            // Every write below lands *directly* in the packed GpuLight slot —
            // there is no intermediate vector anywhere in this loop. The vec3
            // ops are out-first onto a `Vec3f` that aliases the slot's xyz, so
            // each fills xyz and leaves the paired scalar for the assignment on
            // the next line. Producing a fresh vector and copying it in (the
            // obvious way to write this) would cost an allocation and three
            // extra stores per light, at up to MAX_LIGHTS a frame.
            Vec3.copy(s.worldPosition, light.position);
            s.worldPositionRange[3] = light.range;

            Vec3.transformMat4(s.viewPosition, light.position, view);
            s.viewPositionIntensity[3] = light.intensity;

            s.colorCosOuter[0] = light.color[0];
            s.colorCosOuter[1] = light.color[1];
            s.colorCosOuter[2] = light.color[2];

            // A point light is encoded as a cone that can't reject anything:
            // cosOuter = -2 is below every possible cos, and spotScale = 1 then
            // saturates the shader's clamp to exactly 1.0. See common.wgsl's
            // spotAttenuation — this is what keeps the forward loop branchless.
            if (light.kind === "spot") {
                const cosInner = Math.cos(light.innerAngle);
                const cosOuter = Math.cos(light.outerAngle);
                // Guard the reciprocal: outerAngle <= innerAngle (a degenerate
                // or inverted cone) would divide by ~0. Clamping the
                // denominator turns that into a hard-edged cone instead of Inf.
                s.colorCosOuter[3] = cosOuter;
                Vec3.normalize(s.worldDirection, light.direction);
                s.directionSpotScale[3] = 1 / Math.max(cosInner - cosOuter, 1e-4);
            } else {
                s.colorCosOuter[3] = -2;
                // Zeroed explicitly rather than left stale: the staging buffer
                // persists across frames now, so a slot that held a spot last
                // frame would otherwise keep its direction.
                s.directionSpotScale[0] = 0;
                s.directionSpotScale[1] = 0;
                s.directionSpotScale[2] = 0;
                s.directionSpotScale[3] = 1;
            }
        }
        if (lightCount > 0) {
            // Upload only the live prefix — the tail is stale but never read,
            // since the shader loops to `lightCount`.
            this.device.queue.writeBuffer(
                this.lightsBuffer,
                0,
                this.lightsBytes.subarray(0, lightCount * GpuLight.byteSize),
            );
        }
        if (ordered.length > MAX_LIGHTS) {
            console.warn(
                `metis-engine: scene has ${ordered.length} lights, ` +
                `only the first ${MAX_LIGHTS} are rendered (MAX_LIGHTS).`,
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

    /** Releases every cluster/light buffer. The bind groups referencing them become unusable. */
    destroy() {
        this.clusterParamsBuffer.destroy();
        this.lightsBuffer.destroy();
        this.clusterAABBsBuffer.destroy();
        this.clusterLightCountsBuffer.destroy();
        this.clusterLightIndicesBuffer.destroy();
    }
}
