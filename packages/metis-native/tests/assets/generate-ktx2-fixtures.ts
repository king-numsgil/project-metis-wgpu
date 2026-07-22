// Regenerates the committed `quad-*.ktx2` fixtures used by image-ktx2.test.ts.
//
//     bun run tests/assets/generate-ktx2-fixtures.ts
//
// Requires KTX-Software (`ktx` on PATH; developed against v4.4.2 — the AUR
// package is `ktx-software-bin`). The outputs are **committed**, so the test
// suite does not need the tool installed; this script exists so the fixtures are
// reproducible rather than mystery binaries.
//
// ## Why the source image looks the way it does
//
// 64x64, four solid 32x32 quadrants. Every property is load-bearing:
//
// - **Solid colours on 4x4 block boundaries.** BC is lossy, but a block of one
//   uniform colour is something BC7 represents exactly — measured bit-exact
//   through the UASTC intermediate. That is what lets the tests assert on exact
//   RGB values instead of a fuzzy tolerance, which is a far stronger pin.
// - **Four *different* quadrants.** A single flat colour would still look
//   correct if the loader uploaded blocks in the wrong order or at the wrong
//   offset. Distinct quadrants make position observable.
// - **Primaries plus white.** These survive BC1's 565 quantisation exactly too,
//   so the same fixture works for BC1/BC5 without per-format expectations.
// - **A full mip chain.** Level 0 shows quadrants; the 1x1 tail averages to grey.
//   The tests assert both ends, which is what makes a reversed or off-by-one mip
//   ordering detectable.
//
// ## Why BC7 goes through UASTC
//
// `ktx create` cannot encode BC7 directly (it does ASTC and Basis only), so the
// route is `create --encode uastc` then `transcode --target bc7`. This is the
// standard KTX-Software path and is exactly what a real asset pipeline emits,
// which is the point of testing against it.
import { execFileSync } from "node:child_process";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { savePixelsToFile } from "../../index.js";

const HERE = import.meta.dir;
const SIZE = 64;
const HALF = SIZE / 2;

const QUADRANTS = {
    topLeft: [255, 0, 0],
    topRight: [0, 255, 0],
    bottomLeft: [0, 0, 255],
    bottomRight: [255, 255, 255],
} as const;

function quadPixels(): Uint8Array {
    const px = new Uint8Array(SIZE * SIZE * 4);
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            const c =
                y < HALF
                    ? x < HALF
                        ? QUADRANTS.topLeft
                        : QUADRANTS.topRight
                    : x < HALF
                      ? QUADRANTS.bottomLeft
                      : QUADRANTS.bottomRight;
            const i = (y * SIZE + x) * 4;
            px[i] = c[0];
            px[i + 1] = c[1];
            px[i + 2] = c[2];
            px[i + 3] = 255;
        }
    }
    return px;
}

const ktx = (...args: string[]) => execFileSync("ktx", args, { stdio: "inherit" });

const png = join(HERE, "quad.png");
const uastc = join(HERE, "quad-uastc.ktx2");

await savePixelsToFile(quadPixels(), SIZE, SIZE, png);

// `--assign-tf linear` stops ktx applying an sRGB transfer curve, so the encoded
// values are the bytes written above. The tests then compare against those bytes
// directly rather than against a linearised version of them.
ktx("create", "--format", "R8G8B8A8_UNORM", "--assign-tf", "linear", "--generate-mipmap", "--encode", "uastc", png, uastc);

for (const [target, out] of [
    ["bc7", "quad-bc7.ktx2"],
    ["bc5", "quad-bc5.ktx2"],
    ["bc1", "quad-bc1.ktx2"],
] as const) {
    ktx("transcode", "--target", target, uastc, join(HERE, out));
}

// Same BC7 payload, zstd-supercompressed. The tests assert this decodes to
// pixels *identical* to quad-bc7.ktx2 — supercompression is lossless, so
// anything other than an exact match is a decompression bug.
ktx("deflate", "--zstd", "18", join(HERE, "quad-bc7.ktx2"), join(HERE, "quad-bc7-zstd.ktx2"));

unlinkSync(png);
unlinkSync(uastc);
console.log("wrote quad-bc7.ktx2, quad-bc7-zstd.ktx2, quad-bc5.ktx2, quad-bc1.ktx2");
