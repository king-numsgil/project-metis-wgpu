// Shared structs + the metallic-roughness Cook-Torrance BRDF.
// GGX distribution / Smith geometry (Schlick-GGX) / Schlick Fresnel — see
// math/PBR shading formulas.md (Formulas 1-4), following Karis 2013
// ("Real Shading in Unreal Engine 4").

struct Camera {
    viewProj: mat4x4<f32>,
    view: mat4x4<f32>,
    position: vec3<f32>,
};

struct Environment {
    sunDirection: vec3<f32>,
    sunColorIntensity: vec4<f32>,     // rgb = color, a = intensity
    ambientColorIntensity: vec4<f32>, // rgb = color, a = intensity
};

struct Material {
    baseColor: vec4<f32>,
    metallicRoughness: vec4<f32>, // x = metallic, y = roughness
    emissive: vec3<f32>,
};

struct Model {
    model: mat4x4<f32>,
    normalMat: mat3x3<f32>,
};

// One light-space matrix for the shadow *render* passes — bound one cascade at
// a time via an offset bind group (shadow.wgsl).
struct ShadowUniforms {
    lightViewProj: mat4x4<f32>,
};

// The full cascade set consumed by the forward *sampling* pass. Keep in sync
// with clusteredForwardRenderer.ts's CASCADE_FORWARD_SIZE and cascade writes.
const CASCADE_COUNT: u32 = 4u;
struct CascadeUniforms {
    lightViewProj: array<mat4x4<f32>, 4>, // one ortho light-view-proj per cascade
    splitFar: vec4<f32>,                  // far view-depth boundary of cascades 0..3
    // Per-cascade world-space normal offset (texel-scaled). Not a constant: the
    // offset must clear the depth spread of the PCF footprint, which scales with
    // each cascade's texel size, so a fixed value silently under-biases the
    // coarse far cascades (acne) or over-biases the fine near one (peter-panning).
    normalOffsets: vec4<f32>,
    params: vec4<f32>,                    // x = cascade count, y = shadow map size, z = blend fraction
};

const PI: f32 = 3.14159265359;

// Formula 1 — GGX / Trowbridge-Reitz normal distribution.
fn distributionGGX(N: vec3<f32>, H: vec3<f32>, roughness: f32) -> f32 {
    let a = roughness * roughness;
    let a2 = a * a;
    let NdotH = max(dot(N, H), 0.0);
    let NdotH2 = NdotH * NdotH;
    let denom = NdotH2 * (a2 - 1.0) + 1.0;
    return a2 / (PI * denom * denom + 1e-7);
}

// Formula 2 — Schlick-GGX geometry term (single direction).
fn geometrySchlickGGX(NdotV: f32, roughness: f32) -> f32 {
    let r = roughness + 1.0;
    let k = (r * r) / 8.0; // direct-lighting remap, not IBL
    return NdotV / (NdotV * (1.0 - k) + k);
}

// Formula 2 (cont.) — Smith's method: multiply the view- and light-side terms.
fn geometrySmith(N: vec3<f32>, V: vec3<f32>, L: vec3<f32>, roughness: f32) -> f32 {
    let NdotV = max(dot(N, V), 0.0);
    let NdotL = max(dot(N, L), 0.0);
    return geometrySchlickGGX(NdotV, roughness) * geometrySchlickGGX(NdotL, roughness);
}

// Formula 3 — Fresnel-Schlick approximation.
fn fresnelSchlick(cosTheta: f32, F0: vec3<f32>) -> vec3<f32> {
    return F0 + (vec3<f32>(1.0) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

// Formula 4 — full Cook-Torrance: diffuse (Lambertian, energy-conserving via
// (1-F)) + specular (GGX/Smith/Fresnel), for one light of given incoming
// radiance arriving from direction `L`.
fn shadeLight(
    N: vec3<f32>,
    V: vec3<f32>,
    L: vec3<f32>,
    radiance: vec3<f32>,
    albedo: vec3<f32>,
    metallic: f32,
    roughness: f32,
) -> vec3<f32> {
    let NdotL = max(dot(N, L), 0.0);
    if (NdotL <= 0.0) {
        return vec3<f32>(0.0);
    }

    let H = normalize(V + L);
    let F0 = mix(vec3<f32>(0.04), albedo, metallic);
    let NDF = distributionGGX(N, H, roughness);
    let G = geometrySmith(N, V, L, roughness);
    let F = fresnelSchlick(max(dot(H, V), 0.0), F0);

    let specular = (NDF * G * F) / (4.0 * max(dot(N, V), 0.0) * NdotL + 1e-4);
    let kD = (vec3<f32>(1.0) - F) * (1.0 - metallic);
    let diffuse = kD * albedo / PI;

    return (diffuse + specular) * radiance * NdotL;
}

// Inverse-square falloff clamped to `range`, windowed so contribution reaches
// exactly zero at the culling radius (matches the sphere test light_cull.wgsl
// uses, so a lit fragment never "pops" as a light leaves its cluster).
fn pointLightAttenuation(distance: f32, range: f32) -> f32 {
    let falloff = 1.0 / max(distance * distance, 1e-4);
    let window = clamp(1.0 - pow(distance / range, 4.0), 0.0, 1.0);
    return falloff * window * window;
}

// ── Clustered light culling — shared types ──────────────────────────────────
// See math/Clustered forward formulas.md. Cluster grid is a fixed
// clusterCounts.xyz tiling of the viewport; Z slices are exponential (Doom
// 2016 / Olsson-Assarsson) so near-camera clusters stay thin.

struct ClusterParams {
    invProj: mat4x4<f32>,
    screenSizeZNearFar: vec4<f32>, // x=width, y=height, z=zNear, w=zFar
    clusterCounts: vec4<u32>,      // x,y,z counts, w=maxLightsPerCluster
    lightCount: vec4<u32>,         // x=active point light count
};

struct GpuPointLight {
    worldPosition: vec3<f32>,
    range: f32,
    viewPosition: vec3<f32>,
    intensity: f32,
    color: vec3<f32>,
    _pad: f32,
};

struct ClusterAABB {
    minPoint: vec3<f32>,
    _pad0: f32,
    maxPoint: vec3<f32>,
    _pad1: f32,
};

// Formula (Doom 2016 exponential Z-slicing, inverted): maps a positive
// view-space depth to its cluster Z slice.
fn clusterZIndex(linearDepth: f32, zNear: f32, zFar: f32, sliceCount: u32) -> u32 {
    let denom = log(zFar / zNear);
    let scale = f32(sliceCount) / denom;
    let bias = -f32(sliceCount) * log(zNear) / denom;
    let zIndexF = log(max(linearDepth, zNear)) * scale + bias;
    return u32(clamp(zIndexF, 0.0, f32(sliceCount) - 1.0));
}

fn clusterIndexFromFragment(fragXY: vec2<f32>, linearDepth: f32, params: ClusterParams) -> u32 {
    let tileSize = params.screenSizeZNearFar.xy / vec2<f32>(params.clusterCounts.xy);
    let tileX = min(u32(fragXY.x / tileSize.x), params.clusterCounts.x - 1u);
    let tileY = min(u32(fragXY.y / tileSize.y), params.clusterCounts.y - 1u);
    let tileZ = clusterZIndex(linearDepth, params.screenSizeZNearFar.z, params.screenSizeZNearFar.w, params.clusterCounts.z);
    return tileX + tileY * params.clusterCounts.x + tileZ * params.clusterCounts.x * params.clusterCounts.y;
}
