// Headless (no SDL window) render + screenshot validation, via
// bun-webgpu-rs's native `readTexturePixels` / `saveTextureToFile` — see
// bun-webgpu-rs/tests/render.test.ts for the offscreen-rgba8unorm pattern
// this mirrors.
import {
    type GpuBindGroupLayout,
    type GpuCommandEncoder,
    type GpuDevice,
    type GpuRenderPipeline,
    type GPUTextureFormat,
    GPUShaderStage,
    readTexturePixels,
    savePixelsToFile,
    saveTextureToFile,
} from "bun-webgpu-rs";
import {
    ClusteredForwardRenderer,
    createDefaultPostProcessPipeline,
    createExteriorEnvironment,
    createInteriorEnvironment,
    cube,
    loadGltf,
    Material,
    Mesh,
    plane,
    type PostProcessFrameContext,
    type PostProcessPass,
    RenderContext,
    roomBox,
    Scene,
    uvSphere,
    VectorText,
} from "metis-engine/renderer";
import { mkdirSync } from "node:fs";
import { vec3 } from "wgpu-matrix";
import { loadMetalPlateTextures, makeEmissivePanelTexture } from "../examples/demoAssets";

const W = 800;
const H = 450;

const FONT_PATH = new URL("../../../assets/JetBrainsMono-Regular.ttf", import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/,
    "$1",
);

/** Shared render-and-screenshot harness: builds a scene, lets auto-exposure settle over a few frames, captures the final frame with a HUD label. */
async function renderToFile(name: string, hudLabel: string, buildScene: (device: GpuDevice) => Scene) {
    const ctx = await RenderContext.createOffscreen({width: W, height: H, label: `fixture-${name}`});
    const forward = new ClusteredForwardRenderer(ctx.device);
    const post = createDefaultPostProcessPipeline(ctx.device);
    const hud = new VectorText(ctx.device, ctx.outputFormat);
    hud.loadFont("mono", FONT_PATH);

    const scene = buildScene(ctx.device);
    scene.camera.setAspectFromSize(W, H);

    // Auto-exposure adapts over several frames — run a handful of ticks so
    // the fixture captures a settled result, not the first frame's transient.
    for (let i = 0; i < 30; i++) {
        const frame = ctx.beginFrame();
        const encoder = ctx.device.createCommandEncoder();
        forward.render(encoder, ctx.targets, scene);
        post.pipeline.run(encoder, {
            device: ctx.device,
            hdrColorView: ctx.targets.hdrColorResolvedView,
            depthView: ctx.targets.depthView,
            outputView: frame.view,
            outputFormat: frame.format,
            width: W,
            height: H,
            deltaTime: 1 / 30,
        });
        if (i === 29) {
            hud.drawText(hudLabel, "mono", 20, 16, 28);
            hud.render(encoder, frame.view, W, H, [0.85, 0.95, 1.0, 1.0]);
        }
        ctx.device.queue.submit([encoder.finish()]);
        await ctx.device.queue.onSubmittedWorkDone();
        frame.present();
    }

    const pixels = await readTexturePixels(ctx.device, ctx.captureTexture!);
    await savePixelsToFile(pixels, W, H, `test/output/${name}.png`);
    console.log(`${name}.png written, ${pixels.length} bytes of pixel data`);

    forward.destroy();
    post.pipeline.destroy();
    hud.destroy();
    ctx.destroy();
}

async function renderExterior() {
    await renderToFile("exterior", "METIS-ENGINE // EXTERIOR", (device) => {
        const scene = new Scene();
        scene.environment = createExteriorEnvironment();
        scene.camera.position = vec3.create(0, 1.2, 4.5);
        scene.camera.target = vec3.create(0, 0.3, 0);

        const hullMesh = new Mesh(device, uvSphere(1, 32, 48), "hull");
        const hullMaterial = new Material({baseColor: [0.62, 0.64, 0.67, 1], metallic: 0.85, roughness: 0.35});
        scene.add(hullMesh, hullMaterial);

        const padMesh = new Mesh(device, cube(6, 0.1, 6), "deck");
        const padMaterial = new Material({baseColor: [0.15, 0.15, 0.17, 1], metallic: 0.1, roughness: 0.8});
        scene.add(padMesh, padMaterial, {position: vec3.create(0, -1.05, 0)});

        scene.lights.push(
            {kind: "point", position: vec3.create(-1.6, 0.3, 0.8), color: [1, 0.15, 0.1], intensity: 6, range: 4},
            {kind: "point", position: vec3.create(1.6, 0.3, 0.8), color: [0.1, 1, 0.2], intensity: 6, range: 4},
        );

        return scene;
    });
}

