use napi_derive::napi;
use sdl3_sys::error::SDL_GetError;
use sdl3_sys::rect::SDL_Rect;
use sdl3_sys::video::{
    SDL_CreateWindow, SDL_DestroyWindow, SDL_GetWindowID, SDL_GetWindowFlags,
    SDL_GetWindowPosition, SDL_SetWindowPosition,
    SDL_GetWindowSize, SDL_SetWindowSize, SDL_GetWindowSizeInPixels,
    SDL_SetWindowTitle, SDL_GetWindowTitle,
    SDL_SetWindowOpacity, SDL_GetWindowOpacity,
    SDL_ShowWindow, SDL_HideWindow, SDL_RaiseWindow,
    SDL_MaximizeWindow, SDL_MinimizeWindow, SDL_RestoreWindow,
    SDL_SetWindowFullscreen,
    SDL_SetWindowResizable, SDL_SetWindowBordered, SDL_SetWindowAlwaysOnTop,
    SDL_SetWindowFocusable,
    SDL_SyncWindow,
    SDL_SetWindowKeyboardGrab, SDL_GetWindowKeyboardGrab,
    SDL_SetWindowMouseGrab, SDL_GetWindowMouseGrab,
    SDL_SetWindowMouseRect, SDL_GetWindowMouseRect,
    SDL_GetWindowDisplayScale,
    SDL_Window, SDL_WindowFlags,
};
use std::ffi::{CStr, CString};

fn sdl_err() -> napi::Error {
    let msg = unsafe { CStr::from_ptr(SDL_GetError()).to_string_lossy().into_owned() };
    napi::Error::new(napi::Status::GenericFailure, msg)
}

fn ok(b: bool) -> napi::Result<()> {
    if b { Ok(()) } else { Err(sdl_err()) }
}

// SAFETY: SDL_Window* is only accessed on the libuv main thread via synchronous napi calls.
struct RawWindow(*mut SDL_Window);
unsafe impl Send for RawWindow {}
unsafe impl Sync for RawWindow {}

#[napi]
pub struct SdlWindow {
    raw: RawWindow,
    cached_width: u32,
    cached_height: u32,
    cached_title: String,
}

#[napi]
impl SdlWindow {
    // ── Identity ──────────────────────────────────────────────────────────────

    #[napi(getter)]
    pub fn id(&self) -> u32 {
        unsafe { SDL_GetWindowID(self.raw.0).0 }
    }

    #[napi(getter)]
    pub fn flags(&self) -> u32 {
        unsafe { SDL_GetWindowFlags(self.raw.0).0 as u32 }
    }

    // ── Title ─────────────────────────────────────────────────────────────────

    #[napi(getter)]
    pub fn title(&self) -> String { self.cached_title.clone() }

    #[napi]
    pub fn set_title(&mut self, title: String) -> napi::Result<()> {
        let c = CString::new(title.as_str()).map_err(|e| napi::Error::new(napi::Status::GenericFailure, e.to_string()))?;
        ok(unsafe { SDL_SetWindowTitle(self.raw.0, c.as_ptr()) })?;
        self.cached_title = title;
        Ok(())
    }

    #[napi]
    pub fn get_title(&self) -> String {
        let p = unsafe { SDL_GetWindowTitle(self.raw.0) };
        if p.is_null() { return String::new(); }
        unsafe { CStr::from_ptr(p).to_string_lossy().into_owned() }
    }

    // ── Size ──────────────────────────────────────────────────────────────────

    #[napi(getter)]
    pub fn width(&self) -> u32 { self.cached_width }

    #[napi(getter)]
    pub fn height(&self) -> u32 { self.cached_height }

    #[napi]
    pub fn set_size(&mut self, width: u32, height: u32) -> napi::Result<()> {
        ok(unsafe { SDL_SetWindowSize(self.raw.0, width as i32, height as i32) })?;
        self.cached_width = width;
        self.cached_height = height;
        Ok(())
    }

