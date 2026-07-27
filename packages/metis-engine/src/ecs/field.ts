/**
 * Field types for SoA component storage. A component is a schema of named
 * fields; each field is a scalar or a small fixed vector. In storage every
 * scalar becomes its OWN typed array (a "column"), and a vec becomes one column
 * per axis — so a field access in a system is a bare `column[row]` index: the
 * fast, cache-friendly, fully-typed path (no metis-data, no wrappers, no eval).
 *
 * metis-data is deliberately NOT used here: it describes interleaved (AoS) GPU
 * layout, which is the wrong shape for per-frame iteration. See the engine
 * CLAUDE.md "The ECS" and metis-data's "Performance intent".
 *
 * ```ts
 * const Position = defineComponent("Position", { pos: vec3(f32), mass: f32 });
 * ```
 */

/** Every TypedArray a column can be backed by — one per scalar field type below. */
export type EcsTypedArray =
    | Float32Array
    | Float64Array
    | Int32Array
    | Uint32Array
    | Int16Array
    | Uint16Array
    | Int8Array
    | Uint8Array;

/** A scalar field type — carries the TypedArray it stores into (phantom-typed). */
export interface ScalarType<A extends EcsTypedArray = EcsTypedArray> {
    readonly kind: "scalar";
    /** The TypedArray constructor a column of this field allocates. */
    readonly ctor: { new (length: number): A };
    /** Bytes per element — used only by the debug inspector's layout report. */
    readonly bytes: number;
}

function scalar<A extends EcsTypedArray>(ctor: { new (length: number): A }, bytes: number): ScalarType<A> {
    return { kind: "scalar", ctor, bytes };
}

/** 32-bit float. The default for anything headed for the GPU. */
export const f32: ScalarType<Float32Array> = scalar(Float32Array, 4);
/** 64-bit float — for authoritative sim quantities (world positions at solar-system scale) that would cancel catastrophically in f32. */
export const f64: ScalarType<Float64Array> = scalar(Float64Array, 8);
/** 32-bit signed integer. */
export const i32: ScalarType<Int32Array> = scalar(Int32Array, 4);
/** 32-bit unsigned integer — ids, handles, bitflag sets. */
export const u32: ScalarType<Uint32Array> = scalar(Uint32Array, 4);
/** 16-bit signed integer. */
export const i16: ScalarType<Int16Array> = scalar(Int16Array, 2);
/** 16-bit unsigned integer. */
export const u16: ScalarType<Uint16Array> = scalar(Uint16Array, 2);
/** 8-bit signed integer. */
export const i8: ScalarType<Int8Array> = scalar(Int8Array, 1);
/** 8-bit unsigned integer — small enums, booleans-as-bytes. */
export const u8: ScalarType<Uint8Array> = scalar(Uint8Array, 1);

/**
 * A fixed 2/3/4-component vector field, stored as N scalar columns (x/y/z/w).
 * There is no packed-vector storage: a `vec3(f32)` is three independent
 * `Float32Array`s, which is what lets a system touch one axis without paying
 * for the other two.
 */
export interface VecType<A extends EcsTypedArray = EcsTypedArray, N extends 2 | 3 | 4 = 2 | 3 | 4> {
    readonly kind: "vec";
    readonly scalar: ScalarType<A>;
    readonly n: N;
}

/** A 2-component field of `s`, stored as `x`/`y` columns. */
export function vec2<A extends EcsTypedArray>(s: ScalarType<A>): VecType<A, 2> {
    return { kind: "vec", scalar: s, n: 2 };
}
/** A 3-component field of `s`, stored as `x`/`y`/`z` columns. */
export function vec3<A extends EcsTypedArray>(s: ScalarType<A>): VecType<A, 3> {
    return { kind: "vec", scalar: s, n: 3 };
}
/** A 4-component field of `s`, stored as `x`/`y`/`z`/`w` columns. */
export function vec4<A extends EcsTypedArray>(s: ScalarType<A>): VecType<A, 4> {
    return { kind: "vec", scalar: s, n: 4 };
}

/** Anything a schema field may be: a scalar type or a vec of one. */
export type FieldType = ScalarType | VecType;

/** A component schema: named fields. */
export type Schema = Record<string, FieldType>;

/** Axis names for an N-vector. */
export type AxisOf<N extends number> =
    N extends 2 ? "x" | "y" :
        N extends 3 ? "x" | "y" | "z" :
            N extends 4 ? "x" | "y" | "z" | "w" :
                never;

/** Axis key strings, in order. Index 0..n-1 for an n-vector. */
export const AXES = ["x", "y", "z", "w"] as const;

// ── Derived shapes ────────────────────────────────────────────────────────────

/**
 * The storage columns for one field: a scalar's own typed array, or one typed
 * array per axis for a vec. These are what a system indexes by row.
 */
export type FieldColumns<F extends FieldType> =
    F extends ScalarType<infer A> ? A :
        F extends VecType<infer A, infer N> ? { readonly [K in AxisOf<N>]: A } :
            never;

/** The columns for a whole component, keyed by field name. */
export type ComponentColumns<S extends Schema> = {
    readonly [K in keyof S]: FieldColumns<S[K]>;
};

/**
 * The random-access accessor for one field of one entity: a settable `number`
 * for a scalar, or `{ x, y, z }` settable numbers for a vec.
 */
export type FieldAccessor<F extends FieldType> =
    F extends VecType<EcsTypedArray, infer N> ? { [K in AxisOf<N>]: number } : number;

/** The random-access accessor for a whole component, keyed by field name. */
export type ComponentAccessor<S extends Schema> = {
    [K in keyof S]: FieldAccessor<S[K]>;
};
