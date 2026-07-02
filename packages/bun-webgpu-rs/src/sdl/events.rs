use napi_derive::napi;
use sdl3_sys::events::{
    SDL_Event, SDL_EventType, SDL_PollEvent, SDL_PumpEvents,
    // app
    SDL_EVENT_QUIT, SDL_EVENT_TERMINATING, SDL_EVENT_LOW_MEMORY,
    SDL_EVENT_WILL_ENTER_BACKGROUND, SDL_EVENT_DID_ENTER_BACKGROUND,
    SDL_EVENT_WILL_ENTER_FOREGROUND, SDL_EVENT_DID_ENTER_FOREGROUND,
    SDL_EVENT_LOCALE_CHANGED,
    // display
    SDL_EVENT_DISPLAY_ORIENTATION, SDL_EVENT_DISPLAY_ADDED, SDL_EVENT_DISPLAY_REMOVED,
    SDL_EVENT_DISPLAY_MOVED, SDL_EVENT_DISPLAY_CONTENT_SCALE_CHANGED,
    SDL_EVENT_DISPLAY_CURRENT_MODE_CHANGED,
    // window
    SDL_EVENT_WINDOW_SHOWN, SDL_EVENT_WINDOW_HIDDEN, SDL_EVENT_WINDOW_EXPOSED,
    SDL_EVENT_WINDOW_MOVED, SDL_EVENT_WINDOW_RESIZED, SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED,
    SDL_EVENT_WINDOW_MINIMIZED, SDL_EVENT_WINDOW_MAXIMIZED, SDL_EVENT_WINDOW_RESTORED,
    SDL_EVENT_WINDOW_MOUSE_ENTER, SDL_EVENT_WINDOW_MOUSE_LEAVE,
    SDL_EVENT_WINDOW_FOCUS_GAINED, SDL_EVENT_WINDOW_FOCUS_LOST,
    SDL_EVENT_WINDOW_CLOSE_REQUESTED, SDL_EVENT_WINDOW_OCCLUDED,
    SDL_EVENT_WINDOW_ENTER_FULLSCREEN, SDL_EVENT_WINDOW_LEAVE_FULLSCREEN,
    SDL_EVENT_WINDOW_DESTROYED, SDL_EVENT_WINDOW_DISPLAY_CHANGED,
    SDL_EVENT_WINDOW_DISPLAY_SCALE_CHANGED, SDL_EVENT_WINDOW_HDR_STATE_CHANGED,
    // keyboard
    SDL_EVENT_KEY_DOWN, SDL_EVENT_KEY_UP,
    SDL_EVENT_TEXT_EDITING, SDL_EVENT_TEXT_INPUT,
    SDL_EVENT_KEYMAP_CHANGED, SDL_EVENT_KEYBOARD_ADDED, SDL_EVENT_KEYBOARD_REMOVED,
    // mouse
    SDL_EVENT_MOUSE_MOTION, SDL_EVENT_MOUSE_BUTTON_DOWN, SDL_EVENT_MOUSE_BUTTON_UP,
    SDL_EVENT_MOUSE_WHEEL, SDL_EVENT_MOUSE_ADDED, SDL_EVENT_MOUSE_REMOVED,
    // joystick
    SDL_EVENT_JOYSTICK_AXIS_MOTION, SDL_EVENT_JOYSTICK_BALL_MOTION,
    SDL_EVENT_JOYSTICK_HAT_MOTION, SDL_EVENT_JOYSTICK_BUTTON_DOWN,
    SDL_EVENT_JOYSTICK_BUTTON_UP, SDL_EVENT_JOYSTICK_ADDED, SDL_EVENT_JOYSTICK_REMOVED,
    SDL_EVENT_JOYSTICK_BATTERY_UPDATED, SDL_EVENT_JOYSTICK_UPDATE_COMPLETE,
    // gamepad
    SDL_EVENT_GAMEPAD_AXIS_MOTION, SDL_EVENT_GAMEPAD_BUTTON_DOWN,
    SDL_EVENT_GAMEPAD_BUTTON_UP, SDL_EVENT_GAMEPAD_ADDED, SDL_EVENT_GAMEPAD_REMOVED,
    SDL_EVENT_GAMEPAD_REMAPPED, SDL_EVENT_GAMEPAD_TOUCHPAD_DOWN,
    SDL_EVENT_GAMEPAD_TOUCHPAD_MOTION, SDL_EVENT_GAMEPAD_TOUCHPAD_UP,
    SDL_EVENT_GAMEPAD_SENSOR_UPDATE, SDL_EVENT_GAMEPAD_UPDATE_COMPLETE,
    // touch
    SDL_EVENT_FINGER_DOWN, SDL_EVENT_FINGER_UP, SDL_EVENT_FINGER_MOTION,
    SDL_EVENT_FINGER_CANCELED,
    // drop
    SDL_EVENT_DROP_BEGIN, SDL_EVENT_DROP_FILE, SDL_EVENT_DROP_TEXT,
    SDL_EVENT_DROP_COMPLETE, SDL_EVENT_DROP_POSITION,
    // clipboard / audio / sensor / render
    SDL_EVENT_CLIPBOARD_UPDATE,
    SDL_EVENT_AUDIO_DEVICE_ADDED, SDL_EVENT_AUDIO_DEVICE_REMOVED,
    SDL_EVENT_AUDIO_DEVICE_FORMAT_CHANGED,
    SDL_EVENT_SENSOR_UPDATE,
    SDL_EVENT_RENDER_TARGETS_RESET, SDL_EVENT_RENDER_DEVICE_RESET,
    SDL_EVENT_RENDER_DEVICE_LOST,
};
use std::ffi::CStr;
use sdl3_sys::joystick::SDL_JOYSTICK_AXIS_MAX;
use crate::{SdlScancode, SdlKeycode, SdlMouseButton, SdlJoyHat, SdlGamepadAxis, SdlGamepadButton, SdlPowerState, SdlSensorType};
// ── Event type enum ───────────────────────────────────────────────────────────
//
// Discriminant values match the SDL_EventType constants from sdl3-sys
// 0.6.6+SDL-3.4.10 so that SdlEvent.type can be compared directly with
// SdlEventType variants in TypeScript.