/**
 * Spot lights: three cones on a flat deck, chosen so the render pins the parts
 * of the encoding that can silently go wrong.
 *
 * - **Narrow vs wide** (15°/45° outer) proves `outerAngle` actually sizes the
 *   pool, rather than the cone collapsing to the range sphere.
 * - **A soft cone** (5° inner inside a 45° outer) shows the inner→outer
 *   gradient; a hard-edged one (inner == outer) exercises the degenerate branch
 *   that would divide by zero without the `1e-4` clamp in `LightCuller.write`.
 * - **A point light** sits among them as the control: if the branchless
 *   `cosOuter = -2` encoding ever regresses, it is the one that goes dark.
 *
 * The sun is dimmed to near-nothing so the cones are the only real light.
 */
async function renderSpotlights() {
    await renderToFile("spotlights", "METIS-ENGINE // SPOTLIGHTS", (device) => {
        const scene = new Scene();
        scene.environment = createInteriorEnvironment();
        scene.environment.sunIntensity = 0.02;
        scene.environment.ambientIntensity = 0.015;
        scene.camera.position = vec3.create(0, 5.5, 7.5);
        scene.camera.target = vec3.create(0, 0, -0.5);

        const deck = new Mesh(device, plane(20, 20), "deck");
        const deckMaterial = new Material({baseColor: [0.5, 0.5, 0.54, 1], metallic: 0.0, roughness: 0.7});
        scene.add(deck, deckMaterial, {position: vec3.create(0, -1, 0)});

        // A sphere under the middle cone, so the cones fall on curved geometry
        // too rather than only a flat plane.
        const ball = new Mesh(device, uvSphere(0.7, 32, 48), "ball");
        const ballMaterial = new Material({baseColor: [0.8, 0.8, 0.82, 1], metallic: 0.1, roughness: 0.45});
        scene.add(ball, ballMaterial, {position: vec3.create(0, -0.3, 0)});

        const down = vec3.create(0, -1, 0);
        scene.lights.push(
            // Narrow + soft edge (wide inner→outer gradient).
            {
                kind: "spot",
                position: vec3.create(-4, 3.5, 0),
                direction: down,
                color: [1, 0.3, 0.25],
                intensity: 60,
                range: 12,
                innerAngle: (5 * Math.PI) / 180,
                outerAngle: (15 * Math.PI) / 180,
            },
            // Wide + soft.
            {
                kind: "spot",
                position: vec3.create(0, 3.5, 0),
                direction: down,
                color: [0.95, 0.95, 1],
                intensity: 60,
                range: 12,
                innerAngle: (5 * Math.PI) / 180,
                outerAngle: (45 * Math.PI) / 180,
            },
            // Hard-edged: inner == outer exercises the degenerate-cone clamp.
            {
                kind: "spot",
                position: vec3.create(4, 3.5, 0),
                direction: down,
                color: [0.25, 0.5, 1],
                intensity: 60,
                range: 12,
                innerAngle: (25 * Math.PI) / 180,
                outerAngle: (25 * Math.PI) / 180,
            },
            // Control: a plain point light must be unaffected by all of this.
            {kind: "point", position: vec3.create(0, 0.6, 5), color: [1, 0.9, 0.5], intensity: 12, range: 6},
        );

        return scene;
    });
}

