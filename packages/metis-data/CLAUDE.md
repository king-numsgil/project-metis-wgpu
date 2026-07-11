# metis-data — Package Guide

## What This Is

The type system and math library for GPU memory in Metis. Nothing here talks to the GPU directly — it describes memory layouts and provides typed access to `ArrayBuffer` objects.

Three concerns live in this package:
1. **Descriptors** — objects that encode the byte size, alignment, and packing of a GPU-compatible type.
2. **Memory buffers** — typed wrappers that read/write a specific region of an `ArrayBuffer` according to a descriptor.
3. **Math** — Vec2/3/4, Mat2/3/4, Quat implemented as operations over memory buffers.

---

## Packing Strategies

Every composite descriptor takes an optional `PackingType` parameter (default: `Dense`).

```typescript
enum PackingType {
    Dense   = 0,   // tightly packed (scalar alignment) — vertex/index buffers
    Std140  = 1,   // std140 uniform-block layout — @group uniform bindings
}
```

| Type | Dense alignment | Dense byteSize | Std140 alignment | Std140 byteSize | Std140 arrayPitch |
|------|----------------|----------------|-------------------|------------------|-------------------|
| `Vec2<F32>` | 4 | 8 | 8 | 8 | 16 |
| `Vec3<F32>` | 4 | 12 | 16 | **12** | 16 |
| `Vec4<F32>` | 4 | 16 | 16 | 16 | 16 |
| `Mat4<F32>` | 4 | 64 | 16 | 64 | 64 |
| `Array(Vec3<F32>, 10)` | 4 | 120 | 16 | 160 | 160 |

**Rule of thumb:** vertex attributes → Dense; `@group` uniform bindings → Std140.
Storage-buffer (std430) layout is not covered yet — a `Std430` mode is TODO.

**Size vs. stride:** a Std140 `byteSize` is the *unpadded* extent (`Vec3<F32>` is 12,
so a trailing scalar packs into offset 12 — `{ vec3, f32 }` is 16 bytes, not 32).
Only *alignment* (placement) and *arrayPitch* (array element stride, always a
multiple of 16) get padded.

**Packing is not inherited.** Each descriptor's packing is frozen when it is built,
so a `Std140` struct *validates* its composite members and throws if any was left
`Dense`. Always pass `PackingType.Std140` to every member as well as to the struct.

---

## Scalar Descriptors

Singleton constants. Import and use directly.

```typescript
import { Bool, I32, U32, F16, F32, F64 } from "metis-data";
```

| Constant | TypedArray | byteSize | alignment |
|----------|-----------|---------|-----------|
| `Bool` | `Uint32Array` | 4 | 4 |
| `I32` | `Int32Array` | 4 | 4 |
| `U32` | `Uint32Array` | 4 | 4 |
| `F16` | `Float16Array` | 2 | 2 |
| `F32` | `Float32Array` | 4 | 4 |
| `F64` | `Float64Array` | 8 | 8 |

---

## Vector Descriptors

```typescript
function Vec<S extends ScalarDescriptor, N extends 2 | 3 | 4>(
    scalar: S,
    n: N,
    packing?: PackingType,
): VecDescriptor<S, N>
```

```typescript
const pos  = Vec(F32, 3);               // Dense Vec3<f32>
const upos = Vec(F32, 3, PackingType.Std140); // Std140 Vec3<f32>
```

`VecDescriptor` properties: `type` (`"vec2" | "vec3" | "vec4"`), `scalar`, `length`, `byteSize`, `alignment`, `arrayPitch`.

---

## Matrix Descriptors

```typescript
function Mat<S extends ScalarDescriptor, N extends 2 | 3 | 4>(
    scalar: S,
    n: N,
    packing?: PackingType,
): MatDescriptor<S, N>
```

Stored **column-major**. `MatDescriptor` adds `column` (a `VecDescriptor`) and `columnStride`.

```typescript
const mvp = Mat(F32, 4, PackingType.Std140);
// columnStride = 16, byteSize = 64, alignment = 16
```

Access a column's typed view:
```typescript
desc.col(buffer, offset, colIndex);  // → Float32Array of that column
```

---

## Array Descriptors

```typescript
function ArrayOf<Item extends Descriptor<any>, N extends number>(
    item: Item,
    length: N,
    packing?: PackingType,
): ArrayDescriptor<Item, N>
```

