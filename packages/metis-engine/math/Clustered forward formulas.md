# Clustered forward formulas

# Clustered forward shading + directional shadow map — model & formula reference

## What this actually is

A naive forward renderer loops every light over every fragment — fine for one sun, catastrophic once a scene has dozens of point lights (ship interior fixtures, running lights, explosions). Clustered forward shading fixes this by dividing the view frustum into a 3D grid of small boxes ("clusters"), working out ahead of time which lights can possibly affect each cluster (a compute pass, off the critical fragment-shading path), and having the fragment shader only loop over the short list assigned to *its* cluster. This is the same technique described in Olsson & Assarsson 2012 ("Clustered Deferred and Forward Shading") and used in id Tech 6 (Doom 2016) — real, load-bearing computational-geometry engineering, not a visual approximation.

The one deliberate simplification here relative to a "full" implementation: clusters are rebuilt from scratch every frame instead of only when the camera's projection changes. At `16×9×24 = 3,456` clusters this costs a trivial compute dispatch, so the added complexity of caching and invalidating the cluster AABBs wasn't worth it for this engine's scale — see "The one skipped optimization" below.

---

## Formula 1 — The cluster grid

Fixed counts (`src/shading/clusterConfig.ts`): `16` tiles wide × `9` tiles tall × `24` depth slices, independent of actual viewport resolution — tiles just scale to fit. Screen-space tiles are trivial (divide the viewport into a uniform grid); the interesting part is the depth axis.

## Formula 2 — Exponential Z-slicing

$$
z_k = z_{near}\left(\frac{z_{far}}{z_{near}}\right)^{k/S}, \qquad k \in [0, S)
$$

Where `S` is the slice count (24) and `z_k` is the (positive, linear) view-space depth at the near edge of slice `k`. Inverting this to find which slice a given depth `z` falls into:

$$
k(z) = S\cdot\frac{\log(z/z_{near})}{\log(z_{far}/z_{near})}
$$

**ELI5:** Linear depth slicing wastes most of its resolution far from the camera, where a single slice can span kilometers, while cramming everything close to the camera — where lights matter most and objects are biggest on screen — into one thin sliver. Exponential slicing flips this: slices stay thin near the camera (where precision matters for separating a ship's interior lights into distinct clusters) and grow wide in the distance (where nothing needs that precision). `clusterZIndex()` in `common.wgsl` implements the inverse formula directly; `cluster_build.wgsl` implements the forward formula to build each slice's near/far planes.

## Formula 3 — Cluster AABBs via ray/z-plane intersection

For each cluster's four screen-space tile corners, unproject to a view-space ray through the camera origin (`screenToViewRay` in `cluster_build.wgsl`), then intersect that ray with the cluster's near and far z-planes (`intersectZPlane`) to get 8 corner points; the cluster's AABB is simply their component-wise min/max.

$$
P(t) = t \cdot \hat{r}, \qquad t = \frac{z_{plane}}{\hat r_z} \implies P_z = z_{plane}
$$

**ELI5:** Because every cluster is a frustum-shaped wedge, not a box, we approximate it with the smallest axis-aligned box that contains it — slightly conservative (a light just outside the true wedge but inside its bounding box gets tested and correctly rejected by the sphere-vs-box test in Formula 4), which is the standard, harmless trade every clustered-shading implementation makes.

## Formula 4 — Sphere/AABB light culling

$$
d^2 = \sum_{i\in\{x,y,z\}} \left(\max(0,\ \text{clamp}(p_i, \text{min}_i, \text{max}_i) - p_i)\right)^2, \qquad \text{light affects cluster} \iff d^2 \le \text{range}^2
$$

Implemented in `light_cull.wgsl` — for each of the (up to 3,456) clusters, loop the scene's active point lights and test each one's view-space position against the cluster's AABB via squared distance, writing up to `MAX_LIGHTS_PER_CLUSTER` (32) surviving indices into a fixed-stride array. No atomics: each cluster writes only its own slice of the output buffer, so there's no contention to resolve.

**ELI5:** A point light's influence is a sphere (Formula in `pointLightAttenuation`, `common.wgsl` — inverse-square falloff windowed to hit exactly zero at `range`); this just asks "does that sphere touch this box?" for every (cluster, light) pair. It's `O(clusters × lights)`, which sounds bad until you notice it runs on the GPU in parallel and both numbers are small (thousands × hundreds, not millions).

---

## The directional shadow map

The sun needs to be *occluded* by geometry — otherwise "sunlight through a window" is just a hole in a wall that doesn't actually change the lighting, since every surface would be lit by pure `N·L` regardless of what's in front of it. `shadow.wgsl` renders a pass from the sun's point of view into a single `4096×4096` orthographic shadow map; `forward.wgsl`'s `sampleSunShadow()` projects each fragment into that same light space and reconstructs occlusion from stored depth moments (Moment Shadow Mapping — see Formula 6, which replaced an earlier depth-compare + bias approach for the reasons documented there).

## Formula 5 — Fitting the shadow frustum

$$
\text{center} = \frac{1}{N}\sum_i \text{position}_i, \qquad \text{radius} = \max_i\left(\lVert \text{position}_i - \text{center}\rVert + r_i\right) + \text{padding}
$$

Where `r_i` is each mesh's own `boundingRadius` (max vertex distance from its local origin — computed once in `Mesh`'s constructor). The light's virtual camera sits at `center - sunDirection·radius·2`, looks at `center`, and uses an orthographic projection sized `[-radius, radius]`.

