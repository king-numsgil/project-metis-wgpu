//! HRTF binaural spatialisation, via Steam Audio (`audionimbus`).
//!
//! This is the module the audio design left a seam for. `Voice::pan_gains` does
//! constant-power stereo panning — a source gets *louder on one side*. That is
//! not the same thing as a source being *somewhere*: real localisation comes
//! from an interaural time difference (the sound reaches the near ear first, by
//! up to ~700 µs) and from the direction-dependent filtering the head and outer
//! ear apply. An HRTF encodes both, per direction, measured from real heads.
//!
//! ## Why a C++ dependency was accepted here and nowhere else
//!
//! Everything else in this package decodes in pure Rust, on purpose — see
//! `CLAUDE.md`'s account of SDL3_image corrupting the heap. Steam Audio breaks
//! that rule knowingly: there is no pure-Rust HRTF renderer of comparable
//! quality, and the alternative is not "write one", it is "ship stereo panning
//! and call it spatial audio". The costs are real and are documented on the
//! dependency in `Cargo.toml`: bindgen (so libclang on the build machine) and a
//! `phonon` shared library that must sit beside the `.node` at runtime.
//!
//! The risk profile is also different from the SDL3_image case. That was a
//! *decoder* — untrusted asset bytes reaching C parsing code, where a malformed
//! PNG smashed the allocator. This takes only f32 buffers this crate produced
//! and a direction vector. No file parsing, no attacker-controlled input.
//!
//! ## Block processing, and why there is a FIFO
//!
//! Steam Audio processes a **fixed** frame size (`FRAME_SIZE`) per call, but
//! `renderFrames` and the SDL callback both ask for arbitrary lengths. So each
//! spatial voice keeps an output FIFO: the mixer drains it, and when it runs
//! dry another block is produced. That is the whole reason spatial voices take
//! a different path through `render_into` than ordinary ones.
//!
//! Steam Audio buffers are **planar** (all left samples, then all right) while
//! this mixer is interleaved throughout. The conversion happens here, in one
//! place, deliberately.

use audionimbus::{
    AudioSettings, BinauralEffect, BinauralEffectParams, BinauralEffectSettings, Context,
    ContextSettings, Direction, Hrtf, HrtfInterpolation, HrtfSettings,
};

use super::clip::ClipData;

/// Samples per Steam Audio block. Its own default, and a good one: small enough
/// that a voice's position updates promptly, large enough that the FFT behind
/// the convolution is efficient.
pub const FRAME_SIZE: usize = 1024;

fn err(msg: impl Into<String>) -> napi::Error {
    napi::Error::new(napi::Status::GenericFailure, msg.into())
}

// ── Listener ──────────────────────────────────────────────────────────────────

/// Where the ears are, and which way they face.
///
/// Coordinates are **right-handed with −Z forward and +Y up** — Steam Audio's
/// convention, and the one glTF uses, so a camera transform from the scene
/// graph drops in without a handedness flip.
#[derive(Clone, Copy)]
pub struct Listener {
    pub position: [f32; 3],
    pub forward: [f32; 3],
    pub up: [f32; 3],
}

impl Default for Listener {
    fn default() -> Self {
        Listener { position: [0.0; 3], forward: [0.0, 0.0, -1.0], up: [0.0, 1.0, 0.0] }
    }
}

fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn normalize(v: [f32; 3]) -> Option<[f32; 3]> {
    let len = dot(v, v).sqrt();
    if !len.is_finite() || len < 1e-6 {
        return None;
    }
    Some([v[0] / len, v[1] / len, v[2] / len])
}

impl Listener {
    /// Direction to `source` **in listener space**, plus the distance to it.
    ///
    /// Steam Audio wants the direction relative to the head, not to the world,
    /// so the world-space offset is projected onto the listener's own basis. A
    /// source directly ahead comes out as `(0, 0, -1)`; directly to the right,
    /// `(1, 0, 0)`.
    ///
    /// Returns `None` for a source at the listener's exact position, where the
    /// direction is undefined — the caller renders that unspatialised rather
    /// than feeding a garbage vector to the HRTF.
    pub fn direction_to(&self, source: [f32; 3]) -> Option<([f32; 3], f32)> {
        let offset = [
            source[0] - self.position[0],
            source[1] - self.position[1],
            source[2] - self.position[2],
        ];
        let distance = dot(offset, offset).sqrt();
        let dir = normalize(offset)?;

        let forward = normalize(self.forward).unwrap_or([0.0, 0.0, -1.0]);
        let right = normalize(cross(forward, self.up)).unwrap_or([1.0, 0.0, 0.0]);
        // Re-derive up from the other two so a caller passing a non-orthogonal
        // up vector gets a sane basis instead of a skewed one.
        let up = cross(right, forward);

        Some((
            [dot(dir, right), dot(dir, up), -dot(dir, forward)],
            distance,
        ))
    }
}

