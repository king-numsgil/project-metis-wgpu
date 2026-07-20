// Depth-tested forward vertex+fragment pass. Concatenated after common.wgsl
// by clusteredForwardRenderer.ts (WGSL has no #include — see that file).

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> environment: Environment;
@group(0) @binding(2) var cascade0Moments: texture_2d<f32>; // cascade 0 MSM: E[z]..E[z^4]
@group(0) @binding(3) var momentsSampler: sampler; // non-filtering — rgba32float has no linear-filter support
@group(0) @binding(4) var<uniform> cascades: CascadeUniforms;
@group(0) @binding(5) var aoTex: texture_2d<f32>; // screen-space ambient occlusion (r8, 1 = fully open)
@group(0) @binding(6) var cascadeDepth: texture_depth_2d_array; // cascades 1..N (PCF), one layer each
@group(0) @binding(7) var cascadeCompareSampler: sampler_comparison; // hardware PCF (compare less-equal)

@group(1) @binding(0) var<uniform> material: Material;
@group(1) @binding(1) var matSampler: sampler;
@group(1) @binding(2) var albedoTex: texture_2d<f32>;
@group(1) @binding(3) var normalTex: texture_2d<f32>;
@group(1) @binding(4) var metallicTex: texture_2d<f32>;
@group(1) @binding(5) var roughnessTex: texture_2d<f32>;
@group(1) @binding(6) var emissiveTex: texture_2d<f32>;

@group(2) @binding(0) var<uniform> modelUniform: Model;

@group(3) @binding(0) var<uniform> clusterParams: ClusterParams;
@group(3) @binding(1) var<storage, read> pointLights: array<GpuPointLight>;
@group(3) @binding(2) var<storage, read> clusterLightCounts: array<u32>;
@group(3) @binding(3) var<storage, read> clusterLightIndices: array<u32>;

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) tangent: vec4<f32>, // xyz = tangent, w = bitangent sign
    @location(3) uv: vec2<f32>,
};

struct VertexOutput {
    // `@invariant` pairs with depth_prepass.wgsl: when the prepass is enabled
    // this pipeline runs `depthCompare: "equal"`, which only shades a fragment
    // whose depth matches the prepass's bit-for-bit. Without the guarantee, two
    // pipelines compiling the same expression may differ by an ULP and surfaces
    // silently vanish. Keep the vertex transform below identical to the
    // prepass's, expression for expression.
    @invariant @builtin(position) clipPosition: vec4<f32>,
    @location(0) worldPosition: vec3<f32>,
    @location(1) worldNormal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) viewZ: f32,
    @location(4) worldTangent: vec4<f32>,
};


