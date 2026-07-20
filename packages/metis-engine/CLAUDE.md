# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`metis-engine` is a WebGPU clustered-forward PBR renderer for the space-sim game — built directly on `bun-webgpu-rs`'s raw WebGPU/SDL3 bindings (no other rendering-facing dependency; `wgpu-matrix` is the only non-`bun-webgpu-rs` dependency, for matrix/vector math). It's a standalone package with no dependency on `metis-tui`. `metis-game` consumes it (a 100-point-light demo), and does so via the caller-owned-device path — it never touches `RenderContext`. See "The engine does not own the window" below.

**`src/` is split into two independent subtrees.** `src/renderer/` is the entire renderer described in this doc (including `renderer/debug/` — the opt-in GPU profiler and the debug widgets); `src/ecs/` is a young archetype ECS (Structure-of-Arrays storage, no `metis-data` dependency) that will eventually feed the renderer. They do not depend on each other yet — the renderer still takes a hand-built `Scene`, not ECS data. The root `src/index.ts` re-exports them as namespaces (`export * as Renderer`, `export * as ECS`), but consumers import through the package's **subpath exports** — `metis-engine/renderer` and `metis-engine/ecs` — which is what `examples/`, `test/`, `bench/`, and `metis-game` now do (`import { ClusteredForwardRenderer, … } from "metis-engine/renderer"`). The ECS's current shape and limits are in "The ECS" below.

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

**No measured numbers in this file.** Frame times, fps, and per-pass costs go
stale within days of active work, and a stale number in a trusted doc is worse
than none — it invites comparison against a baseline that no longer exists.
Record the *finding* ("the forward pass is light-loop bound"), the *reasoning*,
and **how to re-measure it** (`bun run bench:lights --profile`). Derived facts
that follow from the constants — VRAM footprints, precision bounds, the
slices-per-doubling formula — are fine: they're properties of the design, not
snapshots of a machine.

## Commands

Run from `packages/metis-engine/` unless noted.

```powershell
# Install deps (from repo root)
bun install

# Headless render + screenshot validation — writes PNGs to test/output/,
# via bun-webgpu-rs's native readTexturePixels/saveTextureToFile
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

`src/` has three entries: the root barrel `index.ts` (`export * as Renderer` +
`export * as ECS`), the `renderer/` subtree (below), and the `ecs/` subtree
("The ECS", further down). The renderer breakdown below is rooted at
`src/renderer/`; `examples/`, `test/`, `bench/`, and `math/` sit at the package
root, unchanged by the split.

```
src/renderer/   — the entire renderer; import via "metis-engine/renderer"
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
                clusteredForwardRenderer.ts — the public renderer: owns the forward pipeline +
                                 camera/env uniforms, and orchestrates render() (write uniforms ->
                                 shadows -> cluster build+cull -> AO -> forward pass), wiring its
                                 collaborators' resources into the forward frame bind group
                lightCuller.ts — collaborator: the cluster-build + light-cull compute passes and
                                 their buffers; exposes the group-3 bind group/layout the forward
                                 pass reads (cluster_build.wgsl + light_cull.wgsl)
                shadowCascades.ts — collaborator: the whole 4-cascade CSM (cascade fit, the MSM
                                 cascade-0 depth+resolve and the PCF depth-array passes); exposes the
                                 moments/depth-array/samplers/uniform the forward frame bind group
                                 binds (shadow.wgsl + shadow_resolve.wgsl)
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
                                 + 2D vector debug graphics; paint colour is a palette indexed
                                 by VectorContext.setId(), and renderCached() replays geometry
                                 without re-tessellating (text is expensive — see "Debug widgets")
  debug/        gpuProfiler.ts — opt-in per-pass GPU timing via timestamp queries; ring-buffered
                                 readback, three feature tiers (see "Profiling" below)
                widgets.ts    — DebugOverlay: graph + tree widgets drawn with VectorText, plus
                                 History and profileSpansToRows
  assets/       primitives.ts — procedural cube/sphere/plane/room-box generation (the guaranteed,
                                 network-independent path every demo/fixture scene defaults to)
                gltf.ts       — a deliberately narrow glTF 2.0 reader (see its doc comment for the
                                 exact supported subset), not a general-purpose importer
                texture.ts    — loadTexture() (image file -> GpuTexture via bun-webgpu-rs's
                                 `loadImageTexture` — decode + upload happen in Rust, pure-Rust
                                 `image` crate; PNG/TGA/JPEG/Radiance HDR. Replaced the former
                                 from-scratch PNG decoder, then SDL3_image. NB `.hdr` yields an
                                 rgba16float texture, not rgba8unorm, and ignores `srgb`)
                                 + getMaterialDefaults() (the shared 1x1 neutral
                                 placeholders every unset material texture slot falls back to)
  frameLimiter.ts — software frame-rate cap ("vsync on" knob); await once per frame after
                  present(). Separate from present mode by design (see "Present mode" below)
  index.ts      — renderer barrel (re-exports RenderContext, Scene, ClusteredForwardRenderer, …);
                  reached from outside as "metis-engine/renderer"
examples/       exterior-demo.ts, interior-demo.ts — windowed, interactive, SDL-loop-driven
test/           fixture.ts — headless validation harness (also downloads+caches a Khronos sample
                              glTF into test/assets-cache/, gitignored); vectorText.smoke.ts —
                              standalone text test
math/           formula references cited by the shading code, following the same "honest physics +
                explicitly labeled handwave" convention as packages/metis-tui/math/