async function renderInterior() {
    await renderToFile("interior", "METIS-ENGINE // INTERIOR", (device) => {
        const scene = new Scene();
        // Sunlight enters through the front-wall window: the room spans
        // z in [-5, 5] with the window cut into the wall at z = -5, so the
        // sun must travel in +Z (into the room) to pass through it.
        scene.environment = createInteriorEnvironment({
            sunDirection: vec3.normalize(vec3.create(0.15, -0.5, 0.85)),
        });
        scene.camera.position = vec3.create(0, 1.8, 3.5);
        scene.camera.target = vec3.create(0, 1.6, -5);

        const roomMesh = new Mesh(
            device,
            roomBox(8, 4, 10, {s0: 0.3, s1: 0.7, t0: 0.4, t1: 0.85}),
            "room",
        );
        const roomMaterial = new Material({baseColor: [0.55, 0.54, 0.52, 1], metallic: 0.0, roughness: 0.85});
        scene.add(roomMesh, roomMaterial);

        // Ceiling fixtures.
        scene.lights.push(
            {kind: "point", position: vec3.create(-2, 3.6, 1), color: [1, 0.92, 0.75], intensity: 5, range: 6},
            {kind: "point", position: vec3.create(2, 3.6, 1), color: [1, 0.92, 0.75], intensity: 5, range: 6},
        );

        return scene;
    });
}

/**
 * Test-only comparison pass: exposure * naive clamp, no ACES curve — the
 * "what if we skipped tonemapping" baseline the HDR-clip fixture compares
 * against. Not part of the engine's public post-process API.
 */
class NaiveClampPass implements PostProcessPass {
    readonly name = "naive-clamp";

    execute(encoder: GpuCommandEncoder, ctx: PostProcessFrameContext): void {
        const bindGroup = this.device.createBindGroup({
            layout: this.bindGroupLayout,
            entries: [{binding: 0, textureView: ctx.hdrColorView}],
        });
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: ctx.outputView,
                loadOp: "clear",
                storeOp: "store",
                clearValue: {r: 0, g: 0, b: 0, a: 1},
            }],
        });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3);
        pass.end();
    }

    private readonly pipeline: GpuRenderPipeline;
    private readonly bindGroupLayout: GpuBindGroupLayout;

    // Takes the output format rather than hardcoding one: the offscreen target
    // is sRGB, and a pipeline built against a mismatched format fails validation
    // silently (stderr only) while still producing a file.
    constructor(private readonly device: GpuDevice, outputFormat: GPUTextureFormat) {
        const module = device.createShaderModule({
            code: /* wgsl */ `
                @group(0) @binding(0) var hdrTex: texture_2d<f32>;
                struct VOut { @builtin(position) pos: vec4<f32> };
                @vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {
                    let x = f32((vi << 1u) & 2u) * 2.0 - 1.0;
                    let y = f32(vi & 2u) * 2.0 - 1.0;
                    var out: VOut;
                    out.pos = vec4<f32>(x, y, 0.0, 1.0);
                    return out;
                }
                @fragment fn fs(in: VOut) -> @location(0) vec4<f32> {
                    let texel = vec2<i32>(i32(in.pos.x), i32(in.pos.y));
                    let hdr = textureLoad(hdrTex, texel, 0).rgb;
                    return vec4<f32>(clamp(hdr, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
                }
            `,
        });
        this.bindGroupLayout = device.createBindGroupLayout({
            entries: [{binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {sampleType: "float"}}],
        });
        this.pipeline = device.createRenderPipeline({
            layout: device.createPipelineLayout({bindGroupLayouts: [this.bindGroupLayout]}),
            vertex: {module, entryPoint: "vs"},
            fragment: {module, entryPoint: "fs", targets: [{format: outputFormat}]},
            primitive: {topology: "triangle-list"},
        });
    }
}

function buildHdrClipScene(device: GpuDevice): Scene {
    const scene = new Scene();
    scene.environment = createExteriorEnvironment({ambientIntensity: 0.01, sunIntensity: 1.5});
    scene.camera.position = vec3.create(0, 1.5, 3);
    scene.camera.target = vec3.create(0, 0, 0);

    const floorMesh = new Mesh(device, plane(6, 6), "floor");
    const floorMaterial = new Material({baseColor: [0.5, 0.5, 0.52, 1], metallic: 0.0, roughness: 0.9});
    scene.add(floorMesh, floorMaterial);

    // Intentionally overbright — a naive clamp will flatten this to a hard white disc.
    scene.lights.push({kind: "point", position: vec3.create(0, 0.4, 0), color: [1, 0.95, 0.85], intensity: 80, range: 5});

    return scene;
}

