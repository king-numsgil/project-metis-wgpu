use napi_derive::napi;

#[napi(js_name = "GPUBufferUsage")]
#[allow(non_camel_case_types)]
pub enum GpuBufferUsage {
    MAP_READ = 1,
    MAP_WRITE = 2,
    COPY_SRC = 4,
    COPY_DST = 8,
    INDEX = 16,
    VERTEX = 32,
    UNIFORM = 64,
    STORAGE = 128,
    INDIRECT = 256,
    QUERY_RESOLVE = 512,
}

#[napi(js_name = "GPUTextureUsage")]
#[allow(non_camel_case_types)]
pub enum GpuTextureUsage {
    COPY_SRC = 1,
    COPY_DST = 2,
    TEXTURE_BINDING = 4,
    STORAGE_BINDING = 8,
    RENDER_ATTACHMENT = 16,
    TRANSIENT_ATTACHMENT = 32,
}

#[napi(js_name = "GPUShaderStage")]
#[allow(non_camel_case_types)]
pub enum GpuShaderStage {
    VERTEX = 1,
    FRAGMENT = 2,
    COMPUTE = 4,
}

#[napi(js_name = "GPUMapMode")]
#[allow(non_camel_case_types)]
pub enum GpuMapMode {
    READ = 1,
    WRITE = 2,
}

#[napi(js_name = "GPUColorWrite")]
#[allow(non_camel_case_types)]
pub enum GpuColorWrite {
    RED = 1,
    GREEN = 2,
    BLUE = 4,
    ALPHA = 8,
    ALL = 15,
}
