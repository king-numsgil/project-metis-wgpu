/**
 * Root barrel. `src/` is two independent subtrees, and consumers normally reach
 * them through the package's subpath exports rather than through here:
 * `metis-engine/renderer` and `metis-engine/ecs`.
 */

/** The whole WebGPU clustered-forward renderer — see `metis-engine/renderer`. */
export * as Renderer from "./renderer";
/** The archetype ECS (storage only, not yet wired to the renderer) — see `metis-engine/ecs`. */
export * as ECS from "./ecs";
