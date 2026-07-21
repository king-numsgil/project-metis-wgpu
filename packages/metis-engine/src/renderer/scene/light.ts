import type { Vec3Arg } from "wgpu-matrix";

/** Fields every local (clustered) light shares, whatever its shape. */
interface LightBase {
    position: Vec3Arg;
    color: [number, number, number];
    /** Radiant intensity scale — same linear units as `Environment.sunIntensity`. */
    intensity: number;
    /**
     * Culling radius: the light contributes nothing past this distance. This is
     * the *sphere* the cluster-culling pass uses for every light kind — a spot
     * light is culled by its full range sphere, not by its cone (see CLAUDE.md
     * "Spot lights" for why).
     */
    range: number;
}

/** An omnidirectional local light (ship running lights, interior fixtures, …). */
export interface PointLight extends LightBase {
    kind: "point";
}

/**
 * A cone-shaped local light. Culled as a sphere like any other light; the cone
 * is applied per fragment in the forward pass.
 */
export interface SpotLight extends LightBase {
    kind: "spot";
    /**
     * The direction the light **travels** — the cone's axis, pointing away from
     * `position`. Same convention as `Environment.sunDirection`. Normalized on
     * upload, so any nonzero vector works.
     */
    direction: Vec3Arg;
    /**
     * Half-angle of the full-brightness core, in **radians**. Inside this cone
     * the light is at full intensity.
     */
    innerAngle: number;
    /**
     * Half-angle at which the light reaches zero, in **radians**. Between
     * `innerAngle` and this, intensity falls off smoothly. Should be
     * `>= innerAngle`; if it isn't, the edge degenerates to a hard cutoff
     * rather than producing anything invalid.
     */
    outerAngle: number;
}

/**
 * Any light the clustered light-culling pass handles — discriminate on `kind`.
 * The directional sun is *not* one of these: it lives on `Environment` and is
 * shadow-mapped separately.
 */
export type Light = PointLight | SpotLight;
