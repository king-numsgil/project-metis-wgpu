use super::convert;
use napi_derive::napi;
use std::sync::Arc;

#[napi(object)]
pub struct GpuSamplerDescriptor {
    pub label: Option<String>,
    #[napi(ts_type = "GPUAddressMode")]
    pub address_mode_u: Option<String>,
    #[napi(ts_type = "GPUAddressMode")]
    pub address_mode_v: Option<String>,
    #[napi(ts_type = "GPUAddressMode")]
    pub address_mode_w: Option<String>,
    #[napi(ts_type = "GPUFilterMode")]
    pub mag_filter: Option<String>,
    #[napi(ts_type = "GPUFilterMode")]
    pub min_filter: Option<String>,
    #[napi(ts_type = "GPUFilterMode")]
    pub mipmap_filter: Option<String>,
    pub lod_min_clamp: Option<f64>,
    pub lod_max_clamp: Option<f64>,
    #[napi(ts_type = "GPUCompareFunction")]
    pub compare: Option<String>,
    pub max_anisotropy: Option<u16>,
}

#[napi]
pub struct GpuSampler {
    pub(crate) inner: Arc<wgpu::Sampler>,
}

impl GpuSampler {
    pub(crate) fn new(inner: wgpu::Sampler) -> Self {
        Self { inner: Arc::new(inner) }
    }
}

pub fn build_descriptor(desc: &GpuSamplerDescriptor) -> napi::Result<wgpu::SamplerDescriptor<'_>> {
    let compare = if let Some(ref c) = desc.compare {
        Some(convert::compare_function(c)?)
    } else {
        None
    };

    Ok(wgpu::SamplerDescriptor {
        label: desc.label.as_deref(),
        address_mode_u: desc.address_mode_u.as_deref().map(convert::address_mode).transpose()?.unwrap_or(wgpu::AddressMode::ClampToEdge),
        address_mode_v: desc.address_mode_v.as_deref().map(convert::address_mode).transpose()?.unwrap_or(wgpu::AddressMode::ClampToEdge),
        address_mode_w: desc.address_mode_w.as_deref().map(convert::address_mode).transpose()?.unwrap_or(wgpu::AddressMode::ClampToEdge),
        mag_filter: desc.mag_filter.as_deref().map(convert::filter_mode).transpose()?.unwrap_or(wgpu::FilterMode::Nearest),
        min_filter: desc.min_filter.as_deref().map(convert::filter_mode).transpose()?.unwrap_or(wgpu::FilterMode::Nearest),
        mipmap_filter: desc.mipmap_filter.as_deref().map(convert::mipmap_filter_mode).transpose()?.unwrap_or(wgpu::MipmapFilterMode::Nearest),
        lod_min_clamp: desc.lod_min_clamp.unwrap_or(0.0) as f32,
        lod_max_clamp: desc.lod_max_clamp.unwrap_or(32.0) as f32,
        compare,
        anisotropy_clamp: desc.max_anisotropy.unwrap_or(1),
        border_color: None,
    })
}