    /// Returns `{width, height}` queried live from SDL (may differ from cached values
    /// when the OS has resized the window).
    #[napi]
    pub fn get_size(&self) -> napi::Result<WindowSize> {
        let (mut w, mut h) = (0i32, 0i32);
        ok(unsafe { SDL_GetWindowSize(self.raw.0, &mut w, &mut h) })?;
        Ok(WindowSize { width: w as u32, height: h as u32 })
    }

    /// Pixel size, which may differ from logical size on HiDPI displays.
    #[napi]
    pub fn get_size_in_pixels(&self) -> napi::Result<WindowSize> {
        let (mut w, mut h) = (0i32, 0i32);
        ok(unsafe { SDL_GetWindowSizeInPixels(self.raw.0, &mut w, &mut h) })?;
        Ok(WindowSize { width: w as u32, height: h as u32 })
    }

    // ── Position ──────────────────────────────────────────────────────────────

    #[napi]
    pub fn get_position(&self) -> napi::Result<WindowPosition> {
        let (mut x, mut y) = (0i32, 0i32);
        ok(unsafe { SDL_GetWindowPosition(self.raw.0, &mut x, &mut y) })?;
        Ok(WindowPosition { x, y })
    }

    #[napi]
    pub fn set_position(&self, x: i32, y: i32) -> napi::Result<()> {
        ok(unsafe { SDL_SetWindowPosition(self.raw.0, x, y) })
    }

    // ── Opacity ───────────────────────────────────────────────────────────────

    #[napi]
    pub fn get_opacity(&self) -> f64 {
        unsafe { SDL_GetWindowOpacity(self.raw.0) as f64 }
    }

    #[napi]
    pub fn set_opacity(&self, opacity: f64) -> napi::Result<()> {
        ok(unsafe { SDL_SetWindowOpacity(self.raw.0, opacity as f32) })
    }

    // ── Display scale ─────────────────────────────────────────────────────────

    #[napi]
    pub fn get_display_scale(&self) -> f64 {
        unsafe { SDL_GetWindowDisplayScale(self.raw.0) as f64 }
    }

    // ── State ─────────────────────────────────────────────────────────────────

    #[napi]
    pub fn show(&self) -> napi::Result<()> { ok(unsafe { SDL_ShowWindow(self.raw.0) }) }
    #[napi]
    pub fn hide(&self) -> napi::Result<()> { ok(unsafe { SDL_HideWindow(self.raw.0) }) }
    #[napi]
    pub fn raise(&self) -> napi::Result<()> { ok(unsafe { SDL_RaiseWindow(self.raw.0) }) }
    #[napi]
    pub fn maximize(&self) -> napi::Result<()> { ok(unsafe { SDL_MaximizeWindow(self.raw.0) }) }
    #[napi]
    pub fn minimize(&self) -> napi::Result<()> { ok(unsafe { SDL_MinimizeWindow(self.raw.0) }) }
    #[napi]
    pub fn restore(&self) -> napi::Result<()> { ok(unsafe { SDL_RestoreWindow(self.raw.0) }) }

    #[napi]
    pub fn set_fullscreen(&self, fullscreen: bool) -> napi::Result<()> {
        ok(unsafe { SDL_SetWindowFullscreen(self.raw.0, fullscreen) })
    }

    #[napi]
    pub fn set_resizable(&self, resizable: bool) -> napi::Result<()> {
        ok(unsafe { SDL_SetWindowResizable(self.raw.0, resizable) })
    }

    #[napi]
    pub fn set_bordered(&self, bordered: bool) -> napi::Result<()> {
        ok(unsafe { SDL_SetWindowBordered(self.raw.0, bordered) })
    }

    #[napi]
    pub fn set_always_on_top(&self, on_top: bool) -> napi::Result<()> {
        ok(unsafe { SDL_SetWindowAlwaysOnTop(self.raw.0, on_top) })
    }

    #[napi]
    pub fn set_focusable(&self, focusable: bool) -> napi::Result<()> {
        ok(unsafe { SDL_SetWindowFocusable(self.raw.0, focusable) })
    }

