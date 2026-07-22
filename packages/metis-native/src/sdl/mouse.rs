use napi_derive::napi;
use num_enum::TryFromPrimitive;
use sdl3_sys::mouse::{
    SDL_Cursor, SDL_SystemCursor,
    SDL_CreateSystemCursor, SDL_DestroyCursor,
    SDL_SetCursor, SDL_GetCursor, SDL_GetDefaultCursor,
    SDL_ShowCursor, SDL_HideCursor, SDL_CursorVisible,
    SDL_GetMouseState, SDL_GetRelativeMouseState, SDL_GetGlobalMouseState,
    SDL_WarpMouseInWindow, SDL_WarpMouseGlobal,
    SDL_SetWindowRelativeMouseMode, SDL_GetWindowRelativeMouseMode,
    SDL_CaptureMouse,
};
use crate::sdl::window::SdlWindow;
use std::ffi::CStr;

// ── System cursor enum ────────────────────────────────────────────────────────

/// System cursor shapes for `sdlCreateSystemCursor()`.
#[napi]
pub enum SdlSystemCursor {
    Default = 0,
    Text = 1,
    Wait = 2,
    Crosshair = 3,
    Progress = 4,
    NwseResize = 5,
    NeswResize = 6,
    EwResize = 7,
    NsResize = 8,
    Move = 9,
    NotAllowed = 10,
    Pointer = 11,
    NwResize = 12,
    NResize = 13,
    NeResize = 14,
    EResize = 15,
    SeResize = 16,
    SResize = 17,
    SwResize = 18,
    WResize = 19,
}

// ── Mouse button enums ────────────────────────────────────────────────────────

/// Mouse button indices (used in `MOUSE_BUTTON_DOWN/UP` event `.mouseButton` field).
#[derive(TryFromPrimitive)]
#[repr(i32)]
#[napi]
pub enum SdlMouseButton {
    Left = 1,
    Middle = 2,
    Right = 3,
    X1 = 4,
    X2 = 5,
}

/// Mouse button bitmasks for `sdlGetMouseState().buttons`.
#[napi]
pub enum SdlMouseButtonMask {
    LMask = 1,
    MMask = 2,
    RMask = 4,
    X1Mask = 8,
    X2Mask = 16,
}

// ── Cursor object ─────────────────────────────────────────────────────────────

struct RawCursor(*mut SDL_Cursor);
unsafe impl Send for RawCursor {}
unsafe impl Sync for RawCursor {}

/// A system-defined or custom mouse cursor. Destroy with `.destroy()`.
#[napi]
pub struct SdlCursor {
    raw: RawCursor,
    owned: bool, // false for cursors fetched from SDL (default / current)
}

#[napi]
impl SdlCursor {
    /// Release the cursor. Do not call on a cursor obtained from
    /// `sdlGetCursor()` or `sdlGetDefaultCursor()`.
    #[napi]
    pub fn destroy(&self) {
        if self.owned {
            unsafe { SDL_DestroyCursor(self.raw.0) };
        }
    }
}

// ── Cursor creation & selection ───────────────────────────────────────────────

/// Create a system cursor from a `SdlSystemCursor` shape enum value.
#[napi]
pub fn sdl_create_system_cursor(shape: SdlSystemCursor) -> napi::Result<SdlCursor> {
    let ptr = unsafe { SDL_CreateSystemCursor(SDL_SystemCursor(shape as i32)) };
    if ptr.is_null() {
        let msg = unsafe { CStr::from_ptr(sdl3_sys::error::SDL_GetError()).to_string_lossy().into_owned() };
        return Err(napi::Error::new(napi::Status::GenericFailure, msg));
    }
    Ok(SdlCursor { raw: RawCursor(ptr), owned: true })
}

/// Make `cursor` the active cursor. Pass the cursor returned by
/// `sdlCreateSystemCursor()`.
#[napi]
pub fn sdl_set_cursor(cursor: &SdlCursor) -> napi::Result<()> {
    if unsafe { SDL_SetCursor(cursor.raw.0) } { Ok(()) } else {
        let msg = unsafe { CStr::from_ptr(sdl3_sys::error::SDL_GetError()).to_string_lossy().into_owned() };
        Err(napi::Error::new(napi::Status::GenericFailure, msg))
    }
}

/// Get the currently active cursor (not owned — do not call `.destroy()` on it).
#[napi]
pub fn sdl_get_cursor() -> Option<SdlCursor> {
    let p = unsafe { SDL_GetCursor() };
    if p.is_null() { return None; }
    Some(SdlCursor { raw: RawCursor(p), owned: false })
}

/// Get the default system cursor.
#[napi]
pub fn sdl_get_default_cursor() -> Option<SdlCursor> {
    let p = unsafe { SDL_GetDefaultCursor() };
    if p.is_null() { return None; }
    Some(SdlCursor { raw: RawCursor(p), owned: false })
}

