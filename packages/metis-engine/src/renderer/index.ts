/**
 * The renderer's public surface, reached from outside as `metis-engine/renderer`.
 *
 * The three pieces a frame needs are `RenderTargets`, `ClusteredForwardRenderer`,
 * and `createDefaultPostProcessPipeline` — all derived from a `GpuDevice` alone.
 * `RenderContext` is an optional bootstrapper that creates the device, window and
 * surface for you; skip it if your app already owns those (DOC.md §1.3).
 */

export { RenderContext } from "./rhi/context.ts";
export type { Backend, FrameTarget, PowerPreference, RenderContextOptions } from "./rhi/context.ts";
export { DEPTH_FORMAT, HDR_COLOR_FORMAT, RenderTargets } from "./rhi/targets.ts";
export { FrameLimiter } from "./frameLimiter.ts";

export { Camera } from "./math/camera.ts";
export { createTransform, normalMatrixFromModel, transformToMat4 } from "./math/transform.ts";
export type { Transform } from "./math/transform.ts";
// The renderer's math types and their constructors. Everything positional in
// the public API (`Camera.position`, `Light.position`, `Transform.*`,
// `Environment.sunDirection`) is one of these, so a consumer needs them; the
// ops themselves come straight from `metis-data` (`Vec3`, `Mat4`, `Quat`, …).
export { mat3f, mat4f, quatf, vec2f, vec3f, vec4f } from "./math/types.ts";
export type { Mat3f, Mat4f, Quatf, Vec2f, Vec3f, Vec4f } from "./math/types.ts";

export { cube, plane, roomBox, uvSphere } from "./assets/primitives.ts";
export type { MeshData, WindowCutout } from "./assets/primitives.ts";
export { loadGltf } from "./assets/gltf.ts";
export { getMaterialDefaults, loadTexture } from "./assets/texture.ts";
export type { LoadedTexture, MaterialDefaults } from "./assets/texture.ts";

export { Mesh, MESH_VERTEX_LAYOUT } from "./scene/mesh.ts";
export { Material } from "./scene/material.ts";
export type { MaterialParams } from "./scene/material.ts";
export type { Light, PointLight, SpotLight } from "./scene/light.ts";
export { createExteriorEnvironment, createInteriorEnvironment } from "./scene/environment.ts";
export type { Environment } from "./scene/environment.ts";
export { Scene, SceneInstance } from "./scene/scene.ts";

export { ClusteredForwardRenderer } from "./shading/clusteredForwardRenderer.ts";
export { MAX_SHADOW_SPOTS, SPOT_SHADOW_MAP_SIZE } from "./shading/spotShadows.ts";
export * from "./shading/clusterConfig.ts";
export { CASCADE_COUNT, SHADOW_MAP_SIZE } from "./shading/shadowConfig.ts";
// GPU struct layouts — the TypeScript half of wgsl/common.wgsl. Exported so a
// caller adding its own pass can size a buffer from the same descriptors the
// renderer uses, rather than recomputing an offset by hand.
export * from "./shading/gpuLayouts.ts";

export { AmbientOcclusion } from "./ao/ambientOcclusion.ts";
export {
    AoTechnique,
    AO_NOISE_DIM,
    HBAO_DEFAULTS,
    HBAO_DIRECTIONS,
    HBAO_STEPS,
    SSAO_DEFAULTS,
    SSAO_KERNEL_SIZE,
} from "./ao/aoConfig.ts";
export type { AoTuning } from "./ao/aoConfig.ts";
export { generateAoNoise, generateSsaoKernel, mulberry32 } from "./ao/aoKernel.ts";

export {
    createDefaultPostProcessPipeline,
    PostProcessPipeline,
} from "./postprocess/pipeline.ts";
export type { DefaultPostProcessPipeline, PostProcessFrameContext, PostProcessPass } from "./postprocess/pipeline.ts";
export { ExposureState } from "./postprocess/exposureState.ts";
export { LuminanceAveragePass } from "./postprocess/luminanceAverage.ts";
export { AutoExposurePass } from "./postprocess/autoExposure.ts";
export { TonemapPass } from "./postprocess/tonemap.ts";

export { MAX_PALETTE_COLORS, type Rgba, VectorText } from "./text/vectorText.ts";

export { GpuProfiler, gpuProfilerFeatures, gpuProfilerSupport } from "./debug/gpuProfiler.ts";
export type { GpuProfilerSupport, ProfileSpan } from "./debug/gpuProfiler.ts";
export { DEBUG_THEME, DebugOverlay, History, profileSpansToRows } from "./debug/widgets.ts";
export type { GraphSeries, GraphSpec, TreeRow, TreeSpec } from "./debug/widgets.ts";