**Honest caveat — this is the one labeled handwave:** `boundingRadius` is computed from raw vertex distance-from-local-origin, not a proper minimal bounding sphere, and instance transforms only translate (rotation/scale would make this approximation looser). For a room mesh whose local origin is the floor corner rather than its centroid, this measurably overestimates the true bounding sphere — acceptable slack for this engine's scene scale (single digits of meshes, room-sized), but the first thing to replace with real per-mesh AABBs if scenes grow larger or more numerous.

**The bug this formula exists to describe:** the very first implementation of this used only `instance.transform.position` — which is `(0,0,0)` for a room mesh positioned at its own origin — completely missing that the mesh's *geometry* extends far past that point. The shadow frustum ended up radius-4 around a room that actually spans radius-7.5, so most of the room fell outside the frustum and got the "no shadow data available -> fully lit" fallback, silently disabling shadowing for exactly the geometry that mattered. Folding each mesh's own extent into the radius (rather than only instance-position spread) fixed it.

## Formula 6 — Moment Shadow Mapping (replaces normal-offset + slope-scaled bias)

**The real bug this section describes, and how it was actually confirmed (not guessed):** a corner where two room walls meet could leak — a wall that should be fully shadowed by its neighbor (no line of sight to the sun at all, confirmed by ray-tracing the exact world-space geometry against the window opening) instead read as fully lit. This was verified three ways before touching any code: (1) ray-tracing the precise camera-ray/wall intersection and the sun-ward ray from that point against the room's actual geometry — every affected pixel's ray hits the solid window-wall frame outside the window's bounds, so all of them should be shadowed; (2) reading back the shadow map's own stored depth at the exact texel a leaking fragment projects to, via `copyTextureToTexture` + a manual readback, which showed the true occluder was recorded **only ~0.0008-0.002 depth units closer to the light than the fragment itself**; (3) confirming the leak's screen-space extent tracked bias/offset changes using a debug render that bypasses the tonemap/auto-exposure pipeline entirely (reading `sunVisibility` through the normal tonemapped output was actively misleading during this investigation — see the "why N·L alone doesn't rule out shadow bugs" note below).

**Why this was structurally unfixable by tuning a depth-compare bias:** the corner's two walls are both real occluders of *each other*, and the geometry genuinely places their light-space depths within a hair of each other exactly at the shared edge (they are, after all, the same line in space). A single-value depth-compare bias can't distinguish "genuine self-shadowing acne" from "a real neighboring occluder is only marginally closer" — both look identical to a plain `depth - bias < stored` test, because that test only ever gets to keep *one* number per texel. The first fix attempted here was a bigger normal offset (pushing the sample point along its own normal before projecting into light space, up to `0.1` world units) — it shrank the leak roughly 3x (from a ~12px-wide leak in a 1280px view down to ~4px) but never closed it, because it was still fighting the same one-number-per-texel limitation, just from a different angle.

