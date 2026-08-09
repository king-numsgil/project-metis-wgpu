/**
 * The mixer: voices in, interleaved frames out.
 *
 * This file is where "we can't hear it" stops being a problem. `renderFrames`
 * is a pure function of the mixer's state — no device, no thread, no timing —
 * so every assertion here is arithmetic that can be done by hand and compared
 * exactly. Gain, panning, summing and looping are all checked against numbers,
 * not impressions.
 *
 * The pan tests are the ones worth reading. Stereo placement is exactly the
 * kind of thing that "sounds fine" while being backwards, and a mixer that
 * pans the wrong way produces output with identical RMS, identical peak and
 * identical spectrum. Only asking *which channel* catches it.
 */

import { describe, expect, test } from "bun:test"

import { AudioClip, AudioMixer } from "../index.js"
import { goertzel, interleave, maxAbsDiff, peak, rms, sine, stereo } from "./helpers/dsp.js"

const RATE = 48_000
const TONE = 480
const FRAMES = 4_800

/** A mono clip of a known tone, at the mixer's own rate — so no resampling. */
function tone(amplitude = 1, frames = FRAMES, rate = RATE, freq = TONE): AudioClip {
  return AudioClip.fromSamples(sine(freq, rate, frames, amplitude), rate, 1)
}

/** A ramp 0,1,2,3,… — the easiest signal to check a playhead against. */
function ramp(frames: number, rate = RATE): AudioClip {
  const s = new Float32Array(frames)
  for (let i = 0; i < frames; i++) s[i] = i
  return AudioClip.fromSamples(s, rate, 1)
}

describe("construction", () => {
  test("defaults to 48 kHz stereo", () => {
    const m = new AudioMixer()
    expect(m.sampleRate).toBe(48_000)
    expect(m.channels).toBe(2)
    expect(m.activeVoices).toBe(0)
  })

  test("rejects an impossible configuration", () => {
    expect(() => new AudioMixer({ channels: 0 })).toThrow(/channels/)
    expect(() => new AudioMixer({ sampleRate: 10 })).toThrow(/sampleRate/)
  })

  test("an idle mixer renders exact silence", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 2 })
    const out = m.renderFrames(256)
    expect(out.length).toBe(512)
    expect(peak(out)).toBe(0)
    expect(m.framesRendered).toBe(256)
  })
})

describe("playback", () => {
  test("a mono clip in a mono mixer is sample-exact", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 1 })
    const source = sine(TONE, RATE, FRAMES, 0.5)
    m.play(AudioClip.fromSamples(source, RATE, 1))

    const out = m.renderFrames(FRAMES)
    // Matching rates, unit playback rate, gain 1, mono→mono: the mixer has no
    // arithmetic to do here, and anything it does anyway shows up as a nonzero
    // difference.
    expect(maxAbsDiff(out, source)).toBe(0)
  })

  test("gain scales exactly", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 1 })
    const source = sine(TONE, RATE, FRAMES, 0.5)
    m.play(AudioClip.fromSamples(source, RATE, 1), { gain: 0.25 })

    const out = m.renderFrames(FRAMES)
    for (let i = 0; i < FRAMES; i++) {
      expect(out[i]).toBeCloseTo(source[i]! * 0.25, 6)
    }
  })

  test("masterGain applies on top of voice gain", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 1 })
    const source = sine(TONE, RATE, FRAMES, 0.5)
    m.play(AudioClip.fromSamples(source, RATE, 1), { gain: 0.5 })
    m.masterGain = 0.5

    const out = m.renderFrames(FRAMES)
    expect(rms(out)).toBeCloseTo(rms(source) * 0.25, 5)
  })

  test("two voices sum", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 1 })
    const a = sine(TONE, RATE, FRAMES, 0.3)
    const b = sine(TONE * 2, RATE, FRAMES, 0.2)
    m.play(AudioClip.fromSamples(a, RATE, 1))
    m.play(AudioClip.fromSamples(b, RATE, 1))

    const out = m.renderFrames(FRAMES)
    // Both tones present at their own amplitudes — a mixer that averaged
    // instead of summing would show each at half.
    expect(goertzel(out, RATE, TONE)).toBeCloseTo(0.3, 3)
    expect(goertzel(out, RATE, TONE * 2)).toBeCloseTo(0.2, 3)
    for (let i = 0; i < FRAMES; i++) expect(out[i]).toBeCloseTo(a[i]! + b[i]!, 5)
  })

  test("output is not clamped — a deliberate choice, pinned so it stays one", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 1 })
    const loud = AudioClip.fromSamples(new Float32Array(64).fill(0.9), RATE, 1)
    m.play(loud)
    m.play(loud)

    const out = m.renderFrames(64)
    // 1.8, not 1.0. A limiter here would make every exact-value assertion in
    // this file a test of the limiter's curve instead of the mixer's sum.
    expect(out[0]).toBeCloseTo(1.8, 5)
  })
})

