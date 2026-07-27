/**
 * Shadow sizing constants, in a leaf module with **no imports**.
 *
 * They live here rather than beside the classes that use them because
 * `gpuLayouts.ts` needs them to size its descriptor arrays, and `ShadowCascades`
 * / `SpotShadows` need `gpuLayouts` — importing them from those files instead
 * would be a cycle, and an ESM cycle over `const` bindings fails at load with a
 * TDZ error rather than resolving. `shadowCascades.ts` and `spotShadows.ts`
 * re-export everything here, so the public import paths are unchanged.
 *
 * All four are **compile-time**: they size texture arrays and WGSL
 * `array<…, N>` declarations, whose lengths must be constants. Changing one is
 * an edit here plus a matching edit in `wgsl/common.wgsl`.
 */

/**
 * Cascades in the directional shadow. Sizes the depth array and the
 * `array<mat4x4, 4>` in `CascadeUniforms`.
 */
export const CASCADE_COUNT = 4;

/**
 * Per-cascade shadow map resolution. 2048 (down from a former 4096 single map)
 * is enough because `roomBox`'s solid-slab walls give corner depth gaps of
 * ~wall-thickness, far wider than any shadow test here needs to resolve.
 *
 * The normal-offset bias is texel-scaled, so this can change without retuning
 * bias. VRAM is `CASCADE_COUNT * SHADOW_MAP_SIZE² * 4` bytes.
 */
export const SHADOW_MAP_SIZE = 2048;

/**
 * How many spot lights may cast shadows in one frame. Sizes the spot depth array
 * and the `array<mat4x4, 4>` in `SpotShadowUniforms`.
 *
 * Four is deliberately modest: the intent is that scene code selects *which*
 * four matter for the current space rather than the renderer trying to shadow
 * every spot at once — see CLAUDE.md "Spot light shadows".
 */
export const MAX_SHADOW_SPOTS = 4;

/**
 * Per-spot-light shadow map resolution. Lower than the sun's `SHADOW_MAP_SIZE`
 * because a spot's frustum covers a bounded cone rather than a whole cascade
 * slice, so each texel already subtends far less world space.
 *
 * VRAM = `MAX_SHADOW_SPOTS * SPOT_SHADOW_MAP_SIZE² * 4` bytes. Doubling this
 * quadruples that.
 */
export const SPOT_SHADOW_MAP_SIZE = 1024;
