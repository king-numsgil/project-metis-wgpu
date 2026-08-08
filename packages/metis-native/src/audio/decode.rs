//! Audio file decoding, via symphonia. File (or byte slice) in, `AudioClip` out.
//!
//! Same shape and the same rule as `image/`: **pure Rust decoding, no C decoder
//! in the path**, and the decoded samples never cross the napi boundary as a
//! byte array on the way in — a path goes down, a handle comes back.
//!
//! Symphonia's `all` feature set is enabled, so the containers are
//! WAV/AIFF/CAF/MP4/MKV/OGG and the codecs are PCM/ADPCM/FLAC/ALAC/MP3/AAC/
//! Vorbis. Format detection is symphonia's own probe (magic bytes), with the
//! file extension supplied only as a *hint* — so a mislabelled file still
//! loads, exactly like `image/`'s detection.
//!
//! **Decoding is eager and unbounded: the whole file lands in RAM.** Streaming
//! playback (decode-as-you-go for music beds) is a deliberate non-goal for this
//! version — it needs a decoder living on the audio thread and a ring buffer,
//! which is a different design from `AudioClip`'s "immutable shared buffer".
//! `maxFrames` is the escape hatch for a caller that would rather truncate than
//! allocate a gigabyte.

use napi::bindgen_prelude::{AsyncTask, Uint8Array};
use napi::{Env, Task};
use napi_derive::napi;
use std::io::Cursor;

use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::{MediaSource, MediaSourceStream, MediaSourceStreamOptions};
use symphonia::core::meta::MetadataOptions;
use symphonia::default::{get_codecs, get_probe};

use super::clip::{AudioClip, ClipData};

// ── Options ───────────────────────────────────────────────────────────────────

#[napi(object)]
pub struct AudioLoadOptions {
    /// Resample to this rate at load time. Omit to keep the file's own rate and
    /// let the mixer resample per-voice instead.
    ///
    /// Worth doing for a sound played often at a rate that differs from the
    /// device's: the conversion happens once here instead of on every frame of
    /// every voice.
    pub target_sample_rate: Option<u32>,
    /// Downmix to a single channel. A mono clip is what the mixer's positional
    /// panning actually wants — a stereo source carries its own left/right
    /// image, which fights any attempt to place it in space.
    pub force_mono: Option<bool>,
    /// Stop after this many frames. Omit for the whole file.
    pub max_frames: Option<u32>,
    /// Format hint: a file extension (`"ogg"`, `".flac"`) or a MIME type
    /// (`"audio/flac"`). Only a hint — probing decides. Chiefly useful for
    /// `decodeAudioClip`, which has no filename to infer one from.
    pub hint: Option<String>,
}

struct DecodeParams {
    target_sample_rate: Option<u32>,
    force_mono: bool,
    max_frames: Option<usize>,
    hint: Option<String>,
}

impl DecodeParams {
    fn resolve(options: Option<AudioLoadOptions>) -> napi::Result<Self> {
        let options = match options {
            Some(o) => o,
            None => {
                return Ok(DecodeParams {
                    target_sample_rate: None,
                    force_mono: false,
                    max_frames: None,
                    hint: None,
                })
            }
        };
        if let Some(rate) = options.target_sample_rate {
            if !(1000..=768_000).contains(&rate) {
                return Err(napi::Error::new(
                    napi::Status::InvalidArg,
                    format!("targetSampleRate must be between 1000 and 768000 Hz, got {rate}"),
                ));
            }
        }
        Ok(DecodeParams {
            target_sample_rate: options.target_sample_rate,
            force_mono: options.force_mono.unwrap_or(false),
            max_frames: options.max_frames.map(|f| f as usize),
            hint: options.hint,
        })
    }
}

// ── Reported metadata ─────────────────────────────────────────────────────────

/// What `inspectAudioFile` reports. Everything here comes from the container
/// header, so it is cheap — no packet is decoded.
#[napi(object)]
pub struct AudioFileInfo {
    /// Container short name, e.g. `"wave"`, `"ogg"`, `"isomp4"`.
    pub container: String,
    /// Codec short name, e.g. `"pcm_s16le"`, `"flac"`, `"mp3"`.
    pub codec: String,
    pub sample_rate: u32,
    pub channels: u32,
    /// Frame count, when the container states one. Absent for streamed
    /// containers that don't record a length.
    pub frame_count: Option<i64>,
    /// Duration in seconds, when the frame count is known.
    pub duration: Option<f64>,
    /// Bits per decoded sample, when the codec reports one. Absent for lossy
    /// codecs, where the notion doesn't apply.
    pub bits_per_sample: Option<u32>,
}

