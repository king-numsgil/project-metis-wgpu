// Interactive windowed demo — ship exterior: hard directional sun, near-zero
// ambient, a couple of point "running lights". WASD+QE to fly, Escape/close
// to quit. Mirrors metis-game/src/index.ts's SDL event-loop pattern.
import { SdlEventType, SdlKeycode, sdlPollEvents } from "bun-webgpu-rs";
import {
    ClusteredForwardRenderer,
    createDefaultPostProcessPipeline,
    createExteriorEnvironment,
    cube,
    Material,
    Mesh,
    plane,
    RenderContext,
    Scene,
    uvSphere,
    VectorText,
} from "metis-engine/renderer";
import { scheduler } from "node:timers/promises";
import { vec3 } from "wgpu-matrix";
import { loadMetalPlateTextures, makeEmissivePanelTexture } from "./demoAssets";

const FONT_PATH = new URL("../../../assets/JetBrainsMono-Regular.ttf", import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/,
    "$1",
);

const ctx = await RenderContext.createWindowed("metis-engine — exterior demo", {width: 1280, height: 720});
const forward = new ClusteredForwardRenderer(ctx.device);
const post = createDefaultPostProcessPipeline(ctx.device);
const hud = new VectorText(ctx.device, ctx.outputFormat);
hud.loadFont("mono", FONT_PATH);

const scene = new Scene();
scene.environment = createExteriorEnvironment();
scene.camera.position = vec3.create(0, 1.2, 4.5);
scene.camera.target = vec3.create(0, 0.3, 0);
scene.camera.setAspectFromSize(ctx.width, ctx.height);

const hullMesh = new Mesh(ctx.device, uvSphere(1, 32, 48), "hull");
const hullMaterial = new Material({baseColor: [0.62, 0.64, 0.67, 1], metallic: 0.85, roughness: 0.35});
scene.add(hullMesh, hullMaterial);

const padMesh = new Mesh(ctx.device, cube(6, 0.1, 6), "deck");
const padMaterial = new Material({baseColor: [0.15, 0.15, 0.17, 1], metallic: 0.1, roughness: 0.8});
scene.add(padMesh, padMaterial, {position: vec3.create(0, -1.05, 0)});

scene.pointLights.push(
    {position: vec3.create(-1.6, 0.3, 0.8), color: [1, 0.15, 0.1], intensity: 6, range: 4},
    {position: vec3.create(1.6, 0.3, 0.8), color: [0.1, 1, 0.2], intensity: 6, range: 4},
);

// A textured piece of hull debris + a lit nav-beacon panel — showcasing
// albedo/normal/metallic/roughness/emissive maps (see examples/demoAssets.ts).
const metalPlate = await loadMetalPlateTextures(ctx.device);
const debrisMesh = new Mesh(ctx.device, cube(0.8, 0.8, 0.8), "hull-debris");
const debrisMaterial = new Material({
    baseColor: [1, 1, 1, 1],
    metallic: 1,
    roughness: 1,
    albedoTexture: metalPlate.albedo,
    normalTexture: metalPlate.normal,
    metallicTexture: metalPlate.metallic,
    roughnessTexture: metalPlate.roughness,
});
scene.add(debrisMesh, debrisMaterial, {
    position: vec3.create(2.2, 0.6, -1.5),
    rotationEuler: vec3.create(0.4, 0.9, 0.2),
});

const beaconMesh = new Mesh(ctx.device, plane(0.6, 0.4), "nav-beacon-panel");
const beaconMaterial = new Material({
    baseColor: [0.05, 0.05, 0.05, 1],
    metallic: 0,
    roughness: 0.6,
    emissive: [3, 3, 3],
    emissiveTexture: makeEmissivePanelTexture(ctx.device),
});
scene.add(beaconMesh, beaconMaterial, {
    position: vec3.create(-0.9, 1.05, 0),
    rotationEuler: vec3.create(Math.PI / 2, 0.3, 0),
});

let yaw = Math.PI; // facing -Z toward the origin from the default +Z-ish camera position
let pitch = -0.1;
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
            } else if (e.keycode !== undefined) {
                keys.add(e.keycode);
            }
        }
        if (e.type === SdlEventType.KeyUp && e.keycode !== undefined) {
            keys.delete(e.keycode);
        }
    }

    const turnSpeed = 1.5 * dt;
    if (keys.has(SdlKeycode.Left)) {
        yaw -= turnSpeed;
    }
    if (keys.has(SdlKeycode.Right)) {
        yaw += turnSpeed;
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
    const encoder = ctx.device.createCommandEncoder();
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
    });
    hud.drawText("METIS-ENGINE // EXTERIOR — WASD+QE fly, arrows look, Esc quit", "mono", 16, 12, 24);
    hud.render(encoder, frame.view, ctx.width, ctx.height, [0.85, 0.95, 1.0, 1.0]);
    ctx.device.queue.submit([encoder.finish()]);
    frame.present();
    await scheduler.yield();
}

ctx.destroy();
