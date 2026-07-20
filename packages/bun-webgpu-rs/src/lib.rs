#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

mod gpu;
mod image;
#[allow(unused_imports)]
mod sdl;
mod vector;

// ── SDL ───────────────────────────────────────────────────────────────────────

// init / error
pub use sdl::{SdlWindow, SdlEvent, SdlEventType, SdlInitFlag, SdlWindowFlag, sdl_init, sdl_quit, sdl_get_error, sdl_create_window, sdl_pump_events, sdl_poll_events};

// window extras
pub use sdl::{WindowSize, WindowPosition, MouseRect};

// debug / timing
pub use sdl::{sdl_log, sdl_log_message, sdl_set_log_priority};
pub use sdl::{sdl_get_ticks, sdl_get_performance_counter, sdl_get_performance_frequency};
pub use sdl::{sdl_set_hint, sdl_get_hint};

// keyboard
pub use sdl::{SdlScancode, SdlKeycode, SdlKeymod};
pub use sdl::{SdlKeyboardState, sdl_get_keyboard_state, sdl_get_mod_state, sdl_set_mod_state, sdl_reset_keyboard};
pub use sdl::{sdl_get_key_name, sdl_get_scancode_name, sdl_get_key_from_name, sdl_get_scancode_from_name};
pub use sdl::{sdl_get_key_from_scancode, sdl_get_scancode_from_key};
pub use sdl::{sdl_start_text_input, sdl_stop_text_input, sdl_text_input_active};

// mouse
pub use sdl::{SdlSystemCursor, SdlMouseButton, SdlMouseButtonMask};
pub use sdl::{SdlCursor, MouseState};
pub use sdl::{sdl_create_system_cursor, sdl_set_cursor, sdl_get_cursor, sdl_get_default_cursor};
pub use sdl::{sdl_show_cursor, sdl_hide_cursor, sdl_cursor_visible};
pub use sdl::{sdl_get_mouse_state, sdl_get_relative_mouse_state, sdl_get_global_mouse_state};
pub use sdl::{sdl_warp_mouse_in_window, sdl_warp_mouse_global};
pub use sdl::{sdl_set_relative_mouse_mode, sdl_get_relative_mouse_mode, sdl_capture_mouse};

// joystick
pub use sdl::{SdlJoyHat, SdlPowerState};
pub use sdl::{SdlJoystick, BallDelta};
pub use sdl::{sdl_has_joystick, sdl_get_joysticks, sdl_get_joystick_name_for_id, sdl_get_joystick_type_for_id};
pub use sdl::{sdl_open_joystick};
pub use sdl::{sdl_set_joystick_events_enabled, sdl_joystick_events_enabled};
pub use sdl::{sdl_update_joysticks, sdl_lock_joysticks, sdl_unlock_joysticks};

// gamepad
pub use sdl::{SdlGamepadAxis, SdlGamepadButton, SdlSensorType};
pub use sdl::{SdlGamepad};
pub use sdl::{sdl_has_gamepad, sdl_get_gamepads, sdl_is_gamepad};
pub use sdl::{sdl_get_gamepad_name_for_id, sdl_get_gamepad_type_for_id};
pub use sdl::{sdl_open_gamepad};
pub use sdl::{sdl_set_gamepad_events_enabled, sdl_gamepad_events_enabled, sdl_update_gamepads};

// ── GPU ───────────────────────────────────────────────────────────────────────

pub use gpu::GpuAdapter;
pub use gpu::GpuSupportedFeatures;
pub use gpu::{GpuBindGroup, GpuBindGroupLayout, GpuPipelineLayout};
pub use gpu::GpuBuffer;
pub use gpu::{GpuCommandBuffer, GpuCommandEncoder, GpuComputePassEncoder, GpuRenderPassEncoder};
pub use gpu::{GpuDevice, GpuDeviceLostInfo, GpuError, GpuUncapturedErrorEvent};
pub use gpu::{enumerate_adapters, request_adapter, request_adapter_for_window};
pub use gpu::{GpuComputePipeline, GpuRenderPipeline};
pub use gpu::GpuQuerySet;
pub use gpu::GpuQueue;
pub use gpu::GpuSampler;
pub use gpu::GpuShaderModule;
pub use gpu::{GpuTexture, GpuTextureView};
pub use gpu::{GpuSurface, GpuSurfaceTexture, SurfaceConfiguration, create_surface};
pub use gpu::{GpuBufferUsage, GpuTextureUsage, GpuShaderStage, GpuMapMode, GpuColorWrite};

// ── Vector ─────────────────────────────────────────────────────────────────────

pub use vector::{VectorContext, FontMetrics, DrawCall};

// ── SDL_image (file -> wgpu texture) ────────────────────────────────────────────

pub use image::{ImageColorSpace, SdlImageAnimation, SdlImageLoadOptions, sdl_image_load_texture, sdl_image_load_animation};