```typescript
const joints = ArrayOf(Mat(F32, 4, PackingType.Std140), 64);
// byteSize = 64 * 64 = 4096
```

`ArrayDescriptor` adds `offsetAt(index): number` and `at(buffer, offset, index)`.

---

## Struct Descriptors

```typescript
function StructOf<Members extends Record<string, Descriptor<any>>>(
    members: Members,
    packing?: PackingType,
): StructDescriptor<Members>
```

Members are laid out in definition order. Each member is aligned to its own alignment; the struct's total size is rounded up to the maximum member alignment.

```typescript
const VertexDesc = StructOf({
    position: Vec(F32, 3),
    uv:       Vec(F32, 2),
    normal:   Vec(F32, 3),
});
// Dense: pos@0(12), uv@12(8), normal@20(12) → byteSize=32

const Std140Desc = StructOf({
    mvp:   Mat(F32, 4, PackingType.Std140),
    color: Vec(F32, 4, PackingType.Std140),
}, PackingType.Std140);
// mvp@0(64), color@64(16) → byteSize=80, alignment=16
```

`StructDescriptor` adds `offsetOf(name): number` and `member(buffer, offset, name)`.

---

## Memory Buffers

A memory buffer wraps a region of an `ArrayBuffer` and provides typed `.get()` / `.set()` / `.at()` access. The generic parameter tracks which descriptor the buffer was created from.

### Creating Buffers

```typescript
// Allocate a new ArrayBuffer sized to the descriptor
const buf = allocate(VertexDesc);

// Wrap an existing ArrayBuffer at a byte offset
const buf = wrap(VertexDesc, existingBuffer, byteOffset);
```

### Buffer Types and Their API

**ScalarMemoryBuffer**
```typescript
buf.get(): number
buf.set(value: number): void
buf.view(): Float32Array    // (or Int32Array, Uint32Array, etc.)
buf.buffer: ArrayBuffer
buf.offset: number
```

**BoolMemoryBuffer**
```typescript
buf.get(): boolean          // true if stored uint32 !== 0
buf.set(value: boolean): void
```

**VecMemoryBuffer\<S, N\>**
```typescript
buf.get(): TupleOf<N, number>           // e.g. [x, y, z] for Vec3
buf.set([x, y, z]: TupleOf<N, number>): void
buf.at(index): ScalarMemoryBuffer<S>    // access individual component
```

**MatMemoryBuffer\<S, N\>**
```typescript
buf.at(colIndex): VecMemoryBuffer<S, N>    // access one column
buf.get(colIndex): TupleOf<N, number>
buf.set(colIndex, value: TupleOf<N, number>): void
```

**ArrayMemoryBuffer\<Item, N\>**
```typescript
buf.at(index): DescriptorToMemoryBuffer<Item>
buf[Symbol.iterator]()                     // for...of support
```

**StructMemoryBuffer\<Members\>**
```typescript
buf.get("position"): VecMemoryBuffer<...>   // returns sub-buffer for that field
buf.set({ position: [0,1,2], uv: [0,0], normal: [0,1,0] })
buf.members: Members
```

### Conditional Types

The type of the buffer returned by `allocate` / `wrap` is inferred automatically via `DescriptorToMemoryBuffer<T>`. You almost never need to name these types explicitly.

```typescript
// TypeScript infers the return type correctly:
const v = allocate(Vec(F32, 3));   // VecMemoryBuffer<F32Descriptor, 3>
v.get();                           // → [number, number, number]
```

---

## Math Module

All math objects are namespace singletons (plain objects with methods). Every mutating operation takes an `out` parameter first and returns it — no hidden allocations.

```typescript
import { Vec2, Vec3, Vec4, Mat2, Mat3, Mat4, Quat } from "metis-data";
```

The scalar descriptor parameter (`scalar?`) defaults to `F32` when omitted.

### Vec2 / Vec3 / Vec4

All three share the same core operations. `Vec3` and `Vec4` add dimension-appropriate extras.

```typescript
Vec3.create(F32, 1, 2, 3)                             // allocate + fill
Vec3.set(out, x, y, z)
Vec3.copy(out, src)
Vec3.add(out, a, b)
Vec3.subtract(out, a, b)
Vec3.multiply(out, a, b)        // component-wise
Vec3.divide(out, a, b)          // component-wise
Vec3.scale(out, v, scalar)
Vec3.dot(a, b): number
Vec3.cross(out, a, b)           // Vec2.cross returns scalar (z-component)
Vec3.length(v): number
Vec3.lengthSquared(v): number
Vec3.distance(a, b): number
Vec3.distanceSquared(a, b): number
Vec3.normalize(out, v)
Vec3.negate(out, v)
Vec3.lerp(out, a, b, t)
Vec3.equals(a, b): boolean
Vec3.transformQuat(out, v, q)   // Vec3 only
```

