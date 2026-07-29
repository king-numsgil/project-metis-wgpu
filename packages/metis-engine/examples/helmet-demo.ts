// Interactive windowed demo — the Khronos "DamagedHelmet" under a field of 100
// orbiting point lights, on an orbiting camera.
//
// This is the demo for two things at once, and they are deliberately in the same
// scene because each makes the other observable:
//
//   1. **The glTF importer.** Everything you see on the helmet came out of one
//      `.glb`: base colour, normal, metallic-roughness, occlusion and emissive
//      maps, decoded and uploaded in Rust. The model ships **no TANGENT
//      accessor**, so its tangent basis was synthesised by the importer — and a
//      wrong basis shows up here as normal-map detail that lights from the wrong
//      side as the camera orbits, which is exactly what an orbiting camera over
//      a static light field is good at exposing.
//
//   2. **Clustered forward ("Forward+").** 100 lights is far past what a plain
//      forward renderer would loop over per fragment. The cluster grid means a
//      fragment only shades the handful of lights whose volumes reach its own
//      cluster, so pressing `=` up to the cap should cost far less than 4x what
//      25 lights costs. Press `P` and watch the `forward` span rather than
//      guessing.
//
// It also runs the engine's whole shadow stack at once: a dim directional sun
// through the four CSM cascades, plus three coloured shadow-casting spot lights
// orbiting the helmet.
//
// What to look for:
//
//   - A field of distinct coloured pools receding to the horizon, each bounded
//     by its light's `range`, sliding as the lights orbit. A pool with a hard
//     *rectangular* edge instead of a round one would mean cluster bounds
//     leaking into the shading.
//   - Specular highlights on the helmet's metal tracking the bulbs above it, and
//     normal-mapped surface detail that stays put as the camera goes round.
//   - **Shadows.** The sun grounds the helmet with a contact shadow; the three
//     spots throw coloured spokes out from it, each the *complement* of its own
//     light (a red spot's shadow is where red is missing). The spokes must stay
//     anchored to the helmet as the spots orbit — one that swims or lags is the
//     thing to report. `K` toggles the spot casters for a clean A/B.
//   - Press `-` down to 25 lights: the field thins but the helmet stays lit (the
//     first ten lights are its own — see the field setup). Watch the `forward`
//     span in the profiler while you do it; that is the whole Forward+ claim,
//     measured rather than asserted.
//   - `L` toggles the sun, so you can see what the point field alone does.
//
// **The 100 bulbs are `castsShadow = false`.** Without that they speckle every
// lit surface with their own little shadows and the real ones are lost in the
// noise — which is what this demo looked like before the flag existed.
//
// Controls: arrows orbit, W/S dolly, Space pauses the orbit, `-`/`=` change the
// light count, B toggles the bulbs, L the sun, K the spot casters, P the GPU
// profiler, Escape/close to quit.
import { SdlEventType, SdlKeycode, sdlPollEvents } from "metis-native";
import {
    ClusteredForwardRenderer,
    createDefaultPostProcessPipeline,
    createExteriorEnvironment,
    DebugOverlay,
    FrameLimiter,
    GpuProfiler,
    History,
    type Light,
    MAX_LIGHTS,
    Material,
    Mesh,
    mulberry32,
    plane,
    profileSpansToRows,
    RenderContext,
    Scene,
    type SceneInstance,
    type SpotLight,
    uvSphere,
    VectorText,
    loadGltf,
    vec3f,
} from "metis-engine/renderer";
import { Vec3 } from "metis-data";
import { cacheDamagedHelmet } from "./demoAssets";

const FONT_PATH = new URL("../../../assets/JetBrainsMono-Regular.ttf", import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/,
    "$1",
);

/** Lights created up front. `-`/`=` change how many of them are *active*. */
const LIGHT_COUNT = 100;
/** The first N orbit close enough to light the helmet; see the field setup below. */
const INNER_LIGHTS = 10;
/** The helmet is ~1 unit in radius; the light shell and orbit are sized off that. */
const FOCUS = vec3f(0, 0.1, 0);

