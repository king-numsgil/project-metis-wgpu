import type { ComponentDef } from "./component.ts";
import { AXES, type EcsTypedArray, type FieldType } from "./field.ts";

export type EntityId = number;
export type SignatureKey = string;

/** Canonical key for a set of component names (order-independent). */
export function makeSignatureKey(names: string[]): SignatureKey {
    return [...names].sort().join(",");
}

const INITIAL_CAPACITY = 32;

/** One field's storage: `arrays[0]` for a scalar, `arrays[0..n-1]` (x/y/z/w) for a vec. */
interface FieldColumn {
    readonly field: FieldType;
    arrays: EcsTypedArray[];
}

/** A per-field or per-vec view handed to systems: a typed array, or `{x,y,z}`. */
type FieldView = EcsTypedArray | Record<string, EcsTypedArray>;
/** A component's columns, keyed by field name. */
type ComponentView = Record<string, FieldView>;
/** All components' columns in an archetype, keyed by component name. */
export type ColumnsView = Record<string, ComponentView>;

/**
 * Stores every entity that has exactly one set of components, in Structure-of-
 * Arrays form: one typed array per scalar field (per axis for a vec), indexed by
 * a dense row. Iteration is a bare `column[row]` — no wrappers, no allocation.
 * Rows are kept dense with swap-with-last on removal, so a row is NOT a stable
 * handle across despawns; the `EntityId -> row` map is the stable lookup.
 */
export class Archetype {
    readonly signatureKey: SignatureKey;
    readonly componentNames: readonly string[];

    private _capacity = INITIAL_CAPACITY;
    private _count = 0;
    private readonly entities: EntityId[] = [];
    private readonly rowOfEntity = new Map<EntityId, number>();
    // component name -> field name -> column
    private readonly store = new Map<string, Map<string, FieldColumn>>();
    private columnsView: ColumnsView = {};

    constructor(signatureKey: SignatureKey, defs: readonly ComponentDef[]) {
        this.signatureKey = signatureKey;
        this.componentNames = defs.map((d) => d.name);

        for (const def of defs) {
            const fields = new Map<string, FieldColumn>();
            for (const [fieldName, fieldType] of Object.entries(def.schema)) {
                fields.set(fieldName, this.allocField(fieldType, this._capacity));
            }
            this.store.set(def.name, fields);
        }
        this.rebuildColumnsView();
    }

    get capacity(): number {
        return this._capacity;
    }

    get count(): number {
        return this._count;
    }

    /** Dense entity ids: `entityIds[row]` is the entity at that row. */
    get entityIds(): readonly EntityId[] {
        return this.entities;
    }

    /** Live column arrays for systems: `columns[Component][field]` (or `[field].x`). */
    get columns(): ColumnsView {
        return this.columnsView;
    }

    has(entityId: EntityId): boolean {
        return this.rowOfEntity.has(entityId);
    }

    rowOf(entityId: EntityId): number | undefined {
        return this.rowOfEntity.get(entityId);
    }

    addEntity(entityId: EntityId): number {
        if (this.rowOfEntity.has(entityId)) {
            throw new Error(`Entity ${entityId} already in archetype "${this.signatureKey}"`);
        }
        if (this._count >= this._capacity) {
            this.grow();
        }
        const row = this._count;
        // Zero the row: a dense slot can be reused after a swap-with-last despawn,
        // so it may hold a previous entity's data. Guarantees fresh entities read
        // as zero regardless of reuse.
        for (const fields of this.store.values()) {
            for (const col of fields.values()) {
                for (const arr of col.arrays) {
                    arr[row] = 0;
                }
            }
        }
        this.entities[row] = entityId;
        this.rowOfEntity.set(entityId, row);
        this._count++;
        return row;
    }

    removeEntity(entityId: EntityId): void {
        const row = this.rowOfEntity.get(entityId);
        if (row === undefined) {
            throw new Error(`Entity ${entityId} not in archetype "${this.signatureKey}"`);
        }
        const last = this._count - 1;

        if (row !== last) {
            // Swap-with-last: copy the last row's values into the vacated row.
            for (const fields of this.store.values()) {
                for (const col of fields.values()) {
                    for (const arr of col.arrays) {
                        arr[row] = arr[last]!;
                    }
                }
            }
            const movedEntity = this.entities[last]!;
            this.entities[row] = movedEntity;
            this.rowOfEntity.set(movedEntity, row);
        }

        this.entities.pop();
        this.rowOfEntity.delete(entityId);
        this._count--;
    }

