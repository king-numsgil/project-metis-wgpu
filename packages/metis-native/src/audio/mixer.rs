//! `AudioMixer` — voices in, interleaved f32 frames out.
//!
//! ## One render function, three ways to reach it
//!
//! Everything that produces audio goes through `MixerState::render_into`.
//! Nothing else mixes. That is the single most important property of this
//! module, because it is what makes an inaudible medium testable:
//!
//! | Entry point | Path | What it proves |
//! |---|---|---|
//! | `renderFrames(n)` | `render_into` directly | the arithmetic — gains, panning, resampling, looping |
//! | `openCapture()` + `capture(n)` | SDL stream + our C callback, **no device** | the SDL wiring, byte for byte, on a machine with no sound card |
//! | `openDevice()` | the same callback, bound to a device | that a real device accepts it |
//!
//! The middle row is the interesting one. `openCapture` builds the *production*
//! `SDL_AudioStream` with the *production* get-callback and simply doesn't bind
//! it to a device, so a test can pull frames out with `SDL_GetAudioStreamData`
//! and compare them against `renderFrames`. If the callback plumbing breaks, a
//! test fails on a headless box — no listening required.
//!
//! ## Why the mix runs in Rust and not in a JS callback
//!
//! SDL's audio callback runs on SDL's own thread with a hard deadline. Getting
//! from there into JS means a napi threadsafe-function hop, which queues onto
//! the event loop and waits — behind whatever the loop is already doing, and
//! behind the next GC pause. A missed deadline is an audible dropout, so there
//! is no version of that which works. JS therefore sets *parameters* (play,
//! stop, gain, pan) and Rust does the per-sample work.
//!
//! `MixerState` sits behind a `Mutex` that the audio thread takes. That is a
//! priority-inversion hazard in principle; it is the standard trade in practice
//! (rodio and friends do the same), and the critical sections here are a
//! parameter write or one buffer fill. If it ever bites, the fix is a
//! command queue into the audio thread, not a finer-grained lock.
//!
//! ## Output is deliberately not clamped
//!
//! Sum enough loud voices and samples exceed ±1; SDL and the driver will hard
//! clip them. A limiter here would make the output a nonlinear function of the
//! input, and every test in `audio-mixer.test.ts` that asserts an exact
//! expected sample would then be asserting the limiter's curve instead of the
//! mixer's arithmetic. Use `masterGain` to duck. This is a decision, not an
//! omission.

use napi::bindgen_prelude::Float32Array;
use napi_derive::napi;
use std::sync::{Arc, Mutex};

use sdl3_sys::audio::{
    SDL_AudioDeviceID, SDL_AudioSpec, SDL_AudioStream, SDL_BindAudioStream, SDL_CloseAudioDevice,
    SDL_CreateAudioStream, SDL_DestroyAudioStream, SDL_GetAudioStreamData, SDL_OpenAudioDevice,
    SDL_PauseAudioStreamDevice, SDL_PutAudioStreamData, SDL_ResumeAudioStreamDevice,
    SDL_SetAudioStreamGetCallback, SDL_AUDIO_DEVICE_DEFAULT_PLAYBACK, SDL_AUDIO_F32,
};

use super::clip::{AudioClip, ClipData};
use super::device::{audio_subsystem_alive, sdl_err};

/// Largest number of frames one `renderFrames`/`capture` call will produce.
/// A guard against a typo'd argument asking for a multi-gigabyte allocation,
/// not a real-time constraint — the device callback is unaffected by it.
const MAX_RENDER_FRAMES: u32 = 1 << 24;

// ── Voices ────────────────────────────────────────────────────────────────────

struct Voice {
    id: u32,
    clip: Arc<ClipData>,
    /// Fractional read position, in clip frames. Fractional because a clip's
    /// rate rarely matches the mixer's.
    pos: f64,
    /// Clip frames consumed per output frame: `clip_rate / mixer_rate * rate`.
    step: f64,
    gain: f32,
    /// -1 hard left, 0 centre, +1 hard right.
    pan: f32,
    looping: bool,
}