    /// Wait for the compositor to acknowledge any pending window-state changes.
    #[napi]
    pub fn sync(&self) -> napi::Result<()> { ok(unsafe { SDL_SyncWindow(self.raw.0) }) }

    // ── Input grab ────────────────────────────────────────────────────────────

    #[napi]
    pub fn set_keyboard_grab(&self, grabbed: bool) -> napi::Result<()> {
        ok(unsafe { SDL_SetWindowKeyboardGrab(self.raw.0, grabbed) })
    }

    #[napi]
    pub fn get_keyboard_grab(&self) -> bool {
        unsafe { SDL_GetWindowKeyboardGrab(self.raw.0) }
    }

    #[napi]
    pub fn set_mouse_grab(&self, grabbed: bool) -> napi::Result<()> {
        ok(unsafe { SDL_SetWindowMouseGrab(self.raw.0, grabbed) })
    }

    #[napi]
    pub fn get_mouse_grab(&self) -> bool {
        unsafe { SDL_GetWindowMouseGrab(self.raw.0) }
    }

    /// Confine the mouse to a rectangle within this window.
    /// Pass `null` to release the confinement.
    #[napi]
    pub fn set_mouse_rect(&self, rect: Option<MouseRect>) -> napi::Result<()> {
        match rect {
            None => ok(unsafe { SDL_SetWindowMouseRect(self.raw.0, std::ptr::null()) }),
            Some(r) => {
                let sdl_rect = SDL_Rect { x: r.x, y: r.y, w: r.w, h: r.h };
                ok(unsafe { SDL_SetWindowMouseRect(self.raw.0, &sdl_rect) })
            }
        }
    }

    #[napi]
    pub fn get_mouse_rect(&self) -> Option<MouseRect> {
        let r = unsafe { SDL_GetWindowMouseRect(self.raw.0) };
        if r.is_null() { return None; }
        let r = unsafe { &*r };
        Some(MouseRect { x: r.x, y: r.y, w: r.w, h: r.h })
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    #[napi]
    pub fn destroy(&self) {
        unsafe { SDL_DestroyWindow(self.raw.0) };
    }

    pub(crate) fn raw_ptr(&self) -> *mut SDL_Window { self.raw.0 }
}

// ── Auxiliary types ───────────────────────────────────────────────────────────

#[napi(object)]
pub struct WindowSize {
    pub width: u32,
    pub height: u32,
}

#[napi(object)]
pub struct WindowPosition {
    pub x: i32,
    pub y: i32,
}

#[napi(object)]
pub struct MouseRect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

// ── Factory function ──────────────────────────────────────────────────────────

#[napi]
pub fn sdl_create_window(title: String, width: u32, height: u32, flags: Option<u32>) -> napi::Result<SdlWindow> {
    let c = CString::new(title.as_str()).map_err(|e| napi::Error::new(napi::Status::GenericFailure, e.to_string()))?;
    let f = SDL_WindowFlags(flags.unwrap_or(0) as u64);
    let ptr = unsafe { SDL_CreateWindow(c.as_ptr(), width as i32, height as i32, f) };
    if ptr.is_null() { return Err(sdl_err()); }
    Ok(SdlWindow { raw: RawWindow(ptr), cached_width: width, cached_height: height, cached_title: title })
}

/// SDL window creation / state flags. OR together the flags you need and pass
/// to `sdlCreateWindow`, or check them against `window.flags`.
#[napi]
pub enum SdlWindowFlag {
    Fullscreen = 1,
    Occluded = 4,
    Hidden = 8,
    Borderless = 16,
    Resizable = 32,
    Minimized = 64,
    Maximized = 128,
    MouseGrabbed = 256,
    InputFocus = 512,
    MouseFocus = 1024,
    External = 2048,
    Modal = 4096,
    AlwaysOnTop = 65536,
    KeyboardGrabbed = 1048576,
    Transparent = 1073741824,
}