    /**
     * A random-access accessor for one entity's component: settable `number`
     * fields (scalars) and `{ x, y, z }` sub-objects (vecs). Row and array are
     * resolved live on each access, so it stays valid across growth and swaps.
     */
    accessor(entityId: EntityId, componentName: string): Record<string, unknown> {
        const fields = this.store.get(componentName);
        if (fields === undefined) {
            throw new Error(`Component "${componentName}" not in archetype "${this.signatureKey}"`);
        }
        const rowOfEntity = this.rowOfEntity;
        const target: Record<string, unknown> = {};

        for (const [fieldName, col] of fields) {
            if (col.field.kind === "scalar") {
                Object.defineProperty(target, fieldName, {
                    enumerable: true,
                    get: () => col.arrays[0]![rowOfEntity.get(entityId)!],
                    set: (v: number) => { col.arrays[0]![rowOfEntity.get(entityId)!] = v; },
                });
            } else {
                const sub: Record<string, unknown> = {};
                for (let axis = 0; axis < col.field.n; axis++) {
                    const a = axis;
                    Object.defineProperty(sub, AXES[axis]!, {
                        enumerable: true,
                        get: () => col.arrays[a]![rowOfEntity.get(entityId)!],
                        set: (v: number) => { col.arrays[a]![rowOfEntity.get(entityId)!] = v; },
                    });
                }
                target[fieldName] = sub;
            }
        }
        return target;
    }

    /** Per-component field layout, for debug/inspection. */
    describe(): Record<string, Array<{ field: string; kind: string; axes: number; bytes: number }>> {
        const out: Record<string, Array<{ field: string; kind: string; axes: number; bytes: number }>> = {};
        for (const [comp, fields] of this.store) {
            out[comp] = [];
            for (const [fieldName, col] of fields) {
                const scalarBytes = col.field.kind === "scalar" ? col.field.bytes : col.field.scalar.bytes;
                out[comp]!.push({
                    field: fieldName,
                    kind: col.field.kind === "scalar" ? "scalar" : `vec${col.field.n}`,
                    axes: col.arrays.length,
                    bytes: scalarBytes * col.arrays.length,
                });
            }
        }
        return out;
    }

    /** Total bytes currently allocated across all columns. */
    get allocatedBytes(): number {
        let total = 0;
        for (const fields of this.store.values()) {
            for (const col of fields.values()) {
                for (const arr of col.arrays) {
                    total += arr.byteLength;
                }
            }
        }
        return total;
    }

    private allocField(fieldType: FieldType, capacity: number): FieldColumn {
        if (fieldType.kind === "scalar") {
            return { field: fieldType, arrays: [new fieldType.ctor(capacity)] };
        }
        const arrays: EcsTypedArray[] = [];
        for (let axis = 0; axis < fieldType.n; axis++) {
            arrays.push(new fieldType.scalar.ctor(capacity));
        }
        return { field: fieldType, arrays };
    }

    private grow(): void {
        const newCapacity = this._capacity * 2;
        for (const fields of this.store.values()) {
            for (const col of fields.values()) {
                col.arrays = col.arrays.map((old) => {
                    const Ctor = old.constructor as { new (length: number): EcsTypedArray };
                    const grown = new Ctor(newCapacity);
                    grown.set(old);
                    return grown;
                });
            }
        }
        this._capacity = newCapacity;
        this.rebuildColumnsView();
    }

    private rebuildColumnsView(): void {
        const view: ColumnsView = {};
        for (const [comp, fields] of this.store) {
            const compView: ComponentView = {};
            for (const [fieldName, col] of fields) {
                if (col.field.kind === "scalar") {
                    compView[fieldName] = col.arrays[0]!;
                } else {
                    const axes: Record<string, EcsTypedArray> = {};
                    for (let axis = 0; axis < col.field.n; axis++) {
                        axes[AXES[axis]!] = col.arrays[axis]!;
                    }
                    compView[fieldName] = axes;
                }
            }
            view[comp] = compView;
        }
        this.columnsView = view;
    }
}
