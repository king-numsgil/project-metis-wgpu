use super::convert;
use super::device::{GpuDevice, GpuError, GpuUncapturedErrorEvent, UncapturedErrorTsfn};
use super::error::map_err_display;
use super::supported_features::GpuSupportedFeatures;
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use napi_derive::napi;
use std::sync::{Arc, Mutex};
use tokio::sync::watch;

#[napi(object)]
pub struct GpuSupportedLimits {
    pub max_texture_dimension_1d: u32,
    pub max_texture_dimension_2d: u32,
    pub max_texture_dimension_3d: u32,
    pub max_texture_array_layers: u32,
    pub max_bind_groups: u32,
    pub max_bind_groups_plus_vertex_buffers: u32,
    pub max_bindings_per_bind_group: u32,
    pub max_dynamic_uniform_buffers_per_pipeline_layout: u32,
    pub max_dynamic_storage_buffers_per_pipeline_layout: u32,
    pub max_sampled_textures_per_shader_stage: u32,
    pub max_samplers_per_shader_stage: u32,
    pub max_storage_buffers_per_shader_stage: u32,
    pub max_storage_textures_per_shader_stage: u32,
    pub max_uniform_buffers_per_shader_stage: u32,
    pub max_uniform_buffer_binding_size: f64,
    pub max_storage_buffer_binding_size: f64,
    pub min_uniform_buffer_offset_alignment: u32,
    pub min_storage_buffer_offset_alignment: u32,
    pub max_vertex_buffers: u32,
    pub max_buffer_size: f64,
    pub max_vertex_attributes: u32,
    pub max_vertex_buffer_array_stride: u32,
    pub max_inter_stage_shader_variables: u32,
    pub max_color_attachments: u32,
    pub max_color_attachment_bytes_per_sample: u32,
    pub max_compute_workgroup_storage_size: u32,
    pub max_compute_invocations_per_workgroup: u32,
    pub max_compute_workgroup_size_x: u32,
    pub max_compute_workgroup_size_y: u32,
    pub max_compute_workgroup_size_z: u32,
    pub max_compute_workgroups_per_dimension: u32,
    pub max_immediate_size: u32,
    pub max_storage_buffers_in_vertex_stage: u32,
    pub max_storage_buffers_in_fragment_stage: u32,
    pub max_storage_textures_in_vertex_stage: u32,
    pub max_storage_textures_in_fragment_stage: u32,
}

