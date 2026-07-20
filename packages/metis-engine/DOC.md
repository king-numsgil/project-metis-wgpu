# metis-engine — API reference

Practical API reference for `metis-engine`, written so a task can be started
**without reading the source**. `CLAUDE.md` (this package) explains *why* things
are the way they are — architecture, debugging war stories, known limitations.
This file explains *what to call*.

Everything below (§1–§10) is the **renderer**, exported from `src/renderer/` and
reached as **`metis-engine/renderer`** — the package's subpath export, which is
what `examples/`, `test/`, `bench/`, and `metis-game` import from
(`import { ClusteredForwardRenderer, … } from "metis-engine/renderer"`). The root
`metis-engine` barrel re-exports the renderer as the `Renderer` namespace and the
ECS as `ECS`. The archetype **ECS** (`src/ecs/`, imported as `metis-engine/ecs`)
is separate and covered in §12; it is not yet wired to the renderer.

> **Scope / trust.** Signatures here are transcribed from source. If a task
> depends on an exact signature, spot-check that one symbol. If you change a
> public API, update this file in the same commit (see CLAUDE.md).

---

## 1. Quick start

There are three ways to drive the engine. They differ only in **who owns the
device and the output surface** — the render path is identical in all three.

`RenderContext` is a *convenience bootstrapper*, *not* a dependency. It bundles
four separable jobs (SDL/window lifetime, adapter+device creation, the
surface/swapchain, and `RenderTargets` allocation). The renderer itself knows
nothing about windows: `ClusteredForwardRenderer.render()` needs only a
`GpuDevice`, a `RenderTargets`, and a `Scene`; the post chain needs an output
view + format. If you already own a device and a surface, skip `RenderContext`
entirely — see §1.3.

### 1.1 Windowed (interactive)

```ts
import { SdlEventType, SdlKeycode, sdlPollEvents } from "bun-webgpu-rs";
import { vec3 } from "wgpu-matrix";

// Default present mode is "mailbox" (tear-free, no fifo stall). The FrameLimiter
// paces the loop: new FrameLimiter(0) = uncapped, new FrameLimiter(60) = 60 fps.
const ctx = await RenderContext.createWindowed("title", { width: 1280, height: 720 });
const limiter = new FrameLimiter();
const forward = new ClusteredForwardRenderer(ctx.device);
const post = createDefaultPostProcessPipeline(ctx.device);

const scene = new Scene();
scene.environment = createExteriorEnvironment();
scene.camera.position = vec3.create(0, 2, 6);
scene.camera.target = vec3.create(0, 0, 0);
scene.camera.setAspectFromSize(ctx.width, ctx.height);

scene.add(new Mesh(ctx.device, cube(1, 1, 1), "box"), new Material({ metallic: 0.8, roughness: 0.3 }));
scene.pointLights.push({ position: vec3.create(2, 2, 0), color: [1, 0.9, 0.8], intensity: 8, range: 6 });

let running = true;
while (running) {
    for (const e of sdlPollEvents()) {
        if (e.type === SdlEventType.Quit || e.type === SdlEventType.WindowCloseRequested) running = false;
        if (e.type === SdlEventType.KeyDown && e.keycode === SdlKeycode.Escape) running = false;
    }

    const frame = ctx.beginFrame();
    const encoder = ctx.device.createCommandEncoder();
    forward.render(encoder, ctx.targets, scene);
    post.pipeline.run(encoder, {
        device: ctx.device,
        hdrColorView: ctx.targets.hdrColorResolvedView, // NOT the multisampled view
        depthView: ctx.targets.depthView,
        outputView: frame.view,
        outputFormat: frame.format,
        width: ctx.width,
        height: ctx.height,
        deltaTime: 1 / 60,
    });
    ctx.device.queue.submit([encoder.finish()]);
    frame.present();
    await limiter.wait(); // frame cap (if any) + event-loop yield
}
ctx.destroy();
```

### 1.2 Headless (fixtures, benchmarks, screenshot tests)

Identical, except `RenderContext.createOffscreen({...})`. `beginFrame()` returns
the same offscreen view every frame and `present()` is a no-op, so there is no
vsync. Read the result back from `ctx.captureTexture` (pinned to `rgba8unorm`).

**Auto-exposure adapts over frames** — render ~30 warmup frames before capturing
or the image reflects the first frame's transient.

### 1.3 Caller-owned device and surface (no `RenderContext`)

For an app that already bootstraps its own SDL window, adapter, device, and
surface, construct the engine pieces directly from your `GpuDevice`. **No engine
type needs to own or even see the window.**

`packages/metis-game/src/index.ts` is the working reference for this path —
a 100-light demo that never touches `RenderContext`.

