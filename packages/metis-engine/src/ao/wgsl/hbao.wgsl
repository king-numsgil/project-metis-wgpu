// HBAO — Horizon-Based Ambient Occlusion (Bavoil, Sainz & Dimitrov 2008; see
// math/Ambient occlusion formulas.md, Formula 2). Fullscreen fragment pass.
// For each fragment, march several screen-space directions; along each, track
// the highest horizon angle (elevation above the tangent plane) reached by
// occluding geometry, and accumulate the (attenuated) increase in horizon.
// Averaging over directions approximates the fraction of the hemisphere that is
// blocked. Writes a single-channel occlusion factor in [0,1] (1 = fully open).

struct AoUniforms {
    view: mat4x4<f32>,
    viewProj: mat4x4<f32>,
    proj: mat4x4<f32>,
    invProj: mat4x4<f32>,
    params0: vec4<f32>, // x=screenW, y=screenH, z=near, w=far
    params1: vec4<f32>, // x=radius, y=bias(radians), z=intensity, w=power
};

@group(0) @binding(0) var<uniform> ao: AoUniforms;
@group(0) @binding(1) var depthTex: texture_depth_2d;
@group(0) @binding(2) var normalTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> kernel: array<vec4<f32>, 32>; // unused by HBAO; bound for a shared layout
@group(0) @binding(4) var<uniform> noise: array<vec4<f32>, 16>;

const PI: f32 = 3.14159265359;
// Keep in sync with aoConfig.ts (HBAO_DIRECTIONS, HBAO_STEPS, AO_NOISE_DIM).
const NUM_DIRECTIONS: u32 = 6u;
const NUM_STEPS: u32 = 4u;
const NOISE_DIM: i32 = 4;
// Clamp the projected marching radius so a near-camera fragment doesn't march
// halfway across the screen (blowing up cost and reaching unrelated geometry).
const MAX_RADIUS_PIXELS: f32 = 64.0;

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
        return 1.0; // background (reverse-Z: 0 = infinitely far)
    }

    let uv = in.pos.xy / screen;
    let P = reconstructViewPos(uv, depth);
    let N = normalize(textureLoad(normalTex, coord, 0).xyz);

    let radius = ao.params1.x;
    let bias = ao.params1.y; // tangent-angle bias (radians)

    // Project the world-space radius to a pixel radius at this fragment's depth.
    // proj[1][1] = 1/tan(fovY/2) = focal length in half-viewport-height units.
    let focalY = ao.proj[1].y;
    let radiusPixels = min(radius * focalY * 0.5 * screen.y / max(-P.z, 1e-4), MAX_RADIUS_PIXELS);
    if (radiusPixels < 1.0) {
        return 1.0; // sub-pixel radius, nothing to march
    }

    // Per-pixel jitter: a random base-angle offset and a random step offset.
    let noiseIdx = (coord.y % NOISE_DIM) * NOISE_DIM + (coord.x % NOISE_DIM);
    let rnd = noise[noiseIdx].xy * 0.5 + 0.5; // [-1,1] -> [0,1]

    let stepPixels = radiusPixels / f32(NUM_STEPS);
    let horizonBias = sin(bias);

    var occlusion = 0.0;
    for (var d: u32 = 0u; d < NUM_DIRECTIONS; d = d + 1u) {
        let angle = (f32(d) + rnd.x) * (2.0 * PI / f32(NUM_DIRECTIONS));
        let dir = vec2<f32>(cos(angle), sin(angle));

        // Highest elevation (sin of angle above the tangent plane) seen so far.
        var horizonSin = horizonBias;
        for (var s: u32 = 1u; s <= NUM_STEPS; s = s + 1u) {
            let marchPixels = (f32(s) - rnd.y) * stepPixels;
            if (marchPixels < 1.0) {
                continue;
            }
            let sampleCoord = vec2<i32>(in.pos.xy + dir * marchPixels);
            let sampleUV = (vec2<f32>(sampleCoord) + 0.5) / screen;
            if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) {
                continue;
            }
            let sampleDepth = textureLoad(depthTex, sampleCoord, 0);
            if (sampleDepth <= 0.0) {
                continue; // reverse-Z background
            }

            let S = reconstructViewPos(sampleUV, sampleDepth);
            let H = S - P;
            let dist = length(H);
            if (dist < 1e-4 || dist > radius) {
                continue;
            }
            // sin(elevation above tangent plane) = cos(angle(H, N)) = dot(Ĥ, N).
            let sinElev = dot(H, N) / dist;
            if (sinElev > horizonSin) {
                // Attenuate the horizon increase by distance so distant, thin
                // occluders don't count as much as contact geometry.
                let d2 = dist / radius;
                let atten = clamp(1.0 - d2 * d2, 0.0, 1.0);
                occlusion += (sinElev - horizonSin) * atten;
                horizonSin = sinElev;
            }
        }
    }

    let intensity = ao.params1.z;
    let power = ao.params1.w;
    let openness = clamp(1.0 - (occlusion / f32(NUM_DIRECTIONS)) * intensity, 0.0, 1.0);
    return pow(openness, power);
}