**The actual fix: stop storing one depth per texel.** Moment Shadow Mapping (Peters & Klein, *"Moment Shadow Mapping"*, i3D 2015; algorithm and constants below verified against the authors' own supplementary document and HLSL reference listings, not reconstructed from memory) stores the first four power moments of the light-space depth distribution per texel — $E[z], E[z^2], E[z^3], E[z^4]$ — instead of the nearest depth. `shadow.wgsl`'s fragment shader writes `vec4(z, z², z³, z⁴)` to an `rgba32float` render target (`shadow-map-moments` in `clusteredForwardRenderer.ts`; a separate, unsampled `depth32float` texture still does the pass's own nearest-fragment-wins z-test, since a color attachment alone has no such test). `forward.wgsl`'s `computeMsmOcclusion()` reconstructs an occlusion estimate from those four numbers via a Cholesky factorization of their Hankel matrix, producing a monic cubic whose roots bound the query depth's position in the reconstructed distribution — a closed-form solve, not an iterative search. Crucially, **this needs no epsilon bias at all** to disambiguate "real occluder" from "acne": with four numbers describing a texel's depth distribution instead of one, a corner where two occluders sit almost the same distance from the light is no longer collapsed into a single ambiguous comparison.

$$
b' = (1-\alpha)\,b + \alpha\, b_{\text{avg}}, \qquad b_{\text{avg}} = (0.5,\ 0.5,\ 0.5,\ 0.5), \qquad \alpha = 10^{-5}
$$

A small moment bias, blending a hair toward a fixed reference vector, keeps the Hankel matrix from going singular for a texel with ~zero variance (every texel here, in fact — see below) — this is a numerical-stability safeguard, not a disambiguation mechanism, and $\alpha$ is small enough to be visually inert. $b_{\text{avg}}=(0.5,0.5,0.5,0.5)$ and $\alpha=3\times10^{-5}$ are the exact values from the paper's reference `GetHamburger4MSMShadowIntensity` (supplementary Listing 3) — **an earlier version of this code used $(0.5, \tfrac13, 0.5, 0.2)$ instead** (the true moments of a uniform $[0,1]$ distribution), reasoning that a mathematically "real" distribution's moments were more principled than a made-up flat vector. That reasoning was wrong, and shipped a regression the user caught immediately (the leak got visibly *worse*, not better) — see below.

**A self-inflicted regression, and how it was actually caught.** The first MSM implementation used $(0.5, \tfrac13, 0.5, 0.2)$ as the bias target instead of the paper's $(0.5,0.5,0.5,0.5)$. This breaks a property the paper proves the *unbiased* moment problem has (Section 9, "Translation and Scale Invariance": polynomial moments are the unique choice invariant to how the near/far planes map depth into $[0,1]$) — an asymmetric bias target reintroduces a dependency on where the true depth sits in $[0,1]$, and this scene's shadow frustum happens to put most real geometry around $z\approx0.36$, far from the bias target's implicit center. Screenshots from the interactive demo showed the corner-leak *worse* than before MSM. Told explicitly to "do the raw texel tests" rather than keep guessing from screenshots, the investigation used the same ray-trace-and-readback methodology as the original bug (`copyTextureToTexture` + manual buffer mapping, `ClusteredForwardRenderer`'s private shadow-map texture accessed directly from a throwaway debug script) to pull real, GPU-rendered moment values at the exact corner texels and feed them through a JS port of the reconstruction — first catching an unrelated bug in the debug script itself (`new Float32Array(uint8Array)` performs element-wise *value* conversion, not a bit-reinterpretation of the buffer — the fix is `new Float32Array(uint8Array.buffer, uint8Array.byteOffset, ...)`), then finding the real story: a synthetic single-occluder test swept across many query depths revealed the reconstruction's transition band was many times wider at $z_0\approx0.36$ than at $z_0\approx0.5$, entirely because of the wrong bias target. Fetching the paper's actual supplementary PDF confirmed the correct constant.

**A second attempt that also didn't pan out: real hardware filtering.** Reasoning that MSM's whole design point is filterability (the paper explicitly recommends "anisotropic filtering" when sampling), a second attempt switched the moments texture to `rgba16float` (filterable by default in WebGPU, unlike `rgba32float`) with a real linear sampler, expecting the extra variance from blended neighboring texels to make the reconstruction better-conditioned everywhere, not just at the corner. Verified against the same real GPU readback: it wasn't a net win — `rgba16float`'s own rounding error at this depth magnitude (~0.0002) is comparable to or larger than the smallest occluder gaps this scene needs to resolve (~0.0003), so switching formats traded one precision problem for another, and bilinear-blending real depths from both sides of the corner measurably widened the leak at moderate distances rather than softening it. Reverted to `rgba32float` + non-filtering `textureSampleLevel`.

**The Hamburger tail — why "fixed except one texel" was still visibly broken.** With `rgba32float` and the corrected $(0.5,0.5,0.5,0.5)$ bias target, GPU readback showed real improvement at every measured distance, and the state was reported as "one hard texel left at the edge." Zoomed screenshots from the interactive demo said otherwise: broad, bright bleed gradients hugging every concave seam (wall/wall, floor/wall, ceiling/wall), *worse-looking* than before. The readback data explains it: reconstructed visibility fell off as $\sim \sigma^2/g^2$ (measured: 0.275 at a 0.0034 depth gap, 0.04 at 0.010, 0.001 at 0.067 — an exact fit to a Chebyshev-style tail). That's the classic VSM/MSM *light-bleeding tail*, and it matters here because the interior sun is orders of magnitude brighter than the ambient fill: even 0.1% reconstructed visibility of the sun outshines the ambient, so the tail glows for *meters*, not texels. Root cause: the **Hamburger** variant of the moment problem (the paper's default, and what was implemented) allows the reconstructed distribution support anywhere on $\mathbb{R}$ — it "explains" a single-occluder texel's moments partly with phantom mass at *negative* depth, which weakens the occlusion bound by exactly that tail.

