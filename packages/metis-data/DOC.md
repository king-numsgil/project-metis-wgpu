# metis-data — API reference

Practical API reference for `metis-data`, written so a task can be started
**without reading the source**. `CLAUDE.md` (this package) explains *why* things
are the way they are — the descriptor/buffer split, the layout rules, the
debugging history behind them. This file explains *what to call*.

`metis-data` describes GPU-compatible memory layouts and gives typed read/write
access to `ArrayBuffer`s. Nothing here touches the GPU. Three layers:

1. **Descriptors** (`src/descriptors/`) — immutable objects encoding a type's
   byte size, alignment, and packing. Reached via `metis-data`.
2. **Memory buffers** (`src/memory/`) — typed views that read/write a region of
   an `ArrayBuffer` per a descriptor.
3. **Math** (`src/math/`) — `Vec2/3/4`, `Mat2/3/4`, `Quat` as operations over
   memory buffers.

Everything is exported from the package root: `import { F32, Vec, StructOf,
allocate, Mat4, … } from "metis-data"`.

> **Scope / trust.** Signatures here are transcribed from source. If a task
> depends on an exact signature, spot-check that one symbol. If you change a
> public API, update this file in the same change (see CLAUDE.md).

---

## 1. Packing strategies

Every composite descriptor factory takes an optional `PackingType` (default
`Dense`).

```ts
enum PackingType {
    Dense   = 0,   // tightly packed (scalar alignment) — vertex/index/particle buffers
    Std140  = 1,   // std140 uniform-block layout       — var<uniform> @group bindings
    Std430  = 2,   // std430 storage-buffer layout       — var<storage> bindings
}
```

Every descriptor exposes three layout numbers:

- **`alignment`** — where an instance may be *placed* (its base offset must be a multiple).
- **`byteSize`** — its *unpadded* extent (what the next field packs against).
- **`arrayPitch`** — the stride between consecutive elements when it is an array element.

| Type | Dense `byteSize` | Std140 `byteSize` | Std140 `arrayPitch` | Std430 `byteSize` | Std430 `arrayPitch` |
|---|---|---|---|---|---|
| `Vec2<F32>` | 8 | 8 | 16 | 8 | **8** |
| `Vec3<F32>` | 12 | 12 | 16 | 12 | 16 |
| `Vec4<F32>` | 16 | 16 | 16 | 16 | 16 |
| `Mat2<F32>` | 16 | 32 | 32 | **16** | 16 |
| `Mat4<F32>` | 64 | 64 | 64 | 64 | 64 |
| `ArrayOf(F32, 4)` | 16 | 64 | 16 | **16** | 4 |
| `ArrayOf(Vec3<F32>, 10)` | 120 | 160 | 16 | 160 | 16 |
| `StructOf({F32, F32})` | 8 (align 4) | 16 (align 16) | — | **8** (align 4) | — |

**Rule of thumb:** vertex/particle attributes → `Dense`; `@group` uniform
bindings → `Std140`; `var<storage>` storage buffers → `Std430`.

**Packing must match across a composite.** Packing is frozen at construction and
is **not** inherited. A `Std140`/`Std430` struct validates its composite members
and throws if any was built with a different packing — always pass the *same*
`PackingType` to every member as well as to the struct. Scalars are
layout-invariant and never need it.

---

## 2. Scalar descriptors

Frozen singletons — import and use directly.

```ts
import { Bool, I32, U32, F16, F32, F64 } from "metis-data";
```

| Constant | TypedArray | `byteSize` | `alignment` |
|---|---|---|---|
| `Bool` | `Uint32Array` | 4 | 4 |
| `I32` | `Int32Array` | 4 | 4 |
| `U32` | `Uint32Array` | 4 | 4 |
| `F16` | `Float16Array` | 2 | 2 |
| `F32` | `Float32Array` | 4 | 4 |
| `F64` | `Float64Array` | 8 | 8 |

`ScalarDescriptor` is the numeric union (`I32 | U32 | F16 | F32 | F64`); `Bool`
is separate (boolean-valued).

---

## 3. Vector descriptors

```ts
function Vec<S extends ScalarDescriptor, N extends 2 | 3 | 4>(
    scalar: S, n: N, packing?: PackingType,
): VecDescriptor<S, N>
```

```ts
const pos  = Vec(F32, 3);                        // Dense vec3<f32>
const upos = Vec(F32, 3, PackingType.Std140);    // Std140 vec3<f32>
```