```ts
// ── your bootstrap; the engine touches none of it ────────────────────────
sdlInit(SdlInitFlag.Video);
const wnd = sdlCreateWindow("game", 1440, 768);
const adapter = await requestAdapterForWindow(wnd, { powerPreference: "high-performance" });
const device = await adapter!.requestDevice();
const surface = createSurface(adapter!, wnd);
const fmt = surface.getPreferredFormat();
surface.configure(device, { width: wnd.width, height: wnd.height });

// ── engine: derived from `device` alone ──────────────────────────────────
const targets = new RenderTargets(device, wnd.width, wnd.height);
const forward = new ClusteredForwardRenderer(device);
const post = createDefaultPostProcessPipeline(device);
// const hud = new VectorText(device, fmt);   // optional; wants the OUTPUT format

// ── per frame ────────────────────────────────────────────────────────────
const frame = surface.getCurrentTexture();
if (frame.suboptimal) surface.configure(device, { width: wnd.width, height: wnd.height });

const encoder = device.createCommandEncoder();
forward.render(encoder, targets, scene);
post.pipeline.run(encoder, {
    device,
    hdrColorView: targets.hdrColorResolvedView, // resolved, NOT hdrColorMultisampledView
    depthView: targets.depthView,
    outputView: frame.createView(),
    outputFormat: fmt,                          // surface.getPreferredFormat()
    width: wnd.width,
    height: wnd.height,
    deltaTime: dt,
});
device.queue.submit([encoder.finish()]);
frame.present();                                // after submit
```

Two responsibilities `RenderContext` would otherwise have handled for you:

- **Resize.** On window resize, call `surface.configure(...)` **and**
  `targets.resize(device, w, h)`, and `scene.camera.setAspectFromSize(w, h)`.
  Forget the middle one and the forward pass keeps drawing at the old size.
- **Teardown.** Destroy in dependency order: `forward.destroy()`,
  `post.pipeline.destroy()`, `hud?.destroy()`, `targets.destroy()`, then your
  own `device.destroy()` / `wnd.destroy()` / `sdlQuit()`.

Both consumers of the **output** format want your swapchain's format, never
`HDR_COLOR_FORMAT` — they write the final target, after the tonemap.
`VectorText` takes it in its constructor; the post-process passes receive it
per-frame as `outputFormat` on the frame context.

---

## 2. Non-negotiable invariants

Getting any of these wrong produces a plausible-looking but wrong image.

| Rule | Consequence if broken |
|---|---|
| Triangles wind **CCW seen from the outside**; the forward pipeline culls back faces. | Lights appear on the wrong side, specular vanishes (the `uvSphere` bug — CLAUDE.md). |
| Post-process reads `targets.hdrColorResolvedView`, never `hdrColorMultisampledView`. | Validation error or garbage. |
| **Depth is reverse-Z.** Any pipeline writing the main depth buffer uses `depthCompare: "greater"` + `depthClearValue: 0.0`. | Depth sorts backwards — far geometry paints over near. |
| Anything *reading* the main depth buffer tests background as `depth <= 0.0` (not `>= 1.0`). | Background/foreground inverted (e.g. auto-exposure meters the empty sky and blows out). |
| The **shadow** pass is orthographic and stays standard-Z (`"less"`, clear `1.0`). Do not "fix" it for consistency. | Shadows invert; the MSM reconstruction assumes `[0,1]` support. |
| `Environment.sunDirection` is the direction light **travels** (sun → scene), normalized. | Sun lights the wrong side. |
| Point lights contribute nothing past `range`; the shader's falloff window matches the cull sphere. | Lights pop at cluster edges. |
| **`bun-webgpu-rs` never throws on WebGPU validation errors** — they print to stderr as `[wgpu] uncaptured error:` and execution continues with garbage. | A script "succeeds" having rendered nothing. Grep output for `wgpu`, or wrap a frame in `pushErrorScope("validation")` / `await popErrorScope()`. |
| WGSL has no `#include`; shaders are built by string-concatenating `common.wgsl` + the pass's file. | Missing symbols. |

---

## 3. `rhi/` — device, surface, targets

### `RenderContext` — optional

A bootstrapper for the common cases (§1.1, §1.2), bundling SDL/window lifetime,
adapter + device creation, the surface, and a `RenderTargets`. Nothing in the
render path requires it — if you own a device and a surface already, construct
`RenderTargets` yourself and skip this class (§1.3).

```ts
interface RenderContextOptions {
    width: number;
    height: number;
    powerPreference?: "low-power" | "high-performance";
    backend?: "vulkan" | "dx12" | "metal" | "gl";
    label?: string;
    presentMode?: GPUPresentMode; // windowed only; omit → binding default "mailbox"
    profiling?: boolean;          // request the timestamp-query features GpuProfiler needs (§10)
}

static createWindowed(title: string, options: RenderContextOptions): Promise<RenderContext>
static createOffscreen(options: RenderContextOptions): Promise<RenderContext>

readonly device: GpuDevice;
readonly adapter: GpuAdapter;      // .info.description = human-readable GPU name
readonly targets: RenderTargets;
width: number; height: number;

get sdlWindow(): SdlWindow | null;
get isWindowed(): boolean;
get outputFormat(): GPUTextureFormat;   // swapchain preferred format (cached), or "rgba8unorm" offscreen
get captureTexture(): GpuTexture | null; // offscreen only; read back with takeScreenshot

beginFrame(): FrameTarget;  // { view, format, present() } — call present() AFTER queue.submit()
resize(width: number, height: number): void;
destroy(): void;
```