```

### The ECS (`src/ecs/`) — early archetype storage, not yet wired to rendering

`src/ecs/` is a from-scratch **archetype ECS** and is deliberately young — it is
storage only, with no systems, scheduling, or renderer integration yet. It exists
so the sim can be modelled as entities/components; the renderer still consumes a
hand-built `Scene`, and nothing extracts one from the other yet.

**Storage model: archetype + Structure-of-Arrays (SoA).** Entities with the *same
set of component names* share an `Archetype`. Within one, each component field is
stored as its **own typed-array column** indexed by a dense row — a scalar field
is one column, a vec field is one column *per axis* (`x`/`y`/`z`/`w`). So a system
touches data as a bare `column[row]` index: cache-friendly, fully typed, no
wrapper, no allocation. Removal is swap-with-last (copy the last row into the
vacated one, every column), so a row is **not** a stable handle across despawns —
the `EntityId → row` map is. Columns double on overflow (`INITIAL_CAPACITY = 32`;
each column is reallocated 2× and copied).

**Why SoA and not `metis-data`.** This subtree used to store AoS rows via
`metis-data` (`StructOf`/`wrap`). That was wrong: `metis-data` describes
*interleaved (AoS) GPU layout*, which is the slow shape to iterate per frame (the
whole "Performance intent" saga in `metis-data`'s CLAUDE.md). The ECS now owns its
own SoA storage with **no `metis-data` dependency**; `metis-data` will re-enter
only at the eventual *extract* step, interleaving SoA sim data into AoS buffers for
GPU upload. Field types are a small ECS-local vocabulary (`f32`/`u32`/`i32`/`f64`/
`i16`/`u16`/`i8`/`u8` + `vec2`/`vec3`/`vec4`), each mapped to a TypedArray.

Public surface (via `metis-engine/ecs`):
- `defineComponent(name, schema)` where a schema is `{ field: f32 | vec3(f32) | … }`.
- `World<Registry>`: `spawnEntity(...names) → EntityId`, `despawnEntity`,
  `getComponent(id, name)` (a random-access accessor — `pos.mass = 5`,
  `pos.position.x = 1` — settable scalars and `{x,y,z}` sub-objects, resolving the
  live row/array on each access so it survives growth and swaps),
  `queryEntities(names)`, and the fast path **`query(names, (cols, count, ids) => …)`**
  which runs once per matching archetype with the typed SoA columns
  (`cols.Position.pos.x[i]`), the dense count, and the dense entity ids. Don't
  spawn/despawn during a `query` — it invalidates that archetype's columns/rows.
- Debug helpers in `debug.ts` (`inspectWorld`/`printWorldInfo` — archetype + column
  layout). `src/ecs/test.ts` is a manual smoke script; `src/ecs/test/ecs.test.ts`
  is the automated `bun test` suite (spawn/despawn/query/growth/errors).

**What it deliberately does *not* have yet** (all discussed as next steps, none
built): entity **generation tags** (`EntityId` is a bare incrementing `number`,
so recycled ids would alias — ids are never reused today because there is no free
list, but that's not a safety guarantee); **exclusion queries** (`queryEntities`
matches archetypes that are a *superset* of the requested names — there is no
`Without`); a **hierarchy** (`ChildOf`/`Children` components) or transform
propagation; and any **system/scheduler** layer. Don't document these as if they
exist.

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

### Present mode is `mailbox`, and pacing is a separate `FrameLimiter`

The default present mode is **`mailbox`** (the `bun-webgpu-rs` binding default;
`RenderContext` passes no `presentMode` unless you set one). This came out of a
stutter hunt: native `fifo`/`auto-vsync` periodically stall `getCurrentTexture()`
for a ~50 ms multi-vblank burst on this machine's Vulkan driver when the loop
outruns refresh — a metronomic hitch. `mailbox` is tear-free and free of that
stall, but it does **not** cap the frame rate, so an idle loop renders flat-out.

**The demos and `bench/lights.ts` pass `presentMode: "immediate"`** anyway. That
isn't a reversal of the above — it's the dev-tooling case: tearing is irrelevant
when you're measuring, and `immediate` keeps present back-pressure out of
`getCurrentTexture()`, where it would otherwise land on top of the frame timings
(and on the GPU profiler's numbers). The binding/`RenderContext` default is still
`mailbox`, which is the right default for a real app; only the tools opt out.

Frame-rate capping is therefore a *separate* concern, handled by **`FrameLimiter`**
(`src/renderer/frameLimiter.ts`, exported from `metis-engine/renderer`), not by the
present mode. Construct it with a target fps (`0` = uncapped) and `await
limiter.wait()` once per frame after `present()`; it sleeps for all but the last
~2 ms and busy-spins the tail for jitter-free pacing, and yields to the event loop
even when uncapped. This is the load-bearing split: **tearing is the present
mode's job (`mailbox`), the frame cap is the limiter's job.** Don't try to get a
cap back by switching to `fifo` — that reintroduces the stall. The demos and
`bench/lights.ts` all wire an (uncapped) `FrameLimiter`; the bench calls `wait()`
*after* its GPU-timing readback so a cap never pollutes the measurement.

### `beginFrame()` must stay cheap — the WSI getter that hid in it

`RenderContext.outputFormat` used to be a plain getter delegating to
`surface.getPreferredFormat()`, and `beginFrame()` reads it to build the
`FrameTarget`. That call is a `get_capabilities` WSI round-trip — milliseconds,
not microseconds (see `bun-webgpu-rs/DOC.md` §2) — so every windowed frame
through `RenderContext` paid it, roughly halving the frame rate no matter how
little work the GPU had. It's resolved once in the constructor now
(`windowedFormat`). Encode and GPU time were unaffected, as they should be: the
fix removes a CPU stall and nothing else.

**Measure this kind of thing A/B in one sitting.** Absolute frame rate on this
machine swings ~2x with thermal/clock state — the same unmodified build measures
very differently hours apart. Comparing a "before" from one state against an
"after" from another invents effects that aren't there: a first pass at this
section credited the fix with a large CPU-encode win and explained it via GPU
downclocking, and a controlled back-to-back A/B showed encode had barely moved.

**How it hid for so long is the lesson.** The bench labelled that time
"swapchain acquire wait — present/compositor back-pressure, not engine cost" and
concluded "the frame rate is gated by present back-pressure". Both were
plausible, both were wrong, and the label actively discouraged looking inside
`beginFrame()`. It was caught by *arithmetic*, not by a profiler: the phases
didn't sum to the frame interval — they exceeded it, which is impossible — and
back-pressure can't exist under `immediate` anyway. Then confirmed by timing
`getCurrentTexture` / `getPreferredFormat` / `createView` separately in a
standalone probe, which put essentially all of it in the format query.

Two rules out of it: **keep `beginFrame()` to acquire + view** — anything else
per frame belongs in the constructor — and **don't let a benchmark's labels
assert a cause it hasn't measured**; a confidently-wrong label is worse than a
raw number.

### Reverse-Z with an infinite far plane — and why the near plane is now free

`Camera.projectionMatrix()` is `mat4.perspectiveReverseZ(fov, aspect, near)` with
`zFar` **omitted** (infinite). Near maps to `ndc.z = 1`, infinity to `0`, so
`ndc.z == near / viewDepth` exactly. The forward and AO-prepass pipelines
therefore use `depthCompare: "greater"` and `depthClearValue: 0.0`, and anything
sampling the main depth buffer tests background as `depth <= 0`, not `>= 1`.

This is *the* depth setup for a space sim, and it only works because the depth
buffer is `depth32float`. Standard Z wastes float precision twice over: the float
is densest near 0, and the perspective divide *also* concentrates precision near
the near plane, so the two compound and distant geometry gets almost nothing.
Reverse-Z maps near to 1, putting the float's dense-near-zero region exactly
where `1/z` is coarsest. The two cancel.

Measured (float32 ULPs, `near = 0.01`), the smallest resolvable world-space gap:

| view z | standard Z | reverse Z |
|---|---|---|
| 0.1 m | ~0 nm | 5.96 nm |
| 1 m | 596 nm | 74.5 nm |
| 100 m | 5.96 mm | 11.6 µm |
| 1 km | 596 mm | 72.8 µm |
| 10 km | 59.3 m | 909 µm |

Reverse-Z is worse *only* within ~30 cm of the near plane, where both are
nanometre-scale — i.e. it costs nothing usable. `gap/z` stays ~`2^-24` at every
distance, so this **is** a logarithmic depth buffer, obtained free from the
float's exponent bits rather than by writing `@builtin(frag_depth)` (which would
disable early-Z — the reason log depth was rejected). Two corollaries:

- **The far plane cancels out of `near/z`**, so it's infinite at zero precision cost.
- **`dz ≈ z · 2^-24` is independent of `near`**, so `near = 0.01` costs distant
  precision nothing. Under standard Z the near plane tyrannises everything; here
  it doesn't.

With a `depth24unorm` buffer, reversing would buy almost nothing — uniform
quantization is symmetric under flipping. `depth32float` is the precondition.

**The shadow pass deliberately stays standard-Z** (`"less"`, clear `1.0`). It's
*orthographic*: depth is already linear, so reverse-Z gains it nothing, and the
Moment Shadow Mapping reconstruction is tuned around support on `[0,1]` with a
hand-verified bias constant (Formula 6). It has its own `SHADOW_DEPTH_FORMAT` and
pipeline, so the two conventions coexist cleanly. Don't "fix" it for consistency.

**Clustering was unaffected**, which is the non-obvious part: the cluster grid
never touches NDC depth. `clusterZIndex` consumes *linear view-space* depth
(`-viewZ`, from the view matrix), and `cluster_build.wgsl` slices on `zNear`/
`zFar` in view space; its `invProj` unprojection auto-follows whatever projection
the camera produced. `cluster_build.wgsl`, `light_cull.wgsl`, and `common.wgsl`
needed **zero** changes. (`screenToViewRay` unprojects at `ndc.z = 1.0`, which
used to be the far plane and is now the near plane — still a valid point along the
same ray, and `intersectZPlane` rescales it, so relative precision is preserved.)

The one real cost: the grid needs a *finite* range, so `Camera.clusterFar`
(default 1000 m) replaces the projection's far plane for light culling only.
Widening `[near, clusterFar]` coarsens Z-slice density —
`slices-per-doubling = CLUSTER_COUNT_Z / log2(clusterFar / clusterNear)`.
Pushing `near` very small used to coarsen this badly, because the grid was tied
to the projection's near plane; it no longer is — see `Camera.clusterNear` and
"What the forward pass actually costs" below. If density ever needs more, raise
`clusterNear` or lower `clusterFar` rather than adding slices. Lights beyond `clusterFar` are simply never culled into a cluster
and contribute nothing; geometry beyond it still renders.

Verified after the change: `test/ao.test.ts` (GPU readback, creases darken), the
full `bun run fixture` set (exterior/interior/hdr-clip/gltf/textured, no `wgpu`
errors, correct occlusion + shadows + auto-exposure), the 200-light bench, and
`metis-game`. A CPU port of `cluster_build`'s ray/AABB math confirmed all 24 Z
slices round-trip through `clusterZIndex` and every AABB is finite.

**What reverse-Z did *not* fix: float32 world coordinates.** The depth buffer is
no longer the constraint anywhere in the solar system (25 m resolution at lunar
distance, 15 km at 1 AU, and `ndc.z` is 27 orders of magnitude from denormalizing).
The next wall is that `worldPosition`, `camera.position`, light positions, and the
model matrix are all f32: at the Moon's `3.844e8 m` the f32 grid step is **32 m**,
and `forward.wgsl`'s `V = normalize(camera.position - worldPosition)` catastrophically
cancels when both operands are that large. Viewed *from Earth* that 32 m subtends
`8e-5` px and is invisible; stand on the Moon and it's ~2900 px. The fix is
camera-relative rendering (rebase the world so the camera is the origin, keeping
authoritative positions in f64 on the CPU — JS numbers already are), not anything
in the depth pipeline. `metis-game` sidesteps it by construction: its world origin
sits on the Earth's surface under the camera, so every near-field coordinate is
small and only the two celestial bodies' *translations* are large.

### Cascaded shadow maps (hybrid MSM near + PCF far)

The directional shadow is a 4-cascade CSM. A single ortho map cannot serve a
scene that mixes close and distant geometry: fit it near and distant objects
fall outside it; fit it wide (or, worse, auto-fit to a scene containing the
Moon — `r ≈ 3.9e8 m`, **~377 km per texel**) and near shadows turn to mush. The
prior `shadowRadius` knob only moved that tension around; CSM resolves it by
giving each depth slice its own map.

`shadowDistance` (default 400) is subdivided into 4 cascades by the **practical
split scheme** (`cascadeSplitLambda`, default 0.85, blends logarithmic and
uniform — logarithmic keeps cascade 0 tight for near crispness). Each cascade is
fit to its frustum-slice **bounding sphere** (rotation-invariant, so the ortho
size is constant frame-to-frame → no shimmer when the camera *rotates*) and its
centre is **snapped to whole shadow texels** (→ no shimmer when it *translates*).
`computeCascades` in `shadowCascades.ts` (the CSM collaborator; the renderer just holds the two tunables and passes them in).

**The hybrid representation is the load-bearing decision** (chosen deliberately
over MSM-everywhere and PCF-everywhere — don't "unify" it without re-deriving
why):

- **Cascade 0 = Moment Shadow Mapping** (rgba32float moments + 4x-MSAA resolve,
  the full pre-CSM path). Zero bias → **no peter-panning**, and the Hausdorff
  reconstruction closes the concave-corner leak. This is the cascade that covers
  everything near the camera, where both properties matter most. Verified: the
  interior corner-leak scene is still clean under CSM.
- **Cascades 1–3 = plain depth32float + hardware comparison PCF** (one depth
  array, one layer each; `textureSampleCompareLevel`, `compare: "less-equal"` on
  standard-Z ortho depth). 4 bytes/texel vs MSM's 32, and at their coarse
  (decimetre) texels the sub-millimetre gaps MSM exists to resolve are moot,
  while PCF is inherently bleed-free and its small texel-scaled normal-offset
  bias is invisible at range.

VRAM ≈ **184 MB** at `SHADOW_MAP_SIZE = 2048`: cascade 0 is 67 MB moments + 67 MB
MSAA depth, the PCF array is 3 × 17 MB. (This is the "balanced" tier; a lean
variant drops the PCF cascades to 1024² for ~140 MB.) The old single map was
128 MB, so CSM roughly matches it while covering four depth ranges instead of
one.

Cascade selection is by view-space depth (`-viewZ` vs `splitFar`), with a
cross-fade **blend band** (`CASCADE_BLEND_FRACTION`, 12% of each slice) at the
far edge so the resolution step between cascades is invisible; past the last
cascade's far boundary everything is fully lit. The per-cascade normal-offset
bias is texel-scaled (`SHADOW_NORMAL_OFFSET_TEXELS`/`_MIN`), so it self-sizes as
cascades coarsen — the same fix that replaced the old hardcoded `0.04` (which,
being a world constant, silently collapsed to sub-texel and striped the ground
with acne once the frustum grew past ~r 40).

Verified after the change: renderer builds with no WGSL/validation error;
interior corner-leak scene clean; earth-moon surface at near and pulled-back
cameras shows crisp near shadows and correct attached far shadows (no bleed, no
acne, no visible cascade seams); `test/ao.test.ts` (9/9) and the full fixture
pass with no `wgpu` errors; the 200-light bench regressed slightly on GPU time,
which is the 3 extra depth passes over ~trivial geometry — a real scene pays 4×
its shadow draw count, the standard CSM cost.

Known rough edges, deliberate for now: no per-cascade frustum culling (every
cascade redraws every instance); the blend band double-samples two cascades in
the overlap; and the light frustum's ortho near is pulled generously toward the
sun (`CASCADE_ORTHO_NEAR_SCALE`) to catch off-slice occluders rather than doing
a proper occluder-inclusive fit.

### What the forward pass actually costs — measure, don't guess

Re-measure with `bun run bench:lights --profile`, which prints a per-pass GPU
breakdown; sweep `--lights` to separate fixed cost from per-light cost.

The forward pass is **light-loop bound, not shadow bound**. Sweeping light count
gives an almost perfectly linear fit, and the constant term — which contains
*everything else*, including all 9 MSM reconstructions per cascade-0 fragment,
PCF for the other cascades, materials, ambient and AO — is a small minority of
the pass at a few hundred lights. A cursory read of the shader points at the
Hausdorff 4-moment reconstruction because it's the scariest code in the file;
the measurement says otherwise. **Sweep a parameter before optimizing here.**

Two fixes came out of that, together roughly halving the pass at 200 lights:

**1. Per-fragment range rejection (the big one).** A cluster's light list is
inherently conservative — a light is added if it touches *any* part of the
cluster's AABB, so most fragments in that cluster are outside its range. Render
`lightCountInCluster` and read it back and the ratio is stark: roughly four times
as many lights assigned per fragment as are actually in range. The loop had no
distance check, so most fragment-light pairs ran the full Cook-Torrance BRDF and
multiplied it by an attenuation of exactly zero. `forward.wgsl` now rejects on
squared distance first. This is *provably* free of visual consequence —
`pointLightAttenuation`'s window term is already exactly 0 at `dist >= range` —
and the fixture renders came back **byte-identical**, which is the assertion.

**2. `Camera.clusterNear`, decoupled from `Camera.near`.** Z-slice density is
`CLUSTER_COUNT_Z / log2(clusterFar / clusterNear)`, so tying the grid to the
projection's near plane was ruinous: `near = 0.01` sits three orders of
magnitude below any real geometry, and those wasted slices come straight out of
the range that matters — clusters ended up spanning more depth than a typical
light's whole radius. The grid now has its own near.

**Slice 0 is a catch-all, and that's load-bearing.** `clusterZIndex` clamps
anything nearer than `clusterNear` into slice 0, so `cluster_build.wgsl` widens
slice 0's AABB down to the true camera near. Without that, a fragment closer
than `clusterNear` reads a light list assembled for a shell it isn't in and
*silently loses every light near it* — geometry going dark, popping as the
camera moves. `test/clusterNear.test.ts` pins it.

**That test needed a second attempt, which is the interesting part.** The first
version used a generously-sized light and passed even with the catch-all
deleted: the light's sphere still reached the wrongly-placed slice 0, so nothing
was lost. Only a light whose range is *small relative to `clusterNear`* actually
exercises the failure. Mutation-check tests in this area — "it passes" proves
nothing when the oracle is another render of the same scene.

Levers measured and **rejected** (kept so they aren't re-litigated):

| lever | verdict |
|---|---|
| finer cluster XY grid | weak; costs memory and cull time for a few percent |
| lowering `clusterFar` | weak, and *loses* distant lights entirely |
| raising `clusterFar` | **worse** — it's the ratio that sets density |

The near end is the lever because that's where the slack is: the projection's
near plane sits orders of magnitude below where geometry actually starts, while
`clusterFar` is usually within a small factor of the real far extent. Density
goes as the log of the ratio, so you can only reclaim range that's genuinely
empty.

**Separately: cascade-0 MSM is a large, flat, scene-independent cost.**
`cascade0-moment-resolve` plus `cascade0-depth` run at the same cost with zero
lights and zero geometry, and are a substantial share of the GPU frame — the
larger share the faster everything else gets. It's bandwidth-bound, not
math-bound: the moment target is `SHADOW_MAP_SIZE²` × rgba32float, so cost
scales with the square of that constant and halving it is a clean 4x. Not done —
it trades near-field shadow quality, which is exactly what MSM cascade 0 exists
to provide. It's the obvious next dial if the flat cost matters.

### Why "clustered forward," concretely

`ClusteredForwardRenderer.render()` does, every frame: (1) write the camera/environment uniforms, (2) fit an orthographic shadow frustum to the scene's bounding sphere and render a depth-only pass from the sun's viewpoint (`shadow.wgsl`), (3) run two compute passes — `cluster_build.wgsl` divides the view frustum into a fixed 16×9×24 grid with exponential depth slicing, `light_cull.wgsl` sphere-tests every point light against every cluster's AABB and writes a per-cluster light-index list — then (4) the actual forward pass, where `forward.wgsl`'s fragment shader looks up its own cluster and only shades the lights assigned to it, plus the sun (shadow-tested) and a flat ambient term. See `math/Clustered forward formulas.md` for the exact formulas, including the two real bugs hit building this (a room mesh's shadow frustum computed from instance *position* instead of mesh *extent*, and shadow-pass backface culling dropping a room's inward-facing geometry when viewed from outside by the light) and how they were diagnosed.

### Exterior vs. interior is data, not code

There's no `if (interior)` branch anywhere in the shading code. `Environment.ambientIntensity` (near 0 for `createExteriorEnvironment()`, a small nonzero value for `createInteriorEnvironment()`) is the only lighting-model difference between the two; the visual difference between the exterior and interior demos comes from geometry (a room shell with an actual hole cut into one wall — `assets/primitives.ts`'s `roomBox()`) and the directional shadow map actually occluding the sun everywhere except through that hole. See `math/PBR shading formulas.md`'s "ambient / exterior vs. interior" section.

### Ambient occlusion is a swappable enum, and only touches the ambient term

`ClusteredForwardRenderer` owns an `AmbientOcclusion` (`src/renderer/ao/`); set `renderer.ao.technique` to `AoTechnique.None`, `.SSAO`, or `.HBAO` (a runtime quality dial — the interior demo cycles it with the `O` key). When active it runs three passes *before* the forward pass — a geometry prepass (view-space normals + depth), the chosen occlusion technique (`ssao.wgsl`/`hbao.wgsl`, fullscreen), and a box blur — and `forward.wgsl` multiplies the result into **only** the flat ambient term. That last part is the load-bearing correctness point: AO approximates occlusion of *indirect/bounce* light, so it must never darken the sun or point lights (their occlusion is the shadow map's job). Multiplying the whole lit image by AO — which some engines do — double-darkens shadowed creases and is wrong. `None` is branchless: the renderer clears the AO buffer to white so the forward multiply is a no-op, mirroring the always-bound-placeholder pattern the material textures already use. Both techniques' math (and the deliberate normal-oriented HBAO tangent simplification) is in `math/Ambient occlusion formulas.md`; `test/ao.test.ts` validates the kernel generators on the CPU and, via GPU readback + a `pushErrorScope`, that each technique darkens a box's contact creases without any swallowed WGSL validation error. The prepass is a *second* geometry pass (a production engine would share a depth prepass); at this engine's scale the duplicate draw is cheap and keeps AO decoupled from the forward path.

### The headless target is sRGB, and it was silently wrong for a long time

`RenderContext`'s offscreen capture texture is **`rgba8unorm-srgb`**. This is a
colour-correctness requirement, not a preference, and the reason is one line at
the end of `tonemap.wgsl`:

```wgsl
return vec4<f32>(acesFilmic(exposed), 1.0);   // linear — no sRGB encode
```

The tonemap pass emits **linear** values and does no sRGB encoding of its own. It
relies entirely on the target format's `-srgb` suffix for the hardware
encode-on-write. The output format is therefore the last stage of the colour
pipeline, not a free choice.

The windowed path always got this right by accident — `surface.getPreferredFormat()`
returns `bgra8unorm-srgb` on every backend this runs on. The **headless** path did
not: it was pinned to `rgba8unorm` (no `-srgb`) purely because the old screenshot
helper could only read that format back. So every fixture capture stored linear
values as though they were sRGB — **markedly darker than the same scene in a
window**. Measured on the exterior fixture: mean red channel **94.8 vs 147.9**,
with the two images differing by *exactly* the sRGB transfer curve to within
8-bit rounding (max delta 1.7/255). Screenshot validation was validating an image
the engine never actually displays.

**Why it survived so long is the interesting part.** Nothing failed. There was no
validation error, no exception, no visibly broken render — the fixtures looked
like a plausible dark scene, and the only way to notice was to compare them
against a windowed frame of the same scene, which nothing did. The bug lived in
the gap between two code paths that were never diffed against each other. Two
things follow: **a "screenshot test" whose output does not match the real output
path is worth much less than it appears**, and a format pinned for a *tooling*
reason should carry a comment saying so, because the reason outlives the
constraint (here the readback limitation was lifted and the pin just stayed).

**Corollary, and it bites:** any pipeline targeting the offscreen texture must
take `ctx.outputFormat` rather than hardcoding a format. `test/fixture.ts`'s
`NaiveClampPass` hardcoded `rgba8unorm` and, when the target became sRGB, emitted
**92 validation errors while still exiting 0 and writing a plausible PNG** — the
exact failure mode "Debugging WebGPU validation errors" above warns about. It now
takes the format as a constructor argument.

`vectorText.smoke.ts` is unaffected and correctly so: it builds its own
`rgba8unorm` target and its own `VectorText` against that same format, so it is
internally consistent and never touches `captureTexture`.


### Why MSAA — and a misdiagnosis worth knowing about

The forward pipeline renders 4x multisampled (`RenderTargets.hdrColorMultisampled`/`depth` in `src/renderer/rhi/targets.ts`; the color target auto-resolves via `resolveTarget` into a single-sampled texture everything downstream reads — depth doesn't resolve, since WebGPU has no depth `resolveTarget`, so `LuminanceAveragePass` reads it directly as `texture_depth_multisampled_2d` at sample index 0, which is enough to know whether *something* was drawn there). This exists because the interior demo showed a "dashed line" artifact along the room's floor/wall and wall/wall seams that **was originally (wrongly) diagnosed as shadow-map acne** — several rounds of shadow bias/normal-offset/PCF tuning had zero visible effect on it, which in hindsight was the tell. It was ordinary geometric-edge aliasing (no MSAA existed at all before this): two adjacent, differently-lit flat-shaded quads meeting at a hard edge, rendered with exactly one sample per pixel, alias into what looks exactly like a dashed shadow-map artifact when the edge is nearly axis-aligned in screen space. Enabling MSAA fixed it outright; the shadow-side tuning (Formula 6 in `math/Clustered forward formulas.md`) turned out to be solving a real but much smaller problem that was never the visible complaint. Lesson: when a targeted fix produces *zero* visible change, that's a stronger signal to question the diagnosis than to push the fix further.

### A second, genuinely separate shadow leak — fixed via Moment Shadow Mapping, not the BRDF

After MSAA shipped, a *different* artifact turned up on close zoom of the interior console: a thin bright line at the concave corner where the right wall meets the window-wall frame. It reproduces identically with MSAA on or off, so it's unrelated to the issue above. It was first misdiagnosed a second time — a raw N·L check at the leak point came back positive, which was wrongly taken as "the wall genuinely faces the sun, not a shadow bug" (with BRDF wrap-lighting proposed as a fix). That's wrong: N·L only says the surface *orientation* faces the sun, not whether the room's own solid geometry blocks the actual path there — occlusion is exactly what the shadow map decides, not the BRDF. Confirmed as a real shadow bug two independent ways: JS-side ray-tracing against the exact camera/light matrices (every "leaking" point has zero line-of-sight to the sun through the window), and a raw readback of the shadow map's own stored depth (the true occluder's depth was only ~0.0008-0.002 units closer to the light than the receiver). Root cause: two real occluding surfaces meet at a corner viewed at a steep angle *to the light* (not the same thing as N·L to the sun), producing near-coincident light-space depths at the shared edge — the textbook receiver-plane-depth problem for single-sample shadow mapping, where a plain depth-compare-plus-bias test can only ever keep one number per texel and so can't tell "real neighboring occluder" from "acne."

A first pass (increasing the normal-offset sample displacement from 0.05 to 0.1 world units) shrank the leak roughly 3x but never closed it — same underlying limitation, different angle of attack. The actual fix replaces the shadow map's representation entirely: `shadow.wgsl` now writes the first four power moments of the light-space depth ($E[z]..E[z^4]$) per texel into an `rgba32float` target instead of a single nearest depth, and `forward.wgsl`'s `computeMsmOcclusion()` reconstructs occlusion via a closed-form Cholesky factorization of the moments' Hankel matrix (Moment Shadow Mapping, Peters & Klein 2015) — no epsilon bias needed at all, since the ambiguity that a single depth value can't resolve is encoded in the higher moments instead of thrown away. The remaining `normalOffset` (a texel-count quantity, derived per frame per cascade from that cascade's texel size rather than hardcoded — see "Cascaded shadow maps" above) is just ordinary acne insurance on curved surfaces, no longer load-bearing for the corner case (and only cascade 0 even uses MSM).

**The first MSM implementation shipped a real regression, caught by GPU-readback verification, not by more screenshots.** It used an invented moment-bias target ($(0.5,\frac13,0.5,0.2)$, the true moments of a uniform distribution) instead of the paper's actual reference value ($(0.5,0.5,0.5,0.5)$) — plausible-looking, but wrong, and it made the corner leak visibly *worse*. Told to "do the raw texel tests" instead of guessing further, a debug script read back real GPU-rendered shadow-map moments at the exact corner (`copyTextureToTexture` + manual buffer mapping) and fed them through a JS port of the reconstruction, which reproduced the bug exactly and pinned it to the wrong bias target — confirmed against the paper's own supplementary PDF, fetched directly rather than trusted from memory a second time. A follow-up attempt at real hardware bilinear filtering (`rgba16float`, matching the paper's recommendation) was *also* verified-and-rejected: `rgba16float`'s own rounding error at this scene's depth range is comparable to the smallest gaps that matter, so it traded one precision problem for another. The verified-correct combination is `rgba32float` (no filtering) + the paper's exact bias constant. Full history, including a stray bug in the debug script's own byte-reinterpretation (`new Float32Array(uint8Array)` converts *values*, not bits), is in Formula 6 of `math/Clustered forward formulas.md`.

**Even after that fix, the visible bleed persisted — and the final cause was the choice of moment-problem variant, not a constant.** The paper's default *Hamburger* reconstruction (support on all of ℝ) has a light-bleeding tail: reconstructed visibility falls off only as ~variance/gap², and an interior sun bright enough to blow out through a window makes even 0.1% visibility glow, so every concave seam bled for meters. Switching to the paper's *Hausdorff* variant (Algorithm 4: support constrained to [0,1], with a four-support-point fallback branch) eliminates the tail outright — for a single-occluder texel the bound reduces algebraically to an exact 0/1 step regardless of gap size. Verified by fp32 emulation against real readback data, then live GPU readback (visibility 1cm from the corner: 0.973 → 0.003; sunlit surfaces unchanged at 1.0), then zoomed renders at the exact viewpoints that showed the bleed. The shadow ortho near/far was also tightened to the scene's actual light-space span ([0.98r, 3.02r] instead of [0.1, 4r]), doubling depth precision. Details and the hand-derivation: Formula 6 in `math/Clustered forward formulas.md`.

### Winding convention — and the inside-out sphere

The forward pipeline culls back faces with the default CCW front-face convention, and `assets/primitives.ts`'s `addQuad` builds CCW-from-the-normal-side quads to match. `uvSphere`, however, shipped with clockwise-from-outside triangles — so the rasterizer culled the sphere's *outside* and rendered its interior, with outward vertex normals attached to the far hemisphere. Result: every light lit the side of the sphere *opposite* itself, patches slid around with camera motion ("the specular highlights follow me"), and specular was killed entirely (N·V < 0 on the visible surface) — while all quad-based geometry shaded correctly, which made the report easy to misattribute to the BRDF or light culling. Root-caused by A/B rendering with cluster culling bypassed (pixel-identical → culling exonerated) and a light placed behind the sphere (it lit the camera-facing side → geometry, not shading), then confirmed by hand-winding the equator triangle. If a new mesh source ever shows "lights on the wrong side + no specular," check winding against `cullMode` before touching the shading code.

### Textures: always-bound placeholders, no shader branching

Every material's bind group has exactly 6 texture-related bindings (1 sampler + 5 textures) whether or not it was given real textures — unset slots bind a shared 1x1 neutral placeholder (`assets/texture.ts`'s `getMaterialDefaults`) chosen so sampling it is a no-op against the material's own factors (white for anything multiplied, a flat tangent-space normal that reproduces the vertex normal unchanged). This keeps the bind group layout — and therefore the pipeline — identical for every material, avoiding per-material pipeline variants or a `hasTexture` uniform flag with shader branching. `test/fixture.ts`'s `textured` scene downloads a real CC0 texture set (Poly Haven's `metal_plate_02`, via its public file API) to validate all four map types at once; its small "emissive panel" object uses a synthetically-generated (not downloaded) checkerboard pattern purely to exercise the emissive-texture path, since no suitable small standalone CC0 emissive asset was sourced.

### Debugging WebGPU validation errors — read this before assuming something "worked"

**`bun-webgpu-rs` does not throw or reject on WebGPU validation errors.** They print to stderr as `[wgpu] uncaptured error: ...` and execution continues with whatever partial/garbage state resulted (an invalid command encoder, an unwritten buffer, a texture that silently kept its cleared value). A script can run to completion, write a file, and print a success message while having done nothing correct. **Always grep test/demo output for `wgpu` or run without piping through `tail`/`head`** — several real bugs during this engine's development (a shader with unreachable code after a `return`, a debug texture read missing `COPY_SRC`) were completely invisible until stderr was checked directly instead of trusting a clean exit code.

### WGSL module concatenation

`bun-webgpu-rs`'s `createShaderModule` takes one `code: string`; WGSL has no `#include`. Every shader that needs the shared structs/BRDF/cluster-math in `common.wgsl` gets it via plain string concatenation (`` `${commonWgsl}\n${forwardWgsl}` ``) at pipeline creation — in `clusteredForwardRenderer.ts` (forward), `lightCuller.ts` (cluster_build/light_cull), and `shadowCascades.ts` (shadow; shadow_resolve is standalone, no common). `.wgsl` files are imported as raw text via Bun's `with { type: "text" }` import attribute (ambient-declared in `src/renderer/shading/wgsl.d.ts`).

