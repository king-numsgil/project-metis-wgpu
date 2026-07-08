# bun-webgpu-rs — Session Notes

## What this project is

A Bun/TypeScript game-engine foundation built on a Rust napi-rs library that exposes:
- **WebGPU** (wgpu 24) — close to the real WebGPU spec so tutorials work
- **SDL3** — windowing, input, timing, cursor, joystick, gamepad

The Rust crate is at the repo root; the generated JS binding is `index.js` / `index.d.ts` (written directly by `napi build`).

---

## Essential commands

```powershell
# Full debug build (Rust → .node + TS types)
npm run build:debug

# Release build
npm run build:release

# Run all tests
bun test

# Run a single test file
bun test tests/render-window.test.ts --timeout 15000

# Type-check without emitting
bunx tsc --noEmit
```

CMake is installed globally — no PATH manipulation needed.

---

## Build environment

- **Platform**: Windows 11 / PowerShell (primary shell)
- **Rust toolchain**: stable
- **napi-rs**: 3.x — uses `#[napi]`, `#[napi(object)]`, `Reference<T>`, async napi fns
- **SDL3**: built from source via `sdl3-sys = { version = "0.6.7", features = ["build-from-source-static"] }` (bundles SDL 3.4.12)
- **SDL3_image**: built from source via `sdl3-image-sys = { version = "0.6.4", features = ["build-from-source-static"] }` (bundles SDL_image 3.4.4); links against the same `sdl3-sys`, no version conflict
- **wgpu**: 24.0.5 with WGSL feature

Cargo cache / sdl3-sys source:
`C:\Users\DarkF\.cargo\registry\src\index.crates.io-1949cf8c6b5b557f\sdl3-sys-0.6.7+SDL-3.4.12\src\generated\`
`…\sdl3-image-sys-0.6.4+SDL-image-3.4.4\src\generated\image.rs`

---

## Source layout

```
src/
  lib.rs          — re-exports everything; edit when adding new public symbols
  gpu/
    instance.rs   — requestAdapter, requestAdapterForWindow
    adapter.rs    — GpuAdapter (holds Arc<Instance> for surface compat)
    device.rs     — GpuDevice, GpuError, pushErrorScope/popErrorScope
    surface.rs    — GpuSurface, GpuSurfaceTexture, createSurface, get_raw_handles
    command_encoder.rs — GpuCommandEncoder + pass encoders + debug groups/markers
    ...
  sdl/
    init.rs       — sdlInit, sdlQuit, sdlGetError, SdlInitFlag enum
    window.rs     — SdlWindow class + all get/set/show/hide/grab methods
    events.rs     — sdlPollEvents, sdlPumpEvents, SdlEventType enum
    keyboard.rs   — SdlScancode enum, SdlKeymod enum, SdlKeyboardState, text input
    mouse.rs      — SdlSystemCursor enum, SdlMouseButton/Mask enums, SdlCursor, sdlGetMouseState
    joystick.rs   — SdlJoyHat enum, SdlJoystick class, sdlGetJoysticks
    gamepad.rs    — SdlGamepadAxis/Button enums, SdlGamepad class, sdlGetGamepads
    debug.rs      — sdlLog, sdlGetPerformanceCounter, sdlGetPerformanceFrequency
  image/
    mod.rs        — SDL3_image file loaders that decode straight into wgpu
                    textures (sdlImageLoadTexture, sdlImageLoadAnimation,
                    ImageColorSpace enum). No pixel bytes cross the napi
                    boundary; file readers only (no *_IO / SDL_IOStream variants)
```

---

## Key design rules

### napi-rs constraints
- `#[napi(object)]` structs: **no `f32` fields** — use `f64`. No `u8`/`i8`/`u16`/`i16` — use wider types.
- Structs with raw pointers (`*mut SDL_Window`, etc.) need `unsafe impl Send + Sync` and a private newtype wrapper.
- `async fn` in `#[napi]` impl blocks must clone `Arc<T>` before the `.await` — don't hold `&self` across an await point.
- To expose a field named `type` in JS, use `r#type` in Rust.

### SDL3 specifics
- `SDL_Event` is a C union — always access via the correct variant field (`.key`, `.motion`, `.jaxis`, etc.).
- Text-input and drop events have `*const c_char` pointers that are valid only until the next `SDL_PollEvent`. Copy them to `String` immediately with `CStr::from_ptr(p).to_string_lossy().into_owned()`.
- Variadic SDL log functions: use `SDL_Log(c"%s".as_ptr(), msg.as_ptr())` — never pass a Rust format string as the first argument.
- `SDL_GetJoysticks` / `SDL_GetGamepads` return heap-allocated arrays — call `SDL_free` after copying to Vec.

