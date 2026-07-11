/**
 * Fixed cluster grid — see math/Clustered forward formulas.md. Counts are
 * independent of viewport resolution (tiles just scale to fit); Z uses
 * exponential slicing so near-camera clusters stay thin.
 */
export const CLUSTER_COUNT_X = 16;
export const CLUSTER_COUNT_Y = 9;
export const CLUSTER_COUNT_Z = 24;
export const NUM_CLUSTERS = CLUSTER_COUNT_X * CLUSTER_COUNT_Y * CLUSTER_COUNT_Z;

/** Per-cluster light-index-list capacity. */
export const MAX_LIGHTS_PER_CLUSTER = 64;

/** Total point lights the renderer will upload in a single frame. */
export const MAX_POINT_LIGHTS = 256;

export const COMPUTE_WORKGROUP_SIZE = 64;
