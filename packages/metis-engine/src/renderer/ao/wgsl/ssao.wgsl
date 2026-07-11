// SSAO — Crytek 2007, normal-oriented hemisphere variant (see
// math/Ambient occlusion formulas.md, Formula 1). Fullscreen fragment pass:
// for each fragment, reconstruct its view-space position/normal, then scatter a
// random hemisphere kernel around it and count how many samples land *behind*
// the depth buffer (i.e. buried in nearby geometry). Writes a single-channel
// occlusion factor in [0,1] (1 = fully open).

struct AoUniforms {
    view: mat4x4<f32>,
    viewProj: mat4x4<f32>,
    proj: mat4x4<f32>,
    invProj: mat4x4<f32>,
    params0: vec4<f32>, // x=screenW, y=screenH, z=near, w=far
    params1: vec4<f32>, // x=radius, y=bias, z=intensity, w=power
};

@group(0) @binding(0) var<uniform> ao: AoUniforms;
@group(0) @binding(1) var depthTex: texture_depth_2d;
@group(0) @binding(2) var normalTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> kernel: array<vec4<f32>, 32>;
@group(0) @binding(4) var<uniform> noise: array<vec4<f32>, 16>;

// Keep in sync with aoConfig.ts (SSAO_KERNEL_SIZE, AO_NOISE_DIM).
const KERNEL_SIZE: u32 = 32u;
const NOISE_DIM: i32 = 4;

// Reconstruct a view-space position from a pixel's [0,1] uv + hardware depth.
// WebGPU NDC is x,y in [-1,1] (y up) and z in [0,1]; uv is y-down, so y flips.
fn reconstructViewPos(uv: vec2<f32>, depth: f32) -> vec3<f32> {
    let ndc = vec4<f32>(uv.x * 2.0 - 1.0, (1.0 - uv.y) * 2.0 - 1.0, depth, 1.0);
    let v = ao.invProj * ndc;
    return v.xyz / v.w;
}

struct VOut {
    @builtin(position) pos: vec4<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
    let x = f32((vi << 1u) & 2u) * 2.0 - 1.0;
    let y = f32(vi & 2u) * 2.0 - 1.0;
    var out: VOut;
    out.pos = vec4<f32>(x, y, 0.0, 1.0);
    return out;
}

@fragment
fn fs(in: VOut) -> @location(0) f32 {
    let screen = ao.params0.xy;
    let coord = vec2<i32>(in.pos.xy);
    let depth = textureLoad(depthTex, coord, 0);
    if (depth <= 0.0) {
        return 1.0; // background — nothing to occlude (reverse-Z: 0 = infinitely far)
    }

    let uv = in.pos.xy / screen;
    let P = reconstructViewPos(uv, depth);
    let N = normalize(textureLoad(normalTex, coord, 0).xyz);

    // Per-pixel random rotation (tiled) -> Gram-Schmidt TBN, decorrelating the
    // kernel between neighbours so the blur can average the noise out.
    let noiseIdx = (coord.y % NOISE_DIM) * NOISE_DIM + (coord.x % NOISE_DIM);
    let randomVec = noise[noiseIdx].xyz;
    let tangent = normalize(randomVec - N * dot(randomVec, N));
    let bitangent = cross(N, tangent);
    let tbn = mat3x3<f32>(tangent, bitangent, N);

    let radius = ao.params1.x;
    let bias = ao.params1.y;

    var occlusion = 0.0;
    for (var i: u32 = 0u; i < KERNEL_SIZE; i = i + 1u) {
        // View-space sample position around P, oriented into the hemisphere.
        let samplePos = P + (tbn * kernel[i].xyz) * radius;

        // Project to screen to look up the actual geometry depth there.
        var clip = ao.proj * vec4<f32>(samplePos, 1.0);
        clip = clip / clip.w;
        let sampleUV = vec2<f32>(clip.x * 0.5 + 0.5, 0.5 - clip.y * 0.5);
        if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) {
            continue;
        }

        let sampleCoord = vec2<i32>(sampleUV * screen);
        let sampleDepth = textureLoad(depthTex, sampleCoord, 0);
        if (sampleDepth <= 0.0) {
            continue; // no occluder at this screen location (reverse-Z background)
        }
        let storedPos = reconstructViewPos(sampleUV, sampleDepth);

        // View space looks down -Z, so a surface *closer* to the camera has the
        // *larger* (less negative) z. The sample is occluded if the real
        // geometry sits in front of it (storedPos.z >= samplePos.z + bias).
        // The range check discards occluders far in depth from P, which would
        // otherwise produce dark halos around silhouettes.
        let rangeCheck = smoothstep(0.0, 1.0, radius / max(abs(P.z - storedPos.z), 1e-5));
        occlusion += select(0.0, rangeCheck, storedPos.z >= samplePos.z + bias);
    }

    let intensity = ao.params1.z;
    let power = ao.params1.w;
    let openness = clamp(1.0 - (occlusion / f32(KERNEL_SIZE)) * intensity, 0.0, 1.0);
    return pow(openness, power);
}