pub(crate) fn limits_to_js(l: &wgpu::Limits) -> GpuSupportedLimits {
    GpuSupportedLimits {
        max_texture_dimension_1d: l.max_texture_dimension_1d,
        max_texture_dimension_2d: l.max_texture_dimension_2d,
        max_texture_dimension_3d: l.max_texture_dimension_3d,
        max_texture_array_layers: l.max_texture_array_layers,
        max_bind_groups: l.max_bind_groups,
        max_bind_groups_plus_vertex_buffers: l.max_bind_groups + l.max_vertex_buffers,
        max_bindings_per_bind_group: l.max_bindings_per_bind_group,
        max_dynamic_uniform_buffers_per_pipeline_layout: l.max_dynamic_uniform_buffers_per_pipeline_layout,
        max_dynamic_storage_buffers_per_pipeline_layout: l.max_dynamic_storage_buffers_per_pipeline_layout,
        max_sampled_textures_per_shader_stage: l.max_sampled_textures_per_shader_stage,
        max_samplers_per_shader_stage: l.max_samplers_per_shader_stage,
        max_storage_buffers_per_shader_stage: l.max_storage_buffers_per_shader_stage,
        max_storage_textures_per_shader_stage: l.max_storage_textures_per_shader_stage,
        max_uniform_buffers_per_shader_stage: l.max_uniform_buffers_per_shader_stage,
        max_uniform_buffer_binding_size: l.max_uniform_buffer_binding_size as f64,
        max_storage_buffer_binding_size: l.max_storage_buffer_binding_size as f64,
        min_uniform_buffer_offset_alignment: l.min_uniform_buffer_offset_alignment,
        min_storage_buffer_offset_alignment: l.min_storage_buffer_offset_alignment,
        max_vertex_buffers: l.max_vertex_buffers,
        max_buffer_size: l.max_buffer_size as f64,
        max_vertex_attributes: l.max_vertex_attributes,
        max_vertex_buffer_array_stride: l.max_vertex_buffer_array_stride,
        max_inter_stage_shader_variables: l.max_inter_stage_shader_components,
        max_color_attachments: l.max_color_attachments,
        max_color_attachment_bytes_per_sample: l.max_color_attachment_bytes_per_sample,
        max_compute_workgroup_storage_size: l.max_compute_workgroup_storage_size,
        max_compute_invocations_per_workgroup: l.max_compute_invocations_per_workgroup,
        max_compute_workgroup_size_x: l.max_compute_workgroup_size_x,
        max_compute_workgroup_size_y: l.max_compute_workgroup_size_y,
        max_compute_workgroup_size_z: l.max_compute_workgroup_size_z,
        max_compute_workgroups_per_dimension: l.max_compute_workgroups_per_dimension,
        max_immediate_size: l.max_push_constant_size,
        max_storage_buffers_in_vertex_stage: l.max_storage_buffers_per_shader_stage,
        max_storage_buffers_in_fragment_stage: l.max_storage_buffers_per_shader_stage,
        max_storage_textures_in_vertex_stage: l.max_storage_textures_per_shader_stage,
        max_storage_textures_in_fragment_stage: l.max_storage_textures_per_shader_stage,
    }
}

#[napi(object)]
pub struct GpuDeviceDescriptor {
    pub label: Option<String>,
    pub required_features: Option<Vec<String>>,
    pub required_limits: Option<GpuRequiredLimits>,
    pub default_queue: Option<GpuQueueDescriptor>,
}

#[napi(object)]
pub struct GpuQueueDescriptor {
    pub label: Option<String>,
}

#[napi(object)]
pub struct GpuRequiredLimits {
    pub max_texture_dimension_1d: Option<u32>,
    pub max_texture_dimension_2d: Option<u32>,
    pub max_texture_dimension_3d: Option<u32>,
    pub max_texture_array_layers: Option<u32>,
    pub max_bind_groups: Option<u32>,
    pub max_bindings_per_bind_group: Option<u32>,
    pub max_dynamic_uniform_buffers_per_pipeline_layout: Option<u32>,
    pub max_dynamic_storage_buffers_per_pipeline_layout: Option<u32>,
    pub max_sampled_textures_per_shader_stage: Option<u32>,
    pub max_samplers_per_shader_stage: Option<u32>,
    pub max_storage_buffers_per_shader_stage: Option<u32>,
    pub max_storage_textures_per_shader_stage: Option<u32>,
    pub max_uniform_buffers_per_shader_stage: Option<u32>,
    pub max_uniform_buffer_binding_size: Option<f64>,
    pub max_storage_buffer_binding_size: Option<f64>,
    pub min_uniform_buffer_offset_alignment: Option<u32>,
    pub min_storage_buffer_offset_alignment: Option<u32>,
    pub max_vertex_buffers: Option<u32>,
    pub max_buffer_size: Option<f64>,
    pub max_vertex_attributes: Option<u32>,
    pub max_vertex_buffer_array_stride: Option<u32>,
    pub max_compute_workgroup_storage_size: Option<u32>,
    pub max_compute_invocations_per_workgroup: Option<u32>,
    pub max_compute_workgroup_size_x: Option<u32>,
    pub max_compute_workgroup_size_y: Option<u32>,
    pub max_compute_workgroup_size_z: Option<u32>,
    pub max_compute_workgroups_per_dimension: Option<u32>,
}