describe("panning", () => {
  const centreGain = Math.SQRT1_2 // -3 dB, constant power

  test("a mono voice at centre is equal and constant-power", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 2 })
    m.play(tone(1.0, 1000))

    const [l, r] = stereo(m.renderFrames(1000))
    expect(maxAbsDiff(l, r)).toBe(0)
    expect(peak(l)).toBeCloseTo(centreGain, 3)
  })

  test("pan -1 is hard left and pan +1 is hard right", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 2 })
    const left = m.play(tone(1.0, 1000), { pan: -1 })
    expect(left).toBeGreaterThan(0)

    const [l, r] = stereo(m.renderFrames(1000))
    expect(peak(l)).toBeCloseTo(1.0, 3)
    // Not exactly zero: cos/sin of π/2 leaves a float epsilon. Anything above
    // this would be an actual leak across the field.
    expect(peak(r)).toBeLessThan(1e-6)

    const m2 = new AudioMixer({ sampleRate: RATE, channels: 2 })
    m2.play(tone(1.0, 1000), { pan: 1 })
    const [l2, r2] = stereo(m2.renderFrames(1000))
    expect(peak(r2)).toBeCloseTo(1.0, 3)
    expect(peak(l2)).toBeLessThan(1e-6)
  })

  test("panning is monotonic across the field", () => {
    const lefts: number[] = []
    for (const pan of [-1, -0.5, 0, 0.5, 1]) {
      const m = new AudioMixer({ sampleRate: RATE, channels: 2 })
      m.play(tone(1.0, 1000), { pan })
      lefts.push(peak(stereo(m.renderFrames(1000))[0]))
    }
    for (let i = 1; i < lefts.length; i++) {
      expect(lefts[i]).toBeLessThan(lefts[i - 1]!)
    }
  })

  test("setVoicePan takes effect on the next render", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 2 })
    const v = m.play(tone(1.0, 4000), { pan: -1 })

    const first = stereo(m.renderFrames(1000))
    expect(peak(first[1])).toBeLessThan(1e-6)

    expect(m.setVoicePan(v, 1)).toBe(true)
    const second = stereo(m.renderFrames(1000))
    expect(peak(second[0])).toBeLessThan(1e-6)
    expect(peak(second[1])).toBeCloseTo(1.0, 3)
  })

  test("setVoicePan on a dead voice reports failure instead of throwing", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 2 })
    expect(m.setVoicePan(999, 0)).toBe(false)
    expect(m.setVoiceGain(999, 1)).toBe(false)
  })

  /**
   * The asymmetry documented in `mixer.rs`: a mono source is *placed* (centre
   * is -3 dB, constant power as it sweeps), a stereo source is *balanced*
   * (centre is unity, so a music file plays back at the level it was authored).
   * Both are pinned because "stereo playback is quieter than the file" is the
   * bug this asymmetry exists to prevent, and a future simplification to one
   * rule would reintroduce it silently.
   */
  test("a stereo voice at centre passes through at unity", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 2 })
    const l = sine(TONE, RATE, 1000, 0.6)
    const r = sine(TONE * 2, RATE, 1000, 0.4)
    m.play(AudioClip.fromSamples(interleave([l, r]), RATE, 2))

    const [outL, outR] = stereo(m.renderFrames(1000))
    expect(maxAbsDiff(outL, l)).toBeLessThan(1e-6)
    expect(maxAbsDiff(outR, r)).toBeLessThan(1e-6)
  })

  test("a stereo voice keeps its channels apart", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 2 })
    const l = sine(TONE, RATE, FRAMES, 0.6)
    const r = sine(TONE * 2, RATE, FRAMES, 0.4)
    m.play(AudioClip.fromSamples(interleave([l, r]), RATE, 2))

    const [outL, outR] = stereo(m.renderFrames(FRAMES))
    expect(goertzel(outL, RATE, TONE)).toBeCloseTo(0.6, 2)
    expect(goertzel(outL, RATE, TONE * 2)).toBeLessThan(0.01)
    expect(goertzel(outR, RATE, TONE * 2)).toBeCloseTo(0.4, 2)
    expect(goertzel(outR, RATE, TONE)).toBeLessThan(0.01)
  })

  test("pan is ignored on a mono mixer rather than halving the level", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 1 })
    m.play(tone(1.0, 1000), { pan: -1 })
    expect(peak(m.renderFrames(1000))).toBeCloseTo(1.0, 3)
  })
})

