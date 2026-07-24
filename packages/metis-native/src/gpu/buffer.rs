use super::error::map_err_display;
use napi::bindgen_prelude::*;
use napi::sys;
use napi::Env;
use napi_derive::napi;
use std::os::raw::c_void;
use std::sync::{Arc, Mutex};

#[napi(object)]
pub struct GpuBufferDescriptor {
    pub label: Option<String>,
    pub size: f64,
    pub usage: u32,
    pub mapped_at_creation: Option<bool>,
}

/// A range handed out by `getMappedRange`: the wgpu view keeps the mapping (and
/// its host pointer) alive, and `ab_ref` is a persistent napi reference to the
/// external `ArrayBuffer` that aliases it, so `unmap()`/`destroy()` can **detach**
/// the ArrayBuffer before the pointer dies.
struct HandedRange {
    _view: wgpu::BufferView,
    ab_ref: usize, // sys::napi_ref as usize — only ever used on the JS thread
}

/// The mapped ArrayBuffers handed out for this buffer.
///
/// SAFETY: only ever created, read, and dropped on the JS (napi) thread —
/// `getMappedRange` / `unmap` / `destroy` are synchronous napi methods, and
/// `map_async` (which runs on a worker) never touches this, only the boolean
/// flag. The raw wgpu view pointer and the napi ref are therefore never used
/// off-thread, so the manual `Send`/`Sync` is sound.
struct MappedRanges(Vec<HandedRange>);
unsafe impl Send for MappedRanges {}
unsafe impl Sync for MappedRanges {}

#[napi]
pub struct GpuBuffer {
    pub(crate) inner: Arc<wgpu::Buffer>,
    pub(crate) device: Arc<wgpu::Device>,
    pub(crate) size: u64,
    pub(crate) usage: u32,
    label: Mutex<Option<String>>,
    mapped: Mutex<bool>,
    mapped_ranges: Mutex<MappedRanges>,
}

impl GpuBuffer {
    pub(crate) fn new(inner: wgpu::Buffer, device: Arc<wgpu::Device>, size: u64, usage: u32, label: Option<String>, mapped_at_creation: bool) -> Self {
        Self {
            inner: Arc::new(inner),
            device,
            size,
            usage,
            label: Mutex::new(label),
            mapped: Mutex::new(mapped_at_creation),
            mapped_ranges: Mutex::new(MappedRanges(Vec::new())),
        }
    }

    /// Detach every handed-out mapped ArrayBuffer and release its wgpu view.
    ///
    /// Detaching first (while the view — and thus the host pointer — is still
    /// alive) is what makes this safe: after this returns, JS holds detached
    /// (zero-length) ArrayBuffers instead of live aliases into memory that the
    /// following `unmap()`/`destroy()` invalidates.
    fn detach_all(&self, env: &Env) {
        let mut ranges = self.mapped_ranges.lock().unwrap();
        for range in ranges.0.drain(..) {
            let ab_ref = range.ab_ref as sys::napi_ref;
            unsafe {
                let mut val: sys::napi_value = std::ptr::null_mut();
                if sys::napi_get_reference_value(env.raw(), ab_ref, &mut val) == sys::Status::napi_ok
                    && !val.is_null()
                {
                    // Ignore the result: an already-detached buffer is fine.
                    let _ = sys::napi_detach_arraybuffer(env.raw(), val);
                }
                let _ = sys::napi_delete_reference(env.raw(), ab_ref);
            }
            // range._view drops here, releasing wgpu's range tracking.
        }
    }
}

