use napi_derive::napi;
use sdl3_sys::keyboard::{
    SDL_GetKeyboardState, SDL_GetModState, SDL_SetModState,
    SDL_GetKeyFromScancode, SDL_GetScancodeFromKey,
    SDL_GetKeyName, SDL_GetKeyFromName,
    SDL_GetScancodeName, SDL_GetScancodeFromName,
    SDL_StartTextInput, SDL_StopTextInput, SDL_TextInputActive,
    SDL_ResetKeyboard,
};
use sdl3_sys::scancode::SDL_Scancode;
use sdl3_sys::keycode::{SDL_Keycode, SDL_Keymod};
use crate::sdl::window::SdlWindow;
use std::ffi::{CStr, CString};
use num_enum::TryFromPrimitive;

// ── Keycode enum ──────────────────────────────────────────────────────────────

/// Virtual key identifiers (layout-dependent, Unicode codepoints for printable
/// keys; extended keys have the scancode-mask bit 0x40000000 set).
/// Letters use their **lowercase** codepoint: `SdlKeycode::A = 97` ('a').
/// Compare against `SdlEvent.keycode`.
#[derive(Debug, TryFromPrimitive)]
#[repr(u32)]
#[napi]
pub enum SdlKeycode {
    Unknown = 0,
    Backspace = 8,
    Tab = 9,
    Return = 13,
    Escape = 27,
    Space = 32,
    Exclaim = 33,
    DblApostrophe = 34,
    Hash = 35,
    Dollar = 36,
    Percent = 37,
    Ampersand = 38,
    Apostrophe = 39,
    LeftParen = 40,
    RightParen = 41,
    Asterisk = 42,
    Plus = 43,
    Comma = 44,
    Minus = 45,
    Period = 46,
    Slash = 47,
    Num0 = 48,
    Num1 = 49,
    Num2 = 50,
    Num3 = 51,
    Num4 = 52,
    Num5 = 53,
    Num6 = 54,
    Num7 = 55,
    Num8 = 56,
    Num9 = 57,
    Colon = 58,
    Semicolon = 59,
    Less = 60,
    Equals = 61,
    Greater = 62,
    Question = 63,
    At = 64,
    LeftBracket = 91,
    Backslash = 92,
    RightBracket = 93,
    Caret = 94,
    Underscore = 95,
    Grave = 96,
    A = 97,
    B = 98,
    C = 99,
    D = 100,
    E = 101,
    F = 102,
    G = 103,
    H = 104,
    I = 105,
    J = 106,
    K = 107,
    L = 108,
    M = 109,
    N = 110,
    O = 111,
    P = 112,
    Q = 113,
    R = 114,
    S = 115,
    T = 116,
    U = 117,
    V = 118,
    W = 119,
    X = 120,
    Y = 121,
    Z = 122,
    Delete = 127,
    Capslock = 1073741881,
    F1 = 1073741882,
    F2 = 1073741883,
    F3 = 1073741884,
    F4 = 1073741885,
    F5 = 1073741886,
    F6 = 1073741887,
    F7 = 1073741888,
    F8 = 1073741889,
    F9 = 1073741890,
    F10 = 1073741891,
    F11 = 1073741892,
    F12 = 1073741893,
    PrintScreen = 1073741894,
    ScrollLock = 1073741895,
    Pause = 1073741896,
    Insert = 1073741897,
    Home = 1073741898,
    PageUp = 1073741899,
    End = 1073741901,
    PageDown = 1073741902,
    Right = 1073741903,
    Left = 1073741904,
    Down = 1073741905,
    Up = 1073741906,
    NumLockClear = 1073741907,
    KpDivide = 1073741908,
    KpMultiply = 1073741909,
    KpMinus = 1073741910,
    KpPlus = 1073741911,
    KpEnter = 1073741912,
    Kp1 = 1073741913,
    Kp2 = 1073741914,
    Kp3 = 1073741915,
    Kp4 = 1073741916,
    Kp5 = 1073741917,
    Kp6 = 1073741918,
    Kp7 = 1073741919,
    Kp8 = 1073741920,
    Kp9 = 1073741921,
    Kp0 = 1073741922,
    KpPeriod = 1073741923,
    NonUsBackslash = 1073741924,
    Application = 1073741925,
    LCtrl = 1073742048,
    LShift = 1073742049,
    LAlt = 1073742050,
    LGui = 1073742051,
    RCtrl = 1073742052,
    RShift = 1073742053,
    RAlt = 1073742054,
    RGui = 1073742055,
}

