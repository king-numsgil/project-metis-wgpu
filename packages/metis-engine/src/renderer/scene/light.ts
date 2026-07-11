import type { Vec3Arg } from "wgpu-matrix";

/** A local point light (ship running lights, interior fixtures, …), culled per-cluster by the light-culling compute pass. */
export interface PointLight {
    position: Vec3Arg;
    color: [number, number, number];
    /** Radiant intensity scale — same linear units as `Environment.sunIntensity`. */
    intensity: number;
    /** Culling radius: the light contributes nothing past this distance. */
    range: number;
}
