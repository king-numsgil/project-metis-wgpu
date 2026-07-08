/**
 * Screen-space ambient occlusion — technique selection + tunables.
 * See math/Ambient occlusion formulas.md for the model and the exact math
 * each technique implements.
 *
 * AO here modulates *only* the flat ambient term (forward.wgsl) — it is an
 * approximation of how much of the (indirect/bounce) hemisphere above a point
 * is blocked by nearby geometry, so it must not darken direct sun/point light,
 * which is occluded by the shadow map instead.
 */
export enum AoTechnique {
    /** No occlusion — ambient term is used unattenuated. */
    None = "none",
    /**
     * Screen-space ambient occlusion (Crytek 2007, normal-oriented hemisphere
     * variant). Samples a random hemisphere kernel around each fragment's
     * view-space position and counts how many samples are buried behind
     * nearby geometry. Cheap and robust; noisier than HBAO, relies on the blur.
     */
    SSAO = "ssao",
    /**
     * Horizon-based ambient occlusion (Bavoil, Sainz & Dimitrov 2008). Marches
     * rays in screen space and integrates the horizon (max elevation) angle of
     * occluding geometry above each point's tangent plane. More physically
     * grounded and less noisy than SSAO for the same sample budget.
     */
    HBAO = "hbao",
}

// ── SSAO ────────────────────────────────────────────────────────────────────
/** Hemisphere kernel sample count. Keep in sync with `ssao.wgsl`'s `KERNEL_SIZE`. */
export const SSAO_KERNEL_SIZE = 32;

// ── HBAO ────────────────────────────────────────────────────────────────────
/** Marching directions per fragment. Keep in sync with `hbao.wgsl`'s `NUM_DIRECTIONS`. */
export const HBAO_DIRECTIONS = 6;
/** Steps marched along each direction. Keep in sync with `hbao.wgsl`'s `NUM_STEPS`. */
export const HBAO_STEPS = 4;

// ── Shared ──────────────────────────────────────────────────────────────────
/**
 * Noise tile edge length. A `NOISE_DIM x NOISE_DIM` tile of random rotations is
 * tiled across the screen to decorrelate the (few) kernel samples between
 * neighbouring pixels; the AO blur (matched to this tile size) then averages
 * the noise back out. Keep in sync with `ssao.wgsl`/`hbao.wgsl`/`ao_blur.wgsl`.
 */
export const AO_NOISE_DIM = 4;

/**
 * Per-technique defaults, applied to `AmbientOcclusion`'s tunable fields. These
 * are feel-tuned for the demo scenes' ~metre-scale geometry, not derived — the
 * one physically-meaningful unit is `radius` (world units: the neighbourhood a
 * point can be occluded from).
 */
export interface AoTuning {
    /** Occlusion sampling radius, world units. */
    radius: number;
    /** Self-occlusion guard. SSAO: a view-space depth bias; HBAO: a tangent-angle bias (radians). */
    bias: number;
    /** Strength multiplier on the raw occlusion before it darkens ambient (1 = as measured). */
    intensity: number;
    /** Contrast curve exponent applied to the final AO factor (>1 darkens creases harder). */
    power: number;
}

export const SSAO_DEFAULTS: AoTuning = { radius: 0.5, bias: 0.025, intensity: 1.0, power: 1.5 };
export const HBAO_DEFAULTS: AoTuning = { radius: 0.5, bias: 0.1, intensity: 1.0, power: 1.5 };
