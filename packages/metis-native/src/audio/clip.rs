//! `AudioClip` — a fully decoded sound, resident in memory as interleaved f32.
//!
//! One representation, everywhere: **interleaved `f32`, one `Vec` per clip.**
//! The decoder converts to it, the mixer reads it, and `getSamples()` hands the
//! same layout to JS. That is deliberate — every format conversion is a place
//! for a channel-order or stride bug to hide, and this crate has already paid
//! for one of those (see `CLAUDE.md`, the byte-vs-value note on mapped ranges).
//!
//! The samples live behind an `Arc`, and that is load-bearing rather than
//! decorative: a playing voice in the mixer holds a clone of it, so a JS caller
//! that drops its `AudioClip` handle mid-playback cannot pull the memory out
//! from under the audio thread. The clip stays alive until the last voice
//! referencing it ends.

use napi::bindgen_prelude::Float32Array;
use napi_derive::napi;
use std::sync::Arc;

/// The decoded payload. Shared by every handle and every playing voice.
pub struct ClipData {
    /// Interleaved samples: `frames * channels` of them, frame-major.
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub channels: u32,
    pub frames: usize,
}

impl ClipData {
    /// Reads one channel of one frame. Callers in the mixer have already
    /// bounds-checked `frame`; `channel` is taken modulo the channel count so a
    /// stereo output pulling channel 1 from a mono clip reads channel 0 rather
    /// than walking into the next frame.
    #[inline]
    pub fn sample(&self, frame: usize, channel: u32) -> f32 {
        let ch = if self.channels == 0 { 0 } else { channel % self.channels };
        self.samples[frame * self.channels as usize + ch as usize]
    }
}

/// A decoded sound in memory. Produced by `loadAudioClip`/`decodeAudioClip`, or
/// built directly from samples with `AudioClip.fromSamples`.
#[napi]
pub struct AudioClip {
    pub(crate) inner: Arc<ClipData>,
}

impl AudioClip {
    pub(crate) fn from_data(data: ClipData) -> Self {
        AudioClip { inner: Arc::new(data) }
    }
}

#[napi]
impl AudioClip {
    /// Build a clip from interleaved f32 samples.
    ///
    /// This is the procedural-audio entry point, and it is also what makes the
    /// mixer testable without touching a file or a decoder: a test can
    /// synthesise an exact waveform, play it, and compare the mixer's output
    /// against the arithmetic it should have performed.
    #[napi(factory)]
    pub fn from_samples(samples: Float32Array, sample_rate: u32, channels: u32) -> napi::Result<Self> {
        if channels == 0 || channels > 8 {
            return Err(napi::Error::new(
                napi::Status::InvalidArg,
                format!("AudioClip.fromSamples: channels must be 1..=8, got {channels}"),
            ));
        }
        if sample_rate == 0 {
            return Err(napi::Error::new(
                napi::Status::InvalidArg,
                "AudioClip.fromSamples: sampleRate must be non-zero",
            ));
        }
        let samples: Vec<f32> = samples.to_vec();
        if samples.len() % channels as usize != 0 {
            return Err(napi::Error::new(
                napi::Status::InvalidArg,
                format!(
                    "AudioClip.fromSamples: sample count {} is not a multiple of the channel count {channels}",
                    samples.len()
                ),
            ));
        }
        let frames = samples.len() / channels as usize;
        Ok(AudioClip::from_data(ClipData { samples, sample_rate, channels, frames }))
    }

    /// A clip of silence. Useful as a timing spacer and as a mixer test bed.
    #[napi(factory)]
    pub fn silence(frames: u32, sample_rate: u32, channels: u32) -> napi::Result<Self> {
        if channels == 0 || channels > 8 {
            return Err(napi::Error::new(
                napi::Status::InvalidArg,
                format!("AudioClip.silence: channels must be 1..=8, got {channels}"),
            ));
        }
        let frames = frames as usize;
        Ok(AudioClip::from_data(ClipData {
            samples: vec![0.0; frames * channels as usize],
            sample_rate,
            channels,
            frames,
        }))
    }

    #[napi(getter)]
    pub fn sample_rate(&self) -> u32 {
        self.inner.sample_rate
    }

    #[napi(getter)]
    pub fn channels(&self) -> u32 {
        self.inner.channels
    }

    /// Number of sample *frames* — not samples. A stereo clip of 1000 frames
    /// holds 2000 samples.
    #[napi(getter)]
    pub fn frame_count(&self) -> u32 {
        self.inner.frames as u32
    }

    /// Length in seconds.
    #[napi(getter)]
    pub fn duration(&self) -> f64 {
        if self.inner.sample_rate == 0 {
            return 0.0;
        }
        self.inner.frames as f64 / self.inner.sample_rate as f64
    }

    /// A copy of every sample, interleaved.
    ///
    /// This copies — the samples are shared with any playing voice, so handing
    /// JS a view that aliases them would let a `Float32Array` write into memory
    /// the audio thread is reading.
    #[napi]
    pub fn get_samples(&self) -> Float32Array {
        Float32Array::new(self.inner.samples.clone())
    }

    /// A copy of one channel, de-interleaved. `channel` is zero-based.
    #[napi]
    pub fn get_channel(&self, channel: u32) -> napi::Result<Float32Array> {
        if channel >= self.inner.channels {
            return Err(napi::Error::new(
                napi::Status::InvalidArg,
                format!(
                    "getChannel: channel {channel} is out of range for a {}-channel clip",
                    self.inner.channels
                ),
            ));
        }
        let ch = channel as usize;
        let n = self.inner.channels as usize;
        let out: Vec<f32> = self.inner.samples.iter().skip(ch).step_by(n).copied().collect();
        Ok(Float32Array::new(out))
    }

    /// Largest absolute sample value. `0` for silence, `1.0` for a full-scale
    /// signal — above `1.0` means the clip will clip when it reaches a device.
    #[napi(getter)]
    pub fn peak(&self) -> f64 {
        self.inner.samples.iter().fold(0.0f32, |acc, s| acc.max(s.abs())) as f64
    }
}