### Profiling is opt-in, threaded through, and tiered

`GpuProfiler` (`src/renderer/debug/gpuProfiler.ts`) times each pass with
timestamp queries and hands back a tree that `DebugOverlay.tree` renders. It is
**off unless two separate things happen**: something constructs it (which only
succeeds on a device that enabled `timestamp-query`), and something assigns it to
`renderer.profiler`. Every hook is a `profiler?.pass(...)` call, so the unprofiled
path encodes exactly as before.

**Why the profiler is threaded through the collaborators rather than wrapping
`render()`.** Per-pass timing needs `timestampWrites` *on each pass descriptor*,
and the renderer doesn't create most of its passes — `ShadowCascades`,
`LightCuller`, `AmbientOcclusion` and the post chain do. So each takes an optional
trailing `profiler?: GpuProfiler` (the post chain gets it via the
`PostProcessFrameContext` it already threads everywhere). The alternative —
bracketing groups of passes with `encoder.writeTimestamp` purely at the renderer
level — needs no signature changes but can only measure *groups*, not passes.
Per-pass was the requirement, so the signatures moved.

**Three tiers, checked against the device, not the adapter.** With `timestamp-query`
alone you get per-pass timing and a summed total. `timestamp-query-inside-encoders`
buys a *measured* whole-frame span, which is strictly better than summing passes
because it includes the gaps between them (barriers, layout transitions — a
consistent few percent that a sum silently loses).
`timestamp-query-inside-passes` adds per-draw zones nested under
`forward`. The last two are **native wgpu features with no WebGPU spec
equivalent**, so support is genuinely patchy — always degrade, never require. The
check is against `device.features` deliberately: an adapter can advertise a
feature the caller never requested, and using it then is a validation error, which
this binding only prints to stderr (see "Debugging WebGPU validation errors").