describe("voice lifecycle", () => {
  test("a voice ends when its clip does, and its ID stops resolving", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 1 })
    const v = m.play(tone(1.0, 100))
    expect(m.isVoiceActive(v)).toBe(true)
    expect(m.activeVoices).toBe(1)

    m.renderFrames(50)
    expect(m.isVoiceActive(v)).toBe(true)

    m.renderFrames(60)
    expect(m.isVoiceActive(v)).toBe(false)
    expect(m.activeVoices).toBe(0)

    // And nothing lingers to be heard afterwards.
    expect(peak(m.renderFrames(100))).toBe(0)
  })

  test("IDs are never reused, so a stale ID is unambiguous", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 1 })
    const first = m.play(tone(1.0, 10))
    m.renderFrames(20)
    const second = m.play(tone(1.0, 10))
    expect(second).not.toBe(first)
    expect(m.isVoiceActive(first)).toBe(false)
    expect(m.isVoiceActive(second)).toBe(true)
  })

  test("stop silences a voice immediately", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 1 })
    const v = m.play(tone(1.0, FRAMES))
    expect(peak(m.renderFrames(100))).toBeGreaterThan(0)

    expect(m.stop(v)).toBe(true)
    expect(peak(m.renderFrames(100))).toBe(0)
    // Stopping twice is a no-op, not an error.
    expect(m.stop(v)).toBe(false)
  })

  test("stopAll clears every voice", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 1 })
    m.play(tone(1.0, FRAMES))
    m.play(tone(1.0, FRAMES))
    expect(m.activeVoices).toBe(2)
    m.stopAll()
    expect(m.activeVoices).toBe(0)
    expect(peak(m.renderFrames(100))).toBe(0)
  })

  test("voiceTime tracks the playhead", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 1 })
    // Long enough that the voice is still alive after the render — a clip
    // exactly as long as the render would have ended, and `voiceTime` correctly
    // reports null for a voice that no longer exists.
    const v = m.play(tone(1.0, FRAMES * 2))
    expect(m.voiceTime(v)).toBe(0)
    m.renderFrames(RATE / 10)
    expect(m.voiceTime(v)).toBeCloseTo(0.1, 6)
    expect(m.voiceTime(9999)).toBeNull()
  })

  test("seekVoice moves the playhead, forwards and backwards", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 1 })
    const v = m.play(ramp(1000))

    expect(m.seekVoice(v, 500 / RATE)).toBe(true)
    let out = m.renderFrames(4)
    expect(out[0]).toBeCloseTo(500, 3)

    // Backwards too — a seek that only ever moved forward would pass a
    // scrub-to-the-right test and fail every rewind.
    expect(m.seekVoice(v, 100 / RATE)).toBe(true)
    out = m.renderFrames(4)
    expect(out[0]).toBeCloseTo(100, 3)

    expect(m.voiceTime(v)).toBeCloseTo(104 / RATE, 6)
  })

  test("seekVoice clamps rather than reading out of bounds", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 1 })
    const v = m.play(ramp(1000))

    // Negative clamps to the start.
    expect(m.seekVoice(v, -5)).toBe(true)
    expect(m.voiceTime(v)).toBe(0)

    // Past the end parks at the end, and the voice is reaped on the next
    // render — "seek to the end" and "finished" being the same thing.
    expect(m.seekVoice(v, 999)).toBe(true)
    expect(peak(m.renderFrames(16))).toBe(0)
    expect(m.isVoiceActive(v)).toBe(false)
  })

  test("seeking a looping voice wraps", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 1 })
    const v = m.play(ramp(100), { loop: true })

    // 250 frames into a 100-frame loop is frame 50, not the end.
    expect(m.seekVoice(v, 250 / RATE)).toBe(true)
    const out = m.renderFrames(4)
    expect(out[0]).toBeCloseTo(50, 3)
    expect(m.isVoiceActive(v)).toBe(true)
  })

  test("seekVoice reports failure on a dead voice and rejects nonsense", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 1 })
    const v = m.play(ramp(100))
    expect(m.seekVoice(999, 0)).toBe(false)
    expect(m.seekVoice(v, Number.NaN)).toBe(false)
    expect(m.seekVoice(v, Number.POSITIVE_INFINITY)).toBe(false)
  })

  test("startTime skips into the clip", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 1 })
    m.play(ramp(1000), { startTime: 100 / RATE })
    const out = m.renderFrames(10)
    expect(out[0]).toBeCloseTo(100, 4)
    expect(out[9]).toBeCloseTo(109, 4)
  })

  /**
   * The `Arc` in `ClipData` earns its keep here. If a voice held a borrow of
   * the JS handle instead of a reference to the samples, dropping the handle
   * mid-playback would be a use-after-free — and one that would usually *look*
   * fine, because freed memory often still holds the old samples.
   */
  test("a voice keeps playing after JS drops the clip", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 1 })
    const expected = sine(TONE, RATE, 2000, 0.5)
    {
      const clip = AudioClip.fromSamples(expected, RATE, 1)
      m.play(clip)
    }
    Bun.gc(true)

    const out = m.renderFrames(2000)
    expect(maxAbsDiff(out, expected)).toBe(0)
  })
})

