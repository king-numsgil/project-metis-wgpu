# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`metis-engine` is a WebGPU clustered-forward PBR renderer for the space-sim game — built directly on `metis-native`'s raw WebGPU/SDL3 bindings. It has exactly **one** other dependency: `metis-data`, which supplies both the GPU struct layouts (every uniform/storage buffer the renderer uploads is a descriptor — see "GPU layouts are descriptors now") *and* all the vector/matrix math (see "The math is metis-data's"). `wgpu-matrix` is gone. It's a standalone package with no dependency on `metis-tui`. `metis-game` consumes it (a 100-point-light demo), and does so via the caller-owned-device path — it never touches `RenderContext`. See "The engine does not own the window" below.

**`src/` is split into two independent subtrees.** `src/renderer/` is the entire renderer described in this doc (including `renderer/debug/` — the opt-in GPU profiler and the debug widgets); `src/ecs/` is a young archetype ECS (Structure-of-Arrays storage, no `metis-data` dependency) that will eventually feed the renderer. They do not depend on each other yet — the renderer still takes a hand-built `Scene`, not ECS data. The root `src/index.ts` re-exports them as namespaces (`export * as Renderer`, `export * as ECS`), but consumers import through the package's **subpath exports** — `metis-engine/renderer` and `metis-engine/ecs` — which is what `examples/`, `test/`, `bench/`, and `metis-game` now do (`import { ClusteredForwardRenderer, … } from "metis-engine/renderer"`). The ECS's current shape and limits are in "The ECS" below.

It's the first package in this monorepo to build a *real* render pipeline — depth buffer, vertex buffers, multiple bind groups, compute passes, multisample-capable targets. Every prior pipeline in `metis-native/tests/render*.test.ts` and `metis-game/src/index.ts` is a hardcoded no-vertex-buffer triangle, so the patterns here (vertex layouts, bind group group-index conventions, WGSL module concatenation) are this repo's first precedent, not a continuation of one.

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
# via metis-native's native readTexturePixels/saveTextureToFile.
# The goldens are byte-exact: a clean `git status` after this means the render
# path reproduced exactly. A diff means something moved — check its shape, then
# regenerate deliberately. See "The fixture goldens are a genuine byte-exact
# baseline" below.
bun run fixture && git status --short test/output

# Interactive windowed demos (WASD+QE fly, arrows look, Esc quit)
bun run demo:exterior
bun run demo:interior
bun run demo:spots      # spot-shadow visual test (L toggles shadows, Space pauses orbit)
bun run demo:helmet     # glTF import + 100-light clustered forward, orbiting cam
                        # (downloads DamagedHelmet.glb once into examples/.asset-cache/)

# Standalone VectorContext (text rendering) smoke test
bun run test/vectorText.smoke.ts

# Windowed renderer benchmark. Two independent load axes — `--lights N` scales
# shading, `--helmets N` scales geometry/draw submission — plus `--profile` for a
# per-pass GPU breakdown. See "What the forward pass actually costs" below;
# sweep ONE axis at a time and state which geometry a light figure was taken at.
bun run bench:lights --profile
bun run bench:lights --helmets 400            # geometry-bound regime
bun run bench:lights --helmets 400 --orbit 0.1   # ...with a MOVING camera
bun run bench:lights --helmets 400 --no-shadow-cache

# The three above are one measurement, not three: the cascade cache is total for
# a static camera and worthless for a moving one, so a number from any single one
# of them is not a claim about the renderer. See "Cascade shadow maps are cached".

# ECS stress benchmark (pure CPU — no GPU, no window). See "What the ECS
# actually costs" below before reading its output.
bun run bench:ecs
bun run bench:ecs --quick --only A,C