`VecDescriptor` props: `type` (`"vec2"|"vec3"|"vec4"`), `scalar`, `length` (N),
`byteSize`, `alignment`, `arrayPitch`, `packing`. `view(buffer, offset)` → an
N-length window of the scalar's TypedArray.

---

## 4. Matrix descriptors

```ts
function Mat<S extends ScalarDescriptor, N extends 2 | 3 | 4>(
    scalar: S, n: N, packing?: PackingType,
): MatDescriptor<S, N>
```

Stored **column-major**. Adds `column` (a `VecDescriptor`), `columnStride`, and
`length` (= N×N component count).

```ts
const mvp = Mat(F32, 4, PackingType.Std140);   // columnStride 16, byteSize 64, alignment 16
desc.col(buffer, offset, colIndex);            // → Float32Array view of one column (bounds-checked)
```

---

## 5. Array descriptors

```ts
function ArrayOf<Item extends Descriptor<any>, N extends number>(
    item: Item, length: N, packing?: PackingType,
): ArrayDescriptor<Item, N>
```

```ts
const joints = ArrayOf(Mat(F32, 4, PackingType.Std140), 64, PackingType.Std140);
```

Adds `item`, `length`, `offsetAt(index)` (bounds-checked → byte offset), and
`at(buffer, offset, index)` (→ the item's view). `view(buffer, offset)` returns
a flat typed array spanning the **whole** allocation (padding included); index
elements with `at`/`offsetAt`, not by dividing the flat view.

**The flat view's element type follows the item's scalar** — `Float32Array` for
`ArrayOf(Vec(F32,…))`, and so on. When the item is a **struct** (heterogeneous
members), there is no single element type, so `view()` is a `Uint8Array` of raw
bytes — correct for bulk GPU upload. Reach individual fields through `at(i)`; only
reinterpret the bytes yourself (`new Float32Array(buf.buffer, buf.offset, n)`)
when you know the region is uniform and want to hand-index it.

---

## 6. Struct descriptors

```ts
function StructOf<Members extends Record<string, Descriptor<any>>>(
    members: Members, packing?: PackingType,
): StructDescriptor<Members>
```

Members lay out in definition order, each aligned to its own `alignment`; the
struct's size rounds up to its own alignment (max member alignment, floored to 16
only under `Std140`).

```ts
const Vertex = StructOf({
    position: Vec(F32, 3),
    uv:       Vec(F32, 2),
    normal:   Vec(F32, 3),
});
// Dense: position@0, uv@12, normal@20 → byteSize 32

const Uniforms = StructOf({
    mvp:   Mat(F32, 4, PackingType.Std140),
    color: Vec(F32, 4, PackingType.Std140),
}, PackingType.Std140);
// mvp@0, color@64 → byteSize 80, alignment 16
```