Present mode defaults to `"mailbox"` (tear-free, and free of the periodic
`getCurrentTexture()` stall that native `"fifo"`/`"auto-vsync"` show on some
Vulkan drivers). `"immediate"` also disables vsync and is useful for raw frame
timing, since under `"fifo"` the present wait lands inside `getCurrentTexture()`
and the work-done wait, polluting measurements. See `bench/lights.ts`.

### `FrameLimiter`

Software frame-rate cap — the "vsync on" knob, since `mailbox` is tear-free but
uncapped. Construct with a target fps (`0` = uncapped) and `await limiter.wait()`
once per frame after `present()`; it sleeps + busy-spins the tail for jitter-free
pacing, and yields to the event loop even when uncapped. Prefer this over native
`fifo` for a cap. When benchmarking, call `wait()` *after* the GPU-timing
readback so the cap never pollutes the measurement.

```ts
const limiter = new FrameLimiter(Number(process.env.METIS_FPS) || 0);
// ... per frame, after frame.present():
await limiter.wait();
```

### `RenderTargets`

The HDR color + depth attachments the forward pass draws into. `RenderContext`
creates one for you as `ctx.targets`; construct it directly
(`new RenderTargets(device, width, height)`) when you own the device (§1.3).

```ts
width, height: number;
hdrColorMultisampled: GpuTexture;  hdrColorMultisampledView: GpuTextureView;  // forward pass draws here (4x MSAA)
hdrColorResolved:     GpuTexture;  hdrColorResolvedView:     GpuTextureView;  // auto-resolved; post reads this
depth:                GpuTexture;  depthView:                GpuTextureView;  // depth32float, 4x MSAA
resize(device, width, height): void;  destroy(): void;
```

Constants: `HDR_COLOR_FORMAT = "rgba16float"`, `DEPTH_FORMAT = "depth32float"`,
`MSAA_SAMPLE_COUNT = 4`. Fixed — changing them means touching every shader.

---

## 4. `scene/` — what to draw

```ts
class Scene {
    camera: Camera;                    // defaults to look-at from (0,0,5)
    environment: Environment;          // defaults to createExteriorEnvironment()
    instances: SceneInstance[];
    pointLights: PointLight[];
    add(mesh: Mesh, material: Material, transform?: Partial<Transform>): SceneInstance;
}

class SceneInstance {
    transform: Transform;
    modelMatrixOverride: Mat4Arg | null;  // bypasses transform (e.g. glTF nodes)
    mesh: Mesh; material: Material;
    destroy(): void;
}
```

### `Mesh`

```ts
new Mesh(device: GpuDevice, data: MeshData, label?: string)
readonly indexCount: number;
readonly boundingRadius: number;  // max |vertex| in local space; the shadow frustum uses this
bind(pass: GpuRenderPassEncoder): void;
draw(pass: GpuRenderPassEncoder, instanceCount = 1): void;
destroy(): void;
```

`MESH_VERTEX_LAYOUT` — the single layout every mesh uses. Stride **48 bytes**:
`position vec3 @0`, `normal vec3 @12`, `tangent vec4 @24` (w = bitangent sign),
`uv vec2 @40`.

### `Material`

```ts
interface MaterialParams {
    baseColor?: [r, g, b, a];        // default [1,1,1,1]
    metallic?: number;               // default 0
    roughness?: number;              // default 0.5
    emissive?: [r, g, b];            // default [0,0,0]
    albedoTexture?, normalTexture?, metallicTexture?, roughnessTexture?, emissiveTexture?: GpuTextureView;
}
new Material(params?: MaterialParams)
destroy(): void;
```

Every material binds **6 texture-ish bindings (1 sampler + 5 textures)** whether
or not you supply them — unset slots fall back to shared 1x1 neutral
placeholders (`getMaterialDefaults`), chosen so sampling them is a no-op against
the factors. This keeps one pipeline for all materials. Textures multiply their
factor: albedo/emissive are sRGB source data, normal/metallic/roughness are
linear; metallic and roughness read the **red channel**.

### `PointLight` / `Environment`

```ts
interface PointLight {
    position: Vec3Arg;
    color: [r, g, b];
    intensity: number;   // same linear units as Environment.sunIntensity
    range: number;       // cull radius; contributes nothing beyond
}

interface Environment {
    sunDirection: Vec3Arg;   // direction light TRAVELS, normalized
    sunColor: [r, g, b]; sunIntensity: number;
    ambientColor: [r, g, b]; ambientIntensity: number;
}
createExteriorEnvironment(overrides?): Environment  // ambientIntensity 0.015
createInteriorEnvironment(overrides?): Environment  // ambientIntensity 0.12
```

Exterior vs. interior is **only** `ambientIntensity` (+ geometry). There is no
`if (interior)` anywhere in the shading code.

### `Camera` / `Transform`

