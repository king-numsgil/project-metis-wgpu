use super::adapter::GpuAdapter;
use super::convert;
use super::device::GpuDevice;
use super::texture::GpuTextureView;
use crate::sdl::window::SdlWindow;
use napi_derive::napi;
use std::sync::{Arc, Mutex};

// ── Platform-specific raw handle extraction via SDL3's property API ───────────

#[cfg(target_os = "windows")]
pub(crate) fn get_raw_handles(
    raw: *mut sdl3_sys::video::SDL_Window,
) -> napi::Result<(raw_window_handle::RawWindowHandle, raw_window_handle::RawDisplayHandle)> {
    use raw_window_handle::{RawDisplayHandle, RawWindowHandle, Win32WindowHandle, WindowsDisplayHandle};
    use sdl3_sys::properties::SDL_GetPointerProperty;
    use sdl3_sys::video::SDL_GetWindowProperties;

    let props = unsafe { SDL_GetWindowProperties(raw) };
    let hwnd = unsafe {
        SDL_GetPointerProperty(
            props,
            c"SDL.window.win32.hwnd".as_ptr(),
            std::ptr::null_mut(),
        )
    };
    if hwnd.is_null() {
        return Err(napi::Error::new(
            napi::Status::GenericFailure,
            "SDL3 did not provide a Win32 HWND for this window",
        ));
    }
    // Try SDL3's property first; fall back to the process HINSTANCE via
    // GetModuleHandleW(NULL), which Vulkan's WSI requires and is always valid.
    extern "system" { fn GetModuleHandleW(lp: *const u16) -> *mut core::ffi::c_void; }
    let hinstance = unsafe {
        let sdl_inst = SDL_GetPointerProperty(
            props,
            c"SDL.window.win32.hinstance".as_ptr(),
            std::ptr::null_mut(),
        );
        if sdl_inst.is_null() { GetModuleHandleW(std::ptr::null()) } else { sdl_inst }
    };
    let mut handle = Win32WindowHandle::new(
        std::num::NonZeroIsize::new(hwnd as isize)
            .ok_or_else(|| napi::Error::new(napi::Status::GenericFailure, "Win32 HWND is zero"))?,
    );
    handle.hinstance = std::num::NonZeroIsize::new(hinstance as isize);
    Ok((
        RawWindowHandle::Win32(handle),
        RawDisplayHandle::Windows(WindowsDisplayHandle::new()),
    ))
}

#[cfg(target_os = "macos")]
pub(crate) fn get_raw_handles(
    raw: *mut sdl3_sys::video::SDL_Window,
) -> napi::Result<(raw_window_handle::RawWindowHandle, raw_window_handle::RawDisplayHandle)> {
    use raw_window_handle::{AppKitDisplayHandle, AppKitWindowHandle, RawDisplayHandle, RawWindowHandle};
    use sdl3_sys::properties::SDL_GetPointerProperty;
    use sdl3_sys::video::SDL_GetWindowProperties;

    let props = unsafe { SDL_GetWindowProperties(raw) };
    let ns_window = unsafe {
        SDL_GetPointerProperty(
            props,
            c"SDL.window.cocoa.window".as_ptr(),
            std::ptr::null_mut(),
        )
    };
    let ns_window = std::ptr::NonNull::new(ns_window).ok_or_else(|| {
        napi::Error::new(napi::Status::GenericFailure, "SDL3 did not provide an NSWindow for this window")
    })?;
    Ok((
        RawWindowHandle::AppKit(AppKitWindowHandle::new(ns_window.cast())),
        RawDisplayHandle::AppKit(AppKitDisplayHandle::new()),
    ))
}

