// metis-game — 100 animated point lights on the surface of a 1:1-scale Earth,
// with a 1:1 Moon 384,400 km overhead. Plus the joystick/keyboard smoketest.
//
// A stress test for the engine's reverse-Z infinite-far depth buffer: the same
// frame holds geometry from 0.01 m to 3.86e8 m with no z-fighting anywhere, and
// no near/far tuning. It survives float32 because the scene is implicitly
// camera-relative — see the EARTH_R block below.
//
// This is also the reference consumer of metis-engine's "caller-owned device"
// path (metis-engine/DOC.md §1.3): the game bootstraps its own SDL window,
// adapter, device, and surface, and hands the engine nothing but a `GpuDevice`,
// a `RenderTargets`, and an output view + format each frame. `RenderContext` is
// never used — nothing in the render path knows a window exists.
//
// WASD + QE to fly, arrows to look (hold Up to find the Moon), Esc / close to quit.
import {
    createSurface, type GPUPresentMode,
    requestAdapterForWindow,
    sdlCreateWindow,
    SdlEventType,
    sdlGetError,
    sdlGetJoysticks,
    sdlGetKeyboardState,
    sdlInit,
    SdlInitFlag,
    SdlJoyHat,
    SdlKeycode,
    sdlOpenJoystick,
    sdlPollEvents,
    sdlQuit,
    SdlScancode,
} from "bun-webgpu-rs";
import {
    ClusteredForwardRenderer,
    createDefaultPostProcessPipeline,
    createExteriorEnvironment,
    cube,
    FrameLimiter,
    Material,
    Mesh,
    mulberry32,
    type PointLight,
    RenderTargets,
    Scene,
    uvSphere,
    VectorText,
} from "metis-engine/renderer";
import { vec3 } from "wgpu-matrix";
import { FrameProfiler } from "./frameProfiler";

const LIGHT_COUNT = 100;
const FIELD_HALF = 24; // lights scatter over [-24, 24] in x/z

// ── Earth-Moon at 1:1 scale, in metres ──────────────────────────────────────
// This works in float32 *only* because the scene is implicitly camera-relative:
// the world origin sits on the Earth's surface right under the camera, so every
// coordinate the shader cares about is small. The Earth's centre (-6.371e6) and
// the Moon's centre (+3.844e8) are large, but they live in the model matrix's
// translation, and nothing near-field is computed relative to them.
//
// f32 grid step at the Moon's distance is ~32 m; from here that subtends 8e-5 px.
// Stand ON the Moon and the same 32 m would be ~2900 px — which is the whole
// argument for camera-relative rendering (see metis-engine/CLAUDE.md).
const EARTH_R = 6.371e6;
const MOON_R = 1.7374e6;
const MOON_DIST = 3.844e8;
/**
 * Far reach of the cascaded shadow maps. The 4 cascades subdivide
 * `[near, SHADOW_DISTANCE]`, near-crisp (cascade 0 covers ~the closest 8 m here)
 * and coarsening with distance — so this only needs to reach as far as shadows
 * stay legible on the surface, not to the horizon.
 */
const SHADOW_DISTANCE = 200;

const FONT_PATH = new URL("../../../assets/JetBrainsMono-Regular.ttf", import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/,
    "$1",
);

// ── The game owns the window, adapter, device and surface ───────────────────
console.log("before init");
sdlInit(SdlInitFlag.Video | SdlInitFlag.Joystick);
console.log("after init", sdlGetError());

const wnd = sdlCreateWindow("Metis Rendering Window", 1440, 768);
console.log(`Wnd: ${wnd.id}`);
const adapter = await requestAdapterForWindow(wnd, {
    powerPreference: "high-performance",
    backend: "vulkan",
});

const keyboard = sdlGetKeyboardState();

if (!adapter) {
    sdlQuit();
    throw new Error("No GPU adapter compatible with this window");
}

console.log("adapter features =", adapter.features.values());

