//! SDL3 audio: drivers, device enumeration, and `SdlAudioStream`.
//!
//! ## What is exposed, and what deliberately isn't
//!
//! SDL3's audio API is stream-centric: you push data into an `SDL_AudioStream`
//! and bind that stream to a logical device, and SDL handles conversion,
//! resampling and mixing between however many streams share a device. That maps
//! cleanly onto napi and is what you find here.
//!
//! **What is not here is a JS audio callback.** `SDL_SetAudioStreamGetCallback`
//! runs on SDL's audio thread under a hard deadline; reaching JS from there
//! means a napi threadsafe-function hop that queues onto the event loop and
//! waits behind the next GC pause. It would produce dropouts on any real
//! workload, and it cannot be fixed from this side of the boundary. The
//! supported answers are: push frames from your frame loop with
//! `putSamples()`, or let `AudioMixer` own the callback in Rust.
//!
//! ## Testing this without a sound card
//!
//! SDL ships a `dummy` audio driver that accepts a device and consumes frames
//! into nothing. Select it before `sdlInit` with the existing hint API:
//!
//! ```ts
//! sdlSetHint("SDL_AUDIO_DRIVER", "dummy")
//! sdlInit(SdlInitFlag.Audio)
//! ```
//!
//! An `SdlAudioStream` that is bound to no device needs no driver at all — it
//! is a pure converter, and `putSamples`/`getSamples` around one is a complete,
//! assertable round trip on a headless machine.

use napi::bindgen_prelude::Float32Array;
use napi_derive::napi;
use std::ffi::CStr;

use sdl3_sys::audio::{
    SDL_AudioDeviceID, SDL_AudioSpec, SDL_AudioStream, SDL_ClearAudioStream, SDL_CreateAudioStream,
    SDL_DestroyAudioStream, SDL_FlushAudioStream, SDL_GetAudioDeviceFormat, SDL_GetAudioDeviceName,
    SDL_GetAudioDriver, SDL_GetAudioFormatName, SDL_GetAudioPlaybackDevices,
    SDL_GetAudioRecordingDevices, SDL_GetAudioStreamAvailable, SDL_GetAudioStreamData,
    SDL_GetAudioStreamGain, SDL_GetAudioStreamQueued, SDL_GetCurrentAudioDriver,
    SDL_GetNumAudioDrivers, SDL_PutAudioStreamData, SDL_SetAudioStreamGain, SDL_AUDIO_F32,
    SDL_AUDIO_S16, SDL_AUDIO_S32, SDL_AUDIO_S8, SDL_AUDIO_U8,
};

/// Whether SDL's audio subsystem is still up.
///
/// **Every teardown path in this module has to ask.** `SDL_Quit` (and
/// `SDL_QuitSubSystem(AUDIO)`) destroys SDL's own audio streams and closes its
/// devices, so a handle finalised afterwards is pointing at memory SDL has
/// already freed — and destroying it a second time corrupts the heap. That is
/// not hypothetical: an `AudioMixer` left to the garbage collector while a
/// device was open crashed the process with `STATUS_HEAP_CORRUPTION` at exit,
/// deterministically, in exactly this way.
///
/// It is the same shape as the surface-outliving-its-window bug in `gpu/` —
/// a handle whose teardown talks to a subsystem that has already gone away, and
/// which therefore fails *after* the last line of user code has run, where
/// nothing can catch it. The difference is that here the subsystem can be
/// asked, so the late path degrades to a no-op instead of a crash.
///
/// Callers should still close their handles explicitly. This makes forgetting
/// survivable, not correct.
pub(crate) fn audio_subsystem_alive() -> bool {
    unsafe {
        sdl3_sys::init::SDL_WasInit(sdl3_sys::init::SDL_INIT_AUDIO)
            .0
            & sdl3_sys::init::SDL_INIT_AUDIO.0
            != 0
    }
}

pub(crate) fn sdl_err() -> napi::Error {
    let msg = unsafe { CStr::from_ptr(sdl3_sys::error::SDL_GetError()).to_string_lossy().into_owned() };
    napi::Error::new(napi::Status::GenericFailure, msg)
}

fn cstr_or_empty(p: *const std::ffi::c_char) -> String {
    if p.is_null() {
        return String::new();
    }
    unsafe { CStr::from_ptr(p).to_string_lossy().into_owned() }
}

// ── Formats ───────────────────────────────────────────────────────────────────