// ── Scancode enum ─────────────────────────────────────────────────────────────

/// Physical key identifiers (USB HID position, layout-independent).
/// Use with `SdlKeyboardState.get()` and compare against `SdlEvent.scancode`.
#[derive(Debug, TryFromPrimitive)]
#[repr(i32)]
#[napi]
pub enum SdlScancode {
    Unknown = 0,
    A = 4,
    B = 5,
    C = 6,
    D = 7,
    E = 8,
    F = 9,
    G = 10,
    H = 11,
    I = 12,
    J = 13,
    K = 14,
    L = 15,
    M = 16,
    N = 17,
    O = 18,
    P = 19,
    Q = 20,
    R = 21,
    S = 22,
    T = 23,
    U = 24,
    V = 25,
    W = 26,
    X = 27,
    Y = 28,
    Z = 29,
    Num1 = 30,
    Num2 = 31,
    Num3 = 32,
    Num4 = 33,
    Num5 = 34,
    Num6 = 35,
    Num7 = 36,
    Num8 = 37,
    Num9 = 38,
    Num0 = 39,
    Return = 40,
    Escape = 41,
    Backspace = 42,
    Tab = 43,
    Space = 44,
    Minus = 45,
    Equals = 46,
    LeftBracket = 47,
    RightBracket = 48,
    Backslash = 49,
    NonUsHash = 50,
    Semicolon = 51,
    Apostrophe = 52,
    Grave = 53,
    Comma = 54,
    Period = 55,
    Slash = 56,
    Capslock = 57,
    F1 = 58,
    F2 = 59,
    F3 = 60,
    F4 = 61,
    F5 = 62,
    F6 = 63,
    F7 = 64,
    F8 = 65,
    F9 = 66,
    F10 = 67,
    F11 = 68,
    F12 = 69,
    PrintScreen = 70,
    ScrollLock = 71,
    Pause = 72,
    Insert = 73,
    Home = 74,
    PageUp = 75,
    Delete = 76,
    End = 77,
    PageDown = 78,
    Right = 79,
    Left = 80,
    Down = 81,
    Up = 82,
    NumLockClear = 83,
    KpDivide = 84,
    KpMultiply = 85,
    KpMinus = 86,
    KpPlus = 87,
    KpEnter = 88,
    Kp1 = 89,
    Kp2 = 90,
    Kp3 = 91,
    Kp4 = 92,
    Kp5 = 93,
    Kp6 = 94,
    Kp7 = 95,
    Kp8 = 96,
    Kp9 = 97,
    Kp0 = 98,
    KpPeriod = 99,
    NonUsBackslash = 100,
    Application = 101,
    LCtrl = 224,
    LShift = 225,
    LAlt = 226,
    LGui = 227,
    RCtrl = 228,
    RShift = 229,
    RAlt = 230,
    RGui = 231,
    Count = 512,
}

// ── Keymod enum ───────────────────────────────────────────────────────────────