```ts
class Camera {
    position, target, up: Vec3Arg;
    fovYRadians = Math.PI / 4; aspect = 16 / 9;
    near = 0.01;        // cheap to make small: reverse-Z precision is ~z * 2^-24, independent of near
    clusterNear = 2.0;  // light-grid near — deliberately NOT `near`. See below.
    clusterFar = 1000;  // light-culling range only — NOT a clip plane. There is no `far`.
    setAspectFromSize(width, height): void;
    viewMatrix(dst?), projectionMatrix(dst?), viewProjectionMatrix(dst?): Mat4Arg;
}

**`projectionMatrix()` is reverse-Z with an infinite far plane** (`near → ndc.z 1`,
`∞ → 0`, so `ndc.z == near / viewDepth`). There is deliberately **no `far`
field** — the far plane cancels out of `near/z`, so it's infinite for free, and
distant precision doesn't depend on `near` either. Combined with the engine's
`depth32float` buffer this gives ~constant *relative* depth precision
(`gap/z ≈ 2⁻²⁴ ≈ 6e-8`) from centimetres to thousands of kilometres — a
logarithmic depth buffer without `frag_depth` writes. Rationale, measurements,
and what it did *not* break: CLAUDE.md, "Reverse-Z with an infinite far plane".

`clusterNear` / `clusterFar` bound the **clustered light grid**, which needs a
finite depth range to slice exponentially. Neither is a clip plane: geometry
outside them renders normally (lit by sun + ambient); only *point lights* past
`clusterFar` stop being culled into clusters, and so contribute nothing.

**`clusterNear` is deliberately separate from `near`.** Z-slice density is
`CLUSTER_COUNT_Z / log2(clusterFar / clusterNear)`, so the grid wants the
*tightest* range that covers your geometry — while `near` wants to be as small
as reverse-Z allows. Tying them together was costing ~30% of the forward pass:
`near = 0.01` is three orders of magnitude below any real geometry, and those
wasted slices come out of the range that matters.

Geometry closer than `clusterNear` is **still lit correctly** — slice 0 is a
catch-all whose AABB extends down to the true `near` — it just shades more
lights than it needs, since slice 0 is a fat bucket. Set `clusterNear` to about
the closest distance at which you have many lights and care about culling
precision.

Tuning both: it is the **ratio** that matters, and the near end is usually where
the slack is. Raising `clusterFar` *lowers* density (200 -> 1000 measured 1.38 ->
1.53 ms on the 200-light bench); lowering it helps only slightly and costs you
distant lights. See CLAUDE.md, "What the forward pass actually costs".

```ts
interface Transform { position: Vec3Arg; rotationEuler: Vec3Arg; scale: Vec3Arg }
createTransform(overrides?: Partial<Transform>): Transform
transformToMat4(t, dst?): Mat4Arg          // T * Rx * Ry * Rz * S
normalMatrixFromModel(model, dst?): Mat3Arg // inverse-transpose upper 3x3
```

---

## 5. `shading/` — the renderer

```ts
class ClusteredForwardRenderer {
    constructor(device: GpuDevice)
    readonly ao: AmbientOcclusion;
    shadowDistance: number;       // far reach of the cascaded shadows (default 400)
    cascadeSplitLambda: number;   // practical-split blend, 1=log 0=uniform (default 0.85)
    readonly frameBindGroupLayout, materialBindGroupLayout, modelBindGroupLayout: GpuBindGroupLayout;
    render(encoder: GpuCommandEncoder, targets: RenderTargets, scene: Scene): void;
    destroy(): void;
}
```

**Directional shadows are a 4-cascade CSM** (hybrid: cascade 0 = Moment Shadow
Mapping, cascades 1–3 = depth + hardware PCF). You get correct shadows across a
wide depth range without tuning — crisp near, coarser-but-attached far, no bleed.
Two knobs:

- **`shadowDistance`** (default 400) — how far shadows reach, in world units. The
  4 cascades subdivide `[camera.near, shadowDistance]`, so set it to the distance
  shadows stay legible, not to the horizon: a needlessly large value coarsens
  *every* cascade. Geometry beyond it renders fully sunlit. For a planetary scene
  this is what keeps the cascades on the near surface instead of trying (and
  failing) to span to the Moon.
- **`cascadeSplitLambda`** (default 0.85) — biases resolution toward the camera.
  `1` = fully logarithmic (tightest near cascade), `0` = uniform. Raise it if near
  shadows aren't crisp enough; lower it if the far cascade is starved.

Fixed internals: `SHADOW_MAP_SIZE = 2048` per cascade; VRAM ≈ 184 MB (cascade 0's
MSM moments + MSAA depth dominate). The per-cascade bias is texel-scaled
automatically. Cascade boundaries cross-fade, so there's no visible seam.
`shadowDistance` is the replacement for the old `shadowRadius` (CSM supersedes the
single camera-clamped map). See CLAUDE.md "Cascaded shadow maps" for the design.

`render()` records, in order, every frame:

1. Write camera + environment uniforms.
2. Write cluster params + pack the point-light array.
3. **Cascaded shadow passes** (`cullMode: "none"`): cascade 0 = 4x-MSAA depth → moment resolve (→ `rgba32float` E[z]..E[z⁴]); cascades 1–3 = single-sample depth into a `depth_2d_array` layer each.
4. **Cluster build** (compute) — per-cluster view-space AABBs.
5. **Light cull** (compute) — sphere-vs-AABB, writes per-cluster light index lists.
6. **AO** — `clearToWhite` if `technique === None`, else prepass + SSAO/HBAO + blur.
7. **Forward pass** — one draw per `SceneInstance`, bind groups `0=frame 1=material 2=model 3=cluster-lights`.

Everything is internal; there are **no per-pass GPU timestamp hooks**. To time
passes you'd have to thread `timestampWrites` into the private passes.

### Cluster configuration (`clusterConfig.ts`)

```ts
CLUSTER_COUNT_X = 16; CLUSTER_COUNT_Y = 9; CLUSTER_COUNT_Z = 24;
NUM_CLUSTERS = 3456;              // X*Y*Z
MAX_LIGHTS_PER_CLUSTER = 96;      // per-cluster capacity cap
MAX_POINT_LIGHTS = 384;           // per-scene cap (excess is dropped with a console.warn)
COMPUTE_WORKGROUP_SIZE = 64;
```

The grid's depth range is `[camera.near, camera.clusterFar]`, **not** a projection
far plane (there isn't one — see §4). The cluster math works entirely in
*view space* (`clusterZIndex` takes linear `-viewZ`), which is why it is
completely independent of the reverse-Z depth convention.

**`MAX_LIGHTS_PER_CLUSTER` is a hard cap, enforced by dropping lights.** When
more than that many lights overlap one cluster, the cull loop `break`s and the
rest are silently skipped for that cluster. With animated lights this reads as
tile-shaped popping/flicker. It is *not* an out-of-bounds bug — the shaders are
correctly bounded — it is capacity. This is the first thing to suspect for
tile-shaped artifacts at high light counts.

**The two caps are coupled** — raising `MAX_POINT_LIGHTS` without also raising
this one silently drops light. Peak per-cluster occupancy on `bench/lights.ts`
(a deliberately dense field) runs at roughly a fifth of the scene's light count,
so the old 256/64 pair was self-consistent but 384 lights would have overflowed
64. Measure occupancy before raising one alone: render `lightCountInCluster`
from `forward.wgsl` and read it back.

Cost is allocation only — `NUM_CLUSTERS × cap × 4 bytes`, and it dominates the
clustering budget. Neither cap affects render time: the cull loops over the
*actual* light count and the forward pass over the *actual* per-cluster count.

Z-slicing is exponential (Doom 2016): slice `z` spans view depth
`[zNear·(zFar/zNear)^(z/countZ), …^((z+1)/countZ))`. The fragment-side lookup in
`common.wgsl` is its exact algebraic inverse.

### `Std140Writer`

Hand-rolled uniform/storage packing. `vec3` pads to 16 bytes and the `w` argument
fills that padding slot (so `{ vec3, f32 }` is 16 bytes, not 32). `mat4` = 4 vec4
columns; `mat3` = 3 padded columns.

```ts
new Std140Writer().mat4(m).vec3(v, w).vec4(x,y,z,w).vec4u(x,y,z,w).f32(x).u32(x).vec2(x,y).mat3(m).toBytes(): Uint8Array
```

---

## 6. `ao/` — ambient occlusion

```ts
enum AoTechnique { None = "none", SSAO = "ssao", HBAO = "hbao" }

