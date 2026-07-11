# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`metis-data` is the type system and math library for **GPU-compatible memory
layouts**. It describes how bytes are arranged in an `ArrayBuffer` and hands back
typed views over them — it never touches the GPU, WebGPU, or SDL. It has no
dependency on any other package in the monorepo (its only runtime dependency is
`type-fest`, for tuple/index type helpers); `metis-engine` consumes *it*.

Its reason to exist is the engine's data path. `metis-engine`'s archetype ECS
stores each archetype's entities as **packed array-of-structs rows in one
growable `ArrayBuffer`**, and every component is a `metis-data` descriptor
(`StructOf`, `Vec`, `F32`, …); `getComponent` returns a live `metis-data` view
into that buffer, not a copy. The same descriptors describe the std140/std430
uniform and storage buffers the renderer uploads. So this package sits on the
hottest data path in the engine — it is built and read every frame, for
potentially tens of thousands of entities — which is why **speed is a
first-class concern here alongside correctness** (see "Performance intent" and
the benchmark below).

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

The math layer is built for allocation-free steady state: every producing op is
**out-first** (`Vec3.add(out, a, b)` writes into `out` and returns it), so a loop
can pre-allocate its scratch buffers and allocate nothing per frame.

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