/// Keyboard modifier bit-flags. OR together to check multiple modifiers.
/// Use with `sdlGetModState()` and `SdlEvent.keyMod`.
#[napi]
pub enum SdlKeymod {
    None = 0,
    LShift = 1,
    RShift = 2,
    Level5 = 4,
    LCtrl = 64,
    RCtrl = 128,
    LAlt = 256,
    RAlt = 512,
    LGui = 1024,
    RGui = 2048,
    Num = 4096,
    Caps = 8192,
    Mode = 16384,
    Scroll = 32768,
    /// Either shift key.
    Shift = 3,
    /// Either ctrl key.
    Ctrl = 192,
    /// Either alt key.
    Alt = 768,
    /// Either GUI (Win/Cmd) key.
    Gui = 3072,
}

// ── Keyboard state ────────────────────────────────────────────────────────────

// Wraps the raw pointer without taking ownership.
// SAFETY: the array is owned by SDL and lives until SDL_Quit().
//         All access is synchronous on the main JS thread.
struct RawKbState {
    ptr: *const bool,
    len: usize,
}
unsafe impl Send for RawKbState {}
unsafe impl Sync for RawKbState {}

/// A handle to SDL's live keyboard state array.
///
/// Call `sdlGetKeyboardState()` **once** at startup — SDL keeps the underlying
/// memory continuously updated as you call `sdlPollEvents()` or
/// `sdlPumpEvents()`, so you never need to re-obtain it.
///
/// ```ts
/// const KB = sdlGetKeyboardState()
/// // inside the game loop — no extra allocation:
/// if (KB.get(SdlScancode.W)) { /* W held */ }
/// ```
#[napi]
pub struct SdlKeyboardState(RawKbState);

#[napi]
impl SdlKeyboardState {
    /// Returns `true` if the key identified by `scancode` is currently pressed.
    /// A real `SdlScancode` past the tracked array (e.g. `SdlScancode.Count`)
    /// returns `false`; a number that isn't a `SdlScancode` variant is rejected
    /// at the napi boundary.
    #[napi]
    pub fn get(&self, scancode: SdlScancode) -> bool {
        let i = scancode as usize;
        if i >= self.0.len { return false; }
        unsafe { *self.0.ptr.add(i) }
    }

    /// Total number of scancodes tracked (SdlScancode.Count, typically 512).
    #[napi(getter)]
    pub fn len(&self) -> u32 { self.0.len as u32 }
}

/// Returns a handle to SDL's internal keyboard-state array.
///
/// The array is updated automatically on every `sdlPollEvents()` /
/// `sdlPumpEvents()` call — call this function **once** and reuse the handle.
#[napi]
pub fn sdl_get_keyboard_state() -> napi::Result<SdlKeyboardState> {
    let mut num: std::ffi::c_int = 0;
    let ptr = unsafe { SDL_GetKeyboardState(&mut num) };
    if ptr.is_null() {
        return Err(napi::Error::new(napi::Status::GenericFailure, "SDL_GetKeyboardState returned null"));
    }
    Ok(SdlKeyboardState(RawKbState { ptr, len: num.max(0) as usize }))
}

/// Current keyboard modifier state (SDL_Keymod bit-mask).
/// Compare against `SdlKeymod` values: `if (sdlGetModState() & SdlKeymod.Shift) { ... }`.
#[napi]
pub fn sdl_get_mod_state() -> u32 {
    unsafe { SDL_GetModState().0 as u32 }
}

/// Override the modifier state programmatically (useful for simulated input).
#[napi]
pub fn sdl_set_mod_state(modstate: u32) {
    unsafe { SDL_SetModState(SDL_Keymod(modstate as u16)) };
}

/// Reset the keyboard state to "all keys released".
#[napi]
pub fn sdl_reset_keyboard() {
    unsafe { SDL_ResetKeyboard() };
}

// ── Key / scancode lookups ────────────────────────────────────────────────────

/// Human-readable name for a keycode (e.g. "A", "Return", "Escape").
#[napi]
pub fn sdl_get_key_name(keycode: SdlKeycode) -> String {
    let p = unsafe { SDL_GetKeyName(SDL_Keycode(keycode as u32)) };
    if p.is_null() { return String::new(); }
    unsafe { CStr::from_ptr(p).to_string_lossy().into_owned() }
}

