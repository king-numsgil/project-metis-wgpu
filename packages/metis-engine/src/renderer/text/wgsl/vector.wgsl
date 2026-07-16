// Renders bun-webgpu-rs's VectorContext geometry (tessellated glyph/path
// fills) with an orthographic pixel-space projection. VectorContext
// deliberately only owns geometry — color, paint, and transforms are the
// caller's responsibility (see its doc comment) — this is that caller.
//
// The paint color is a *separate* dynamically-offset binding from the
// projection so one pass can draw many colors: the CPU side rebinds group 0 at
// a new offset per draw call, indexing a palette by the draw call's
// VectorContext id. The projection is bound once and never moves, so it lives
// in its own binding rather than being duplicated into every palette slot
// (dynamic offsets must respect minUniformBufferOffsetAlignment, typically 256
// bytes — copying a mat4 into each slot would waste most of that).

struct Frame {
    viewProj: mat4x4<f32>,
};

struct Paint {
    color: vec4<f32>,
};

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<uniform> paint: Paint;

struct VOut {
    @builtin(position) pos: vec4<f32>,
};

@vertex
fn vs(@location(0) position: vec2<f32>, @location(1) uv: vec2<f32>) -> VOut {
    var out: VOut;
    out.pos = frame.viewProj * vec4<f32>(position, 0.0, 1.0);
    return out;
}

@fragment
fn fs() -> @location(0) vec4<f32> {
    return paint.color;
}
