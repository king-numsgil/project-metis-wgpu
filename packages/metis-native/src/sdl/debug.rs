use napi_derive::napi;
use sdl3_sys::hints::{SDL_GetHint, SDL_SetHint};
use sdl3_sys::log::{
    SDL_Log, SDL_LOG_CATEGORY_APPLICATION, SDL_LOG_CATEGORY_ASSERT, SDL_LOG_CATEGORY_AUDIO,
    SDL_LOG_CATEGORY_ERROR, SDL_LOG_CATEGORY_GPU, SDL_LOG_CATEGORY_INPUT,
    SDL_LOG_CATEGORY_RENDER, SDL_LOG_CATEGORY_SYSTEM, SDL_LOG_CATEGORY_VIDEO,
    SDL_LOG_PRIORITY_CRITICAL, SDL_LOG_PRIORITY_DEBUG, SDL_LOG_PRIORITY_ERROR,
    SDL_LOG_PRIORITY_INFO, SDL_LOG_PRIORITY_TRACE, SDL_LOG_PRIORITY_VERBOSE,
    SDL_LOG_PRIORITY_WARN, SDL_LogMessage, SDL_LogPriority, SDL_SetLogPriority,
};
use sdl3_sys::timer::{SDL_GetPerformanceCounter, SDL_GetPerformanceFrequency, SDL_GetTicks};
use std::ffi::{CStr, CString};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn parse_category(s: &str) -> std::ffi::c_int {
    (match s {
        "error" => SDL_LOG_CATEGORY_ERROR,
        "assert" => SDL_LOG_CATEGORY_ASSERT,
        "system" => SDL_LOG_CATEGORY_SYSTEM,
        "audio" => SDL_LOG_CATEGORY_AUDIO,
        "video" => SDL_LOG_CATEGORY_VIDEO,
        "render" => SDL_LOG_CATEGORY_RENDER,
        "input" => SDL_LOG_CATEGORY_INPUT,
        "gpu" => SDL_LOG_CATEGORY_GPU,
        _ => SDL_LOG_CATEGORY_APPLICATION,
    })
        .into()
}

fn parse_priority(s: &str) -> SDL_LogPriority {
    match s {
        "trace" => SDL_LOG_PRIORITY_TRACE,
        "verbose" => SDL_LOG_PRIORITY_VERBOSE,
        "debug" => SDL_LOG_PRIORITY_DEBUG,
        "warn" => SDL_LOG_PRIORITY_WARN,
        "error" => SDL_LOG_PRIORITY_ERROR,
        "critical" => SDL_LOG_PRIORITY_CRITICAL,
        _ => SDL_LOG_PRIORITY_INFO,
    }
}

// ── SDL log ───────────────────────────────────────────────────────────────────

/// Emit to SDL_LOG_CATEGORY_APPLICATION at INFO priority.
/// Routed through SDL's log system so external log callbacks receive it.
#[napi]
pub fn sdl_log(message: String) -> napi::Result<()> {
    let c = CString::new(message)
        .map_err(|e| napi::Error::new(napi::Status::GenericFailure, e.to_string()))?;
    unsafe { SDL_Log(c"%s".as_ptr(), c.as_ptr()) };
    Ok(())
}

/// Emit with an explicit category and priority.
///
/// `category`: `"app"` | `"error"` | `"assert"` | `"system"` | `"audio"` | `"video"` | `"render"` | `"input"` | `"gpu"`
///
/// `priority`: `"trace"` | `"verbose"` | `"debug"` | `"info"` | `"warn"` | `"error"` | `"critical"`
#[napi]
pub fn sdl_log_message(category: String, priority: String, message: String) -> napi::Result<()> {
    let c = CString::new(message)
        .map_err(|e| napi::Error::new(napi::Status::GenericFailure, e.to_string()))?;
    unsafe {
        SDL_LogMessage(parse_category(&category), parse_priority(&priority), c"%s".as_ptr(), c.as_ptr());
    }
    Ok(())
}

/// Set the minimum log priority for a category. Messages below this level are dropped.
#[napi]
pub fn sdl_set_log_priority(category: String, priority: String) {
    unsafe { SDL_SetLogPriority(parse_category(&category), parse_priority(&priority)) };
}

// ── SDL performance timers ────────────────────────────────────────────────────

/// Milliseconds elapsed since SDL was initialised (wraps after ~49 days).
/// Suitable for frame delta-time and coarse profiling.
#[napi]
pub fn sdl_get_ticks() -> f64 {
    unsafe { SDL_GetTicks() as f64 }
}

/// High-resolution performance counter value.
/// Use together with `sdlGetPerformanceFrequency()` to compute elapsed seconds:
/// ```
/// const t0 = sdlGetPerformanceCounter()
/// // ...
/// const dt = (sdlGetPerformanceCounter() - t0) / sdlGetPerformanceFrequency()
/// ```
#[napi]
pub fn sdl_get_performance_counter() -> f64 {
    unsafe { SDL_GetPerformanceCounter() as f64 }
}

/// Counter ticks per second for `sdlGetPerformanceCounter()`.
#[napi]
pub fn sdl_get_performance_frequency() -> f64 {
    unsafe { SDL_GetPerformanceFrequency() as f64 }
}

// ── SDL hints ─────────────────────────────────────────────────────────────────

/// Override an SDL hint at normal priority. Returns `true` on success.
///
/// Common hints for game engines:
/// - `"SDL_RENDER_VSYNC"` → `"1"` / `"0"`
/// - `"SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS"` → `"1"`
/// - `"SDL_MOUSE_RELATIVE_MODE_WARP"` → `"1"`
#[napi]
pub fn sdl_set_hint(name: String, value: String) -> napi::Result<bool> {
    let n = CString::new(name)
        .map_err(|e| napi::Error::new(napi::Status::GenericFailure, e.to_string()))?;
    let v = CString::new(value)
        .map_err(|e| napi::Error::new(napi::Status::GenericFailure, e.to_string()))?;
    Ok(unsafe { SDL_SetHint(n.as_ptr(), v.as_ptr()) })
}

/// Query the current value of an SDL hint. Returns `null` if the hint is unset.
#[napi]
pub fn sdl_get_hint(name: String) -> napi::Result<Option<String>> {
    let n = CString::new(name)
        .map_err(|e| napi::Error::new(napi::Status::GenericFailure, e.to_string()))?;
    let ptr = unsafe { SDL_GetHint(n.as_ptr()) };
    if ptr.is_null() {
        return Ok(None);
    }
    Ok(Some(unsafe { CStr::from_ptr(ptr) }.to_string_lossy().into_owned()))
}