/// Human-readable name for a scancode (e.g. "A", "Left", "F1").
#[napi]
pub fn sdl_get_scancode_name(scancode: SdlScancode) -> String {
    let p = unsafe { SDL_GetScancodeName(SDL_Scancode(scancode as i32)) };
    if p.is_null() { return String::new(); }
    unsafe { CStr::from_ptr(p).to_string_lossy().into_owned() }
}

/// Keycode from name string (inverse of `sdlGetKeyName`). Returns `Unknown` on failure.
#[napi]
pub fn sdl_get_key_from_name(name: String) -> napi::Result<SdlKeycode> {
    let c = CString::new(name).map_err(|e| napi::Error::new(napi::Status::GenericFailure, e.to_string()))?;
    let raw = unsafe { SDL_GetKeyFromName(c.as_ptr()).0 };
    Ok(SdlKeycode::try_from(raw).unwrap_or(SdlKeycode::Unknown))
}

/// Scancode from name string. Returns `Unknown` on failure.
#[napi]
pub fn sdl_get_scancode_from_name(name: String) -> napi::Result<SdlScancode> {
    let c = CString::new(name).map_err(|e| napi::Error::new(napi::Status::GenericFailure, e.to_string()))?;
    let raw = unsafe { SDL_GetScancodeFromName(c.as_ptr()).0 };
    Ok(SdlScancode::try_from(raw).unwrap_or(SdlScancode::Unknown))
}

/// Convert a scancode to the corresponding keycode (layout-dependent).
/// Returns `Unknown` if the result is not a recognised keycode variant.
#[napi]
pub fn sdl_get_key_from_scancode(scancode: SdlScancode, mod_state: Option<u32>, key_event: Option<bool>) -> SdlKeycode {
    let m = SDL_Keymod(mod_state.unwrap_or(0) as u16);
    let raw = unsafe { SDL_GetKeyFromScancode(SDL_Scancode(scancode as i32), m, key_event.unwrap_or(false)) }.0;
    SdlKeycode::try_from(raw).unwrap_or(SdlKeycode::Unknown)
}

/// Convert a keycode back to the scancode that would produce it.
/// Returns `Unknown` if the result is not a recognised scancode variant.
#[napi]
pub fn sdl_get_scancode_from_key(keycode: SdlKeycode) -> SdlScancode {
    let mut _m = SDL_Keymod(0);
    let raw = unsafe { SDL_GetScancodeFromKey(SDL_Keycode(keycode as u32), &mut _m) }.0;
    SdlScancode::try_from(raw).unwrap_or(SdlScancode::Unknown)
}

// ── Text input mode ───────────────────────────────────────────────────────────

/// Enable text-input mode for `window`. SDL will send `TEXT_INPUT` events
/// with composed UTF-8 text (IME-aware).
#[napi]
pub fn sdl_start_text_input(window: &SdlWindow) -> napi::Result<()> {
    if unsafe { SDL_StartTextInput(window.raw_ptr()) } { Ok(()) } else {
        let msg = unsafe { CStr::from_ptr(sdl3_sys::error::SDL_GetError()).to_string_lossy().into_owned() };
        Err(napi::Error::new(napi::Status::GenericFailure, msg))
    }
}

/// Disable text-input mode.
#[napi]
pub fn sdl_stop_text_input(window: &SdlWindow) -> napi::Result<()> {
    if unsafe { SDL_StopTextInput(window.raw_ptr()) } { Ok(()) } else {
        let msg = unsafe { CStr::from_ptr(sdl3_sys::error::SDL_GetError()).to_string_lossy().into_owned() };
        Err(napi::Error::new(napi::Status::GenericFailure, msg))
    }
}

/// Returns `true` if text-input mode is currently active for `window`.
#[napi]
pub fn sdl_text_input_active(window: &SdlWindow) -> bool {
    unsafe { SDL_TextInputActive(window.raw_ptr()) }
}