// Hausdorff 4-moment shadow mapping (Peters & Klein 2015, Algorithm 4 /
// supplementary Listing 4): reconstructs an occlusion estimate from the first
// four power moments of the light-space occluder depth distribution
// (E[z]..E[z^4], written by shadow.wgsl's fragment shader) via a Cholesky
// factorization of their Hankel matrix, then evaluates the sharpest lower
// bound on the CDF at the query depth — *constrained to distributions
// supported on [0,1]*.
//
// That constraint is the entire reason this is the Hausdorff variant and not
// the paper's default Hamburger variant (support on all of R, previously used
// here): for the single-occluder texels this renderer's unfiltered shadow map
// always produces, the Hamburger bound "explains" the moments with phantom
// mass at *negative* depth, which yields the infamous VSM-style light-bleeding
// tail — reconstructed visibility falls off only as ~var/gap^2, so a sun
// bright enough to blow out through a window (as in the interior scene) makes
// even 0.1% residual visibility glow, producing meters-long bleed gradients
// hugging every concave corner. Depths outside [0,1] cannot exist in a shadow
// map, and forbidding them makes the bound collapse to an exact step for a
// delta-distribution texel: working Algorithm 4's four-support-point branch
// through by hand for moments b = (z0, z0², z0³, z0⁴), the free root lands
// exactly at zFree = z0 and the intensity term reduces to exactly 1 for
// query > z0 and exactly 0 for query < z0, independent of the gap size —
// verified in fp32 emulation against real GPU-readback corner data (gaps down
// to 3.4e-4 reconstruct occlusion 1.00000, lit surfaces 0.00002). Genuinely
// mixed-surface moments (e.g. from PCF-footprint averaging) still take the
// smooth three-support-point path, identical to Hamburger.
fn computeMsmOcclusion(rawMoments: vec4<f32>, queryDepth: f32) -> f32 {
    // Moment bias: blend a hair toward (0.5,0.5,0.5,0.5) so the Hankel matrix
    // below is never exactly singular (a texel with ~zero variance — which is
    // every texel here, since nothing is prefiltered before this point —
    // would otherwise divide by ~0). The (0.5,...) target is verbatim from
    // the reference listings — an earlier version used the *true* moments of
    // a uniform [0,1] distribution ((0.5, 1/3, 0.5, 0.2)) instead, which was
    // a real, user-visible regression: the asymmetric target skews the
    // reconstruction wherever the true depth sits far from 0.5 (most of this
    // scene). 1e-5 rather than the paper's 3e-5 (theirs compensates 16-bit
    // quantization this rgba32float map doesn't have): the smaller bias
    // halves the width of the residual not-yet-shadowed band at a concave
    // corner, and fp32 emulation puts the numerical cliff (Cholesky NaN) two
    // orders of magnitude lower, at ~3e-7.
    let momentBias = 1e-5;
    let b = mix(rawMoments, vec4<f32>(0.5, 0.5, 0.5, 0.5), momentBias);
    let zx = queryDepth;

    // Cholesky factorization of the Hankel matrix built from the moments,
    // producing the coefficients of a quadratic whose roots (zy, zz) are the
    // other support points of the canonical distribution through (zx, b).
    let l32d22 = b.x * -b.y + b.z;
    let d22 = -b.x * b.x + b.y;
    let squaredDepthVariance = -b.y * b.y + b.w;
    let d33d22 = dot(vec2<f32>(squaredDepthVariance, -l32d22), vec2<f32>(d22, l32d22));
    let invD22 = 1.0 / d22;
    let l32 = l32d22 * invD22;

    var c: vec3<f32> = vec3<f32>(1.0, zx, zx * zx);
    c.y = c.y - b.x;
    c.z = c.z - b.y - l32 * c.y;
    c.y = c.y * invD22;
    c.z = c.z * (d22 / d33d22);
    c.y = c.y - l32 * c.z;
    c.x = c.x - dot(c.yz, b.xy);

    let invC2 = 1.0 / c.z;
    let p = c.y * invC2;
    let q = c.x * invC2;
    let discriminant = max((p * p * 0.25) - q, 0.0);
    let r = sqrt(discriminant);
    let zy = -p * 0.5 - r;
    let zz = -p * 0.5 + r;

    var shadowIntensity: f32;
    if (zy < 0.0 || zz > 1.0) {
        // The three-support solution needs mass outside [0,1] — impossible
        // for shadow-map depths. Use the four-support solution with points
        // {0, zFree, zx, 1} instead (paper Proposition 11 / Algorithm 4 step
        // 6). This is the branch every hard single-occluder texel takes, and
        // the one that eliminates the light-bleeding tail.
        let zFree = ((b.z - b.y) * zx + b.z - b.w) / ((b.y - b.x) * zx + b.y - b.z);
        let w1Factor = select(0.0, 1.0, zx > zFree);
        shadowIntensity = (b.y - b.x + (b.z - b.x - (zFree + 1.0) * (b.y - b.x)) * (zFree - w1Factor - zx) / (zx * (zx - zFree))) / (zFree - w1Factor) + 1.0 - b.x;
    } else {
        // Well-posed three-support solution — the smooth path genuinely
        // mixed-depth moments take.
        var switchVal: vec4<f32>;
        if (zz < zx) {
            switchVal = vec4<f32>(zy, zx, 1.0, 1.0);
        } else if (zy < zx) {
            switchVal = vec4<f32>(zx, zy, 0.0, 1.0);
        } else {
            switchVal = vec4<f32>(0.0, 0.0, 0.0, 0.0);
        }
        let quotient = (switchVal.x * zz - b.x * (switchVal.x + zz) + b.y) / ((zz - switchVal.y) * (zx - zy));
        shadowIntensity = switchVal.z + switchVal.w * quotient;
    }
    return clamp(shadowIntensity, 0.0, 1.0);
}

// The normal offset (per cascade, texel-scaled) clears self-shadowing on
// sloped receivers: the 3x3 taps reach ~1.4 texels away but compare against
// this fragment's own depth, so on a slope the neighbours' stored depths differ
// by up to ~1.4 texel-footprints of slope — the offset must exceed that. It is
// sized per cascade because each cascade's texel is a different world size.
fn shadowClipUV(cascade: i32, worldPosition: vec3<f32>, N: vec3<f32>) -> vec3<f32> {
    let offsetPosition = worldPosition + N * cascades.normalOffsets[cascade];
    let lightClip = cascades.lightViewProj[cascade] * vec4<f32>(offsetPosition, 1.0);
    // Ortho projection (w = 1), so lightClip.z is already the [0,1] shadow depth.
    let uv = lightClip.xy * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5, 0.5);
    return vec3<f32>(uv, lightClip.z);
}

