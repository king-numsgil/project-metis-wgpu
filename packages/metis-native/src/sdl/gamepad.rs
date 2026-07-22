use napi_derive::napi;
use num_enum::TryFromPrimitive;
use sdl3_sys::gamepad::{
    SDL_Gamepad,
    SDL_HasGamepad, SDL_GetGamepads, SDL_IsGamepad,
    SDL_GetGamepadNameForID, SDL_GetGamepadTypeForID,
    SDL_OpenGamepad, SDL_CloseGamepad,
    SDL_GetGamepadName, SDL_GetGamepadType, SDL_GetGamepadID,
    SDL_GetGamepadPlayerIndex, SDL_SetGamepadPlayerIndex,
    SDL_GetGamepadAxis, SDL_GetGamepadButton,
    SDL_GamepadHasAxis, SDL_GamepadHasButton,
    SDL_RumbleGamepad, SDL_RumbleGamepadTriggers,
    SDL_SetGamepadLED, SDL_GamepadConnected,
    SDL_SetGamepadEventsEnabled, SDL_GamepadEventsEnabled,
    SDL_UpdateGamepads,
    SDL_GetGamepadAxisFromString, SDL_GetGamepadStringForAxis,
    SDL_GetGamepadButtonFromString, SDL_GetGamepadStringForButton,
    SDL_GamepadAxis, SDL_GamepadButton,
};
use sdl3_sys::joystick::SDL_JoystickID;
use std::ffi::{CStr, CString};

fn sdl_err() -> napi::Error {
    let msg = unsafe { CStr::from_ptr(sdl3_sys::error::SDL_GetError()).to_string_lossy().into_owned() };
    napi::Error::new(napi::Status::GenericFailure, msg)
}

// ── Gamepad axis enum ─────────────────────────────────────────────────────────

/// Sensor type reported in gamepad sensor and generic sensor events.
#[derive(TryFromPrimitive)]
#[repr(i32)]
#[napi]
pub enum SdlSensorType {
    Invalid = -1,
    Unknown = 0,
    Accel = 1,
    Gyro = 2,
    AccelL = 3,
    GyroL = 4,
    AccelR = 5,
    GyroR = 6,
}

/// Gamepad axis indices for `SdlGamepad.getAxis()`.
/// Sticks range -1..1; triggers (`LeftTrigger`, `RightTrigger`) range 0..1.
#[derive(TryFromPrimitive)]
#[repr(i32)]
#[napi]
pub enum SdlGamepadAxis {
    Invalid = -1,
    LeftX = 0,
    LeftY = 1,
    RightX = 2,
    RightY = 3,
    LeftTrigger = 4,
    RightTrigger = 5,
}

// ── Gamepad button enum ───────────────────────────────────────────────────────

/// Gamepad button indices for `SdlGamepad.getButton()`.
/// Face buttons use compass directions: `South` = A on Xbox, cross on PS.
#[derive(TryFromPrimitive)]
#[repr(i32)]
#[napi]
pub enum SdlGamepadButton {
    Invalid = -1,
    South = 0,
    East = 1,
    West = 2,
    North = 3,
    Back = 4,
    Guide = 5,
    Start = 6,
    LeftStick = 7,
    RightStick = 8,
    LeftShoulder = 9,
    RightShoulder = 10,
    DpadUp = 11,
    DpadDown = 12,
    DpadLeft = 13,
    DpadRight = 14,
    Misc1 = 15,
    Touchpad = 20,
}

// ── Discovery ─────────────────────────────────────────────────────────────────

/// Returns `true` if any gamepad is connected.
#[napi]
pub fn sdl_has_gamepad() -> bool {
    unsafe { SDL_HasGamepad() }
}

/// Instance IDs of all connected gamepads.
#[napi]
pub fn sdl_get_gamepads() -> Vec<u32> {
    let mut count = 0i32;
    let ptr = unsafe { SDL_GetGamepads(&mut count) };
    if ptr.is_null() || count <= 0 { return vec![]; }
    let slice = unsafe { std::slice::from_raw_parts(ptr, count as usize) };
    let out: Vec<u32> = slice.iter().map(|id| id.0).collect();
    unsafe { sdl3_sys::stdinc::SDL_free(ptr as *mut _) };
    out
}

