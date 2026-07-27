# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`metis-data` is the type system and math library for **GPU-compatible memory
layouts**. It describes how bytes are arranged in an `ArrayBuffer` and hands back
typed views over them — it never touches the GPU, WebGPU, or SDL. It has no
dependency on any other package in the monorepo (its only runtime dependency is
`type-fest`, for tuple/index type helpers); `metis-engine` consumes *it*.

Its reason to exist is the engine's **GPU upload path**. `metis-engine`'s
renderer describes every std140/std430 uniform and storage buffer it uploads —
camera, environment, per-instance model, the packed light array, the cascade and
spot-shadow uniforms, AO params — as `metis-data` descriptors (`StructOf`,
`ArrayOf`, `Vec`, `Mat`, `F32`, …), allocates each one once, and writes into it
in place every frame. The renderer's math also runs on this package's
`Vec`/`Mat`/`Quat`, so a computed matrix lands directly in the bytes that get
uploaded, with no intermediate copy.

**It is not on the ECS's path, and that is deliberate.** The ECS used to store
archetype rows as `metis-data` AoS structs and was migrated off it entirely: it
now owns SoA typed-array columns with **no `metis-data` dependency**. AoS is the
wrong shape for per-frame entity iteration, and this package is AoS by design
because a packed GPU buffer *is* interleaved. See "Performance intent" below —
that section is the authority here, and this paragraph exists so the Overview
stops contradicting it.

So the workload to optimize for is **packing and uploading**: hundreds to a few
thousand writes per frame into pre-allocated buffers, not iteration over tens of
thousands of entities. Correctness of layout is the first-class concern; speed
matters in the narrower sense that the per-frame write path must not allocate.

Three layers, each an independent subtree of `src/`:

1. **Descriptors** (`src/descriptors/`) — immutable objects encoding a type's
   `byteSize`, `alignment`, `arrayPitch`, and packing. Pure layout math; built
   once, shared freely.
2. **Memory buffers** (`src/memory/`) — cheap typed views that read/write a
   region of an `ArrayBuffer` according to a descriptor.
3. **Math** (`src/math/`) — `Vec2/3/4`, `Mat2/3/4`, `Quat` as out-first
   operations over memory buffers. Already audited and tested; this doc's
   war stories are about the descriptor/buffer layers.

## Read [`DOC.md`](DOC.md) first

[`DOC.md`](DOC.md) is this package's **API reference**: the packing table, every
descriptor factory and its properties, the memory-buffer `get`/`set`/`at`
surface, and the full math namespace — with signatures and recipes.

**Consult it before opening source files.** It exists so a task doesn't start
with a dozen `Read` calls. Drop to source only when it doesn't cover what you
need — then consider whether the gap belongs in the doc.

**Keep it current.** Changing a public API — a factory signature, the meaning of
a packing rule, a documented invariant — means updating `DOC.md` **in the same
change**. A stale doc is worse than none, because it will be trusted.

This `CLAUDE.md` explains *why* (the layout rules, the design split, the
debugging history below). `DOC.md` explains *what to call*. Keep that split —
don't duplicate war stories into `DOC.md`, don't grow an API listing here.

**No measured numbers in either file.** Timings and ops/sec are properties of the
machine that ran them, not of this package: the same unmodified code reports
wildly different figures on another box, which reads as "something is broken"
when nothing is. Record the *finding* ("the matrix ops still pay the tuple
cost"), the *reasoning*, and **how to re-measure** (`bun run bench/mathAlloc.ts`,
`bun run bench`). Derived facts that follow from the layout rules — byte sizes,
strides, alignments — are fine; they're properties of the design. This mirrors
`metis-engine`'s CLAUDE.md, which carries the same rule for the same reason.

## Commands

Run from `packages/metis-data/` unless noted.

```powershell
# Install deps (from repo root)
bun install

# Run the whole test suite (descriptors + memory + math)
bun test

# A single test file
bun test src/descriptors/test/std430.test.ts

# Type-check this package
bunx tsc --noEmit

# Performance + memory benchmark vs flat typed arrays and plain objects
bun run bench

# Math-layer allocation overhead: races each op against a hand-written
# view-based equivalent computing identical arithmetic. The gap IS the
# get()/set() tuple cost — see "out-first is not allocation-free" above.
bun run bench/mathAlloc.ts
```

