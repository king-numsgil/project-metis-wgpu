// Standalone diagnostic for the Linux texture-corruption + buffer-overflow
// report. Deliberately isolated: no window, no renderer, no engine — just the
// SDL3_image -> wgpu upload path, so a failure here pins the bug to that path
// rather than to anything downstream.
//
//   bun run tests/image-load-diagnostic.ts <image.png> [more.png ...]
//
// It answers three questions in order, and the FIRST one that fails tells you
// which bug you have:
//
//   1. Is a single load self-consistent?  Load the same file twice, serially,
//      and compare the bytes. A difference means the decode/upload is
//      nondeterministic on its own — no concurrency needed to break it.
//   2. Does concurrency break it?  Load N copies with Promise.all (what
//      demoAssets.ts does) and compare each against the serial reference. A
//      difference here and not in (1) means a data race in the parallel path.
//   3. Does it survive many loads?  Repeat, to smoke out a heap overflow that
//      only aborts once an allocator happens to reuse the clobbered block.
//
// Every load also prints dimensions + a content fingerprint, so a corrupt
// result is visible even without a known-good reference to compare against.
import { GPUBufferUsage, GPUMapMode, GPUTextureUsage, ImageColorSpace, requestAdapter, sdlImageLoadTexture } from "../index.js";

const files = process.argv.slice(2);
if (files.length === 0) {
    console.error("usage: bun run tests/image-load-diagnostic.ts <image.png> [...]");
    process.exit(1);
}

const adapter = await requestAdapter({powerPreference: "high-performance"});
if (!adapter) {
    console.error("no adapter");
    process.exit(1);
}
const info = adapter.info;
console.log(`adapter: ${info.description || "?"}  (${info.backendType}, ${info.deviceType})`);
if (info.deviceType === "Cpu") {
    console.log("  ^ NOTE: software rasterizer. Correctness still meaningful; timings are not.");
}
const device = await adapter.requestDevice({label: "image-diagnostic"});

/** Loads one image and reads its pixels back. */
async function load(path: string, srgb: boolean) {
    const tex = await sdlImageLoadTexture(device, path, {
        label: `diag:${path}`,
        colorSpace: srgb ? ImageColorSpace.Srgb : ImageColorSpace.Linear,
        // COPY_SRC so we can read it back; loadTexture() in the engine doesn't
        // ask for this, which is why this diagnostic calls the binding directly.
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    });
    const w = tex.width;
    const h = tex.height;
    const unpadded = w * 4;
    const padded = Math.ceil(unpadded / 256) * 256;
    const buf = device.createBuffer({size: padded * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer({texture: tex}, {buffer: buf, bytesPerRow: padded, rowsPerImage: h}, {width: w, height: h, depthOrArrayLayers: 1});
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();
    await buf.mapAsync(GPUMapMode.READ);
    const mapped = buf.getMappedRange();
    const out = new Uint8Array(unpadded * h);
    for (let y = 0; y < h; y++) {
        out.set(mapped.subarray(y * padded, y * padded + unpadded), y * unpadded);
    }
    buf.unmap();
    buf.destroy();
    return {w, h, px: out};
}

/** Cheap content fingerprint (FNV-1a) — equal images hash equal. */
function hash(a: Uint8Array): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < a.length; i++) {
        h ^= a[i]!;
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
}

/** Rough "is this noise?" signal: mean absolute difference between neighbours. */
function neighbourDelta(a: Uint8Array, w: number, h: number): number {
    let sum = 0;
    let n = 0;
    for (let y = 0; y < h; y += 4) {
        for (let x = 0; x + 1 < w; x += 4) {
            const i = (y * w + x) * 4;
            sum += Math.abs(a[i]! - a[i + 4]!);
            n++;
        }
    }
    return n ? sum / n : 0;
}

function diff(a: Uint8Array, b: Uint8Array): number {
    if (a.length !== b.length) {
        return -1;
    }
    let n = 0;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            n++;
        }
    }
    return n;
}

let failed = false;

for (const file of files) {
    console.log(`\n── ${file} ─────────────────────────────────────────`);
    for (const srgb of [true, false]) {
        const tag = srgb ? "srgb  " : "linear";

        // (1) serial self-consistency
        const a = await load(file, srgb);
        const b = await load(file, srgb);
        const d1 = diff(a.px, b.px);
        // A photo/texture has smooth local structure; per-pixel noise does not.
        // >40 mean neighbour delta on a real texture is a strong corruption tell.
        const noise = neighbourDelta(a.px, a.w, a.h);
        console.log(
            `  ${tag}  ${a.w}x${a.h}  hash ${hash(a.px)}  neighbour-delta ${noise.toFixed(1)}` +
                `${noise > 40 ? "  <-- LOOKS LIKE NOISE" : ""}`,
        );
        if (d1 !== 0) {
            failed = true;
            console.log(`    !! FAIL(1) two SERIAL loads differ in ${d1} bytes — decode/upload is nondeterministic`);
        }

        // (2) concurrency — exactly what demoAssets.ts does
        const par = await Promise.all([load(file, srgb), load(file, srgb), load(file, srgb), load(file, srgb)]);
        const bad = par.map((p, i) => [i, diff(a.px, p.px)] as const).filter(([, n]) => n !== 0);
        if (bad.length > 0) {
            failed = true;
            console.log(`    !! FAIL(2) ${bad.length}/4 PARALLEL loads differ from the serial reference:`);
            for (const [i, n] of bad) {
                console.log(`         load ${i}: ${n} bytes differ`);
            }
            console.log("       -> data race in the concurrent decode/upload path (Promise.all in demoAssets.ts)");
        } else {
            console.log(`    parallel x4: identical to serial`);
        }
    }
}

// (3) churn — a heap overflow often only aborts once the allocator reuses the
// clobbered block, which can be long after the offending load.
console.log(`\n── churn: 40 sequential loads (watch for 'buffer overflow detected') ──`);
for (let i = 0; i < 40; i++) {
    await load(files[0]!, i % 2 === 0);
}
console.log("  survived 40 loads");

console.log(failed ? "\nRESULT: corruption reproduced — see FAIL lines above." : "\nRESULT: no corruption detected in the image path.");
process.exit(failed ? 1 : 0);
