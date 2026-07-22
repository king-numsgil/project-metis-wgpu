use napi_derive::napi;
use num_enum::TryFromPrimitive;
use sdl3_sys::joystick::{
    SDL_Joystick, SDL_JoystickID,
    SDL_HasJoystick, SDL_GetJoysticks,
    SDL_GetJoystickNameForID, SDL_GetJoystickTypeForID,
    SDL_OpenJoystick, SDL_CloseJoystick,
    SDL_GetJoystickName, SDL_GetJoystickType, SDL_GetJoystickID,
    SDL_GetNumJoystickAxes, SDL_GetNumJoystickBalls,
    SDL_GetNumJoystickHats, SDL_GetNumJoystickButtons,
    SDL_GetJoystickAxis, SDL_GetJoystickBall,
    SDL_GetJoystickHat, SDL_GetJoystickButton,
    SDL_RumbleJoystick, SDL_RumbleJoystickTriggers,
    SDL_SetJoystickLED, SDL_JoystickConnected,
    SDL_SetJoystickEventsEnabled, SDL_JoystickEventsEnabled,
    SDL_UpdateJoysticks, SDL_LockJoysticks, SDL_UnlockJoysticks,
    SDL_JOYSTICK_AXIS_MAX,
};
use std::ffi::CStr;

fn sdl_err() -> napi::Error {
    let msg = unsafe { CStr::from_ptr(sdl3_sys::error::SDL_GetError()).to_string_lossy().into_owned() };
    napi::Error::new(napi::Status::GenericFailure, msg)
}

// ── Power state enum ──────────────────────────────────────────────────────────

/// Battery / power status reported by joystick battery events.
#[derive(TryFromPrimitive)]
#[repr(i32)]
#[napi]
pub enum SdlPowerState {
    Unknown = 0,
    OnBattery = 1,
    NoBattery = 2,
    Charging = 3,
    Charged = 4,
}

// ── Hat enum ─────────────────────────────────────────────────────────────────

/// Joystick hat (D-pad) position. SDL pre-enumerates all diagonal combinations,
/// so every valid hat value maps to exactly one variant.
#[derive(TryFromPrimitive)]
#[repr(u8)]
#[napi]
pub enum SdlJoyHat {
    Centered  = 0,
    Up        = 1,
    Right     = 2,
    Down      = 4,
    Left      = 8,
    RightUp   = 3,
    RightDown = 6,
    LeftUp    = 9,
    LeftDown  = 12,
}

// ── Discovery ─────────────────────────────────────────────────────────────────

/// Returns `true` if at least one joystick is connected.
#[napi]
pub fn sdl_has_joystick() -> bool {
    unsafe { SDL_HasJoystick() }
}

/// Instance IDs of all currently connected joysticks.
/// Pass an ID to `sdlOpenJoystick()` to get an `SdlJoystick`.
#[napi]
pub fn sdl_get_joysticks() -> Vec<u32> {
    let mut count = 0i32;
    let ptr = unsafe { SDL_GetJoysticks(&mut count) };
    if ptr.is_null() || count <= 0 { return vec![]; }
    let slice = unsafe { std::slice::from_raw_parts(ptr, count as usize) };
    let out: Vec<u32> = slice.iter().map(|id| id.0).collect();
    unsafe { sdl3_sys::stdinc::SDL_free(ptr as *mut _) };
    out
}

/// Human-readable name for a joystick instance (before opening it).
#[napi]
pub fn sdl_get_joystick_name_for_id(instance_id: u32) -> String {
    let p = unsafe { SDL_GetJoystickNameForID(SDL_JoystickID(instance_id)) };
    if p.is_null() { return String::new(); }
    unsafe { CStr::from_ptr(p).to_string_lossy().into_owned() }
}

/// Joystick type string for an instance (before opening it).
/// Returns e.g. `"GAMEPAD"`, `"WHEEL"`, `"FLIGHT_STICK"`, `"UNKNOWN"`.
#[napi]
pub fn sdl_get_joystick_type_for_id(instance_id: u32) -> &'static str {
    let t = unsafe { SDL_GetJoystickTypeForID(SDL_JoystickID(instance_id)) };
    joystick_type_name(t)
}

// ── SdlJoystick ───────────────────────────────────────────────────────────────

struct RawJoystick(*mut SDL_Joystick);
unsafe impl Send for RawJoystick {}
unsafe impl Sync for RawJoystick {}

/// An open joystick handle. Call `.close()` when done.
#[napi]
pub struct SdlJoystick {
    raw: RawJoystick,
}

#[napi]
impl SdlJoystick {
    // ── Identity ──────────────────────────────────────────────────────────────

    #[napi]
    pub fn instance_id(&self) -> u32 {
        unsafe { SDL_GetJoystickID(self.raw.0).0 }
    }

    #[napi]
    pub fn name(&self) -> String {
        let p = unsafe { SDL_GetJoystickName(self.raw.0) };
        if p.is_null() { return String::new(); }
        unsafe { CStr::from_ptr(p).to_string_lossy().into_owned() }
    }

