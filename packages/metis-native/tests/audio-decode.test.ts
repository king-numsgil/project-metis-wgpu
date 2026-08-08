/**
 * Decoding: file/bytes -> AudioClip.
 *
 * The fixtures are built by `helpers/wav-build.ts` inside the test, so every
 * expected sample is a number this file computed. That matters more here than
 * it sounds: almost every way a decoder can be wrong yields a buffer of the
 * right length full of finite floats. Swapped stereo channels, a sign-extension
 * bug in 24-bit, an off-by-one stride — all of them pass a `frameCount` check.
 *
 * So there are two tiers of assertion, and both are load-bearing:
 *
 *  - **Sample-exact**, against the values that were encoded. Catches scaling,
 *    quantisation and sign errors.
 *  - **Per-channel frequency content** (`goertzel`). Catches everything
 *    positional: a channel swap, an interleaving stride bug, a resampler that
 *    shifts pitch. A left channel holding the right channel's tone is
 *    numerically indistinguishable from correct until you ask *which tone*.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  AudioClip,
  decodeAudioClip,
  inspectAudioFile,
  loadAudioClip,
} from "../index.js"

import { goertzel, interleave, maxAbsDiff, peak, sine, stereo } from "./helpers/dsp.js"
import { buildWav, quantisationTolerance, type WavEncoding } from "./helpers/wav-build.js"

// 100 and 50 samples per cycle at this rate — a whole number of cycles fits in
// any multiple of 100 frames, so the frequency analysis is exact rather than
// leaky. See the note in `helpers/dsp.ts`.
const RATE = 48_000
const TONE_L = 480
const TONE_R = 960
const FRAMES = 4_800

const OUT = join(tmpdir(), `metis-audio-${process.pid}`)

beforeAll(() => {
  mkdirSync(OUT, { recursive: true })
})

afterAll(() => {
  rmSync(OUT, { recursive: true, force: true })
})

function writeFixture(name: string, bytes: Uint8Array): string {
  const path = join(OUT, name)
  writeFileSync(path, bytes)
  return path
}

describe("PCM decoding, every sample format", () => {
  const encodings: WavEncoding[] = ["u8", "s16", "s24", "f32"]

  for (const encoding of encodings) {
    test(`${encoding}: mono round-trips sample-exact`, async () => {
      const source = sine(TONE_L, RATE, FRAMES, 0.5)
      const path = writeFixture(
        `mono-${encoding}.wav`,
        buildWav({ samples: source, sampleRate: RATE, channels: 1, encoding }),
      )

      const clip = await loadAudioClip(path)
      expect(clip.sampleRate).toBe(RATE)
      expect(clip.channels).toBe(1)
      expect(clip.frameCount).toBe(FRAMES)
      expect(clip.duration).toBeCloseTo(FRAMES / RATE, 6)

      const decoded = clip.getSamples()
      expect(decoded.length).toBe(FRAMES)
      // One quantisation step of the source format, and no more. This is the
      // assertion that a scaling or sign error fails.
      expect(maxAbsDiff(decoded, source)).toBeLessThanOrEqual(quantisationTolerance(encoding))
    })
  }
})

describe("channel layout", () => {
  /**
   * The interleaving test. Left carries 480 Hz, right carries 960 Hz, and each
   * channel is checked for *both* — so swapping them, or reading with the wrong
   * stride, fails on the tone that should be absent rather than merely on
   * amplitude.
   */
  test("stereo channels keep their own content", async () => {
    const left = sine(TONE_L, RATE, FRAMES, 0.8)
    const right = sine(TONE_R, RATE, FRAMES, 0.4)
    const path = writeFixture(
      "stereo-s16.wav",
      buildWav({
        samples: interleave([left, right]),
        sampleRate: RATE,
        channels: 2,
        encoding: "s16",
      }),
    )

    const clip = await loadAudioClip(path)
    expect(clip.channels).toBe(2)
    expect(clip.frameCount).toBe(FRAMES)

    const [l, r] = stereo(clip.getSamples())

    expect(goertzel(l, RATE, TONE_L)).toBeCloseTo(0.8, 2)
    expect(goertzel(l, RATE, TONE_R)).toBeLessThan(0.01)

    expect(goertzel(r, RATE, TONE_R)).toBeCloseTo(0.4, 2)
    expect(goertzel(r, RATE, TONE_L)).toBeLessThan(0.01)
  })

  test("getChannel de-interleaves the same way", async () => {
    const left = sine(TONE_L, RATE, FRAMES, 0.8)
    const right = sine(TONE_R, RATE, FRAMES, 0.4)
    const path = writeFixture(
      "stereo-getchannel.wav",
      buildWav({
        samples: interleave([left, right]),
        sampleRate: RATE,
        channels: 2,
        encoding: "f32",
      }),
    )

    const clip = await loadAudioClip(path)
    expect(maxAbsDiff(clip.getChannel(0), left)).toBeLessThan(1e-6)
    expect(maxAbsDiff(clip.getChannel(1), right)).toBeLessThan(1e-6)
    expect(() => clip.getChannel(2)).toThrow(/out of range/)
  })

  test("forceMono averages rather than sums", async () => {
    const left = sine(TONE_L, RATE, FRAMES, 0.8)
    const right = sine(TONE_R, RATE, FRAMES, 0.4)
    const path = writeFixture(
      "stereo-downmix.wav",
      buildWav({
        samples: interleave([left, right]),
        sampleRate: RATE,
        channels: 2,
        encoding: "f32",
      }),
    )

    const clip = await loadAudioClip(path, { forceMono: true })
    expect(clip.channels).toBe(1)
    expect(clip.frameCount).toBe(FRAMES)

    const mono = clip.getSamples()
    // Both tones survive, each at half its original amplitude — that is what
    // "average" means and what distinguishes it from a sum, which would leave
    // them at full amplitude and clip a loud source.
    expect(goertzel(mono, RATE, TONE_L)).toBeCloseTo(0.4, 2)
    expect(goertzel(mono, RATE, TONE_R)).toBeCloseTo(0.2, 2)
  })
})