#[napi]
pub enum SdlEventType {
    // app
    Quit = 256,   // 0x100
    Terminating = 257,
    LowMemory = 258,
    WillEnterBackground = 259,
    DidEnterBackground = 260,
    WillEnterForeground = 261,
    DidEnterForeground = 262,
    LocaleChanged = 263,
    // display
    DisplayOrientation = 337,   // 0x151
    DisplayAdded = 338,
    DisplayRemoved = 339,
    DisplayMoved = 340,
    DisplayCurrentModeChanged = 342,
    DisplayContentScaleChanged = 343,
    // window
    WindowShown = 514,   // 0x202
    WindowHidden = 515,
    WindowExposed = 516,
    WindowMoved = 517,
    WindowResized = 518,
    WindowPixelSizeChanged = 519,
    WindowMinimized = 521,
    WindowMaximized = 522,
    WindowRestored = 523,
    WindowMouseEnter = 524,
    WindowMouseLeave = 525,
    WindowFocusGained = 526,
    WindowFocusLost = 527,
    WindowCloseRequested = 528,
    WindowDisplayChanged = 531,
    WindowDisplayScaleChanged = 532,
    WindowOccluded = 534,
    WindowEnterFullscreen = 535,
    WindowLeaveFullscreen = 536,
    WindowDestroyed = 537,
    WindowHdrStateChanged = 538,
    // keyboard
    KeyDown = 768,   // 0x300
    KeyUp = 769,
    TextEditing = 770,
    TextInput = 771,
    KeymapChanged = 772,
    KeyboardAdded = 773,
    KeyboardRemoved = 774,
    // mouse
    MouseMotion = 1024,  // 0x400
    MouseButtonDown = 1025,
    MouseButtonUp = 1026,
    MouseWheel = 1027,
    MouseAdded = 1028,
    MouseRemoved = 1029,
    // joystick
    JoystickAxisMotion = 1536,  // 0x600
    JoystickBallMotion = 1537,
    JoystickHatMotion = 1538,
    JoystickButtonDown = 1539,
    JoystickButtonUp = 1540,
    JoystickAdded = 1541,
    JoystickRemoved = 1542,
    JoystickBatteryUpdated = 1543,
    JoystickUpdateComplete = 1544,
    // gamepad
    GamepadAxisMotion = 1616,  // 0x650
    GamepadButtonDown = 1617,
    GamepadButtonUp = 1618,
    GamepadAdded = 1619,
    GamepadRemoved = 1620,
    GamepadRemapped = 1621,
    GamepadTouchpadDown = 1622,
    GamepadTouchpadMotion = 1623,
    GamepadTouchpadUp = 1624,
    GamepadSensorUpdate = 1625,
    GamepadUpdateComplete = 1626,
    // touch
    FingerDown = 1792,  // 0x700
    FingerUp = 1793,
    FingerMotion = 1794,
    FingerCanceled = 1795,
    // clipboard
    ClipboardUpdate = 2304,  // 0x900
    // drop (note: SDL_EVENT_DROP_FILE = 0x1000 comes first)
    DropFile = 4096,  // 0x1000
    DropText = 4097,
    DropBegin = 4098,
    DropComplete = 4099,
    DropPosition = 4100,
    // audio
    AudioDeviceAdded = 4352,  // 0x1100
    AudioDeviceRemoved = 4353,
    AudioDeviceFormatChanged = 4354,
    // sensor
    SensorUpdate = 4608,  // 0x1200
    // render
    RenderTargetsReset = 8192,  // 0x2000
    RenderDeviceReset = 8193,
    RenderDeviceLost = 8194,
}