// ── Engine ────────────────────────────────────────────────────────────────────

/// The shared Steam Audio state: one context and one HRTF per mixer.
///
/// Both are expensive to build — the HRTF loads and resamples measurement data
/// — and both are immutable once created, so every voice's effect borrows them
/// rather than owning a copy.
pub struct SpatialEngine {
    _context: Context,
    hrtf: Hrtf,
    audio_settings: AudioSettings,
}

impl SpatialEngine {
    pub fn new(sample_rate: u32) -> napi::Result<Self> {
        // Steam Audio is documented as failing to initialise its default HRTF at
        // rates other than 44100 and 48000. Rejecting here, with the reason,
        // beats surfacing an opaque initialisation error from inside the C++.
        if sample_rate != 44_100 && sample_rate != 48_000 {
            return Err(err(format!(
                "spatial audio requires a mixer sample rate of 44100 or 48000 Hz (Steam Audio's \
                 default HRTF does not load at other rates); this mixer is {sample_rate} Hz"
            )));
        }

        let context = Context::try_new(&ContextSettings::default())
            .map_err(|e| err(format!("could not create the Steam Audio context: {e:?}")))?;

        let audio_settings =
            AudioSettings { sampling_rate: sample_rate, frame_size: FRAME_SIZE as u32 };

        let hrtf = Hrtf::try_new(&context, &audio_settings, &HrtfSettings::default())
            .map_err(|e| err(format!("could not load the Steam Audio HRTF: {e:?}")))?;

        Ok(SpatialEngine { _context: context, hrtf, audio_settings })
    }

    pub fn hrtf(&self) -> &Hrtf {
        &self.hrtf
    }

    fn new_effect(&self) -> napi::Result<BinauralEffect> {
        BinauralEffect::try_new(
            &self._context,
            &self.audio_settings,
            &BinauralEffectSettings { hrtf: self.hrtf.clone() },
        )
        .map_err(|e| err(format!("could not create a Steam Audio binaural effect: {e:?}")))
    }
}

// ── Per-voice state ───────────────────────────────────────────────────────────

/// The spatial half of a voice: its position, its Steam Audio effect, and the
/// FIFO bridging Steam Audio's fixed block size to arbitrary render lengths.
pub struct SpatialVoice {
    effect: BinauralEffect,
    pub position: [f32; 3],
    /// Distance at which the source plays at full gain. Inside it, no boost.
    pub ref_distance: f32,
    /// Mono input block handed to Steam Audio.
    input: Vec<f32>,
    /// Planar stereo output from Steam Audio: left half, then right half.
    planar: Vec<f32>,
    /// Interleaved stereo awaiting consumption, with a read cursor.
    fifo: Vec<f32>,
    fifo_read: usize,
}

impl SpatialVoice {
    pub fn new(engine: &SpatialEngine, position: [f32; 3], ref_distance: f32) -> napi::Result<Self> {
        Ok(SpatialVoice {
            effect: engine.new_effect()?,
            position,
            ref_distance: ref_distance.max(1e-3),
            input: vec![0.0; FRAME_SIZE],
            planar: vec![0.0; FRAME_SIZE * 2],
            fifo: Vec::with_capacity(FRAME_SIZE * 2),
            fifo_read: 0,
        })
    }

    fn fifo_len(&self) -> usize {
        self.fifo.len() - self.fifo_read
    }

    /// Inverse-distance attenuation, clamped so a source at the listener's ear
    /// does not produce unbounded gain.
    ///
    /// Deliberately *not* Steam Audio's `DirectEffect`, which also models
    /// occlusion, transmission and air absorption and needs a scene to do it.
    /// This is the one term that is meaningful without geometry; the rest is a
    /// separate feature, not a missing line here.
    fn distance_gain(&self, distance: f32) -> f32 {
        self.ref_distance / distance.max(self.ref_distance)
    }

