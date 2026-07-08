/**
 * Deterministic CPU generation of the SSAO hemisphere kernel and the shared
 * rotation-noise tile. Kept out of the GPU pass so it can be unit-tested
 * directly (test/ao.test.ts) — the kernel's statistical shape (hemisphere
 * containment, origin-weighting) is exactly the part that's easy to get subtly
 * wrong and impossible to eyeball on the GPU.
 */

/** Small deterministic PRNG (mulberry32) so kernels/noise are reproducible across runs and testable. */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * `count` hemisphere samples in tangent space (the +Z hemisphere, i.e. every
 * sample has `z >= 0`), packed as `vec4` (xyz + 0 padding) for a std140 uniform
 * array. Samples are pushed toward the origin with an accelerating curve
 * (`lerp(0.1, 1, i²/count²)`) so more of the budget lands close to the point,
 * where contact occlusion actually matters — the standard Crytek/`learnopengl`
 * SSAO kernel distribution.
 */
export function generateSsaoKernel(count: number, seed = 1): Float32Array {
    const rng = mulberry32(seed);
    const out = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        // Random direction in the +Z hemisphere.
        let x = rng() * 2 - 1;
        let y = rng() * 2 - 1;
        let z = rng(); // [0,1] -> hemisphere, never below the tangent plane
        const invLen = 1 / (Math.hypot(x, y, z) || 1);
        x *= invLen;
        y *= invLen;
        z *= invLen;
        // Random length in [0,1], then bias toward the origin.
        const t = i / count;
        const scale = lerp(0.1, 1.0, t * t) * rng();
        out[i * 4 + 0] = x * scale;
        out[i * 4 + 1] = y * scale;
        out[i * 4 + 2] = z * scale;
        out[i * 4 + 3] = 0;
    }
    return out;
}

/**
 * A `dim*dim` tile of random in-plane rotation vectors `(x, y, 0)` with
 * `x,y ∈ [-1,1]`, packed as `vec4`. Not normalized: the shader uses each as a
 * random tangent seed and re-orthogonalizes against the surface normal
 * (Gram-Schmidt), which only needs the direction to be random in the plane.
 */
export function generateAoNoise(dim: number, seed = 2): Float32Array {
    const rng = mulberry32(seed);
    const out = new Float32Array(dim * dim * 4);
    for (let i = 0; i < dim * dim; i++) {
        out[i * 4 + 0] = rng() * 2 - 1;
        out[i * 4 + 1] = rng() * 2 - 1;
        out[i * 4 + 2] = 0;
        out[i * 4 + 3] = 0;
    }
    return out;
}