// ── Event struct ─────────────────────────────────────────────────────────────
//
// Flat object — one napi allocation per event, no nested objects.

#[napi(object)]
pub struct SdlEvent {
    pub r#type: SdlEventType,
    /// Nanoseconds since SDL was initialised (SDL_GetTicksNS epoch).
    pub timestamp: f64,

    // ── Per-category fields (None when not applicable) ────────────────────

    // window / display
    pub window_id: Option<u32>,
    pub display_id: Option<u32>,
    /// For WINDOW_MOVED / WINDOW_RESIZED / DISPLAY_ORIENTATION — first value.
    pub data1: Option<i32>,
    /// For WINDOW_MOVED / WINDOW_RESIZED — second value.
    pub data2: Option<i32>,

    // keyboard
    pub scancode: Option<SdlScancode>,
    pub keycode: Option<SdlKeycode>,
    /// Keyboard modifier bitmask — AND with `SdlKeymod` values.
    pub key_mod: Option<u32>,
    pub key_repeat: Option<bool>,

    // text input / editing / drop (SDL-owned pointer copied to String)
    pub text: Option<String>,
    /// Source app for DROP events (may be null → None).
    pub text_source: Option<String>,

    // mouse
    pub mouse_x: Option<f64>,
    pub mouse_y: Option<f64>,
    pub mouse_xrel: Option<f64>,
    pub mouse_yrel: Option<f64>,
    pub mouse_button: Option<SdlMouseButton>,
    pub mouse_clicks: Option<u32>,
    /// Button-mask for MOUSE_MOTION (SDL_MouseButtonFlags) — AND with `SdlMouseButtonMask` values.
    pub mouse_buttons: Option<u32>,

    // joystick / gamepad device instance id
    pub which: Option<u32>,
    /// Joystick axis index (device-specific raw index).
    pub axis: Option<u32>,
    /// Axis value normalised to -1.0 .. 1.0.
    pub axis_value: Option<f64>,
    /// Hat index.
    pub hat: Option<u32>,
    pub hat_value: Option<SdlJoyHat>,
    /// Joystick button index (device-specific raw index).
    pub button: Option<u32>,
    /// Joystick trackball relative X motion.
    pub ball_xrel: Option<i32>,
    /// Joystick trackball relative Y motion.
    pub ball_yrel: Option<i32>,

    // battery (joystick)
    pub battery_state: Option<SdlPowerState>,
    pub battery_percent: Option<i32>,

    // gamepad axis / button (typed, gamepad events only)
    pub gamepad_axis: Option<SdlGamepadAxis>,
    pub gamepad_button: Option<SdlGamepadButton>,

    // gamepad touchpad
    pub touchpad: Option<u32>,
    pub finger: Option<u32>,
    pub touchpad_x: Option<f64>,
    pub touchpad_y: Option<f64>,
    pub touchpad_pressure: Option<f64>,

    // gamepad sensor
    pub sensor_type: Option<SdlSensorType>,
    /// Up to 3 sensor floats (accelerometer / gyro / etc.).
    pub sensor_data: Option<Vec<f64>>,

    // touch
    pub touch_id: Option<f64>,
    pub finger_id: Option<f64>,
    pub touch_x: Option<f64>,
    pub touch_y: Option<f64>,
    pub touch_dx: Option<f64>,
    pub touch_dy: Option<f64>,
    pub touch_pressure: Option<f64>,

    // drop position
    pub drop_x: Option<f64>,
    pub drop_y: Option<f64>,

    // audio device
    pub audio_device_id: Option<u32>,
    pub audio_recording: Option<bool>,
}

// ── Polling ───────────────────────────────────────────────────────────────────

/// Drain SDL's event queue and return all pending events.
/// One napi round-trip regardless of queue depth.
#[napi]
pub fn sdl_poll_events() -> Vec<SdlEvent> {
    let mut out = Vec::new();
    unsafe {
        let mut raw: SDL_Event = std::mem::zeroed();
        while SDL_PollEvent(&mut raw) {
            if let Some(ev) = convert(&raw) {
                out.push(ev);
            }
        }
    }
    out
}

