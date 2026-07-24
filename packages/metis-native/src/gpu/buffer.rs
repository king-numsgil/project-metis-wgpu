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

/// A block of GPU memory created by `device.createBuffer`.
///
/// Fill it from the CPU via `queue.writeBuffer` (the usual path), or — for a
/// buffer created `mappedAtCreation` or after `mapAsync` — through
/// `getMappedRange` / `writeMappedRange`. Bind it to shaders as a vertex,
/// index, uniform or storage buffer per its `usage` flags. Call `destroy()`
/// when done to free the memory eagerly rather than waiting for GC.
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
    /// Size of the buffer in bytes (as requested at creation).
    #[napi(getter)]
    pub fn size(&self) -> f64 { self.size as f64 }
    /// The `GPUBufferUsage` bitmask this buffer was created with.
    #[napi(getter)]
    pub fn usage(&self) -> u32 { self.usage }
    /// The debug label passed at creation, or `null`.
    #[napi(getter)]
    pub fn label(&self) -> Option<String> { self.label.clone() }

    /// Current map state: `"mapped"` or `"unmapped"`. (The transient
    /// `"pending"` state the spec defines is not surfaced separately here.)
    #[napi(getter)]
    pub fn map_state(&self) -> String {
        if *self.mapped.lock().unwrap() { "mapped".into() } else { "unmapped".into() }
    }

    /// Map the buffer for CPU access and resolve once the mapping is ready.
    ///
    /// `mode` is a `GPUMapMode` bitmask (`READ` or `WRITE`); the buffer must
    /// have the matching `MAP_READ` / `MAP_WRITE` usage. `offset`/`size` bound
    /// the mapped region (defaults: whole buffer from 0). This drives the
    /// device poll internally, so the returned promise settling means the range
    /// is ready for `getMappedRange` / `writeMappedRange`. Call `unmap()` before
    /// using the buffer on the GPU again.
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

    /// Copy the mapped range out as a fresh `Uint8Array`. The buffer must be
    /// mapped (via `mapAsync` or `mappedAtCreation`). `offset`/`size` default to
    /// the whole buffer.
    ///
    /// Unlike the browser spec — which returns a live `ArrayBuffer` view into
    /// the mapping — this returns an owned **copy**, because the napi boundary
    /// can't hand back a borrow of GPU memory. To write into a mapped buffer use
    /// `writeMappedRange`.
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

    /// Write `data` into the mapped buffer (this binding's replacement for
    /// mutating the spec's live mapped `ArrayBuffer`, which the napi boundary
    /// can't expose). The buffer must be mapped for writing.
    ///
    /// `bufferOffset` is where in the buffer to start (default 0);
    /// `dataOffset`/`size` select a sub-slice of `data` (defaults: all of it).
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

    /// Unmap the buffer, flushing any `writeMappedRange` edits and making it
    /// usable by the GPU again. Any array returned by `getMappedRange` is a copy
    /// and stays valid, but must not be written back after this.
    #[napi]
    pub fn unmap(&self) -> napi::Result<()> {
        self.inner.unmap();
        *self.mapped.lock().unwrap() = false;
        Ok(())
    }

    /// Free the buffer's GPU memory now. Subsequent use is a validation error;
    /// the handle itself becomes inert.
    #[napi]
    pub fn destroy(&self) { self.inner.destroy(); }
}
