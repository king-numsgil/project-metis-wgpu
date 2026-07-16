use super::buffer::GpuBuffer;
use super::command_encoder::GpuCommandBuffer;
use super::convert;
use super::texture::{GpuExtent3D, GpuImageCopyTexture, GpuImageDataLayout};
use napi::bindgen_prelude::{Reference, Uint8Array};
use napi_derive::napi;
use std::sync::Arc;

#[napi]
pub struct GpuQueue {
    pub(crate) inner: Arc<wgpu::Queue>,
    pub(crate) device: Arc<wgpu::Device>,
    pub(crate) label: Option<String>,
}

#[napi]
impl GpuQueue {
    #[napi(getter)]
    pub fn label(&self) -> Option<String> {
        self.label.clone()
    }

    /// Nanoseconds per timestamp-query tick — the multiplier that turns the raw
    /// `u64` deltas written by `writeTimestamp` / `timestampWrites` into real
    /// time. Meaningless unless the `timestamp-query` feature is enabled, and
    /// only comparable between two timestamps from the same queue submission.
    ///
    /// Not in the WebGPU spec, which has no way to interpret timestamp values
    /// at all; wgpu exposes the period instead.
    #[napi]
    pub fn get_timestamp_period(&self) -> f64 {
        self.inner.get_timestamp_period() as f64
    }

    #[napi]
    pub fn submit(&self, command_buffers: Vec<Reference<GpuCommandBuffer>>) -> napi::Result<()> {
        let mut bufs: Vec<wgpu::CommandBuffer> = Vec::with_capacity(command_buffers.len());
        for cb in &command_buffers {
            let buf = cb.take().ok_or_else(|| {
                napi::Error::new(napi::Status::GenericFailure, "CommandBuffer already submitted")
            })?;
            bufs.push(buf);
        }
        self.inner.submit(bufs);
        Ok(())
    }

    #[napi]
    pub fn write_buffer(
        &self,
        buffer: &GpuBuffer,
        buffer_offset: f64,
        data: Uint8Array,
        data_offset: Option<f64>,
        size: Option<f64>,
    ) -> napi::Result<()> {
        let buf_off = buffer_offset as u64;
        let dat_off = data_offset.unwrap_or(0.0) as usize;
        let dat_end = if let Some(s) = size {
            dat_off + s as usize
        } else {
            data.len()
        };
        self.inner.write_buffer(&buffer.inner, buf_off, &data[dat_off..dat_end]);
        Ok(())
    }

    #[napi]
    pub fn write_texture(
        &self,
        destination: GpuImageCopyTexture,
        data: Uint8Array,
        data_layout: GpuImageDataLayout,
        size: GpuExtent3D,
    ) -> napi::Result<()> {
        let aspect = destination.aspect.as_deref().map(convert::texture_aspect).transpose()?.unwrap_or(wgpu::TextureAspect::All);
        let origin = destination.origin.as_ref()
            .map(|o| wgpu::Origin3d { x: o.x.unwrap_or(0), y: o.y.unwrap_or(0), z: o.z.unwrap_or(0) })
            .unwrap_or(wgpu::Origin3d::ZERO);
        let dst = wgpu::TexelCopyTextureInfo {
            texture: &destination.texture.inner,
            mip_level: destination.mip_level.unwrap_or(0),
            origin,
            aspect,
        };
        let layout = wgpu::TexelCopyBufferLayout {
            offset: data_layout.offset.unwrap_or(0.0) as u64,
            bytes_per_row: data_layout.bytes_per_row,
            rows_per_image: data_layout.rows_per_image,
        };
        let extent = wgpu::Extent3d {
            width: size.width,
            height: size.height.unwrap_or(1),
            depth_or_array_layers: size.depth_or_array_layers.unwrap_or(1),
        };
        self.inner.write_texture(dst, &data, layout, extent);
        Ok(())
    }

    #[napi]
    pub async fn on_submitted_work_done(&self) -> napi::Result<()> {
        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        // Flush any pending write_buffer staging copies (wgpu defers them to the next submit).
        self.inner.submit([]);
        self.inner.on_submitted_work_done(move || {
            let _ = tx.send(());
        });
        let device = Arc::clone(&self.device);
        tokio::task::spawn_blocking(move || device.poll(wgpu::Maintain::Wait))
            .await
            .map_err(|e| napi::Error::new(napi::Status::GenericFailure, e.to_string()))?;
        rx.await.map_err(|_| napi::Error::new(napi::Status::GenericFailure, "queue channel closed"))?;
        Ok(())
    }
}