/// Returns `true` if the given joystick instance is a recognised gamepad.
#[napi]
pub fn sdl_is_gamepad(instance_id: u32) -> bool {
    unsafe { SDL_IsGamepad(SDL_JoystickID(instance_id)) }
}

/// Human-readable name (without opening the device).
#[napi]
pub fn sdl_get_gamepad_name_for_id(instance_id: u32) -> String {
    let p = unsafe { SDL_GetGamepadNameForID(SDL_JoystickID(instance_id)) };
    if p.is_null() { return String::new(); }
    unsafe { CStr::from_ptr(p).to_string_lossy().into_owned() }
}

/// Gamepad type string (without opening). E.g. `"XBOX360"`, `"PS4"`, `"UNKNOWN"`.
#[napi]
pub fn sdl_get_gamepad_type_for_id(instance_id: u32) -> &'static str {
    let t = unsafe { SDL_GetGamepadTypeForID(SDL_JoystickID(instance_id)) };
    gamepad_type_name(t)
}

// ── SdlGamepad ────────────────────────────────────────────────────────────────

struct RawGamepad(*mut SDL_Gamepad);
unsafe impl Send for RawGamepad {}
unsafe impl Sync for RawGamepad {}

/// An open gamepad handle. Call `.close()` when done.
#[napi]
pub struct SdlGamepad {
    raw: RawGamepad,
}

#[napi]
impl SdlGamepad {
    // ── Identity ──────────────────────────────────────────────────────────────

    #[napi]
    pub fn instance_id(&self) -> u32 {
        unsafe { SDL_GetGamepadID(self.raw.0).0 }
    }

    #[napi]
    pub fn name(&self) -> String {
        let p = unsafe { SDL_GetGamepadName(self.raw.0) };
        if p.is_null() { return String::new(); }
        unsafe { CStr::from_ptr(p).to_string_lossy().into_owned() }
    }

    #[napi]
    pub fn gamepad_type(&self) -> &'static str {
        gamepad_type_name(unsafe { SDL_GetGamepadType(self.raw.0) })
    }

    #[napi]
    pub fn is_connected(&self) -> bool {
        unsafe { SDL_GamepadConnected(self.raw.0) }
    }

    // ── Player index ──────────────────────────────────────────────────────────

    #[napi]
    pub fn get_player_index(&self) -> i32 {
        unsafe { SDL_GetGamepadPlayerIndex(self.raw.0) }
    }

    #[napi]
    pub fn set_player_index(&self, index: i32) -> napi::Result<()> {
        if unsafe { SDL_SetGamepadPlayerIndex(self.raw.0, index) } { Ok(()) } else { Err(sdl_err()) }
    }

    // ── Axes ──────────────────────────────────────────────────────────────────

    /// Axis value normalised to -1.0 .. 1.0 (triggers: 0.0 .. 1.0).
    #[napi]
    pub fn get_axis(&self, axis: SdlGamepadAxis) -> f64 {
        let raw = unsafe { SDL_GetGamepadAxis(self.raw.0, SDL_GamepadAxis(axis as i32)) };
        raw as f64 / 32767.0
    }

    #[napi]
    pub fn has_axis(&self, axis: SdlGamepadAxis) -> bool {
        unsafe { SDL_GamepadHasAxis(self.raw.0, SDL_GamepadAxis(axis as i32)) }
    }

    // ── Buttons ───────────────────────────────────────────────────────────────

    #[napi]
    pub fn get_button(&self, button: SdlGamepadButton) -> bool {
        unsafe { SDL_GetGamepadButton(self.raw.0, SDL_GamepadButton(button as i32)) }
    }

    #[napi]
    pub fn has_button(&self, button: SdlGamepadButton) -> bool {
        unsafe { SDL_GamepadHasButton(self.raw.0, SDL_GamepadButton(button as i32)) }
    }

    // ── Haptics ───────────────────────────────────────────────────────────────

    /// Rumble the gamepad. Values 0–65535, duration in milliseconds.
    #[napi]
    pub fn rumble(&self, low_freq: u32, high_freq: u32, duration_ms: u32) -> bool {
        unsafe { SDL_RumbleGamepad(self.raw.0, low_freq as u16, high_freq as u16, duration_ms) }
    }

    /// Rumble the trigger motors.
    #[napi]
    pub fn rumble_triggers(&self, left: u32, right: u32, duration_ms: u32) -> bool {
        unsafe { SDL_RumbleGamepadTriggers(self.raw.0, left as u16, right as u16, duration_ms) }
    }

    /// Set the LED colour (if supported). Components 0–255.
    #[napi]
    pub fn set_led(&self, r: u32, g: u32, b: u32) -> bool {
        unsafe { SDL_SetGamepadLED(self.raw.0, r as u8, g as u8, b as u8) }
    }

    // ── Axis / button name helpers ─────────────────────────────────────────────

    /// Axis name → numeric constant. E.g. `"leftx"` → `SdlGamepadAxis.LeftX`.
    #[napi]
    pub fn axis_from_string(&self, s: String) -> napi::Result<i32> {
        let c = CString::new(s).map_err(|e| napi::Error::new(napi::Status::GenericFailure, e.to_string()))?;
        Ok(unsafe { SDL_GetGamepadAxisFromString(c.as_ptr()) }.0)
    }

    /// Button name → numeric constant. E.g. `"a"` → `SdlGamepadButton.South`.
    #[napi]
    pub fn button_from_string(&self, s: String) -> napi::Result<i32> {
        let c = CString::new(s).map_err(|e| napi::Error::new(napi::Status::GenericFailure, e.to_string()))?;
        Ok(unsafe { SDL_GetGamepadButtonFromString(c.as_ptr()) }.0)
    }

    /// Numeric axis constant → canonical name string.
    #[napi]
    pub fn axis_to_string(&self, axis: SdlGamepadAxis) -> String {
        let p = unsafe { SDL_GetGamepadStringForAxis(SDL_GamepadAxis(axis as i32)) };
        if p.is_null() { return String::new(); }
        unsafe { CStr::from_ptr(p).to_string_lossy().into_owned() }
    }

    /// Numeric button constant → canonical name string.
    #[napi]
    pub fn button_to_string(&self, button: SdlGamepadButton) -> String {
        let p = unsafe { SDL_GetGamepadStringForButton(SDL_GamepadButton(button as i32)) };
        if p.is_null() { return String::new(); }
        unsafe { CStr::from_ptr(p).to_string_lossy().into_owned() }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    #[napi]
    pub fn close(&self) {
        unsafe { SDL_CloseGamepad(self.raw.0) };
    }
}

