// AO denoise — an NxN box blur matched to the noise tile (AO_NOISE_DIM). The
// per-pixel random kernel rotation the AO passes use spreads occlusion error
// out over exactly one noise tile; averaging over that tile recovers a smooth
// result. Depth/normal-aware ("bilateral") blurring would preserve edges
// better, but a plain box blur over the tile is the standard cheap denoise and
// enough for this engine's soft, ambient-only AO. Fullscreen fragment pass.

@group(0) @binding(0) var aoTex: texture_2d<f32>;

// Keep in sync with AO_NOISE_DIM in aoConfig.ts.
const BLUR_DIM: i32 = 4;

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
    let dims = vec2<i32>(textureDimensions(aoTex));
    let center = vec2<i32>(in.pos.xy);
    // Center the BLUR_DIM x BLUR_DIM window (e.g. [-2, 1] for 4).
    let lo = -BLUR_DIM / 2;
    let hi = lo + BLUR_DIM - 1;

    var sum = 0.0;
    for (var dy = lo; dy <= hi; dy = dy + 1) {
        for (var dx = lo; dx <= hi; dx = dx + 1) {
            let c = clamp(center + vec2<i32>(dx, dy), vec2<i32>(0, 0), dims - vec2<i32>(1, 1));
            sum += textureLoad(aoTex, c, 0).r;
        }
    }
    return sum / f32(BLUR_DIM * BLUR_DIM);
}
