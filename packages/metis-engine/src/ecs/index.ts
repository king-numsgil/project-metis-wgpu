/**
 * The archetype ECS, reached from outside as `metis-engine/ecs`.
 *
 * Storage only — no systems, no scheduler, and no renderer integration yet: the
 * renderer still consumes a hand-built `Scene`. Start at {@link World}
 * (spawn/despawn/query) and {@link defineComponent} (schemas built from the
 * field types in `field.ts`).
 */

export * from "./field.ts";
export * from "./component.ts";
export * from "./archetype.ts";
export * from "./world.ts";
export * from "./debug.ts";
