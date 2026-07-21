// Depth-only pass from the sun's point of view, run once per cascade into that
// cascade's layer of the shadow depth array. See math/Clustered forward
// formulas.md's shadow section for the frustum-fitting formula, and
// shadowCascades.ts for the per-cascade fit.
//
// This pass writes no color — just standard-Z ortho depth, which forward.wgsl's
// sampleSunShadow() tests with a hardware comparison sampler (PCF).

@group(0) @binding(0) var<uniform> shadowUniforms: ShadowUniforms;
@group(1) @binding(0) var<uniform> modelUniform: Model;

@vertex
fn vs(@location(0) position: vec3<f32>) -> @builtin(position) vec4<f32> {
    let worldPos = modelUniform.model * vec4<f32>(position, 1.0);
    return shadowUniforms.lightViewProj * worldPos;
}