/// Sample formats an `SdlAudioStream` can convert between.
///
/// Native byte order only. SDL also defines big-endian variants of each; they
/// exist for reading foreign files, which is the decoder's job here, not the
/// audio device's — so exposing them would only offer a way to get the byte
/// order wrong on a desktop target.
#[derive(Clone, Copy)]
#[napi]
pub enum SdlAudioFormat {
    /// Unsigned 8-bit.
    U8,
    /// Signed 8-bit.
    S8,
    /// Signed 16-bit, native order. What most hardware actually wants.
    S16,
    /// Signed 32-bit, native order.
    S32,
    /// 32-bit float, native order. The mixer's format, and SDL's own internal
    /// working format — picking it means SDL does no conversion at all.
    F32,
}

impl SdlAudioFormat {
    fn to_sdl(self) -> sdl3_sys::audio::SDL_AudioFormat {
        match self {
            SdlAudioFormat::U8 => SDL_AUDIO_U8,
            SdlAudioFormat::S8 => SDL_AUDIO_S8,
            SdlAudioFormat::S16 => SDL_AUDIO_S16,
            SdlAudioFormat::S32 => SDL_AUDIO_S32,
            SdlAudioFormat::F32 => SDL_AUDIO_F32,
        }
    }

    fn bytes_per_sample(self) -> usize {
        match self {
            SdlAudioFormat::U8 | SdlAudioFormat::S8 => 1,
            SdlAudioFormat::S16 => 2,
            SdlAudioFormat::S32 | SdlAudioFormat::F32 => 4,
        }
    }
}

/// An audio format description: what samples look like, how many channels, how
/// fast.
#[napi(object)]
pub struct SdlAudioSpecJs {
    /// Defaults to `F32` when omitted.
    pub format: Option<SdlAudioFormat>,
    /// Defaults to 2.
    pub channels: Option<u32>,
    /// Sample frames per second. Defaults to 48000.
    pub freq: Option<u32>,
}

struct ResolvedSpec {
    format: SdlAudioFormat,
    channels: u32,
    freq: u32,
}

impl ResolvedSpec {
    fn from_js(spec: Option<SdlAudioSpecJs>) -> napi::Result<Self> {
        let (format, channels, freq) = match spec {
            Some(s) => (
                s.format.unwrap_or(SdlAudioFormat::F32),
                s.channels.unwrap_or(2),
                s.freq.unwrap_or(48_000),
            ),
            None => (SdlAudioFormat::F32, 2, 48_000),
        };
        if channels == 0 || channels > 8 {
            return Err(napi::Error::new(
                napi::Status::InvalidArg,
                format!("audio spec: channels must be 1..=8, got {channels}"),
            ));
        }
        if !(1000..=768_000).contains(&freq) {
            return Err(napi::Error::new(
                napi::Status::InvalidArg,
                format!("audio spec: freq must be 1000..=768000, got {freq}"),
            ));
        }
        Ok(ResolvedSpec { format, channels, freq })
    }

    fn to_sdl(&self) -> SDL_AudioSpec {
        SDL_AudioSpec {
            format: self.format.to_sdl(),
            channels: self.channels as std::ffi::c_int,
            freq: self.freq as std::ffi::c_int,
        }
    }
}

/// A device's or stream's current format, as reported by SDL.
#[napi(object)]
pub struct AudioFormatInfo {
    /// SDL's own name for the format, e.g. `"SDL_AUDIO_F32LE"`.
    pub format: String,
    pub channels: u32,
    pub freq: u32,
}

fn format_info(spec: &SDL_AudioSpec) -> AudioFormatInfo {
    AudioFormatInfo {
        format: cstr_or_empty(unsafe { SDL_GetAudioFormatName(spec.format) }),
        channels: spec.channels as u32,
        freq: spec.freq as u32,
    }
}

// ── Drivers ───────────────────────────────────────────────────────────────────

/// Every audio driver this SDL build was compiled with, e.g.
/// `["wasapi", "directsound", "disk", "dummy"]`.
///
/// Set one before `sdlInit` with `sdlSetHint("SDL_AUDIO_DRIVER", name)`.
#[napi]
pub fn sdl_get_audio_drivers() -> Vec<String> {
    let n = unsafe { SDL_GetNumAudioDrivers() };
    (0..n).map(|i| cstr_or_empty(unsafe { SDL_GetAudioDriver(i) })).collect()
}

/// The driver actually in use, or `null` before the audio subsystem is
/// initialised.
#[napi]
pub fn sdl_get_current_audio_driver() -> Option<String> {
    let p = unsafe { SDL_GetCurrentAudioDriver() };
    if p.is_null() {
        None
    } else {
        Some(cstr_or_empty(p))
    }
}

// ── Devices ───────────────────────────────────────────────────────────────────

