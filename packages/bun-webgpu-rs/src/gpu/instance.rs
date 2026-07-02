use super::adapter::GpuAdapter;
use super::convert;
use crate::sdl::window::SdlWindow;
use napi_derive::napi;
use std::sync::Arc;

#[napi(object)]
pub struct GpuRequestAdapterOptions {
    #[napi(ts_type = "GPUPowerPreference")]
    pub power_preference: Option<String>,
    pub force_fallback_adapter: Option<bool>,
    /// Pin the wgpu instance to a specific graphics backend.
    /// Accepted values: `"vulkan"`, `"dx12"`, `"metal"`, `"gl"`.
    /// Omit (or pass `null`) to let wgpu pick from all available backends.
    #[napi(ts_type = "'vulkan' | 'dx12' | 'metal' | 'gl'")]
    pub backend: Option<String>,
}

fn parse_options(options: &Option<GpuRequestAdapterOptions>) -> napi::Result<(wgpu::Backends, wgpu::PowerPreference, bool)> {
    let backends = options
        .as_ref()
        .and_then(|o| o.backend.as_deref())
        .map(convert::backend)
        .transpose()?
        .unwrap_or(wgpu::Backends::all());

    let power_preference = options
        .as_ref()
        .and_then(|o| o.power_preference.as_deref())
        .map(convert::power_preference)
        .transpose()?
        .unwrap_or(wgpu::PowerPreference::None);

    let force_fallback = options
        .as_ref()
        .and_then(|o| o.force_fallback_adapter)
        .unwrap_or(false);

    Ok((backends, power_preference, force_fallback))
}

/// Top-level entry point. In a browser this would be `navigator.gpu.requestAdapter()`;
/// here we export it directly from the module.
#[napi]
pub async fn request_adapter(options: Option<GpuRequestAdapterOptions>) -> napi::Result<Option<GpuAdapter>> {
    let (backends, power_preference, force_fallback) = parse_options(&options)?;

    let instance = Arc::new(wgpu::Instance::new(&wgpu::InstanceDescriptor {
        backends,
        flags: wgpu::InstanceFlags::default(),
        ..Default::default()
    }));

    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference,
            force_fallback_adapter: force_fallback,
            compatible_surface: None,
        })
        .await;

    Ok(adapter.map(|a| GpuAdapter {
        inner: Arc::new(a),
        instance: Arc::clone(&instance),
    }))
}

/// Like `requestAdapter`, but selects an adapter that is guaranteed to be
/// compatible with the given SDL3 window's rendering surface.
///
/// This is the correct entry point for windowed rendering: requesting an
/// adapter without a surface hint may yield an adapter that cannot render to
/// the window at all.
#[napi]
pub async fn request_adapter_for_window(
    window: &SdlWindow,
    options: Option<GpuRequestAdapterOptions>,
) -> napi::Result<Option<GpuAdapter>> {
    // Extract the platform handles synchronously, before any .await.
    let (raw_wh, raw_dh) = super::surface::get_raw_handles(window.raw_ptr())?;

    let (backends, power_preference, force_fallback) = parse_options(&options)?;

    let instance = Arc::new(wgpu::Instance::new(&wgpu::InstanceDescriptor {
        backends,
        flags: wgpu::InstanceFlags::default(),
        ..Default::default()
    }));

    // Create a temporary surface just to guide adapter selection.
    let temp_surface = unsafe {
        instance.create_surface_unsafe(wgpu::SurfaceTargetUnsafe::RawHandle {
            raw_window_handle: raw_wh,
            raw_display_handle: raw_dh,
        })
    }
        .map_err(|e| napi::Error::new(napi::Status::GenericFailure, e.to_string()))?;

    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference,
            force_fallback_adapter: force_fallback,
            compatible_surface: Some(&temp_surface),
        })
        .await;

    drop(temp_surface);

    Ok(adapter.map(|a| GpuAdapter {
        inner: Arc::new(a),
        instance: Arc::clone(&instance),
    }))
}
