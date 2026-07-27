import { vec3, type Vec3Arg } from "wgpu-matrix";

/**
 * The scene-wide lighting context: one directional "sun" plus a flat ambient
 * fill. There is no special-cased interior/exterior mode in the shader — the
 * exterior/interior look comes entirely from `ambientIntensity` (near 0
 * outside, a small nonzero value inside to fake bounced light) plus geometry
 * (window openings let the same sun in). See math/PBR shading formulas.md.
 */
export interface Environment {
    /** Direction the light *travels* (sun -> scene), normalized. */
    sunDirection: Vec3Arg;
    /** Linear RGB tint of the directional light. */
    sunColor: [number, number, number];
    /** Radiance scale (arbitrary linear units). The auto-exposure pass meters the scene to middle grey (`math/Tonemapping and exposure formulas.md`, Formula 2), so absolute magnitude mostly sets brightness *relative* to the ambient/point-light terms rather than final screen brightness. */
    sunIntensity: number;
    /** Linear RGB tint of the flat ambient fill (a stand-in for sky/bounce light — there is no IBL). */
    ambientColor: [number, number, number];
    /**
     * Strength of the flat ambient fill, and **the only lighting-model
     * difference between an exterior and an interior scene**. Ambient occlusion
     * multiplies into this term and nothing else.
     */
    ambientIntensity: number;
}

/**
 * Sunlit open space: a strong sun over near-zero ambient, so anything the sun
 * doesn't reach goes genuinely dark.
 *
 * @param overrides merged over the defaults, so `{ sunIntensity: 8 }` keeps everything else.
 */
export function createExteriorEnvironment(overrides?: Partial<Environment>): Environment {
    return {
        sunDirection: vec3.normalize(vec3.create(-0.4, -0.75, -0.3)),
        sunColor: [1.0, 0.98, 0.92],
        sunIntensity: 4.0,
        ambientColor: [0.55, 0.65, 0.85],
        ambientIntensity: 0.015,
        ...overrides,
    };
}

/**
 * Enclosed space: the same sun, with a modest ambient fill standing in for the
 * bounce light a room has and open space doesn't. The *only* difference from
 * {@link createExteriorEnvironment} is `ambientIntensity` — there is no
 * `if (interior)` anywhere in the shading code; the rest of the look comes from
 * geometry and the shadow map.
 *
 * @param overrides merged over the defaults.
 */
export function createInteriorEnvironment(overrides?: Partial<Environment>): Environment {
    return {
        sunDirection: vec3.normalize(vec3.create(-0.4, -0.75, -0.3)),
        sunColor: [1.0, 0.98, 0.92],
        sunIntensity: 4.0,
        ambientColor: [0.5, 0.55, 0.6],
        ambientIntensity: 0.12,
        ...overrides,
    };
}