#[cfg(target_os = "linux")]
pub(crate) fn get_raw_handles(
    raw: *mut sdl3_sys::video::SDL_Window,
) -> napi::Result<(raw_window_handle::RawWindowHandle, raw_window_handle::RawDisplayHandle)> {
    use raw_window_handle::{
        RawDisplayHandle, RawWindowHandle,
        WaylandDisplayHandle, WaylandWindowHandle,
        XlibDisplayHandle, XlibWindowHandle,
    };
    use sdl3_sys::properties::{SDL_GetNumberProperty, SDL_GetPointerProperty};
    use sdl3_sys::video::SDL_GetWindowProperties;

    let props = unsafe { SDL_GetWindowProperties(raw) };

    // Prefer Wayland when available.
    let wl_display = unsafe {
        SDL_GetPointerProperty(props, c"SDL.window.wayland.display".as_ptr(), std::ptr::null_mut())
    };
    if !wl_display.is_null() {
        let wl_surface = unsafe {
            SDL_GetPointerProperty(props, c"SDL.window.wayland.surface".as_ptr(), std::ptr::null_mut())
        };
        let wl_surface = std::ptr::NonNull::new(wl_surface).ok_or_else(|| {
            napi::Error::new(napi::Status::GenericFailure, "SDL3 Wayland surface pointer is null")
        })?;
        let wl_display = std::ptr::NonNull::new(wl_display).unwrap();
        return Ok((
            RawWindowHandle::Wayland(WaylandWindowHandle::new(wl_surface)),
            RawDisplayHandle::Wayland(WaylandDisplayHandle::new(wl_display)),
        ));
    }

    // Fall back to X11.
    let x11_display = unsafe {
        SDL_GetPointerProperty(props, c"SDL.window.x11.display".as_ptr(), std::ptr::null_mut())
    };
    let x11_display = std::ptr::NonNull::new(x11_display).ok_or_else(|| {
        napi::Error::new(napi::Status::GenericFailure, "SDL3 did not provide an X11 Display for this window")
    })?;
    let x11_window =
        unsafe { SDL_GetNumberProperty(props, c"SDL.window.x11.window".as_ptr(), 0) } as u64;
    Ok((
        RawWindowHandle::Xlib(XlibWindowHandle::new(x11_window)),
        RawDisplayHandle::Xlib(XlibDisplayHandle::new(Some(x11_display.cast()), 0)),
    ))
}

// ── Surface configuration ─────────────────────────────────────────────────────

#[napi(object)]
pub struct SurfaceConfiguration {
    pub width: u32,
    pub height: u32,
    pub format: Option<String>,
    #[napi(ts_type = "GPUPresentMode")]
    pub present_mode: Option<String>,
    #[napi(ts_type = "GPUAlphaMode")]
    pub alpha_mode: Option<String>,
}

// ── GpuSurface ────────────────────────────────────────────────────────────────

#[napi]
pub struct GpuSurface {
    /// `None` after `destroy()`. The surface is droppable on demand because it
    /// **must** be dropped before the window it was created from — see
    /// `destroy()` for why that ordering is load-bearing rather than tidy.
    pub(crate) inner: Mutex<Option<wgpu::Surface<'static>>>,
    pub(crate) adapter: Arc<wgpu::Adapter>,
}

// wgpu explicitly unsafe-impl's Send+Sync for Surface on native targets.
unsafe impl Send for GpuSurface {}
unsafe impl Sync for GpuSurface {}

#[napi]
impl GpuSurface {
    /// Returns the adapter's preferred texture format for this surface.
    ///
    /// **Call this once at setup, never per frame.** It is not a cheap getter:
    /// `get_capabilities` is a window-system round-trip (measured at ~6 ms on a
    /// GTX 1070 / Vulkan / Windows), because it re-queries the surface's formats,
    /// present modes and alpha modes from the driver every call. The result is a
    /// property of the surface+adapter pair and doesn't change with window size,
    /// so cache it — a render pipeline is built against one format anyway, so a
    /// value that could change mid-run would be a bug, not a feature.
    #[napi(ts_return_type = "GPUTextureFormat")]
    pub fn get_preferred_format(&self) -> napi::Result<String> {
        let guard = self.inner.lock().unwrap();
        let surface = Self::alive(&guard)?;
        let caps = surface.get_capabilities(&self.adapter);
        caps.formats
            .first()
            .map(|f| convert::texture_format_to_str(*f).to_string())
            .ok_or_else(|| {
                napi::Error::new(napi::Status::GenericFailure, "No supported surface formats")
            })
    }

