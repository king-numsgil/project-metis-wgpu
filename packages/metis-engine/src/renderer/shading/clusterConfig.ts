/**
 * Fixed cluster grid — see math/Clustered forward formulas.md. Counts are
 * independent of viewport resolution (tiles just scale to fit); Z uses
 * exponential slicing so near-camera clusters stay thin.
 */
export const CLUSTER_COUNT_X = 16;
export const CLUSTER_COUNT_Y = 9;
export const CLUSTER_COUNT_Z = 24;
export const NUM_CLUSTERS = CLUSTER_COUNT_X * CLUSTER_COUNT_Y * CLUSTER_COUNT_Z;

/**
 * Per-cluster light-index-list capacity.
 *
 * **This is the term that dominates clustering memory**: `clusterLightIndices`
 * is `NUM_CLUSTERS * MAX_LIGHTS_PER_CLUSTER * 4` bytes, ~90% of the whole
 * budget. Raising it and the grid resolution together compounds.
 *
 * Costs nothing at render time — `light_cull.wgsl` loops over the *actual* light
 * count and the forward pass over the *actual* per-cluster count, so this only
 * sizes an allocation.
 *
 * If a cluster ever exceeds it, `light_cull.wgsl` silently `break`s and the
 * excess lights simply don't light that cluster — no warning, just missing
 * light. Sized with margin for that reason.
 */
export const MAX_LIGHTS_PER_CLUSTER = 96;

/**
 * Total point lights the renderer will upload in a single frame. Excess lights
 * are dropped with a one-time console warning (see `LightCuller.write`).
 *
 * Also allocation-only: cull cost scales with the lights a scene *actually*
 * has, measured dead-linear at a fraction of a microsecond each, and the
 * forward pass scales with lights-per-*fragment* (density), not this cap.
 */
export const MAX_POINT_LIGHTS = 384;

export const COMPUTE_WORKGROUP_SIZE = 64;