// ── Decoding ──────────────────────────────────────────────────────────────────

fn err(msg: impl Into<String>) -> napi::Error {
    napi::Error::new(napi::Status::GenericFailure, msg.into())
}

fn build_hint(explicit: Option<&str>, path: Option<&str>) -> Hint {
    let mut hint = Hint::new();
    if let Some(h) = explicit {
        let h = h.trim();
        if h.contains('/') {
            hint.mime_type(h);
        } else {
            hint.with_extension(h.trim_start_matches('.'));
        }
    }
    if let Some(path) = path {
        if let Some(ext) = std::path::Path::new(path).extension().and_then(|e| e.to_str()) {
            hint.with_extension(ext);
        }
    }
    hint
}

/// Opens the container and finds the audio track. Shared by decode and inspect
/// so the two cannot disagree about which track a file's audio lives on.
fn open_track<'s>(
    source: Box<dyn MediaSource + 's>,
    hint: &Hint,
) -> napi::Result<(Box<dyn symphonia::core::formats::FormatReader + 's>, TrackInfo)> {
    let mss = MediaSourceStream::new(source, MediaSourceStreamOptions::default());

    let reader = get_probe()
        .probe(hint, mss, FormatOptions::default(), MetadataOptions::default())
        .map_err(|e| err(format!("could not determine the audio format: {e}")))?;

    let track = reader
        .default_track(TrackType::Audio)
        .ok_or_else(|| err("the file contains no decodable audio track"))?;

    let params = track
        .codec_params
        .as_ref()
        .and_then(|p| p.audio())
        .ok_or_else(|| err("the audio track reports no codec parameters and cannot be decoded"))?
        .clone();

    let info = TrackInfo {
        id: track.id,
        num_frames: track.num_frames,
        container: reader.format_info().short_name.to_string(),
        params,
    };
    Ok((reader, info))
}

struct TrackInfo {
    id: u32,
    num_frames: Option<u64>,
    container: String,
    params: symphonia::core::codecs::audio::AudioCodecParameters,
}

fn decode_source(
    source: Box<dyn MediaSource + '_>,
    hint: &Hint,
    params: &DecodeParams,
) -> napi::Result<ClipData> {
    let (mut reader, track) = open_track(source, hint)?;

    let mut decoder = get_codecs()
        .make_audio_decoder(&track.params, &AudioDecoderOptions::default())
        .map_err(|e| err(format!("no decoder for this audio codec: {e}")))?;

    // The decoded buffer's spec is authoritative over the container's claim —
    // some codecs correct the rate or channel layout once the first frame is
    // parsed, and a mismatch here would misinterpret the interleaving.
    let mut sample_rate = 0u32;
    let mut channels = 0u32;
    let mut samples: Vec<f32> = Vec::new();
    let mut scratch: Vec<f32> = Vec::new();

    loop {
        let packet = match reader.next_packet() {
            Ok(Some(p)) => p,
            Ok(None) => break,
            // A reset means the track list changed mid-stream (chained OGG, say).
            // Rather than silently splicing two different formats into one clip,
            // stop and keep what decoded cleanly.
            Err(SymphoniaError::ResetRequired) => break,
            // A truncated file — a half-finished download, a copy interrupted —
            // hits EOF mid-packet. That is the end of the stream, not a failure:
            // throwing away the 90% that decoded cleanly helps nobody. Any
            // *other* IO error is a real one and still propagates.
            Err(SymphoniaError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(err(format!("error reading the audio stream: {e}"))),
        };

        if packet.track_id != track.id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(buf) => {
                if channels == 0 {
                    sample_rate = buf.spec().rate();
                    channels = buf.spec().channels().count() as u32;
                    if channels == 0 || sample_rate == 0 {
                        return Err(err("the audio track reports zero channels or a zero sample rate"));
                    }
                }
                buf.copy_to_vec_interleaved(&mut scratch);
                samples.extend_from_slice(&scratch);
                // The frame budget stops the *read*, so a capped load of a long
                // file doesn't decode the whole thing and then throw it away.
                // The exact truncation to `maxFrames` happens after the loop —
                // packets don't land on frame boundaries we choose.
                if let Some(max) = params.max_frames {
                    if samples.len() / channels as usize >= max {
                        break;
                    }
                }
            }
            // Symphonia documents both of these as "discard this packet and keep
            // going" — a single corrupt frame in an MP3 should cost a click, not
            // the whole file.
            Err(SymphoniaError::DecodeError(_)) | Err(SymphoniaError::IoError(_)) => continue,
            Err(SymphoniaError::ResetRequired) => break,
            Err(e) => return Err(err(format!("error decoding the audio stream: {e}"))),
        }
    }

    if channels == 0 {
        return Err(err("the audio stream produced no decodable frames"));
    }

    let mut frames = samples.len() / channels as usize;
    samples.truncate(frames * channels as usize);

    if let Some(max) = params.max_frames {
        if frames > max {
            frames = max;
            samples.truncate(frames * channels as usize);
        }
    }

    if params.force_mono && channels > 1 {
        samples = downmix_to_mono(&samples, channels);
        channels = 1;
    }

    if let Some(target) = params.target_sample_rate {
        if target != sample_rate {
            samples = resample_linear(&samples, channels, sample_rate, target);
            sample_rate = target;
            frames = samples.len() / channels as usize;
        }
    }

    Ok(ClipData { samples, sample_rate, channels, frames })
}