    /// Configure the swapchain. Must be called before the first `getCurrentTexture()` and
    /// again whenever the window is resized. When `present_mode` is omitted the
    /// default is `Mailbox` (falling back to `Fifo` if the surface lacks it).
    #[napi]
    pub fn configure(&self, device: &GpuDevice, config: SurfaceConfiguration) -> napi::Result<()> {
        if config.width == 0 || config.height == 0 {
            return Err(napi::Error::new(
                napi::Status::InvalidArg,
                "Surface width and height must be > 0",
            ));
        }

        let guard = self.inner.lock().unwrap();
        let surface = Self::alive(&guard)?;
        let caps = surface.get_capabilities(&self.adapter);

        let format = if let Some(ref f) = config.format {
            convert::texture_format(f)?
        } else {
            *caps.formats.first().ok_or_else(|| {
                napi::Error::new(napi::Status::GenericFailure, "No supported surface formats")
            })?
        };

        // Resolve the request, then check it against what the surface actually
        // offers. Skipping that check is not a small bug: `configure()` reports
        // an unsupported mode as a *validation error*, which this binding only
        // prints to stderr (see CLAUDE.md) — so the surface silently stays
        // unconfigured and the next `getCurrentTexture()` panics with
        // "Surface is not configured for presentation", aborting the process.
        // One unavailable present mode should degrade, not kill the app.
        //
        // AutoVsync/AutoNoVsync are wgpu meta-modes resolved internally and
        // never appear in `present_modes`, so they're exempt from the check.
        let requested = match config.present_mode.as_deref() {
            Some("fifo") => wgpu::PresentMode::Fifo,
            Some("mailbox") => wgpu::PresentMode::Mailbox,
            Some("immediate") => wgpu::PresentMode::Immediate,
            Some("auto-no-vsync") => wgpu::PresentMode::AutoNoVsync,
            Some("auto-vsync") => wgpu::PresentMode::AutoVsync,
            // Default: prefer Mailbox — tear-free and low-latency, and it avoids
            // the periodic multi-vblank stall in getCurrentTexture() that Fifo/
            // AutoVsync exhibit on some Vulkan drivers when the app renders far
            // faster than refresh. Fall back to Fifo (universally guaranteed) on
            // surfaces that don't advertise Mailbox.
            _ => {
                if caps.present_modes.contains(&wgpu::PresentMode::Mailbox) {
                    wgpu::PresentMode::Mailbox
                } else {
                    wgpu::PresentMode::Fifo
                }
            }
        };

        let is_meta = matches!(
            requested,
            wgpu::PresentMode::AutoVsync | wgpu::PresentMode::AutoNoVsync
        );
        let present_mode = if is_meta || caps.present_modes.contains(&requested) {
            requested
        } else {
            // Fifo is required of every surface, so this always terminates.
            let fallback = if caps.present_modes.contains(&wgpu::PresentMode::Mailbox) {
                wgpu::PresentMode::Mailbox
            } else {
                wgpu::PresentMode::Fifo
            };
            eprintln!(
                "[bun-webgpu-rs] present mode {requested:?} is not supported by this surface                  (available: {:?}); falling back to {fallback:?}. Frame pacing will differ from                  what you asked for — under Fifo the vsync wait lands inside getCurrentTexture().",
                caps.present_modes,
            );
            fallback
        };

        let alpha_mode = match config.alpha_mode.as_deref() {
            Some("premultiplied") => wgpu::CompositeAlphaMode::PreMultiplied,
            Some("postmultiplied") => wgpu::CompositeAlphaMode::PostMultiplied,
            Some("inherit") => wgpu::CompositeAlphaMode::Inherit,
            _ => *caps.alpha_modes.first().unwrap_or(&wgpu::CompositeAlphaMode::Auto),
        };

        surface.configure(
            &device.inner,
            &wgpu::SurfaceConfiguration {
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                format,
                width: config.width,
                height: config.height,
                present_mode,
                alpha_mode,
                view_formats: Vec::new(),
                desired_maximum_frame_latency: 2,
            },
        );
        Ok(())
    }

    /// Acquire the next swapchain image. Call `present()` on the returned
    /// `GpuSurfaceTexture` after submitting your render commands.
    #[napi]
    pub fn get_current_texture(&self) -> napi::Result<GpuSurfaceTexture> {
        let guard = self.inner.lock().unwrap();
        let surface = Self::alive(&guard)?;
        let frame = surface
            .get_current_texture()
            .map_err(|e| napi::Error::new(napi::Status::GenericFailure, e.to_string()))?;
        Ok(GpuSurfaceTexture {
            inner: Mutex::new(Some(frame)),
        })
    }