renderer.ao.technique = AoTechnique.HBAO;  // runtime-switchable
renderer.ao.radius; .bias; .intensity; .power;  // reseeded from defaults on technique change
```

`SSAO_DEFAULTS = { radius: 0.5, bias: 0.025, intensity: 1.0, power: 1.5 }`
`HBAO_DEFAULTS = { radius: 0.5, bias: 0.1,   intensity: 1.0, power: 1.5 }`
`SSAO_KERNEL_SIZE = 32`, `HBAO_DIRECTIONS = 6`, `HBAO_STEPS = 4`, `AO_NOISE_DIM = 4`.

AO multiplies **only the flat ambient term** — never sun or point lights (their
occlusion is the shadow map's job). `None` is branchless: the buffer is cleared
to white so the forward multiply is a no-op.

Pure helpers (CPU, unit-tested): `mulberry32(seed): () => number`,
`generateSsaoKernel(count, seed = 1): Float32Array`,
`generateAoNoise(dim, seed = 2): Float32Array`.

---

## 7. `postprocess/`

```ts
createDefaultPostProcessPipeline(device): {
    pipeline: PostProcessPipeline;
    exposure: ExposureState; luminance: LuminanceAveragePass;
    autoExposure: AutoExposurePass; tonemap: TonemapPass;
}
pipeline.run(encoder, ctx: PostProcessFrameContext): void;
pipeline.destroy(): void;