The tests live next to what they cover: `src/descriptors/test/`,
`src/memory/test/`, `src/math/test/`. `layout.test.ts` and `std430.test.ts` are
the load-bearing ones — they pin exact byte layouts against the std140/std430
rules a shader agrees with.

## Architecture

### Two layers: immutable descriptors, disposable buffers

The split is deliberate and load-bearing. A **descriptor** is pure, immutable
layout math (`readonly` throughout) — it knows a type's size/alignment/stride and
nothing about any particular buffer. A **memory buffer** is a throwaway view: a
`{ descriptor, ArrayBuffer, offset }` triple with typed `get`/`set`. You build a
descriptor once (e.g. a `Vertex` struct or a `Transform` component) and reuse it
for every instance; buffers are minted cheaply against whatever bytes you point
them at.

`allocate(desc)` mints a fresh `ArrayBuffer` sized to `desc.byteSize` and wraps
it; `wrap(desc, buffer, offset)` views an existing buffer — which is how the ECS
sub-allocates thousands of component views out of one archetype buffer, and how
nested access works (`struct.get("pos")`, `array.at(i)`, `mat.at(col)` all call
`wrap` internally). Descriptors are never mutated — compose new ones, never
reach in.

### `byteSize` is the *unpadded* extent — size vs. stride, and the vec3 bug

The single most important layout invariant: a descriptor's `byteSize` is its
**unpadded** size, not its stride. A std140 `Vec3<F32>` is **12** bytes, even
though its *alignment* is 16. This is exactly what std140/std430 (and WGSL)
require: a smaller-aligned field that follows a vec3 packs into the 4-byte gap,
so `{ vec3, f32 }` is 16 bytes with the scalar at offset 12 — not 32. Only
*placement* (`alignment`) and *array element stride* (`arrayPitch`) are ever
padded; the size itself is not.

This wasn't always right. The descriptors originally shipped **untested**, and a
regression had `Vec3<F32>.byteSize` padded up to 16. That silently pushed any
trailing scalar to offset 16 and corrupted every following field of every uniform
block that used the pattern — the kind of bug that produces "the shader reads
garbage after the third field" with no error anywhere. `layout.test.ts` exists
because of it and pins the vec3 case (and its `{ vec3, f32 }` gap-packing
consequence) as ground truth. Don't "simplify" `byteSize` toward `alignment`.

### Packing is frozen, and not inherited — hence the struct guard

Each descriptor's `PackingType` is fixed at construction. It is **not** inherited
by composition: putting a `Dense` `Vec3` inside a `Std140` struct does *not*
re-pack the vec — it stays Dense (alignment 4), under-aligns inside the struct,
and silently disagrees with the shader's std140 offsets. Because that failure is
invisible, `StructDescriptorImpl` **validates** it: a `Std140` or `Std430` struct
throws if any composite member was built with a different packing, naming the
member and the mismatch. Scalars carry no packing and are layout-invariant, so
they never trip it. The takeaway for callers (and the doc): pass the *same*
`PackingType` to every member as well as to the struct.

### std140 vs std430 — one rule apart

