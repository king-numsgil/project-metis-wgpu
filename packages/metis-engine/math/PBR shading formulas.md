# PBR shading formulas

# Metallic-roughness Cook-Torrance BRDF — model & formula reference

## What this actually is

Every real-time PBR renderer computes light reflecting off a surface with the same skeleton: a diffuse term (light that scatters beneath the surface and re-emerges in all directions) plus a specular term (light that bounces directly off the surface, concentrated near the mirror-reflection direction), combined according to how "metal" the surface is. The specular term is the **Cook-Torrance microfacet model** — treating a rough surface as a huge number of tiny mirror facets, each perfectly flat, oriented in a statistical spread controlled by a roughness parameter. This is standard, load-bearing, non-negotiable physics for anything claiming to be "PBR" — the honest part of the model.

The specific approximations chosen for each of the three microfacet terms (distribution, geometry/shadowing, Fresnel) are where every real-time engine — this one included — trades exactness for a closed-form expression that runs per-pixel at 60fps. Those substitutions are the handwave, and they're the same ones Epic Games shipped in Unreal Engine 4 (Karis 2013, "Real Shading in Unreal Engine 4"), because they're an unusually good trade.

---

## Formula 1 — GGX / Trowbridge-Reitz normal distribution

$$
D(N,H,\alpha) = \frac{\alpha^2}{\pi\left((N\cdot H)^2(\alpha^2-1)+1\right)^2}
$$

Where `N` is the surface normal, `H` is the halfway vector between the view and light directions, and `α = roughness²` (the perceptual-to-physical roughness remap every engine applies — raw `roughness` feels too glossy across most of its 0-1 range if used directly as `α`).

**ELI5:** This term answers "what fraction of the surface's microfacets are oriented to reflect the light straight at the camera right now?" Low roughness (`α` near 0) makes this function extremely peaked — a tiny, blinding highlight, like polished metal. High roughness spreads the same reflected energy over a much wider, dimmer highlight, like brushed aluminum. Implemented in `src/shading/wgsl/common.wgsl`'s `distributionGGX`.

## Formula 2 — Smith geometry (Schlick-GGX)

$$
G_1(N,V,\alpha) = \frac{N\cdot V}{(N\cdot V)(1-k)+k}, \qquad k = \frac{(\alpha+1)^2}{8}, \qquad G(N,V,L,\alpha)=G_1(N,V,\alpha)\,G_1(N,L,\alpha)
$$

**ELI5:** Microfacets cast shadows on each other and block each other's reflections (self-occlusion), which is why very rough surfaces look darker at grazing angles than the distribution term alone would predict. `G` is the fraction of microfacets that are simultaneously unshadowed from the light and unoccluded toward the camera.

**Honest caveat:** the `k = (α+1)²/8` remap is Karis's *direct-lighting* fit, tuned to match a more expensive reference computation. It is deliberately different from the IBL/image-based-lighting remap (`k = α²/2`) used by engines that also do reflection-probe lighting — this renderer only implements direct lighting (sun + point lights, no environment probes), so only the direct-lighting form appears in `geometrySchlickGGX`.

## Formula 3 — Fresnel-Schlick approximation

$$
F(\cos\theta, F_0) = F_0 + (1-F_0)(1-\cos\theta)^5
$$

Where `F0` is the surface's reflectance at normal incidence (`0.04` for dielectrics — plastics, wood, skin — or the surface's own albedo for metals, per Formula 4's `mix`), and `cosθ = max(dot(H,V), 0)`.

