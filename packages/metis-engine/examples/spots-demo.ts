// Interactive windowed demo — spot-light shadows: a metallic sphere on a deck,
// lit by the sun from above plus four differently-coloured shadow-casting spot
// lights orbiting around it.
//
// This is the visual test for `castsShadow`. Four coloured casters is exactly
// MAX_SHADOW_SPOTS, so it also exercises the cap. What to look for:
//
//   - Four coloured shadow spokes radiate from the sphere across the deck, each
//     the *complement* of the light it belongs to (a red light's shadow is where
//     red is missing, so it reads cyan-ish where the other three still reach).
//   - Where two shadows overlap, the deck is darker still and shifts hue again.
//     If overlapping shadows ever look identical to single ones, the per-light
//     maps are not independent.
//   - The spokes must stay anchored to the sphere as the lights orbit. A shadow
//     that detaches, swims, or lags is the thing to report.
//   - Press L to toggle all four casters off: the spokes should vanish and
//     nothing else should change. That A/B is the whole point of the demo.
//
// WASD+QE fly, arrows look, L toggles shadows, Space pauses the orbit,
// P toggles the GPU profiler overlay, Escape/close to quit.
import { SdlEventType, SdlKeycode, sdlPollEvents } from "bun-webgpu-rs";
import {
    ClusteredForwardRenderer,
    createDefaultPostProcessPipeline,
    createExteriorEnvironment,
    cube,
    DebugOverlay,
    FrameLimiter,
    GpuProfiler,
    History,
    MAX_SHADOW_SPOTS,
    Material,
    Mesh,
    profileSpansToRows,
    RenderContext,
    Scene,
    type SpotLight,
    uvSphere,
    VectorText,
} from "metis-engine/renderer";
import { vec3 } from "wgpu-matrix";

const FONT_PATH = new URL("../../../assets/JetBrainsMono-Regular.ttf", import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/,
    "$1",
);

const ctx = await RenderContext.createWindowed("metis-engine — spot shadows demo", {
    width: 1280,
    height: 720,
    presentMode: "immediate",
    profiling: true,
});
const limiter = new FrameLimiter();
const forward = new ClusteredForwardRenderer(ctx.device);
const post = createDefaultPostProcessPipeline(ctx.device);
const hud = new VectorText(ctx.device, ctx.outputFormat);
hud.loadFont("mono", FONT_PATH);

const profiler = GpuProfiler.create(ctx.device);
const debug = new DebugOverlay(ctx.device, ctx.outputFormat);
debug.loadFont("mono", FONT_PATH);
const cpuHistory = new History(120);
const gpuHistory = new History(120);
let showProfiler = false;
if (profiler) {
    forward.profiler = profiler;
    hud.profiler = profiler;
    hud.profileLabel = "hud-text";
    debug.profiler = profiler;
    console.log(
        `[demo] GPU profiler ready — press P. draw zones: ${profiler.canProfileDraws}, ` +
            `measured frame total: ${profiler.canProfileFrameTotal}`,
    );
} else {
    console.log("[demo] this adapter has no timestamp-query support — profiler unavailable");
}

const scene = new Scene();
// Sun straight down and deliberately modest, with low ambient: bright enough
// that the scene reads as lit from above, dim enough that the coloured spots
// and their shadows aren't washed out. Turn sunIntensity up and the spot
// shadows correctly become subtler — they only remove the spot's contribution,
// never the sun's (that's the cascades' job).
scene.environment = createExteriorEnvironment({
    sunDirection: vec3.normalize(vec3.create(0.05, -1, 0.12)),
    sunIntensity: 0.4,
    ambientIntensity: 0.01,
});
scene.camera.position = vec3.create(0, 7.5, 8.5);
scene.camera.target = vec3.create(0, 0.2, 0);
scene.camera.setAspectFromSize(ctx.width, ctx.height);

/** Centre of the sphere — every spot aims here, and the orbit is around it. */
const FOCUS = vec3.create(0, 0.3, 0);

const deckMesh = new Mesh(ctx.device, cube(24, 0.2, 24), "deck");
const deckMaterial = new Material({baseColor: [0.42, 0.43, 0.46, 1], metallic: 0.05, roughness: 0.75});
scene.add(deckMesh, deckMaterial, {position: vec3.create(0, -1.0, 0)});

// Metallic and fairly smooth, so each coloured spot also leaves a distinct
// specular highlight — a second, independent read on whether the lights are
// where the shadows say they are.
const sphereMesh = new Mesh(ctx.device, uvSphere(1.2, 48, 64), "sphere");
const sphereMaterial = new Material({baseColor: [0.7, 0.72, 0.75, 1], metallic: 0.9, roughness: 0.3});
scene.add(sphereMesh, sphereMaterial, {position: FOCUS});