// Cascade 0: Hausdorff 4-moment shadow mapping (no bias -> no peter-panning,
// corner-leak-proof). 3x3 PCF over the reconstructed occlusion.
fn sampleCascade0(worldPosition: vec3<f32>, N: vec3<f32>) -> f32 {
    let cu = shadowClipUV(0, worldPosition, N);
    if (cu.x < 0.0 || cu.x > 1.0 || cu.y < 0.0 || cu.y > 1.0 || cu.z < 0.0 || cu.z > 1.0) {
        return 1.0;
    }
    let texel = 1.0 / cascades.params.y;
    var sum = 0.0;
    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            let m = textureSampleLevel(cascade0Moments, momentsSampler, cu.xy + vec2<f32>(f32(dx), f32(dy)) * texel, 0.0);
            sum += 1.0 - computeMsmOcclusion(m, cu.z);
        }
    }
    return sum / 9.0;
}

// Cascades 1..N: plain depth + hardware comparison PCF (3x3 taps, each a 2x2
// bilinear compare via the linear comparison sampler -> effectively 4x4). The
// shadow depth is standard-Z (near=0 = closest to light), and the sampler's
// "less-equal" compare returns the fraction of texels the receiver is in front
// of — i.e. the lit fraction.
fn samplePcfCascade(cascade: i32, worldPosition: vec3<f32>, N: vec3<f32>) -> f32 {
    let layer = cascade - 1;
    let cu = shadowClipUV(cascade, worldPosition, N);
    if (cu.x < 0.0 || cu.x > 1.0 || cu.y < 0.0 || cu.y > 1.0 || cu.z < 0.0 || cu.z > 1.0) {
        return 1.0;
    }
    let texel = 1.0 / cascades.params.y;
    var sum = 0.0;
    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            let o = vec2<f32>(f32(dx), f32(dy)) * texel;
            sum += textureSampleCompareLevel(cascadeDepth, cascadeCompareSampler, cu.xy + o, layer, cu.z);
        }
    }
    return sum / 9.0;
}

fn sampleCascadeVis(cascade: i32, worldPosition: vec3<f32>, N: vec3<f32>) -> f32 {
    if (cascade == 0) {
        return sampleCascade0(worldPosition, N);
    }
    return samplePcfCascade(cascade, worldPosition, N);
}

// Cascaded directional shadow: pick the cascade whose slice contains this
// fragment's view-space depth, then cross-fade into the next across a small
// band at the far edge so the resolution step is invisible. Past the last
// cascade's far boundary, everything is fully lit.
fn sampleSunShadow(worldPosition: vec3<f32>, N: vec3<f32>, linearDepth: f32) -> f32 {
    let count = i32(cascades.params.x);
    if (linearDepth >= cascades.splitFar[count - 1]) {
        return 1.0;
    }

    var c = 0;
    for (var i = 0; i < count; i = i + 1) {
        if (linearDepth < cascades.splitFar[i]) {
            c = i;
            break;
        }
    }

    var vis = sampleCascadeVis(c, worldPosition, N);

    if (c < count - 1) {
        let nearEdge = select(0.0, cascades.splitFar[max(c - 1, 0)], c > 0);
        let farEdge = cascades.splitFar[c];
        let band = (farEdge - nearEdge) * cascades.params.z;
        if (band > 0.0 && linearDepth > farEdge - band) {
            let t = clamp((linearDepth - (farEdge - band)) / band, 0.0, 1.0);
            vis = mix(vis, sampleCascadeVis(c + 1, worldPosition, N), t);
        }
    }
    return vis;
}

@vertex
fn vs(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    let worldPos4 = modelUniform.model * vec4<f32>(input.position, 1.0);
    out.worldPosition = worldPos4.xyz;
    out.worldNormal = normalize(modelUniform.normalMat * input.normal);
    out.worldTangent = vec4<f32>(normalize(modelUniform.normalMat * input.tangent.xyz), input.tangent.w);
    out.uv = input.uv;
    out.viewZ = (camera.view * worldPos4).z;
    out.clipPosition = camera.viewProj * worldPos4;
    return out;
}

