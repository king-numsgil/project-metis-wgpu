# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`metis-engine` is a WebGPU clustered-forward PBR renderer for the space-sim game — built directly on `bun-webgpu-rs`'s raw WebGPU/SDL3 bindings (no other rendering-facing dependency; `wgpu-matrix` is the only non-`bun-webgpu-rs` dependency, for matrix/vector math). It's a standalone package with no dependency on `metis-tui`. `metis-game` consumes it (a 100-point-light demo), and does so via the caller-owned-device path — it never touches `RenderContext`. See "The engine does not own the window" below.

It's the first package in this monorepo to build a *real* render pipeline — depth buffer, vertex buffers, multiple bind groups, compute passes, multisample-capable targets. Every prior pipeline in `bun-webgpu-rs/tests/render*.test.ts` and `metis-game/src/index.ts` is a hardcoded no-vertex-buffer triangle, so the patterns here (vertex layouts, bind group group-index conventions, WGSL module concatenation) are this repo's first precedent, not a continuation of one.

## Read [`DOC.md`](DOC.md) first

[`DOC.md`](DOC.md) is this package's **API reference**: every public export with
its signature, the canonical render-loop recipe (windowed and headless), the
config constants, and the invariants that fail silently (winding/cull direction,
resolved-vs-multisampled views, `sunDirection` semantics, swallowed WebGPU
validation errors).

**Consult it before opening source files.** It exists so a task doesn't start
with a dozen `Read` calls. Drop to source only when it doesn't cover what you
need — then consider whether the gap belongs in the doc.

**Keep it current.** Changing a public API — an exported symbol's signature, a
constant in `clusterConfig.ts`, the pass order inside `render()`, or any
documented invariant — means updating `DOC.md` **in the same change**. A stale
doc is worse than none, because it will be trusted.

This `CLAUDE.md` explains *why* (architecture, rationale, the debugging history
below). `DOC.md` explains *what to call*. Keep that split — don't duplicate
war stories into `DOC.md`, don't grow an API listing here.

## Commands

Run from `packages/metis-engine/` unless noted.

```powershell
# Install deps (from repo root)
bun install

# Headless render + screenshot validation — writes PNGs to tests/output/,
# reuses bun-webgpu-rs's takeScreenshot test helper
bun run fixture

# Interactive windowed demos (WASD+QE fly, arrows look, Esc quit)
bun run demo:exterior
bun run demo:interior

# Standalone VectorContext (text rendering) smoke test
bun run test/vectorText.smoke.ts

# Type-check this package (or `cd ../.. && bunx tsc --noEmit` for the whole monorepo)
bunx tsc --noEmit
```

There is no `bun test` suite — `test/fixture.ts` (screenshots + a hard failure if `VectorContext` draws nothing) is the automated check, run manually rather than wired into a test runner.

## Architecture

### Module layout