fn napi_ok(status: sys::napi_status, msg: &str) -> napi::Result<()> {
    if status == sys::Status::napi_ok {
        Ok(())
    } else {
        Err(napi::Error::new(napi::Status::GenericFailure, format!("{msg} (napi_status={status})")))
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
    /// The debug label (read-write).
    #[napi(getter)]
    pub fn label(&self) -> Option<String> { self.label.lock().unwrap().clone() }
    #[napi(setter)]
    pub fn set_label(&self, label: String) { *self.label.lock().unwrap() = Some(label); }

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
    /// is ready for `getMappedRange`. Call `unmap()` before using the buffer on
    /// the GPU again.
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

    /// Return an `ArrayBuffer` that **aliases** the mapped memory directly — no
    /// copy — matching the WebGPU spec (offset multiple of 8, size multiple of
    /// 4; defaults to the whole buffer). The buffer must be mapped (via
    /// `mapAsync` or `mappedAtCreation`). Wrap it to read/write, e.g.
    /// `new Float32Array(range)`.
    ///
    /// The range stays valid until `unmap()` / `destroy()`, which **detach** it
    /// (its `byteLength` becomes 0 and further access throws) so JS can never
    /// read freed GPU memory. Writes into a `MAP_WRITE` / `mappedAtCreation`
    /// range are flushed to the GPU by `unmap()`.
    ///
    /// Non-overlapping ranges may be requested with multiple calls. (Note:
    /// mapped memory can be write-combining on some backends, so reading back a
    /// value you just wrote into a write-mapped range is not guaranteed fast or
    /// coherent — write-mapped ranges are meant to be written, not read.)
    #[napi(ts_return_type = "ArrayBuffer")]
    pub fn get_mapped_range<'env>(&self, env: &'env Env, offset: Option<f64>, size: Option<f64>) -> napi::Result<Unknown<'env>> {
        if !*self.mapped.lock().unwrap() {
            return Err(napi::Error::new(napi::Status::GenericFailure, "Buffer is not mapped"));
        }
        let offset = offset.unwrap_or(0.0) as u64;
        let end = size.map_or(self.size, |s| offset + s as u64);
        let view = self.inner.slice(offset..end).get_mapped_range().map_err(map_err_display)?;
        // Pointer into the live mapped memory. The `HandedRange` keeps `view`
        // alive (and thus this pointer valid) until unmap()/destroy().
        let ptr = view.as_ptr() as *mut c_void;
        let len = view.len();

        // Aliasing external ArrayBuffer — no copy. No finalizer: wgpu owns the
        // memory, and we invalidate JS access explicitly via detach on unmap.
        let mut ab: sys::napi_value = std::ptr::null_mut();
        napi_ok(
            unsafe {
                sys::napi_create_external_arraybuffer(env.raw(), ptr, len, None, std::ptr::null_mut(), &mut ab)
            },
            "napi_create_external_arraybuffer failed (does this runtime support external ArrayBuffers?)",
        )?;

        // Persistent reference so unmap()/destroy() can detach this exact buffer.
        let mut ab_ref: sys::napi_ref = std::ptr::null_mut();
        napi_ok(
            unsafe { sys::napi_create_reference(env.raw(), ab, 1, &mut ab_ref) },
            "napi_create_reference failed",
        )?;

        self.mapped_ranges.lock().unwrap().0.push(HandedRange { _view: view, ab_ref: ab_ref as usize });

        unsafe { Unknown::from_napi_value(env.raw(), ab) }
    }

    /// Unmap the buffer, making it usable by the GPU again. Detaches every
    /// `ArrayBuffer` handed out by `getMappedRange` (they become zero-length),
    /// and flushes writes made into a `MAP_WRITE` / `mappedAtCreation` range.
    #[napi]
    pub fn unmap(&self, env: &Env) -> napi::Result<()> {
        self.detach_all(env);
        self.inner.unmap();
        *self.mapped.lock().unwrap() = false;
        Ok(())
    }

    /// Free the buffer's GPU memory now. Detaches any mapped `ArrayBuffer`
    /// first. Subsequent use is a validation error; the handle becomes inert.
    #[napi]
    pub fn destroy(&self, env: &Env) {
        self.detach_all(env);
        self.inner.destroy();
        *self.mapped.lock().unwrap() = false;
    }
}