**The closure: Hausdorff 4MSM (paper Algorithm 4 / supplementary Listing 4).** The Hausdorff variant adds the one constraint a shadow map is entitled to: all depth mass lies in $[0,1]$. When the unconstrained three-support solution wanders outside $[0,1]$ (detected by its quadratic's roots), the algorithm switches to a four-support solution with points $\{0, z_{\text{free}}, z_f, 1\}$, where $z_{\text{free}}$ has the closed form of Proposition 11. Working that branch through by hand for a pure single-occluder texel $b=(z_0, z_0^2, z_0^3, z_0^4)$: the numerator and denominator of $z_{\text{free}}$ both factor as $-z_0^k(1-z_0)\,g$, so $z_{\text{free}} = z_0$ exactly, the correction term vanishes ($b_3 - b_1 - (z_0+1)(b_2-b_1) \equiv 0$), and the intensity reduces to **exactly 1 for any query behind the occluder and exactly 0 for any query in front — independent of gap size**. The $1/g^2$ tail doesn't shrink; it ceases to exist. Verified three ways: fp32-emulated against the real GPU-readback corner pairs (all seven distances, gaps 0.0003–0.07, reconstruct occlusion 0.99998–1.00000; lit self-queries stay ≤ 0.00002; the bimodal soft-shadow case is bit-identical to Hamburger since it takes the unchanged three-support path); then live GPU readback after the shader change (visibility at 1cm from the corner: **0.973 → 0.003**; at 5cm: 0.0002; beyond: 0.0000; the sunlit floor patch through the window: exactly 1.0); then zoomed renders at the user's two problem viewpoints, where the glow bands are gone entirely, leaving a ~1px hairline at the exact geometric edge. Two supporting changes shipped alongside: `momentBias` lowered from the paper's 3e-5 to 1e-5 (the paper's value compensates 16-bit quantization this unquantized `rgba32float` map doesn't have; the smaller bias halves the residual band width, and the fp32 Cholesky cliff sits two orders of magnitude lower at ~3e-7), and the shadow ortho near/far tightened from $[0.1,\,4r]$ to $[0.98r,\,3.02r]$ (the light camera sits at $2r$ from the bounding-sphere center, so geometry occupies exactly $[r, 3r]$ — the old range wasted nearly half the depth precision on empty space).

**Honest residual, quantified.** The not-yet-shadowed band at a concave corner is now the region where the occluder/receiver depth gap is below the reconstruction's step threshold (set by `momentBias`): measured at ~1cm world width (vis 0.003 at 1cm, 0.0002 at 5cm). Physically, a corner like this *should* show a bright hairline — the penumbra of a finite sun disc at millimeter occluder distances — so the visually correct target is "subpixel except under extreme zoom," which this meets. The full fixture suite and `vectorText` smoke test re-verified clean (zero `wgpu` errors), with the interior sunbeam contrast and exterior sphere shadow intact.

**The true closure: solid geometry (and the 4x VRAM cut it paid for).** Every round above was fighting one geometric pathology: `roomBox` built walls as *zero-thickness quads*, so at a concave corner the occluder's stored depth and the receiver's own depth are literally the same number at the shared edge — no shadow-map representation, however clever, can distinguish them there, which is why each fix only ever narrowed the band. The user asked the right question ("is it a case of using 3D shapes instead of planes?"): yes. `roomBox` now builds solid slabs (default 0.2 world units thick, tiled without overlap; the window-frame slabs automatically form a real sunlit reveal), so the shadow map's stored occluder at a corner is the wall's *exterior* face — GPU-verified gaps of 0.013+ depth units at 2mm from the corner, ~100x the reconstruction threshold, visibility 0.0000-0.0001 at every measured point, and a zoomed render at the previously-leaking corner shows nothing at all. With the corner case no longer demanding extreme depth discrimination, `SHADOW_MAP_SIZE` dropped 4096 → 2048 (536 MB → ~134 MB of shadow attachments) with the 4x-MSAA moment resolve keeping shadow edges smooth. One knock-on effect, caught by readback: at 2048 the 3x3 PCF's diagonal taps on a 60°-lit floor step across more receiver slope than the old fixed `normalOffset = 0.02` covered (5.9e-4 vs 5.7e-4 depth), reading a sunlit floor at 0.81 visibility — the offset is really a *texel-count* quantity, so it doubled to 0.04 (~2.5 texels at 2048 over this scene's frustum) and must be rescaled if the map size or scene scale changes.