describe("load-time resampling", () => {
  test("halving the rate keeps the pitch and halves the length", async () => {
    const source = sine(TONE_L, RATE, FRAMES, 0.5)
    const path = writeFixture(
      "resample.wav",
      buildWav({ samples: source, sampleRate: RATE, channels: 1, encoding: "f32" }),
    )

    const clip = await loadAudioClip(path, { targetSampleRate: RATE / 2 })
    expect(clip.sampleRate).toBe(RATE / 2)
    expect(clip.frameCount).toBe(FRAMES / 2)
    // Duration is what must be preserved; frame count changing without it is
    // the whole point of resampling.
    expect(clip.duration).toBeCloseTo(FRAMES / RATE, 4)

    const out = clip.getSamples()
    // Still 480 Hz in the new rate's terms. A resampler that merely dropped
    // every other sample without accounting for the rate change would report
    // the tone at 960 Hz here.
    expect(goertzel(out, RATE / 2, TONE_L)).toBeCloseTo(0.5, 1)
  })

  test("upsampling preserves pitch too", async () => {
    const source = sine(TONE_L, RATE, FRAMES, 0.5)
    const path = writeFixture(
      "resample-up.wav",
      buildWav({ samples: source, sampleRate: RATE, channels: 1, encoding: "f32" }),
    )

    const clip = await loadAudioClip(path, { targetSampleRate: 96_000 })
    expect(clip.sampleRate).toBe(96_000)
    expect(clip.frameCount).toBe(FRAMES * 2)
    expect(goertzel(clip.getSamples(), 96_000, TONE_L)).toBeCloseTo(0.5, 1)
  })

  test("a rejected target rate throws before any work happens", () => {
    expect(() => loadAudioClip("nonexistent.wav", { targetSampleRate: 12 })).toThrow(
      /targetSampleRate/,
    )
  })
})

describe("maxFrames", () => {
  test("truncates to exactly the requested frame count", async () => {
    const source = sine(TONE_L, RATE, FRAMES, 0.5)
    const path = writeFixture(
      "capped.wav",
      buildWav({ samples: source, sampleRate: RATE, channels: 1, encoding: "f32" }),
    )

    const clip = await loadAudioClip(path, { maxFrames: 1000 })
    expect(clip.frameCount).toBe(1000)
    expect(maxAbsDiff(clip.getSamples(), source.subarray(0, 1000))).toBeLessThan(1e-6)
  })

  test("a cap larger than the file is not padding", async () => {
    const source = sine(TONE_L, RATE, 500, 0.5)
    const path = writeFixture(
      "short.wav",
      buildWav({ samples: source, sampleRate: RATE, channels: 1, encoding: "f32" }),
    )

    const clip = await loadAudioClip(path, { maxFrames: 10_000 })
    expect(clip.frameCount).toBe(500)
  })
})