@fragment
fn fs(input: VertexOutput) -> @location(0) vec4<f32> {
    let geometricNormal = normalize(input.worldNormal);
    let V = normalize(camera.position - input.worldPosition);

    // Tangent-space normal map -> world space, via the per-vertex TBN basis.
    // `albedoTex`/`normalTex`/etc. default to neutral 1x1 placeholders when a
    // material has no texture of that kind (see scene/material.ts), so this
    // is a no-op for factor-only materials.
    let T = normalize(input.worldTangent.xyz);
    let B = cross(geometricNormal, T) * input.worldTangent.w;
    let tbn = mat3x3<f32>(T, B, geometricNormal);
    let normalSample = textureSample(normalTex, matSampler, input.uv).rgb * 2.0 - 1.0;
    let N = normalize(tbn * normalSample);

    let albedo = material.baseColor.rgb * textureSample(albedoTex, matSampler, input.uv).rgb;
    let metallic = clamp(material.metallicRoughness.x * textureSample(metallicTex, matSampler, input.uv).r, 0.0, 1.0);
    let roughness = clamp(material.metallicRoughness.y * textureSample(roughnessTex, matSampler, input.uv).r, 0.045, 1.0);
    let emissive = material.emissive * textureSample(emissiveTex, matSampler, input.uv).rgb;

    var color = vec3<f32>(0.0);

    // Directional sun — always present; "interior" vs "exterior" is purely
    // ambientIntensity + whether geometry (now including real shadowing)
    // lets the sun reach the fragment.
    let sunL = normalize(-environment.sunDirection);
    let sunRadiance = environment.sunColorIntensity.rgb * environment.sunColorIntensity.a;
    // -viewZ is the positive view-space depth, used to select the shadow cascade.
    let sunVisibility = sampleSunShadow(input.worldPosition, geometricNormal, -input.viewZ);
    color += shadeLight(N, V, sunL, sunRadiance, albedo, metallic, roughness) * sunVisibility;

    // Flat ambient fill (the documented handwave for bounce light indoors),
    // attenuated by screen-space ambient occlusion. AO approximates how much of
    // the surrounding hemisphere is blocked by nearby geometry, so it modulates
    // *only* this indirect/ambient term — never the sun or point lights, whose
    // occlusion is the shadow map's job. The AO buffer is full-res single-sample
    // (the forward pass is MSAA); fragCoord indexes it 1:1. When AO is disabled
    // the renderer clears this buffer to white, so this is a no-op multiply.
    let ao = textureLoad(aoTex, vec2<i32>(input.clipPosition.xy), 0).r;
    color += environment.ambientColorIntensity.rgb * environment.ambientColorIntensity.a * albedo * ao;

    // Clustered point lights — look up this fragment's cluster and shade
    // only the lights the culling compute pass assigned to it.
    let linearDepth = -input.viewZ;
    let clusterIndex = clusterIndexFromFragment(input.clipPosition.xy, linearDepth, clusterParams);
    let maxPerCluster = clusterParams.clusterCounts.w;
    let lightCountInCluster = clusterLightCounts[clusterIndex];
    for (var i: u32 = 0u; i < lightCountInCluster; i = i + 1u) {
        let lightIndex = clusterLightIndices[clusterIndex * maxPerCluster + i];
        let light = pointLights[lightIndex];
        let toLight = light.worldPosition - input.worldPosition;
        let distSq = dot(toLight, toLight);
        // Per-fragment range rejection. A cluster's light list is inherently
        // conservative — a light is added if it touches *any* part of the
        // cluster's AABB, so most fragments in that cluster are out of its
        // range. Measured on bench/lights.ts at 200 lights: 34 lights assigned
        // per fragment, only 8 actually in range.
        //
        // This is free of visual consequence: pointLightAttenuation's window
        // term is exactly 0 at dist >= range, so these lights were already
        // contributing exactly nothing — the full Cook-Torrance BRDF was being
        // evaluated and then multiplied by zero. Squared-distance compare, so a
        // rejected light doesn't even pay for the sqrt.
        if (distSq >= light.range * light.range) {
            continue;
        }
        let dist = sqrt(distSq);
        let L = toLight / max(dist, 1e-5);
        let attenuation = pointLightAttenuation(dist, light.range);
        let radiance = light.color * light.intensity * attenuation;
        color += shadeLight(N, V, L, radiance, albedo, metallic, roughness);
    }

    color += emissive;

    return vec4<f32>(color, material.baseColor.a);
}