**Final round: the staircase in the residual hairline (shadow-pass MSAA + moment resolve).** Up close, the remaining hairline showed a blocky, streak-like segmentation — correctly diagnosed by the user as a resolution artifact: with exactly one depth sample per shadow texel, every texel is a pure delta distribution, so the hairline's boundary quantizes to whole shadow-map texels (~4mm world at 4096² over this scene). Two candidate fixes were measured before choosing. Lowering `momentBias` further (to shrink the band itself) was **rejected on fp32 evidence**: below 1e-5 the step behaves non-monotonically in fp32 emulation, and the exact-self-query case (`query == storedDepth`, reachable if the normal offset were ever removed) produces NaN even at 1e-5 — the normal offset's guaranteed in-front margin is what keeps that case unreachable today, so `momentBias` stays at 1e-5 and should not be pushed lower without re-verifying. The implemented fix is the one the paper's supplementary itself recommends (after Lauritzen et al. 2011): render the shadow pass **depth-only at 4x MSAA** (`shadow.wgsl`, no fragment stage) and resolve the sub-texel samples into averaged per-texel moments in a fullscreen pass (`shadow_resolve.wgsl`). Boundary texels then hold genuine mixed distributions, and the Hausdorff reconstruction turns the mixture into smooth fractional occlusion — verified offline first (a 50/50 two-depth texel reconstructs 0 → ~0.2 → ~0.9 as the query crosses it, i.e. correctly conservative fractions rather than a hard flip), then on the GPU (corner visibility unchanged-or-better: 0.012 at 1cm, 0.0003 at 5cm, sunlit floor exactly 1.0; zoomed render shows a clean, uniform anti-aliased hairline with no staircase). Memory note: this round shipped at 4096² (~536MB of rgba32float moments + 4x depth32float MSAA), but the solid-geometry change above subsequently let `SHADOW_MAP_SIZE` drop to **2048** (~134MB) — that 2048 is the current value in `clusteredForwardRenderer.ts`, so treat any "4096²" figure in this paragraph as the historical state, not the code today. `SHADOW_MAP_SIZE` remains the first knob to turn on smaller hardware, at the cost of proportionally wider corner hairlines.

**Dead ends, kept here so they aren't retried:**