#[napi(object)]
pub struct AudioDeviceInfo {
    /// Pass to `AudioMixer.openDevice()`.
    pub id: u32,
    pub name: String,
    /// The format the hardware is running at. SDL will convert to it, so this
    /// is informational — it does not constrain what you may send.
    pub format: AudioFormatInfo,
    /// SDL's preferred buffer size for this device, in sample frames.
    pub buffer_frames: u32,
}

fn collect_devices(list: *mut SDL_AudioDeviceID, count: i32) -> Vec<AudioDeviceInfo> {
    if list.is_null() || count <= 0 {
        return vec![];
    }
    let ids = unsafe { std::slice::from_raw_parts(list, count as usize) };
    let out = ids
        .iter()
        .map(|id| {
            let mut spec = SDL_AudioSpec::default();
            let mut frames: std::ffi::c_int = 0;
            unsafe { SDL_GetAudioDeviceFormat(*id, &mut spec, &mut frames) };
            AudioDeviceInfo {
                id: id.0,
                name: cstr_or_empty(unsafe { SDL_GetAudioDeviceName(*id) }),
                format: format_info(&spec),
                buffer_frames: frames.max(0) as u32,
            }
        })
        .collect();
    // SDL hands back a heap array it expects the caller to free — same rule as
    // `SDL_GetJoysticks`.
    unsafe { sdl3_sys::stdinc::SDL_free(list as *mut _) };
    out
}

/// Playback (output) devices. Requires `sdlInit(SdlInitFlag.Audio)`.
#[napi]
pub fn sdl_get_audio_playback_devices() -> Vec<AudioDeviceInfo> {
    let mut count = 0i32;
    let list = unsafe { SDL_GetAudioPlaybackDevices(&mut count) };
    collect_devices(list, count)
}

/// Recording (input) devices. Enumeration only — this package does not capture
/// audio yet.
#[napi]
pub fn sdl_get_audio_recording_devices() -> Vec<AudioDeviceInfo> {
    let mut count = 0i32;
    let list = unsafe { SDL_GetAudioRecordingDevices(&mut count) };
    collect_devices(list, count)
}

// ── SdlAudioStream ────────────────────────────────────────────────────────────

struct RawStream(*mut SDL_AudioStream);
// SDL documents audio streams as internally locked and safe to use from any
// thread, which is exactly what a napi class needs to be.
unsafe impl Send for RawStream {}
unsafe impl Sync for RawStream {}

/// An SDL audio stream: a queue that converts format, channel count and sample
/// rate between what you put in and what comes out.
///
/// Useful on its own as a converter — put f32 stereo in, get s16 mono out — and
/// that unbound use needs no audio device, which makes it the one part of the
/// SDL audio path that is trivially testable anywhere.
#[napi]
pub struct SdlAudioStream {
    raw: RawStream,
    src_channels: u32,
    dst_channels: u32,
    dst_format: SdlAudioFormat,
}

/// Create a standalone audio stream converting `src` to `dst`.
///
/// Both specs default to f32 stereo 48 kHz. Identical specs mean SDL performs
/// no conversion, so what comes out is bit-identical to what went in.
#[napi]
pub fn sdl_create_audio_stream(
    src: Option<SdlAudioSpecJs>,
    dst: Option<SdlAudioSpecJs>,
) -> napi::Result<SdlAudioStream> {
    let src = ResolvedSpec::from_js(src)?;
    let dst = ResolvedSpec::from_js(dst)?;
    let (src_sdl, dst_sdl) = (src.to_sdl(), dst.to_sdl());
    let raw = unsafe { SDL_CreateAudioStream(&src_sdl, &dst_sdl) };
    if raw.is_null() {
        return Err(sdl_err());
    }
    Ok(SdlAudioStream {
        raw: RawStream(raw),
        src_channels: src.channels,
        dst_channels: dst.channels,
        dst_format: dst.format,
    })
}

#[napi]
impl SdlAudioStream {
    /// Queue f32 samples, interleaved, in the stream's **source** format.
    ///
    /// Errors if the sample count isn't a whole number of source frames — a
    /// partial frame would shift every subsequent frame's channel assignment,
    /// which produces audio that is wrong rather than short.
    #[napi]
    pub fn put_samples(&mut self, samples: Float32Array) -> napi::Result<()> {
        let data: &[f32] = &samples;
        if data.len() % self.src_channels as usize != 0 {
            return Err(napi::Error::new(
                napi::Status::InvalidArg,
                format!(
                    "putSamples: {} samples is not a whole number of {}-channel frames",
                    data.len(),
                    self.src_channels
                ),
            ));
        }
        if data.is_empty() {
            return Ok(());
        }
        let ok = unsafe {
            SDL_PutAudioStreamData(
                self.raw.0,
                data.as_ptr() as *const std::ffi::c_void,
                std::mem::size_of_val(data) as std::ffi::c_int,
            )
        };
        if !ok {
            return Err(sdl_err());
        }
        Ok(())
    }

