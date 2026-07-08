// Converts measured scene luminance into an exposure multiplier and
// exponentially adapts toward it over time ("eye adaptation"). See
// math/Tonemapping and exposure formulas.md (Formula 2 — 18%-grey
// calibration, Formula 3 — exponential adaptation).

struct AutoExposureParams {
    deltaTime: f32,
    adaptationTau: f32,
    exposureCompensation: f32,
    _pad: f32,
};

@group(0) @binding(0) var<uniform> params: AutoExposureParams;
@group(0) @binding(1) var<storage, read> avgLogLuminance: array<f32>;
@group(0) @binding(2) var<storage, read_write> exposure: array<f32>;

@compute @workgroup_size(1)
fn autoExpose() {
    let avgLuminance = max(exp(avgLogLuminance[0]), 1e-4);
    let targetExposure = (0.18 / avgLuminance) * params.exposureCompensation;

    let currentExposure = exposure[0];
    let lerpFactor = 1.0 - exp(-params.deltaTime / max(params.adaptationTau, 1e-3));
    exposure[0] = currentExposure + (targetExposure - currentExposure) * lerpFactor;
}