/// Open a gamepad by joystick instance ID.
#[napi]
pub fn sdl_open_gamepad(instance_id: u32) -> napi::Result<SdlGamepad> {
    let ptr = unsafe { SDL_OpenGamepad(SDL_JoystickID(instance_id)) };
    if ptr.is_null() { return Err(sdl_err()); }
    Ok(SdlGamepad { raw: RawGamepad(ptr) })
}

// ── Global controls ───────────────────────────────────────────────────────────

#[napi]
pub fn sdl_set_gamepad_events_enabled(enabled: bool) {
    unsafe { SDL_SetGamepadEventsEnabled(enabled) };
}

#[napi]
pub fn sdl_gamepad_events_enabled() -> bool {
    unsafe { SDL_GamepadEventsEnabled() }
}

#[napi]
pub fn sdl_update_gamepads() {
    unsafe { SDL_UpdateGamepads() };
}

// ── Helper ────────────────────────────────────────────────────────────────────

fn gamepad_type_name(t: sdl3_sys::gamepad::SDL_GamepadType) -> &'static str {
    use sdl3_sys::gamepad::*;
    match t {
        SDL_GAMEPAD_TYPE_XBOX360 => "XBOX360",
        SDL_GAMEPAD_TYPE_XBOXONE => "XBOXONE",
        SDL_GAMEPAD_TYPE_PS3 => "PS3",
        SDL_GAMEPAD_TYPE_PS4 => "PS4",
        SDL_GAMEPAD_TYPE_PS5 => "PS5",
        SDL_GAMEPAD_TYPE_NINTENDO_SWITCH_PRO => "SWITCH_PRO",
        SDL_GAMEPAD_TYPE_NINTENDO_SWITCH_JOYCON_LEFT => "JOYCON_LEFT",
        SDL_GAMEPAD_TYPE_NINTENDO_SWITCH_JOYCON_RIGHT => "JOYCON_RIGHT",
        SDL_GAMEPAD_TYPE_NINTENDO_SWITCH_JOYCON_PAIR => "JOYCON_PAIR",
        _ => "UNKNOWN",
    }
}