### wgpu / surface
- Always use `requestAdapterForWindow(window)` (not `requestAdapter()`) for windowed rendering. It creates a temp `Surface<'static>` so the adapter is guaranteed surface-compatible.
- Surface format (e.g. `bgra8unorm-srgb`) can't be read back. For screenshots, render to a separate `rgba8unorm` texture.
- VSync throttling happens in `getCurrentTexture()` (not `present()`) on DirectX backends. Use `presentMode: 'immediate'` to measure raw CPU costs.

---

## Event system

`ev.type` is typed as the `SdlEventType` enum — compare directly with enum variants.

```ts
import { SdlEventType, sdlPollEvents } from "bun-webgpu-rs";

for (const ev of sdlPollEvents()) {
  if (ev.type === SdlEventType.Quit) process.exit(0)
  if (ev.type === SdlEventType.KeyDown) console.log(ev.scancode, ev.keycode)
  if (ev.type === SdlEventType.GamepadButtonDown) console.log(ev.which, ev.button)
}
```

Important event fields by category:
| Category | Key fields |
|---|---|
| Window | `windowId`, `data1`, `data2` (resize: w/h; move: x/y) |
| Keyboard | `windowId`, `scancode`, `keycode`, `keyMod`, `keyRepeat` |
| Mouse motion | `windowId`, `which`, `mouseX/Y`, `mouseXrel/Yrel`, `mouseButtons` |
| Mouse button | `windowId`, `which`, `mouseX/Y`, `mouseButton`, `mouseClicks` |
| Joystick axis | `which`, `axis`, `axisValue` (-1..1) |
| Joystick hat | `which`, `hat`, `hatValue` (SDL_HAT_* flags) |
| Joystick button | `which`, `button` |
| Gamepad axis | `which`, `axis`, `axisValue` (-1..1) |
| Gamepad button | `which`, `button` |
| Gamepad touchpad | `which`, `touchpad`, `finger`, `touchpadX/Y/Pressure` |
| Gamepad sensor | `which`, `sensorType`, `sensorData` (Vec<f64>, up to 3 values) |
| Touch | `windowId`, `touchId`, `fingerId`, `touchX/Y/Dx/Dy/Pressure` |
| Drop | `windowId`, `text` (filename or text), `textSource`, `dropX/Y` |
| Audio device | `audioDeviceId`, `audioRecording` |

---

## Keyboard state polling

`SDL_GetKeyboardState` returns a live pointer — SDL keeps the memory updated
automatically on every event pump. Call `sdlGetKeyboardState()` **once** and
reuse the handle.

```ts
// At startup — one call only
const KB = sdlGetKeyboardState()          // SdlKeyboardState handle

// Inside the game loop — zero allocation
sdlPollEvents()                           // (or sdlPumpEvents) — updates SDL's live array
if (KB.get(SdlScancode.W)) { /* W held */ }
if (KB.get(SdlScancode.Left)) { /* left arrow held */ }

// Modifier keys
const mod = sdlGetModState()
if (mod & SdlKeymod.Shift) { /* shift held */ }
```

---

## Gamepad / Joystick quick-start

```ts
// Gamepads (Xbox / PS / Switch controllers via SDL mapping)
const ids = sdlGetGamepads()
const pad = sdlOpenGamepad(ids[0])
pad.getButton(SdlGamepadButton.South)         // A/cross
pad.getAxis(SdlGamepadAxis.LeftX)             // -1..1
pad.getAxis(SdlGamepadAxis.LeftTrigger)       // 0..1 (triggers use full positive range)
pad.rumble(0xFFFF, 0xFFFF, 200)               // both motors at full for 200 ms
pad.close()

// Raw joysticks (flight sticks, wheels, etc.)
const joy = sdlOpenJoystick(sdlGetJoysticks()[0])
joy.getAxis(0)                                // already normalised -1..1
joy.getHat(0) & SdlJoyHat.Up                 // dpad up
joy.rumble(0x8000, 0x8000, 100)
joy.close()
```

---

## Mouse cursor

```ts
const cursor = sdlCreateSystemCursor(SdlSystemCursor.Pointer)
sdlSetCursor(cursor)
sdlHideCursor()
sdlSetRelativeMouseMode(window, true)   // FPS mouse mode
const { x, y, buttons } = sdlGetRelativeMouseState()
if (buttons & SdlMouseButtonMask.LMask) { /* left button held */ }
cursor.destroy()
```

---

## Image loading (SDL3_image → wgpu)

