// Interactive windowed demo — ship interior: sunlight through a window
// opening (real shadow occlusion, not just an ambient fake), ceiling
// fixtures, soft ambient fill. WASD+QE to fly, O cycles AO, P toggles the GPU
// profiler overlay, Escape/close to quit.
import { SdlEventType, SdlKeycode, sdlPollEvents } from "metis-native";
import {
    AoTechnique,
    ClusteredForwardRenderer,
    createDefaultPostProcessPipeline,
    createInteriorEnvironment,
    cube,
    DebugOverlay,
    FrameLimiter,
    GpuProfiler,
    History,
    Material,
    Mesh,
    plane,
    profileSpansToRows,
    RenderContext,
    roomBox,
    Scene,
    VectorText,
} from "metis-engine/renderer";
import { vec3 } from "wgpu-matrix";
import { loadMetalPlateTextures, makeEmissivePanelTexture } from "./demoAssets";

const FONT_PATH = new URL("../../../assets/JetBrainsMono-Regular.ttf", import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/,
    "$1",
);

// `immediate` present mode: this is a development demo, so raw frame cost
// matters more than tearing — it removes the present back-pressure that would
// otherwise sit in getCurrentTexture() and skew the profiler's numbers. The
// binding default stays `mailbox`, which is the right default for a real app.
// Uncapped frame limiter — construct with a target fps (e.g. new
// FrameLimiter(60)) to cap for lower power.
const ctx = await RenderContext.createWindowed("metis-engine — interior demo", {
    width: 1280,
    height: 720,
    presentMode: "immediate",
    profiling: true,
});
const limiter = new FrameLimiter();
const forward = new ClusteredForwardRenderer(ctx.device);
// Ambient occlusion quality dial — press O to cycle None / SSAO / HBAO.
const AO_CYCLE = [AoTechnique.None, AoTechnique.SSAO, AoTechnique.HBAO];
let aoIndex = 2; // start on HBAO
forward.ao.technique = AO_CYCLE[aoIndex]!;
const post = createDefaultPostProcessPipeline(ctx.device);
const hud = new VectorText(ctx.device, ctx.outputFormat);
hud.loadFont("mono", FONT_PATH);

// Profiling is opt-in twice over: null here if the GPU has no timestamp-query,
// and even then nothing is measured until `forward.profiler` is assigned below.
const profiler = GpuProfiler.create(ctx.device);
const debug = new DebugOverlay(ctx.device, ctx.outputFormat);
debug.loadFont("mono", FONT_PATH);
const cpuHistory = new History(120);
const gpuHistory = new History(120);
let showProfiler = false;
if (profiler) {
    forward.profiler = profiler;
    // Both text layers draw into the frame, so both belong in the tree.
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
// Sunlight enters through the front-wall window: the room spans z in
// [-5, 5] with the window cut into the wall at z = -5, so the sun must
// travel in +Z (into the room) to pass through it.
scene.environment = createInteriorEnvironment({sunDirection: vec3.normalize(vec3.create(0.15, -0.5, 0.85))});
scene.camera.position = vec3.create(0, 1.8, 3.5);
scene.camera.target = vec3.create(0, 1.6, -5);
scene.camera.setAspectFromSize(ctx.width, ctx.height);

const roomMesh = new Mesh(ctx.device, roomBox(8, 4, 10, {s0: 0.3, s1: 0.7, t0: 0.4, t1: 0.85}), "room");
const roomMaterial = new Material({baseColor: [0.55, 0.54, 0.52, 1], metallic: 0.0, roughness: 0.85});
scene.add(roomMesh, roomMaterial);

scene.lights.push(
    {kind: "point", position: vec3.create(-2, 3.6, 1), color: [1, 0.92, 0.75], intensity: 5, range: 6},
    {kind: "point", position: vec3.create(2, 3.6, 1), color: [1, 0.92, 0.75], intensity: 5, range: 6},
    // A ceiling spot aimed down at the console, for eyeballing the cone
    // interactively (the fixture's `spotlights` scene is the pinned version).
    {
        kind: "spot",
        position: vec3.create(0, 3.8, 3),
        direction: vec3.create(0, -1, -0.25),
        castsShadow: true,
        color: [0.7, 0.85, 1],
        intensity: 40,
        range: 10,
        innerAngle: (12 * Math.PI) / 180,
        outerAngle: (26 * Math.PI) / 180,
    },
);

// A textured equipment crate on the floor + a lit control console on the
// right wall — showcasing albedo/normal/metallic/roughness/emissive maps
// (see examples/demoAssets.ts).
const metalPlate = await loadMetalPlateTextures(ctx.device);
const crateMesh = new Mesh(ctx.device, cube(1, 1, 1), "equipment-crate");
const crateMaterial = new Material({
    baseColor: [1, 1, 1, 1],
    metallic: 1,
    roughness: 1,
    albedoTexture: metalPlate.albedo,
    normalTexture: metalPlate.normal,
    metallicTexture: metalPlate.metallic,
    roughnessTexture: metalPlate.roughness,
});
scene.add(crateMesh, crateMaterial, {position: vec3.create(1.2, 0.5, -2), rotationEuler: vec3.create(0, 0.3, 0)});

const consoleMesh = new Mesh(ctx.device, plane(1, 0.7), "control-console");
const consoleMaterial = new Material({
    baseColor: [0.05, 0.05, 0.05, 1],
    metallic: 0,
    roughness: 0.6,
    emissive: [3, 3, 3],
    emissiveTexture: makeEmissivePanelTexture(ctx.device),
});
// Right wall is at x = 4 with normal -X into the room; rotating the plane's
// default +Y normal by 90 degrees around Z points it at -X to face the room.
scene.add(consoleMesh, consoleMaterial, {
    position: vec3.create(3.85, 1.8, -2.5),
    rotationEuler: vec3.create(0, 0, Math.PI / 2),
});

let yaw = Math.PI;
let pitch = 0;
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
            }// Cycle AO on the leading edge only (ignore key-repeat).
            else if (e.keycode === SdlKeycode.O && !keys.has(SdlKeycode.O)) {
                aoIndex = (aoIndex + 1) % AO_CYCLE.length;
                forward.ao.technique = AO_CYCLE[aoIndex]!;
                keys.add(e.keycode);
            } else if (e.keycode === SdlKeycode.P && !keys.has(SdlKeycode.P)) {
                showProfiler = !showProfiler;
                keys.add(e.keycode);
            } else if (e.keycode !== undefined) {
                keys.add(e.keycode);
            }
        }
        if (e.type === SdlEventType.KeyUp && e.keycode !== undefined) {
            keys.delete(e.keycode);
        }
    }

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
    const moveSpeed = 3 * dt;
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
        `METIS-ENGINE // INTERIOR — WASD+QE fly, arrows look, O: AO=${AO_CYCLE[aoIndex]!.toUpperCase()}, P profiler, Esc quit`,
        "mono",
        16,
        12,
        24,
    );
    hud.render(encoder, frame.view, ctx.width, ctx.height, [0.85, 0.95, 1.0, 1.0]);

    cpuHistory.push(performance.now() - encodeStart);
    if (profiler) {
        gpuHistory.push(profiler.frameTotalMs);
    }
    if (showProfiler && profiler) {
        // Staging re-tessellates every glyph, so rebuild at a human-readable
        // rate and replay the geometry in between.
        if (debug.due()) {
            drawProfilerOverlay();
        }
        debug.render(encoder, frame.view, ctx.width, ctx.height);
    }

    // endFrame records the resolve/copy, so it must be encoded before submit;
    // the readback itself is kicked from the next beginFrame.
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