const device = await adapter.requestDevice({label: "metis-device"});
const surface = createSurface(adapter, wnd);
const fmt = surface.getPreferredFormat();
// Present mode: omitted → the binding default, `mailbox`, which avoids the
// periodic ~50 ms getCurrentTexture() stall that `auto-vsync`/`fifo` exhibit on
// this Vulkan setup (see frameProfiler.ts). Override with
// METIS_PRESENT=fifo|immediate|auto-vsync to compare.
const presentMode = process.env.METIS_PRESENT as GPUPresentMode | undefined;
console.log(`[present] mode = ${presentMode ?? "mailbox (default)"}`);
surface.configure(device, {width: wnd.width, height: wnd.height, presentMode});

// ── Engine: everything below is derived from `device` alone ─────────────────
let width = wnd.width;
let height = wnd.height;

const targets = new RenderTargets(device, width, height);
const forward = new ClusteredForwardRenderer(device);
const post = createDefaultPostProcessPipeline(device);
const hud = new VectorText(device, fmt); // the OUTPUT format, not the HDR one
hud.loadFont("mono", FONT_PATH);

const scene = new Scene();
// Sun at 45 degrees elevation (sunDirection is the direction light *travels*).
scene.environment = createExteriorEnvironment({
    sunDirection: vec3.normalize(vec3.create(-1, -1, 0)),
    ambientIntensity: 0.02,
});
scene.camera.position = vec3.create(0, 8, 22);
scene.camera.target = vec3.create(0, 1, 0);
scene.camera.clusterFar = 200; // light-culling range; the projection itself is infinite
scene.camera.setAspectFromSize(width, height);

// Bound the shadowed range. Without this the cascades would try to span the
// whole Earth-Moon system and every texel would be kilometres wide; capping the
// reach keeps all 4 cascades packed on the near surface (cascade 0 ~cm/texel).
forward.shadowDistance = SHADOW_DISTANCE;

// The Earth: a real-radius sphere whose north pole touches the world origin, so
// we're standing on its surface. The visible ground is deep inside the pole's
// triangle fan, which reads (correctly) as a flat plane — the sphere's sagitta
// over a 100 m patch is 0.8 mm.
const earth = new Mesh(device, uvSphere(EARTH_R, 32, 64), "earth");
const earthMaterial = new Material({baseColor: [0.5, 0.5, 0.52, 1], metallic: 0.0, roughness: 0.85});
scene.add(earth, earthMaterial, {position: vec3.create(0, -EARTH_R, 0)});

// The Moon, 1:1, directly overhead. Angular diameter 2*MOON_R/MOON_DIST = 9.0
// mrad = 0.52 degrees — the real thing, and about 8 px tall at this fov/height.
// It renders at all only because the projection has no far plane (reverse-Z,
// infinite): the old far = 200 would have clipped it away entirely.
const moon = new Mesh(device, uvSphere(MOON_R, 32, 48), "moon");
const moonMaterial = new Material({baseColor: [0.62, 0.6, 0.57, 1], metallic: 0.0, roughness: 0.95});
scene.add(moon, moonMaterial, {position: vec3.create(0, MOON_DIST, 0)});

// A few surface structures spread across the near-to-mid distance, so the
// cascades each have something to cast — near ones land in the crisp cascade 0,
// far ones in the coarser cascades, exercising the whole set.
const block = new Mesh(device, cube(3, 5, 3), "structure");
const blockMaterial = new Material({baseColor: [0.35, 0.36, 0.4, 1], metallic: 0.3, roughness: 0.6});
// Spread from underfoot out to ~120 m so a shadow lands in each cascade.
for (const [x, z] of [[-8, -2], [6, 1], [0, -6], [9, -5], [-14, -22], [18, -40], [-30, -80], [10, -120]] as [number, number][]) {
    scene.add(block, blockMaterial, {position: vec3.create(x, 2.5, z)});
}

// ── The light field ─────────────────────────────────────────────────────────
interface AnimatedLight {
    cx: number;
    cz: number;
    orbitRadius: number;
    orbitSpeed: number;
    phase: number;
    baseY: number;
    bobAmp: number;
    bobSpeed: number;
    light: PointLight;
}