interface PostProcessFrameContext {
    device: GpuDevice;
    hdrColorView: GpuTextureView;  // targets.hdrColorResolvedView
    depthView: GpuTextureView;     // used to exclude background from metering
    outputView: GpuTextureView; outputFormat: GPUTextureFormat;
    width: number; height: number; deltaTime: number;
}
```

Chain: measure luminance → adapt exposure → ACES filmic tonemap. Extend it by
implementing `PostProcessPass { name, execute(encoder, ctx), destroy?() }` and
constructing your own `new PostProcessPipeline([...])`.

---

## 8. `assets/` — geometry, textures, glTF

```ts
interface MeshData { vertices: Float32Array; indices: Uint32Array }

plane(width, depth): MeshData                                   // single quad on XZ, faces +Y
cube(sx, sy, sz): MeshData                                      // outward normals
uvSphere(radius, latBands = 24, lonBands = 32): MeshData
roomBox(width, height, depth, window: WindowCutout, thickness = 0.2): MeshData

interface WindowCutout { s0, s1, t0, t1 }  // fractions [0,1] of the -Z wall's width/height
```

`roomBox` builds **solid slabs**, not zero-thickness quads. That thickness is
load-bearing for shadow correctness (zero-thickness occluders make occluder and
receiver depths coincide at a shared edge, which no shadow-map representation can
resolve). Prefer closed/thick meshes for anything casting interior shadows.

```ts
loadTexture(device, path, options?: { srgb?: boolean; label?: string }): Promise<{ texture, view }>
getMaterialDefaults(device): MaterialDefaults   // cached per device (WeakMap)
loadGltf(device, gltfPath): Promise<SceneInstance[]>
```

`srgb: true` for colour data (albedo, emissive), `false`/omitted for data maps
(normal, metallic, roughness). Decode + upload happen in Rust; pixels never cross
the FFI boundary, and concurrent loads decode in parallel.

`loadGltf` is a **deliberately narrow** reader: separate `.gltf` + `.bin` only
(no `.glb`, no embedded base64), `f32` POSITION/NORMAL/optional TEXCOORD_0,
`u16`/`u32` indices. No TANGENT (fabricates one), ignores glTF material textures
(factors only). Skinning/morph/sparse accessors throw.

---

## 9. `text/` — HUD

```ts
const hud = new VectorText(device, ctx.outputFormat);
hud.loadFont("mono", absolutePathToTtf);
hud.drawText(text, "mono", sizePx, x, y);      // y is the baseline, y-down from top-left
hud.render(encoder, frame.view, width, height, paint = [1,1,1,1], loadOp = "load");
hud.destroy();
```

Call `render()` **after** the post-process chain so text composites on top
(`loadOp: "load"`). `drawText` already calls the underlying `fill()`; `render()`
no-ops if nothing was staged.

**`paint` is one colour or a palette.** Pass a single `Rgba` and everything is
that colour. Pass an array and each draw call is painted with `palette[id]`,
where `id` is whatever `context.setId(id)` was set to when the geometry was
staged (ids at or past the palette length fall back to slot 0;
`MAX_PALETTE_COLORS` = 64):

```ts
hud.context.setId(0); hud.drawText("ok",  "mono", 12, 10, 20);
hud.context.setId(1); hud.drawText("bad", "mono", 12, 10, 40);
hud.render(encoder, view, w, h, [[0,1,0,1], [1,0,0,1]]);   // green, red
```

Colours are **linear**, and `render()` targets the tonemapped output — don't draw
into the HDR target or ACES will wash them out.

```ts
hud.renderCached(encoder, view, width, height, loadOp = "load");

hud.profiler = myProfiler;        // opt in to the GPU profiler tree (§10)
hud.profileLabel = "hud-text";    // name the span; set per instance
```

Re-draws the last `render()`'s geometry **without re-tessellating**. `drawText`
costs 100 microseconds+ per string (see `bun-webgpu-rs/DOC.md` §9), so a HUD that
re-stages every frame can cost more than the scene. Only valid if nothing has
been staged since the last `render()`. `DebugOverlay` (§10) automates this.

---

## 10. `debug/` — profiler + widgets

Opt-in, off by default, and nothing here runs unless you wire it.

### `DebugOverlay` — graph + tree widgets

```ts
const debug = new DebugOverlay(device, ctx.outputFormat);
debug.loadFont("mono", absolutePathToTtf);

