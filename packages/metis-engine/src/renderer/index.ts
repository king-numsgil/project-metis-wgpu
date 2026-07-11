export { RenderContext } from "./rhi/context.ts";
export type { Backend, FrameTarget, PowerPreference, RenderContextOptions } from "./rhi/context.ts";
export { DEPTH_FORMAT, HDR_COLOR_FORMAT, RenderTargets } from "./rhi/targets.ts";

export { Camera } from "./math/camera.ts";
export { createTransform, normalMatrixFromModel, transformToMat4 } from "./math/transform.ts";
export type { Transform } from "./math/transform.ts";

export { cube, plane, roomBox, uvSphere } from "./assets/primitives.ts";
export type { MeshData, WindowCutout } from "./assets/primitives.ts";
export { loadGltf } from "./assets/gltf.ts";
export { getMaterialDefaults, loadTexture } from "./assets/texture.ts";
export type { LoadedTexture, MaterialDefaults } from "./assets/texture.ts";

export { Mesh, MESH_VERTEX_LAYOUT } from "./scene/mesh.ts";
export { Material } from "./scene/material.ts";
export type { MaterialParams } from "./scene/material.ts";
export type { PointLight } from "./scene/light.ts";
export { createExteriorEnvironment, createInteriorEnvironment } from "./scene/environment.ts";
export type { Environment } from "./scene/environment.ts";
export { Scene, SceneInstance } from "./scene/scene.ts";

export { ClusteredForwardRenderer } from "./shading/clusteredForwardRenderer.ts";
export * from "./shading/clusterConfig.ts";
export { Std140Writer } from "./shading/std140.ts";

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

export { VectorText } from "./text/vectorText.ts";