describe("decoding from memory", () => {
  test("decodeAudioClip matches loadAudioClip on the same bytes", async () => {
    const source = sine(TONE_L, RATE, FRAMES, 0.5)
    const bytes = buildWav({ samples: source, sampleRate: RATE, channels: 1, encoding: "s16" })
    const path = writeFixture("from-memory.wav", bytes)

    const fromFile = await loadAudioClip(path)
    const fromBytes = await decodeAudioClip(bytes)

    expect(fromBytes.sampleRate).toBe(fromFile.sampleRate)
    expect(fromBytes.frameCount).toBe(fromFile.frameCount)
    expect(maxAbsDiff(fromBytes.getSamples(), fromFile.getSamples())).toBe(0)
  })

  test("probing wins over a wrong hint", async () => {
    const source = sine(TONE_L, RATE, 1000, 0.5)
    const bytes = buildWav({ samples: source, sampleRate: RATE, channels: 1, encoding: "s16" })
    // The bytes are a WAV; claiming otherwise must not break the load, because
    // format detection is by content, with the hint only breaking ties.
    const clip = await decodeAudioClip(bytes, { hint: "flac" })
    expect(clip.frameCount).toBe(1000)
  })
})

describe("inspectAudioFile", () => {
  test("reports the container and codec without decoding", async () => {
    const source = sine(TONE_L, RATE, FRAMES, 0.5)
    const path = writeFixture(
      "inspect.wav",
      buildWav({ samples: source, sampleRate: RATE, channels: 2, encoding: "s16" }),
    )
    // A 2-channel file built from a mono buffer: half the frames, both channels
    // carrying alternating samples. Fine — this test is about the header.
    const info = await inspectAudioFile(path)

    expect(info.sampleRate).toBe(RATE)
    expect(info.channels).toBe(2)
    expect(info.container).toBe("wave")
    expect(info.codec).toBe("pcm_s16le")
    expect(info.bitsPerSample).toBe(16)
    expect(info.frameCount).toBe(FRAMES / 2)
    expect(info.duration).toBeCloseTo(FRAMES / 2 / RATE, 6)
  })
})

describe("failure modes", () => {
  test("a missing file rejects", async () => {
    await expect(loadAudioClip(join(OUT, "does-not-exist.wav"))).rejects.toThrow(
      /could not open/,
    )
  })

  test("bytes that are not audio reject rather than returning silence", async () => {
    const garbage = new Uint8Array(2048).fill(0x7f)
    await expect(decodeAudioClip(garbage)).rejects.toThrow(/could not determine the audio format/)
  })

  test("an empty buffer rejects", async () => {
    await expect(decodeAudioClip(new Uint8Array(0))).rejects.toThrow()
  })

  test("a truncated header rejects", async () => {
    const source = sine(TONE_L, RATE, FRAMES, 0.5)
    const full = buildWav({ samples: source, sampleRate: RATE, channels: 1, encoding: "s16" })
    await expect(decodeAudioClip(full.subarray(0, 20))).rejects.toThrow()
  })

  test("a truncated body keeps what decoded rather than failing", async () => {
    const source = sine(TONE_L, RATE, FRAMES, 0.5)
    const full = buildWav({ samples: source, sampleRate: RATE, channels: 1, encoding: "s16" })
    // Chop the data chunk in half. The header is intact and describes more data
    // than is present — a real-world truncated download. Salvaging the audible
    // part beats throwing away a file that is 90% fine.
    const half = full.subarray(0, 44 + FRAMES)
    const clip = await decodeAudioClip(half)
    expect(clip.frameCount).toBeGreaterThan(0)
    expect(clip.frameCount).toBeLessThan(FRAMES)
  })
})

describe("AudioClip.fromSamples", () => {
  test("builds a clip with no file involved", () => {
    const samples = sine(TONE_L, RATE, FRAMES, 0.25)
    const clip = AudioClip.fromSamples(samples, RATE, 1)

    expect(clip.sampleRate).toBe(RATE)
    expect(clip.channels).toBe(1)
    expect(clip.frameCount).toBe(FRAMES)
    expect(clip.peak).toBeCloseTo(0.25, 3)
    expect(maxAbsDiff(clip.getSamples(), samples)).toBe(0)
  })

  test("rejects a sample count that is not a whole number of frames", () => {
    expect(() => AudioClip.fromSamples(new Float32Array(5), RATE, 2)).toThrow(
      /not a multiple of the channel count/,
    )
  })

  test("rejects an impossible channel count", () => {
    expect(() => AudioClip.fromSamples(new Float32Array(4), RATE, 0)).toThrow(/channels/)
  })

  test("silence is silent and correctly sized", () => {
    const clip = AudioClip.silence(1000, RATE, 2)
    expect(clip.frameCount).toBe(1000)
    expect(clip.getSamples().length).toBe(2000)
    expect(peak(clip.getSamples())).toBe(0)
  })
})