impl Voice {
    /// Constant-power pan, returning (left, right) gains.
    ///
    /// **Mono and stereo sources are scaled differently, on purpose.** A mono
    /// source is a point being *placed* in the field, so it uses plain
    /// cos/sin — total power stays constant as it sweeps, and the centre is the
    /// conventional −3 dB (0.707 each side). A stereo source already carries
    /// its own image and is being *balanced*, not placed, so its gains are
    /// scaled by √2 to make dead centre unity — otherwise loading a stereo
    /// music file and playing it untouched would come back quieter than the
    /// file, which reads as a bug every time.
    fn pan_gains(&self) -> (f32, f32) {
        let pan = self.pan.clamp(-1.0, 1.0);
        let angle = (pan + 1.0) * (std::f32::consts::FRAC_PI_4);
        let (l, r) = (angle.cos(), angle.sin());
        if self.clip.channels >= 2 {
            (l * std::f32::consts::SQRT_2, r * std::f32::consts::SQRT_2)
        } else {
            (l, r)
        }
    }

    /// Linearly interpolated read of one channel at the current position.
    /// Shares its arithmetic with `decode::resample_linear` deliberately — the
    /// same interpolation means a clip resampled at load and a clip resampled
    /// per-voice sound the same.
    #[inline]
    fn sample_at(&self, channel: u32) -> f32 {
        let frames = self.clip.frames;
        if frames == 0 {
            return 0.0;
        }
        let i0 = self.pos.floor() as usize;
        if i0 >= frames {
            return 0.0;
        }
        let frac = (self.pos - i0 as f64) as f32;
        let i1 = if i0 + 1 < frames {
            i0 + 1
        } else if self.looping {
            // Interpolating into the loop point rather than against the last
            // frame twice — otherwise a seamless loop develops a flat spot one
            // sample long at every wrap, which is an audible tick.
            0
        } else {
            i0
        };
        let a = self.clip.sample(i0, channel);
        let b = self.clip.sample(i1, channel);
        a + (b - a) * frac
    }
}

// ── Mixer state ───────────────────────────────────────────────────────────────

pub struct MixerState {
    voices: Vec<Voice>,
    next_voice_id: u32,
    master_gain: f32,
    sample_rate: u32,
    channels: u32,
    frames_rendered: u64,
    /// Reused by the device callback so a real-time fill allocates nothing
    /// once it has warmed up.
    scratch: Vec<f32>,
}

impl MixerState {
    /// The one and only mix. `out.len()` must be a multiple of the channel
    /// count; every sample in it is overwritten.
    fn render_into(&mut self, out: &mut [f32]) {
        for s in out.iter_mut() {
            *s = 0.0;
        }

        let channels = self.channels as usize;
        if channels == 0 {
            return;
        }
        let frames = out.len() / channels;

        for voice in self.voices.iter_mut() {
            let (pan_l, pan_r) = voice.pan_gains();
            let gain = voice.gain;
            let clip_frames = voice.clip.frames;
            if clip_frames == 0 {
                continue;
            }

            for f in 0..frames {
                if voice.pos >= clip_frames as f64 {
                    if voice.looping {
                        // Modulo rather than reset-to-zero: at a non-integer
                        // step the overshoot is a fraction of a frame, and
                        // discarding it drifts the loop out of time over a long
                        // playback.
                        voice.pos %= clip_frames as f64;
                    } else {
                        break;
                    }
                }

                let base = f * channels;
                match (channels, voice.clip.channels) {
                    // Stereo out: pan/balance the source across the pair.
                    (2, 1) => {
                        let s = voice.sample_at(0) * gain;
                        out[base] += s * pan_l;
                        out[base + 1] += s * pan_r;
                    }
                    (2, _) => {
                        out[base] += voice.sample_at(0) * gain * pan_l;
                        out[base + 1] += voice.sample_at(1) * gain * pan_r;
                    }
                    // Mono out: pan is meaningless, so it is ignored rather
                    // than silently halving anything.
                    (1, 1) => out[base] += voice.sample_at(0) * gain,
                    (1, n) => {
                        let mut sum = 0.0;
                        for c in 0..n {
                            sum += voice.sample_at(c);
                        }
                        out[base] += sum / n as f32 * gain;
                    }
                    // More than two output channels: fill the first two as
                    // stereo and leave the rest silent. Surround placement is
                    // where a real spatialiser belongs, not here.
                    (_, 1) => {
                        let s = voice.sample_at(0) * gain;
                        out[base] += s * pan_l;
                        out[base + 1] += s * pan_r;
                    }
                    (_, _) => {
                        out[base] += voice.sample_at(0) * gain * pan_l;
                        out[base + 1] += voice.sample_at(1) * gain * pan_r;
                    }
                }

                voice.pos += voice.step;
            }
        }

        // A finished voice is dropped, not parked — voice IDs are never reused,
        // so "no voice with this ID" is an unambiguous "it ended".
        self.voices.retain(|v| v.looping || v.pos < v.clip.frames as f64);

        let master = self.master_gain;
        if master != 1.0 {
            for s in out.iter_mut() {
                *s *= master;
            }
        }

        self.frames_rendered += frames as u64;
    }
}