**ELI5:** Every surface, even matte plastic, turns into a mirror at a glancing enough angle — that's why a wet road looks reflective near the horizon but not underfoot. Schlick's polynomial is a cheap stand-in for the real Fresnel equations (which involve the material's complex refractive index) and is accurate to within a couple percent for the range of angles that actually matter visually.

## Formula 4 — Full Cook-Torrance combination

$$
f_r = \underbrace{\frac{D\,G\,F}{4(N\cdot V)(N\cdot L)}}_{\text{specular}} + \underbrace{(1-F)(1-\text{metallic})\,\frac{\text{albedo}}{\pi}}_{\text{diffuse}}, \qquad L_o = f_r \cdot L_i \cdot (N\cdot L)
$$

Where `F0 = mix(0.04, albedo, metallic)` — the single dial that turns a surface from "dielectric with a fixed 4% specular reflectance and full diffuse response" to "metal with colored specular reflectance and zero diffuse response." Implemented in `shadeLight()` in `common.wgsl`, called once per light (sun, then each culled point light) and summed.

**ELI5:** `(1-F)` in the diffuse term is what keeps the surface from looking simultaneously matte *and* mirror-bright at grazing angles — light that got reflected specularly (accounted for by `F`) can't also be available to scatter diffusely. This is the "energy conservation" every PBR renderer advertises; without it, rough plastic edges look implausibly hot.

## Formula 5 — Tangent-space normal mapping

$$
N_{world} = \text{normalize}\big(T\,n_x + B\,n_y + N_{geom}\,n_z\big), \qquad (n_x,n_y,n_z) = 2\cdot\text{texture}(x,y) - 1
$$

Where `T` (tangent) and `N_geom` (the interpolated vertex normal) come from the mesh, and `B = cross(N_geom, T) \cdot w` (bitangent), with `w = \pm1` resolving the handedness of the UV parameterization. The normal map stores directions in a local "tangent space" (packed from `[-1,1]` into a texture's `[0,1]` range), and this `T,B,N` basis (the "TBN matrix") rotates that local direction into world space.

**ELI5:** A normal map doesn't encode a color — it encodes "which way is this bit of surface actually facing, at a resolution too fine to model with real geometry." Every texel's `(r,g,b)` is a direction: mostly-blue means "basically the same as the underlying geometry," and reddish/greenish tints mean "tilted slightly left/right or up/down." `T`/`B` give the map's local left/up axes in world space so that tilt means the same thing regardless of which way the surface (and its UV layout) happens to be facing.

**Honest caveat:** every mesh in `assets/primitives.ts` gets its tangent from geometry alone (`normalize(u)` for quads, the sphere's longitude derivative for `uvSphere`) — never from a real per-UV-derivative computation against arbitrary art-authored UVs, since procedural primitives generate their own UVs to match. The glTF loader (`assets/gltf.ts`) doesn't read a `TANGENT` accessor at all — it fabricates an arbitrary-but-consistent perpendicular vector, which is fine for untextured or unlit-normal-map content (the Khronos "Box" sample has neither) but would look wrong on a real normal-mapped glTF asset. Tangents also transform through the normal matrix (inverse-transpose), which is exactly correct for the normal but only an approximation for the tangent under non-uniform scale — a corner every real-time engine cuts, since exact tangent transformation needs the forward model matrix, not its inverse-transpose, and the difference is imperceptible for the uniform-scale content this engine actually renders.

---

## Where the real handwave lives

This renderer has **no image-based lighting** — no environment/reflection probes, no irradiance maps. A pure-metal surface (`metallic = 1`) therefore only shows the sun and whatever point lights are in range; everywhere else on the surface is exactly black, because there's no captured environment for it to reflect. That's why the exterior demo's hull looks like polished gunmetal with a hard, narrow highlight rather than the softly-lit metal you'd see with a skybox behind the camera — a real-world spacecraft would pick up a dim reflection of Earth, the sun's corona, station lights, etc. that this model simply has no data source for. `Environment.ambientIntensity` (see below) is the deliberately crude stand-in: a single flat RGB term added to every fragment regardless of viewing angle or surface roughness, faking "some light is bouncing around" without simulating any of it.

## Textures

`Material` (`src/scene/material.ts`) accepts an optional albedo, normal, metallic, roughness, and emissive texture — glTF-style, each multiplying (or, for normal, perturbing) the corresponding factor rather than replacing it, so `baseColorFactor` still works as a tint even with a texture bound. Every material — textured or not — binds a full set of 5 textures + 1 sampler; ones it doesn't have fall back to a shared 1x1 neutral placeholder (`assets/texture.ts`'s `getMaterialDefaults`) chosen so sampling it is a mathematical no-op (white for anything multiplied, a flat tangent-space normal `(128,128,255)` that reproduces the unperturbed vertex normal exactly). This avoids needing per-material pipeline variants or `hasTexture` branching in the shader — the tradeoff is every draw call samples 5 textures whether it needs them or not, which is the standard, correct tradeoff for a renderer with a shared forward pipeline rather than a per-material shader permutation system.

**Color space, not a handwave:** `baseColor`/`albedoTexture` and `emissive`/`emissiveTexture` use `rgba8unorm-srgb` (art tools author color textures in sRGB; the hardware linearizes on sample, which is required before lighting math is valid). `normalTexture`, `metallicTexture`, and `roughnessTexture` use plain `rgba8unorm` — they're data, not display color, and applying sRGB decoding to them would silently corrupt every value. Getting this backwards is a classic, hard-to-notice bug (colors look "a bit off" rather than obviously broken) — `assets/texture.ts`'s `loadTexture` takes an explicit `srgb` flag rather than inferring it, specifically so this can't be gotten wrong by accident at a call site.

## Ambient / exterior vs. interior — the second handwave

There is no separate "interior mode" in the shader. `Environment` (`src/scene/environment.ts`) carries one `ambientIntensity` scalar, and the exterior/interior look is entirely an authoring choice: `createExteriorEnvironment()` defaults it near zero (space has no bounce light), `createInteriorEnvironment()` defaults it to a small nonzero value (fake wall-to-wall bounce light in an enclosed room). The sun and shadow map behave identically in both cases — see `math/Clustered forward formulas.md` for how the directional shadow map is what actually makes "sunlight through a window" work, rather than any special-cased lighting mode.

---

## Material parameters

```
Material {
  baseColor         // vec4, linear RGBA — albedo (dielectrics) or reflectance tint (metals)
  metallic          // 0-1 — Formula 4's dial between dielectric and metal response
  roughness         // 0-1 — perceptual roughness, squared internally to alpha (Formula 1)
  emissive          // vec3 — added after all lighting, unaffected by any light or shadow
  albedoTexture?    // sRGB — multiplies baseColor
  normalTexture?    // linear — Formula 5, perturbs the geometric normal
  metallicTexture?  // linear, red channel — multiplies metallic
  roughnessTexture? // linear, red channel — multiplies roughness
  emissiveTexture?  // sRGB — multiplies emissive
}

Environment {
  sunDirection      // vec3, normalized — direction the light travels (sun -> scene)
  sunColor          // vec3
  sunIntensity      // f32 — radiance scale, tune against Tonemapping and exposure formulas.md
  ambientColor      // vec3
  ambientIntensity  // f32 — near 0 outside, small nonzero indoors (the labeled handwave above)
}
```