/// Averages every channel into one. An average, not a sum, so a stereo file
/// whose channels are identical comes out at its original amplitude instead of
/// twice it.
pub fn downmix_to_mono(samples: &[f32], channels: u32) -> Vec<f32> {
    let n = channels as usize;
    let scale = 1.0 / n as f32;
    samples.chunks_exact(n).map(|frame| frame.iter().sum::<f32>() * scale).collect()
}

/// Linear-interpolating resampler.
///
/// Linear interpolation, not windowed sinc, and that is a known quality
/// ceiling rather than an oversight: it is exact for a rate change of 1,
/// good for small ratios, and progressively softer in the top octave as the
/// ratio grows. It has no dependency, no filter state, and — the reason it is
/// here rather than something fancier — it is *deterministic and hand-
/// checkable*, so a test can assert an exact expected sample. Upgrading means
/// adding a polyphase FIR here and in `mixer.rs`'s voice stepping, which share
/// this arithmetic on purpose.
///
/// Note there is **no anti-alias filter on downsampling**. Content above the
/// new Nyquist folds back. Fine for the common case of a clip recorded at
/// 48 kHz played at 44.1, wrong for halving the rate of a bright source.
pub fn resample_linear(samples: &[f32], channels: u32, from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate || from_rate == 0 || to_rate == 0 || channels == 0 {
        return samples.to_vec();
    }
    let n = channels as usize;
    let in_frames = samples.len() / n;
    if in_frames == 0 {
        return Vec::new();
    }

    let ratio = from_rate as f64 / to_rate as f64;
    let out_frames = ((in_frames as f64) / ratio).round().max(1.0) as usize;
    let mut out = vec![0.0f32; out_frames * n];

    for f in 0..out_frames {
        let src = f as f64 * ratio;
        let i0 = src.floor() as usize;
        let frac = (src - i0 as f64) as f32;
        // The last output frame can land exactly on, or a hair past, the final
        // input frame; clamp rather than interpolating against garbage.
        let i1 = (i0 + 1).min(in_frames - 1);
        let i0 = i0.min(in_frames - 1);
        for c in 0..n {
            let a = samples[i0 * n + c];
            let b = samples[i1 * n + c];
            out[f * n + c] = a + (b - a) * frac;
        }
    }
    out
}

// ── napi entry points ─────────────────────────────────────────────────────────

pub struct LoadClipTask {
    path: String,
    params: DecodeParams,
}

impl Task for LoadClipTask {
    type Output = ClipData;
    type JsValue = AudioClip;

