// Renders bun-webgpu-rs's VectorContext geometry (tessellated glyph/path
// fills) with a single solid paint color and an orthographic pixel-space
// projection. VectorContext deliberately only owns geometry — color, paint,
// and transforms are the caller's responsibility (see its doc comment) —
// this is that caller.

struct Uniforms {
    viewProj: mat4x4<f32>,
    color: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VOut {
    @builtin(position) pos: vec4<f32>,
};

@vertex
fn vs(@location(0) position: vec2<f32>, @location(1) uv: vec2<f32>) -> VOut {
    var out: VOut;
    out.pos = u.viewProj * vec4<f32>(position, 0.0, 1.0);
    return out;
}

@fragment
fn fs() -> @location(0) vec4<f32> {
    return u.color;
}