**Readback is ring-buffered and results lag ~2-3 frames.** That's the design, not
a shortcut: mapping a buffer the GPU is still writing stalls the pipeline and
distorts the very numbers being measured. `beginFrame` kicks the maps recorded on
*previous* frames — by then their `submit` has certainly happened, whereas kicking
them in `endFrame` would race it and could resolve the map before the copy filled
the buffer.

Validated by `test/debugWidgets.smoke.ts`, which asserts on the numbers rather
than eyeballing a screenshot: non-zero per-pass timings, a plausible total, the
expected pass labels present, and per-draw zones when the tier allows. A
mis-wired query index reads back as zeros and would otherwise look fine.

### Debug widgets — and why `due()` exists

`DebugOverlay` (`src/renderer/debug/widgets.ts`) is immediate-mode: stage widgets,
then `render()`. Colour reaches the GPU through `VectorText`'s palette — geometry
is tagged with `VectorContext.setId(slot)` and the fragment shader reads a
dynamically-offset `vec4`. `VectorContext` owns geometry only and has no notion of
paint, so `setId` is the intended hook; the palette is interned per build, so
widgets just name a colour.

**Text is the entire cost, and it's why `DebugOverlay.due()` is not optional
dressing.** `drawText` re-tessellates every glyph outline on every call. The
profiler overlay is a few dozen strings, so re-staging it every frame cost
several times the entire GPU frame in CPU encode alone. `due()` throttles
re-staging to `rebuildIntervalMs` (default 100 ms) and `VectorText.renderCached()`
replays the previous geometry in between: `flush()` uploads to persistent buffers
and leaves `drawCalls` populated, so replaying is valid until the next `flush()`.
The GPU numbers were unaffected either way — the overlay's cost is CPU-side, so
it never corrupted what the profiler measures.