Adds `members`, `offsets` (a defensive copy), `offsetOf(name)` (throws on unknown),
and `member(buffer, offset, name)` (→ that member's view). `view` → a
`byteSize`-length `Uint8Array`.

---

## 7. Memory buffers

A memory buffer wraps a region of an `ArrayBuffer` and gives typed
`.get()`/`.set()`/`.at()` access. The buffer's type is inferred from the
descriptor via `DescriptorToMemoryBuffer<T>` — you rarely name it.

### Creating buffers

```ts
const buf = allocate(Vertex);                 // new ArrayBuffer sized to the descriptor
const buf = wrap(Vertex, existingBuffer, 128); // view an existing buffer at a byte offset
```

Every buffer exposes `.type`, `.buffer`, `.offset`, and `.view()`.

### Per-kind API

```ts
// ScalarMemoryBuffer<S>
buf.get(): number;   buf.set(v: number): void;   buf.view(): Float32Array /* etc */

// BoolMemoryBuffer          — get() is `stored uint32 !== 0`
buf.get(): boolean;  buf.set(v: boolean): void;

// VecMemoryBuffer<S,N>
buf.get(): [x,y,…];  buf.set([x,y,…]): void;  buf.at(i): ScalarMemoryBuffer<S>

// MatMemoryBuffer<S,N>      — column-addressed
buf.at(col): VecMemoryBuffer<S,N>;  buf.get(col): [..];  buf.set(col, [..]): void

// ArrayMemoryBuffer<Item,N>
buf.at(i): DescriptorToMemoryBuffer<Item>;  buf.view();  for (const el of buf) { … }

// StructMemoryBuffer<Members>
buf.get(name): <sub-buffer>;   buf.set({ field: value, … }): void;   buf.members
```

`get()` on a vec/mat returns a **detached** plain-number tuple (a snapshot).
`at()`/`get(name)` return **live** sub-buffers over the same memory. `struct.set`
accepts a partial object — only the keys present are written. `DescriptorValueType<T>`
is the plain-value shape a `set()` accepts (numbers/tuples/nested objects).

Vec buffers also expose `getComponent(i)` / `setComponent(i, v)` — single-component
read/write with no tuple allocation.

**Performance note.** These buffers are a *convenience* API over **GPU-layout
(AoS) data** — for packing and uploading, and for access that isn't a per-frame
bottleneck. metis-data is **not** a per-frame hot-iteration library; that's the
ECS's job, with its own SoA layout (see CLAUDE.md "Performance intent"). If a hot
loop genuinely lives on an AoS buffer here, hand-index it directly (one typed
array per scalar type — a single `Float32Array` misreads `u32`/`bool` fields).

---

## 8. Math module

Namespace singletons; every producing op writes into a leading `out` buffer and
returns it (no hidden allocation). The scalar descriptor defaults to `F32`.

```ts
import { Vec2, Vec3, Vec4, Mat2, Mat3, Mat4, Quat } from "metis-data";
```

### Vec2 / Vec3 / Vec4

```ts
Vec3.create(F32, 1, 2, 3)          // allocate + fill (scalar optional, defaults F32)
Vec3.set(out, x, y, z);  Vec3.copy(out, src)
Vec3.add/subtract/multiply/divide(out, a, b)   // component-wise
Vec3.scale(out, v, s);   Vec3.negate(out, v);   Vec3.lerp(out, a, b, t)
Vec3.dot(a, b): number;  Vec3.cross(out, a, b)  // Vec2.cross → scalar (z)
Vec3.length/lengthSquared(v): number
Vec3.distance/distanceSquared(a, b): number
Vec3.normalize(out, v);  Vec3.equals(a, b): boolean
Vec3.transformQuat(out, v, q)      // Vec3 only
```

### Quat (`VecMemoryBuffer<S,4>`, XYZW)

```ts
Quat.identity(F32)                         // [0,0,0,1]
Quat.fromAxisAngle(out, axis, angle)       // radians
Quat.fromEuler(out, x, y, z)               // XYZ order (qX·qY·qZ; matches engine Transform)
Quat.multiply(out, a, b);  Quat.rotateX/Y/Z(out, q, angle)
Quat.normalize/conjugate/invert(out, q)    // conjugate = [−x,−y,−z,w]
Quat.slerp/lerp(out, a, b, t);  Quat.fromRotationTo(out, fromVec3, toVec3)
Quat.dot(a, b): number;  Quat.getAngle(q): number
```

### Mat3 (2D transforms)

```ts
Mat3.translation/scaling(F32, x, y);  Mat3.rotation(F32, angle)   // radians
Mat3.fromTRS(F32, tx, ty, angle, sx, sy)
Mat3.translate/scaleMatrix(out, m, x, y);  Mat3.rotate(out, m, angle)
Mat3.decompose(m) → [tx, ty, angle, sx, sy]
Mat3.getTranslation/getRotation/getScale(m)
Mat3.multiply(out, a, b);  Mat3.invert(out, m);  Mat3.transpose(out, m)
```

### Mat4 (3D transforms)

```ts
Mat4.translation/scaling(F32, x, y, z);  Mat4.fromAxisAngle/fromEuler(F32, …)
Mat4.lookAt(F32, eye, center, up)                       // right-handed, camera looks down −z
Mat4.perspective(F32, fovy, aspect, near, far)          // WebGPU z∈[0,1]; far may be Infinity
Mat4.perspectiveReverseZ(F32, fovy, aspect, near, far?) // near→1, far/∞→0; far defaults ∞
Mat4.orthographic(F32, left, right, bottom, top, near, far)
Mat4.fromTRS(F32, tx, ty, tz, quat, sx, sy, sz)
Mat4.rotate(out, m, quat)
Mat4.decompose(m, outT, outR, outS);  Mat4.toQuat(out, m)
Mat4.getLinearTransform(out3x3, m4x4)                   // upper-left 3×3
```