// Per frame, after the post chain has written frame.view:
if (debug.due()) {                       // throttles re-staging; see below
    debug.graph({ x, y, width, height, title: "frame time", unit: "ms",
                  series: [{ label: "gpu", values: gpuHistory }] });
    debug.tree({ x, y, width, title: "GPU passes", rows });
    debug.label("some text", x, y);
}
debug.render(encoder, frame.view, width, height);
debug.destroy();
```

- `graph(spec)` — line plot of one or more series over a shared Y axis. `values`
  is a `number[]` or a `History`. Omit `max` to autoscale.
- `tree(spec)` — hierarchical rows with indent guides, a proportional bar
  (`fraction` 0..1) and a right-aligned `value` string. Height is derived from
  the row count.
- `label(text, x, y, color?, fontSize?)` — plain text.
- `debug.profiler = myProfiler` — puts the overlay's own draw pass into the
  profiler tree (as `debug-overlay`). Forwards to the underlying `VectorText`.
- `History(capacity)` — rolling sample buffer (`push`, `values()`, `mean`, `max`,
  `latest`), the shape `graph` plots.
- `DEBUG_THEME` — default colours (`panel`/`border`/`grid`/`text`/`good`/`warn`/
  `bad`/`series[]`).

**`due()` is load-bearing, not optional.** Staging tessellates every glyph;
`due()` returns true at most every `rebuildIntervalMs` (default 100), and
`render()` replays the previous geometry on the frames it returns false.
Measured on `bench/lights.ts --profile`: ~20 ms -> ~5.4 ms mean CPU encode. Stage
unconditionally only if a widget must be frame-exact.

### `GpuProfiler` — per-pass GPU timing

```ts
// 1. The device must enable the features (RenderContext does it with profiling: true,
//    or filter them yourself for a caller-owned device):
const device = await adapter.requestDevice({ requiredFeatures: gpuProfilerFeatures(adapter) });

// 2. null if the device has no timestamp-query — always handle it.
const profiler = GpuProfiler.create(device);
if (profiler) renderer.profiler = profiler;   // nothing is measured until this is set

// 3. Per frame, around your own encoder:
profiler?.beginFrame(encoder);
renderer.render(encoder, targets, scene);
post.pipeline.run(encoder, { ..., profiler: profiler ?? undefined });
profiler?.endFrame(encoder);                  // BEFORE submit
device.queue.submit([encoder.finish()]);

// 4. Read results (a few frames stale) and show them:
debug.tree({ x, y, width, title: `GPU — ${profiler.frameTotalMs.toFixed(3)} ms`,
             rows: profileSpansToRows(profiler.spans, profiler.frameTotalMs) });
```

| Member | Meaning |
|---|---|
| `spans: ProfileSpan[]` | `{ label, gpuMs, children }` tree for the last completed frame |
| `frameTotalMs` | measured whole-frame span, or the sum of passes if unavailable |
| `canProfileDraws` | `timestamp-query-inside-passes` — per-draw zones under each pass |
| `canProfileFrameTotal` | `timestamp-query-inside-encoders` — a real total incl. gaps between passes |
| `beginFrame(encoder)` / `endFrame(encoder)` | frame bracket; `endFrame` must precede `submit` |
| `beginZone(pass, label)` / `endZone(pass)` | manual per-draw zones; no-ops without `canProfileDraws` |
| `destroy()` | releases the query set + readback ring |

**Text passes measure GPU time only.** Setting `profiler` on a `VectorText` or
`DebugOverlay` adds its draw pass to the tree, but that pass is a few thousand
triangles and reads as a rounding error. The expensive part of text —
`drawText`'s glyph transform + buffer staging — is **CPU** work done before any
command is encoded, so it is invisible to timestamp queries and shows up in CPU
encode instead. A near-zero `debug-overlay` span does not mean the HUD is free.

`gpuProfilerSupport(adapter)` reports the three tiers; `gpuProfilerFeatures(adapter)`
returns exactly the supported ones to pass to `requiredFeatures` (requesting an
unsupported feature fails `requestDevice`).

**Results lag the live frame by ~2-3 frames** — readback is ring-buffered
(`RING_SIZE` 3) so it never stalls the pipeline. That's the point: blocking to
read this frame's timings would distort the timings.

**Three tiers, degrading cleanly.** With only `timestamp-query` you get per-pass
timing and a summed total; `+inside-encoders` gives a measured total that
includes the gaps between passes; `+inside-passes` adds per-draw zones nested
under `forward`. Every tier is checked against the **device**, not the adapter —
a feature the adapter supports but the caller never requested would be a
validation error, which this binding only prints to stderr.

`profileSpansToRows(spans, totalMs)` converts the tree into `tree()` rows,
grading each span green -> amber -> red by its share of the frame (a span that
*is* the whole frame stays neutral).

---

## 11. Commands

```powershell
bun run fixture          # headless render + screenshot validation -> test/output/*.png
bun run demo:exterior    # interactive; WASD+QE fly, arrows look, P profiler, Esc quit
bun run demo:interior    # + O cycles AO technique
bun run bench:lights     # windowed light benchmark (see bench/lights.ts header for flags)
bunx tsc --noEmit        # type-check
```

There is no `bun test` suite for the whole package; `test/fixture.ts` is the
automated check, `test/ao.test.ts` covers the AO kernels + a GPU-readback
assertion, `test/clusterNear.test.ts` pins that geometry nearer than
`clusterNear` keeps its lights, `test/debugWidgets.smoke.ts` asserts the
profiler's per-pass timings are non-zero and renders both widgets, and
`test/vectorText.smoke.ts` covers text + the colour palette. Run them manually.

`bench/lights.ts` flags: `--lights N` (≤256), `--duration S`, `--warmup S`,
`--width`, `--height`, `--fps N` (`--vsync` = `--fps 60`), `--profile` (per-pass
GPU timings + widgets). Uncapped by default so timings are real; the cap is
applied after GPU timing, so it never skews numbers.

**The demos and the bench use `presentMode: "immediate"`** — tearing doesn't
matter for development, and it keeps present back-pressure out of
`getCurrentTexture()` where it would skew frame timing. The engine/binding
default is still `"mailbox"`, which is the right default for a real app.

---

## 12. `ecs/` — archetype ECS (Structure-of-Arrays)

Imported from **`metis-engine/ecs`** (or the `ECS` namespace off the root barrel).
This is **storage only** — no systems, no scheduler, and **no renderer
integration**: the renderer still takes a hand-built `Scene` (§4), and nothing
extracts one from ECS data yet. It has **no `metis-data` dependency** — component
fields are a small ECS-local type vocabulary, and storage is SoA (see below).

**Model.** Entities sharing the same *set of component names* live in one
`Archetype`. Within it, every component field is its own **typed-array column**
indexed by a dense row — a scalar is one column, a vec is one column per axis. So
a system touches data as a bare `column[row]` index (fast, cache-friendly, typed).
`getComponent` is a random-access accessor for a single entity; `query` is the
per-archetype fast path for systems.

```ts
import { defineComponent, f32, u32, vec3, World } from "metis-engine/ecs";