Two bugs in `bun-webgpu-rs`'s `VectorContext` were found and fixed building this
(both documented in that package's CLAUDE.md): stroking an *open* polyline
panicked the process via lyon, and `drawText` built a full glyph outline on every
call that the `fill()` path then discarded. The remaining text cost is the glyph
cache tessellating in font units at a fixed tolerance — ~118 triangles per glyph
at 11 px, roughly 10x more than needed. Fixing that means keying the cache by
(glyph, size bucket); not done, and the reason `due()` carries the load instead.

### Known limitations (not yet done)

- No image-based lighting / environment reflections — a pure metal with no texture is lit only by direct lights, nothing else (see `math/PBR shading formulas.md`'s "Where the real handwave lives").
- Point lights don't cast shadows, only the directional sun does.
- The concave-corner shadow leak (see "A second, genuinely separate shadow leak" above) is fully closed, in the end by *geometry*: `roomBox` builds solid-slab walls (0.2 units thick), so a corner's occluder record is the wall's sunlit exterior face — depth gaps ~100x the moment reconstruction's threshold, GPU-verified at 0.0000-0.0001 visibility down to 2mm from the corner, no hairline at all in zoomed renders. Zero-thickness occluder geometry is the one case the shadow system genuinely cannot fully resolve (occluder and receiver depths coincide at a shared edge) — prefer closed/thick meshes for anything that must cast interior shadows. This also paid for `SHADOW_MAP_SIZE` 4096 → 2048 (~536 MB → ~134 MB of shadow attachments). This MSM path now runs only on **cascade 0** (see "Cascaded shadow maps"); cascades 1–3 are plain depth+PCF. Do not lower `momentBias` below 1e-5 — fp32 goes non-monotonic and the exact-self-query case NaNs. `normalOffset` is a texel-count quantity, computed per frame per cascade from that cascade's texel size (`SHADOW_NORMAL_OFFSET_TEXELS`/`_MIN`, uploaded in `CascadeUniforms.normalOffsets`), so it self-rescales with `SHADOW_MAP_SIZE`, `shadowDistance`, and the split scheme; see Formula 6 and "Cascaded shadow maps" above.
- The glTF loader (`assets/gltf.ts`) doesn't read a `TANGENT` accessor (fabricates an arbitrary perpendicular vector instead) and ignores any texture a glTF material references (factors only) — fine for the plain untextured "Box" sample it's validated against, wrong for a real normal-mapped/textured glTF asset. It also only handles a narrow subset generally: separate `.gltf` + `.bin` (no `.glb`, no embedded base64), `f32` POSITION/NORMAL/optional-TEXCOORD_0, `u16`/`u32` indices. Anything with skinning, morph targets, sparse accessors, or multiple buffers will throw.