/// Update the event queue without returning events.
/// Call before `sdlGetKeyboardState()` if you haven't called `sdlPollEvents()`.
#[napi]
pub fn sdl_pump_events() {
    unsafe { SDL_PumpEvents() };
}

// ── Conversion ────────────────────────────────────────────────────────────────

#[inline(always)]
fn blank(ty: SdlEventType, ts: u64) -> SdlEvent {
    SdlEvent {
        r#type: ty,
        timestamp: ts as f64,
        window_id: None,
        display_id: None,
        data1: None,
        data2: None,
        scancode: None,
        keycode: None,
        key_mod: None,
        key_repeat: None,
        text: None,
        text_source: None,
        mouse_x: None,
        mouse_y: None,
        mouse_xrel: None,
        mouse_yrel: None,
        mouse_button: None,
        mouse_clicks: None,
        mouse_buttons: None,
        which: None,
        axis: None,
        axis_value: None,
        hat: None,
        hat_value: None,
        button: None,
        ball_xrel: None,
        ball_yrel: None,
        battery_state: None,
        battery_percent: None,
        gamepad_axis: None,
        gamepad_button: None,
        touchpad: None,
        finger: None,
        touchpad_x: None,
        touchpad_y: None,
        touchpad_pressure: None,
        sensor_type: None,
        sensor_data: None,
        touch_id: None,
        finger_id: None,
        touch_x: None,
        touch_y: None,
        touch_dx: None,
        touch_dy: None,
        touch_pressure: None,
        drop_x: None,
        drop_y: None,
        audio_device_id: None,
        audio_recording: None,
    }
}

/// Copy a nullable C string into an owned Rust String. Returns None for null.
/// SAFETY: pointer must be valid (SDL-managed event queue lifetime).
unsafe fn copy_cstr(p: *const std::ffi::c_char) -> Option<String> {
    if p.is_null() { return None; }
    Some(CStr::from_ptr(p).to_string_lossy().into_owned())
}

