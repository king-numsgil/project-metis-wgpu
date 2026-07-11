// AO geometry prepass: renders the scene once more (single-sampled) to produce
// the two inputs every screen-space AO technique needs — a view-space normal
// buffer (rgba16float) and a depth buffer the AO pass reconstructs view-space
// position from. Standalone shader (no common.wgsl): it only needs the model +
// a view/viewProj, and duplicating the two small structs keeps AO decoupled
// from the forward shading path.
//
// Culls back faces to match the forward pipeline, so the stored normals belong
// to the same faces the forward pass will shade.

struct AoUniforms {
    view: mat4x4<f32>,
    viewProj: mat4x4<f32>,
    proj: mat4x4<f32>,
    invProj: mat4x4<f32>,
    params0: vec4<f32>, // x=screenW, y=screenH, z=near, w=far
    params1: vec4<f32>, // x=radius, y=bias, z=intensity, w=power
};

struct Model {
    model: mat4x4<f32>,
    normalMat: mat3x3<f32>,
};

@group(0) @binding(0) var<uniform> ao: AoUniforms;
@group(1) @binding(0) var<uniform> modelUniform: Model;

struct VertexOutput {
    @builtin(position) clipPosition: vec4<f32>,
    @location(0) viewNormal: vec3<f32>,
};

@vertex
fn vs(@location(0) position: vec3<f32>, @location(1) normal: vec3<f32>) -> VertexOutput {
    let worldPos = modelUniform.model * vec4<f32>(position, 1.0);
    let worldNormal = modelUniform.normalMat * normal;
    // lookAt views have no scale, so the view's upper-left 3x3 is a pure
    // rotation — safe to apply directly to a direction.
    let viewRot = mat3x3<f32>(ao.view[0].xyz, ao.view[1].xyz, ao.view[2].xyz);

    var out: VertexOutput;
    out.clipPosition = ao.viewProj * worldPos;
    out.viewNormal = viewRot * worldNormal;
    return out;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4<f32> {
    // Renormalize after interpolation; store view-space normal in rgb.
    return vec4<f32>(normalize(in.viewNormal), 1.0);
}
