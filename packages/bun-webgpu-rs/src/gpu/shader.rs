use napi_derive::napi;
use std::sync::Arc;

#[napi(object)]
pub struct GpuShaderModuleDescriptor {
    pub label: Option<String>,
    pub code: String,
}

#[napi(object)]
pub struct GpuCompilationMessage {
    pub message: String,
    #[napi(ts_type = "GPUCompilationMessageType")]
    pub r#type: String,
    pub line_num: f64,
    pub line_pos: f64,
    pub offset: f64,
    pub length: f64,
}

#[napi(object)]
pub struct GpuCompilationInfo {
    pub messages: Vec<GpuCompilationMessage>,
}

#[napi]
pub struct GpuShaderModule {
    pub(crate) inner: Arc<wgpu::ShaderModule>,
}

impl GpuShaderModule {
    pub(crate) fn new(inner: wgpu::ShaderModule) -> Self {
        Self { inner: Arc::new(inner) }
    }
}

#[napi]
impl GpuShaderModule {
    #[napi]
    pub async fn get_compilation_info(&self) -> napi::Result<GpuCompilationInfo> {
        // wgpu 24 provides compilation info via the module
        let info = self.inner.get_compilation_info().await;
        let messages = info
            .messages
            .iter()
            .map(|m| GpuCompilationMessage {
                message: m.message.to_string(),
                r#type: match m.message_type {
                    wgpu::CompilationMessageType::Error => "error",
                    wgpu::CompilationMessageType::Warning => "warning",
                    wgpu::CompilationMessageType::Info => "info",
                }
                    .to_string(),
                line_num: m.location.map_or(0.0, |l| l.line_number as f64),
                line_pos: m.location.map_or(0.0, |l| l.line_position as f64),
                offset: m.location.map_or(0.0, |l| l.offset as f64),
                length: m.location.map_or(0.0, |l| l.length as f64),
            })
            .collect();
        Ok(GpuCompilationInfo { messages })
    }
}