```
src/
  rhi/          context.ts    — device/adapter/surface lifecycle; RenderContext.createOffscreen()
                                 (headless, for the fixture) vs. createWindowed() (SDL, for demos)
                                 both funnel through the same beginFrame()/FrameTarget shape
                targets.ts    — the shared HDR (rgba16float) color + depth32float targets, both 4x
                                 multisampled (see "Why MSAA" below); color auto-resolves into a
                                 single-sampled texture every post-process pass reads, resized
                                 alongside the swapchain/offscreen capture texture
  math/         camera.ts, transform.ts — thin wrappers over wgpu-matrix (Camera is look-at based;
                                            Transform is position/Euler-rotation/scale -> mat4)
  scene/        mesh.ts       — GPU vertex/index buffers + the one shared vertex layout
                                 (pos/normal/tangent/uv, stride 48) every mesh in the engine uses
                material.ts   — metallic-roughness factors, each optionally multiplied by a texture
                                 (albedo/normal/metallic/roughness/emissive) — see math/PBR shading
                                 formulas.md's "Textures" section
                light.ts, environment.ts, scene.ts — plain data + the Scene/SceneInstance containers
  shading/      wgsl/*.wgsl   — common.wgsl (shared structs + BRDF, concatenated into every other
                                 shader module — WGSL has no #include), forward.wgsl, cluster_build.wgsl,
                                 light_cull.wgsl, shadow.wgsl, shadow_resolve.wgsl (standalone — MSAA
                                 shadow depth -> per-texel moments)
                clusteredForwardRenderer.ts — owns every pipeline/buffer above; render() runs, per
                                 frame: write uniforms -> shadow pass -> cluster build + light cull
                                 (compute) -> forward pass
                std140.ts     — hand-rolled uniform/storage buffer byte-packing (WGSL's std140-ish
                                 alignment rules: vec3 pads to 16 bytes, a following scalar packs into
                                 that gap, mat4 is 4 vec4 columns)
  ao/           ambientOcclusion.ts — screen-space AO subsystem owned by the forward
                                 renderer: a geometry prepass (view-space normals + depth) ->
                                 SSAO or HBAO -> box blur, feeding the forward pass's ambient term
                aoConfig.ts   — the AoTechnique enum (None/SSAO/HBAO) + per-technique tunables
                aoKernel.ts   — deterministic SSAO hemisphere kernel + rotation-noise generators
                                 (pure, unit-tested); wgsl/ao_prepass|ssao|hbao|ao_blur.wgsl
                                 — see math/Ambient occlusion formulas.md
  postprocess/  pipeline.ts   — PostProcessPass interface + PostProcessPipeline; createDefaultPostProcessPipeline()
                                 wires the three passes below into the standard chain
                luminanceAverage.ts, autoExposure.ts, tonemap.ts — HDR forward output -> measure
                                 luminance -> adapt exposure -> ACES filmic tonemap
  text/         vectorText.ts — wraps bun-webgpu-rs's VectorContext for screen-space HUD text
  assets/       primitives.ts — procedural cube/sphere/plane/room-box generation (the guaranteed,
                                 network-independent path every demo/fixture scene defaults to)
                gltf.ts       — a deliberately narrow glTF 2.0 reader (see its doc comment for the
                                 exact supported subset), not a general-purpose importer
                texture.ts    — loadTexture() (image file -> GpuTexture via bun-webgpu-rs's
                                 `sdlImageLoadTexture` SDL3_image binding — decode + upload happen
                                 in Rust, supports PNG/JPG/WebP/…; replaced the former from-scratch
                                 PNG decoder) + getMaterialDefaults() (the shared 1x1 neutral
                                 placeholders every unset material texture slot falls back to)
  index.ts      — public API barrel export
examples/       exterior-demo.ts, interior-demo.ts — windowed, interactive, SDL-loop-driven
test/           fixture.ts — headless validation harness (also downloads+caches a Khronos sample
                              glTF into test/assets-cache/, gitignored); vectorText.smoke.ts —
                              standalone text test
math/           formula references cited by the shading code, following the same "honest physics +
                explicitly labeled handwave" convention as packages/metis-tui/math/
```

### The engine does not own the window — `RenderContext` is a convenience

`RenderContext` bundles four separable jobs (SDL/window lifetime, adapter+device
creation, the surface/swapchain, and `RenderTargets` allocation), which makes it
*look* like the engine's entry point. It isn't. `ClusteredForwardRenderer.render()`
takes only a `GpuCommandEncoder`, a `RenderTargets`, and a `Scene`; the post chain
takes an output view + format. Nothing in the render path references a window, a
surface, or SDL.

So a host that already bootstraps its own window/adapter/device/surface — which
is exactly what `metis-game` does — constructs `new RenderTargets(device, w, h)`,
`new ClusteredForwardRenderer(device)`, and `createDefaultPostProcessPipeline(device)`
directly, and never touches `RenderContext`. This was verified end-to-end (a real
window + caller-owned device driving a full frame, clean under a `validation`
error scope). `DOC.md` §1.3 documents that path.

A `SceneRenderer` facade bundling targets+forward+post behind one `render(encoder,
scene, output, dt)` call was proposed and **deliberately declined** — the explicit
wiring keeps the data flow (and the resolved-vs-multisampled view choice) visible
at the call site. Don't add one without a fresh reason; do keep `RenderContext`
strictly optional, and don't let engine types acquire a window/surface dependency.

### Why "clustered forward," concretely

`ClusteredForwardRenderer.render()` does, every frame: (1) write the camera/environment uniforms, (2) fit an orthographic shadow frustum to the scene's bounding sphere and render a depth-only pass from the sun's viewpoint (`shadow.wgsl`), (3) run two compute passes — `cluster_build.wgsl` divides the view frustum into a fixed 16×9×24 grid with exponential depth slicing, `light_cull.wgsl` sphere-tests every point light against every cluster's AABB and writes a per-cluster light-index list — then (4) the actual forward pass, where `forward.wgsl`'s fragment shader looks up its own cluster and only shades the lights assigned to it, plus the sun (shadow-tested) and a flat ambient term. See `math/Clustered forward formulas.md` for the exact formulas, including the two real bugs hit building this (a room mesh's shadow frustum computed from instance *position* instead of mesh *extent*, and shadow-pass backface culling dropping a room's inward-facing geometry when viewed from outside by the light) and how they were diagnosed.

