import type { Descriptor, DescriptorToMemoryBuffer, DescriptorTypedArray } from "metis-data";

// A component is a named descriptor. The descriptor carries all type info.
export interface ComponentDef<D extends Descriptor<DescriptorTypedArray> = Descriptor<DescriptorTypedArray>> {
    readonly name: string;
    readonly descriptor: D;
}

// A record of named ComponentDefs — this is what the user passes to World.
export type ComponentSet = Record<string, ComponentDef>;

// Extract just the descriptors from a ComponentSet, keyed by component name.
export type ComponentDescriptors<CS extends ComponentSet> = {
    [K in keyof CS]: CS[K]["descriptor"]
};

// Map a ComponentSet to its memory buffer types, keyed by component name.
export type ComponentBuffers<CS extends ComponentSet> = {
    [K in keyof CS]: DescriptorToMemoryBuffer<CS[K]["descriptor"]>
};

// Helper to define a component — just for ergonomics.
export function defineComponent<D extends Descriptor<DescriptorTypedArray>>(
    name: string,
    descriptor: D,
): ComponentDef<D> {
    return {name, descriptor};
}
