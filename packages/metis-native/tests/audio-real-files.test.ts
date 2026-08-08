/**
 * Tier 2: files this repo did not author.
 *
 * `audio-decode.test.ts` builds its own WAVs, which makes its assertions exact
 * but leaves one gap that `gltf-samples.test.ts` exists to close for glTF: the
 * writer and the expectations were written by the same person on the same
 * afternoon, so a misreading of the format would be baked into both sides.
 *
 * Windows ships a set of real WAVs in `C:\Windows\Media`, encoded years ago by
 * someone with no interest in making these tests pass, at three different
 * sample rates. They are the cheapest available answer — no download, no
 * committed binary, no fixture generator.
 *
 * ## What is still missing, and how to fill it
 *
 * The compressed codecs — FLAC, MP3, Vorbis, AAC, ALAC — are **not covered by
 * any test**, because nothing in this repo or on a stock Windows install can
 * encode them, and a hand-written fixture is out of the question for a real
 * codec. Symphonia has its own extensive test suite for the decoders
 * themselves, so what is untested here is specifically *this crate's* handling
 * of them: whether `decode_source`'s packet loop, channel-count inference and
 * error recovery behave on a lossy stream with encoder delay and padding.
 *
 * To close it, put a few short encoded files in `tests/assets/` — `ffmpeg -i
 * tone.wav -c:a libmp3lame tone.mp3` and friends — and extend this file. The
 * assertions should be tolerant (lossy codecs do not round-trip sample-exactly,
 * and MP3 in particular adds encoder delay), so lean on `goertzel` for pitch
 * and `rms` for level rather than on exact samples.
 */

import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"

import { AudioMixer, inspectAudioFile, loadAudioClip } from "../index.js"
import { peak, rms } from "./helpers/dsp.js"

const MEDIA = "C:/Windows/Media"

/** Three real files, deliberately at three different sample rates. */
const FILES = [
  { name: "Alarm01.wav", sampleRate: 22_050 },
  { name: "chimes.wav", sampleRate: 44_100 },
  { name: "Windows Background.wav", sampleRate: 48_000 },
]

const available = FILES.filter((f) => existsSync(`${MEDIA}/${f.name}`))

// Skipping rather than failing when the files are absent — on Linux, or a
// trimmed Windows image, they simply are not there. A suite that goes red
// because of the operating system teaches people to ignore red.
const describeIfAvailable = available.length > 0 ? describe : describe.skip

describeIfAvailable("real-world WAV files", () => {
  for (const file of available) {
    const path = `${MEDIA}/${file.name}`

    test(`${file.name}: header and decode agree`, async () => {
      const info = await inspectAudioFile(path)
      const clip = await loadAudioClip(path)

      expect(info.container).toBe("wave")
      expect(info.codec).toContain("pcm")
      expect(info.sampleRate).toBe(file.sampleRate)
      expect(clip.sampleRate).toBe(file.sampleRate)
      expect(clip.channels).toBe(info.channels)

      // The interesting assertion: the container's frame count and the number
      // of frames actually decoded must match. They diverge when the packet
      // loop mishandles a trailing partial packet, or when a chunk the reader
      // skipped was counted as audio — neither of which any single-value check
      // would notice.
      expect(clip.frameCount).toBe(info.frameCount ?? -1)
      // Both are optional in the type because a streamed container need not
      // state a length; a RIFF file always does, so an absent one here is
      // itself a failure worth catching rather than skipping past.
      expect(info.duration).not.toBeNull()
      expect(clip.duration).toBeCloseTo(info.duration ?? -1, 6)
    })

    test(`${file.name}: decodes to real audio, not silence`, async () => {
      const clip = await loadAudioClip(path)
      const samples = clip.getSamples()

      expect(samples.length).toBe(clip.frameCount * clip.channels)
      // A decoder that produced the right shape and no content — the failure
      // mode an all-zero buffer sails through every structural check.
      expect(peak(samples)).toBeGreaterThan(0.01)
      expect(rms(samples)).toBeGreaterThan(0.001)
      // And nothing pathological: no NaNs, nothing outside the format's range.
      expect(peak(samples)).toBeLessThanOrEqual(1.0)
      expect(samples.every((s) => Number.isFinite(s))).toBe(true)
    })

    test(`${file.name}: plays through a mixer at a different rate`, async () => {
      const clip = await loadAudioClip(path)
      // A 48 kHz mixer against a 22.05/44.1/48 kHz clip — the per-voice
      // resampling path, on real content rather than a synthetic tone.
      const mixer = new AudioMixer({ sampleRate: 48_000, channels: 2 })
      const voice = mixer.play(clip)

      const outFrames = Math.floor((clip.frameCount * 48_000) / clip.sampleRate)
      const out = mixer.renderFrames(Math.min(outFrames, 48_000))

      expect(peak(out)).toBeGreaterThan(0.005)
      expect(out.every((s) => Number.isFinite(s))).toBe(true)
      // Playback time must track wall-clock time, not frame count — that is
      // what resampling is for, and getting it wrong makes long sounds drift.
      expect(mixer.voiceTime(voice)).toBeCloseTo(Math.min(outFrames, 48_000) / 48_000, 3)
    })
  }

  test("load-time resampling reaches a common rate", async () => {
    const clips = await Promise.all(
      available.map((f) => loadAudioClip(`${MEDIA}/${f.name}`, { targetSampleRate: 48_000 })),
    )
    for (const clip of clips) {
      expect(clip.sampleRate).toBe(48_000)
      expect(peak(clip.getSamples())).toBeGreaterThan(0.01)
    }
  })

  test("forceMono collapses a real stereo file", async () => {
    const clip = await loadAudioClip(`${MEDIA}/${available[0]!.name}`, { forceMono: true })
    expect(clip.channels).toBe(1)
    expect(peak(clip.getSamples())).toBeGreaterThan(0.005)
  })
})