`src/image/mod.rs` decodes an image **file** and uploads it straight into a
`GpuTexture` — the decoded pixels never cross the napi boundary as a byte array.
Both loaders are **async** (decode + upload on the libuv threadpool).

```ts
import { sdlImageLoadTexture, sdlImageLoadAnimation, ImageColorSpace, GPUTextureUsage } from "bun-webgpu-rs";

// Colour map (albedo/emissive) — sRGB is the default:
const albedo = await sdlImageLoadTexture(device, "hull_albedo.png");     // rgba8unorm-srgb
// Data map (normal/roughness) — must be linear:
const normal = await sdlImageLoadTexture(device, "hull_normal.png", {
  colorSpace: ImageColorSpace.Linear,                                   // rgba8unorm
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,    // default
});
// Several loads decode in parallel on the threadpool:
const [a, b] = await Promise.all([sdlImageLoadTexture(device, "a.png"), sdlImageLoadTexture(device, "b.jpg")]);

// Animated (GIF/WEBP/APNG): every frame is uploaded up front.
const anim = await sdlImageLoadAnimation(device, "explosion.gif");
for (let i = 0; i < anim.frameCount; i++) {
  const frame = anim.frame(i);       // GpuTexture handle (shares the uploaded texture)
  const ms = anim.delayMs(i);        // frame duration
}
```

Design rules for this module:
- **File readers only.** `IMG_Load` / `IMG_LoadAnimation` are wrapped; the
  `*_IO` (`SDL_IOStream`) and `SDL_Renderer`-based `IMG_LoadTexture*` entry
  points are intentionally omitted.
- **Async / off-thread, and it's safe to be.** Decode + upload run on a libuv
  worker via `AsyncTask` (same pattern as `create_render_pipeline_async`).
  SDL3_image has no `IMG_Init` (no init-thread coupling), `IMG_Load` has no
  main-thread requirement (only SDL's own 2D renderer does — which we don't
  use), SDL3 pixel formats are const (the old cross-thread format-list race is
  gone), and each call owns its surface. `SDL_GetError` is thread-local, so the
  error string is captured inside the worker task.
- **RGBA8, endianness-safe.** The surface is `SDL_ConvertSurface`'d to
  `SDL_PIXELFORMAT_RGBA32` (R,G,B,A byte order regardless of endianness), which
  maps 1:1 to wgpu `rgba8unorm(-srgb)`. Verified byte-for-byte in
  `tests/sdl-image.test.ts` (encode PNG → load → GPU readback → compare).
- **Strong enum, not a bool.** sRGB/linear is `ImageColorSpace`, mirroring the
  crate's `#[napi] enum` convention rather than a magic flag.
- Loading needs no `SDL_Init` — decode + `SDL_ConvertSurface` are self-contained.

## GPU debug primitives

```ts
// Error scope (validation errors)
device.pushErrorScope('validation')
// ... GPU work ...
const err = await device.popErrorScope()
if (err) console.error(err.type, err.message)

// GPU debug groups (visible in RenderDoc / PIX / Nsight)
encoder.pushDebugGroup('my-pass')
const pass = encoder.beginRenderPass(...)
pass.insertDebugMarker('draw-call')
pass.end()
encoder.popDebugGroup()
```

---

## Performance profiling

```ts
const freq = sdlGetPerformanceFrequency()
const t0 = sdlGetPerformanceCounter()
// ... work ...
const us = (sdlGetPerformanceCounter() - t0) / freq * 1e6

// Baseline napi round-trip ≈ 88–100 ns on a modern desktop
// 16.7 ms frame budget can absorb ~180 000 napi calls
// VSync wait lands in getCurrentTexture() on D3D/Vulkan backends,
// not in present(). Use presentMode: 'immediate' to measure raw CPU time.
```

---

## Common pitfalls

| Symptom | Root cause | Fix |
|---|---|---|
| `"No supported surface formats"` | Adapter selected without surface compatibility | Use `requestAdapterForWindow()` not `requestAdapter()` |
| Screenshot is blank/wrong colours | Surface is `bgra8unorm-srgb`, helper expects `rgba8unorm` | Render a second pass to an offscreen `rgba8unorm` texture |
| `SDL_Log` crash / bad format | Passed Rust string as variadic format | Use `SDL_Log(c"%s".as_ptr(), msg.as_ptr())` |
| napi build fails — cmake not found | CMake not in PATH | Install CMake globally (already done on this machine) |
| `SDL_GetJoysticks` leak | Forgot to SDL_free the returned array | Copy to Vec, then call `SDL_free(ptr)` |
| Drop event text is garbage | Pointer copied after PollEvent loop | `copy_cstr` immediately inside `convert()` — already handled |