fn sdl_event_type_from_raw(ty: SDL_EventType) -> Option<SdlEventType> {
    Some(match ty {
        SDL_EVENT_QUIT => SdlEventType::Quit,
        SDL_EVENT_TERMINATING => SdlEventType::Terminating,
        SDL_EVENT_LOW_MEMORY => SdlEventType::LowMemory,
        SDL_EVENT_WILL_ENTER_BACKGROUND => SdlEventType::WillEnterBackground,
        SDL_EVENT_DID_ENTER_BACKGROUND => SdlEventType::DidEnterBackground,
        SDL_EVENT_WILL_ENTER_FOREGROUND => SdlEventType::WillEnterForeground,
        SDL_EVENT_DID_ENTER_FOREGROUND => SdlEventType::DidEnterForeground,
        SDL_EVENT_LOCALE_CHANGED => SdlEventType::LocaleChanged,
        SDL_EVENT_DISPLAY_ORIENTATION => SdlEventType::DisplayOrientation,
        SDL_EVENT_DISPLAY_ADDED => SdlEventType::DisplayAdded,
        SDL_EVENT_DISPLAY_REMOVED => SdlEventType::DisplayRemoved,
        SDL_EVENT_DISPLAY_MOVED => SdlEventType::DisplayMoved,
        SDL_EVENT_DISPLAY_CURRENT_MODE_CHANGED => SdlEventType::DisplayCurrentModeChanged,
        SDL_EVENT_DISPLAY_CONTENT_SCALE_CHANGED => SdlEventType::DisplayContentScaleChanged,
        SDL_EVENT_WINDOW_SHOWN => SdlEventType::WindowShown,
        SDL_EVENT_WINDOW_HIDDEN => SdlEventType::WindowHidden,
        SDL_EVENT_WINDOW_EXPOSED => SdlEventType::WindowExposed,
        SDL_EVENT_WINDOW_MOVED => SdlEventType::WindowMoved,
        SDL_EVENT_WINDOW_RESIZED => SdlEventType::WindowResized,
        SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED => SdlEventType::WindowPixelSizeChanged,
        SDL_EVENT_WINDOW_MINIMIZED => SdlEventType::WindowMinimized,
        SDL_EVENT_WINDOW_MAXIMIZED => SdlEventType::WindowMaximized,
        SDL_EVENT_WINDOW_RESTORED => SdlEventType::WindowRestored,
        SDL_EVENT_WINDOW_MOUSE_ENTER => SdlEventType::WindowMouseEnter,
        SDL_EVENT_WINDOW_MOUSE_LEAVE => SdlEventType::WindowMouseLeave,
        SDL_EVENT_WINDOW_FOCUS_GAINED => SdlEventType::WindowFocusGained,
        SDL_EVENT_WINDOW_FOCUS_LOST => SdlEventType::WindowFocusLost,
        SDL_EVENT_WINDOW_CLOSE_REQUESTED => SdlEventType::WindowCloseRequested,
        SDL_EVENT_WINDOW_OCCLUDED => SdlEventType::WindowOccluded,
        SDL_EVENT_WINDOW_ENTER_FULLSCREEN => SdlEventType::WindowEnterFullscreen,
        SDL_EVENT_WINDOW_LEAVE_FULLSCREEN => SdlEventType::WindowLeaveFullscreen,
        SDL_EVENT_WINDOW_DESTROYED => SdlEventType::WindowDestroyed,
        SDL_EVENT_WINDOW_DISPLAY_CHANGED => SdlEventType::WindowDisplayChanged,
        SDL_EVENT_WINDOW_DISPLAY_SCALE_CHANGED => SdlEventType::WindowDisplayScaleChanged,
        SDL_EVENT_WINDOW_HDR_STATE_CHANGED => SdlEventType::WindowHdrStateChanged,
        SDL_EVENT_KEY_DOWN => SdlEventType::KeyDown,
        SDL_EVENT_KEY_UP => SdlEventType::KeyUp,
        SDL_EVENT_TEXT_EDITING => SdlEventType::TextEditing,
        SDL_EVENT_TEXT_INPUT => SdlEventType::TextInput,
        SDL_EVENT_KEYMAP_CHANGED => SdlEventType::KeymapChanged,
        SDL_EVENT_KEYBOARD_ADDED => SdlEventType::KeyboardAdded,
        SDL_EVENT_KEYBOARD_REMOVED => SdlEventType::KeyboardRemoved,
        SDL_EVENT_MOUSE_MOTION => SdlEventType::MouseMotion,
        SDL_EVENT_MOUSE_BUTTON_DOWN => SdlEventType::MouseButtonDown,
        SDL_EVENT_MOUSE_BUTTON_UP => SdlEventType::MouseButtonUp,
        SDL_EVENT_MOUSE_WHEEL => SdlEventType::MouseWheel,
        SDL_EVENT_MOUSE_ADDED => SdlEventType::MouseAdded,
        SDL_EVENT_MOUSE_REMOVED => SdlEventType::MouseRemoved,
        SDL_EVENT_JOYSTICK_AXIS_MOTION => SdlEventType::JoystickAxisMotion,
        SDL_EVENT_JOYSTICK_BALL_MOTION => SdlEventType::JoystickBallMotion,
        SDL_EVENT_JOYSTICK_HAT_MOTION => SdlEventType::JoystickHatMotion,
        SDL_EVENT_JOYSTICK_BUTTON_DOWN => SdlEventType::JoystickButtonDown,
        SDL_EVENT_JOYSTICK_BUTTON_UP => SdlEventType::JoystickButtonUp,
        SDL_EVENT_JOYSTICK_ADDED => SdlEventType::JoystickAdded,
        SDL_EVENT_JOYSTICK_REMOVED => SdlEventType::JoystickRemoved,
        SDL_EVENT_JOYSTICK_BATTERY_UPDATED => SdlEventType::JoystickBatteryUpdated,
        SDL_EVENT_JOYSTICK_UPDATE_COMPLETE => SdlEventType::JoystickUpdateComplete,
        SDL_EVENT_GAMEPAD_AXIS_MOTION => SdlEventType::GamepadAxisMotion,
        SDL_EVENT_GAMEPAD_BUTTON_DOWN => SdlEventType::GamepadButtonDown,
        SDL_EVENT_GAMEPAD_BUTTON_UP => SdlEventType::GamepadButtonUp,
        SDL_EVENT_GAMEPAD_ADDED => SdlEventType::GamepadAdded,
        SDL_EVENT_GAMEPAD_REMOVED => SdlEventType::GamepadRemoved,
        SDL_EVENT_GAMEPAD_REMAPPED => SdlEventType::GamepadRemapped,
        SDL_EVENT_GAMEPAD_TOUCHPAD_DOWN => SdlEventType::GamepadTouchpadDown,
        SDL_EVENT_GAMEPAD_TOUCHPAD_MOTION => SdlEventType::GamepadTouchpadMotion,
        SDL_EVENT_GAMEPAD_TOUCHPAD_UP => SdlEventType::GamepadTouchpadUp,
        SDL_EVENT_GAMEPAD_SENSOR_UPDATE => SdlEventType::GamepadSensorUpdate,
        SDL_EVENT_GAMEPAD_UPDATE_COMPLETE => SdlEventType::GamepadUpdateComplete,
        SDL_EVENT_FINGER_DOWN => SdlEventType::FingerDown,
        SDL_EVENT_FINGER_UP => SdlEventType::FingerUp,
        SDL_EVENT_FINGER_MOTION => SdlEventType::FingerMotion,
        SDL_EVENT_FINGER_CANCELED => SdlEventType::FingerCanceled,
        SDL_EVENT_CLIPBOARD_UPDATE => SdlEventType::ClipboardUpdate,
        SDL_EVENT_DROP_FILE => SdlEventType::DropFile,
        SDL_EVENT_DROP_TEXT => SdlEventType::DropText,
        SDL_EVENT_DROP_BEGIN => SdlEventType::DropBegin,
        SDL_EVENT_DROP_COMPLETE => SdlEventType::DropComplete,
        SDL_EVENT_DROP_POSITION => SdlEventType::DropPosition,
        SDL_EVENT_AUDIO_DEVICE_ADDED => SdlEventType::AudioDeviceAdded,
        SDL_EVENT_AUDIO_DEVICE_REMOVED => SdlEventType::AudioDeviceRemoved,
        SDL_EVENT_AUDIO_DEVICE_FORMAT_CHANGED => SdlEventType::AudioDeviceFormatChanged,
        SDL_EVENT_SENSOR_UPDATE => SdlEventType::SensorUpdate,
        SDL_EVENT_RENDER_TARGETS_RESET => SdlEventType::RenderTargetsReset,
        SDL_EVENT_RENDER_DEVICE_RESET => SdlEventType::RenderDeviceReset,
        SDL_EVENT_RENDER_DEVICE_LOST => SdlEventType::RenderDeviceLost,
        _ => return None,
    })
}