    fn compute(&mut self) -> napi::Result<ClipData> {
        let file = std::fs::File::open(&self.path)
            .map_err(|e| err(format!("could not open '{}': {e}", self.path)))?;
        let hint = build_hint(self.params.hint.as_deref(), Some(&self.path));
        decode_source(Box::new(file), &hint, &self.params)
    }

    fn resolve(&mut self, _env: Env, output: ClipData) -> napi::Result<AudioClip> {
        Ok(AudioClip::from_data(output))
    }
}

/// Decode an audio file into memory. Decoding runs on a worker thread.
///
/// `ts_return_type` because napi cannot infer a `Task`'s `JsValue` — without it
/// the generated signature is `Promise<unknown>` and every caller has to cast.
/// Same reason, same fix as `loadGltf`/`loadImageTexture`.
#[napi(ts_return_type = "Promise<AudioClip>")]
pub fn load_audio_clip(path: String, options: Option<AudioLoadOptions>) -> napi::Result<AsyncTask<LoadClipTask>> {
    let params = DecodeParams::resolve(options)?;
    Ok(AsyncTask::new(LoadClipTask { path, params }))
}

pub struct DecodeClipTask {
    bytes: Vec<u8>,
    params: DecodeParams,
}

impl Task for DecodeClipTask {
    type Output = ClipData;
    type JsValue = AudioClip;

    fn compute(&mut self) -> napi::Result<ClipData> {
        let hint = build_hint(self.params.hint.as_deref(), None);
        let bytes = std::mem::take(&mut self.bytes);
        decode_source(Box::new(Cursor::new(bytes)), &hint, &self.params)
    }

    fn resolve(&mut self, _env: Env, output: ClipData) -> napi::Result<AudioClip> {
        Ok(AudioClip::from_data(output))
    }
}

/// Decode audio from bytes already in memory.
///
/// The `Uint8Array` is **copied here, on the JS thread**, for the same reason
/// `GltfResourceOverride.bytes` is: it borrows JS-owned memory, which cannot
/// travel to a worker.
#[napi(ts_return_type = "Promise<AudioClip>")]
pub fn decode_audio_clip(bytes: Uint8Array, options: Option<AudioLoadOptions>) -> napi::Result<AsyncTask<DecodeClipTask>> {
    let params = DecodeParams::resolve(options)?;
    Ok(AsyncTask::new(DecodeClipTask { bytes: bytes.to_vec(), params }))
}

pub struct InspectAudioTask {
    path: String,
    hint: Option<String>,
}

impl Task for InspectAudioTask {
    type Output = AudioFileInfo;
    type JsValue = AudioFileInfo;

    fn compute(&mut self) -> napi::Result<AudioFileInfo> {
        let file = std::fs::File::open(&self.path)
            .map_err(|e| err(format!("could not open '{}': {e}", self.path)))?;
        let hint = build_hint(self.hint.as_deref(), Some(&self.path));
        let (_reader, track) = open_track(Box::new(file), &hint)?;

        let sample_rate = track.params.sample_rate.unwrap_or(0);
        let channels = track.params.channels.as_ref().map(|c| c.count() as u32).unwrap_or(0);
        let frame_count = track.num_frames.map(|f| f as i64);
        let duration = match (frame_count, sample_rate) {
            (Some(f), r) if r > 0 => Some(f as f64 / r as f64),
            _ => None,
        };

        let codec = get_codecs()
            .get_audio_decoder(track.params.codec)
            .map(|d| d.codec.info.short_name.to_string())
            .unwrap_or_else(|| "unknown".to_string());

        Ok(AudioFileInfo {
            container: track.container,
            codec,
            sample_rate,
            channels,
            frame_count,
            duration,
            bits_per_sample: track.params.bits_per_sample,
        })
    }

    fn resolve(&mut self, _env: Env, output: AudioFileInfo) -> napi::Result<AudioFileInfo> {
        Ok(output)
    }
}

/// Read an audio file's container header — format, rate, channels, duration —
/// without decoding it.
#[napi(ts_return_type = "Promise<AudioFileInfo>")]
pub fn inspect_audio_file(path: String, hint: Option<String>) -> AsyncTask<InspectAudioTask> {
    AsyncTask::new(InspectAudioTask { path, hint })
}
