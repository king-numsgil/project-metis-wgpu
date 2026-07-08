// Depth-only, multisampled pass from the sun's point of view — a single
// orthographic shadow map (no cascades) framed each frame around the scene's
// bounding sphere. See math/Clustered forward formulas.md's shadow section
// for the frustum-fitting formula and its "single fixed frustum"
// simplification.
//
// This pass writes no color: the multisampled depth it produces is resolved
// into per-texel depth *moments* (E[z]..E[z^4]) by shadow_resolve.wgsl — see
// that file for why the moments are computed from MSAA samples instead of in
// a fragment shader here. forward.wgsl's sampleSunShadow() reconstructs
// occlusion from those moments (Hausdorff 4MSM, Peters & Klein 2015).

@group(0) @binding(0) var<uniform> shadowUniforms: ShadowUniforms;
@group(1) @binding(0) var<uniform> modelUniform: Model;

@vertex
fn vs(@location(0) position: vec3<f32>) -> @builtin(position) vec4<f32> {
    let worldPos = modelUniform.model * vec4<f32>(position, 1.0);
    return shadowUniforms.lightViewProj * worldPos;
}
