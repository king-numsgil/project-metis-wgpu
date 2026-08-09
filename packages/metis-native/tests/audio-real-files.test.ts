/**
 * Tier 2: a real file this repo did not author, in a codec it cannot fake.
 *
 * `audio-decode.test.ts` builds its own WAVs, which makes its assertions exact
 * but leaves the gap `gltf-samples.test.ts` exists to close for glTF: the
 * writer and the expectations were written by one person in one afternoon, so a
 * misreading of the format would be baked into both sides.
 *
 * The fixture is `psychronic-road-to-nowhere-264422.mp3`, a CC0 track committed
 * to `tests/assets/`. It closes two gaps at once:
 *
 *  - **A real encoder's output.** Nothing here made this file.
 *  - **A compressed codec.** MP3 is the one that matters most: it is lossy, so
 *    nothing round-trips sample-exactly, and it carries encoder delay and
 *    padding the decoder has to trim. None of that can be hand-authored, and
 *    none of it is reachable through the WAV fixtures.
 *
 * This replaced an earlier version that read WAVs out of `C:\Windows\Media`.
 * That worked, but only on Windows — everywhere else it skipped, so the tier-2
 * layer silently did not exist on a platform this project also targets. A
 * committed asset runs the same everywhere. The cost is 5.4 MB in the repo and
 * the loss of the several-sample-rate coverage those files happened to give;
 * `targetSampleRate` and the mixer's per-voice resampling cover rate conversion
 * instead.
 *
 * ## Assertion style
 *
 * Lossy, so no exact samples. Everything here is either structural (frame
 * counts, channel counts, determinism, prefix stability) or statistical
 * (`rms`, `peak`, per-channel comparison). That is not a weaker test, it is a
 * different one: the failures it catches — a truncated packet loop, a dropped
 * channel, a mis-trimmed delay — are all visible in those terms.
 */

