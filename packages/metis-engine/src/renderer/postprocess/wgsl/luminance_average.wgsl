// Two-pass parallel reduction computing the scene's average log-luminance —
// the log-average luminance "key" from Reinhard et al. 2002 ("Photographic
// Tone Reproduction for Digital Images"), see math/Tonemapping and exposure
// formulas.md (Formula 1). No atomics: pass 1 reduces each 16x16 tile to one
// partial sum (+ valid-pixel count) per workgroup; pass 2 reduces all of
// those to one value.
//
// Background pixels (nothing drawn there) are excluded from the average — a
// space sim's frame is mostly empty black sky, and naively including it drags
// the "average" luminance so low that auto-exposure blows the actual geometry
// out to white trying to compensate. See math/Tonemapping and exposure
// formulas.md's "the one labeled handwave".
//
// The camera uses a reverse-Z projection (math/camera.ts), so the depth buffer
// clears to 0 and "background" is `depth <= 0`, not `depth >= 1`.

struct LuminanceParams {
    width: u32,
    height: u32,
    tileCountX: u32,
    tileCount: u32,
};

@group(0) @binding(2) var<uniform> lumParams: LuminanceParams;

// ── Pass 1: per-tile reduction ──────────────────────────────────────────────

// hdrTex reads the forward pass's *resolved* (single-sampled) color target;
// depthTex is the raw multisampled depth buffer — sample index 0 is enough
// to know whether anything was drawn at this pixel, which is all this needs
// it for (see RenderTargets in src/rhi/targets.ts for why depth isn't resolved).
@group(0) @binding(0) var hdrTex: texture_2d<f32>;
@group(0) @binding(4) var depthTex: texture_depth_multisampled_2d;
@group(0) @binding(1) var<storage, read_write> partialSums: array<f32>;
@group(0) @binding(5) var<storage, read_write> partialCounts: array<u32>;

var<workgroup> tileSums: array<f32, 256>;
var<workgroup> tileCounts: array<u32, 256>;

@compute @workgroup_size(16, 16)
fn reduceTile(
    @builtin(global_invocation_id) gid: vec3<u32>,
    @builtin(local_invocation_index) li: u32,
    @builtin(workgroup_id) wgid: vec3<u32>,
) {
    var logLum = 0.0;
    var valid = 0u;
    if (gid.x < lumParams.width && gid.y < lumParams.height) {
        let depth = textureLoad(depthTex, vec2<i32>(i32(gid.x), i32(gid.y)), 0);
        if (depth > 0.0) { // reverse-Z: >0 means geometry was drawn here
            let color = textureLoad(hdrTex, vec2<i32>(i32(gid.x), i32(gid.y)), 0).rgb;
            let luma = dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
            logLum = log(max(luma, 1e-5));
            valid = 1u;
        }
    }
    tileSums[li] = logLum;
    tileCounts[li] = valid;
    workgroupBarrier();

    var stride = 128u;
    while (stride > 0u) {
        if (li < stride) {
            tileSums[li] = tileSums[li] + tileSums[li + stride];
            tileCounts[li] = tileCounts[li] + tileCounts[li + stride];
        }
        workgroupBarrier();
        stride = stride / 2u;
    }

    if (li == 0u) {
        let tileIndex = wgid.y * lumParams.tileCountX + wgid.x;
        partialSums[tileIndex] = tileSums[0];
        partialCounts[tileIndex] = tileCounts[0];
    }
}

// ── Pass 2: reduce all tile sums to a single average ────────────────────────

@group(0) @binding(3) var<storage, read_write> avgLogLuminance: array<f32>;

var<workgroup> finalSums: array<f32, 256>;
var<workgroup> finalCounts: array<u32, 256>;

@compute @workgroup_size(256)
fn reduceFinal(@builtin(local_invocation_index) li: u32) {
    var sum = 0.0;
    var count = 0u;
    var i = li;
    while (i < lumParams.tileCount) {
        sum = sum + partialSums[i];
        count = count + partialCounts[i];
        i = i + 256u;
    }
    finalSums[li] = sum;
    finalCounts[li] = count;
    workgroupBarrier();

    var stride = 128u;
    while (stride > 0u) {
        if (li < stride) {
            finalSums[li] = finalSums[li] + finalSums[li + stride];
            finalCounts[li] = finalCounts[li] + finalCounts[li + stride];
        }
        workgroupBarrier();
        stride = stride / 2u;
    }

    if (li == 0u) {
        if (finalCounts[0] > 0u) {
            avgLogLuminance[0] = finalSums[0] / f32(finalCounts[0]);
        } else {
            avgLogLuminance[0] = log(0.18); // no geometry visible — neutral fallback (exposure ~= 1.0)
        }
    }
}