1. **Bigger flat/slope-scaled bias** (pre-MSM). Aimed at a *different*, misdiagnosed symptom, a large bias didn't visibly change that symptom at all — which should have been the tell — but it did silently erase the sunbeam-through-window shadow contrast everywhere, because a bias that large passes the depth comparison far more often than it should, globally, not just at corners. Moot now that there's no bias to oversize, but the underlying lesson (auto-exposure can hide a global lighting regression by compensating for it) still applies to any future tuning here.
2. **Screen-space-derivative adaptive bias** (pre-MSM). Sizing a bias from `dpdx`/`dpdy` of the light-space depth made things categorically worse: those derivatives are finite differences between *adjacent screen pixels*, meaningless at any hard geometric edge in a scene built from flat quads. Not needed under MSM regardless, since there's no bias left to size.
3. **The uniform-distribution moment-bias target**, $(0.5,\tfrac13,0.5,0.2)$. Mathematically "a real distribution's moments," but wrong for this purpose — see above. Use $(0.5,0.5,0.5,0.5)$, the paper's actual reference value.
4. **`rgba16float` + hardware bilinear filtering.** Sound in theory (matches the paper's stated design), measurably worse in practice for this scene's precision requirements — see above.
5. **The optimized 4-moment quantization basis** (paper Section 8, supplementary Listing 1/2). Tested offline against the exact real corner data with simulated 16-bit quantization: reproduces the raw moments correctly (confirming the transcribed matrix constants are right) but doesn't change the reconstruction's accuracy at all, because it's a *quantization-efficiency* transform (packing more usable entropy into 16-bit-per-channel storage), not a precision or bias-conditioning fix — it solves a different problem than the one this corner has. Not implemented, since `rgba32float` sidesteps the quantization problem entirely by not quantizing.

**Aside — a wrong turn worth naming so it isn't repeated:** early in this investigation, a raw `N·L` (to the sun) reading of `+0.15` at the leaking wall was taken as proof the wall "genuinely faces the sun, so it's not a shadow bug." That's wrong: `N·L` only says a surface's *orientation* could catch the sun if nothing were in the way — it says nothing about whether the room's own solid structure blocks the path, which is exactly what a shadow map exists to determine. The corner in question is nowhere near the window opening, so a positive `N·L` there is irrelevant; only the ray-trace and shadow-map-content checks above actually settle whether it's correctly shadowed.

## The one skipped optimization

A "complete" clustered-forward implementation rebuilds cluster AABBs only when the camera's projection matrix changes (fov/aspect/near/far), since the AABBs are purely a function of that matrix, not of camera position or scene content. This renderer rebuilds them every single frame instead. At `3,456` clusters this is a negligible compute cost, and skipping the dirty-tracking logic (detecting exactly when the projection changed, correctly invalidating on window resize) removed a whole class of potential bugs for a feature this engine doesn't currently need (the projection rarely changes mid-scene in either demo). Worth revisiting if cluster counts grow by an order of magnitude or the compute budget gets tight.

---

## Tunable parameters

```
ClusterConfig {
  CLUSTER_COUNT_X, CLUSTER_COUNT_Y, CLUSTER_COUNT_Z  // 16 x 9 x 24 — grid resolution
  MAX_LIGHTS_PER_CLUSTER                              // 32 — per-cluster light-list capacity
  MAX_POINT_LIGHTS                                    // 256 — total lights uploaded per frame
}

ShadowMap {
  SHADOW_MAP_SIZE           // 2048 — resolution (~134 MB of shadow attachments; was 4096/536 MB
                            //         before roomBox got solid walls). Resolution was never the
                            //         corner-leak fix (a one-depth-per-texel ambiguity, not
                            //         aliasing), so don't reach for this first if an artifact
                            //         shows up
  SHADOW_BOUNDS_PADDING     // 1 — safety margin added to the computed scene radius
  normalOffset              // 0.04 — world units ≈ 2.5 shadow texels at 2048 over this scene;
                            //         a *texel-count* quantity — rescale it with SHADOW_MAP_SIZE
                            //         (0.02 @ 4096 measurably failed at 2048 on sloped receivers)
  roomBox thickness         // 0.2 — solid-slab wall thickness; the actual corner-leak fix (gap at
                            //         a corner ≈ thickness ≫ reconstruction threshold)
  momentBias                // 1e-5 — Formula 6; blends toward (0.5,0.5,0.5,0.5) — NOT the uniform-
                            //         distribution's true moments, that was a real regression, see
                            //         Formula 6's writeup. Sets the width of the residual corner
                            //         band (~1cm world at 1e-5). Do NOT lower it: fp32 behaves
                            //         non-monotonically below 1e-5, and the exact-self-query case
                            //         NaNs — only the normal offset keeps that case unreachable.
  SHADOW_MSAA_SAMPLES       // 4 — Formula 6 final round; sub-texel depth samples averaged into
                            //         each texel's moments by shadow_resolve.wgsl (anti-aliases
                            //         shadow boundaries; without it they quantize to whole texels)
  shadowNearFar             // [0.98r, 3.02r] — hugs the scene's actual span along the light
                            //         (light camera at 2r from center); the old [0.1, 4r] wasted
                            //         nearly half the depth range on empty space
}
```
