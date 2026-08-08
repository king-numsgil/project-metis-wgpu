#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

mod audio;
mod gltf;
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
pub use gpu::{GpuRenderBundle, GpuRenderBundleEncoder};
pub use gpu::GpuSampler;
pub use gpu::GpuShaderModule;
pub use gpu::{GpuTexture, GpuTextureView};
pub use gpu::{GpuSurface, GpuSurfaceTexture, SurfaceConfiguration, create_surface};
pub use gpu::{GpuBufferUsage, GpuTextureUsage, GpuShaderStage, GpuMapMode, GpuColorWrite};

// ── Vector ─────────────────────────────────────────────────────────────────────

pub use vector::{VectorContext, FontMetrics, DrawCall};

// ── Image loading (file -> wgpu texture), pure Rust — no C decoder in the path ──
//
// Two separate loaders, deliberately: `load_image_texture` decodes pixels
// (PNG/JPEG/TGA/HDR, via the `image` crate) into a single-mip texture, while
// `load_ktx2_texture` uploads pre-compressed BC blocks and their mip chain from
// a KTX2 container. See `image/mod.rs` for why they aren't one function.

pub use image::{
    ImageColorSpace, ImageLoadOptions, Ktx2LoadOptions, load_image_texture, load_ktx2_texture,
    read_texture_pixels, save_pixels_to_file, save_texture_to_file,
};

// ── Audio (decode -> mix -> SDL device) ───────────────────────────────────────
//
// Pure-Rust decoding via symphonia (same rule as the image loaders), a software
// mixer whose one render function serves both the offline and the device path,
// and the SDL3 stream/device bindings underneath. See `audio/mod.rs` for the
// layering and for why positional audio isn't here yet.

pub use audio::{
    AudioClip, AudioDeviceInfo, AudioFileInfo, AudioFormatInfo, AudioLoadOptions, AudioMixer,
    AudioMixerOptions, AudioPlayOptions, SdlAudioFormat, SdlAudioSpecJs, SdlAudioStream,
    decode_audio_clip, inspect_audio_file, load_audio_clip, sdl_create_audio_stream,
    sdl_get_audio_drivers, sdl_get_audio_playback_devices, sdl_get_audio_recording_devices,
    sdl_get_current_audio_driver,
};

// ── glTF 2.0 import (file -> GPU buffers/textures + scene graph) ───────────────
//
// `inspect_gltf` parses the container only (no binary reads, no device) and
// reports the resource list a `GltfResourceOverride` matches on; `load_gltf`
// does the whole import. See `gltf/mod.rs` for the extension support matrix and
// why the hooks are declarative rather than callbacks.

pub use gltf::{
    GltfAccessorType, GltfAlphaMode, GltfAnimation, GltfAnimationChannel, GltfAnimationPath,
    GltfAnimationSampler, GltfAnisotropy, GltfAsset, GltfAttributeSemantic, GltfCamera,
    GltfCameraKind, GltfClearcoat, GltfComponentType, GltfCounts, GltfImageEncoding,
    GltfIndexFormat, GltfInterpolation, GltfIridescence, GltfLight, GltfLightKind, GltfLoadOptions,
    GltfMagFilter, GltfManifest, GltfMaterial, GltfMesh, GltfMinFilter, GltfMorphTarget, GltfNode,
    GltfNormalTextureRef, GltfOcclusionTextureRef, GltfOrthographic, GltfPerspective,
    GltfPrimitive, GltfPrimitiveMode, GltfResource, GltfResourceKind, GltfResourceOverride,
    GltfResourceSource, GltfSampler, GltfScene, GltfSheen, GltfSkin, GltfSpecular, GltfTexture,
    GltfTextureColorSpace, GltfTextureRef, GltfTextureTransform, GltfTransmission,
    GltfVertexAttribute, GltfVertexLayout, GltfVertexLayoutMode, GltfVolume, GltfWrapMode,
    inspect_gltf, load_gltf,
};