// `immediate` present mode for the same reason as the other demos: this is a
// development tool, so present back-pressure must stay out of the profiler's
// numbers. See CLAUDE.md's "Present mode" section.
const ctx = await RenderContext.createWindowed("metis-engine — glTF helmet + 100 lights", {
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

// Auto-exposure meters the whole frame, and half of this one is black sky —
// which drags the average down and makes it *over*-expose the lit half until the
// deck is white and every bulb clips. `exposureCompensation` is the knob for
// exactly that; without it no amount of dimming the lights fixes the image,
// because the metering compensates right back. This was the single biggest
// difference between an unreadable demo and this one.
post.autoExposure.exposureCompensation = 0.45;

const scene = new Scene();
// A **dim** sun, not a bright one, and not none. It has one job here: ground the
// helmet with a contact shadow so it sits on the deck instead of floating above
// it. Turned up, its key light plus the ambient fill flatten exactly what the
// point field is here to show; turned off entirely there is no directional
// shadow at all and the scene reads as weightless. 0.16 is the level where the
// shadow is unmistakable and the coloured pools still dominate.
//
// Ambient stays near zero on purpose: a visible ambient term would fill the
// helmet's unlit side with flat grey and hide both the point lights and the
// shadows.
const SUN_INTENSITY = 0.16;
scene.environment = createExteriorEnvironment({
    sunDirection: Vec3.normalize(vec3f(), vec3f(-0.3, -1, -0.55)),
    sunIntensity: SUN_INTENSITY,
    ambientIntensity: 0.002,
});
scene.camera.setAspectFromSize(ctx.width, ctx.height);

// ── the helmet ──────────────────────────────────────────────────────────────

const helmetPath = await cacheDamagedHelmet();
// One call: parse the GLB, decode five 2K JPEGs, upload every buffer and
// texture, and hand back SceneInstances with materials already wired. All of it
// happens in Rust on a worker thread — see metis-native's DOC.md §8b.
const helmetInstances: SceneInstance[] = await loadGltf(ctx.device, helmetPath, {label: "helmet"});
scene.instances.push(...helmetInstances);
console.log(
    `[demo] loaded ${helmetInstances.length} instance(s) from DamagedHelmet.glb — ` +
        `${helmetInstances[0]?.mesh.indexCount ?? 0} indices`,
);

// DamagedHelmet is authored Z-up (its own node carries the +X 90deg rotation
// that most viewers apply). It arrives with that baked into
// `modelMatrixOverride`, so it is already upright here — no correction needed,
// and adding one would tip it onto its back.

// A large dark deck under it, purely so the light pools have something to land
// on. Without it the lights are only visible where they graze the helmet, and
// the whole clustered-lighting point is invisible.
const deckMesh = new Mesh(ctx.device, plane(60, 60), "deck");
const deckMaterial = new Material({baseColor: [0.13, 0.135, 0.15, 1], metallic: 0.05, roughness: 0.62});
const deck = scene.add(deckMesh, deckMaterial, {position: vec3f(0, -1.3, 0)});
// Nothing is under the deck, so drawing a 60x60 plane into four cascades and
// three spot layers buys nothing but a self-shadowing hazard.
deck.castsShadow = false;

// ── shadow-casting spots ────────────────────────────────────────────────────
//
// Three, not four: `MAX_SHADOW_SPOTS` is 4, and leaving one free means the cap
// warning is not permanently one edit away. Coloured rather than white because a
// white shadow is just "darker", while a coloured one is the region where *that
// specific light* is missing — so a spoke pointing the wrong way, lagging, or
// indexed to the wrong shadow layer is visible as the wrong hue in the wrong
// place. Same reasoning as `demo:spots`, which is the dedicated test for this.

interface OrbitingSpot {
    phase: number;
    speed: number;
    radius: number;
    height: number;
    light: SpotLight;
}

const SPOT_PALETTE: [number, number, number][] = [
    [1.0, 0.24, 0.18],
    [0.22, 1.0, 0.4],
    [0.3, 0.5, 1.0],
];
const spots: OrbitingSpot[] = SPOT_PALETTE.map((color, i) => ({
    phase: (i / SPOT_PALETTE.length) * Math.PI * 2,
    // Counter-rotating, and slower than the point field, so the spokes sweep
    // across each other rather than travelling together.
    speed: i % 2 === 0 ? 0.28 : -0.2,
    radius: 3.4 + (i % 2) * 0.5,
    height: 3.6 + (i % 3) * 0.35,
    light: {
        kind: "spot",
        position: vec3f(0, 0, 0),
        direction: vec3f(0, -1, 0),
        color,
        intensity: 42,
        range: 14,
        // Keep `outerAngle` well under the light's elevation angle above the
        // focus (~44-47deg here) or the cone's upper edge tips above horizontal
        // and it stops being a spotlight aimed at something — see demo:spots.
        innerAngle: (12 * Math.PI) / 180,
        outerAngle: (30 * Math.PI) / 180,
        castsShadow: true,
    },
}));
for (const s of spots) {
    scene.lights.push(s.light);
}

/** Places each spot on its orbit and re-aims it at the helmet. */
function animateSpots(t: number) {
    for (const s of spots) {
        const a = s.phase + s.speed * t;
        const x = Math.cos(a) * s.radius;
        const z = Math.sin(a) * s.radius;
        Vec3.set(s.light.position, x, s.height, z);
        // `direction` is the way light TRAVELS, so it points from the light
        // toward the focus, not the other way round.
        Vec3.set(
            s.light.direction,
            FOCUS.getComponent(0) - x,
            FOCUS.getComponent(1) - s.height,
            FOCUS.getComponent(2) - z,
        );
    }
}

// ── the light field ─────────────────────────────────────────────────────────

interface OrbitingLight {
    light: Light;
    /** Radius of this light's own orbit about the vertical axis through FOCUS. */
    radius: number;
    /** Signed, so the field shears rather than rotating as one rigid shell. */
    speed: number;
    phase: number;
    baseY: number;
    bobAmp: number;
    bobSpeed: number;
    bulb: SceneInstance;
}

// Seeded, so the field is identical every run — a demo whose scene changes
// between launches is useless for eyeballing a rendering change.
const rand = mulberry32(0xbeef_5eed);

// One shared low-poly sphere for every bulb: 100 extra draws is the cost of
// making the lights visible, and it is not worth 100 meshes as well.
const bulbMesh = new Mesh(ctx.device, uvSphere(0.055, 8, 12), "light-bulb");

const lights: OrbitingLight[] = [];
for (let i = 0; i < LIGHT_COUNT; i++) {
    // Alternating warm/cool, so neighbouring pools are distinguishable and
    // overlaps shift hue rather than just getting brighter.
    const warm = i % 2 === 0;
    const color: [number, number, number] = warm
        ? [1.0, 0.5 + 0.35 * rand(), 0.28 + 0.22 * rand()]
        : [0.3 + 0.2 * rand(), 0.6 + 0.3 * rand(), 1.0];

    // **The field is split, and it took several attempts to get here.** A shell
    // of 100 lights packed around the helmet does *not* look like 100 lights: on
    // any nearby surface their pools merge into one white wash, and the demo
    // reads as a badly-exposed spotlight. Distinct pools need the lights spread
    // over an area much larger than the subject. But spread them *all* out and
    // nothing is close enough to light the helmet, which then sits there dark.
    //
    // So: the first `INNER_LIGHTS` orbit close and high, above the helmet's
    // equator, and are the ones actually shading it. The rest are scattered
    // across the deck — with `sqrt(rand())`, which distributes them uniformly by
    // *area* rather than clumping them at the centre (a plain `rand()` radius
    // puts half the lights inside the inner 25% of the disc).
    //
    // Because the inner ones are first, `-` never takes them away: dropping to
    // 25 lights thins the field without unlighting the hero object.
    const inner = i < INNER_LIGHTS;
    const radius = inner ? 1.55 + rand() * 1.05 : 3.2 + 18 * Math.sqrt(rand());
    const baseY = inner ? 0.35 + rand() * 1.5 : -0.85 + rand() * 2.3;
    const light: Light = {
        kind: "point",
        position: vec3f(0, baseY, 0),
        color,
        // Modest intensity, short range: the interesting case for a cluster grid
        // is many small overlapping volumes, not a few big ones. A large `range`
        // would put every light in every cluster and quietly turn this back into
        // brute-force forward shading — which would still look identical, and be
        // the thing the profiler is there to catch.
        intensity: (inner ? 1.2 : 1.0) + rand() * 1.1,
        range: (inner ? 2.3 : 1.7) + rand() * 1.1,
    };
    scene.lights.push(light);

    // The bulb is emissive-only so it reads as the source rather than as a lit
    // object — it is not a light source itself (emissive lights nothing here).
    const bulbMaterial = new Material({
        baseColor: [0, 0, 0, 1],
        metallic: 0,
        roughness: 1,
        emissive: [color[0] * 0.55, color[1] * 0.55, color[2] * 0.55],
    });
    const bulb = scene.add(bulbMesh, bulbMaterial, {position: vec3f(0, baseY, 0)});
    // The whole reason `SceneInstance.castsShadow` exists — see this file's
    // header. A hundred of these in the shadow passes turns every lit surface
    // into confetti.
    bulb.castsShadow = false;

    lights.push({
        light,
        radius,
        speed: (rand() * 2 - 1) * 0.55,
        phase: rand() * Math.PI * 2,
        baseY,
        bobAmp: 0.15 + rand() * 0.5,
        bobSpeed: 0.6 + rand() * 1.3,
        bulb,
    });
}

let activeLights = LIGHT_COUNT;

/**
 * Move every active light onto its orbit, and park the deactivated ones far
 * below the deck.
 *
 * **Lights are parked, bulbs are removed, and the asymmetry is deliberate.**
 * `scene.lights`'s *order* is load-bearing (see `Scene.lights` — it decides
 * which spot owns which shadow layer), so splicing it on every keypress would
 * reshuffle indices; parking a light 10 km down puts it outside every cluster
 * instead, which costs one sphere test. `scene.instances` has no such ordering
 * rule, so a deactivated bulb is taken out of it entirely by `syncBulbs()` —
 * see there for why parking it too was wrong.
 */
function animateLights(t: number) {
    for (let i = 0; i < lights.length; i++) {
        const l = lights[i]!;
        const active = i < activeLights;
        if (!active) {
            Vec3.set(l.light.position, 0, -1e4, 0);
            continue;
        }
        const a = l.phase + l.speed * t;
        const x = FOCUS.getComponent(0) + Math.cos(a) * l.radius;
        const z = FOCUS.getComponent(2) + Math.sin(a) * l.radius;
        const y = l.baseY + Math.sin(t * l.bobSpeed + l.phase) * l.bobAmp;
        Vec3.set(l.light.position, x, y, z);
        Vec3.set(l.bulb.transform.position, x, y, z);
    }
}

// ── orbiting camera ─────────────────────────────────────────────────────────
//
// Unlike the other demos this is an orbit rig, not a fly camera: the whole point
// is to circle one object, and a fly cam makes "does the normal map light
// correctly from every angle" a manual chore.

let azimuth = 0.6;
let elevation = 0.34;
// Far enough back to see the light field recede, not so far the helmet is a
// speck. Dollying inside ~3 starts putting bulbs between the camera and the
// helmet, where they fill the screen.
let distance = 7.5;
let orbitPaused = false;
let orbitTime = 0;
const ORBIT_SPEED = 0.22;

function updateCamera() {
    const a = azimuth + orbitTime * ORBIT_SPEED;
    const cosE = Math.cos(elevation);
    Vec3.set(
        scene.camera.position,
        FOCUS.getComponent(0) + Math.sin(a) * cosE * distance,
        FOCUS.getComponent(1) + Math.sin(elevation) * distance,
        FOCUS.getComponent(2) + Math.cos(a) * cosE * distance,
    );
    Vec3.copy(scene.camera.target, FOCUS);
}

// ── loop ────────────────────────────────────────────────────────────────────

let bulbsVisible = true;
let sunOn = true;
let spotShadowsOn = true;
const keys = new Set<number>();
let running = true;
let lastTime = performance.now();

/**
 * Rebuild which bulbs are in `scene.instances`: the ones belonging to an active
 * light, and only while `B` has them switched on.
 *
 * **This used to park deactivated bulbs 10 km below the deck instead of removing
 * them, and that was a real bug** — off-screen is not undrawn. There is no
 * frustum culling in the forward pass, so all 100 bulbs kept issuing draw calls
 * (and per-draw profiler zones) no matter what `-` was set to. It was invisible
 * on screen and invisible in the frame time, because a bulb behind the camera
 * rasterises nothing; the profiler is what exposed it, by honestly reporting
 * `light-bulb x100` while the HUD said 25 lights.
 *
 * There is no per-instance visibility flag to reach for — membership of
 * `scene.instances` *is* the flag.
 */
function syncBulbs() {
    const bulbSet = new Set(lights.map((l) => l.bulb));
    scene.instances = scene.instances.filter((i) => !bulbSet.has(i));
    if (!bulbsVisible) {
        return;
    }
    for (let i = 0; i < activeLights; i++) {
        scene.instances.push(lights[i]!.bulb);
    }
}

while (running) {
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    for (const e of sdlPollEvents()) {
        if (e.type === SdlEventType.WindowCloseRequested || e.type === SdlEventType.Quit) {
            running = false;
        }
        if (e.type === SdlEventType.KeyDown && e.keycode !== undefined) {
            const fresh = !keys.has(e.keycode);
            keys.add(e.keycode);
            if (e.keycode === SdlKeycode.Escape) {
                running = false;
            } else if (e.keycode === SdlKeycode.P && fresh) {
                showProfiler = !showProfiler;
            } else if (e.keycode === SdlKeycode.Space && fresh) {
                orbitPaused = !orbitPaused;
            } else if (e.keycode === SdlKeycode.B && fresh) {
                bulbsVisible = !bulbsVisible;
                syncBulbs();
            } else if (e.keycode === SdlKeycode.L && fresh) {
                sunOn = !sunOn;
                scene.environment.sunIntensity = sunOn ? SUN_INTENSITY : 0;
            } else if (e.keycode === SdlKeycode.K && fresh) {
                // The A/B: everything else identical, only the spot shadows change.
                spotShadowsOn = !spotShadowsOn;
                for (const s of spots) {
                    s.light.castsShadow = spotShadowsOn;
                }
            } else if (e.keycode === SdlKeycode.Minus && fresh) {
                activeLights = Math.max(0, activeLights - 25);
                syncBulbs();
            } else if (e.keycode === SdlKeycode.Equals && fresh) {
                activeLights = Math.min(Math.min(LIGHT_COUNT, MAX_LIGHTS), activeLights + 25);
                syncBulbs();
            }
        }
        if (e.type === SdlEventType.KeyUp && e.keycode !== undefined) {
            keys.delete(e.keycode);
        }
    }

    const turn = 1.2 * dt;
    if (keys.has(SdlKeycode.Left)) {
        azimuth -= turn;
    }
    if (keys.has(SdlKeycode.Right)) {
        azimuth += turn;
    }
    if (keys.has(SdlKeycode.Up)) {
        elevation = Math.min(elevation + turn, 1.45);
    }
    if (keys.has(SdlKeycode.Down)) {
        elevation = Math.max(elevation - turn, -1.0);
    }
    if (keys.has(SdlKeycode.W)) {
        distance = Math.max(distance - 4 * dt, 3);
    }
    if (keys.has(SdlKeycode.S)) {
        distance = Math.min(distance + 4 * dt, 26);
    }

    if (!orbitPaused) {
        orbitTime += dt;
    }
    animateLights(orbitTime);
    animateSpots(orbitTime);
    updateCamera();

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
        `METIS-ENGINE // glTF DamagedHelmet — ${activeLights}/${LIGHT_COUNT} lights (-/=)` +
            ` | sun ${sunOn ? "ON" : "OFF"} (L) | ${spots.length} spot casters ` +
            `${spotShadowsOn ? "ON" : "OFF"} (K) | bulbs ${bulbsVisible ? "ON" : "OFF"} (B)` +
            `${orbitPaused ? " | PAUSED (Space)" : ""}`,
        "mono",
        16,
        12,
        24,
    );
    hud.drawText(
        `${scene.instances.length} draws | shadow draws ` +
            `${forward.spotShadows.lastDrawnInstances}/${forward.spotShadows.lastCandidateInstances}` +
            ` | arrows orbit, W/S dolly, Space pause, P profiler, Esc quit`,
        "mono",
        14,
        12,
        46,
    );
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
