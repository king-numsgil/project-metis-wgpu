# Tonemapping and exposure formulas

# HDR auto-exposure + filmic tonemap — model & formula reference

## What this actually is

Lighting is computed in physically-motivated linear units that can range from near-zero (deep shadow) to many hundreds (a light bulb seen up close) — nothing about that range corresponds directly to a displayable `[0,1]` pixel value. Two problems have to be solved before the HDR result reaches the screen: **exposure** (what overall brightness multiplier makes the *scene's own* range look right, the way a camera's auto-exposure adapts to a dim room vs. bright daylight) and **tonemapping** (how to compress whatever range remains after exposure into `[0,1]` without just clipping the highlights to flat white). Both halves are real, well-established techniques from film and game production — the handwave is entirely in the specific curve-fits and metering heuristics chosen for a real-time budget, exactly as documented below.

---

## Formula 1 — Log-average luminance ("the key")

$$
\bar{L} = \exp\left(\frac{1}{N}\sum_{i} \log(L_i + \epsilon)\right)
$$

Where `L_i` is the luminance (`dot(color, vec3(0.2126, 0.7152, 0.0722))` — Rec. 709 luma weights) of pixel `i`, and `N` is the pixel count. This is Reinhard et al. 2002's ("Photographic Tone Reproduction for Digital Images") log-average luminance, computed as a two-pass parallel reduction in `luminance_average.wgsl`: pass 1 reduces each 16×16 tile to one partial sum (+ valid-pixel count) via workgroup-shared-memory tree reduction; pass 2 reduces all partial sums to a single value.

**Honest caveat — this is the one labeled handwave:** a space scene is mostly empty black background. Including those pixels in the average drags `L̄` down to near-zero, which (via Formula 2) computes an enormous target exposure trying to bring the "scene" up to middle grey — and blows the actual lit geometry out to flat white in the process. This was an actual bug hit during development, not a theoretical concern (an early exterior test rendered as a solid white frame). The fix: `reduceTile` samples the depth buffer alongside the color buffer and excludes any pixel where `depth >= far` (nothing was drawn there) from both the sum and the pixel count, so the average is computed only over pixels that actually contain scene geometry. Real cameras don't have this problem because they're not usually pointed at a scene that's 95% true black; this renderer's target subject matter (spacecraft in the void) makes the naive formula actively wrong rather than just imprecise.

## Formula 2 — Exposure from metered luminance

$$
\text{exposure}_{target} = \frac{0.18}{\bar L}\times\text{compensation}
$$

**ELI5:** `0.18` is the photography convention for "middle grey" — the reflectance of an averaged, well-exposed scene. This formula asks "what multiplier makes the scene's own average luminance equal to that reference grey," which is exactly what a camera's auto-exposure meter does. `exposureCompensation` (`AutoExposurePass.exposureCompensation`, default `1.0`) is the manual override — the "exposure compensation" dial on a real camera, for scenes that are deliberately supposed to read as brighter or darker than "average."

## Formula 3 — Exponential eye adaptation

$$
\text{exposure}_{t+\Delta t} = \text{exposure}_t + \left(\text{exposure}_{target} - \text{exposure}_t\right)\left(1-e^{-\Delta t/\tau}\right)
$$

Where `τ` (`AutoExposurePass.adaptationTau`, default `0.6` seconds) is the time for exposure to close ~63% of the gap to its target. Implemented in `auto_exposure.wgsl`, run once per frame on a single compute invocation (the whole state is one `f32` in a persistent storage buffer — `ExposureState`).

**ELI5:** Applying the metered exposure instantly would cause visible "pumping" every time the camera pans across a bright light or into shadow — exactly the jarring effect a badly-tuned camera or a video game's naive auto-exposure produces. Exponential adaptation smooths this into something closer to how human eyes (or a good camera) actually adjust: fast enough to feel responsive, slow enough not to flicker.

## Formula 4 — ACES filmic tonemap (Narkowicz 2015 fit)

$$
T(x) = \text{clamp}\left(\frac{x(2.51x+0.03)}{x(2.43x+0.59)+0.14},\ 0,\ 1\right)
$$

Applied per-channel to `exposure * hdrColor` in `tonemap.wgsl`, the final pass in the default chain, writing directly to the display/capture format.

**Honest caveat:** this is a curve-fit approximation of the real ACES (Academy Color Encoding System) reference rendering transform — a small, fast polynomial tuned by Krzysztof Narkowicz to visually match the real (much more expensive, LUT-based, color-space-aware) ACES pipeline used in film production. It is not colorimetrically identical to real ACES, but it reproduces the property that actually matters for a renderer without a full color pipeline: a gentle "toe" that lets shadows stay soft rather than crushing to pure black, and a "shoulder" that lets bright highlights roll off smoothly toward white instead of clipping hard. `test/fixture.ts`'s `hdr-clip-naive-clamp.png` vs. `hdr-clip-tonemapped.png` comparison exists specifically to make this visible: a naive `clamp(exposure * color, 0, 1)` on an intentionally overbright light produces a large flat white disc with a hard edge, while the ACES fit produces a smaller, softer highlight with visible falloff.

---

## Tunable parameters

```
AutoExposurePass {
  adaptationTau          // 0.6s — Formula 3's τ, larger = slower/dreamier adaptation
  exposureCompensation   // 1.0 — Formula 2's manual stops-like multiplier
}

ExposureState {
  initial   // 1.0 — starting exposure before the first metering pass completes
}
```