fn required_limits_to_wgpu(r: &GpuRequiredLimits) -> wgpu::Limits {
    let mut l = wgpu::Limits::default();
    if let Some(v) = r.max_texture_dimension_1d { l.max_texture_dimension_1d = v; }
    if let Some(v) = r.max_texture_dimension_2d { l.max_texture_dimension_2d = v; }
    if let Some(v) = r.max_texture_dimension_3d { l.max_texture_dimension_3d = v; }
    if let Some(v) = r.max_texture_array_layers { l.max_texture_array_layers = v; }
    if let Some(v) = r.max_bind_groups { l.max_bind_groups = v; }
    if let Some(v) = r.max_bindings_per_bind_group { l.max_bindings_per_bind_group = v; }
    if let Some(v) = r.max_dynamic_uniform_buffers_per_pipeline_layout { l.max_dynamic_uniform_buffers_per_pipeline_layout = v; }
    if let Some(v) = r.max_dynamic_storage_buffers_per_pipeline_layout { l.max_dynamic_storage_buffers_per_pipeline_layout = v; }
    if let Some(v) = r.max_sampled_textures_per_shader_stage { l.max_sampled_textures_per_shader_stage = v; }
    if let Some(v) = r.max_samplers_per_shader_stage { l.max_samplers_per_shader_stage = v; }
    if let Some(v) = r.max_storage_buffers_per_shader_stage { l.max_storage_buffers_per_shader_stage = v; }
    if let Some(v) = r.max_storage_textures_per_shader_stage { l.max_storage_textures_per_shader_stage = v; }
    if let Some(v) = r.max_uniform_buffers_per_shader_stage { l.max_uniform_buffers_per_shader_stage = v; }
    if let Some(v) = r.max_uniform_buffer_binding_size { l.max_uniform_buffer_binding_size = v as u32; }
    if let Some(v) = r.max_storage_buffer_binding_size { l.max_storage_buffer_binding_size = v as u32; }
    if let Some(v) = r.min_uniform_buffer_offset_alignment { l.min_uniform_buffer_offset_alignment = v; }
    if let Some(v) = r.min_storage_buffer_offset_alignment { l.min_storage_buffer_offset_alignment = v; }
    if let Some(v) = r.max_vertex_buffers { l.max_vertex_buffers = v; }
    if let Some(v) = r.max_buffer_size { l.max_buffer_size = v as u64; }
    if let Some(v) = r.max_vertex_attributes { l.max_vertex_attributes = v; }
    if let Some(v) = r.max_vertex_buffer_array_stride { l.max_vertex_buffer_array_stride = v; }
    if let Some(v) = r.max_compute_workgroup_storage_size { l.max_compute_workgroup_storage_size = v; }
    if let Some(v) = r.max_compute_invocations_per_workgroup { l.max_compute_invocations_per_workgroup = v; }
    if let Some(v) = r.max_compute_workgroup_size_x { l.max_compute_workgroup_size_x = v; }
    if let Some(v) = r.max_compute_workgroup_size_y { l.max_compute_workgroup_size_y = v; }
    if let Some(v) = r.max_compute_workgroup_size_z { l.max_compute_workgroup_size_z = v; }
    if let Some(v) = r.max_compute_workgroups_per_dimension { l.max_compute_workgroups_per_dimension = v; }
    l
}

#[napi]
pub struct GpuAdapter {
    pub(crate) inner: Arc<wgpu::Adapter>,
    pub(crate) instance: Arc<wgpu::Instance>,
}

#[napi]
impl GpuAdapter {
    #[napi(getter)]
    pub fn features(&self) -> GpuSupportedFeatures {
        GpuSupportedFeatures::from_wgpu(self.inner.features())
    }

    #[napi(getter)]
    pub fn limits(&self) -> GpuSupportedLimits {
        limits_to_js(&self.inner.limits())
    }

    #[napi(getter)]
    pub fn is_fallback_adapter(&self) -> bool {
        self.inner.get_info().device_type == wgpu::DeviceType::Cpu
    }

