export const GPU_BOOL = "bool";
export const GPU_I32 = "i32";
export const GPU_U32 = "u32";
export const GPU_F16 = "f16";
export const GPU_F32 = "f32";
export const GPU_F64 = "f64";
export const GPU_VEC2 = "vec2";
export const GPU_VEC3 = "vec3";
export const GPU_VEC4 = "vec4";
export const GPU_MAT2 = "mat2";
export const GPU_MAT3 = "mat3";
export const GPU_MAT4 = "mat4";
export const GPU_ARRAY = "array";
export const GPU_STRUCT = "struct";

export type GPUType =
    | typeof GPU_BOOL
    | typeof GPU_I32
    | typeof GPU_U32
    | typeof GPU_F16
    | typeof GPU_F32
    | typeof GPU_F64
    | typeof GPU_VEC2
    | typeof GPU_VEC3
    | typeof GPU_VEC4
    | typeof GPU_MAT2
    | typeof GPU_MAT3
    | typeof GPU_MAT4
    | typeof GPU_ARRAY
    | typeof GPU_STRUCT;
