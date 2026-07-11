import type { Schema } from "./field.ts";

/** A component is a named schema of SoA fields. */
export interface ComponentDef<S extends Schema = Schema> {
    readonly name: string;
    readonly schema: S;
}

/** Define a component from a name and a field schema. */
export function defineComponent<S extends Schema>(name: string, schema: S): ComponentDef<S> {
    return { name, schema };
}

/** A World's registered components, keyed by name (the key IS the component name). */
export type Registry = Record<string, ComponentDef>;

/** Extract a component def's schema. */
export type SchemaOf<C extends ComponentDef> = C["schema"];
