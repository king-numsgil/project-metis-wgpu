use super::error::map_err_display;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::sync::{Arc, Mutex};

#[napi(object)]
pub struct GpuBufferDescriptor {
    pub label: Option<String>,
    pub size: f64,
    pub usage: u32,
    pub mapped_at_creation: Option<bool>,
}

#[napi]
pub struct GpuBuffer {
    pub(crate) inner: Arc<wgpu::Buffer>,
    pub(crate) device: Arc<wgpu::Device>,
    pub(crate) size: u64,
    pub(crate) usage: u32,
    label: Option<String>,
    mapped: Mutex<bool>,
}

impl GpuBuffer {
    pub(crate) fn new(inner: wgpu::Buffer, device: Arc<wgpu::Device>, size: u64, usage: u32, label: Option<String>, mapped_at_creation: bool) -> Self {
        Self { inner: Arc::new(inner), device, size, usage, label, mapped: Mutex::new(mapped_at_creation) }
    }
}

#[napi]
impl GpuBuffer {
    #[napi(getter)]
    pub fn size(&self) -> f64 { self.size as f64 }
    #[napi(getter)]
    pub fn usage(&self) -> u32 { self.usage }
    #[napi(getter)]
    pub fn label(&self) -> Option<String> { self.label.clone() }

    #[napi(getter)]
    pub fn map_state(&self) -> String {
        if *self.mapped.lock().unwrap() { "mapped".into() } else { "unmapped".into() }
    }

    #[napi]
    pub async fn map_async(&self, mode: u32, offset: Option<f64>, size: Option<f64>) -> napi::Result<()> {
        let offset = offset.unwrap_or(0.0) as u64;
        let end = size.map_or(self.size, |s| offset + s as u64);
        let map_mode = if mode & 0x0001 != 0 {
            wgpu::MapMode::Read
        } else if mode & 0x0002 != 0 {
            wgpu::MapMode::Write
        } else {
            return Err(napi::Error::new(napi::Status::InvalidArg, "GPUMapMode must be READ (1) or WRITE (2)"));
        };

        let (tx, rx) = tokio::sync::oneshot::channel::<std::result::Result<(), String>>();
        self.inner.slice(offset..end).map_async(map_mode, move |r| {
            let result: std::result::Result<(), String> = r.map_err(|e| format!("{e:?}"));
            let _ = tx.send(result);
        });

        let device = Arc::clone(&self.device);
        // `poll` returns a Result as of wgpu 25. Dropping it would turn a lost
        // device or a timed-out wait into a hang on the channel below, or a
        // bare "channel closed" that names neither cause.
        tokio::task::spawn_blocking(move || device.poll(wgpu::PollType::wait_indefinitely()))
            .await
            .map_err(|e| napi::Error::new(napi::Status::GenericFailure, e.to_string()))?
            .map_err(map_err_display)?;

        let map_result: std::result::Result<(), String> = rx.await
            .map_err(|_| napi::Error::new(napi::Status::GenericFailure, "mapping channel closed"))?;
        if let Err(msg) = map_result {
            return Err(napi::Error::new(napi::Status::GenericFailure, msg));
        }

        *self.mapped.lock().unwrap() = true;
        Ok(())
    }

    #[napi]
    pub fn get_mapped_range(&self, offset: Option<f64>, size: Option<f64>) -> napi::Result<Uint8Array> {
        if !*self.mapped.lock().unwrap() {
            return Err(napi::Error::new(napi::Status::GenericFailure, "Buffer is not mapped"));
        }
        let offset = offset.unwrap_or(0.0) as u64;
        let end = size.map_or(self.size, |s| offset + s as u64);
        let view = self.inner.slice(offset..end).get_mapped_range().map_err(map_err_display)?;
        Ok(Uint8Array::new(view.to_vec()))
    }

    #[napi]
    pub fn write_mapped_range(
        &self,
        data: Uint8Array,
        buffer_offset: Option<f64>,
        data_offset: Option<f64>,
        size: Option<f64>,
    ) -> napi::Result<()> {
        if !*self.mapped.lock().unwrap() {
            return Err(napi::Error::new(napi::Status::GenericFailure, "Buffer is not mapped"));
        }
        let buf_off = buffer_offset.unwrap_or(0.0) as u64;
        let dat_off = data_offset.unwrap_or(0.0) as usize;
        let dat_end = size.map_or(data.len(), |s| dat_off + s as usize);
        let src = &data[dat_off..dat_end];
        let end = buf_off + src.len() as u64;
        let mut view = self.inner.slice(buf_off..end).get_mapped_range_mut().map_err(map_err_display)?;
        view.copy_from_slice(src);
        Ok(())
    }

    #[napi]
    pub fn unmap(&self) -> napi::Result<()> {
        self.inner.unmap();
        *self.mapped.lock().unwrap() = false;
        Ok(())
    }

    #[napi]
    pub fn destroy(&self) { self.inner.destroy(); }
}