/** Compares the default (auto-exposure + ACES) pipeline against a naive exposure*clamp baseline on an intentionally overbright light. */
async function renderHdrClipComparison() {
    for (const variant of ["tonemapped", "naive-clamp"] as const) {
        const ctx = await RenderContext.createOffscreen({width: W, height: H, label: `fixture-hdr-clip-${variant}`});
        const forward = new ClusteredForwardRenderer(ctx.device);
        const naive = variant === "naive-clamp" ? new NaiveClampPass(ctx.device, ctx.outputFormat) : null;
        const post = variant === "tonemapped" ? createDefaultPostProcessPipeline(ctx.device) : null;
        const hud = new VectorText(ctx.device, ctx.outputFormat);
        hud.loadFont("mono", FONT_PATH);

        const scene = buildHdrClipScene(ctx.device);
        scene.camera.setAspectFromSize(W, H);

        for (let i = 0; i < 30; i++) {
            const frame = ctx.beginFrame();
            const encoder = ctx.device.createCommandEncoder();
            forward.render(encoder, ctx.targets, scene);
            const frameCtx = {
                device: ctx.device,
                hdrColorView: ctx.targets.hdrColorResolvedView,
                depthView: ctx.targets.depthView,
                outputView: frame.view,
                outputFormat: frame.format,
                width: W,
                height: H,
                deltaTime: 1 / 30,
            };
            if (post) {
                post.pipeline.run(encoder, frameCtx);
            } else {
                naive!.execute(encoder, frameCtx);
            }
            if (i === 29) {
                hud.drawText(`METIS-ENGINE // HDR-CLIP (${variant})`, "mono", 18, 16, 28);
                hud.render(encoder, frame.view, W, H, [0.85, 0.95, 1.0, 1.0]);
            }
            ctx.device.queue.submit([encoder.finish()]);
            await ctx.device.queue.onSubmittedWorkDone();
            frame.present();
        }

        const name = `hdr-clip-${variant}`;
        await saveTextureToFile(ctx.device, ctx.captureTexture!, `test/output/${name}.png`);
        console.log(`${name}.png written`);

        forward.destroy();
        post?.pipeline.destroy();
        hud.destroy();
        ctx.destroy();
    }
}

