import type { Schema } from "./field.ts";

/** A component is a named schema of SoA fields. */
export interface ComponentDef<S extends Schema = Schema> {
    /** Identifies the component in archetype signatures, queries, and debug output. */
    readonly name: string;
    /** Field name -> field type. Each entry becomes one column (or one per axis for a vec). */
    readonly schema: S;
}

/**
 * Define a component from a name and a field schema.
 *
 * ```ts
 * const Position = defineComponent("Position", { pos: vec3(f32) });
 * ```
 *
 * A def is inert data — it allocates nothing. Storage appears when a
 * {@link World} first spawns an entity with this component.
 */
export function defineComponent<S extends Schema>(name: string, schema: S): ComponentDef<S> {
    return { name, schema };
}

/**
 * A World's registered components, keyed by name. **The key is the component
 * name** — `queryEntities(["Position"])` looks up the registry key, so a key
 * that disagrees with the def's own `name` will not resolve.
 */
export type Registry = Record<string, ComponentDef>;

/** Extract a component def's schema. */
export type SchemaOf<C extends ComponentDef> = C["schema"];