// ── The SDL side ──────────────────────────────────────────────────────────────

/// Everything the audio callback touches, kept in one allocation so the
/// callback's `userdata` is a single pointer.
struct CallbackData {
    state: Arc<Mutex<MixerState>>,
}

/// Runs on SDL's audio thread. Renders exactly what SDL asked for and hands it
/// straight back.
///
/// It must never panic: a panic unwinding across the `extern "C"` boundary is
/// undefined behaviour, and this is called from a thread with no JS on it and
/// nothing to catch anything. Hence `catch_unwind` — a poisoned mutex or a
/// bug in the mix should produce silence, not a dead process.
unsafe extern "C" fn audio_callback(
    userdata: *mut std::ffi::c_void,
    stream: *mut SDL_AudioStream,
    additional_amount: std::ffi::c_int,
    _total_amount: std::ffi::c_int,
) {
    if userdata.is_null() || additional_amount <= 0 {
        return;
    }
    let data = unsafe { &*(userdata as *const CallbackData) };

    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut state = match data.state.lock() {
            Ok(s) => s,
            Err(poisoned) => poisoned.into_inner(),
        };

        let channels = state.channels as usize;
        if channels == 0 {
            return;
        }
        let bytes_per_frame = channels * std::mem::size_of::<f32>();
        let frames = additional_amount as usize / bytes_per_frame;
        if frames == 0 {
            return;
        }

        let needed = frames * channels;
        if state.scratch.len() < needed {
            state.scratch.resize(needed, 0.0);
        }
        // Split the borrow: `render_into` needs `&mut self` while writing into
        // a buffer that lives on `self`.
        let mut scratch = std::mem::take(&mut state.scratch);
        state.render_into(&mut scratch[..needed]);

        unsafe {
            SDL_PutAudioStreamData(
                stream,
                scratch.as_ptr() as *const std::ffi::c_void,
                (needed * std::mem::size_of::<f32>()) as std::ffi::c_int,
            );
        }
        state.scratch = scratch;
    }));
}

struct Bound {
    stream: *mut SDL_AudioStream,
    /// Kept alive for exactly as long as the stream is: SDL's callback holds
    /// this pointer, so it must outlive the stream and be reclaimed only after
    /// `SDL_DestroyAudioStream` has guaranteed no callback is running.
    callback_data: *mut CallbackData,
    device: SDL_AudioDeviceID,
}

unsafe impl Send for Bound {}
unsafe impl Sync for Bound {}

// ── napi surface ──────────────────────────────────────────────────────────────

#[napi(object)]
pub struct AudioMixerOptions {
    /// Output rate. Defaults to 48000.
    pub sample_rate: Option<u32>,
    /// Output channel count: 1 or 2. Defaults to 2.
    pub channels: Option<u32>,
}