    /// Pull up to `frames` converted frames out, as f32.
    ///
    /// Only valid when the destination format is `F32` — reinterpreting s16
    /// bytes as floats is the byte-vs-value confusion this package has been
    /// bitten by before, so it is refused rather than silently returning noise.
    /// Use `getBytes()` for any other destination format.
    #[napi]
    pub fn get_samples(&mut self, frames: u32) -> napi::Result<Float32Array> {
        if !matches!(self.dst_format, SdlAudioFormat::F32) {
            return Err(napi::Error::new(
                napi::Status::GenericFailure,
                "getSamples() requires a destination format of F32; use getBytes() instead",
            ));
        }
        let want = frames as usize * self.dst_channels as usize;
        let mut out = vec![0.0f32; want];
        let got = unsafe {
            SDL_GetAudioStreamData(
                self.raw.0,
                out.as_mut_ptr() as *mut std::ffi::c_void,
                std::mem::size_of_val(&out[..]) as std::ffi::c_int,
            )
        };
        if got < 0 {
            return Err(sdl_err());
        }
        out.truncate(got as usize / std::mem::size_of::<f32>());
        Ok(Float32Array::new(out))
    }

    /// Pull up to `frames` converted frames out as raw bytes in the destination
    /// format.
    #[napi]
    pub fn get_bytes(&mut self, frames: u32) -> napi::Result<napi::bindgen_prelude::Uint8Array> {
        let want =
            frames as usize * self.dst_channels as usize * self.dst_format.bytes_per_sample();
        let mut out = vec![0u8; want];
        let got = unsafe {
            SDL_GetAudioStreamData(
                self.raw.0,
                out.as_mut_ptr() as *mut std::ffi::c_void,
                out.len() as std::ffi::c_int,
            )
        };
        if got < 0 {
            return Err(sdl_err());
        }
        out.truncate(got as usize);
        Ok(napi::bindgen_prelude::Uint8Array::new(out))
    }

    /// Converted bytes ready to be read.
    #[napi(getter)]
    pub fn available(&self) -> i32 {
        unsafe { SDL_GetAudioStreamAvailable(self.raw.0) }
    }

    /// Bytes still queued on the input side, not yet converted.
    #[napi(getter)]
    pub fn queued(&self) -> i32 {
        unsafe { SDL_GetAudioStreamQueued(self.raw.0) }
    }

    /// Tell SDL no more input is coming, so it may convert the tail rather than
    /// holding it back waiting for more.
    ///
    /// Without this the last partial chunk can sit in the stream indefinitely —
    /// which reads as "the end of my sound is missing".
    #[napi]
    pub fn flush(&mut self) -> napi::Result<()> {
        if !unsafe { SDL_FlushAudioStream(self.raw.0) } {
            return Err(sdl_err());
        }
        Ok(())
    }

    /// Drop everything queued, both sides.
    #[napi]
    pub fn clear(&mut self) -> napi::Result<()> {
        if !unsafe { SDL_ClearAudioStream(self.raw.0) } {
            return Err(sdl_err());
        }
        Ok(())
    }

    #[napi(getter)]
    pub fn gain(&self) -> f64 {
        unsafe { SDL_GetAudioStreamGain(self.raw.0) as f64 }
    }

    #[napi(setter)]
    pub fn set_gain(&mut self, gain: f64) -> napi::Result<()> {
        if !unsafe { SDL_SetAudioStreamGain(self.raw.0, gain as std::ffi::c_float) } {
            return Err(sdl_err());
        }
        Ok(())
    }

    /// Release the stream. Idempotent, and also runs on collection.
    ///
    /// The pointer is nulled rather than left dangling, so a call made after
    /// `destroy()` reaches SDL's own null check and comes back as an error
    /// (or `-1` from the byte counters) instead of reading freed memory.
    #[napi]
    pub fn destroy(&mut self) {
        if !self.raw.0.is_null() {
            // Skipped once the audio subsystem is gone — SDL freed the stream
            // during its own teardown, and destroying it again is a double
            // free. See `audio_subsystem_alive`.
            if audio_subsystem_alive() {
                unsafe { SDL_DestroyAudioStream(self.raw.0) };
            }
            self.raw.0 = std::ptr::null_mut();
        }
    }
}

impl Drop for SdlAudioStream {
    fn drop(&mut self) {
        self.destroy();
    }
}