Both are the same base rules; std430 (storage buffers) simply drops std140's
(uniform blocks') habit of rounding arrays, matrix columns, and struct alignment
up to a 16-byte (vec4) boundary. Concretely, only these differ: `array<f32>`
strides by 4 in std430 vs 16 in std140; `Mat2` columns pack at 8 vs 16 (matrix
16 bytes vs 32); a `{ f32, f32 }` struct is 8 bytes/align 4 vs 16/align 16. Types
that already align to 16 (`vec3`, `vec4`, `mat3`, `mat4`) are identical in both.
`std430.test.ts` asserts each difference with an explicit std140-contrast line so
the distinction can't silently rot. `Dense` is the third mode — scalar alignment,
no padding at all — for vertex/index/particle buffers.

### The array `view()` undershoot — a fixed footgun

`ArrayDescriptor.view()` returns a *flat* typed array over the whole allocation.
It once sized that view by the element's **unpadded** component count
(`element.length × count`), which is wrong for any std140 array whose element
carries internal padding: a 10-element `array<vec3<f32>>` is 160 bytes (16-byte
stride), but the view covered only 120 (30 floats) and its indices skipped the
stride — so `view()[3]` read component 0 of the *wrong* element. It wasn't
memory-unsafe (it undershot), which is exactly why it could sit unnoticed. The
fix sizes the view by `byteSize / scalarByteSize`, spanning the full padded
region for both dense and std140; `array.test.ts` now asserts the flat view
aliases the same bytes `at()`/`offsetAt()` address. Prefer `at()`/`offsetAt()`
for element access regardless; `view()` is for bulk upload of the raw region.

### Performance intent — this is a GPU-layout library, not a hot-path iterator

Know what job this package has before optimizing it. metis-data describes
**GPU-compatible interleaved (AoS) memory** — std140/std430/Dense structs you
upload as one packed buffer — and gives typed, convenient access to it. Being AoS
*is the point*: a packed GPU buffer is interleaved. This package is exercised when
you **pack and upload** GPU data, not when you iterate tens of thousands of
entities per frame — so don't optimize it as if it were the per-frame hot loop.

**Fast per-frame iteration is a separate, orthogonal concern, and it isn't
metis-data's.** The ECS owns it, with a **structure-of-arrays** layout (one typed
array per field, indexed by entity id — the bitECS pattern). There, a field access
is a bare `field[i]` typed-array index: cache-friendly, fully typed, no wrapper, no
closures, no eval — measured *faster* than even hand-indexed AoS. AoS interleaving
(metis-data) and SoA iteration (ECS) are different memory models for different
jobs; the render extract bridges them (SoA sim data → interleaved AoS where a GPU
uniform block needs it). Speed of iteration is orthogonal to efficient GPU storage.

So the convenient API here — `allocate`/`wrap`/`at`/`get`/`for…of`, each returning
a *fresh, independent* sub-buffer (safe to hold, compare, stash), with a
constructor-cached region view so repeated `get`/`set` don't re-allocate, plus
`getComponent`/`setComponent` for no-tuple vec access — is right-sized for this
package's role. The one exception: a hot loop that *genuinely* lives on an AoS
metis-data buffer should hand-index it (one typed array per scalar type, like the
`flat` baseline in `bench/buffers.ts`; a *single* `Float32Array` is wrong — it
misreads `u32`/`bool` fields). That's the exception, not the design center.

**History worth not repeating.** Two abstractions were tried to make AoS iteration
fast *and* typed: a rebindable-flyweight "cursor" (reused element buffer + `seek()`)
and generated closure accessors. Both underdelivered (~11–14 Melem/s, no better than
plain objects) and *only* runtime `eval`/`new Function` reached the floor. Both were
removed. The lesson wasn't "try harder" — it's that fast typed iteration wants SoA,
which is the ECS's layer. **Don't reintroduce a hot-path iteration abstraction
here.** The `bench/buffers.ts` numbers (convenient vs hand-indexed `flat` vs plain
objects, on a *mixed-type* component) exist to keep that conclusion honest.

The math layer is **out-first** — every producing op writes into a leading `out`
buffer and returns it, so a loop pre-allocates its scratch buffers and never
allocates the *result*.

**That is not the same as allocation-free, and the distinction was found the
hard way.** Most ops are written in terms of `get()`/`set()`, and `get()` builds
a fresh tuple array on every call — so `Vec3.add(out, a, b)` allocates three
short-lived arrays, and `Mat4.multiply` reached roughly two dozen once
`MatMemoryBuffer.at()` minted a sub-buffer (and a TypedArray view) per column
access. The doc here claimed "allocate nothing per frame" for years while that
was false.

Fixed at the root: `MatMemoryBufferImpl` caches its view like
`VecMemoryBufferImpl` always did, and exposes `columnElements` so callers can
walk a matrix through `view()` without allocating.

**`Vec2`/`Vec3`/`Vec4` are rewritten** — every op reads through the cached view
and writes components individually, and they now land close enough to
hand-written arithmetic that the remainder is function-call overhead rather than
style. `vec3.ts` is the reference implementation of the pattern; the other two
point at it rather than repeating the rationale.

