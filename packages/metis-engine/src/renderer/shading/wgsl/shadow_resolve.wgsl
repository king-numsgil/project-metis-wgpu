// Resolves the multisampled depth-only shadow pass into per-texel power
// moments (E[z]..E[z^4]) by averaging the moments of each MSAA sample —
// the "resolve operation for shadow maps with multisample antialiasing"
// optimization noted in Peters & Klein 2015's supplementary (after Lauritzen
// et al. 2011, "Sample Distribution Shadow Maps").
//
// Why this exists: with one depth sample per texel, every texel is a pure
// delta distribution, and the boundary of any shadow feature quantizes to
// whole shadow-map texels — at a concave corner viewed up close this reads
// as a blocky, streaky staircase along the seam (user-reported, correctly
// diagnosed as a resolution artifact). Averaging the moments of N sub-texel
// depth samples gives boundary texels a genuine mixed distribution, and the
// Hausdorff reconstruction in forward.wgsl turns that mixture into smooth
// fractional occlusion — anti-aliasing the shadow boundary at sub-texel
// precision without raising the (already large, rgba32float) map resolution.
// Standalone shader: needs nothing from common.wgsl.

@group(0) @binding(0) var shadowDepthMs: texture_depth_multisampled_2d;

// Keep in sync with SHADOW_MSAA_SAMPLES in clusteredForwardRenderer.ts.
const SHADOW_MSAA_SAMPLES: i32 = 4;

struct VOut {
    @builtin(position) pos: vec4<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
    // Fullscreen triangle.
    let x = f32((vi << 1u) & 2u) * 2.0 - 1.0;
    let y = f32(vi & 2u) * 2.0 - 1.0;
    var out: VOut;
    out.pos = vec4<f32>(x, y, 0.0, 1.0);
    return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4<f32> {
    let texel = vec2<i32>(i32(in.pos.x), i32(in.pos.y));
    var moments = vec4<f32>(0.0);
    for (var s: i32 = 0; s < SHADOW_MSAA_SAMPLES; s++) {
        let z = textureLoad(shadowDepthMs, texel, s);
        let z2 = z * z;
        moments += vec4<f32>(z, z2, z2 * z, z2 * z2);
    }
    return moments / f32(SHADOW_MSAA_SAMPLES);
}
