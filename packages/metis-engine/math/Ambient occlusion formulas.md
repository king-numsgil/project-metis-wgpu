# Ambient occlusion formulas

# Screen-space ambient occlusion (SSAO / HBAO) — model & formula reference

## What this actually is

Ambient occlusion is a cheap stand-in for one specific piece of global
illumination: the fact that a point tucked into a crease, corner, or contact
seam receives *less* of the sky/bounce light than a point out in the open,
because nearby geometry blocks part of the hemisphere above it. A full solution
would trace that hemisphere; screen-space AO instead estimates the blocked
fraction from the depth buffer alone (plus a normal buffer), per pixel, after
the geometry is already rasterized.

This is an approximation on two axes, and both are honest handwaves:

1. **It only sees what's on screen.** An occluder outside the frame, or hidden
   behind a nearer surface, contributes nothing — screen-space AO has no data
   for it. This produces the familiar artifacts (AO fading at screen edges, or
   under the camera). Accepted, universal to the technique.
2. **It's applied to the ambient term only** (`forward.wgsl`). AO approximates
   occlusion of *indirect / bounce* light, so it must not darken the sun or
   point lights — their occlusion is the shadow map's job (see
   `math/Clustered forward formulas.md`). Multiplying the whole lit image by AO
   (as some engines do for speed) double-darkens shadowed creases and is wrong;
   this renderer multiplies only `Environment.ambientIntensity`.

The part that is *not* a handwave is the geometry: both techniques reconstruct a
correct view-space position from the depth buffer and measure real occlusion
against it. `AoTechnique` (`src/ao/aoConfig.ts`) selects `None`, `SSAO`, or
`HBAO` — a quality dial, since HBAO costs more but is smoother.

### The pipeline (both techniques share it)

`AmbientOcclusion` (`src/ao/ambientOcclusion.ts`) runs three passes before the
forward pass:

1. **Geometry prepass** (`ao_prepass.wgsl`) — re-rasterizes the scene, single-
   sampled, writing view-space normals (rgba16float) + depth. This is a second
   geometry pass; a production engine would fold it into a shared depth prepass,
   but at this engine's scale the duplicate draw is cheap and keeps AO decoupled.
2. **Occlusion** (`ssao.wgsl` **or** `hbao.wgsl`) — a fullscreen pass that
   reconstructs each pixel's view-space position from depth and writes an
   occlusion factor in `[0,1]` (1 = fully open) to an r8unorm target.
3. **Blur** (`ao_blur.wgsl`) — an `AO_NOISE_DIM × AO_NOISE_DIM` box blur that
   averages out the per-pixel kernel randomization (below). Matched to the noise
   tile exactly, so it removes the noise without over-softening.

`None` skips all three; the renderer clears the result to white so the forward
multiply is a branchless no-op.

### View-space position reconstruction (shared)

Both techniques need the view-space position `P` at a pixel. Given its `[0,1]`
uv and the hardware depth `d` (WebGPU clip space: xy ∈ [-1,1] y-up, z ∈ [0,1]):

$$
P = \frac{M_{proj}^{-1}\,(2u-1,\ 1-2v,\ d,\ 1)^\top}{(\cdot)_w}
$$

Implemented as `reconstructViewPos` in both shaders (`invProj` is uploaded per
frame). The same routine, evaluated at a *neighbour's* uv, gives the occluder's
position — the whole method is comparing those.

---

## Formula 1 — SSAO (normal-oriented hemisphere)

Crytek's SSAO (Mittring 2007), in the now-standard normal-oriented-hemisphere
form. For each fragment with view position `P` and view normal `N`, scatter a
fixed kernel of `KERNEL_SIZE` sample offsets over the hemisphere around `N`,
and count how many land *behind* the recorded geometry:

$$
\text{AO} = 1 - \frac{1}{K}\sum_{i=1}^{K}
\big[\,z_{\text{stored}}(s_i) \ge z(s_i) + \text{bias}\,\big]\cdot
\text{rangeCheck}(s_i),
\qquad s_i = P + (\text{TBN}\cdot k_i)\,r
$$

Where:
- `k_i` are the hemisphere kernel samples (`generateSsaoKernel`, tangent space,
  `z ≥ 0`, pushed toward the origin so most of the budget measures contact).
- `TBN` is built from `N` and a per-pixel random in-plane rotation
  (`generateAoNoise`, tiled) via Gram-Schmidt, decorrelating the kernel between
  neighbours so the box blur can average the estimate — trading banding for
  noise, the standard SSAO move.
- `r` is `radius` (world units). `s_i` is projected with `M_proj` to look up the
  stored depth at its screen location; `z(s_i)` is the sample's own view-space z.
- **Occlusion test:** view space looks down −Z, so a surface *closer* to the
  camera has the *larger* (less negative) z. `s_i` is occluded iff the real
  geometry there sits in front of it: `z_stored ≥ z(s_i) + bias`. The `bias`
  (view-space depth units) prevents a flat surface self-occluding.