**For the matrices, the biggest win was not in the ops at all.**
`MatMemoryBuffer.get(col)`/`set(col)` routed through `at()`, which minted a whole
sub-buffer (and its TypedArray view) just to read or write N numbers — so *every*
matrix op paid two allocations per column access. Reading and writing the cached
view directly there is a handful of lines and it lifted every one of the ~100
matrix and quaternion ops at once, without touching any of them. **Look for the
shared bottleneck before rewriting a hundred call sites**; the vectors had no
such layer, which is why they genuinely needed the per-op work.

On top of that, the hot ops are rewritten view-based: `Mat4.multiply`,
`Mat4.invert`, `Mat3.multiply`, `Quat.multiply`. The long tail (decompose, the
2D helpers) still uses `get()`/`set()` and is now cheap enough that it has not
been worth the churn.

**The `Mat4` *constructors* were the remaining hole, and it was a structural one
rather than a tuple-churn one.** `lookAt`/`perspective`/`perspectiveReverseZ`/
`orthographic`/`fromTRS` were scalar-first (`(F32, …) → new buffer`), so they
allocated *by signature* — no calling convention could avoid it. That is fine
for setup and wrong for a renderer, which rebuilds a view matrix, a projection,
and four cascade orthos every frame. Each now has an out-first primary
(`setLookAt`, `setPerspective`, `setPerspectiveReverseZ`, `setOrthographic`,
`composeTRS`) with the allocating form delegating to it, so there is exactly one
copy of each formula. Prefer adding new constructors in that shape.

Their test (`src/math/test/setConstructors.test.ts`) asserts against a
deliberately **dirtied** `out`, and that is the point of it: an out-first
constructor that skips a component silently inherits whatever the scratch buffer
held, which is a bug the allocating twin cannot have — it starts from zeroed
memory. Comparing the two against a *fresh* `out` would pass either way.

**Which ops are done is a question for the benchmark, not this file.**
`bun run bench/mathAlloc.ts` races each one against an open-coded equivalent
computing identical arithmetic and labels it `at parity` or `NOT YET REWRITTEN`.
That output is the answer on whatever machine you are actually on; a number
written down here would only describe a machine you aren't.

**Two ways that benchmark lied before it was trusted**, both worth knowing since
the same traps apply to any op added later. Its `Mat4.invert` reference computed
only 4 of the 16 adjugate entries, making the library op look several times
slower than it was — a baseline that does less work than the thing it measures
is a wrong answer with a confident label. And its iteration count left the vector
ops finishing in about a millisecond, so scheduler noise flipped unchanged ops
between verdicts run to run. Iterations are now high enough that every op runs
for tens of milliseconds, and the parity threshold is deliberately loose, because
a thin function wrapper cannot reach 1.0x however it is written.

**The aliasing hazard is the reason this needs care, and it is invisible.** The
old `get()` style was alias-safe *by accident* — it snapshotted every operand
into a tuple before writing, so `Vec3.cross(a, a, b)` worked. View-based code
reads and writes the same memory, so an op that interleaves them corrupts its own
input, and **only** in the aliased case. The existing suite would not have caught
it: nothing else in it passes the same buffer twice. `src/math/test/aliasing.test.ts`
now pins it, and was written and made to pass against the *old* implementation
first — otherwise it would only have been testing the new code's own assumptions.
Read all operands into locals before writing any output. Do the same when
rewriting the matrix ops.

### Known limitations (not yet done)

- **No runtime-sized (unbounded) arrays.** `ArrayOf` needs a fixed length; the
  trailing runtime-sized array of a WGSL storage buffer isn't modelled.
- **No explicit `@align`/`@size` overrides.** Layout is derived purely from type
  + packing; you can't force a member's offset or stride the way a WGSL attribute
  can.
- **No fast per-frame iteration path — deliberately.** metis-data is AoS
  GPU-layout + convenient access; per-frame hot iteration is the ECS's job via SoA
  (see Performance intent). Don't add a hot-path iteration abstraction here — two
  were tried (cursor, generated accessors) and removed as dominated. If a hot loop
  truly lives on an AoS buffer, hand-index it.
- **`src/std140_demo.ts` and `src/test.ts` are scratch scripts**, not part of the
  test suite or the public surface.
