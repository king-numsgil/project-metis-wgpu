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
        .unwrap_or(wgpu::Backends::VULKAN);

    let power_preference = options
        .as_ref()
        .and_then(|o| o.power_preference.as_deref())
        .map(convert::power_preference)
        .transpose()?
        .unwrap_or(wgpu::PowerPreference::HighPerformance);

    let force_fallback = options
        .as_ref()
        .and_then(|o| o.force_fallback_adapter)
        .unwrap_or(false);

    Ok((backends, power_preference, force_fallback))
}

/// wgpu 30 dropped `Default` for `InstanceDescriptor` and made `Instance::new`
/// take it by value, so the three entry points below share this instead of
/// repeating a struct literal. The display handle is deliberately *not* set
/// here: it is optional on the instance and we pass it per-surface instead
/// (see `create_surface`), which keeps a surfaceless instance legal.
fn build_instance(backends: wgpu::Backends) -> Arc<wgpu::Instance> {
    let mut desc = wgpu::InstanceDescriptor::new_without_display_handle();
    desc.backends = backends;
    desc.flags |= wgpu::InstanceFlags::ALLOW_UNDERLYING_NONCOMPLIANT_ADAPTER;
    Arc::new(wgpu::Instance::new(desc))
}

/// Top-level entry point. In a browser this would be `navigator.gpu.requestAdapter()`;
/// here we export it directly from the module.
#[napi]
pub async fn request_adapter(options: Option<GpuRequestAdapterOptions>) -> napi::Result<Option<GpuAdapter>> {
    let (backends, power_preference, force_fallback) = parse_options(&options)?;

    let instance = build_instance(backends);

    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference,
            force_fallback_adapter: force_fallback,
            compatible_surface: None,
            // Limit bucketing exists to stop untrusted web content fingerprinting
            // the GPU. This is a native app talking to its own hardware, and
            // rounding the real limits down would only hide capability we want.
            apply_limit_buckets: false,
        })
        .await;

    Ok(adapter_to_js(adapter, &instance))
}

/// Lists **every** adapter the given backends expose, instead of letting wgpu
/// pick one. `requestAdapter` returns a single adapter chosen by
/// `powerPreference`, which is a hint — this is how you find out what it
/// actually had to choose between, and what each one reports.
///
/// Worth reaching for when a machine has several GPUs, when performance is
/// inexplicably bad (a software rasterizer looks like a normal adapter until
/// you read `info.deviceType`), or when `requestDevice` fails on limits and you
/// need to know whether another adapter would do better.
///
/// The returned adapters are usable, but for **windowed** rendering prefer
/// `requestAdapterForWindow` — an adapter picked from this list is not
/// guaranteed to be compatible with a given window's surface.
#[napi]
pub async fn enumerate_adapters(options: Option<GpuRequestAdapterOptions>) -> napi::Result<Vec<GpuAdapter>> {
    let (backends, _, _) = parse_options(&options)?;
    let instance = build_instance(backends);
    Ok(instance
        .enumerate_adapters(backends)
        .await
        .into_iter()
        .map(|a| GpuAdapter { inner: Arc::new(a), instance: Arc::clone(&instance) })
        .collect())
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

    let instance = build_instance(backends);

    // Create a temporary surface just to guide adapter selection.
    let temp_surface = unsafe {
        instance.create_surface_unsafe(wgpu::SurfaceTargetUnsafe::RawHandle {
            raw_window_handle: raw_wh,
            raw_display_handle: Some(raw_dh),
        })
    }
        .map_err(|e| napi::Error::new(napi::Status::GenericFailure, e.to_string()))?;

    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference,
            force_fallback_adapter: force_fallback,
            compatible_surface: Some(&temp_surface),
            apply_limit_buckets: false,
        })
        .await;

    drop(temp_surface);

    Ok(adapter_to_js(adapter, &instance))
}

/// `requestAdapter` resolves to `GPUAdapter | null` per the WebGPU spec, so a
/// failure has to collapse to `null`. wgpu 30 now says *why* it failed, and
/// throwing that away silently is how "no adapter" becomes an unexplained dead
/// end — so the reason goes to stderr on the way past, the same treatment
/// uncaptured errors get.
fn adapter_to_js(
    adapter: Result<wgpu::Adapter, wgpu::RequestAdapterError>,
    instance: &Arc<wgpu::Instance>,
) -> Option<GpuAdapter> {
    match adapter {
        Ok(a) => Some(GpuAdapter {
            inner: Arc::new(a),
            instance: Arc::clone(instance),
        }),
        Err(e) => {
            eprintln!("[metis-native] requestAdapter found no adapter: {e}");
            None
        }
    }
}