    #[napi]
    pub fn joystick_type(&self) -> &'static str {
        joystick_type_name(unsafe { SDL_GetJoystickType(self.raw.0) })
    }

    #[napi]
    pub fn is_connected(&self) -> bool {
        unsafe { SDL_JoystickConnected(self.raw.0) }
    }

    // ── Axes ──────────────────────────────────────────────────────────────────

    #[napi]
    pub fn num_axes(&self) -> i32 {
        unsafe { SDL_GetNumJoystickAxes(self.raw.0) }
    }

    /// Axis value normalised to -1.0 .. 1.0.
    #[napi]
    pub fn get_axis(&self, axis: u32) -> f64 {
        let raw = unsafe { SDL_GetJoystickAxis(self.raw.0, axis as i32) };
        raw as f64 / SDL_JOYSTICK_AXIS_MAX as f64
    }

    // ── Buttons ───────────────────────────────────────────────────────────────

    #[napi]
    pub fn num_buttons(&self) -> i32 {
        unsafe { SDL_GetNumJoystickButtons(self.raw.0) }
    }

    #[napi]
    pub fn get_button(&self, button: u32) -> bool {
        unsafe { SDL_GetJoystickButton(self.raw.0, button as i32) }
    }

    // ── Hats ──────────────────────────────────────────────────────────────────

    #[napi]
    pub fn num_hats(&self) -> i32 {
        unsafe { SDL_GetNumJoystickHats(self.raw.0) }
    }

    /// Current hat (D-pad) position.
    #[napi]
    pub fn get_hat(&self, hat: u32) -> Option<SdlJoyHat> {
        SdlJoyHat::try_from(unsafe { SDL_GetJoystickHat(self.raw.0, hat as i32) }).ok()
    }

    // ── Trackballs ────────────────────────────────────────────────────────────

    #[napi]
    pub fn num_balls(&self) -> i32 {
        unsafe { SDL_GetNumJoystickBalls(self.raw.0) }
    }

    #[napi]
    pub fn get_ball(&self, ball: u32) -> napi::Result<BallDelta> {
        let (mut dx, mut dy) = (0i32, 0i32);
        if unsafe { SDL_GetJoystickBall(self.raw.0, ball as i32, &mut dx, &mut dy) } {
            Ok(BallDelta { xrel: dx, yrel: dy })
        } else {
            Err(sdl_err())
        }
    }

    // ── Haptics ───────────────────────────────────────────────────────────────

    /// Rumble the joystick. `low_freq` and `high_freq` are 0–65535.
    /// `duration_ms` is the duration in milliseconds.
    #[napi]
    pub fn rumble(&self, low_freq: u32, high_freq: u32, duration_ms: u32) -> bool {
        unsafe { SDL_RumbleJoystick(self.raw.0, low_freq as u16, high_freq as u16, duration_ms) }
    }

    /// Rumble the trigger motors (if supported). Values 0–65535.
    #[napi]
    pub fn rumble_triggers(&self, left: u32, right: u32, duration_ms: u32) -> bool {
        unsafe { SDL_RumbleJoystickTriggers(self.raw.0, left as u16, right as u16, duration_ms) }
    }

    /// Set the joystick LED colour (if supported). Components 0–255.
    #[napi]
    pub fn set_led(&self, r: u32, g: u32, b: u32) -> bool {
        unsafe { SDL_SetJoystickLED(self.raw.0, r as u8, g as u8, b as u8) }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    #[napi]
    pub fn close(&self) {
        unsafe { SDL_CloseJoystick(self.raw.0) };
    }
}

/// Open a joystick by instance ID. The returned handle must be closed with `.close()`.
#[napi]
pub fn sdl_open_joystick(instance_id: u32) -> napi::Result<SdlJoystick> {
    let ptr = unsafe { SDL_OpenJoystick(SDL_JoystickID(instance_id)) };
    if ptr.is_null() { return Err(sdl_err()); }
    Ok(SdlJoystick { raw: RawJoystick(ptr) })
}

// ── Global controls ───────────────────────────────────────────────────────────

/// Enable or disable joystick events being added to the event queue.
#[napi]
pub fn sdl_set_joystick_events_enabled(enabled: bool) {
    unsafe { SDL_SetJoystickEventsEnabled(enabled) };
}

#[napi]
pub fn sdl_joystick_events_enabled() -> bool {
    unsafe { SDL_JoystickEventsEnabled() }
}

/// Update joystick state (not needed if you call `sdlPollEvents()`).
#[napi]
pub fn sdl_update_joysticks() {
    unsafe { SDL_UpdateJoysticks() };
}

/// Lock all joystick state for thread-safe access.
#[napi]
pub fn sdl_lock_joysticks() {
    unsafe { SDL_LockJoysticks() };
}

#[napi]
pub fn sdl_unlock_joysticks() {
    unsafe { SDL_UnlockJoysticks() };
}

// ── Auxiliary types ───────────────────────────────────────────────────────────

#[napi(object)]
pub struct BallDelta {
    pub xrel: i32,
    pub yrel: i32,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn joystick_type_name(t: sdl3_sys::joystick::SDL_JoystickType) -> &'static str {
    use sdl3_sys::joystick::*;
    match t {
        SDL_JOYSTICK_TYPE_GAMEPAD => "GAMEPAD",
        SDL_JOYSTICK_TYPE_WHEEL => "WHEEL",
        SDL_JOYSTICK_TYPE_ARCADE_STICK => "ARCADE_STICK",
        SDL_JOYSTICK_TYPE_FLIGHT_STICK => "FLIGHT_STICK",
        SDL_JOYSTICK_TYPE_DANCE_PAD => "DANCE_PAD",
        SDL_JOYSTICK_TYPE_GUITAR => "GUITAR",
        SDL_JOYSTICK_TYPE_DRUM_KIT => "DRUM_KIT",
        SDL_JOYSTICK_TYPE_ARCADE_PAD => "ARCADE_PAD",
        SDL_JOYSTICK_TYPE_THROTTLE => "THROTTLE",
        _ => "UNKNOWN",
    }
}
