use super::convert;
use napi::bindgen_prelude::Reference;
use napi_derive::napi;
use std::sync::Arc;

#[napi(object)]
pub struct GpuExtent3D {
    pub width: u32,
    pub height: Option<u32>,
    pub depth_or_array_layers: Option<u32>,
}

#[napi(object)]
pub struct GpuTextureDescriptor {
    pub label: Option<String>,
    pub size: GpuExtent3D,
    pub mip_level_count: Option<u32>,
    pub sample_count: Option<u32>,
    #[napi(ts_type = "GPUTextureDimension")]
    pub dimension: Option<String>,
    #[napi(ts_type = "GPUTextureFormat")]
    pub format: String,
    pub usage: u32,
    pub view_formats: Option<Vec<String>>,
}

#[napi(object)]
pub struct GpuTextureViewDescriptor {
    pub label: Option<String>,
    pub format: Option<String>,
    #[napi(ts_type = "GPUTextureViewDimension")]
    pub dimension: Option<String>,
    #[napi(ts_type = "GPUTextureAspect")]
    pub aspect: Option<String>,
    pub base_mip_level: Option<u32>,
    pub mip_level_count: Option<u32>,
    pub base_array_layer: Option<u32>,
    pub array_layer_count: Option<u32>,
}

#[napi(object)]
pub struct GpuOrigin3d {
    pub x: Option<u32>,
    pub y: Option<u32>,
    pub z: Option<u32>,
}

#[napi(object)]
pub struct GpuImageCopyTexture {
    pub texture: Reference<GpuTexture>,
    pub mip_level: Option<u32>,
    pub origin: Option<GpuOrigin3d>,
    #[napi(ts_type = "GPUTextureAspect")]
    pub aspect: Option<String>,
}

#[napi(object)]
pub struct GpuImageCopyBuffer {
    pub buffer: Reference<super::buffer::GpuBuffer>,
    pub offset: Option<f64>,
    pub bytes_per_row: Option<u32>,
    pub rows_per_image: Option<u32>,
}

#[napi(object)]
pub struct GpuImageDataLayout {
    pub offset: Option<f64>,
    pub bytes_per_row: Option<u32>,
    pub rows_per_image: Option<u32>,
}

#[napi]
pub struct GpuTexture {
    pub(crate) inner: Arc<wgpu::Texture>,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) depth_or_array_layers: u32,
    pub(crate) mip_level_count: u32,
    pub(crate) sample_count: u32,
    pub(crate) dimension: wgpu::TextureDimension,
    pub(crate) format: wgpu::TextureFormat,
    pub(crate) usage: u32,
}

impl GpuTexture {
    pub(crate) fn from_desc(inner: wgpu::Texture, desc: &wgpu::TextureDescriptor<'_>, usage: u32) -> Self {
        Self {
            inner: Arc::new(inner),
            width: desc.size.width,
            height: desc.size.height,
            depth_or_array_layers: desc.size.depth_or_array_layers,
            mip_level_count: desc.mip_level_count,
            sample_count: desc.sample_count,
            dimension: desc.dimension,
            format: desc.format,
            usage,
        }
    }
}

#[napi]
impl GpuTexture {
    #[napi]
    pub fn create_view(&self, descriptor: Option<GpuTextureViewDescriptor>) -> napi::Result<GpuTextureView> {
        // Hoist owned data out so references live long enough
        let label: Option<String>;
        let format: Option<wgpu::TextureFormat>;
        let dimension: Option<wgpu::TextureViewDimension>;
        let aspect: wgpu::TextureAspect;
        let base_mip_level: u32;
        let mip_level_count: Option<u32>;
        let base_array_layer: u32;
        let array_layer_count: Option<u32>;

        if let Some(d) = descriptor {
            label = d.label;
            format = d.format.as_deref().map(convert::texture_format).transpose()?;
            dimension = d.dimension.as_deref().map(convert::texture_view_dimension).transpose()?;
            aspect = d.aspect.as_deref().map(convert::texture_aspect).transpose()?.unwrap_or(wgpu::TextureAspect::All);
            base_mip_level = d.base_mip_level.unwrap_or(0);
            mip_level_count = d.mip_level_count;
            base_array_layer = d.base_array_layer.unwrap_or(0);
            array_layer_count = d.array_layer_count;
        } else {
            label = None;
            format = None;
            dimension = None;
            aspect = wgpu::TextureAspect::All;
            base_mip_level = 0;
            mip_level_count = None;
            base_array_layer = 0;
            array_layer_count = None;
        }

        let desc = wgpu::TextureViewDescriptor {
            label: label.as_deref(),
            format,
            dimension,
            aspect,
            base_mip_level,
            mip_level_count,
            base_array_layer,
            array_layer_count,
            usage: None,
        };
        Ok(GpuTextureView { inner: Arc::new(self.inner.create_view(&desc)) })
    }

    #[napi(getter)]
    pub fn width(&self) -> u32 { self.width }
    #[napi(getter)]
    pub fn height(&self) -> u32 { self.height }
    #[napi(getter)]
    pub fn depth_or_array_layers(&self) -> u32 { self.depth_or_array_layers }
    #[napi(getter)]
    pub fn mip_level_count(&self) -> u32 { self.mip_level_count }
    #[napi(getter)]
    pub fn sample_count(&self) -> u32 { self.sample_count }
    #[napi(getter, ts_return_type = "GPUTextureDimension")]
    pub fn dimension(&self) -> String { convert::texture_dimension_to_str(self.dimension).to_string() }
    #[napi(getter, ts_return_type = "GPUTextureFormat")]
    pub fn format(&self) -> String { convert::texture_format_to_str(self.format).to_string() }
    #[napi(getter)]
    pub fn usage(&self) -> u32 { self.usage }

    #[napi(getter, ts_return_type = "GPUTextureViewDimension")]
    pub fn texture_binding_view_dimension(&self) -> String {
        let view_dim = match self.dimension {
            wgpu::TextureDimension::D1 => wgpu::TextureViewDimension::D1,
            wgpu::TextureDimension::D2 => {
                if self.depth_or_array_layers > 1 {
                    wgpu::TextureViewDimension::D2Array
                } else {
                    wgpu::TextureViewDimension::D2
                }
            }
            wgpu::TextureDimension::D3 => wgpu::TextureViewDimension::D3,
        };
        convert::texture_view_dimension_to_str(view_dim).to_string()
    }

    #[napi]
    pub fn destroy(&self) { self.inner.destroy(); }
}

#[napi]
pub struct GpuTextureView {
    pub(crate) inner: Arc<wgpu::TextureView>,
}
