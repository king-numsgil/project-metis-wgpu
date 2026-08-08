//! Audio: decode files to PCM, mix voices, feed an SDL device.
//!
//! Three layers, each usable without the ones above it:
//!
//! ```text
//!   decode.rs   file/bytes ──symphonia──> AudioClip        (no SDL, no device)
//!   mixer.rs    AudioClip  ──voices─────> interleaved f32  (no device needed)
//!   device.rs   f32        ──SDL3───────> speakers
//! ```
//!
//! That layering is not just tidiness — it is the testing strategy. Each arrow
//! can be checked on a headless machine by comparing numbers, so "does the
//! audio work" never has to mean "does it sound right to someone":
//!
//! - **decode** is checked against synthesised fixtures whose exact sample
//!   values are known analytically, and per-channel frequency analysis catches
//!   the interleaving mistakes that a frame-count assertion cannot see.
//! - **mixer** is arithmetic with no I/O in it at all: `renderFrames` returns
//!   the samples, and a test asserts what they must be.
//! - **device** is checked with SDL's `dummy` driver, and — the useful part —
//!   with `AudioMixer.openCapture()`, which builds the real `SDL_AudioStream`
//!   and the real audio callback but binds no device, so the frames SDL pulls
//!   through the production path can be compared against `renderFrames`.
//!
//! ## Not here yet
//!
//! **Positional/binaural audio.** The intended route is Steam Audio via the
//! `audionimbus` crate, and the seam it plugs into already exists: `Voice`'s
//! `pan_gains` is the only thing turning a source into per-channel gains, and
//! `render_into`'s per-voice inner loop is where an HRTF convolution would go.
//! It is not wired up because `audionimbus-sys` needs `bindgen` (so libclang on
//! the build machine) plus a prebuilt `phonon` shared library downloaded from
//! Valve at build time — a toolchain and a runtime artefact this package does
//! not otherwise require. Deferred, not rejected.
//!
//! **Streaming playback.** `AudioClip` is a fully resident buffer, so a long
//! music bed costs its whole decoded size in RAM. See `decode.rs`.
//!
//! **Recording.** Input devices are enumerated and nothing more.

mod clip;
mod decode;
mod device;
mod mixer;

pub use clip::AudioClip;
pub use decode::{
    decode_audio_clip, inspect_audio_file, load_audio_clip, AudioFileInfo, AudioLoadOptions,
};
pub use device::{
    sdl_create_audio_stream, sdl_get_audio_drivers, sdl_get_audio_playback_devices,
    sdl_get_audio_recording_devices, sdl_get_current_audio_driver, AudioDeviceInfo,
    AudioFormatInfo, SdlAudioFormat, SdlAudioSpecJs, SdlAudioStream,
};
pub use mixer::{AudioMixer, AudioMixerOptions, AudioPlayOptions};