#[napi(object)]
pub struct AudioPlayOptions {
    /// Linear gain. Defaults to 1.
    pub gain: Option<f64>,
    /// Stereo position, -1 (left) to +1 (right). Defaults to 0.
    pub pan: Option<f64>,
    /// Repeat forever. Defaults to false.
    pub r#loop: Option<bool>,
    /// Speed multiplier; pitch follows it, as with a tape machine. Defaults
    /// to 1.
    pub rate: Option<f64>,
    /// Start this many seconds into the clip. Defaults to 0.
    pub start_time: Option<f64>,
}

/// A software mixer. Holds voices, renders frames, and optionally drives an
/// SDL audio device.
#[napi]
pub struct AudioMixer {
    state: Arc<Mutex<MixerState>>,
    bound: Option<Bound>,
}

impl Drop for AudioMixer {
    fn drop(&mut self) {
        self.teardown();
    }
}

impl AudioMixer {
    fn teardown(&mut self) {
        if let Some(bound) = self.bound.take() {
            // If SDL's audio subsystem has already been shut down, it has
            // destroyed this stream and closed this device itself; touching
            // either again corrupts the heap. The userdata box is still ours to
            // reclaim, and must be — but only after we know no callback can be
            // running, which a dead subsystem also guarantees.
            let alive = audio_subsystem_alive();
            unsafe {
                if alive {
                    // Order matters, twice over. Destroying the stream unbinds
                    // it and guarantees the callback is not running — that is
                    // what makes reclaiming its userdata below safe rather than
                    // a race. And the logical device is closed only after the
                    // stream feeding it is gone.
                    SDL_DestroyAudioStream(bound.stream);
                }
                drop(Box::from_raw(bound.callback_data));
                if alive && bound.device.0 != 0 {
                    SDL_CloseAudioDevice(bound.device);
                }
            }
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, MixerState> {
        match self.state.lock() {
            Ok(s) => s,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    fn spec(&self) -> SDL_AudioSpec {
        let state = self.lock();
        SDL_AudioSpec {
            format: SDL_AUDIO_F32,
            channels: state.channels as std::ffi::c_int,
            freq: state.sample_rate as std::ffi::c_int,
        }
    }

    /// Builds the callback-driven stream that both `openDevice` and
    /// `openCapture` use. The only difference between them is whether the
    /// result gets bound to a device.
    fn create_stream(&mut self) -> napi::Result<()> {
        if self.bound.is_some() {
            return Err(napi::Error::new(
                napi::Status::GenericFailure,
                "this mixer is already open — call close() first",
            ));
        }
        let spec = self.spec();
        let stream = unsafe { SDL_CreateAudioStream(&spec, &spec) };
        if stream.is_null() {
            return Err(sdl_err());
        }

        let callback_data = Box::into_raw(Box::new(CallbackData { state: Arc::clone(&self.state) }));
        let ok = unsafe {
            SDL_SetAudioStreamGetCallback(stream, Some(audio_callback), callback_data as *mut std::ffi::c_void)
        };
        if !ok {
            unsafe {
                SDL_DestroyAudioStream(stream);
                drop(Box::from_raw(callback_data));
            }
            return Err(sdl_err());
        }

        self.bound = Some(Bound { stream, callback_data, device: SDL_AudioDeviceID(0) });
        Ok(())
    }
}

#[napi]
impl AudioMixer {
    #[napi(constructor)]
    pub fn new(options: Option<AudioMixerOptions>) -> napi::Result<Self> {
        let (sample_rate, channels) = match options {
            Some(o) => (o.sample_rate.unwrap_or(48_000), o.channels.unwrap_or(2)),
            None => (48_000, 2),
        };
        if channels == 0 || channels > 8 {
            return Err(napi::Error::new(
                napi::Status::InvalidArg,
                format!("AudioMixer: channels must be 1..=8, got {channels}"),
            ));
        }
        if sample_rate < 1000 || sample_rate > 768_000 {
            return Err(napi::Error::new(
                napi::Status::InvalidArg,
                format!("AudioMixer: sampleRate must be 1000..=768000, got {sample_rate}"),
            ));
        }
        Ok(AudioMixer {
            state: Arc::new(Mutex::new(MixerState {
                voices: Vec::new(),
                next_voice_id: 1,
                master_gain: 1.0,
                sample_rate,
                channels,
                frames_rendered: 0,
                scratch: Vec::new(),
            })),
            bound: None,
        })
    }

    // ── Voices ────────────────────────────────────────────────────────────────

    /// Start a clip. Returns a voice ID usable with `stop`/`setVoiceGain`/…
    ///
    /// The voice holds its own reference to the clip's samples, so the returned
    /// ID stays valid — and the sound keeps playing correctly — even if JS drops
    /// the `AudioClip` immediately after this call.
    #[napi]
    pub fn play(&mut self, clip: &AudioClip, options: Option<AudioPlayOptions>) -> napi::Result<u32> {
        let (gain, pan, looping, rate, start_time) = match options {
            Some(o) => (
                o.gain.unwrap_or(1.0) as f32,
                o.pan.unwrap_or(0.0) as f32,
                o.r#loop.unwrap_or(false),
                o.rate.unwrap_or(1.0),
                o.start_time.unwrap_or(0.0),
            ),
            None => (1.0, 0.0, false, 1.0, 0.0),
        };
        if !(rate.is_finite() && rate > 0.0) {
            return Err(napi::Error::new(
                napi::Status::InvalidArg,
                format!("play: rate must be finite and greater than zero, got {rate}"),
            ));
        }
        if !gain.is_finite() || !pan.is_finite() || !start_time.is_finite() {
            return Err(napi::Error::new(
                napi::Status::InvalidArg,
                "play: gain, pan and startTime must be finite",
            ));
        }

        let clip_data = Arc::clone(&clip.inner);
        let mut state = self.lock();
        let step = clip_data.sample_rate as f64 / state.sample_rate as f64 * rate;
        let pos = (start_time.max(0.0) * clip_data.sample_rate as f64).min(clip_data.frames as f64);

        let id = state.next_voice_id;
        state.next_voice_id = state.next_voice_id.wrapping_add(1).max(1);
        state.voices.push(Voice { id, clip: clip_data, pos, step, gain, pan, looping });
        Ok(id)
    }

    /// Stop one voice. Returns `false` if it had already ended.
    #[napi]
    pub fn stop(&mut self, voice: u32) -> bool {
        let mut state = self.lock();
        let before = state.voices.len();
        state.voices.retain(|v| v.id != voice);
        state.voices.len() != before
    }

    #[napi]
    pub fn stop_all(&mut self) {
        self.lock().voices.clear();
    }

    /// Whether a voice is still playing. False for a voice that has finished,
    /// been stopped, or never existed — IDs are never reused, so there is no
    /// ambiguity between those.
    #[napi]
    pub fn is_voice_active(&self, voice: u32) -> bool {
        self.lock().voices.iter().any(|v| v.id == voice)
    }

    #[napi]
    pub fn set_voice_gain(&mut self, voice: u32, gain: f64) -> bool {
        if !gain.is_finite() {
            return false;
        }
        let mut state = self.lock();
        match state.voices.iter_mut().find(|v| v.id == voice) {
            Some(v) => {
                v.gain = gain as f32;
                true
            }
            None => false,
        }
    }

    #[napi]
    pub fn set_voice_pan(&mut self, voice: u32, pan: f64) -> bool {
        if !pan.is_finite() {
            return false;
        }
        let mut state = self.lock();
        match state.voices.iter_mut().find(|v| v.id == voice) {
            Some(v) => {
                v.pan = pan as f32;
                true
            }
            None => false,
        }
    }

    /// A voice's playhead, in seconds into its clip.
    #[napi]
    pub fn voice_time(&self, voice: u32) -> Option<f64> {
        let state = self.lock();
        state
            .voices
            .iter()
            .find(|v| v.id == voice)
            .map(|v| v.pos / v.clip.sample_rate as f64)
    }

    #[napi(getter)]
    pub fn active_voices(&self) -> u32 {
        self.lock().voices.len() as u32
    }

    #[napi(getter)]
    pub fn master_gain(&self) -> f64 {
        self.lock().master_gain as f64
    }

    #[napi(setter)]
    pub fn set_master_gain(&mut self, gain: f64) -> napi::Result<()> {
        if !gain.is_finite() {
            return Err(napi::Error::new(napi::Status::InvalidArg, "masterGain must be finite"));
        }
        self.lock().master_gain = gain as f32;
        Ok(())
    }

    #[napi(getter)]
    pub fn sample_rate(&self) -> u32 {
        self.lock().sample_rate
    }

    #[napi(getter)]
    pub fn channels(&self) -> u32 {
        self.lock().channels
    }

    /// Total frames this mixer has produced, however it was driven.
    #[napi(getter)]
    pub fn frames_rendered(&self) -> i64 {
        self.lock().frames_rendered as i64
    }

    // ── Rendering ─────────────────────────────────────────────────────────────

    /// Render `frames` frames and return them interleaved.
    ///
    /// Refused while a device or capture stream is open, because the callback
    /// is pulling from the same state on another thread — two consumers of one
    /// playhead produce audio that belongs to neither.
    #[napi]
    pub fn render_frames(&mut self, frames: u32) -> napi::Result<Float32Array> {
        if self.bound.is_some() {
            return Err(napi::Error::new(
                napi::Status::GenericFailure,
                "renderFrames() cannot be used while the mixer is open — the device callback is \
                 already consuming these voices. Use capture() instead, or close() first.",
            ));
        }
        if frames > MAX_RENDER_FRAMES {
            return Err(napi::Error::new(
                napi::Status::InvalidArg,
                format!("renderFrames: {frames} frames is beyond the {MAX_RENDER_FRAMES} limit"),
            ));
        }
        let mut state = self.lock();
        let channels = state.channels as usize;
        let mut out = vec![0.0f32; frames as usize * channels];
        state.render_into(&mut out);
        Ok(Float32Array::new(out))
    }

    // ── Device / capture ──────────────────────────────────────────────────────

    /// Open a playback device and start feeding it.
    ///
    /// Pass a device ID from `sdlGetAudioPlaybackDevices()`, or omit for the
    /// system default. Requires `sdlInit(SdlInitFlag.Audio)`.
    ///
    /// The device starts **paused** — call `resume()`. That is deliberate: it
    /// gives a caller a moment to queue starting voices, instead of having the
    /// first callback fire against an empty mixer and emit a blip of silence at
    /// a random offset.
    #[napi]
    pub fn open_device(&mut self, device_id: Option<u32>) -> napi::Result<()> {
        let physical = match device_id {
            Some(id) => SDL_AudioDeviceID(id),
            None => SDL_AUDIO_DEVICE_DEFAULT_PLAYBACK,
        };

        // **A stream binds to a *logical* device, not to the physical one the
        // enumeration reports.** `SDL_OpenAudioDevice` turns a physical ID (or
        // the default sentinel) into a logical handle, and `SDL_BindAudioStream`
        // rejects anything else outright — "Audio streams are bound to device
        // ids from SDL_OpenAudioDevice, not raw physical devices". Opening
        // first is not optional, and it is what gives every mixer its own
        // handle on a device several of them may share.
        let spec = self.spec();
        let logical = unsafe { SDL_OpenAudioDevice(physical, &spec) };
        if logical.0 == 0 {
            return Err(sdl_err());
        }

        if let Err(e) = self.create_stream() {
            unsafe { SDL_CloseAudioDevice(logical) };
            return Err(e);
        }

        let stream = self.bound.as_ref().expect("create_stream just set this").stream;
        if !unsafe { SDL_BindAudioStream(logical, stream) } {
            let e = sdl_err();
            self.teardown();
            unsafe { SDL_CloseAudioDevice(logical) };
            return Err(e);
        }
        if let Some(b) = self.bound.as_mut() {
            b.device = logical;
        }
        // SDL resumes a freshly opened device automatically; pause it back so
        // the documented "starts paused" contract holds on every platform.
        unsafe { SDL_PauseAudioStreamDevice(stream) };
        Ok(())
    }

    /// Open the production audio pipeline **without a device**, so frames can be
    /// pulled with `capture()`.
    ///
    /// This is the offline-render and test path: same `SDL_AudioStream`, same
    /// callback, same mixing code — only the device binding is missing. It is
    /// also how you bounce a mix to a file on a machine with no audio hardware.
    #[napi]
    pub fn open_capture(&mut self) -> napi::Result<()> {
        self.create_stream()
    }

    /// Pull rendered frames out of an open mixer.
    ///
    /// Requesting data is what *drives* the callback — SDL calls it to make up
    /// whatever the stream is short by — so this exercises the real audio path
    /// rather than a parallel one.
    #[napi]
    pub fn capture(&mut self, frames: u32) -> napi::Result<Float32Array> {
        if frames > MAX_RENDER_FRAMES {
            return Err(napi::Error::new(
                napi::Status::InvalidArg,
                format!("capture: {frames} frames is beyond the {MAX_RENDER_FRAMES} limit"),
            ));
        }
        let channels = self.lock().channels as usize;
        let bound = self.bound.as_ref().ok_or_else(|| {
            napi::Error::new(
                napi::Status::GenericFailure,
                "capture() needs an open mixer — call openCapture() (or openDevice()) first",
            )
        })?;

        let mut out = vec![0.0f32; frames as usize * channels];
        let byte_len = std::mem::size_of_val(&out[..]) as std::ffi::c_int;
        let got = unsafe {
            SDL_GetAudioStreamData(bound.stream, out.as_mut_ptr() as *mut std::ffi::c_void, byte_len)
        };
        if got < 0 {
            return Err(sdl_err());
        }
        // A short read is not an error — it means the callback declined to fill
        // the request. Report exactly what arrived rather than padding it with
        // silence that would look like a rendered result.
        let got_samples = got as usize / std::mem::size_of::<f32>();
        out.truncate(got_samples);
        Ok(Float32Array::new(out))
    }

    /// Whether a device or capture stream is open.
    #[napi(getter)]
    pub fn is_open(&self) -> bool {
        self.bound.is_some()
    }

    /// The bound device ID, or `null` when opened with `openCapture()`.
    #[napi(getter)]
    pub fn device_id(&self) -> Option<u32> {
        self.bound.as_ref().filter(|b| b.device.0 != 0).map(|b| b.device.0)
    }

    /// Start (or restart) playback on the bound device.
    #[napi]
    pub fn resume(&mut self) -> napi::Result<()> {
        let bound = self.bound.as_ref().ok_or_else(|| {
            napi::Error::new(napi::Status::GenericFailure, "resume(): the mixer is not open")
        })?;
        if !unsafe { SDL_ResumeAudioStreamDevice(bound.stream) } {
            return Err(sdl_err());
        }
        Ok(())
    }

    /// Stop pulling frames. Voices keep their playheads; `resume()` continues.
    #[napi]
    pub fn pause(&mut self) -> napi::Result<()> {
        let bound = self.bound.as_ref().ok_or_else(|| {
            napi::Error::new(napi::Status::GenericFailure, "pause(): the mixer is not open")
        })?;
        if !unsafe { SDL_PauseAudioStreamDevice(bound.stream) } {
            return Err(sdl_err());
        }
        Ok(())
    }

    /// Close the device/capture stream. Voices and their playheads survive, so
    /// the mixer can be reopened, or fall back to `renderFrames`.
    ///
    /// Safe to call twice, and called automatically when the mixer is
    /// collected — but call it explicitly, for the reason `GpuSurface.destroy`
    /// exists: teardown order against `sdlQuit()` is not something a GC gets to
    /// choose.
    #[napi]
    pub fn close(&mut self) {
        self.teardown();
    }
}