# Type-check this package (or `cd ../.. && bunx tsc --noEmit` for the whole monorepo)
bunx tsc --noEmit
```

Two automated checks, both run manually rather than wired into a runner.
`test/fixture.ts` (`bun run fixture`) renders the screenshot goldens and fails
hard if `VectorContext` draws nothing. Alongside it there **is** a `bun test`
suite — `ao`, `clusterNear`, `spotLight`, `spotShadow` and `shadowCache` — every
one of which exists because the thing it covers can render plausibly while being
wrong, and every one of which has been watched failing for the right reason
before being trusted. `bun test test/` runs them; they need a GPU.

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
  math/         types.ts      — Vec2f/Vec3f/Vec4f/Mat3f/Mat4f/Quatf (metis-data buffer types) and
                                 their constructors; the whole renderer's positional vocabulary
                camera.ts, transform.ts — thin wrappers over metis-data's math (Camera is look-at
                                 based; Transform is position/Euler-rotation/scale -> mat4)
                frustum.ts    — Gribb-Hartmann plane extraction + sphere test, for the spot-shadow cull
  scene/        mesh.ts       — GPU vertex/index buffers + the one shared vertex layout
                                 (pos/normal/tangent/uv, stride 48) every mesh in the engine uses
                material.ts   — metallic-roughness factors, each optionally multiplied by a texture
                                 (albedo/normal/metallic/roughness/emissive) — see math/PBR shading
                                 formulas.md's "Textures" section
                light.ts, environment.ts, scene.ts — plain data + the Scene/SceneInstance containers
  shading/      wgsl/*.wgsl   — common.wgsl (shared structs + BRDF, concatenated into every other
                                 shader module — WGSL has no #include), forward.wgsl, cluster_build.wgsl,
                                 light_cull.wgsl, shadow.wgsl (depth-only, one pass per cascade)
                clusteredForwardRenderer.ts — the public renderer: owns the forward pipeline +
                                 camera/env uniforms, and orchestrates render() (write uniforms ->
                                 shadows -> cluster build+cull -> AO -> forward pass), wiring its
                                 collaborators' resources into the forward frame bind group
                lightCuller.ts — collaborator: the cluster-build + light-cull compute passes and
                                 their buffers; exposes the group-3 bind group/layout the forward
                                 pass reads (cluster_build.wgsl + light_cull.wgsl)
                shadowCascades.ts — collaborator: the whole 4-cascade CSM (cascade fit + one
                                 depth-only pass per cascade into a depth-array layer); exposes the
                                 depth-array/compare-sampler/uniform the forward frame bind group
                                 binds (shadow.wgsl)
                gpuLayouts.ts — every uniform/storage struct as a metis-data descriptor; the
                                 TypeScript half of common.wgsl. Replaced the hand-rolled
                                 Std140Writer (see "GPU layouts are descriptors now" below)
                shadowConfig.ts — CASCADE_COUNT/SHADOW_MAP_SIZE/MAX_SHADOW_SPOTS/SPOT_SHADOW_MAP_SIZE
                                 in a leaf module, so gpuLayouts can size arrays without an
                                 import cycle back through the classes that use them
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
  text/         vectorText.ts — wraps metis-native's VectorContext for screen-space HUD text
                                 + 2D vector debug graphics; paint colour is a palette indexed
                                 by VectorContext.setId(), and renderCached() replays geometry
                                 without re-tessellating (text is expensive — see "Debug widgets")
  debug/        gpuProfiler.ts — opt-in per-pass GPU timing via timestamp queries; ring-buffered
                                 readback, three feature tiers (see "Profiling" below)
                widgets.ts    — DebugOverlay: graph + tree widgets drawn with VectorText, plus
                                 History and profileSpansToRows
  assets/       primitives.ts — procedural cube/sphere/plane/room-box generation (the guaranteed,
                                 network-independent path every demo/fixture scene defaults to)
                gltf.ts       — a thin adapter over metis-native's glTF importer: the node walk
                                 and the GltfMaterial -> Material mapping, nothing else. The
                                 hand-rolled reader that used to live here is gone (see "The glTF
                                 loader moved into Rust" below)
                texture.ts    — loadTexture() (image file -> GpuTexture via metis-native's
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
examples/       exterior-demo.ts, interior-demo.ts, spots-demo.ts, helmet-demo.ts — windowed,
                interactive, SDL-loop-driven; demoAssets.ts caches the downloaded ones
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
set of component names* share an `Archetype`, identified by a **32-bit signature
mask** (see "The 32-component ceiling" below). Within one, each component field is
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

### The 32-component ceiling — the known limit, and where to look when it bites

An archetype's component set is a **signed int32 bitmask** (`SignatureMask` in
`ecs/archetype.ts`), one bit per component in the `World`'s registry, assigned
once in the constructor because the registry is fixed there. Matching is
`(archetypeMask & wantedMask) === wantedMask`; set equality is a number
comparison. This replaced a sorted-and-joined string key that was re-derived on
every `spawnEntity` call — bitwise OR is inherently order-independent, so the
sort that key existed to fake comes free.

**`MAX_COMPONENT_TYPES` is 32, and `new World(...)` throws past it.** This is a
real ceiling, not a tunable constant, and it is written down here because *we do
not yet know whether a real game fits under it*. There is no game, so there is no
evidence either way; 32 was accepted because it is the simple, fast case and
because the failure mode is a loud throw at construction rather than anything
subtle. A mature ECS with a full sim (flecs-scale) routinely carries 100+
component types, so **assume this will need widening eventually.**

**When it blows up, this is the change.** The throw names the constant and points
here. Widening means multi-word masks:

- `SignatureMask` becomes a small `Uint32Array` (or a `[lo, hi]` pair for 64),
  and `makeSignatureMask` plus the two `(a & q) === q` tests in `World` loop over
  words.
- `World.archetypes` can no longer be a `Map` keyed by a bare number. Options, in
  the order worth trying: a hashed numeric key with a short collision list; or a
  plain linear scan over the (few) archetypes comparing word-wise, which is
  likely fine since archetype counts are small and the comparison is a couple of
  ANDs. **Do not reach for `BigInt` keys** — they're heap-allocated and this is
  the spawn hot path, which is the whole reason the string key was removed.
- Keep the one-word fast path. Most worlds will stay under 32, and the two-word
  case shouldn't tax the common one.

**Masks are signed int32 and must stay that way.** `|` and `&` both yield signed
int32, so bit 31 makes a mask negative. That is fine as long as *nothing*
normalises with `>>> 0`: an unsigned wanted-mask compared against a signed
`a & b` result is never equal, and the failure is silent — queries just quietly
stop matching the 32nd component. `src/ecs/test/ecs.test.ts` pins this with a
registry whose last component sits on bit 31, and it is **mutation-checked**:
adding `>>> 0` to `makeSignatureMask` fails both sign-bit tests. Per this
package's history with `clusterNear.test.ts`, that check is the point — a passing
test here proves nothing until it has been seen failing for the right reason.

One free behavioural change worth knowing: `spawnEntity("A", "A")` now resolves
to the same archetype as `spawnEntity("A")`, because OR is idempotent. The string
key made those two *different* archetypes, which was a latent bug nobody had hit.

### What the ECS actually costs — iteration is free, structure is not

Re-measure with **`bun run bench:ecs`** (`bench/ecs.ts`; pure CPU, no GPU or
window). It is sectioned — `--only A,C` to narrow, `--quick` for a fast pass,
`--trials N` for a tighter median. Per this file's no-numbers rule the findings
below are stated structurally; the bench prints the numbers.

**The SoA design claim holds, and section A is the proof.** `World.query` runs at
the speed of the equivalent hand-written typed-array loop — the bench measures
that ceiling in the same process, on the same data, rather than against a
remembered figure. There is nothing left to win in the iteration path, so don't
go looking there.

**`getComponent` is ~two orders of magnitude slower per field access, and that is
by construction.** Every read resolves through a property getter → `Map.get(entityId)`
→ array index, per axis, so it survives column growth and despawn swaps. That
robustness is exactly what makes it unfit for a per-frame loop. **The trap is
`queryEntities` + `getComponent`**: it reads like a query, and it is the accessor
path at full price. If a system walks entities, it uses `query`.

**Structural change still costs far more than touching an entity's data, and
most of it isn't the data.** Section C decomposes one `spawnEntity` in-bench (the
`isolate:` rows), so the attribution doesn't rest on a profiler that was run once
and thrown away. As it stands:

- Two `Map.set`s (`World.entityArchetype`, `Archetype.rowOfEntity`) are now the
  **largest** slice by a wide margin.
- `addEntity`'s row zeroing (a nested-Map walk per spawn) is second.
- `makeSignatureMask` — the mask OR — is nearly free, roughly a twentieth of what
  the string key it replaced cost.
- The component data itself — the actual float stores — is noise.

**What already landed: the signature bitmask.** `makeSignatureKey` used to
re-derive `[...names].sort().join(",")` on **every** `spawnEntity` call, and it
was the single largest slice of a spawn — larger than everything the archetype
itself did, for a value that is a pure function of the component-name set.
Replacing it with an int32 mask (see "The 32-component ceiling") roughly halved
spawn across every component count and cut churn measurably. The `isolate:` rows
keep the old string key as a standing A/B so the win doesn't have to be taken on
faith.

**What's left, and deliberately not done.** The two `Map`s want to be a sparse
set, which also fixes the memory finding below and wants entity-id recycling and
generation tags alongside it. That's a change to what an `EntityId` *means*, not
a micro-optimization — see the note at the end of this section. Nothing consumes
the ECS yet, so the pure-performance half can wait; optimizing against a guessed
workload is what the renderer's own history warns about.

**Despawn order matters ~3x.** Swap-with-last makes back-to-front removal a pop
and front-to-back removal a full column copy every time. Bulk despawns should
walk backwards.

**Query dispatch is per-archetype, not per-entity, and is paid whether the
archetype matches or not.** So the pathological case is a *fragmented* world —
many archetypes holding few entities each — not a large one.

`bun run bench:ecs-dispatch` (`bench/ecsDispatch.ts`) decomposes it against
*candidate* implementations that don't exist yet, so a design choice here starts
from measurement. Roughly, per archetype visited: the bare iteration floor is
small, `archetypeHasAll`'s linear `includes` scan is about a quarter, and
**building the per-call `picked` object is the largest single item — over half**.
Two consequences:

- **The bitmask signature (landed) was a real but partial fix for `query`.** It
  removed the matching quarter and nothing else; the `picked` half is untouched
  by faster matching. The bench confirms it end-to-end: `World.query` as shipped
  now measures the same per-archetype cost as the bench's inline-mask variant,
  where it used to match the `includes` variant. Its much bigger payoff was on
  the *spawn* path — that was the reason to do it, not this.
- **The `picked` half needs a cached query plan** (matching archetypes + their
  prebuilt column objects, invalidated by an archetype-creation counter). Still
  **not done**. It does *not* require a new public API: the mask now gives a
  cheap numeric key the plan can be looked up by inside the existing
  `query(names, fn)`, which was always the real synergy between the two changes.

**Two traps the bench exists to document, both of which produced wrong answers
first:**

- **A mask kept in a side `Map<Archetype, …>` measured ~8x SLOWER than the string
  `includes` it replaced** — object-keyed hash plus a heap indirection per
  archetype, per query. The mask has to be a plain number field *on* the
  archetype record or it is worse than useless.
- **"Just pass `archetype.columns` instead of building `picked`" is not the free
  win it looks like.** The archetype's cached view has a *different shape per
  archetype* (its own component set), so the callback's `cols.Position` access
  goes megamorphic and gives back over half of what skipping the allocation
  saved. A cached `picked` wins because every archetype's copy has the *same*
  shape. Shape consistency is the load-bearing property, not the allocation
  count. (An earlier note here said reading through `cols` costs nothing; that
  was measured against the shipped code, where the shape *is* consistent, and it
  does not generalise to handing the callback the wider view.)

**Memory: the bookkeeping dwarfs the columns.** Per entity, the `Map`s and the
dense id array cost several times what the component columns do — the SoA storage
is genuinely compact and the handle machinery around it is not. Same fix list as
the spawn cost, same reason for not doing it yet.

**Churn does not leak, and getting that answer right needed the right
measurement.** A single force-GC / churn / force-GC delta reports a large
retained step and reads as a leak. It isn't: the `Map`s take **one** step up when
deletions start leaving tombstones and then plateau, and a rehash *transiently*
allocates a second table, so a one-shot delta can land on the step, the
transient, or both. Section E therefore measures across repeated rounds and looks
for a plateau. If that number ever moves, re-measure it the same way before
calling it a regression — and note the transient peak is real, so churn-heavy
frames carry a GC spike even though nothing leaks.

**The methodology mistake worth not repeating.** The first pass at the
archetype-scaling probe ran a fixed 200 repetitions per trial, which came to a
fraction of a millisecond — below the point where the JIT settles — and produced
per-archetype costs several times too high *plus* a large fixed per-query cost
that does not exist. The bench calibrates every trial to a minimum wall time for
exactly this reason. **A microbenchmark whose trial is under a few tens of
milliseconds is measuring the tier-up, not the code**, and it will look precise
while doing it.

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

The default present mode is **`mailbox`** (the `metis-native` binding default;
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
not microseconds (see `metis-native/DOC.md` §2) — so every windowed frame
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
*orthographic*: depth is already linear, so reverse-Z gains it nothing, while the
comparison sampler's `compare: "less-equal"` and the `depthClearValue: 1.0`
("nothing occludes here") convention both read off it directly. It has its own
`SHADOW_DEPTH_FORMAT` and pipeline, so the two conventions coexist cleanly. Don't
"fix" it for consistency.

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

### Cascaded shadow maps (uniform PCF)

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

**Every cascade uses the same representation**: plain `depth32float` + hardware
comparison PCF (one depth array, one layer each; `textureSampleCompareLevel`,
`compare: "less-equal"` on standard-Z ortho depth, 3x3 taps each of which is a
2x2 bilinear compare → effectively 4x4). 4 bytes/texel, and PCF is inherently
bleed-free with a small texel-scaled normal-offset bias.

VRAM ≈ **67 MB** at `SHADOW_MAP_SIZE = 2048` (4 × 17 MB), down from 128 MB for
the old *single* pre-CSM map — four depth ranges for half the memory.

Cascade 0 previously used Moment Shadow Mapping (a `rgba32float` moment target
plus a fullscreen moment-resolve pass) to close a concave-corner light leak.
That leak's real cause was zero-thickness wall geometry; once `roomBox` built
solid slabs, nothing needed MSM, and its resolve pass was a large flat cost — so
cascade 0 was collapsed onto the same PCF path as the rest. Removed cleanly: no
quality regression, slightly smoother edges (hardware PCF filters; the
unfilterable moments could not). **Don't reintroduce it without re-deriving why**
— if a scene ever needs zero-bias near shadows or sub-texel occluder
discrimination, the implementation and its full design review are in git history.

**Watch for peter-panning on cascade 0.** MSM ran with zero depth bias; PCF
cascade 0 now leans on the same texel-scaled normal offset as the rest, and
`SHADOW_NORMAL_OFFSET_MIN` is the *binding* constraint there (the floor only
stops applying once a cascade's bounding radius exceeds roughly
`SHADOW_MAP_SIZE · MIN / (2 · TEXELS)`, which cascade 0's never does at the
default `shadowDistance`). So cascade 0 is over-offset relative to its own texel
size. Nothing visible in the demos or fixtures today, but if contact shadows ever
look detached up close, that floor is the first dial — not the choice of PCF.

Cascade selection is by view-space depth (`-viewZ` vs `splitFar`), with a
cross-fade **blend band** (`CASCADE_BLEND_FRACTION`, 12% of each slice) at the
far edge so the resolution step between cascades is invisible; past the last
cascade's far boundary everything is fully lit. The per-cascade normal-offset
bias is texel-scaled (`SHADOW_NORMAL_OFFSET_TEXELS`/`_MIN`), so it self-sizes as
cascades coarsen — the same fix that replaced the old hardcoded `0.04` (which,
being a world constant, silently collapsed to sub-texel and striped the ground
with acne once the frustum grew past ~r 40).

Verified when CSM landed: renderer builds with no WGSL/validation error;
interior corner-leak scene clean; earth-moon surface at near and pulled-back
cameras shows crisp near shadows and correct attached far shadows (no bleed, no
acne, no visible cascade seams); `test/ao.test.ts` (9/9) and the full fixture
pass with no `wgpu` errors. Note that a scene pays 4× its shadow *draw* count
under CSM — the standard cost, and the reason the per-cascade passes are now the
thing to watch rather than any per-texel reconstruction.

Known rough edges, deliberate for now: no per-cascade frustum culling (when a
cascade does render, it redraws every instance — and because the cache's
invalidation is frame-global, this is also why one moved object re-renders all
four; see "Cascade shadow maps are cached"); the blend band double-samples two
cascades in the overlap; and the light frustum's ortho near is pulled generously toward the
sun (`CASCADE_ORTHO_NEAR_SCALE`) to catch off-slice occluders rather than doing
a proper occluder-inclusive fit.

### What the forward pass actually costs — measure, don't guess

Re-measure with `bun run bench:lights --profile`, which prints a per-pass GPU
breakdown; sweep `--lights` to separate fixed cost from per-light cost, and
`--lights 0` for the true zero-light floor (the reference every light-cost claim
should be stated against).

**Sweep one axis at a time, and know that they multiply.** The bench used to be
a single 2-triangle plane, so every per-light number it produced was measured
against almost no shaded geometry — which is the flattering case, because
per-light cost is per *shaded fragment*, and a plane fills a fraction of the
screen at low overdraw with one material fetch. `--helmets N` (default 100)
scatters that many shared-mesh DamagedHelmets over the plane. On an Intel UHD 620
at 1280x720, mean GPU frame time:

| lights | helmets | GPU frame | delta |
|---|---|---|---|
| 0 | 0 | 11.2 ms | — the floor |
| 100 | 0 | 16.9 ms | +5.7 ms for 100 lights |
| 0 | 100 | 62.5 ms | +51.3 ms for 100 helmets |
| 100 | 100 | 80.2 ms | **+17.7 ms** for the same 100 lights |
| 200 | 100 | 101.6 ms | +21.4 ms for the next 100 |

**The same 100 lights cost 5.7 ms on the bare plane and 17.7 ms with the helmet
field — 3x.** Neither number is wrong; the bare-plane one was answering a
narrower question than it appeared to. Any per-light figure quoted from this
bench has to name the geometry it was measured against, and the pre-2026-07-29
figures in this file were all taken at `--helmets 0`. Light cost stays close to
linear *within* a fixed scene (100 -> 200 lights adds 21.4 ms against the first
hundred's 17.7), which is what the cluster grid is supposed to deliver — the
scaling claim survives, only the constant moves.

Two more things that only became visible with real geometry in the scene:

- **CPU encode became a first-class cost**, roughly linear in instance count.
  It sat under the GPU time on the iGPU so it was not the bottleneck *there* —
  and the prediction that "on a fast discrete GPU it would be the first thing to
  hit" was then confirmed on the GTX 1070, where encode and GPU time measured
  **equal** per instance. Because the bench serialises (it awaits
  `onSubmittedWorkDone` before present), that made encode worth half the frame
  rate. See "Draw-call batching" and "The model uniform is computed once per
  frame" below for what it was made of and what has been done about it.
- **The shadow passes scale worse than the forward pass** — see the no
  per-cascade-frustum-culling rough edge above, which this now puts a number on.
  On the discrete GPU the four cascades measured *larger than the forward pass*
  at `--helmets 400`, which is what motivated caching them.

**Read the section title literally, and re-derive the bottleneck per machine.**
The iGPU table above and the desktop's conclusions are both correct and they
point at different things, because the two machines sit on opposite sides of the
CPU/GPU balance. Two findings that only appear on the discrete GPU, both worth
re-checking rather than assuming:

- **The frame is vertex/draw-submission bound, not fill bound, once geometry is
  in it.** At `--helmets 400`, dropping from 1280x720 to 320x240 — twelve times
  fewer pixels — moved GPU frame time by roughly a tenth. Stripping the lights
  and the spot shadows *as well* barely moved it further. Optimising shading
  against that scene is optimising the wrong thing; `--width`/`--height` is the
  cheap way to find out which regime you are in.
- **The depth prepass is a net loss on a geometry-heavy, overdraw-light scene**,
  on both GPU time and encode — exactly as `depthPrepass`'s own doc comment
  predicts, which makes the bench's default scene an argument against the
  engine's default setting. Not changed, because the default should be decided on
  a scene that represents the game rather than on this one; but re-run
  `--no-prepass` before treating "on" as settled.

`--spots <0..1>` sets what fraction of the field is spot lights (default 0.5).
Two things to know before comparing runs across it. **Spots are slightly
*cheaper* than point lights here**, not more expensive — the per-fragment cone
rejection means a spot shades less of the plane than a point light of the same
range — so `--spots 0.5` is a *weaker* light-loop stress test than the all-point
field, and shouldn't be quoted as the headline number. And `--spots 0`
reproduces the pre-spot field **exactly**: the cone parameters are drawn from
their own PRNG stream, so the main stream (positions, orbits, intensities) is
untouched at any fraction. That property is deliberate and load-bearing for A/B
— appending the cone draws to the main stream instead would shift every
subsequent light and silently turn the baseline into a different scene.

The forward pass is **light-loop bound, not shadow bound**. Sweeping light count
gives an almost perfectly linear fit, and the constant term — which contains
*everything else*, including all the shadow PCF taps, materials, ambient and AO
— is a small minority of the pass at a few hundred lights. **Sweep a parameter
before optimizing here**: the per-fragment shadow math has twice looked like the
obvious hot spot on a read-through and twice measured as noise.

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

**The flat shadow cost is now four depth-only passes over the scene geometry**,
which is draw-bound rather than bandwidth-bound — so the dial that matters is
per-cascade frustum culling (not implemented; every cascade redraws every
instance), not `SHADOW_MAP_SIZE`. This section previously proposed halving
`SHADOW_MAP_SIZE` to cut cascade 0's fullscreen `rgba32float` moment-resolve
pass; deleting that pass outright turned out to be strictly better and cost no
quality.

### The math is metis-data's, and the win was the copy, not the speed

The renderer's vectors and matrices used to be `wgpu-matrix`'s bare
`Float32Array`s (`Vec3Arg`/`Mat4Arg`). They are now `metis-data` memory buffers
(`Vec3f`/`Mat4f`/… in `math/types.ts`), and `wgpu-matrix` is no longer a
dependency of this package or of `metis-game`.

**Do not justify this on speed, and do not accept a speed claim about it that
isn't an alternating A/B.** Two controlled A/Bs (one before the migration, one
after — four alternating 300-light runs in one sitting) put the two libraries at
parity: GPU frame time moved by well under the run-to-run drift, and the *same*
build measured 273 / 215 / 273 fps in three consecutive runs, which is the
machine, not the code. The reason to do this was **consolidation onto one math
library**, plus the structural win below.

**The structural win is that a matrix can now be computed directly into the
bytes that get uploaded.** A `metis-data` buffer is a view over an
`ArrayBuffer`, so it can be `wrap`ped over a GPU staging allocation — which is
what `gpuLayouts.ts`'s `stage().mat4(member)` / `.mat3(member)` /
`stageArray().elementVec3(i, member)` and the standalone `wrapMat4` return. The
camera's `viewProj`, the AO pass's four matrices, the cluster `invProj`, every
cascade and spot `viewProj`, and every instance's model + normal matrix are all
built *in place* now. Each of those was previously a compute-then-`.set()` copy.
When adding a pass, reach for `mat4`/`mat3` over `f32` whenever the member is a
matrix that a math op produces.

**The two constraints that make this workable**, both of which had to be built
first:

- **Out-first constructors.** `Mat4.lookAt`/`perspective`/`orthographic`/… are
  scalar-first (`(F32, …) → new buffer`) and allocate *by signature*, and the
  renderer calls roughly twenty of them per frame. metis-data grew
  `setLookAt`/`setPerspective`/`setPerspectiveReverseZ`/`setOrthographic`
  alongside the existing `composeTRS`, each out-first with the allocating twin
  delegating to it. `transformToMat4`/`normalMatrixFromModel` became out-first
  here for the same reason, with no allocating variant at all.
- **`mat3` packing is invisible to the type system.** `Mat3f` is
  `MatMemoryBuffer<F32Descriptor, 3>` and carries no packing, but a Dense mat3
  packs its columns at 12 bytes where std140 pads them to 16. A Dense mat3 in a
  uniform slot type-checks perfectly and writes the normal matrix 4 bytes off
  from where the shader reads it. Hence `mat3f()` allocates std140 and there is
  deliberately no Dense alternative. `mat4` has no such hazard — the two packings
  are byte-identical — which is exactly why this trap is easy to walk into.

**The migration had to land atomically**, and that is worth remembering if
anything like it comes up again: it changed the calling convention (`vec3.add(a,
b)` returns, `Vec3.add(out, a, b)` writes) *and* the public types at once, so
`Transform`, `Camera`, `Light`, `Environment` and `SceneInstance` all changed
signature together and there was no green intermediate state. Converting
`transform.ts` alone produced 40 type errors. 26 files, one pass.

**Verified by the goldens, which is the strong claim here.** Seven of fourteen
fixtures came back **byte-identical**; five differ by a max of **1** on between 2
and 942 pixels; `textured` peaks at Δ2 with exactly one pixel above Δ1. Nothing
structured, nothing localised. That is the signature of the same math in a
different float implementation — and the identical half says the conversion
isn't merely close. `test/ao.test.ts`, `clusterNear`, `spotLight` and
`spotShadow` passed 20/20, and `metis-game` plus all three demos run clean.

### GPU layouts are descriptors now, not a hand-rolled writer

Every uniform and storage struct the renderer uploads is a `metis-data`
descriptor in `shading/gpuLayouts.ts`. That replaced `Std140Writer`, 99 lines of
hand-rolled alignment, and — the actual motivation — **seven hand-computed size
constants** scattered across five files (`CLUSTER_PARAMS_SIZE = 128`,
`CASCADE_FORWARD_SIZE = 304`, `FORWARD_UNIFORM_SIZE = 288`, `AO_UNIFORMS_SIZE =
288`, `LIGHT_STRIDE = 64`, and inline `size: 144` / `size: 48`), each with a
comment asking the reader to trust arithmetic they couldn't check. Sizes are
derived now, so adding a field cannot silently leave a buffer short.

**The allocation story is the other half.** `Std140Writer` allocated per call —
a growable `number[]`, a *parallel* `string[]` of `"f32"|"u32"` type tags, an
`ArrayBuffer`, a `DataView`, a `Uint8Array` — and then wrote word-at-a-time
through `setFloat32`. It ran `~17 + 2 × instanceCount` times per frame, and the
light array alone pushed 6144 entries onto two JS arrays and made 6144 `DataView`
calls at `MAX_LIGHTS`. Staging buffers are allocated once at construction and
rewritten in place now; since the math moved onto metis-data, a matrix upload
isn't even a copy — see "The math is metis-data's" above.

**Descriptors are the layout authority; how you *write* through them depends on
what produces the value.** Every offset comes from `offsetOf`, so metis-data's
packing rules and their tests govern the layout regardless. Then:

- If a **math op produces it**, take a `Mat4f`/`Mat3f`/`Vec3f` from
  `stage().mat4/.mat3` or `stageArray().elementVec3` and pass that as the op's
  `out`. The result lands in the upload bytes with no copy.
- Otherwise (loose scalars, a `u32` count, a packed `[x,y,z,scalar]` slot), take
  a raw typed-array view from `stage().f32/.u32` and store into it yourself.

What you must *not* do on a per-frame path is reach for `MemoryBuffer.get()` /
`set()` / `at()`: those allocate a tuple or a sub-buffer per call. `getComponent`
/ `setComponent` / `view()` are the allocation-free accessors.

**What descriptors do NOT check:** agreement with the WGSL. metis-data validates
std140/std430 packing, not that your field order matches `common.wgsl`. That is
still a by-inspection invariant — which is exactly why the descriptors live in
one file mirroring one shader file, instead of beside the classes that use them.

**The migration was verified byte-exact**, which is the useful part: all eight
fixture goldens reproduced with zero diff, and `test/ao.test.ts`,
`clusterNear.test.ts`, `spotLight.test.ts` and `spotShadow.test.ts` passed 20/20.
A pure repacking *should* be bit-identical, so the clean `git status` is a real
assertion that the new offsets match the old ones — not merely that the image
still looks right.

One layout resisted: the per-cascade and per-spot shadow render matrices live at
a **256-byte dynamic-offset stride** with a 64-byte `mat4` in each slice, and
metis-data has no `@size`/`@align` override to declare a stride wider than the
element. Those stay a raw buffer with a view per slice (`SHADOW_RENDER_STRIDE`).
If that limitation is ever lifted they become an ordinary `ArrayOf`.

### Why "clustered forward," concretely

`ClusteredForwardRenderer.render()` does, every frame: (1) write the camera/environment uniforms, (2) fit one orthographic frustum per cascade to its slice of the camera frustum and render a depth-only pass from the sun's viewpoint per cascade (`shadow.wgsl`), (3) run two compute passes — `cluster_build.wgsl` divides the view frustum into a fixed 16×9×24 grid with exponential depth slicing, `light_cull.wgsl` sphere-tests every local light against every cluster's AABB and writes a per-cluster light-index list — then (4) the actual forward pass, where `forward.wgsl`'s fragment shader looks up its own cluster and only shades the lights assigned to it, plus the sun (shadow-tested) and a flat ambient term. See `math/Clustered forward formulas.md` for the exact formulas, including the two real bugs hit building this (a room mesh's shadow frustum computed from instance *position* instead of mesh *extent*, and shadow-pass backface culling dropping a room's inward-facing geometry when viewed from outside by the light) and how they were diagnosed.

### Exterior vs. interior is data, not code

There's no `if (interior)` branch anywhere in the shading code. `Environment.ambientIntensity` (near 0 for `createExteriorEnvironment()`, a small nonzero value for `createInteriorEnvironment()`) is the only lighting-model difference between the two; the visual difference between the exterior and interior demos comes from geometry (a room shell with an actual hole cut into one wall — `assets/primitives.ts`'s `roomBox()`) and the directional shadow map actually occluding the sun everywhere except through that hole. See `math/PBR shading formulas.md`'s "ambient / exterior vs. interior" section.

### Spot lights: one buffer, one cull pass, a cone applied per fragment

Local lights are a **discriminated union** (`Light = PointLight | SpotLight`,
tagged on `kind`) in a single `scene.lights` array. Both kinds share one GPU
buffer, one cluster-cull pass, and one forward loop; only the per-fragment
attenuation differs. `scene.pointLights` was renamed to `scene.lights` when this
landed — a deliberate breaking change, since the old name became a lie.

**Spot-ness is encoded, not branched.** `GpuLight` carries no `isSpot` flag.
Instead a point light is written as a cone that cannot reject anything —
`cosOuter = -2`, `spotScale = 1` — so `spotAttenuation`'s `clamp` saturates to
exactly `1.0` for every possible direction, with no branch and no warp
divergence. The proof that this is a true no-op is that every fixture golden came
back **byte-identical** when spot lights were added: the point-light path is not
merely close, it is bit-for-bit unchanged. That is the assertion worth keeping.

**Spots are culled as spheres, and that was measured, not assumed.** The cluster
pass treats a spot exactly like a point light — its full `range` sphere — so a
narrow cone is over-included into clusters it doesn't light. The cone is then
applied per fragment, where it doubles as an early-out costing a single dot
product, exactly mirroring the squared-distance range rejection that already
lives there. Cone-vs-cluster culling was costed and **deliberately deferred**:

- The practical form is cone vs. the cluster AABB's *bounding sphere* (exact
  cone/AABB has no clean closed form). That's roughly 2-3x the cull loop's ALU
  plus a `sqrt` — still small, since the cull pass is nowhere near the frame's
  bottleneck.
- But the AABB→sphere bound is loose, and Z slicing is exponential, so far
  clusters are elongated boxes whose bounding spheres eat much of the tightness
  the cone was supposed to buy.
- And the per-fragment cone rejection already recovers most of the win: an
  over-included spot costs a dot product per fragment, not a Cook-Torrance
  evaluation.

So the remaining benefit is narrow and entirely scene-dependent (how many spots,
how narrow, how much they overlap). It is a pure optimization touching only
`light_cull.wgsl` with **zero API impact**, so it can be added and A/B'd whenever
a real spot-heavy scene exists to measure against. Building it before that scene
exists would be optimizing against a guessed workload. The one real cost of
sphere culling meanwhile: spots count against `MAX_LIGHTS_PER_CLUSTER` in
clusters they don't actually light.

**Angles are half-angles in radians, and that is worth a test.** `innerAngle`/
`outerAngle` measure from the cone's *axis* to its edge. This is the kind of
mistake that renders perfectly plausibly while being wrong — a correctly-shaped
cone of the wrong size — and comparing two cones can't detect it, because the
*ratio* between two cones is nearly identical under a half-vs-full-angle
confusion (`tan15/tan25 = 0.575` vs `tan7.5/tan12.5 = 0.594`). Only an absolute
measurement discriminates, so `test/spotLight.test.ts` renders a hard-edged cone
at a wall, finds the lit boundary, and converts it back to an angle.
**Mutation-checked in both directions**: feeding it a full-angle interpretation
makes it read 10.1 deg for a 20 deg cone, and breaking the point-light `cosOuter`
sentinel makes the control test go black. Per this package's own history with
`clusterNear.test.ts`, a passing render-based test proves nothing until you have
seen it fail for the right reason.

### Spot light shadows — a fixed budget, and the culling that pays for it

Up to `MAX_SHADOW_SPOTS` (4) spot lights may be flagged `castsShadow`. Each gets
one perspective depth pass into its own layer of a `depth_2d_array`, sampled in
the forward pass with the same comparison sampler and 3x3 PCF the sun cascades
use. Point lights **cannot** cast: that needs a cube map, which is 6x the passes
*and* 6x the draws, and point lights here exist for detail and fake emissive
glow rather than for lighting a space.

**`MAX_SHADOW_SPOTS` is a compile-time constant, not a runtime dial.** It sizes
the depth array and the `array<mat4x4, 4>` in `SpotShadowUniforms`, and WGSL
array lengths must be constant. Changing it is a one-line edit plus a rebuild;
the *active* count is a uniform, so scenes below the cap cost nothing extra.
Four is a budget to spend deliberately, not a target to fill.

**A light's buffer index is its shadow-map layer.** `LightCuller.write` packs the
shadow-casting spots first, so `lightIndex < activeCount` simultaneously answers
"does this light cast?" and "which layer?". That is what let `GpuLight` stay at
64 bytes — it is exactly full, with no padding to steal for a shadow index. The
cost is an ordering invariant, and the failure mode if it breaks is nasty:
fragments shadowed by the *wrong* light's map, which renders plausibly. It is
kept safe by deriving the caster list **once** per frame in
`ClusteredForwardRenderer.render` (`selectShadowCastingSpots`) and handing the
same array to both the culler and `SpotShadows`. Do not re-derive it in either
place.

**Frustum culling shipped with this, deliberately, and it is the load-bearing
part.** It was for a long time the *only* culling in the engine; the camera
passes and the cascades have it now too (see "Frustum culling everywhere else"
below), but spot shadows remain where it most obviously pays, because of an
asymmetry worth internalising:

- A **cascade's** ortho frustum is fit to a slice of the camera frustum, so
  essentially everything the camera can see is inside it. Culling wins little.
- A **spot's** frustum is a genuinely tight bounded volume — a cone capped by
  `range`. In a corridor, most of a ship falls outside it. Culling wins a lot.

`math/frustum.ts` extracts the six planes (Gribb-Hartmann) and tests each
instance's world bounding sphere. **The planes use WebGPU's `[0,1]` depth
convention, not OpenGL's `[-1,1]`** — the near plane is `row2` alone, not
`row3 + row2`. The GL form compiles and looks reasonable and puts the near plane
in the wrong place, which culls geometry that is genuinely visible; that shows up
as objects near the light losing their shadow, not as anything obviously wrong.
`test/spotShadow.test.ts` pins near/far/side cases on the CPU for that reason.

World spheres come from each instance's **model matrix**, not its `Transform`,
because `modelMatrixOverride` (the glTF path) bypasses `Transform` entirely, and
reading position off the transform would silently mis-place those instances.
They're computed once per frame and reused across all four light frusta.

**Measuring it: `bun run bench:lights --profile --shadow-spots 0..4`.** Each
casting light gets its own `spot-shadow-N` span. Two caveats before trusting
those numbers:

- **At `--helmets 0` the bench scene is one big plane**, which is the *worst*
  case for culling: a single instance that always intersects every cone. Those
  numbers measure pass and rasterization overhead only and say nothing about how
  much culling saves. That caveat is why the bench grew a geometry axis — at the
  default `--helmets 100` the cull has a few hundred small bounding spheres to
  reject per cone, so the drawn/candidate ratio is finally worth reading. Judge
  culling there, never at `--helmets 0`.
- **Unused layers still run a clear pass.** That's why `--shadow-spots 0` still
  shows four spans. A stale layer would otherwise be sampled by whichever light
  inherited that index later.

**The visual test is `bun run demo:spots`**: a metallic sphere on a deck under
the sun plus four differently-coloured orbiting casters (exactly
`MAX_SHADOW_SPOTS`). Four *coloured* lights is the deliberate choice — with
overlapping white lights a shadow is just "darker" and a half-broken one looks
fine, but with coloured lights each shadow is the region where one specific
colour is missing, so the deck shows four distinctly hued spokes and any light
whose map is wrong, stale, or indexed to the wrong layer shows up as the wrong
colour in the wrong place. `L` toggles all four casters for a direct A/B; the HUD
reports the frustum cull's drawn/candidate ratio live.

**Zone selection belongs to scene code, not the renderer.** The intent is that a
game layer flips `castsShadow` as the player moves between spaces — the galley's
fixtures, then the cargo bay's. The renderer takes "here are the flagged spots"
and knows nothing about rooms, portals, or zones. Keep that boundary; it is what
lets a real zone system arrive later without touching the render path.

Known rough edges, deliberate for now: **spot** shadow maps are re-rendered every
frame even when neither the light nor the geometry moved. The sun cascades no
longer are (see "Cascade shadow maps are cached"), and the same trick would
apply here — a spot's frustum depends on the *light*, not the camera, so a
static fixture in a static room would cache far better than a cascade does. It
is only undone because the demos and the bench animate every spot, so there was
nothing to measure it against;
resolution is fixed per light rather than scaled by importance or distance (an
atlas rather than an array would be the enabling change); and there is no
filtering beyond 3x3 PCF.

### Ambient occlusion is a swappable enum, and only touches the ambient term

`ClusteredForwardRenderer` owns an `AmbientOcclusion` (`src/renderer/ao/`); set `renderer.ao.technique` to `AoTechnique.None`, `.SSAO`, or `.HBAO` (a runtime quality dial — the interior demo cycles it with the `O` key). When active it runs three passes *before* the forward pass — a geometry prepass (view-space normals + depth), the chosen occlusion technique (`ssao.wgsl`/`hbao.wgsl`, fullscreen), and a box blur — and `forward.wgsl` multiplies the result into **only** the flat ambient term. That last part is the load-bearing correctness point: AO approximates occlusion of *indirect/bounce* light, so it must never darken the sun or point lights (their occlusion is the shadow map's job). Multiplying the whole lit image by AO — which some engines do — double-darkens shadowed creases and is wrong. `None` is branchless: the renderer clears the AO buffer to white so the forward multiply is a no-op, mirroring the always-bound-placeholder pattern the material textures already use. Both techniques' math (and the deliberate normal-oriented HBAO tangent simplification) is in `math/Ambient occlusion formulas.md`; `test/ao.test.ts` validates the kernel generators on the CPU and, via GPU readback + a `pushErrorScope`, that each technique darkens a box's contact creases without any swallowed WGSL validation error. The prepass is a *second* geometry pass (a production engine would share a depth prepass); at this engine's scale the duplicate draw is cheap and keeps AO decoupled from the forward path.

### The fixture goldens are a genuine byte-exact baseline — and the exact bounds of that

`test/output/*.png` reproduce **byte-for-byte** between this repo's Linux (WSL)
and Windows runs. Verified 2026-07-20: a full Windows suite run against
Linux-generated goldens produced no diff at all.

This was **not** true before the image decoder was replaced, and the reason is
the whole point. SDL3_image's 16-bit PNG handling was platform-dependent (the
"works on Windows, garbage on Linux" byte-order bug — see `metis-native`'s
`CLAUDE.md`), so the two platforms were feeding *different texture bytes* into an
otherwise identical render. The renders differed because the **inputs** differed.
The pure-Rust `image` crate decodes bit-identically everywhere, which removed
that variable and collapsed the two platforms onto each other.

Worth stating plainly: cross-platform reproducibility was never a design goal of
that migration. It fell out of deleting platform-dependent C from the pipeline.

**Correction to the record — do not repeat this mistake.** During the migration,
the first Linux fixture run produced goldens a few hundred bytes different from
the committed Windows ones (`exterior.png` 97453 → 97643). That was diagnosed as
"GPU nondeterminism" and the goldens were reverted **twice** on that basis. The
diagnosis was wrong: the cause was the decoder, not the GPU. It is recorded here
because the wrong belief is the actively dangerous artifact — "goldens drift
between platforms, just revert them" licenses dismissing every image diff as
noise, which is exactly how a real regression walks in unnoticed.

**What this licenses — and the posture to hold.** A golden diff is *signal*, not
an alarm. `bun run fixture` followed by a clean `git status` means the render
path reproduced exactly; a diff means something changed, and the useful move is
to find out what.

**This is an engine under active development, so goldens will drift, and that is
normal.** Touch the BRDF, the light loop, the depth setup, the packing of a
uniform — the pixels move. That is the system working. The goldens are a
*change detector*, not a contract to be defended: their job is to make sure no
change is invisible, not to make every change forbidden. Regenerating them is a
routine part of landing a rendering change.

What's actually being asked of you is small: **look before you regenerate, and
say what you saw.** Decode both PNGs, check the delta distribution, and be able
to state in one line whether the diff is the change you meant to make. "Rebased
goldens: added the depth prepass, coplanar tie-break flipped, max Δ 3 on two
surface seams" is a good commit line. Blind `git checkout` of a diff you never
looked at is the only thing to avoid, because that's how a real regression rides
in on the back of an intended one.

**What this does NOT license — the bound.** The guarantee is uneven, and the two
halves have very different strength:

- **Decode determinism is guaranteed by construction.** The `image` crate is pure
  Rust with no platform-conditional path. This holds on *any* hardware, and is
  the half that actually changed.
- **Render determinism is merely observed, on one GPU.** Both sides of the
  comparison bottom out on the same driver: WSL here runs **Mesa Dozen (`dzn`)**,
  a Vulkan-on-D3D12 translation layer, so `enumerateAdapters()` reports
  `Microsoft Direct3D12 (NVIDIA GeForce GTX 1070)` with `backendType: "Vulkan"`.
  That is the same NVIDIA D3D12 driver and shader compiler Windows uses — same
  hardware, same codegen, same float results. It is evidence that the *decode*
  is now deterministic; it is **not** evidence that shading is bit-identical
  across vendors.

So on genuinely different hardware (AMD, Intel, Apple, or a CI runner), goldens
may legitimately differ: FMA contraction, transcendental precision, and
fast-math latitude are all implementation-defined in shader compilation. Read
such a diff by its *shape* — a few LSBs scattered across the whole image is
numeric drift; a structured or localised difference is a real change.

The one case that genuinely isn't worth doing: silently regenerating a
**cross-vendor** diff on a different machine than the baseline came from. Not
because regenerating is wrong, but because the committed bytes then describe
whichever GPU last ran the suite, and the file stops meaning anything on the
other one. If the baseline should move to different hardware, that's a fine
decision — just make it deliberately and note it, rather than letting it happen
as a side effect of running the fixture somewhere new.

This is also what makes `DOC.md`'s phrase "a byte-exact screenshot baseline"
literally true rather than aspirational — it could not have been, while the
decoder varied by platform.

#### The wgpu 24 → 30 upgrade rebased all eight goldens (2026-07-23)

This is the first golden diff since the baseline was established, and it is kept
here as a **worked example of what "look at its shape" means in practice** —
what the measurement looks like, and what conclusion it supports.

The upgrade moved naga forward six major versions with it, so shader codegen
changed — different FMA contraction and instruction selection produce different
last-bit float results. Same hardware, same driver, different compiler. The
diff was measured before the goldens were accepted, not after:

| fixture | max Δ | mean Δ | px with Δ>1 | px with Δ>8 |
|---|---|---|---|---|
| exterior | 21 | 0.040 | **1** of 360000 | 0 |
| textured | 7 | 0.045 | 9 of 360000 | 0 |
| interior | 1 | 0.169 | 0 | 0 |
| the other five | 1 | ≤0.064 | 0 | 0 |

That is the numeric-drift shape the section above describes, at its extreme: six
of eight fixtures differ by **at most one LSB anywhere**, and the two that don't
have single-digit outlier *pixel counts* — one pixel, in `exterior`'s case, on a
specular edge where a hair's-worth of float difference crosses a rounding
boundary. Nothing is structured or localised; no region moved, no shading term
changed magnitude.

**The method is the point, not the table.** When goldens drift, redo the
measurement rather than reasoning from these numbers: decode both PNGs, take the
per-pixel max channel delta, and report the *distribution* — max, mean, and the
counts above Δ=1 and Δ=8. It costs a minute and turns "the goldens changed" into
a sentence you can put in the commit.

Reading it: a large mean or a contiguous region means the image genuinely
changed — which is the *expected* answer when you meant to change the renderer,
and the interesting one when you didn't. Scattered single-LSB noise means
compiler or driver drift. Either way you regenerate; the difference is what you
write down.


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

The forward pipeline renders 4x multisampled (`RenderTargets.hdrColorMultisampled`/`depth` in `src/renderer/rhi/targets.ts`; the color target auto-resolves via `resolveTarget` into a single-sampled texture everything downstream reads — depth doesn't resolve, since WebGPU has no depth `resolveTarget`, so `LuminanceAveragePass` reads it directly as `texture_depth_multisampled_2d` at sample index 0, which is enough to know whether *something* was drawn there). This exists because the interior demo showed a "dashed line" artifact along the room's floor/wall and wall/wall seams that **was originally (wrongly) diagnosed as shadow-map acne** — several rounds of shadow bias/normal-offset/PCF tuning had zero visible effect on it, which in hindsight was the tell. It was ordinary geometric-edge aliasing (no MSAA existed at all before this): two adjacent, differently-lit flat-shaded quads meeting at a hard edge, rendered with exactly one sample per pixel, alias into what looks exactly like a dashed shadow-map artifact when the edge is nearly axis-aligned in screen space. Enabling MSAA fixed it outright; the shadow-side tuning turned out to be solving a real but much smaller problem that was never the visible complaint. Lesson: when a targeted fix produces *zero* visible change, that's a stronger signal to question the diagnosis than to push the fix further.

### Winding convention — and the inside-out sphere

The forward pipeline culls back faces with the default CCW front-face convention, and `assets/primitives.ts`'s `addQuad` builds CCW-from-the-normal-side quads to match. `uvSphere`, however, shipped with clockwise-from-outside triangles — so the rasterizer culled the sphere's *outside* and rendered its interior, with outward vertex normals attached to the far hemisphere. Result: every light lit the side of the sphere *opposite* itself, patches slid around with camera motion ("the specular highlights follow me"), and specular was killed entirely (N·V < 0 on the visible surface) — while all quad-based geometry shaded correctly, which made the report easy to misattribute to the BRDF or light culling. Root-caused by A/B rendering with cluster culling bypassed (pixel-identical → culling exonerated) and a light placed behind the sphere (it lit the camera-facing side → geometry, not shading), then confirmed by hand-winding the equator triangle. If a new mesh source ever shows "lights on the wrong side + no specular," check winding against `cullMode` before touching the shading code.

### The glTF loader moved into Rust, and what stayed behind

`assets/gltf.ts` used to *be* the importer: ~150 hand-rolled lines that parsed a
`.gltf`'s JSON, walked its accessors, and supported a deliberately narrow subset
(one external `.bin`, `f32` POSITION/NORMAL/optional-TEXCOORD_0, `u16`/`u32`
indices, no textures, no tangents, a throw for everything else). That reader is
gone. Parsing, accessor decoding, image decoding and GPU upload now happen in
`metis-native/src/gltf/`, off the JS thread, with the actual spec behind it.

**What is left here is the part that is genuinely this engine's**: the node walk
that flattens a hierarchy into `SceneInstance`s, and the `GltfMaterial` →
`Material` mapping. A glTF feature gets added in the native importer, not here.

Three things about the seam are worth knowing:

- **The engine asks for `GltfVertexLayoutMode.Standard`, and that is not a
  convenience.** There is one `MESH_VERTEX_LAYOUT` and one forward pipeline built
  against it, so a per-primitive layout would mean a pipeline variant per mesh.
  Standard mode pins position/normal/tangent/uv at locations 0-3 with stride 48 —
  *exactly* `MESH_VERTEX_LAYOUT` — so `Mesh` adopts the importer's buffers rather
  than round-tripping them through the CPU. It also synthesises absent normals
  and UV-derived tangents, which is what retired the old loader's "fabricates an
  arbitrary perpendicular tangent" limitation.
- **`Mesh` grew an `indexFormat` field because of this.** It used to hardcode
  `"uint32"` in `bind()`, which was true for everything `assets/primitives.ts`
  builds and is false for most glTF meshes. Binding the wrong width reads pairs
  of `u16` indices as one `u32` and draws confetti — no validation error, no
  throw.
- **`boundingRadius` comes from the file, not from the vertices.** Once the
  geometry is on the GPU there is nothing to scan, so it is derived from the glTF
  POSITION accessor's declared `min`/`max` — the furthest AABB corner from the
  local origin, **not** half the diagonal, because `Mesh.boundingRadius` is
  measured from the mesh's own origin and a primitive need not be centred on it.

**`forward.wgsl` now reads metallic from `.b` and roughness from `.g`.** glTF
packs both into one `metallicRoughnessTexture` (blue = metallic, green =
roughness) while this engine has two separate slots that both read `.r`. Binding
the packed texture to both slots and leaving the reads on red would have been
silently wrong — the exact failure class this file keeps documenting. The two
slots stay separate so a single-channel map can still be bound to one alone, and
the change is a **no-op for grayscale maps** (R=G=B), which is what every texture
that existed before this — including `test/fixture.ts`'s Poly Haven set — is.

**Golden status when this landed (2026-07-28, Manjaro laptop):** the fixture run
was clean (no `wgpu` errors) and `gltf-box.png` came back within **1 LSB** of the
committed golden through a completely rewritten import path, which is the strong
signal that the rewrite is faithful. Every other fixture also moved by ≤1 LSB
except `textured` (max Δ7 on 10 of 360 000 pixels) and `exterior` (max Δ21 on
**one** pixel) — the numeric-drift shape described above, and consistent with the
goldens having been committed from different hardware. They were therefore
**left as committed** rather than rebased here; see "The fixture goldens are a
genuine byte-exact baseline" for why regenerating a cross-machine diff is the one
case not worth doing silently.

### Textures: always-bound placeholders, no shader branching

Every material's bind group has exactly 6 texture-related bindings (1 sampler + 5 textures) whether or not it was given real textures — unset slots bind a shared 1x1 neutral placeholder (`assets/texture.ts`'s `getMaterialDefaults`) chosen so sampling it is a no-op against the material's own factors (white for anything multiplied, a flat tangent-space normal that reproduces the vertex normal unchanged). This keeps the bind group layout — and therefore the pipeline — identical for every material, avoiding per-material pipeline variants or a `hasTexture` uniform flag with shader branching. `test/fixture.ts`'s `textured` scene downloads a real CC0 texture set (Poly Haven's `metal_plate_02`, via its public file API) to validate all four map types at once; its small "emissive panel" object uses a synthetically-generated (not downloaded) checkerboard pattern purely to exercise the emissive-texture path, since no suitable small standalone CC0 emissive asset was sourced.

### Debugging WebGPU validation errors — read this before assuming something "worked"

**`metis-native` does not throw or reject on WebGPU validation errors.** They print to stderr as `[wgpu] uncaptured error: ...` and execution continues with whatever partial/garbage state resulted (an invalid command encoder, an unwritten buffer, a texture that silently kept its cleared value). A script can run to completion, write a file, and print a success message while having done nothing correct. **Always grep test/demo output for `wgpu` or run without piping through `tail`/`head`** — several real bugs during this engine's development (a shader with unreachable code after a `return`, a debug texture read missing `COPY_SRC`) were completely invisible until stderr was checked directly instead of trusting a clean exit code.

### WGSL module concatenation

`metis-native`'s `createShaderModule` takes one `code: string`; WGSL has no `#include`. Every shader that needs the shared structs/BRDF/cluster-math in `common.wgsl` gets it via plain string concatenation (`` `${commonWgsl}\n${forwardWgsl}` ``) at pipeline creation — in `clusteredForwardRenderer.ts` (forward), `lightCuller.ts` (cluster_build/light_cull), and `shadowCascades.ts` (shadow). `.wgsl` files are imported as raw text via Bun's `with { type: "text" }` import attribute (ambient-declared in `src/renderer/shading/wgsl.d.ts`).

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

Two bugs in `metis-native`'s `VectorContext` were found and fixed building this
(both documented in that package's CLAUDE.md): stroking an *open* polyline
panicked the process via lyon, and `drawText` built a full glyph outline on every
call that the `fill()` path then discarded. The remaining text cost is the glyph
cache tessellating in font units at a fixed tolerance — ~118 triangles per glyph
at 11 px, roughly 10x more than needed. Fixing that means keying the cache by
(glyph, size bucket); not done, and the reason `due()` carries the load instead.

### `demo:helmet` — and what tuning a 100-light scene actually taught

`examples/helmet-demo.ts` is the glTF importer and the clustered-forward path in
one scene: the Khronos DamagedHelmet (a real `.glb`, five 2K textures, **no
`TANGENT` accessor** so its basis is synthesised) under 100 orbiting point
lights, on an orbit camera. It is the demo to reach for when either half needs
eyeballing, and the reason it is one demo rather than two is that an orbit camera
over a static light field is the cheapest way to see a wrong tangent basis:
normal-mapped detail that lights from the wrong side as you go round.

**Three things about the scene are load-bearing and were each arrived at by
getting them wrong first.** They generalise to any many-light scene in this
engine, which is why they are here rather than only in the file's comments.

- **A shell of lights around one object does not look like many lights.** Packed
  into the volume around the helmet, 100 pools merge into a single white wash on
  any nearby surface and the whole thing reads as one badly-exposed spotlight.
  Distinct pools need the field spread over an area *much* larger than the
  subject — and spread over `sqrt(rand())` radius, not `rand()`, or half the
  lights land in the inner quarter of the disc. But spread them all out and
  nothing is close enough to light the hero object, which then sits there dark.
  The scene splits the field: the first ten orbit close and high and are the only
  ones shading the helmet; the other ninety are scattered across the deck. That
  split also makes the `-` key well-behaved — thinning the field never unlights
  the subject, because the inner lights are first in the array.

  Note the asymmetry in how `-` deactivates: **lights are parked, bulbs are
  removed.** `scene.lights`'s order is load-bearing (it decides which spot owns
  which shadow layer), so a deactivated light is moved 10 km down — outside every
  cluster, one sphere test. `scene.instances` has no ordering rule, so a
  deactivated bulb is spliced out of it. Parking the bulb too was the original
  code and was a bug; see the profiler-tree section below for how it surfaced.
- **Auto-exposure was the actual problem, not the lights.** Half the frame is
  black sky, which drags the metered average down, which makes the exposure
  *rise* until the lit half is white and every bulb clips. Dimming the lights
  does not fix it — the metering compensates straight back. `post.autoExposure.
  exposureCompensation` (0.45 here) is the knob, and it made a bigger difference
  than every light-parameter change combined. Worth remembering before spending
  an hour retuning intensities in a high-contrast scene.
- **The sun is dim, not off — and turning it off was the wrong call.** The first
  cut disabled it entirely, because 100 emissive bulbs going through all four
  cascades speckled every lit surface with their own little shadows and buried
  the real ones. That fixed the noise by deleting the shadows, which made the
  scene read as weightless: nothing grounded the helmet on the deck. The right
  fix was `SceneInstance.castsShadow` (below); with the bulbs excluded, a *dim*
  sun (0.16) gives an unmistakable contact shadow while the coloured pools still
  dominate, and three shadow-casting spots throw coloured spokes off the helmet.
  **Dimming a light is almost always the better move than removing it** — the
  thing that was actually broken was what was in the shadow pass, not that there
  was one.

### Draw-call batching — and how it nearly got written off as worthless

`shading/drawBatching.ts` sorts the frame's instances so draws sharing a `Mesh`
and `Material` are adjacent (`DrawOrder`), and skips binds a previous draw
already made (`PassBinder`). Both are internal: `render(encoder, targets, scene)`
already receives the whole scene, so nothing in the public API moved, and
`Scene.instances` is never reordered — sorting the caller's array would be a
visible side effect of rendering.

**Encode cost here is per call, not per triangle.** Every `setBindGroup` /
`setVertexBuffer` / `setIndexBuffer` / `draw` / `writeBuffer` is a JS -> napi ->
Rust -> wgpu crossing, so 400 helmets encode exactly like 400 cubes. The frame's
call count is `instances x passes-that-draw-them x calls-per-draw`, and with four
cascades, four spot layers, a prepass and the forward pass the middle term is
~10. Sorting attacks the third term; it is the cheapest of the three to attack
and the smallest.

**The first measurement said it was worth nothing, and that measurement was
wrong** — but the *reason* given for it turned out to be machine-specific, and
that is the part worth carrying forward. On the Intel iGPU laptop, CPU encode
read the same before and after, and the cause was diagnosed as contention: an
integrated GPU shares memory bandwidth with the CPU, and `queue.writeBuffer` goes
through wgpu's staging belt, so a saturated GPU destabilises the CPU number that
is nominally independent of it. The workaround was to **shrink the render target,
not the scene** (`--width 320 --height 240` keeps every draw call and removes the
contention).

**That workaround does not generalise, and shouldn't be applied blindly.** On the
discrete GTX 1070 desktop, CPU encode measures the same at 320x240 as at
1280x720 at every helmet count — there is no contention to remove, because there
is no shared bandwidth. Re-derive which situation you are in before reaching for
the small render target; on a discrete GPU it buys nothing and costs you a
realistic scene.

Sorting is worth roughly a fifth of encode. The thing it was *hiding behind* was
worth substantially more, and is now done — see "The model uniform is computed
once per frame" below. Re-measure both with `bun run bench:lights --helmets 400`.

Two invariants worth not breaking:

- **`PassBinder.begin()` must run after every `beginRenderPass`.** Bind state
  does not survive a pass. A tracker carried across passes would skip binds that
  were never made and draw with stale state.
- **Sorting is only safe while everything is opaque and depth-tested.** The day
  alpha blending lands, transparent instances need back-to-front order and must
  be excluded from this sort — the correct-by-accident property here is that
  opaque draw order is unobservable, not that order never matters.

Verified by rendering all 14 fixtures with and without the sort *on the same
machine*: byte-identical, zero differing samples. That is the check to repeat,
because the committed goldens drift by a few LSBs across machines and a plain
`git diff` on them proves nothing either way.

### The model uniform is computed once per frame, not once per pass

`SceneInstance` splits **`prepareModel`** (compute the model + normal matrices,
upload them) from **`modelBindGroup`** (a bare getter that binds what was
uploaded). `ClusteredForwardRenderer.render()` calls the first for every instance
in the frame's draw order, up front; the six-to-ten passes that draw an instance
call only the second.

They used to be one method, `getModelBindGroup`, and every pass called it — so
the same matrices were re-derived and the same bytes re-uploaded once per cascade,
once per spot layer, once for the AO prepass, once for the depth prepass and once
for the forward pass, for an object that had not moved. **This was the single
largest item in CPU encode**, by a distance, and removing it is the largest
frame-rate win the renderer has taken: measure it with
`bun run bench:lights --helmets 400`, which is where the per-instance costs
dominate everything else.

Three things about it are load-bearing:

- **`modelBindGroup` throws when the instance was never prepared.** Lazily
  preparing there instead would paper over an instance that some pass draws but
  `render()`'s prepare loop never walked, and the symptom is an object drawn at a
  stale transform — which reads as a game-logic bug, not a renderer one. This
  package's recurring lesson is that the dangerous failures are the ones that
  render plausibly; a throw is the cheap way to not have one here.
- **The prepare loop walks `DrawOrder`'s output, which is a permutation of
  `scene.instances`.** That is what makes the getter safe for *every* pass,
  including `AmbientOcclusion`'s prepass, which still iterates `scene.instances`
  directly and is the one draw loop that never adopted the draw sort or
  `PassBinder`. Worth fixing, not yet fixed.
- **A transform mutated between passes is ignored.** Everything the frame draws
  is snapshotted at the top of `render()`. This is a narrowing of what was
  previously possible-by-accident, and the right semantics: a single frame should
  not show one object at two positions.

**Unchanged instances skip their upload entirely.** `prepareModel` compares the
freshly computed model matrix against the last one it uploaded — 16 float
compares, far cheaper than the JS -> napi -> Rust crossing they avoid — and sets
`modelChanged`. Comparing the model alone is sufficient because the normal matrix
is a pure function of it. The stored copy is **NaN-filled at construction** so the
first frame can never match: a zero-filled one would silently skip the first
upload for any instance whose model matrix is legitimately all zeros.

`modelChanged` is not only an optimisation — `ShadowCascades` reads it, which is
what makes the next section possible.

### Instanced draws — one `array<Model>`, and an unresolved GPU question

Every instance's model + normal matrix lives in **one storage buffer**
(`shading/modelBuffer.ts`), bound once per pass, and a run of consecutive
instances sharing a mesh (plus a material, in the forward pass) is issued as a
single `drawIndexed(..., instanceCount, firstInstance)`. `SceneInstance` owns no
GPU resources at all now; its `destroy()` is a documented no-op.

**The enabling invariant is a three-way agreement**: `DrawOrder` fixes the
order, `ModelBuffer` writes slot *i* for draw-order position *i*, and a run's
`firstInstance` is its start index — so `@builtin(instance_index)` lands on the
right transform. All three read the same `instances` array from `render()`
precisely so they cannot drift.

**A pass that draws a subset cannot renumber.** The cascades skip non-casters and
the spot passes frustum-cull, and because `instance_index` addresses the
frame-wide array, a rejected instance *splits* the run rather than being
compacted out. Worst case (alternate instances rejected) that degrades to one
draw per instance — the pre-instancing cost, never worse. Compacting needs a
per-pass index-remap buffer plus an indirection in every vertex shader; not
built, and the reason per-cascade culling costs CPU (below).

**`forEachDrawRun`'s predicate is called twice at a run boundary.** Once as the
reason a run ended, once as the candidate starting the next. Anything that
counts or does real work — the spot frustum test, the cascade sphere test — must
precompute into a lookup and hand the walker a pure read. `SpotShadows`'
drawn/candidate counters would double-count otherwise.

**Verified byte-exact**, which is the strong claim: all 14 fixture goldens
reproduced with zero differing bytes through a completely rewritten draw path —
uniform buffer to storage buffer, per-instance bind groups to one, N draws to
one, and a different indexing expression in four shaders. A repacking-plus-
rebatching *should* be bit-identical, so a clean `git status` asserts the
rewrite is faithful rather than merely plausible.

**What it is worth: CPU encode, unambiguously. GPU, unknown.** Encode dropped
again on top of the once-per-frame model upload, and that result is stable across
many runs. The GPU-side effect could **not** be resolved on this machine — see
the next section, which is the more important finding.

**`@invariant` now has a third thing to keep in lockstep.** `forward.wgsl` and
`depth_prepass.wgsl` must compute `worldPos4` identically for `depthCompare:
"equal"` to work, and that now includes the array indexing, not just the
expression. Both read `models[input.instanceIndex].model`; changing how one
indexes without the other makes geometry vanish wholesale.

### Per-cascade frustum culling measured as nothing — and how the machine hid it

`ShadowCascades.cullPerCascade` tests each caster's world bounding sphere against
the cascade's own ortho frustum. It is **correct** — the test volume is the exact
matrix the pass renders with, so anything rejected would have been clipped
anyway, and the fixtures come back byte-identical with it on. It is **off by
default** because on the only scene the bench can build it does nothing
measurable: it rejects ~16-20% of cascade draws and moves frame time by less than
this machine's run-to-run drift, while costing four sphere tests per instance per
frame plus run fragmentation.

That is not a surprise, and this file predicted it: a cascade's ortho frustum is
fit to a slice of the *camera* frustum, so nearly everything the camera sees is
inside it. The bench's field is smaller than the cascade coverage, which is close
to the worst case for culling. **Judge it on a world genuinely larger than
`shadowDistance`, or not at all** — the same caveat the spot-shadow cull carries,
for the same reason.

**The methodological finding is the valuable part of this exercise.** On this
GTX 1070, a *GPU-bound* profiler span swings enormously run to run while the
light passes in the same frame do not. Three consecutive runs of one unmodified
build at `--helmets 400`:

| span | run 1 | run 2 | run 3 |
|---|---|---|---|
| `gltf-mesh-0-0` (GPU-bound) | 4.22 | 5.89 | 5.55 |
| `depth-prepass` | 0.78 | 0.74 | 0.74 |
| `bench-floor` | 0.27 | 0.23 | 0.23 |

**So a stable light pass is NOT a control for a heavy one.** During this work a
20% "regression" was attributed to instancing on exactly that reasoning — two
spans held constant to three decimals while a third moved — and repetition showed
the moved span's own spread was twice the effect. The overhead-dominated passes
are stable *because* they are overhead-dominated; they say nothing about the
clock state the throughput-bound pass is subject to. The claim was wrong and is
retracted here rather than quietly dropped, because the reasoning behind it is
seductive and will otherwise be reinvented.

Two rules out of it, both stricter than "measure, don't guess":

- **A single before/after pair on this machine is worth nothing for a GPU-bound
  pass.** Alternate A/B/A/B in one sitting and look at the spread, not the means.
  This is the same lesson as the wgpu-matrix migration's "273 / 215 / 273 fps in
  three consecutive runs", now with a per-pass mechanism attached.
- **CPU encode is the trustworthy signal here**, because it is not subject to GPU
  clock state — which is why every conclusion in this file's recent perf sections
  that survived was an encode conclusion.

Resolving the instancing question properly needs locked clocks or a runtime
toggle to alternate against; neither exists, and the honest state is *unknown*.

### Frustum culling everywhere else — and the reverse-Z plane that isn't there

The camera passes (depth prepass, forward, AO prepass) cull against the camera
frustum (`ClusteredForwardRenderer.frustumCulling`, **on**), and the sun cascades
can cull against their own ortho volume (`ShadowCascades.cullPerCascade`,
**off**). Both test each instance's world bounding sphere.

**Bounding spheres are computed once per frame by the renderer and lent out.**
`SpotShadows` and `ShadowCascades` each used to derive their own — `SpotShadows`
allocating an object per instance per frame — which was three passes over the
same matrices producing identical numbers, since a bounding sphere depends on the
instance and nothing about the viewer. `ModelBuffer.update` has just written
every matrix, so `SceneInstance.modelFloats` is this frame's and nothing needs
recomputing.

**One visibility mask serves the prepass, the forward pass and the AO prepass,
and that is a correctness requirement, not tidiness.** With the prepass on, the
forward pass tests `depthCompare: "equal"` — so anything the forward pass draws
that the prepass skipped has no matching depth value and renders as *nothing*.
Deriving the visible set twice would make that agreement a matter of luck. The AO
prepass shares it too, or AO would occlude against geometry the frame never
shaded.

**The camera's frustum has no far plane, and its near plane is in the far
slot.** `Camera.projectionMatrix()` is reverse-Z with an infinite far plane, so
Gribb-Hartmann extraction behaves unlike the textbook case:

- the slot `frustumFromViewProj` labels **near** (`row2`) is `(0, 0, 0, near)` —
  a **zero normal**. It is inert, and the `|| 1` guard in the normalisation is
  what keeps it from becoming NaN;
- the slot labelled **far** (`row3 - row2`) is the *actual near plane*, and is
  what rejects geometry behind the camera;
- there is **no far plane at all**, correctly — nothing is ever culled for being
  distant. In a space sim that matters: a finite far plane introduced here would
  silently start culling the planet.

So the extraction works by luck rather than design, and `test/cameraFrustum.test.ts`
exists to keep it that way — it asserts the degenerate plane *stays* degenerate,
because if a future projection change gives it a real normal the other five
planes would go on passing while that one quietly culled everything in front of
the camera.

**Both culls measure as nothing on this bench, and the bench is the wrong
witness for both.** Forward culling rejects ~15-19% of draws, per-cascade culling
~16%, and neither moves frame time beyond this machine's run-to-run drift
(alternate `--no-frustum-cull` / `--cascade-cull` and see). The reason is the
scene: `bench/lights.ts` is a dense field entirely in front of the camera, so
there is little off-screen to reject. **Judge these on a world larger than the
screen, or not at all** — the same caveat the spot-shadow cull carries.

They default differently anyway, and the reasoning is not "one measured better":

- **Forward culling is on** because its ceiling is high and the bench simply
  cannot show it. A camera inside a real level routinely sees a small fraction of
  the world, and nothing else in the engine can reject that geometry.
- **Per-cascade culling is off** because its ceiling is structurally low: a
  cascade's ortho volume is *fit to the camera frustum*, so it contains
  approximately what the camera sees by construction. It also costs four sphere
  tests per instance and fragments instanced draws (`forEachDrawRun`), so it is
  not free while it waits for a scene that wants it.

**Two mutation checks, and the first one failed to fail.** `test/frustumCull.test.ts`
pairs "culling changes no pixels" with "culling actually rejected something",
because either alone passes trivially. Zeroing the bounding radius — an
over-eager cull — initially passed *every* test, because the scene had nothing
straddling a frustum edge: every instance was wholly inside or wholly behind the
camera. It needed an instance whose centre is outside the left plane but whose
radius reaches into view. Second: counting `lastDrawnInstances` from the
filter's *opinion* rather than from the draws themselves could not detect a
filter that is computed and then ignored — a dead optimisation that still renders
correctly. It is accumulated in the forward pass's `emit` now. Both are the same
lesson this file keeps relearning: a green test proves nothing until it has been
watched failing for the right reason.

### Cascade shadow maps are cached — and exactly how much that is worth

`ShadowCascades` skips a cascade's depth pass entirely (no pass encoded at all,
not a cheaper one) when its fitted `viewProj` is bit-identical to the one its
depth layer already holds *and* nothing about the caster set changed.

**The correctness argument is the matrix, not the camera.** A cascade is only
reused when the exact matrix that produced its depth map is the matrix the
forward pass will sample it with. Testing "did the camera move" instead would be
both weaker and wrong — texel snapping means the fit is *quantized*, so a camera
can move without the fit changing, and the sun or `shadowDistance` can change
without the camera moving.

**Invalidation is frame-global, deliberately.** Any caster moving, appearing,
vanishing or swapping its mesh re-renders all four cascades. Knowing *which*
cascades a given caster falls in needs a per-instance/per-cascade frustum test,
which still doesn't exist — so one moved object costs a full re-render. That is
no worse than the uncached behaviour it replaces.

**The mesh-identity hash is not paranoia.** Movement is caught by
`modelChanged` and membership by the caster count, but reassigning
`instance.mesh` in place changes the silhouette while leaving both unchanged.
Unlike `DrawOrder` — where a stale answer is a missed optimisation — a stale
answer here is a *wrong picture*: an object casting the shadow of the mesh it used
to be. It costs one multiply per caster in a loop that already runs. It does
**not** cover mutating a `Mesh`'s vertex buffer in place; nothing does.

**Now the honest part: this is all-or-nothing on camera motion.** A cascade's fit
follows the camera, so a still camera skips every cascade and a moving one skips
none. There is no partial credit. On the geometry-heavy bench the static case is
one of the largest wins in this file and the orbiting case is *exactly zero* —
same build, same machine, same sitting.

**That is why `bench:lights` grew `--orbit`.** The bench camera was static, so a
cache keyed on the camera would have measured as free, and quoting that number
would have been measuring the benchmark rather than the renderer — the exact
mistake "don't let a benchmark's labels assert a cause it hasn't measured"
warns about. Always report the pair:

```powershell
bun run bench:lights --helmets 400                      # static — best case
bun run bench:lights --helmets 400 --orbit 0.1          # moving — worst case
bun run bench:lights --helmets 400 --no-shadow-cache    # the A/B baseline
```

The summary prints cascades-re-rendered-per-frame, which is the number that says
whether the cache engaged at all. If a change ever makes the static case look
good and you have not run the orbiting one, you have not measured anything.

**Making a moving camera benefit is a different change**, and neither half
exists: per-cascade frustum culling (so a moved caster only dirties the cascades
it is in), or scheduled cascade updates — refreshing distant cascades every Nth
frame, which needs a fitting margin so the camera cannot leave a stale cascade's
coverage, and accepts lag in far shadows.

`test/shadowCache.test.ts` pins all of this, and its invalidation case is
**mutation-checked**: deleting the `modelChanged` term from `castersChanged`
makes the cached run keep drawing a moved cube's shadow at its old position, and
the test fails on thousands of differing pixels. Per this package's history with
`clusterNear.test.ts` and `spotLight.test.ts`, that is the point — a render-based
test proves nothing until it has been seen failing for the right reason. The test
also asserts the cache actually *hits* (`lastRenderedCascades === 0` on a warm
static frame), because "cached matches uncached" passes just as happily with a
cache that never engages.

### `SceneInstance.castsShadow` — content, not culling

Every instance was drawn into all four sun cascades and every spot-shadow layer,
unconditionally. `castsShadow` (default `true`) opts one out.

It exists because of a concrete failure, not as a general knob:
`demo:helmet` stands 100 point lights in for their positions with small emissive
spheres, and a hundred marker spheres in the shadow passes speckle every lit
surface with tiny shadows that swamp the shadows that matter. There is no way to
tune that away — the geometry is genuinely there and genuinely occludes.

**It is a property of the content, not of the frame, and must not be used as a
culling optimisation.** A real occluder that is off-screen still has to cast;
that is what `SpotShadows`' frustum test is for, and conflating the two would
make objects lose their shadows as the camera moves. The flag means "this object
does not have a shadow" — light gizmos, sky shells, emissive markers, and
ground planes with nothing beneath them.

One detail in `spotShadows.ts`: the check runs *before* `lastCandidateInstances++`,
so a non-caster is not counted as a culling candidate. Counting it would make the
drawn/candidate ratio the demos display look worse than the frustum test actually
performs.

This closes a gap this file previously listed as a known limitation. It does
**not** address the other half of that entry: there is still no per-cascade
frustum culling, so every caster is redrawn for every cascade.

### The profiler tree merges repeated draw rows, and that is a display choice

`profileSpansToRows` sums sibling spans that share a label into one `xN` row.
It exists because `demo:helmet` draws 100 identical bulb meshes and produced 100
rows reading `light-bulb`, which pushed every pass worth looking at off the
panel — the widget was unusable on exactly the scene it was most needed for.

Two properties make the merge safe rather than lossy-by-default:

- **The key is the label, and the label is `mesh.label`.** Two draws share one
  only if they share a `Mesh`, and when they do their rows are indistinguishable
  anyway. Instances without a label fall back to `instance N` in
  `clusteredForwardRenderer.ts`, which is unique per draw, so those correctly
  stay separate.
- **It is display-only.** `GpuProfiler.spans` is the measurement and is left
  exactly as recorded; the merge copies rather than accumulating into it. One
  pathologically slow draw among many *does* hide inside the sum — read the raw
  spans when hunting that.

**The `xN` count immediately earned its keep by exposing a bug**, and the shape
of that is worth keeping. `demo:helmet`'s `-` key reported 25 lights while the
tree kept reading `light-bulb x100` — which looked like the merge miscounting and
was the merge being *honest*: deactivated bulbs were parked far below the deck
rather than removed from `scene.instances`, so all 100 were still being drawn.
**Off-screen was not undrawn** — the forward pass had no frustum culling at the
time, which it does now — and the waste was invisible both on screen and in the
frame time, because a bulb behind the camera rasterises nothing. A count of draws is a claim nothing else in
the HUD makes, which is exactly why it caught something nothing else could.

**This did not fix, and was not meant to fix, the query budget** — and the note
that used to stand here (256 queries, `demo:helmet` fitting with ~7% headroom,
"adding geometry will trip the warning") was correct and got cashed in one change
later, by `bench:lights --helmets`. `MAX_QUERIES` is now **1024**: 8 bytes per
query per ring entry across three entries, so 8 KB each, against a WebGPU cap of
4096 entries per set. That buys ~470 draws — enough for `--helmets 400`
(measured: 401 draws, no warning). The rule it was stated under still holds:
when a scene outgrows the budget, raise it rather than suppressing zones. An
untimed span is a measurement you silently do not have, and `allocSpan`'s -1
degrade path is a guard, not a design.

The merge also earns its keep in the **console** summary now, not just the
widget: `bench/lights.ts` prints its pass breakdown through `profileSpansToRows`
rather than walking `profiler.spans` directly, because at `--helmets 100` the raw
tree is 100 consecutive identical `gltf-mesh-0-0` lines with the passes buried
under them.

**`test/output/debug-widgets.png` is not a byte-exact golden and cannot be.**
It renders live GPU timings *as text*, so two consecutive runs of identical code
differ (measured: max delta 187 across ~8000 pixels). It is written by
`test/debugWidgets.smoke.ts`, not by `bun run fixture`, so it is outside the
byte-exact fixture set described above despite living in the same folder — do
not read a diff on it as a regression, and do not commit a regenerated one as if
it were a baseline.

### Known limitations (not yet done)

- No image-based lighting / environment reflections — a pure metal with no texture is lit only by direct lights, nothing else (see `math/PBR shading formulas.md`'s "Where the real handwave lives").
- **Point** lights don't cast shadows — only the sun and up to `MAX_SHADOW_SPOTS` flagged spot lights do. Point-light shadows need a cube map (6x the passes and draws) and are not planned; point lights are for detail and fake emissive glow. See "Spot light shadows" above.
- **Zero-thickness occluder geometry is the one case the shadow system genuinely cannot resolve** — occluder and receiver depths coincide at a shared edge, and no shadow-map representation can separate them. `roomBox` therefore builds solid-slab walls (0.2 units thick), so a corner's occluder record is the wall's sunlit exterior face and the depth gap is ~wall-thickness; a long-running concave-corner light leak in the interior demo was ultimately closed by exactly this, and it also paid for `SHADOW_MAP_SIZE` 4096 → 2048. Prefer closed/thick meshes for anything that must cast interior shadows. `normalOffset` is a texel-count quantity, computed per frame per cascade from that cascade's texel size (`SHADOW_NORMAL_OFFSET_TEXELS`/`_MIN`, uploaded in `CascadeUniforms.normalOffsets`), so it self-rescales with `SHADOW_MAP_SIZE`, `shadowDistance`, and the split scheme; see "Cascaded shadow maps" above.
- The glTF loader **imports** skins, morph targets and animations but the renderer **draws** none of them — there is no skinning or morph pipeline, and nothing extracts a camera or a `KHR_lights_punctual` light into the `Scene`. `loadGltfAsset` hands back the full `GltfAsset` so a future system can; `loadGltf` drops them.
- No alpha blending or alpha testing, so a glTF material with `alphaMode: "BLEND"`/`"MASK"` renders opaque (with a warning).