const world = new World({
    Position: defineComponent("Position", { pos: vec3(f32) }),
    Velocity: defineComponent("Velocity", { vel: vec3(f32) }),
    Tags:     defineComponent("Tags", { bits: u32 }),
});

const e = world.spawnEntity("Position", "Velocity", "Tags");  // -> EntityId (number)
world.getComponent(e, "Position").pos.x = 1.5;                // settable scalars / {x,y,z}
world.getComponent(e, "Tags").bits = 0b0011;

// Fast path: once per matching archetype, with typed SoA columns + dense count.
const dt = 1 / 60;
world.query(["Position", "Velocity"], (cols, count) => {
    const px = cols.Position.pos.x, vx = cols.Velocity.vel.x;
    for (let i = 0; i < count; i++) px[i] += vx[i] * dt;
});

for (const id of world.queryEntities(["Position", "Velocity"])) { /* ... */ }
world.despawnEntity(e);
```

### Field types

Scalars `f32 f64 i32 u32 i16 u16 i8 u8` (each → its TypedArray) and vectors
`vec2(scalar) vec3(scalar) vec4(scalar)`. A component schema is a record of them:
`{ pos: vec3(f32), hp: f32, flags: u32 }`.

### `defineComponent` / `World`

```ts
defineComponent<S>(name: string, schema: S): ComponentDef<S>   // schema = Record<field, f32 | vec3(f32) | …>

class World<R extends Registry> {                              // R = Record<name, ComponentDef>
    constructor(registry: R)
    get entityCount(): number;  get archetypeCount(): number;
    spawnEntity(...componentNames: (keyof R & string)[]): EntityId;   // fields zero-initialised
    despawnEntity(id: EntityId): void;
    getComponent(id, name): ComponentAccessor;                  // random access: `.field = n`, `.vec.x = n`
    query(names, (cols, count, entityIds) => void): void;       // per-archetype SoA columns — the fast path
    queryEntities(names): IterableIterator<EntityId>;
    iterArchetypes(): IterableIterator<Archetype>;
}
```

`query` runs `run` once per archetype that has **all** the named components. `cols`
is keyed by component then field: a scalar field is a `TypedArray` (`cols.Tags.bits[i]`),
a vec field is `{ x, y, z }` typed arrays (`cols.Position.pos.x[i]`). **Do not
spawn/despawn while a `query` is running** — structural changes reallocate/reorder
the current archetype's columns and rows.

### Debug helpers (`debug.ts`)

`inspectWorld(world)` / `printWorldInfo(world)` — per-archetype entity counts,
capacity, and the per-component column layout (field, kind, axis count,
bytes/entity). `src/ecs/test.ts` is a manual smoke script (`bun run src/ecs/test.ts`);
`src/ecs/test/ecs.test.ts` is the automated `bun test` suite.

### Sharp edges (current, deliberate)

| Thing | State |
|---|---|
| `EntityId` | a bare incrementing `number` — **no generation tag**; not reused today (no free list), but that's not a safety guarantee. |
| `query` / `queryEntities` | match archetypes that are a **superset** of the requested names. **No `Without`/exclusion** filter yet. |
| `despawnEntity` | swap-with-last, so an entity's dense row index is **not stable** across despawns (columns get reordered). |
| Buffers | each column doubles on overflow (`INITIAL_CAPACITY = 32`); no shrink. |
| Hierarchy / systems | none — no `ChildOf`/`Children`, no transform propagation, no scheduler. |
| GPU extract | not built — SoA→AoS interleaving for upload (where `metis-data` re-enters) is future work. |
