use napi_derive::napi;
use sdl3_sys::init::{SDL_Init, SDL_InitFlags, SDL_Quit};
use sdl3_sys::error::SDL_GetError;
use std::ffi::CStr;

fn get_sdl_error() -> String {
    unsafe { CStr::from_ptr(SDL_GetError()).to_string_lossy().into_owned() }
}

/// SDL subsystem init flags. OR together the flags you need and pass to `sdlInit`.
#[napi]
pub enum SdlInitFlag {
    Audio = 0x00000010,
    Video = 0x00000020,
    Joystick = 0x00000200,
    Haptic = 0x00001000,
    Gamepad = 0x00002000,
    Events = 0x00004000,
    Sensor = 0x00008000,
    Camera = 0x00010000,
}

/// Initialize SDL subsystems. `flags` is a bitmask of `SdlInitFlag` values.
#[napi]
pub fn sdl_init(flags: u32) -> napi::Result<()> {
    let ok = unsafe { SDL_Init(SDL_InitFlags(flags)) };
    if !ok {
        return Err(napi::Error::new(napi::Status::GenericFailure, get_sdl_error()));
    }
    Ok(())
}

/// Clean up all initialized SDL subsystems.
#[napi]
pub fn sdl_quit() {
    unsafe { SDL_Quit() };
}

/// Return the last SDL error string (empty string if none).
#[napi]
pub fn sdl_get_error() -> String {
    get_sdl_error()
}