interface OrbitingSpot {
    /** Radians around Y at t = 0. */
    phase: number;
    /** Signed, so pairs counter-rotate and their shadows sweep across each other. */
    speed: number;
    radius: number;
    height: number;
    light: SpotLight;
}

const PALETTE: {color: [number, number, number]; label: string}[] = [
    {color: [1.0, 0.18, 0.14], label: "red"},
    {color: [0.2, 1.0, 0.32], label: "green"},
    {color: [0.24, 0.45, 1.0], label: "blue"},
    {color: [1.0, 0.72, 0.2], label: "amber"},
];

// Four casters == MAX_SHADOW_SPOTS exactly. Adding a fifth here would trip the
// cap warning and silently leave one light shadowless — worth trying once to
// see what that looks like.
const spots: OrbitingSpot[] = PALETTE.map((entry, i) => ({
    phase: (i / MAX_SHADOW_SPOTS) * Math.PI * 2,
    // Counter-rotating pairs.
    speed: i % 2 === 0 ? 0.45 : -0.32,
    // Slightly different radii/heights so the four spokes differ in length and
    // don't overlap into one symmetric blob.
    radius: 4.4 + (i % 2) * 0.5,
    height: 4.2 + (i % 3) * 0.3,
    light: {
        kind: "spot",
        position: vec3.create(0, 0, 0),
        direction: vec3.create(0, -1, 0),
        color: entry.color,
        intensity: 55,
        range: 16,
        // Cone width is bounded from BOTH sides, and both bounds were hit while
        // tuning this scene:
        //   - Too narrow and the lit pool barely exceeds the sphere's own
        //     radius, so the shadow spoke is clipped by the cone edge before it
        //     reads as a shadow.
        //   - Too wide and `outerAngle` exceeds the light's elevation above the
        //     focus, which tips the cone's upper edge ABOVE horizontal: half the
        //     cone sprays into empty sky and the rest rakes sideways across the
        //     deck as a smeared streak. That stops being a spotlight aimed at
        //     something and becomes a floodlight that happens to have a cone.
        // Keep outerAngle comfortably under the elevation angle (~39-46deg for
        // the radii/heights above).
        innerAngle: (14 * Math.PI) / 180,
        outerAngle: (34 * Math.PI) / 180,
        castsShadow: true,
    },
}));
for (const s of spots) {
    scene.lights.push(s.light);
}

/** Places each spot on its orbit and re-aims it at the sphere. */
function animateSpots(t: number) {
    for (const s of spots) {
        const a = s.phase + s.speed * t;
        const x = Math.cos(a) * s.radius;
        const z = Math.sin(a) * s.radius;
        s.light.position = vec3.set(x, s.height, z, s.light.position as Float32Array);
        // Aim at the sphere: `direction` is the way light TRAVELS, so it points
        // from the light toward the focus, not the other way round.
        s.light.direction = vec3.set(
            FOCUS[0]! - x,
            FOCUS[1]! - s.height,
            FOCUS[2]! - z,
            s.light.direction as Float32Array,
        );
    }
}

let yaw = Math.PI;
let pitch = -0.62;
let shadowsOn = true;
let orbitPaused = false;
let orbitTime = 0;
const keys = new Set<number>();
let running = true;
let lastTime = performance.now();

