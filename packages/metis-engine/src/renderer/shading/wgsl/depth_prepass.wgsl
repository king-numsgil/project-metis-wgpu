// Depth-only prepass. Concatenated after common.wgsl (so `Camera` and `Model`
// are the *same declarations* the forward pass uses) by
// clusteredForwardRenderer.ts.
//
// Renders every opaque instance writing depth and nothing else — no fragment
// stage at all — so the forward pass can then run with `depthCompare: "equal"`
// and depth writes off. Fragments that lost the depth test never run the
// expensive part of forward.wgsl (the clustered light loop + shadow sampling).
//
// **`@invariant` is load-bearing, not decoration.** With `depthCompare: "equal"`
// the forward pass only shades a fragment whose recomputed depth matches this
// pass's *exactly*. Two pipelines compiling the same expression are not
// otherwise guaranteed to produce bit-identical results, and a 1-ULP difference
// makes surfaces vanish. `@invariant` on `@builtin(position)` is the WGSL
// guarantee that they will match — forward.wgsl carries it too, and the two
// must be kept in lockstep: same expression, same order of operations.

@group(0) @binding(0) var<uniform> prepassCamera: Camera;
@group(1) @binding(0) var<uniform> prepassModel: Model;

struct DepthOnlyInput {
    @location(0) position: vec3<f32>,
};

struct DepthOnlyOutput {
    @invariant @builtin(position) clipPosition: vec4<f32>,
};

@vertex
fn vs(input: DepthOnlyInput) -> DepthOnlyOutput {
    var out: DepthOnlyOutput;
    // Must match forward.wgsl's `vs` exactly, including the intermediate.
    let worldPos4 = prepassModel.model * vec4<f32>(input.position, 1.0);
    out.clipPosition = prepassCamera.viewProj * worldPos4;
    return out;
}