const GLTF_CACHE_DIR = new URL("assets-cache/Box/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const GLTF_SOURCE = "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Box/glTF/";

/** Downloads the Khronos "Box" sample glTF into a local cache directory (once) and returns the cached .gltf path. Stretch goal — see CLAUDE.md's known limitations for why only this one plain, texture-free sample is supported. */
async function ensureGltfSampleCached(): Promise<string> {
    mkdirSync(GLTF_CACHE_DIR, {recursive: true});
    const gltfPath = `${GLTF_CACHE_DIR}Box.gltf`;
    for (const file of ["Box.gltf", "Box0.bin"]) {
        const dest = `${GLTF_CACHE_DIR}${file}`;
        if (await Bun.file(dest).exists()) {
            continue;
        }
        const response = await fetch(`${GLTF_SOURCE}${file}`);
        if (!response.ok) {
            throw new Error(`failed to download ${file}: ${response.status}`);
        }
        await Bun.write(dest, await response.arrayBuffer());
    }
    return gltfPath;
}

async function renderGltfDemo() {
    const ctx = await RenderContext.createOffscreen({width: W, height: H, label: "fixture-gltf"});
    const forward = new ClusteredForwardRenderer(ctx.device);
    const post = createDefaultPostProcessPipeline(ctx.device);
    const hud = new VectorText(ctx.device, ctx.outputFormat);
    hud.loadFont("mono", FONT_PATH);

    const scene = new Scene();
    scene.environment = createExteriorEnvironment({ambientIntensity: 0.05});
    scene.camera.position = vec3.create(2.5, 2, 3);
    scene.camera.target = vec3.create(0, 0, 0);
    scene.camera.setAspectFromSize(W, H);

    const gltfPath = await ensureGltfSampleCached();
    const instances = await loadGltf(ctx.device, gltfPath);
    scene.instances.push(...instances);
    console.log(`gltf demo: loaded ${instances.length} instance(s) from ${gltfPath}`);

    for (let i = 0; i < 30; i++) {
        const frame = ctx.beginFrame();
        const encoder = ctx.device.createCommandEncoder();
        forward.render(encoder, ctx.targets, scene);
        post.pipeline.run(encoder, {
            device: ctx.device,
            hdrColorView: ctx.targets.hdrColorResolvedView,
            depthView: ctx.targets.depthView,
            outputView: frame.view,
            outputFormat: frame.format,
            width: W,
            height: H,
            deltaTime: 1 / 30,
        });
        if (i === 29) {
            hud.drawText("METIS-ENGINE // GLTF (Khronos Box sample)", "mono", 18, 16, 28);
            hud.render(encoder, frame.view, W, H, [0.85, 0.95, 1.0, 1.0]);
        }
        ctx.device.queue.submit([encoder.finish()]);
        await ctx.device.queue.onSubmittedWorkDone();
        frame.present();
    }

    await saveTextureToFile(ctx.device, ctx.captureTexture!, "test/output/gltf-box.png");
    console.log("gltf-box.png written");

    forward.destroy();
    post.pipeline.destroy();
    hud.destroy();
    ctx.destroy();
}

async function renderTexturedDemo() {
    const ctx = await RenderContext.createOffscreen({width: W, height: H, label: "fixture-textured"});
    const forward = new ClusteredForwardRenderer(ctx.device);
    const post = createDefaultPostProcessPipeline(ctx.device);
    const hud = new VectorText(ctx.device, ctx.outputFormat);
    hud.loadFont("mono", FONT_PATH);

    const scene = new Scene();
    scene.environment = createExteriorEnvironment({ambientIntensity: 0.03});
    scene.camera.position = vec3.create(0, 1.0, 4.2);
    scene.camera.target = vec3.create(0.1, 0.15, 0);
    scene.camera.setAspectFromSize(W, H);

    const metalPlate = await loadMetalPlateTextures(ctx.device);
    console.log("loaded metal_plate_02 texture set");

    const panelMesh = new Mesh(ctx.device, cube(1.8, 1.8, 1.8), "textured-cube");
    const panelMaterial = new Material({
        baseColor: [1, 1, 1, 1],
        metallic: 1,
        roughness: 1,
        albedoTexture: metalPlate.albedo,
        normalTexture: metalPlate.normal,
        metallicTexture: metalPlate.metallic,
        roughnessTexture: metalPlate.roughness,
    });
    scene.add(panelMesh, panelMaterial, {position: vec3.create(-1.2, 0, 0), rotationEuler: vec3.create(0.25, 0.5, 0)});

    const emissiveMesh = new Mesh(ctx.device, plane(1.2, 0.8), "emissive-panel");
    const emissiveMaterial = new Material({
        baseColor: [0.05, 0.05, 0.05, 1],
        metallic: 0,
        roughness: 0.6,
        emissive: [3, 3, 3],
        emissiveTexture: makeEmissivePanelTexture(ctx.device),
    });
    scene.add(emissiveMesh, emissiveMaterial, {
        position: vec3.create(1.3, 0.2, 0),
        rotationEuler: vec3.create(Math.PI / 2, 0, 0),
    });

    scene.lights.push({kind: "point", position: vec3.create(1.5, 2, 3), color: [1, 0.95, 0.85], intensity: 8, range: 8});

    for (let i = 0; i < 30; i++) {
        const frame = ctx.beginFrame();
        const encoder = ctx.device.createCommandEncoder();
        forward.render(encoder, ctx.targets, scene);
        post.pipeline.run(encoder, {
            device: ctx.device,
            hdrColorView: ctx.targets.hdrColorResolvedView,
            depthView: ctx.targets.depthView,
            outputView: frame.view,
            outputFormat: frame.format,
            width: W,
            height: H,
            deltaTime: 1 / 30,
        });
        if (i === 29) {
            hud.drawText("METIS-ENGINE // TEXTURED (Poly Haven metal_plate_02, CC0)", "mono", 16, 16, 28);
            hud.render(encoder, frame.view, W, H, [0.85, 0.95, 1.0, 1.0]);
        }
        ctx.device.queue.submit([encoder.finish()]);
        await ctx.device.queue.onSubmittedWorkDone();
        frame.present();
    }

    await saveTextureToFile(ctx.device, ctx.captureTexture!, "test/output/textured.png");
    console.log("textured.png written");

    forward.destroy();
    post.pipeline.destroy();
    hud.destroy();
    ctx.destroy();
}

await renderExterior();
await renderSpotlights();
await renderInterior();
await renderHdrClipComparison();
await renderGltfDemo();
await renderTexturedDemo();
