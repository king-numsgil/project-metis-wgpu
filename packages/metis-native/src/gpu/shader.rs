use napi_derive::napi;
use std::sync::{Arc, Mutex};

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

/// A compiled WGSL shader module created by `device.createShaderModule`,
/// referenced as the `module` of a pipeline's vertex/fragment/compute stage.
/// Compilation is deferred and never throws here — inspect diagnostics via
/// `getCompilationInfo()` or wrap creation in an error scope.
#[napi]
pub struct GpuShaderModule {
    pub(crate) inner: Arc<wgpu::ShaderModule>,
    label: Mutex<Option<String>>,
}

impl GpuShaderModule {
    pub(crate) fn new(inner: wgpu::ShaderModule, label: Option<String>) -> Self {
        Self { inner: Arc::new(inner), label: Mutex::new(label) }
    }
}

#[napi]
impl GpuShaderModule {
    /// Debug label (read-write).
    #[napi(getter)]
    pub fn label(&self) -> Option<String> { self.label.lock().unwrap().clone() }
    #[napi(setter)]
    pub fn set_label(&self, label: String) { *self.label.lock().unwrap() = Some(label); }

    /// Resolve with the compiler's diagnostics for this module — errors,
    /// warnings and info messages, each with a source location. Empty on a clean
    /// compile.
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