import { beforeAll, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"

import { AudioClip, AudioMixer, inspectAudioFile, loadAudioClip } from "../index.js"
import { maxAbsDiff, peak, rms, stereo } from "./helpers/dsp.js"

const TRACK = join(import.meta.dir, "assets", "psychronic-road-to-nowhere-264422.mp3")

// The header's own numbers, pinned. If a decoder upgrade changes how delay and
// padding are trimmed these move — which is exactly the kind of change someone
// should have to look at rather than absorb silently.
const RATE = 48_000
const CHANNELS = 2
const FRAMES = 8_449_920

/** Ten seconds is plenty for content assertions and keeps the suite quick. */
const SLICE_FRAMES = RATE * 10

let slice: AudioClip

beforeAll(async () => {
  slice = await loadAudioClip(TRACK, { maxFrames: SLICE_FRAMES })
})

test("the fixture is committed", () => {
  // A plain failure, not a skip. Unlike the Windows-media version this
  // replaced, the file is in the repo — if it is missing, something is wrong
  // with the checkout, not with the platform.
  expect(existsSync(TRACK)).toBe(true)
})

describe("header", () => {
  test("reports the container and codec without decoding", async () => {
    const info = await inspectAudioFile(TRACK)

    expect(info.container).toBe("mp3")
    expect(info.codec).toBe("mp3")
    expect(info.sampleRate).toBe(RATE)
    expect(info.channels).toBe(CHANNELS)
    expect(info.frameCount).toBe(FRAMES)
    expect(info.duration).toBeCloseTo(FRAMES / RATE, 3)
  })

  test("a lossy codec reports no bits-per-sample", async () => {
    const info = await inspectAudioFile(TRACK)
    // Pins why `bitsPerSample` is optional: for MP3 the notion does not apply,
    // and inventing a number would be worse than omitting one. The WAV tests
    // pin the other half (16, for pcm_s16le).
    expect(info.bitsPerSample ?? null).toBeNull()
  })
})

describe("full decode", () => {
  test("decodes exactly as many frames as the header claims", async () => {
    // The strongest structural assertion available on a lossy stream. It fails
    // if the packet loop drops the tail, if encoder delay/padding is trimmed
    // inconsistently with the container's count, or if a mid-stream decode
    // error quietly ends the loop early.
    //
    // Deliberately does not call getSamples(): the full track is ~68 MB as f32,
    // and copying it across the boundary to look at nothing would be the
    // slowest thing in the suite.
    const full = await loadAudioClip(TRACK)
    expect(full.frameCount).toBe(FRAMES)
    expect(full.sampleRate).toBe(RATE)
    expect(full.channels).toBe(CHANNELS)
    expect(full.duration).toBeCloseTo(FRAMES / RATE, 3)
  }, 60_000)

  test("decoding twice gives identical samples", async () => {
    const a = await loadAudioClip(TRACK, { maxFrames: RATE })
    const b = await loadAudioClip(TRACK, { maxFrames: RATE })
    // Determinism is not free. A packet loop that read past a buffer, or reused
    // a scratch vector without clearing it, would produce plausible audio that
    // differed run to run.
    expect(maxAbsDiff(a.getSamples(), b.getSamples())).toBe(0)
  })

  test("a capped decode is a true prefix of a longer one", async () => {
    const short = await loadAudioClip(TRACK, { maxFrames: RATE })
    const shortSamples = short.getSamples()
    expect(short.frameCount).toBe(RATE)

    // Same bytes at the same positions. Catches a cap that lands mid-packet and
    // shifts everything after it — which would still produce the right count.
    const prefix = slice.getSamples().subarray(0, shortSamples.length)
    expect(maxAbsDiff(shortSamples, prefix)).toBe(0)
  })
})

describe("content", () => {
  test("decodes to real audio, not silence", () => {
    const samples = slice.getSamples()
    expect(samples.length).toBe(SLICE_FRAMES * CHANNELS)

    // The track fades in — the first second peaks around 0.03 — so the level
    // assertions look at the ten-second window rather than the opening, and sit
    // well below the real level so a re-encode of the fixture doesn't break
    // them.
    expect(peak(samples)).toBeGreaterThan(0.05)
    expect(rms(samples)).toBeGreaterThan(0.005)

    // In range, and no NaN from an under-read.
    expect(peak(samples)).toBeLessThanOrEqual(1.0)
    expect(samples.every((s) => Number.isFinite(s))).toBe(true)
  })

  test("the two channels carry a real stereo image", () => {
    const [l, r] = stereo(slice.getSamples())

    expect(rms(l)).toBeGreaterThan(0.005)
    expect(rms(r)).toBeGreaterThan(0.005)
    // Both channels alive but *not* identical. A decoder that duplicated one
    // channel into both, or read the same plane twice while de-interleaving,
    // passes every level check above and fails only this one.
    expect(maxAbsDiff(l, r)).toBeGreaterThan(0.001)
  })
})

describe("load options on real content", () => {
  test("forceMono collapses to one channel without losing level", async () => {
    const mono = await loadAudioClip(TRACK, { forceMono: true, maxFrames: SLICE_FRAMES })
    expect(mono.channels).toBe(1)
    expect(mono.frameCount).toBe(SLICE_FRAMES)

    // Averaging two correlated channels keeps roughly the original level.
    // Halving would mean the downmix divided by the wrong count; doubling would
    // mean it summed without dividing at all.
    const stereoRms = rms(slice.getSamples())
    const monoRms = rms(mono.getSamples())
    expect(monoRms).toBeGreaterThan(stereoRms * 0.5)
    expect(monoRms).toBeLessThan(stereoRms * 1.5)
  })

  test("targetSampleRate resamples and preserves duration", async () => {
    const down = await loadAudioClip(TRACK, {
      targetSampleRate: 24_000,
      maxFrames: SLICE_FRAMES,
    })
    expect(down.sampleRate).toBe(24_000)
    // maxFrames caps the decode *before* resampling, so ten seconds of source
    // becomes ten seconds at the new rate — half the frames, same duration.
    expect(down.frameCount).toBe(SLICE_FRAMES / 2)
    expect(down.duration).toBeCloseTo(10, 3)
    expect(peak(down.getSamples())).toBeGreaterThan(0.05)
  })
})

describe("playback through the mixer", () => {
  test("plays real compressed content at the mixer's own rate", () => {
    const mixer = new AudioMixer({ sampleRate: RATE, channels: 2 })
    const voice = mixer.play(slice)

    const out = mixer.renderFrames(RATE)
    expect(peak(out)).toBeGreaterThan(0.01)
    expect(out.every((s) => Number.isFinite(s))).toBe(true)
    expect(mixer.voiceTime(voice)).toBeCloseTo(1.0, 3)
  })

  test("plays through the per-voice resampler at a mismatched rate", () => {
    // A 48 kHz clip in a 44.1 kHz mixer — the fractional-step path, on real
    // content rather than a synthetic tone.
    const mixer = new AudioMixer({ sampleRate: 44_100, channels: 2 })
    const voice = mixer.play(slice)

    const out = mixer.renderFrames(44_100)
    expect(peak(out)).toBeGreaterThan(0.01)
    expect(out.every((s) => Number.isFinite(s))).toBe(true)
    // One second of output is one second of wall clock despite the rate
    // mismatch — that is what the resampling is for.
    expect(mixer.voiceTime(voice)).toBeCloseTo(1.0, 2)
  })
})
