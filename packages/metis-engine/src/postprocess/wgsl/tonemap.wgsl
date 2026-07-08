// Fullscreen-triangle pass: exposure * ACES filmic tonemap. No sampler is
// needed since output resolution always matches the HDR input 1:1 —
// textureLoad reads the exact texel. See math/Tonemapping and exposure
// formulas.md (Formula 2, Narkowicz 2015 ACES fit) for the curve derivation.

@group(0) @binding(0) var hdrTex: texture_2d<f32>;
@group(0) @binding(1) var<storage, read> exposureBuf: array<f32>;

struct VOut {
    @builtin(position) pos: vec4<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32) -> VOut {
    // Classic "big triangle" covering the whole viewport with 3 vertices.
    let x = f32((vertexIndex << 1u) & 2u) * 2.0 - 1.0;
    let y = f32(vertexIndex & 2u) * 2.0 - 1.0;
    var out: VOut;
    out.pos = vec4<f32>(x, y, 0.0, 1.0);
    return out;
}

fn acesFilmic(x: vec3<f32>) -> vec3<f32> {
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn fs(in: VOut) -> @location(0) vec4<f32> {
    let texel = vec2<i32>(i32(in.pos.x), i32(in.pos.y));
    let hdr = textureLoad(hdrTex, texel, 0).rgb;
    let exposed = hdr * exposureBuf[0];
    return vec4<f32>(acesFilmic(exposed), 1.0);
}