    /// Produce one block through the HRTF and append it to the FIFO.
    ///
    /// `read` fills the mono input from the clip and returns how many frames it
    /// actually produced; a short read means the clip ended, and the rest of the
    /// block is silence so the effect's tail decays naturally instead of being
    /// cut off.
    fn produce_block(
        &mut self,
        listener: &Listener,
        gain: f32,
        hrtf: &Hrtf,
        mut read: impl FnMut(&mut [f32]) -> usize,
    ) -> napi::Result<usize> {
        for s in self.input.iter_mut() {
            *s = 0.0;
        }
        let produced = read(&mut self.input);

        let (direction, distance) = match listener.direction_to(self.position) {
            Some(d) => d,
            // Source exactly at the listener: no meaningful direction, so play
            // it centred rather than inventing one.
            None => ([0.0, 0.0, -1.0], 0.0),
        };
        let total_gain = gain * self.distance_gain(distance);
        for s in self.input.iter_mut() {
            *s *= total_gain;
        }

        let params = BinauralEffectParams {
            direction: Direction::new(direction[0], direction[1], direction[2]),
            interpolation: HrtfInterpolation::Nearest,
            spatial_blend: 1.0,
            hrtf: hrtf.clone(),
            peak_delays: None,
        };

        {
            let input = audionimbus::AudioBufferRef::try_new(&self.input, 1)
                .map_err(|e| err(format!("spatial input buffer: {e:?}")))?;
            let mut output = audionimbus::AudioBufferMut::try_new(&mut self.planar, 2)
                .map_err(|e| err(format!("spatial output buffer: {e:?}")))?;
            self.effect
                .apply(&params, &input, &mut output)
                .map_err(|e| err(format!("Steam Audio binaural apply failed: {e:?}")))?;
        }

        // Planar -> interleaved, the one place this conversion happens.
        if self.fifo_read > 0 {
            self.fifo.drain(..self.fifo_read);
            self.fifo_read = 0;
        }
        let (left, right) = self.planar.split_at(FRAME_SIZE);
        for i in 0..FRAME_SIZE {
            self.fifo.push(left[i]);
            self.fifo.push(right[i]);
        }

        Ok(produced)
    }

    /// Mix `frames` frames of this voice into an interleaved stereo output,
    /// pulling blocks through the HRTF as needed.
    ///
    /// Returns `true` while the voice still has audio to give — either more
    /// clip, or a tail still draining out of the effect.
    #[allow(clippy::too_many_arguments)]
    pub fn render_into(
        &mut self,
        out: &mut [f32],
        listener: &Listener,
        gain: f32,
        hrtf: &Hrtf,
        mut read: impl FnMut(&mut [f32]) -> usize,
        clip_exhausted: &mut bool,
    ) -> napi::Result<bool> {
        let frames = out.len() / 2;
        let mut written = 0;

        while written < frames {
            if self.fifo_len() == 0 {
                if *clip_exhausted {
                    // Nothing left to feed the effect and nothing buffered.
                    return Ok(false);
                }
                let produced = self.produce_block(listener, gain, hrtf, &mut read)?;
                if produced < FRAME_SIZE {
                    *clip_exhausted = true;
                }
            }

            let available = self.fifo_len() / 2;
            let take = available.min(frames - written);
            let base = self.fifo_read;
            for i in 0..take * 2 {
                out[written * 2 + i] += self.fifo[base + i];
            }
            self.fifo_read += take * 2;
            written += take;
        }

        Ok(true)
    }
}

/// Clip reader shared by the spatial path: fills a mono block from a clip at a
/// fractional position, and reports how many frames it produced.
///
/// Uses the same linear interpolation as `Voice::sample_at`, so a clip sounds
/// the same whether it is played spatially or not — a difference there would be
/// heard as a timbre change when a sound switches modes.
pub fn read_mono_block(
    clip: &ClipData,
    pos: &mut f64,
    step: f64,
    looping: bool,
    block: &mut [f32],
) -> usize {
    let frames = clip.frames;
    if frames == 0 {
        return 0;
    }
    let mut produced = 0;
    for slot in block.iter_mut() {
        if *pos >= frames as f64 {
            if looping {
                *pos %= frames as f64;
            } else {
                break;
            }
        }
        let i0 = pos.floor() as usize;
        let frac = (*pos - i0 as f64) as f32;
        let i1 = if i0 + 1 < frames {
            i0 + 1
        } else if looping {
            0
        } else {
            i0
        };
        // Mono-sums a multi-channel clip. Spatialising a stereo source is
        // rejected at `play` time, so in practice this is always 1 channel;
        // the average is here so the function is total rather than panicking.
        let mut a = 0.0;
        let mut b = 0.0;
        for c in 0..clip.channels {
            a += clip.sample(i0, c);
            b += clip.sample(i1, c);
        }
        let inv = 1.0 / clip.channels as f32;
        *slot = (a + (b - a) * frac) * inv;
        *pos += step;
        produced += 1;
    }
    produced
}