unsafe fn convert(raw: &SDL_Event) -> Option<SdlEvent> {
    let ety = sdl_event_type_from_raw(SDL_EventType(raw.r#type))?;
    let t = raw.common.timestamp;

    Some(match ety {
        // ── app / misc (no extra fields) ─────────────────────────────────────
        SdlEventType::Quit
        | SdlEventType::Terminating
        | SdlEventType::LowMemory
        | SdlEventType::WillEnterBackground
        | SdlEventType::DidEnterBackground
        | SdlEventType::WillEnterForeground
        | SdlEventType::DidEnterForeground
        | SdlEventType::LocaleChanged
        | SdlEventType::KeymapChanged
        | SdlEventType::ClipboardUpdate
        | SdlEventType::RenderTargetsReset
        | SdlEventType::RenderDeviceReset
        | SdlEventType::RenderDeviceLost => blank(ety, t),

        // ── display ───────────────────────────────────────────────────────────
        SdlEventType::DisplayOrientation
        | SdlEventType::DisplayAdded
        | SdlEventType::DisplayRemoved
        | SdlEventType::DisplayMoved
        | SdlEventType::DisplayCurrentModeChanged
        | SdlEventType::DisplayContentScaleChanged => {
            let d = raw.display;
            SdlEvent { display_id: Some(d.displayID.0), data1: Some(d.data1), ..blank(ety, t) }
        }

        // ── window ────────────────────────────────────────────────────────────
        SdlEventType::WindowShown
        | SdlEventType::WindowHidden
        | SdlEventType::WindowExposed
        | SdlEventType::WindowMoved
        | SdlEventType::WindowResized
        | SdlEventType::WindowPixelSizeChanged
        | SdlEventType::WindowMinimized
        | SdlEventType::WindowMaximized
        | SdlEventType::WindowRestored
        | SdlEventType::WindowMouseEnter
        | SdlEventType::WindowMouseLeave
        | SdlEventType::WindowFocusGained
        | SdlEventType::WindowFocusLost
        | SdlEventType::WindowCloseRequested
        | SdlEventType::WindowOccluded
        | SdlEventType::WindowEnterFullscreen
        | SdlEventType::WindowLeaveFullscreen
        | SdlEventType::WindowDestroyed
        | SdlEventType::WindowDisplayChanged
        | SdlEventType::WindowDisplayScaleChanged
        | SdlEventType::WindowHdrStateChanged => {
            let w = raw.window;
            SdlEvent {
                window_id: Some(w.windowID.0),
                data1: Some(w.data1),
                data2: Some(w.data2),
                ..blank(ety, t)
            }
        }

        // ── keyboard device ───────────────────────────────────────────────────
        SdlEventType::KeyboardAdded | SdlEventType::KeyboardRemoved => {
            let k = raw.kdevice;
            SdlEvent { which: Some(k.which.0), ..blank(ety, t) }
        }

        // ── key ──────────────────────────────────────────────────────────────
        SdlEventType::KeyDown | SdlEventType::KeyUp => {
            let k = raw.key;
            SdlEvent {
                window_id: Some(k.windowID.0),
                scancode: Some(SdlScancode::try_from(k.scancode.0).unwrap_or(SdlScancode::Unknown)),
                keycode: Some(SdlKeycode::try_from(k.key.0).unwrap_or(SdlKeycode::Unknown)),
                key_mod: Some(k.r#mod.0 as u32),
                key_repeat: Some(k.repeat),
                ..blank(ety, t)
            }
        }

        // ── text ─────────────────────────────────────────────────────────────
        SdlEventType::TextInput => {
            let e = raw.text;
            SdlEvent { window_id: Some(e.windowID.0), text: copy_cstr(e.text), ..blank(ety, t) }
        }
        SdlEventType::TextEditing => {
            let e = raw.edit;
            SdlEvent { window_id: Some(e.windowID.0), text: copy_cstr(e.text), ..blank(ety, t) }
        }

        // ── mouse device ──────────────────────────────────────────────────────
        SdlEventType::MouseAdded | SdlEventType::MouseRemoved => {
            let m = raw.mdevice;
            SdlEvent { which: Some(m.which.0), ..blank(ety, t) }
        }

        // ── mouse motion ──────────────────────────────────────────────────────
        SdlEventType::MouseMotion => {
            let m = raw.motion;
            SdlEvent {
                window_id: Some(m.windowID.0),
                which: Some(m.which.0),
                mouse_x: Some(m.x as f64),
                mouse_y: Some(m.y as f64),
                mouse_xrel: Some(m.xrel as f64),
                mouse_yrel: Some(m.yrel as f64),
                mouse_buttons: Some(m.state.0),
                ..blank(ety, t)
            }
        }

        // ── mouse button ──────────────────────────────────────────────────────
        SdlEventType::MouseButtonDown | SdlEventType::MouseButtonUp => {
            let b = raw.button;
            SdlEvent {
                window_id: Some(b.windowID.0),
                which: Some(b.which.0),
                mouse_x: Some(b.x as f64),
                mouse_y: Some(b.y as f64),
                mouse_button: SdlMouseButton::try_from(b.button as i32).ok(),
                mouse_clicks: Some(b.clicks as u32),
                ..blank(ety, t)
            }
        }

        // ── mouse wheel ───────────────────────────────────────────────────────
        SdlEventType::MouseWheel => {
            let w = raw.wheel;
            SdlEvent {
                window_id: Some(w.windowID.0),
                which: Some(w.which.0),
                mouse_x: Some(w.x as f64),
                mouse_y: Some(w.y as f64),
                mouse_xrel: Some(w.mouse_x as f64),
                mouse_yrel: Some(w.mouse_y as f64),
                ..blank(ety, t)
            }
        }

        // ── joystick device ───────────────────────────────────────────────────
        SdlEventType::JoystickAdded
        | SdlEventType::JoystickRemoved
        | SdlEventType::JoystickUpdateComplete => {
            let j = raw.jdevice;
            SdlEvent { which: Some(j.which.0), ..blank(ety, t) }
        }

        // ── joystick axis ─────────────────────────────────────────────────────
        SdlEventType::JoystickAxisMotion => {
            let j = raw.jaxis;
            SdlEvent {
                which: Some(j.which.0),
                axis: Some(j.axis as u32),
                axis_value: Some(j.value as f64 / SDL_JOYSTICK_AXIS_MAX as f64),
                ..blank(ety, t)
            }
        }

        // ── joystick hat ──────────────────────────────────────────────────────
        SdlEventType::JoystickHatMotion => {
            let j = raw.jhat;
            SdlEvent {
                which: Some(j.which.0),
                hat: Some(j.hat as u32),
                hat_value: SdlJoyHat::try_from(j.value).ok(),
                ..blank(ety, t)
            }
        }

        // ── joystick button ───────────────────────────────────────────────────
        SdlEventType::JoystickButtonDown | SdlEventType::JoystickButtonUp => {
            let j = raw.jbutton;
            SdlEvent {
                which: Some(j.which.0),
                button: Some(j.button as u32),
                ..blank(ety, t)
            }
        }

        // ── joystick ball ─────────────────────────────────────────────────────
        SdlEventType::JoystickBallMotion => {
            let j = raw.jball;
            SdlEvent {
                which: Some(j.which.0),
                axis: Some(j.ball as u32),
                ball_xrel: Some(j.xrel as i32),
                ball_yrel: Some(j.yrel as i32),
                ..blank(ety, t)
            }
        }

        // ── joystick battery ──────────────────────────────────────────────────
        SdlEventType::JoystickBatteryUpdated => {
            let j = raw.jbattery;
            SdlEvent {
                which: Some(j.which.0),
                battery_state: SdlPowerState::try_from(j.state.0).ok(),
                battery_percent: Some(j.percent),
                ..blank(ety, t)
            }
        }

        // ── gamepad device ────────────────────────────────────────────────────
        SdlEventType::GamepadAdded
        | SdlEventType::GamepadRemoved
        | SdlEventType::GamepadRemapped
        | SdlEventType::GamepadUpdateComplete => {
            let g = raw.gdevice;
            SdlEvent { which: Some(g.which.0), ..blank(ety, t) }
        }

        // ── gamepad axis ──────────────────────────────────────────────────────
        SdlEventType::GamepadAxisMotion => {
            let g = raw.gaxis;
            SdlEvent {
                which: Some(g.which.0),
                gamepad_axis: SdlGamepadAxis::try_from(g.axis as i32).ok(),
                axis_value: Some(g.value as f64 / 32767.0),
                ..blank(ety, t)
            }
        }

        // ── gamepad button ────────────────────────────────────────────────────
        SdlEventType::GamepadButtonDown | SdlEventType::GamepadButtonUp => {
            let g = raw.gbutton;
            SdlEvent {
                which: Some(g.which.0),
                gamepad_button: SdlGamepadButton::try_from(g.button as i32).ok(),
                ..blank(ety, t)
            }
        }

        // ── gamepad touchpad ──────────────────────────────────────────────────
        SdlEventType::GamepadTouchpadDown
        | SdlEventType::GamepadTouchpadMotion
        | SdlEventType::GamepadTouchpadUp => {
            let g = raw.gtouchpad;
            SdlEvent {
                which: Some(g.which.0),
                touchpad: Some(g.touchpad as u32),
                finger: Some(g.finger as u32),
                touchpad_x: Some(g.x as f64),
                touchpad_y: Some(g.y as f64),
                touchpad_pressure: Some(g.pressure as f64),
                ..blank(ety, t)
            }
        }

        // ── gamepad sensor ────────────────────────────────────────────────────
        SdlEventType::GamepadSensorUpdate => {
            let g = raw.gsensor;
            SdlEvent {
                which: Some(g.which.0),
                sensor_type: SdlSensorType::try_from(g.sensor).ok(),
                sensor_data: Some(g.data.iter().map(|&v| v as f64).collect()),
                ..blank(ety, t)
            }
        }

        // ── touch ─────────────────────────────────────────────────────────────
        SdlEventType::FingerDown
        | SdlEventType::FingerUp
        | SdlEventType::FingerMotion
        | SdlEventType::FingerCanceled => {
            let f = raw.tfinger;
            SdlEvent {
                window_id: Some(f.windowID.0),
                touch_id: Some(f.touchID.0 as f64),
                finger_id: Some(f.fingerID.0 as f64),
                touch_x: Some(f.x as f64),
                touch_y: Some(f.y as f64),
                touch_dx: Some(f.dx as f64),
                touch_dy: Some(f.dy as f64),
                touch_pressure: Some(f.pressure as f64),
                ..blank(ety, t)
            }
        }

        // ── drop ──────────────────────────────────────────────────────────────
        SdlEventType::DropFile
        | SdlEventType::DropText
        | SdlEventType::DropBegin
        | SdlEventType::DropComplete
        | SdlEventType::DropPosition => {
            let d = raw.drop;
            // d.data and d.source are SDL-managed; copy before the next PollEvent
            // call which may invalidate them.
            SdlEvent {
                window_id: Some(d.windowID.0),
                text: copy_cstr(d.data),
                text_source: copy_cstr(d.source),
                drop_x: Some(d.x as f64),
                drop_y: Some(d.y as f64),
                ..blank(ety, t)
            }
        }

        // ── audio device ──────────────────────────────────────────────────────
        SdlEventType::AudioDeviceAdded
        | SdlEventType::AudioDeviceRemoved
        | SdlEventType::AudioDeviceFormatChanged => {
            let a = raw.adevice;
            SdlEvent {
                audio_device_id: Some(a.which.0),
                audio_recording: Some(a.recording),
                ..blank(ety, t)
            }
        }

        // ── sensor ────────────────────────────────────────────────────────────
        SdlEventType::SensorUpdate => {
            let s = raw.sensor;
            SdlEvent {
                which: Some(s.which.0),
                sensor_type: SdlSensorType::try_from(s.which.0 as i32).ok(),
                sensor_data: Some(s.data.iter().map(|&v| v as f64).collect()),
                ..blank(ety, t)
            }
        }
    })
}