    /// Release the swapchain and the underlying `VkSurfaceKHR` / platform
    /// surface. Idempotent; every method above returns an error afterwards.
    ///
    /// **Call this before `window.destroy()` and `sdlQuit()`.** It is not
    /// optional bookkeeping — leaving it to the automatic drop at process exit
    /// is a segfault on Linux/X11, reliably. A surface's teardown talks to the
    /// window system: Mesa's Vulkan drivers destroy per-swapchain-image X11
    /// present fences via `xcb_sync_destroy_fence`, on the xcb connection SDL
    /// owns. `SDL_DestroyWindow`/`SDL_Quit` close that connection and free it,
    /// so a surface dropped afterwards makes xcb calls through a dangling
    /// connection pointer and crashes inside libxcb — far from the real cause,
    /// with the addon nowhere near the top of the backtrace.
    ///
    /// The old `create_surface` doc ("the window must remain alive for the
    /// entire lifetime of the surface") stated this invariant but gave callers
    /// no way to *end* the surface's lifetime early, so it was unsatisfiable at
    /// shutdown. This is that way.
    #[napi]
    pub fn destroy(&self) {
        // Dropping the Surface destroys the swapchain and the platform surface.
        drop(self.inner.lock().unwrap().take());
    }

    fn alive<'a>(
        guard: &'a std::sync::MutexGuard<'_, Option<wgpu::Surface<'static>>>,
    ) -> napi::Result<&'a wgpu::Surface<'static>> {
        guard.as_ref().ok_or_else(|| {
            napi::Error::new(
                napi::Status::GenericFailure,
                "Surface has been destroyed",
            )
        })
    }
}

// ── GpuSurfaceTexture ─────────────────────────────────────────────────────────

#[napi]
pub struct GpuSurfaceTexture {
    inner: Mutex<Option<wgpu::SurfaceTexture>>,
}

// SurfaceTexture is Send on native wgpu backends; we need the unsafe impl
// because the Box<dyn Any> detail field lacks an explicit Send bound in wgpu's
// public API even though all native impls are Send.
unsafe impl Send for GpuSurfaceTexture {}
unsafe impl Sync for GpuSurfaceTexture {}

#[napi]
impl GpuSurfaceTexture {
    /// Create a view into the surface texture for use as a render attachment.
    #[napi]
    pub fn create_view(&self) -> napi::Result<GpuTextureView> {
        let guard = self.inner.lock().unwrap();
        let frame = guard.as_ref().ok_or_else(|| {
            napi::Error::new(napi::Status::GenericFailure, "Surface texture already presented")
        })?;
        let view = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        Ok(GpuTextureView {
            inner: Arc::new(view),
        })
    }

    /// Present the frame to the window. Must be called after queue.submit().
    #[napi]
    pub fn present(&self) -> napi::Result<()> {
        let frame = self.inner.lock().unwrap().take().ok_or_else(|| {
            napi::Error::new(napi::Status::GenericFailure, "Surface texture already presented")
        })?;
        frame.present();
        Ok(())
    }

    /// `true` when the swapchain is still functional but reconfiguring it would
    /// improve performance (e.g. after a resize).
    #[napi(getter)]
    pub fn suboptimal(&self) -> bool {
        self.inner
            .lock()
            .unwrap()
            .as_ref()
            .map(|f| f.suboptimal)
            .unwrap_or(false)
    }
}

// ── Factory function ──────────────────────────────────────────────────────────

/// Create a wgpu rendering surface backed by an SDL3 window.
///
/// The `SdlWindow` must remain alive (and unclosed) for the entire lifetime of
/// the returned `GpuSurface` — so at shutdown call `surface.destroy()` *before*
/// `window.destroy()` / `sdlQuit()`. Skipping it segfaults on Linux/X11; see
/// `GpuSurface::destroy`.
#[napi]
pub fn create_surface(adapter: &GpuAdapter, window: &SdlWindow) -> napi::Result<GpuSurface> {
    let (raw_window_handle, raw_display_handle) = get_raw_handles(window.raw_ptr())?;
    let surface = unsafe {
        adapter
            .instance
            .create_surface_unsafe(wgpu::SurfaceTargetUnsafe::RawHandle {
                raw_window_handle,
                raw_display_handle,
            })
    }
        .map_err(|e| napi::Error::new(napi::Status::GenericFailure, e.to_string()))?;
    Ok(GpuSurface {
        inner: Mutex::new(Some(surface)),
        adapter: Arc::clone(&adapter.inner),
    })
}