/** Deterministic scatter (seeded PRNG) so the demo looks the same every launch. */
function buildLightField(count: number): AnimatedLight[] {
    const rand = mulberry32(0x1234_abcd);
    const lights: AnimatedLight[] = [];
    for (let i = 0; i < count; i++) {
        // Alternating warm/cool so the pools read as distinct lights.
        const warm = i % 2 === 0;
        const color: [number, number, number] = warm
            ? [1.0, 0.55 + 0.35 * rand(), 0.35 + 0.2 * rand()]
            : [0.35 + 0.2 * rand(), 0.6 + 0.3 * rand(), 1.0];
        lights.push({
            cx: (rand() * 2 - 1) * FIELD_HALF,
            cz: (rand() * 2 - 1) * FIELD_HALF,
            orbitRadius: 1.5 + rand() * 4,
            orbitSpeed: (rand() * 2 - 1) * 1.6,
            phase: rand() * Math.PI * 2,
            baseY: 0.8 + rand() * 2.8,
            bobAmp: 0.3 + rand() * 1.0,
            bobSpeed: 0.5 + rand() * 2.0,
            light: {
                kind: "point",
                position: vec3.create(0, 0, 0),
                color,
                intensity: 6 + rand() * 10,
                range: 5 + rand() * 10,
            },
        });
    }
    return lights;
}

const lights = buildLightField(LIGHT_COUNT);
scene.lights = lights.map((l) => l.light);

function animateLights(t: number) {
    for (const a of lights) {
        const angle = a.phase + a.orbitSpeed * t;
        const x = a.cx + Math.cos(angle) * a.orbitRadius;
        const z = a.cz + Math.sin(angle) * a.orbitRadius;
        const y = a.baseY + Math.sin(t * a.bobSpeed + a.phase) * a.bobAmp;
        a.light.position = vec3.set(x, y, z, a.light.position as Float32Array);
    }
}

/**
 * Resizing is the caller's job on this path: the swapchain, the engine's HDR/depth
 * targets, and the camera aspect all have to move together (DOC.md §1.3).
 */
function resize(w: number, h: number) {
    if (w === width && h === height) {
        return;
    }
    width = w;
    height = h;
    surface.configure(device, {width, height, presentMode});
    targets.resize(device, width, height);
    scene.camera.setAspectFromSize(width, height);
}

// ── Joystick smoketest ──────────────────────────────────────────────────────
const joysticks = sdlGetJoysticks().map((id) => sdlOpenJoystick(id));
joysticks.forEach(joystick => console.log(`Found Joystick with ID ${joystick.instanceId()} and name "${joystick.name()}"`));

function hatValueToString(value: SdlJoyHat): string {
    switch (value) {
        case SdlJoyHat.Centered:
            return "Centered";
        case SdlJoyHat.Down:
            return "Down";
        case SdlJoyHat.Left:
            return "Left";
        case SdlJoyHat.Right:
            return "Right";
        case SdlJoyHat.LeftDown:
            return "LeftDown";
        case SdlJoyHat.LeftUp:
            return "LeftUp";
        case SdlJoyHat.RightDown:
            return "RightDown";
        case SdlJoyHat.RightUp:
            return "RightUp";
        case SdlJoyHat.Up:
            return "Up";
    }
}

// ── Frame loop ──────────────────────────────────────────────────────────────
let yaw = Math.PI; // looking -Z, back toward the origin
let pitch = -0.32;
let elapsed = 0;
let fpsEma = 60;
let lastTime = performance.now();
let running = true;
const profiler = new FrameProfiler();
// Uncapped by default; METIS_FPS=60 (or your refresh) turns the cap on.
const capFps = Number(process.env.METIS_FPS) || 0;
if (capFps) console.log(`[limiter] capping to ${capFps} fps (METIS_FPS)`);
const limiter = new FrameLimiter(capFps);