### Quat

Operates on `VecMemoryBuffer<S, 4>` with XYZW component layout.

```typescript
Quat.identity(F32)                         // [0, 0, 0, 1]
Quat.fromAxisAngle(out, axis, angle)       // angle in radians
Quat.fromEuler(out, x, y, z)              // XYZ order (qX·qY·qZ; matches engine Transform)
Quat.multiply(out, a, b)
Quat.rotateX/Y/Z(out, q, angle)
Quat.normalize(out, q)
Quat.conjugate(out, q)                     // [−x, −y, −z, w]
Quat.invert(out, q)
Quat.slerp(out, a, b, t)
Quat.lerp(out, a, b, t)
Quat.fromRotationTo(out, fromVec3, toVec3)
Quat.dot(a, b): number
Quat.getAngle(q): number
```

### Mat3 (2D transforms)

```typescript
Mat3.translation(F32, x, y)
Mat3.rotation(F32, angle)          // radians
Mat3.scaling(F32, x, y)
Mat3.fromTRS(F32, tx, ty, angle, sx, sy)
Mat3.translate(out, m, x, y)
Mat3.rotate(out, m, angle)
Mat3.scaleMatrix(out, m, x, y)
Mat3.decompose(m)                  // → [tx, ty, angle, sx, sy]
Mat3.getTranslation(m)             // → [x, y]
Mat3.getRotation(m)                // → angle
Mat3.getScale(m)                   // → [x, y]
Mat3.multiply(out, a, b)
Mat3.invert(out, m)
Mat3.transpose(out, m)
```

### Mat4 (3D transforms)

```typescript
Mat4.translation(F32, x, y, z)
Mat4.fromAxisAngle(F32, axis, angle)
Mat4.fromEuler(F32, x, y, z)
Mat4.scaling(F32, x, y, z)
Mat4.lookAt(F32, eye, center, up)                     // right-handed, camera looks down -z
Mat4.perspective(F32, fovy, aspect, near, far)        // WebGPU z∈[0,1]; far may be Infinity
Mat4.perspectiveReverseZ(F32, fovy, aspect, near, far?) // near→1, far/∞→0; far defaults to Infinity
Mat4.orthographic(F32, left, right, bottom, top, near, far) // WebGPU z∈[0,1]
Mat4.fromTRS(F32, tx, ty, tz, quat, sx, sy, sz)
Mat4.rotate(out, m, quat)
Mat4.decompose(m, outTranslation, outRotation, outScale)
Mat4.toQuat(out, m)                // extract rotation quaternion
Mat4.getLinearTransform(out3x3, m4x4)  // extract upper-left 3×3
```

---

## Code Style

**Naming**
- Descriptor factories: `PascalCase` — `Vec`, `Mat`, `ArrayOf`, `StructOf`
- Scalar singleton descriptors: `PascalCase` — `F32`, `U32`, `Bool`, etc.
- Memory buffer functions: `camelCase` — `allocate`, `wrap`
- Math namespace objects: `PascalCase` — `Vec2`, `Mat4`, `Quat`
- Math methods: `camelCase` — `fromAxisAngle`, `lengthSquared`

**Out-first convention**
Every math function that produces a value writes into an `out` parameter and returns it. This is consistent — even `create` takes `(scalar?, ...values)` and allocates internally.

**Default scalar**
All math `create` / factory functions accept an optional scalar descriptor as the first argument. When omitted, `F32` is used. Pass `F64` if you need double precision.

**Generics**
- Scalar type is `S extends ScalarDescriptor` — keeps the TypedArray type correct through the chain.
- Dimension is `N extends 2 | 3 | 4` — a literal number, not just `number`.
- Array length is `N extends number` — unconstrained so any count works.
- The `DescriptorToMemoryBuffer<T>` conditional type maps any descriptor to its buffer type automatically.

**No mutation of descriptors**
Descriptor objects are immutable after creation (`readonly` fields throughout). Compose new descriptors; never mutate existing ones.
