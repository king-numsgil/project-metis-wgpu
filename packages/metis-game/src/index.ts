// metis-game — a 100-animated-point-light demo over a flat plane, plus the
// joystick/keyboard input smoketest.
//
// This is also the reference consumer of metis-engine's "caller-owned device"
// path (metis-engine/DOC.md §1.3): the game bootstraps its own SDL window,
// adapter, device, and surface, and hands the engine nothing but a `GpuDevice`,
// a `RenderTargets`, and an output view + format each frame. `RenderContext` is
// never used — nothing in the render path knows a window exists.
//
// WASD + QE to fly, arrows to look, Esc / close to quit.
import {
    createSurface,
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
    Material,
    Mesh,
    mulberry32,
    plane,
    type PointLight,
    RenderTargets,
    Scene,
    VectorText,
} from "metis-engine";
import { scheduler } from "node:timers/promises";
import { vec3 } from "wgpu-matrix";

const LIGHT_COUNT = 100;
const PLANE_SIZE = 60;
const FIELD_HALF = 24; // lights scatter over [-24, 24] in x/z

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

const device = await adapter.requestDevice({label: "metis-device"});
const surface = createSurface(adapter, wnd);
const fmt = surface.getPreferredFormat();
surface.configure(device, {width: wnd.width, height: wnd.height});

// ── Engine: everything below is derived from `device` alone ─────────────────
let width = wnd.width;
let height = wnd.height;

const targets = new RenderTargets(device, width, height);
const forward = new ClusteredForwardRenderer(device);
const post = createDefaultPostProcessPipeline(device);
const hud = new VectorText(device, fmt); // the OUTPUT format, not the HDR one
hud.loadFont("mono", FONT_PATH);

const scene = new Scene();
scene.environment = createExteriorEnvironment({ambientIntensity: 0.02});
scene.camera.position = vec3.create(0, 11, 30);
scene.camera.target = vec3.create(0, 1, 0);
scene.camera.far = 200;
scene.camera.setAspectFromSize(width, height);

const floor = new Mesh(device, plane(PLANE_SIZE, PLANE_SIZE), "floor");
const floorMaterial = new Material({baseColor: [0.5, 0.5, 0.52, 1], metallic: 0.0, roughness: 0.85});
scene.add(floor, floorMaterial);

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
scene.pointLights = lights.map((l) => l.light);

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
    surface.configure(device, {width, height});
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

while (running) {
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

    const frame = surface.getCurrentTexture();
    if (frame.suboptimal) {
        surface.configure(device, {width, height});
    }
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
        `METIS // ${LIGHT_COUNT} LIGHTS  |  ${fpsEma.toFixed(0)} fps  |  WASD+QE fly, arrows look, Esc quit`,
        "mono",
        18,
        14,
        26,
    );
    hud.render(encoder, view, width, height, [0.85, 0.95, 1.0, 1.0]);

    device.queue.submit([encoder.finish()]);
    frame.present();
    await scheduler.yield();
}

// Teardown, in dependency order (DOC.md §1.3).
joysticks.forEach((joystick) => joystick.close());
forward.destroy();
post.pipeline.destroy();
hud.destroy();
targets.destroy();
device.destroy();
wnd.destroy();
sdlQuit();
