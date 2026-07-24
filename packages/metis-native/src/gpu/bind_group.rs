use super::convert;
use super::texture::GpuTextureView;
use super::sampler::GpuSampler;
use super::buffer::GpuBuffer;
use napi::bindgen_prelude::Reference;
use napi_derive::napi;
use std::sync::{Arc, Mutex};

// ── Bind Group Layout ─────────────────────────────────────────────────────────

#[napi(object)]
pub struct GpuBufferBindingLayout {
    #[napi(ts_type = "GPUBufferBindingType")]
    pub binding_type: Option<String>,
    pub has_dynamic_offset: Option<bool>,
    pub min_binding_size: Option<f64>,
}

#[napi(object)]
pub struct GpuSamplerBindingLayout {
    #[napi(ts_type = "GPUSamplerBindingType")]
    pub sampler_type: Option<String>,
}

#[napi(object)]
pub struct GpuTextureBindingLayout {
    #[napi(ts_type = "GPUTextureSampleType")]
    pub sample_type: Option<String>,
    #[napi(ts_type = "GPUTextureViewDimension")]
    pub view_dimension: Option<String>,
    pub multisampled: Option<bool>,
}

#[napi(object)]
pub struct GpuStorageTextureBindingLayout {
    #[napi(ts_type = "GPUStorageTextureAccess")]
    pub access: Option<String>,
    pub format: String,
    #[napi(ts_type = "GPUTextureViewDimension")]
    pub view_dimension: Option<String>,
}

#[napi(object)]
pub struct GpuBindGroupLayoutEntry {
    pub binding: u32,
    pub visibility: u32,
    pub buffer: Option<GpuBufferBindingLayout>,
    pub sampler: Option<GpuSamplerBindingLayout>,
    pub texture: Option<GpuTextureBindingLayout>,
    pub storage_texture: Option<GpuStorageTextureBindingLayout>,
}

#[napi(object)]
pub struct GpuBindGroupLayoutDescriptor {
    pub label: Option<String>,
    pub entries: Vec<GpuBindGroupLayoutEntry>,
}

fn entry_to_wgpu(e: &GpuBindGroupLayoutEntry) -> napi::Result<wgpu::BindGroupLayoutEntry> {
    let ty = if let Some(ref buf) = e.buffer {
        wgpu::BindingType::Buffer {
            ty: buf.binding_type.as_deref().map(convert::buffer_binding_type).transpose()?.unwrap_or(wgpu::BufferBindingType::Uniform),
            has_dynamic_offset: buf.has_dynamic_offset.unwrap_or(false),
            min_binding_size: buf.min_binding_size.and_then(|s| std::num::NonZeroU64::new(s as u64)),
        }
    } else if let Some(ref samp) = e.sampler {
        wgpu::BindingType::Sampler(
            samp.sampler_type.as_deref().map(convert::sampler_binding_type).transpose()?.unwrap_or(wgpu::SamplerBindingType::Filtering),
        )
    } else if let Some(ref tex) = e.texture {
        wgpu::BindingType::Texture {
            sample_type: tex.sample_type.as_deref().map(convert::texture_sample_type).transpose()?.unwrap_or(wgpu::TextureSampleType::Float { filterable: true }),
            view_dimension: tex.view_dimension.as_deref().map(convert::texture_view_dimension).transpose()?.unwrap_or(wgpu::TextureViewDimension::D2),
            multisampled: tex.multisampled.unwrap_or(false),
        }
    } else if let Some(ref st) = e.storage_texture {
        wgpu::BindingType::StorageTexture {
            access: st.access.as_deref().map(convert::storage_texture_access).transpose()?.unwrap_or(wgpu::StorageTextureAccess::WriteOnly),
            format: convert::texture_format(&st.format)?,
            view_dimension: st.view_dimension.as_deref().map(convert::texture_view_dimension).transpose()?.unwrap_or(wgpu::TextureViewDimension::D2),
        }
    } else {
        return Err(napi::Error::new(
            napi::Status::InvalidArg,
            "GPUBindGroupLayoutEntry must have buffer, sampler, texture, or storageTexture",
        ));
    };

    Ok(wgpu::BindGroupLayoutEntry {
        binding: e.binding,
        visibility: convert::shader_stage(e.visibility),
        ty,
        count: None,
    })
}

/// The declared shape of a bind group — which binding slots exist, their
/// resource types and which shader stages see them. Created by
/// `device.createBindGroupLayout` (or obtained from a pipeline via
/// `getBindGroupLayout`), then referenced by both a pipeline layout and the
/// bind groups validated against it.
#[napi]
pub struct GpuBindGroupLayout {
    pub(crate) inner: Arc<wgpu::BindGroupLayout>,
    label: Mutex<Option<String>>,
}

impl GpuBindGroupLayout {
    pub(crate) fn new(inner: wgpu::BindGroupLayout, label: Option<String>) -> Self {
        Self { inner: Arc::new(inner), label: Mutex::new(label) }
    }