describe("looping", () => {
  test("a looping voice repeats exactly and never ends", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 1 })
    const v = m.play(ramp(100), { loop: true })

    const out = m.renderFrames(250)
    for (let i = 0; i < 250; i++) {
      expect(out[i]).toBeCloseTo(i % 100, 3)
    }
    expect(m.isVoiceActive(v)).toBe(true)
  })

  test("a non-looping voice stops at the end instead of wrapping", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 1 })
    m.play(ramp(100))

    const out = m.renderFrames(150)
    expect(out[99]).toBeCloseTo(99, 3)
    for (let i = 100; i < 150; i++) expect(out[i]).toBe(0)
  })

  test("looping survives a render boundary landing mid-clip", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 1 })
    m.play(ramp(100), { loop: true })

    // Three renders whose boundaries fall at 70, 140, 210 — none on a loop
    // point. A reset-to-zero-per-buffer bug passes the aligned case and fails
    // this one.
    const a = m.renderFrames(70)
    const b = m.renderFrames(70)
    const c = m.renderFrames(70)
    const all = new Float32Array(210)
    all.set(a, 0)
    all.set(b, 70)
    all.set(c, 140)
    for (let i = 0; i < 210; i++) expect(all[i]).toBeCloseTo(i % 100, 3)
  })
})

describe("rate and resampling", () => {
  test("a clip at half the mixer's rate keeps its pitch and doubles in length", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 1 })
    // 480 Hz sampled at 24 kHz. Played through a 48 kHz mixer it must still be
    // 480 Hz — if the mixer ignored the clip's rate it would come out at 960.
    m.play(tone(0.8, FRAMES, RATE / 2, TONE))

    const out = m.renderFrames(FRAMES * 2)
    expect(goertzel(out, RATE, TONE)).toBeCloseTo(0.8, 1)
    expect(goertzel(out, RATE, TONE * 2)).toBeLessThan(0.05)
  })

  test("rate 2 doubles the pitch and halves the duration", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 1 })
    const v = m.play(tone(0.8, FRAMES), { rate: 2 })

    const out = m.renderFrames(FRAMES / 2)
    expect(goertzel(out, RATE, TONE * 2)).toBeCloseTo(0.8, 1)
    expect(m.isVoiceActive(v)).toBe(false)
  })

  test("rate 0.5 halves the pitch", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 1 })
    m.play(tone(0.8, FRAMES), { rate: 0.5 })
    const out = m.renderFrames(FRAMES)
    expect(goertzel(out, RATE, TONE / 2)).toBeCloseTo(0.8, 1)
  })

  test("a nonsensical rate is rejected at play time", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 1 })
    const clip = tone(1.0, 100)
    expect(() => m.play(clip, { rate: 0 })).toThrow(/rate/)
    expect(() => m.play(clip, { rate: -1 })).toThrow(/rate/)
    expect(() => m.play(clip, { rate: Number.NaN })).toThrow(/rate/)
    expect(() => m.play(clip, { gain: Number.POSITIVE_INFINITY })).toThrow(/finite/)
  })
})

describe("guards", () => {
  test("an absurd frame count is refused rather than allocated", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 2 })
    expect(() => m.renderFrames(1 << 30)).toThrow(/limit/)
  })

  test("masterGain rejects a non-finite value", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 2 })
    expect(() => {
      m.masterGain = Number.NaN
    }).toThrow(/finite/)
  })

  test("framesRendered accumulates across calls", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 2 })
    m.renderFrames(100)
    m.renderFrames(50)
    expect(m.framesRendered).toBe(150)
  })
})