- **rangeCheck** = `smoothstep(0,1, radius / |P.z − z_stored|)` discards
  occluders far in depth from `P`, which would otherwise draw dark halos around
  silhouette edges.

Implemented in `ssao.wgsl`. `KERNEL_SIZE = 32` (`SSAO_KERNEL_SIZE`).

## Formula 2 — HBAO (horizon-based)

Horizon-Based Ambient Occlusion (Bavoil, Sainz & Dimitrov 2008). Instead of a
volumetric sample count, HBAO integrates the **horizon angle** — the highest
angle, above the surface's tangent plane, at which nearby geometry blocks the
sky — over several marching directions:

$$
\text{AO} = 1 - \frac{1}{N_d}\sum_{d=1}^{N_d}\ \sum_{\text{steps}}
\big(\sin\theta_h - \sin\theta_{h}^{\text{prev}}\big)\cdot W(r)
$$

Per direction `d` (evenly spaced screen-space angles, jittered per pixel), march
`NUM_STEPS` samples outward to `radius`. For each sample at view position `S`:

$$
\sin\theta = \frac{(S-P)\cdot N}{\lVert S-P\rVert}
\quad\text{(elevation above the tangent plane)},
\qquad W(r) = 1 - (r/\text{radius})^2
$$

The identity `sin(elevation above tangent plane) = cos∠(S−P, N) = Ĥ·N` is why
the tangent angle `θ_t` is 0 here: measuring elevation *against the real normal*
already subtracts it. Each time a sample raises the running horizon `θ_h`, the
increase is accumulated weighted by the distance attenuation `W(r)`, so contact
geometry counts for more than distant, grazing occluders. A small tangent-angle
`bias` (radians) seeds the initial horizon to suppress self-occlusion on flat
receivers.

The world-space `radius` is projected to a pixel march length at the fragment's
depth using the projection's focal term
(`radiusPixels = radius · proj₁₁ · ½ · height / (−P.z)`), clamped so a near-
camera pixel doesn't march across the whole screen. Implemented in `hbao.wgsl`.
`NUM_DIRECTIONS = 6`, `NUM_STEPS = 4` (`HBAO_DIRECTIONS`, `HBAO_STEPS`).

**Honest caveat — the tangent simplification.** The original HBAO paper marches
in a 2D *slice* and computes a per-direction tangent angle from the projected
normal. Measuring elevation directly against the 3D normal (as above) is the
common real-time simplification (it's what GTAO later formalized); it drops the
paper's exact per-slice tangent term in exchange for one dot product per sample.
For this engine's soft, ambient-only AO the difference is not visible, but it is
a deliberate deviation from the letter of the 2008 formulation.

## Formula 3 — Compositing

Both techniques output an openness factor `ao ∈ [0,1]`, post-processed by
`intensity` (strength) and `power` (contrast) before storage:

$$
\text{ao}_{\text{final}} = \text{clamp}\big(1 - (1-\text{ao})\cdot\text{intensity},\ 0,\ 1\big)^{\text{power}}
$$

then blurred, then multiplied into the ambient term **only**:

```
color += ambientColor · ambientIntensity · albedo · ao_final   // forward.wgsl
```

Direct lighting (sun, point lights) is untouched — see "What this actually is".

---

## Tunable parameters

```
AoTechnique                None | SSAO | HBAO   — the quality dial (aoConfig.ts)

AmbientOcclusion (per-technique defaults reseeded on `technique =`; SSAO_DEFAULTS / HBAO_DEFAULTS)
  radius       // 0.5  — occlusion neighbourhood, WORLD units (the one physical dial)
  bias         // SSAO 0.025 (view-space depth) / HBAO 0.1 (tangent angle, radians) — self-occlusion guard
  intensity    // 1.0  — strength multiplier on measured occlusion
  power         // 1.5  — contrast curve on the final factor (>1 darkens creases harder)

Compile-time (keep the WGSL const and the aoConfig.ts export in sync)
  SSAO_KERNEL_SIZE   // 32 — ssao.wgsl KERNEL_SIZE
  HBAO_DIRECTIONS    // 6  — hbao.wgsl NUM_DIRECTIONS
  HBAO_STEPS         // 4  — hbao.wgsl NUM_STEPS
  AO_NOISE_DIM       // 4  — noise tile edge = box-blur window (ssao/hbao/ao_blur.wgsl)
```

## Verification

`test/ao.test.ts` covers both layers: pure-math unit tests of the kernel
(hemisphere containment, unit-sphere bound, origin-weighting, determinism) and
noise generators, plus a GPU integration test that renders a box resting on a
floor lit *only* by ambient and asserts each technique darkens the contact
creases relative to `None`, with the forward/AO passes wrapped in a validation
error scope (`pushErrorScope`) so a broken shader fails the test rather than
silently rendering garbage — the discipline `math/Clustered forward formulas.md`
learned the hard way.