    pub(crate) fn from_desc(device: &wgpu::Device, desc: &GpuBindGroupLayoutDescriptor) -> napi::Result<Self> {
        let entries: Vec<wgpu::BindGroupLayoutEntry> = desc.entries.iter().map(entry_to_wgpu).collect::<napi::Result<_>>()?;
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: desc.label.as_deref(),
            entries: &entries,
        });
        Ok(Self::new(layout, desc.label.clone()))
    }
}

#[napi]
impl GpuBindGroupLayout {
    /// Debug label (read-write).
    #[napi(getter)]
    pub fn label(&self) -> Option<String> { self.label.lock().unwrap().clone() }
    #[napi(setter)]
    pub fn set_label(&self, label: String) { *self.label.lock().unwrap() = Some(label); }
}

// ── Pipeline Layout ───────────────────────────────────────────────────────────

#[napi(object)]
pub struct GpuPipelineLayoutDescriptor {
    pub label: Option<String>,
    pub bind_group_layouts: Vec<Reference<GpuBindGroupLayout>>,
    pub immediate_size: Option<u32>,
}

/// The full resource interface of a pipeline: an ordered set of bind group
/// layouts plus optional immediate-data size. Created by
/// `device.createPipelineLayout` and passed as a pipeline's `layout` (the
/// alternative to `"auto"`).
#[napi]
pub struct GpuPipelineLayout {
    pub(crate) inner: Arc<wgpu::PipelineLayout>,
    label: Mutex<Option<String>>,
}

impl GpuPipelineLayout {
    pub(crate) fn new(inner: wgpu::PipelineLayout, label: Option<String>) -> Self {
        Self { inner: Arc::new(inner), label: Mutex::new(label) }
    }
}

#[napi]
impl GpuPipelineLayout {
    /// Debug label (read-write).
    #[napi(getter)]
    pub fn label(&self) -> Option<String> { self.label.lock().unwrap().clone() }
    #[napi(setter)]
    pub fn set_label(&self, label: String) { *self.label.lock().unwrap() = Some(label); }
}

// ── Bind Group ────────────────────────────────────────────────────────────────

#[napi(object)]
pub struct GpuBufferBinding {
    pub buffer: Reference<GpuBuffer>,
    pub offset: Option<f64>,
    pub size: Option<f64>,
}

#[napi(object)]
pub struct GpuBindGroupEntry {
    pub binding: u32,
    pub buffer: Option<GpuBufferBinding>,
    pub sampler: Option<Reference<GpuSampler>>,
    pub texture_view: Option<Reference<GpuTextureView>>,
}

#[napi(object)]
pub struct GpuBindGroupDescriptor {
    pub label: Option<String>,
    pub layout: Reference<GpuBindGroupLayout>,
    pub entries: Vec<GpuBindGroupEntry>,
}

/// A concrete set of resources (buffers, samplers, texture views) bound to a
/// `GpuBindGroupLayout`, created by `device.createBindGroup`. Attach it to a
/// pass with `pass.setBindGroup(index, group)`.
#[napi]
pub struct GpuBindGroup {
    pub(crate) inner: Arc<wgpu::BindGroup>,
    label: Mutex<Option<String>>,
}

#[napi]
impl GpuBindGroup {
    /// Debug label (read-write).
    #[napi(getter)]
    pub fn label(&self) -> Option<String> { self.label.lock().unwrap().clone() }
    #[napi(setter)]
    pub fn set_label(&self, label: String) { *self.label.lock().unwrap() = Some(label); }
}

impl GpuBindGroup {
    pub(crate) fn new(inner: wgpu::BindGroup, label: Option<String>) -> Self {
        Self { inner: Arc::new(inner), label: Mutex::new(label) }
    }

    pub(crate) fn from_desc(device: &wgpu::Device, desc: &GpuBindGroupDescriptor) -> napi::Result<Self> {
        let mut wgpu_entries: Vec<wgpu::BindGroupEntry> = Vec::with_capacity(desc.entries.len());

        for e in &desc.entries {
            let resource = if let Some(ref bb) = e.buffer {
                let offset = bb.offset.unwrap_or(0.0) as u64;
                let size = bb.size.and_then(|s| std::num::NonZeroU64::new(s as u64));
                wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                    buffer: &bb.buffer.inner,
                    offset,
                    size,
                })
            } else if let Some(ref samp) = e.sampler {
                wgpu::BindingResource::Sampler(&samp.inner)
            } else if let Some(ref tv) = e.texture_view {
                wgpu::BindingResource::TextureView(&tv.inner)
            } else {
                return Err(napi::Error::new(
                    napi::Status::InvalidArg,
                    format!("GPUBindGroupEntry binding {} has no resource", e.binding),
                ));
            };

            wgpu_entries.push(wgpu::BindGroupEntry { binding: e.binding, resource });
        }

        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: desc.label.as_deref(),
            layout: &desc.layout.inner,
            entries: &wgpu_entries,
        });
        Ok(Self::new(bind_group, desc.label.clone()))
    }
}