/// Show the mouse cursor.
#[napi]
pub fn sdl_show_cursor() -> napi::Result<()> {
    if unsafe { SDL_ShowCursor() } { Ok(()) } else {
        let msg = unsafe { CStr::from_ptr(sdl3_sys::error::SDL_GetError()).to_string_lossy().into_owned() };
        Err(napi::Error::new(napi::Status::GenericFailure, msg))
    }
}

/// Hide the mouse cursor.
#[napi]
pub fn sdl_hide_cursor() -> napi::Result<()> {
    if unsafe { SDL_HideCursor() } { Ok(()) } else {
        let msg = unsafe { CStr::from_ptr(sdl3_sys::error::SDL_GetError()).to_string_lossy().into_owned() };
        Err(napi::Error::new(napi::Status::GenericFailure, msg))
    }
}

/// Returns `true` if the cursor is currently visible.
#[napi]
pub fn sdl_cursor_visible() -> bool {
    unsafe { SDL_CursorVisible() }
}

// ── Mouse state ───────────────────────────────────────────────────────────────

#[napi(object)]
pub struct MouseState {
    /// Cursor X relative to the focused window.
    pub x: f64,
    /// Cursor Y relative to the focused window.
    pub y: f64,
    /// SDL_MouseButtonFlags bitmask — compare against `SdlMouseButtonMask` values.
    pub buttons: u32,
}

/// Current mouse position relative to the focused window, plus button mask.
/// State is updated when events are polled.
#[napi]
pub fn sdl_get_mouse_state() -> MouseState {
    let (mut x, mut y) = (0.0f32, 0.0f32);
    let buttons = unsafe { SDL_GetMouseState(&mut x, &mut y) };
    MouseState { x: x as f64, y: y as f64, buttons: buttons.0 }
}

/// Relative mouse motion since the last call. Does not move the cursor.
#[napi]
pub fn sdl_get_relative_mouse_state() -> MouseState {
    let (mut x, mut y) = (0.0f32, 0.0f32);
    let buttons = unsafe { SDL_GetRelativeMouseState(&mut x, &mut y) };
    MouseState { x: x as f64, y: y as f64, buttons: buttons.0 }
}

/// Global desktop cursor position.
#[napi]
pub fn sdl_get_global_mouse_state() -> MouseState {
    let (mut x, mut y) = (0.0f32, 0.0f32);
    let buttons = unsafe { SDL_GetGlobalMouseState(&mut x, &mut y) };
    MouseState { x: x as f64, y: y as f64, buttons: buttons.0 }
}

// ── Mouse motion ──────────────────────────────────────────────────────────────

/// Move the cursor to `(x, y)` within `window`.
#[napi]
pub fn sdl_warp_mouse_in_window(window: &SdlWindow, x: f64, y: f64) {
    unsafe { SDL_WarpMouseInWindow(window.raw_ptr(), x as f32, y as f32) };
}

/// Move the cursor to global desktop coordinates.
#[napi]
pub fn sdl_warp_mouse_global(x: f64, y: f64) -> napi::Result<()> {
    if unsafe { SDL_WarpMouseGlobal(x as f32, y as f32) } { Ok(()) } else {
        let msg = unsafe { CStr::from_ptr(sdl3_sys::error::SDL_GetError()).to_string_lossy().into_owned() };
        Err(napi::Error::new(napi::Status::GenericFailure, msg))
    }
}

/// Enable or disable relative mouse mode for `window`.
/// In relative mode the cursor is hidden and only delta motion is reported.
#[napi]
pub fn sdl_set_relative_mouse_mode(window: &SdlWindow, enabled: bool) -> napi::Result<()> {
    if unsafe { SDL_SetWindowRelativeMouseMode(window.raw_ptr(), enabled) } { Ok(()) } else {
        let msg = unsafe { CStr::from_ptr(sdl3_sys::error::SDL_GetError()).to_string_lossy().into_owned() };
        Err(napi::Error::new(napi::Status::GenericFailure, msg))
    }
}

/// Returns `true` if relative mouse mode is enabled for `window`.
#[napi]
pub fn sdl_get_relative_mouse_mode(window: &SdlWindow) -> bool {
    unsafe { SDL_GetWindowRelativeMouseMode(window.raw_ptr()) }
}

/// Enable mouse capture so the window receives mouse events even when the
/// cursor leaves it. Pass `false` to release.
#[napi]
pub fn sdl_capture_mouse(enabled: bool) -> napi::Result<()> {
    if unsafe { SDL_CaptureMouse(enabled) } { Ok(()) } else {
        let msg = unsafe { CStr::from_ptr(sdl3_sys::error::SDL_GetError()).to_string_lossy().into_owned() };
        Err(napi::Error::new(napi::Status::GenericFailure, msg))
    }
}