while (running) {
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    for (const e of sdlPollEvents()) {
        if (e.type === SdlEventType.WindowCloseRequested || e.type === SdlEventType.Quit) {
            running = false;
        }
        if (e.type === SdlEventType.KeyDown) {
            if (e.keycode === SdlKeycode.Escape) {
                running = false;
            } else if (e.keycode === SdlKeycode.P && !keys.has(SdlKeycode.P)) {
                showProfiler = !showProfiler;
                keys.add(SdlKeycode.P);
            } else if (e.keycode === SdlKeycode.L && !keys.has(SdlKeycode.L)) {
                // The A/B: everything else identical, only the shadows change.
                shadowsOn = !shadowsOn;
                for (const s of spots) {
                    s.light.castsShadow = shadowsOn;
                }
                keys.add(SdlKeycode.L);
            } else if (e.keycode === SdlKeycode.Space && !keys.has(SdlKeycode.Space)) {
                orbitPaused = !orbitPaused;
                keys.add(SdlKeycode.Space);
            } else if (e.keycode !== undefined) {
                keys.add(e.keycode);
            }
        }
        if (e.type === SdlEventType.KeyUp && e.keycode !== undefined) {
            keys.delete(e.keycode);
        }
    }

    if (!orbitPaused) {
        orbitTime += dt;
    }
    animateSpots(orbitTime);

    const turnSpeed = 1.5 * dt;
    // Yaw sign is not arbitrary: `right` is cross(forward, up), which is -X when
    // facing +Z, while increasing yaw rotates forward toward +X — so a *larger*
    // yaw turns LEFT. These two were bound the other way round, which read as
    // inverted steering. Strafing (A/D via `right`) was always correct.
    if (keys.has(SdlKeycode.Left)) {
        yaw += turnSpeed;
    }
    if (keys.has(SdlKeycode.Right)) {
        yaw -= turnSpeed;
    }
    if (keys.has(SdlKeycode.Up)) {
        pitch = Math.min(pitch + turnSpeed, 1.4);
    }
    if (keys.has(SdlKeycode.Down)) {
        pitch = Math.max(pitch - turnSpeed, -1.4);
    }

    const forwardDir = vec3.create(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const right = vec3.normalize(vec3.cross(forwardDir, vec3.create(0, 1, 0)));
    const moveSpeed = 4 * dt;
    if (keys.has(SdlKeycode.W)) {
        vec3.add(scene.camera.position, vec3.scale(forwardDir, moveSpeed), scene.camera.position);
    }
    if (keys.has(SdlKeycode.S)) {
        vec3.add(scene.camera.position, vec3.scale(forwardDir, -moveSpeed), scene.camera.position);
    }
    if (keys.has(SdlKeycode.A)) {
        vec3.add(scene.camera.position, vec3.scale(right, -moveSpeed), scene.camera.position);
    }
    if (keys.has(SdlKeycode.D)) {
        vec3.add(scene.camera.position, vec3.scale(right, moveSpeed), scene.camera.position);
    }
    if (keys.has(SdlKeycode.Q)) {
        scene.camera.position[1]! -= moveSpeed;
    }
    if (keys.has(SdlKeycode.E)) {
        scene.camera.position[1]! += moveSpeed;
    }
    vec3.add(scene.camera.position, forwardDir, scene.camera.target);

    const frame = ctx.beginFrame();
    const encodeStart = performance.now();
    const encoder = ctx.device.createCommandEncoder();
    profiler?.beginFrame(encoder);
    forward.render(encoder, ctx.targets, scene);
    post.pipeline.run(encoder, {
        device: ctx.device,
        hdrColorView: ctx.targets.hdrColorResolvedView,
        depthView: ctx.targets.depthView,
        outputView: frame.view,
        outputFormat: frame.format,
        width: ctx.width,
        height: ctx.height,
        deltaTime: dt,
        profiler: profiler ?? undefined,
    });
    hud.drawText(
        `METIS-ENGINE // SPOT SHADOWS — ${spots.length} casters ${shadowsOn ? "ON" : "OFF"} (L)` +
            `${orbitPaused ? " | PAUSED (Space)" : ""} | shadow draws ` +
            `${forward.spotShadows.lastDrawnInstances}/${forward.spotShadows.lastCandidateInstances}`,
        "mono",
        16,
        12,
        24,
    );
    hud.drawText("WASD+QE fly, arrows look, L shadows, Space pause, P profiler, Esc quit", "mono", 14, 12, 46);
    hud.render(encoder, frame.view, ctx.width, ctx.height, [0.85, 0.95, 1.0, 1.0]);

    cpuHistory.push(performance.now() - encodeStart);
    if (profiler) {
        gpuHistory.push(profiler.frameTotalMs);
    }
    if (showProfiler && profiler) {
        if (debug.due()) {
            drawProfilerOverlay();
        }
        debug.render(encoder, frame.view, ctx.width, ctx.height);
    }

    profiler?.endFrame(encoder);
    ctx.device.queue.submit([encoder.finish()]);
    frame.present();
    await limiter.wait();
}

function drawProfilerOverlay() {
    if (!profiler) {
        return;
    }
    const x = ctx.width - 320;
    debug.graph({
        x,
        y: 12,
        width: 308,
        height: 96,
        title: "frame time",
        unit: "ms",
        series: [
            {label: "gpu", values: gpuHistory},
            {label: "cpu", values: cpuHistory},
        ],
    });
    debug.tree({
        x,
        y: 118,
        width: 308,
        title: `GPU passes — ${profiler.frameTotalMs.toFixed(3)} ms`,
        rows: profileSpansToRows(profiler.spans, profiler.frameTotalMs),
    });
}

ctx.destroy();