### Exterior vs. interior is data, not code

There's no `if (interior)` branch anywhere in the shading code. `Environment.ambientIntensity` (near 0 for `createExteriorEnvironment()`, a small nonzero value for `createInteriorEnvironment()`) is the only lighting-model difference between the two; the visual difference between the exterior and interior demos comes from geometry (a room shell with an actual hole cut into one wall — `assets/primitives.ts`'s `roomBox()`) and the directional shadow map actually occluding the sun everywhere except through that hole. See `math/PBR shading formulas.md`'s "ambient / exterior vs. interior" section.

### Ambient occlusion is a swappable enum, and only touches the ambient term

`ClusteredForwardRenderer` owns an `AmbientOcclusion` (`src/ao/`); set `renderer.ao.technique` to `AoTechnique.None`, `.SSAO`, or `.HBAO` (a runtime quality dial — the interior demo cycles it with the `O` key). When active it runs three passes *before* the forward pass — a geometry prepass (view-space normals + depth), the chosen occlusion technique (`ssao.wgsl`/`hbao.wgsl`, fullscreen), and a box blur — and `forward.wgsl` multiplies the result into **only** the flat ambient term. That last part is the load-bearing correctness point: AO approximates occlusion of *indirect/bounce* light, so it must never darken the sun or point lights (their occlusion is the shadow map's job). Multiplying the whole lit image by AO — which some engines do — double-darkens shadowed creases and is wrong. `None` is branchless: the renderer clears the AO buffer to white so the forward multiply is a no-op, mirroring the always-bound-placeholder pattern the material textures already use. Both techniques' math (and the deliberate normal-oriented HBAO tangent simplification) is in `math/Ambient occlusion formulas.md`; `test/ao.test.ts` validates the kernel generators on the CPU and, via GPU readback + a `pushErrorScope`, that each technique darkens a box's contact creases without any swallowed WGSL validation error. The prepass is a *second* geometry pass (a production engine would share a depth prepass); at this engine's scale the duplicate draw is cheap and keeps AO decoupled from the forward path.

### Why MSAA — and a misdiagnosis worth knowing about

The forward pipeline renders 4x multisampled (`RenderTargets.hdrColorMultisampled`/`depth` in `src/rhi/targets.ts`; the color target auto-resolves via `resolveTarget` into a single-sampled texture everything downstream reads — depth doesn't resolve, since WebGPU has no depth `resolveTarget`, so `LuminanceAveragePass` reads it directly as `texture_depth_multisampled_2d` at sample index 0, which is enough to know whether *something* was drawn there). This exists because the interior demo showed a "dashed line" artifact along the room's floor/wall and wall/wall seams that **was originally (wrongly) diagnosed as shadow-map acne** — several rounds of shadow bias/normal-offset/PCF tuning had zero visible effect on it, which in hindsight was the tell. It was ordinary geometric-edge aliasing (no MSAA existed at all before this): two adjacent, differently-lit flat-shaded quads meeting at a hard edge, rendered with exactly one sample per pixel, alias into what looks exactly like a dashed shadow-map artifact when the edge is nearly axis-aligned in screen space. Enabling MSAA fixed it outright; the shadow-side tuning (Formula 6 in `math/Clustered forward formulas.md`) turned out to be solving a real but much smaller problem that was never the visible complaint. Lesson: when a targeted fix produces *zero* visible change, that's a stronger signal to question the diagnosis than to push the fix further.

### A second, genuinely separate shadow leak — fixed via Moment Shadow Mapping, not the BRDF

After MSAA shipped, a *different* artifact turned up on close zoom of the interior console: a thin bright line at the concave corner where the right wall meets the window-wall frame. It reproduces identically with MSAA on or off, so it's unrelated to the issue above. It was first misdiagnosed a second time — a raw N·L check at the leak point came back positive, which was wrongly taken as "the wall genuinely faces the sun, not a shadow bug" (with BRDF wrap-lighting proposed as a fix). That's wrong: N·L only says the surface *orientation* faces the sun, not whether the room's own solid geometry blocks the actual path there — occlusion is exactly what the shadow map decides, not the BRDF. Confirmed as a real shadow bug two independent ways: JS-side ray-tracing against the exact camera/light matrices (every "leaking" point has zero line-of-sight to the sun through the window), and a raw readback of the shadow map's own stored depth (the true occluder's depth was only ~0.0008-0.002 units closer to the light than the receiver). Root cause: two real occluding surfaces meet at a corner viewed at a steep angle *to the light* (not the same thing as N·L to the sun), producing near-coincident light-space depths at the shared edge — the textbook receiver-plane-depth problem for single-sample shadow mapping, where a plain depth-compare-plus-bias test can only ever keep one number per texel and so can't tell "real neighboring occluder" from "acne."

A first pass (increasing the normal-offset sample displacement from 0.05 to 0.1 world units) shrank the leak roughly 3x but never closed it — same underlying limitation, different angle of attack. The actual fix replaces the shadow map's representation entirely: `shadow.wgsl` now writes the first four power moments of the light-space depth ($E[z]..E[z^4]$) per texel into an `rgba32float` target instead of a single nearest depth, and `forward.wgsl`'s `computeMsmOcclusion()` reconstructs occlusion via a closed-form Cholesky factorization of the moments' Hankel matrix (Moment Shadow Mapping, Peters & Klein 2015) — no epsilon bias needed at all, since the ambiguity that a single depth value can't resolve is encoded in the higher moments instead of thrown away. The remaining `normalOffset` (now `0.04`, well under the `0.1` stopgap — it's a texel-count quantity, rescaled from `0.02` when `SHADOW_MAP_SIZE` later dropped to 2048; see Known limitations) is just ordinary acne insurance on curved surfaces, no longer load-bearing for the corner case.

**The first MSM implementation shipped a real regression, caught by GPU-readback verification, not by more screenshots.** It used an invented moment-bias target ($(0.5,\frac13,0.5,0.2)$, the true moments of a uniform distribution) instead of the paper's actual reference value ($(0.5,0.5,0.5,0.5)$) — plausible-looking, but wrong, and it made the corner leak visibly *worse*. Told to "do the raw texel tests" instead of guessing further, a debug script read back real GPU-rendered shadow-map moments at the exact corner (`copyTextureToTexture` + manual buffer mapping) and fed them through a JS port of the reconstruction, which reproduced the bug exactly and pinned it to the wrong bias target — confirmed against the paper's own supplementary PDF, fetched directly rather than trusted from memory a second time. A follow-up attempt at real hardware bilinear filtering (`rgba16float`, matching the paper's recommendation) was *also* verified-and-rejected: `rgba16float`'s own rounding error at this scene's depth range is comparable to the smallest gaps that matter, so it traded one precision problem for another. The verified-correct combination is `rgba32float` (no filtering) + the paper's exact bias constant. Full history, including a stray bug in the debug script's own byte-reinterpretation (`new Float32Array(uint8Array)` converts *values*, not bits), is in Formula 6 of `math/Clustered forward formulas.md`.

**Even after that fix, the visible bleed persisted — and the final cause was the choice of moment-problem variant, not a constant.** The paper's default *Hamburger* reconstruction (support on all of ℝ) has a light-bleeding tail: reconstructed visibility falls off only as ~variance/gap², and an interior sun bright enough to blow out through a window makes even 0.1% visibility glow, so every concave seam bled for meters. Switching to the paper's *Hausdorff* variant (Algorithm 4: support constrained to [0,1], with a four-support-point fallback branch) eliminates the tail outright — for a single-occluder texel the bound reduces algebraically to an exact 0/1 step regardless of gap size. Verified by fp32 emulation against real readback data, then live GPU readback (visibility 1cm from the corner: 0.973 → 0.003; sunlit surfaces unchanged at 1.0), then zoomed renders at the exact viewpoints that showed the bleed. The shadow ortho near/far was also tightened to the scene's actual light-space span ([0.98r, 3.02r] instead of [0.1, 4r]), doubling depth precision. Details and the hand-derivation: Formula 6 in `math/Clustered forward formulas.md`.

### Winding convention — and the inside-out sphere

The forward pipeline culls back faces with the default CCW front-face convention, and `assets/primitives.ts`'s `addQuad` builds CCW-from-the-normal-side quads to match. `uvSphere`, however, shipped with clockwise-from-outside triangles — so the rasterizer culled the sphere's *outside* and rendered its interior, with outward vertex normals attached to the far hemisphere. Result: every light lit the side of the sphere *opposite* itself, patches slid around with camera motion ("the specular highlights follow me"), and specular was killed entirely (N·V < 0 on the visible surface) — while all quad-based geometry shaded correctly, which made the report easy to misattribute to the BRDF or light culling. Root-caused by A/B rendering with cluster culling bypassed (pixel-identical → culling exonerated) and a light placed behind the sphere (it lit the camera-facing side → geometry, not shading), then confirmed by hand-winding the equator triangle. If a new mesh source ever shows "lights on the wrong side + no specular," check winding against `cullMode` before touching the shading code.

### Textures: always-bound placeholders, no shader branching

Every material's bind group has exactly 6 texture-related bindings (1 sampler + 5 textures) whether or not it was given real textures — unset slots bind a shared 1x1 neutral placeholder (`assets/texture.ts`'s `getMaterialDefaults`) chosen so sampling it is a no-op against the material's own factors (white for anything multiplied, a flat tangent-space normal that reproduces the vertex normal unchanged). This keeps the bind group layout — and therefore the pipeline — identical for every material, avoiding per-material pipeline variants or a `hasTexture` uniform flag with shader branching. `test/fixture.ts`'s `textured` scene downloads a real CC0 texture set (Poly Haven's `metal_plate_02`, via its public file API) to validate all four map types at once; its small "emissive panel" object uses a synthetically-generated (not downloaded) checkerboard pattern purely to exercise the emissive-texture path, since no suitable small standalone CC0 emissive asset was sourced.

### Debugging WebGPU validation errors — read this before assuming something "worked"

**`bun-webgpu-rs` does not throw or reject on WebGPU validation errors.** They print to stderr as `[wgpu] uncaptured error: ...` and execution continues with whatever partial/garbage state resulted (an invalid command encoder, an unwritten buffer, a texture that silently kept its cleared value). A script can run to completion, write a file, and print a success message while having done nothing correct. **Always grep test/demo output for `wgpu` or run without piping through `tail`/`head`** — several real bugs during this engine's development (a shader with unreachable code after a `return`, a debug texture read missing `COPY_SRC`) were completely invisible until stderr was checked directly instead of trusting a clean exit code.

### WGSL module concatenation

`bun-webgpu-rs`'s `createShaderModule` takes one `code: string`; WGSL has no `#include`. Every shader that needs the shared structs/BRDF/cluster-math in `common.wgsl` gets it via plain string concatenation (`` `${commonWgsl}\n${forwardWgsl}` ``) in `clusteredForwardRenderer.ts` — see that file for which `.wgsl` files pair with which. `.wgsl` files are imported as raw text via Bun's `with { type: "text" }` import attribute (ambient-declared in `src/shading/wgsl.d.ts`).

### Known limitations (not yet done)

- No image-based lighting / environment reflections — a pure metal with no texture is lit only by direct lights, nothing else (see `math/PBR shading formulas.md`'s "Where the real handwave lives").
- Point lights don't cast shadows, only the directional sun does.
- The concave-corner shadow leak (see "A second, genuinely separate shadow leak" above) is fully closed, in the end by *geometry*: `roomBox` builds solid-slab walls (0.2 units thick), so a corner's occluder record is the wall's sunlit exterior face — depth gaps ~100x the moment reconstruction's threshold, GPU-verified at 0.0000-0.0001 visibility down to 2mm from the corner, no hairline at all in zoomed renders. Zero-thickness occluder geometry is the one case the shadow system genuinely cannot fully resolve (occluder and receiver depths coincide at a shared edge) — prefer closed/thick meshes for anything that must cast interior shadows. This also paid for `SHADOW_MAP_SIZE` 4096 → 2048 (~536 MB → ~134 MB of shadow attachments). Do not lower `momentBias` below 1e-5 — fp32 goes non-monotonic and the exact-self-query case NaNs — and `normalOffset` is a texel-count quantity (0.04 ≈ 2.5 texels at 2048): rescale it with the map size; see Formula 6.
- The glTF loader (`assets/gltf.ts`) doesn't read a `TANGENT` accessor (fabricates an arbitrary perpendicular vector instead) and ignores any texture a glTF material references (factors only) — fine for the plain untextured "Box" sample it's validated against, wrong for a real normal-mapped/textured glTF asset. It also only handles a narrow subset generally: separate `.gltf` + `.bin` (no `.glb`, no embedded base64), `f32` POSITION/NORMAL/optional-TEXCOORD_0, `u16`/`u32` indices. Anything with skinning, morph targets, sparse accessors, or multiple buffers will throw.
