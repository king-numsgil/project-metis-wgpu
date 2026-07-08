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
    sunColor: [number, number, number];
    /** Radiance scale (arbitrary linear units — tune against `math/Tonemapping and exposure formulas.md`'s EV100 reference table). */
    sunIntensity: number;
    ambientColor: [number, number, number];
    ambientIntensity: number;
}

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