while (running) {
    profiler.begin();
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    elapsed += dt;
    if (dt > 0) {
        fpsEma = fpsEma * 0.9 + (1 / dt) * 0.1;
    }

    for (const e of sdlPollEvents()) {
        if (e.type === SdlEventType.WindowCloseRequested || e.type === SdlEventType.Quit) {
            running = false;
        }
        if (e.type === SdlEventType.KeyDown && e.keycode === SdlKeycode.Escape) {
            running = false;
        }
        if (e.type === SdlEventType.WindowResized) {
            resize(e.data1!, e.data2!);
        }

        if (e.type === SdlEventType.JoystickAxisMotion) {
            console.log(`JoystickAxisMotion : Joystic #${e.which} Axis #${e.axis} = ${e.axisValue}`);
        }

        if (e.type === SdlEventType.JoystickButtonDown) {
            console.log(`JoystickButtonDown : Joystic #${e.which} Button #${e.button}`);
        }

        if (e.type === SdlEventType.JoystickHatMotion) {
            console.log(`JoystickHatMotion : Joystic #${e.which} Hat #${e.hat} = ${hatValueToString(e.hatValue!)}`);
        }
    }

    // Fly camera, driven by the live keyboard-state handle.
    const turn = 1.5 * dt;
    if (keyboard.get(SdlScancode.Left)) {
        yaw += turn;
    }
    if (keyboard.get(SdlScancode.Right)) {
        yaw -= turn;
    }
    if (keyboard.get(SdlScancode.Up)) {
        pitch = Math.min(pitch + turn, 1.4);
    }
    if (keyboard.get(SdlScancode.Down)) {
        pitch = Math.max(pitch - turn, -1.4);
    }

    const forwardDir = vec3.create(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const right = vec3.normalize(vec3.cross(forwardDir, vec3.create(0, 1, 0)));
    const speed = 12 * dt;
    if (keyboard.get(SdlScancode.W)) {
        vec3.add(scene.camera.position, vec3.scale(forwardDir, speed), scene.camera.position);
    }
    if (keyboard.get(SdlScancode.S)) {
        vec3.add(scene.camera.position, vec3.scale(forwardDir, -speed), scene.camera.position);
    }
    if (keyboard.get(SdlScancode.A)) {
        vec3.add(scene.camera.position, vec3.scale(right, -speed), scene.camera.position);
    }
    if (keyboard.get(SdlScancode.D)) {
        vec3.add(scene.camera.position, vec3.scale(right, speed), scene.camera.position);
    }
    if (keyboard.get(SdlScancode.Q)) {
        scene.camera.position[1]! -= speed;
    }
    if (keyboard.get(SdlScancode.E)) {
        scene.camera.position[1]! += speed;
    }
    vec3.add(scene.camera.position, forwardDir, scene.camera.target);

    animateLights(elapsed);
    profiler.lap("update+encode"); // CPU: input, sim, light animation

    const frame = surface.getCurrentTexture(); // vsync wait lands here (Vulkan/D3D)
    if (frame.suboptimal) {
        surface.configure(device, {width, height, presentMode});
    }
    profiler.lap("acquire");
    const view = frame.createView();

    const encoder = device.createCommandEncoder();
    forward.render(encoder, targets, scene);
    post.pipeline.run(encoder, {
        device,
        hdrColorView: targets.hdrColorResolvedView, // resolved, never the multisampled view
        depthView: targets.depthView,
        outputView: view,
        outputFormat: fmt,
        width,
        height,
        deltaTime: dt,
    });
    hud.drawText(
        `METIS // EARTH-MOON 1:1  |  ${LIGHT_COUNT} lights  |  ${fpsEma.toFixed(0)} fps  |  ` +
        `WASD+QE fly, arrows look (Up = Moon), Esc quit`,
        "mono",
        18,
        14,
        26,
    );
    hud.render(encoder, view, width, height, [0.85, 0.95, 1.0, 1.0]);

    device.queue.submit([encoder.finish()]);
    profiler.lap("update+encode"); // fold the record/submit cost into CPU work
    frame.present();
    profiler.lap("present");
    await limiter.wait(); // frame cap ("vsync on") + event-loop yield; no-op when uncapped
    profiler.lap("yield");
    profiler.end();
}

// Teardown, in dependency order (DOC.md §1.3).
joysticks.forEach((joystick) => joystick.close());
forward.destroy();
post.pipeline.destroy();
hud.destroy();
targets.destroy();
// Before the window — the surface's teardown talks to the window system, and
// wnd.destroy()/sdlQuit() close the connection it needs (segfaults on X11).
surface.destroy();
device.destroy();
wnd.destroy();
sdlQuit();