    #[napi(getter)]
    pub fn info(&self) -> GpuAdapterInfo {
        let i = self.inner.get_info();
        let lim = self.inner.limits();
        let name = i.name;
        GpuAdapterInfo {
            vendor: i.vendor.to_string(),
            architecture: name.clone(),
            device: i.device.to_string(),
            description: name,
            backend_type: convert::backend_to_str(i.backend).to_string(),
            device_type: convert::device_type_to_str(i.device_type).to_string(),
            is_fallback_adapter: i.device_type == wgpu::DeviceType::Cpu,
            subgroup_min_size: lim.min_subgroup_size,
            subgroup_max_size: lim.max_subgroup_size,
        }
    }

    #[napi]
    pub async fn request_device(&self, descriptor: Option<GpuDeviceDescriptor>) -> napi::Result<GpuDevice> {
        let adapter = Arc::clone(&self.inner);

        let mut required_features = wgpu::Features::empty();
        let mut required_limits = wgpu::Limits::default();
        let mut label = None::<String>;
        let mut queue_label = None::<String>;

        if let Some(ref desc) = descriptor {
            label = desc.label.clone();
            if let Some(ref feats) = desc.required_features {
                for f in feats {
                    if let Some(wf) = convert::feature_to_wgpu(f) {
                        required_features |= wf;
                    }
                }
            }
            if let Some(ref lim) = desc.required_limits {
                required_limits = required_limits_to_wgpu(lim);
            }
            if let Some(ref qd) = desc.default_queue {
                queue_label = qd.label.clone();
            }
        }

        required_features |= wgpu::Features::PUSH_CONSTANTS;

        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: label.as_deref(),
                    required_features,
                    required_limits,
                    memory_hints: wgpu::MemoryHints::default(),
                },
                None,
            )
            .await
            .map_err(map_err_display)?;

        // ── shared state for onuncapturederror ────────────────────────────────
        let uncaptured_error_tsfn: Arc<Mutex<Option<UncapturedErrorTsfn>>> =
            Arc::new(Mutex::new(None));
        let tsfn_ref = Arc::clone(&uncaptured_error_tsfn);

        device.on_uncaptured_error(Box::new(move |e| {
            let guard = tsfn_ref.lock().expect("uncaptured_error_tsfn lock");
            if let Some(tsfn) = guard.as_ref() {
                let r#type = match &e {
                    wgpu::Error::Validation { .. } => "validation",
                    wgpu::Error::OutOfMemory { .. } => "out-of-memory",
                    wgpu::Error::Internal { .. } => "internal",
                }
                    .to_string();
                let event = GpuUncapturedErrorEvent {
                    error: GpuError { r#type, message: e.to_string() },
                };
                tsfn.call(Ok(event), ThreadsafeFunctionCallMode::NonBlocking);
            } else {
                eprintln!("[wgpu] uncaptured error: {e:?}");
            }
        }));

        // ── device.lost watch channel ─────────────────────────────────────────
        let (lost_tx, lost_rx) = watch::channel::<Option<(String, String)>>(None);

        device.set_device_lost_callback(move |reason, message| {
            let reason_str = match reason {
                wgpu::DeviceLostReason::Destroyed => "destroyed",
                _ => "unknown",
            }
                .to_string();
            // Ignore send errors: all receivers may have been dropped if the
            // GpuDevice is already being garbage-collected.
            let _ = lost_tx.send(Some((reason_str, message)));
        });

        let raw_info = adapter.get_info();
        let device = Arc::new(device);
        let queue = Arc::new(queue);
        let lost_rx = Arc::new(lost_rx);
        Ok(GpuDevice::new(device, queue, label, queue_label, raw_info, lost_rx, uncaptured_error_tsfn))
    }
}

#[napi(object)]
pub struct GpuAdapterInfo {
    pub vendor: String,
    pub architecture: String,
    pub device: String,
    pub description: String,
    pub backend_type: String,
    pub device_type: String,
    pub is_fallback_adapter: bool,
    // wgpu exposes these via Limits; default 0 when the backend doesn't report them
    pub subgroup_min_size: u32,
    pub subgroup_max_size: u32,
}
