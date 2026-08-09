/**
 * HRTF binaural spatialisation (Steam Audio).
 *
 * ## How you test 3D audio without ears
 *
 * Localisation is not "louder on one side" — that is panning, and the mixer
 * already did it. Real binaural rendering produces two independent, measurable
 * signatures, and this file asserts both:
 *
 *  - **ILD**, an interaural *level* difference. Panning has this too, so on its
 *    own it proves nothing.
 *  - **ITD**, an interaural *time* difference: the sound reaches the near ear
 *    first, by up to ~700 µs (about 33 samples at 48 kHz). **Panning produces a
 *    lag of exactly zero.** This is the assertion that distinguishes a real HRTF
 *    from a volume knob, and it is the reason this file exists.
 *
 * The stimulus is white noise, not a tone, and that is load-bearing: a periodic
 * signal only determines lag modulo its period, so a tone would make the ITD
 * measurement meaningless. The same mistake produced a bogus reading when
 * measuring AAC's encoder delay — see `audio-codecs.test.ts`.
 *
 * ## What is deliberately not asserted
 *
 * That a front source is *exactly* symmetric between the ears. It isn't:
 * measured HRTFs come from real heads, which are not symmetric, and this one
 * reads about 0.14 vs 0.18. Asserting symmetry would be asserting a property of
 * an idealisation rather than of the data.
 */

import { beforeAll, describe, expect, test } from "bun:test"

import { AudioClip, AudioMixer } from "../index.js"
import { crossCorrelationLag, noise, rms, stereo } from "./helpers/dsp.js"

const RATE = 48_000
/** Long enough for a stable correlation, short enough to stay quick. */
const FRAMES = RATE

let source: AudioClip

beforeAll(() => {
  source = AudioClip.fromSamples(noise(FRAMES, 12_345, 0.5), RATE, 1)
})

/**
 * Render a source at `position` and return the two ear signals, skipping the
 * first block so the effect's startup transient is not measured.
 */
function renderAt(
  position: [number, number, number],
  options: { refDistance?: number } = {},
): { left: Float32Array; right: Float32Array; errors: number } {
  const mixer = new AudioMixer({ sampleRate: RATE, channels: 2 })
  mixer.setListener({ position: [0, 0, 0], forward: [0, 0, -1], up: [0, 1, 0] })
  mixer.playSpatial(source, { position, refDistance: options.refDistance ?? 1 })

  const out = mixer.renderFrames(8192)
  const [l, r] = stereo(out)
  return {
    left: l.subarray(2048, 6144),
    right: r.subarray(2048, 6144),
    errors: Number(mixer.spatialErrors),
  }
}

describe("the measurement helper itself", () => {
  test("crossCorrelationLag recovers a known delay", () => {
    // Guarding the instrument before trusting its readings. A helper that
    // returned 0 unconditionally would make every ITD assertion below vacuous.
    const a = noise(4096, 99)
    const delayed = new Float32Array(4096)
    for (let i = 20; i < 4096; i++) delayed[i] = a[i - 20]!
    expect(crossCorrelationLag(a, delayed, 64)).toBe(20)
  })
})

describe("interaural time difference", () => {
  test("a source on the right reaches the right ear first", () => {
    const { left, right, errors } = renderAt([3, 0, 0])
    expect(errors).toBe(0)

    // Negative lag: the right channel leads the left.
    const lag = crossCorrelationLag(left, right, 64)
    expect(lag).toBeLessThan(-20)
    // A human head is ~700 µs across at most, so anything beyond ~40 samples at
    // 48 kHz would be non-physical and suggests a units bug rather than an HRTF.
    expect(lag).toBeGreaterThan(-45)
  })

  test("a source on the left is the mirror image", () => {
    const { left, right } = renderAt([-3, 0, 0])
    const lag = crossCorrelationLag(left, right, 64)
    expect(lag).toBeGreaterThan(20)
    expect(lag).toBeLessThan(45)
  })

  test("a source straight ahead arrives at both ears together", () => {
    const { left, right } = renderAt([0, 0, -3])
    // The assertion that would fail if direction were being ignored *and* the
    // one that fails if the coordinate convention is wrong — a "front" source
    // interpreted as off-axis would show a lag here.
    expect(Math.abs(crossCorrelationLag(left, right, 64))).toBeLessThanOrEqual(3)
  })
})

describe("interaural level difference", () => {
  test("the near ear is louder, and the far ear much quieter", () => {
    const { left, right } = renderAt([3, 0, 0])
    expect(rms(right)).toBeGreaterThan(rms(left) * 3)
  })

  test("left and right are mirror images of each other", () => {
    const r = renderAt([3, 0, 0])
    const l = renderAt([-3, 0, 0])
    // Not a symmetry assumption about the HRTF — a comparison of one placement
    // against its own mirror, which must match even for an asymmetric head.
    expect(rms(l.left)).toBeCloseTo(rms(r.right), 2)
    expect(rms(l.right)).toBeCloseTo(rms(r.left), 2)
  })
})

describe("distance", () => {
  test("level falls as the inverse of distance", () => {
    const near = renderAt([3, 0, 0], { refDistance: 1 })
    const far = renderAt([30, 0, 0], { refDistance: 1 })
    // Ten times the distance, one tenth the level.
    expect(rms(far.right)).toBeCloseTo(rms(near.right) / 10, 2)
  })

  test("inside refDistance there is no boost", () => {
    const atRef = renderAt([0, 0, -1], { refDistance: 1 })
    const inside = renderAt([0, 0, -0.25], { refDistance: 1 })
    // Attenuation is clamped, so walking into a source does not produce
    // unbounded gain — the failure mode of a naive 1/d.
    expect(rms(inside.left)).toBeCloseTo(rms(atRef.left), 3)
  })
})

describe("listener orientation", () => {
  test("turning the listener moves the image the other way", () => {
    const mixer = new AudioMixer({ sampleRate: RATE, channels: 2 })
    // Source ahead, but the listener faces +X — so the source is now on the
    // listener's *left*. This is what makes the direction listener-relative
    // rather than world-absolute; a bug here would ignore `forward` entirely.
    mixer.setListener({ position: [0, 0, 0], forward: [1, 0, 0], up: [0, 1, 0] })
    mixer.playSpatial(source, { position: [0, 0, -3] })

    const [l, r] = stereo(mixer.renderFrames(8192))
    expect(rms(l.subarray(2048))).toBeGreaterThan(rms(r.subarray(2048)) * 3)
  })
})

describe("integration with the rest of the mixer", () => {
  test("a spatial voice behaves like any other voice", () => {
    const mixer = new AudioMixer({ sampleRate: RATE, channels: 2 })
    const v = mixer.playSpatial(source, { position: [1, 0, 0] })

    expect(mixer.spatialActive).toBe(true)
    expect(mixer.isVoiceActive(v)).toBe(true)
    expect(mixer.activeVoices).toBe(1)

    mixer.renderFrames(4096)
    expect(mixer.setVoicePosition(v, -1, 0, 0)).toBe(true)
    expect(mixer.stop(v)).toBe(true)
    expect(mixer.isVoiceActive(v)).toBe(false)
  })

  test("spatial and ordinary voices mix together", () => {
    const mixer = new AudioMixer({ sampleRate: RATE, channels: 2 })
    mixer.playSpatial(source, { position: [3, 0, 0] })
    mixer.play(source, { pan: -1 })

    const [l, r] = stereo(mixer.renderFrames(4096))
    // The panned voice feeds the left, the spatial one mostly the right. Both
    // present means the two code paths in `render_into` are additive rather
    // than one overwriting the other's output.
    expect(rms(l.subarray(2048))).toBeGreaterThan(0.01)
    expect(rms(r.subarray(2048))).toBeGreaterThan(0.01)
  })

  test("a spatial voice ends, and its tail is not cut off", () => {
    const short = AudioClip.fromSamples(noise(2000, 7, 0.5), RATE, 1)
    const mixer = new AudioMixer({ sampleRate: RATE, channels: 2 })
    const v = mixer.playSpatial(short, { position: [1, 0, 0] })

    // The clip is 2000 frames but the HRTF runs in 1024-sample blocks, so the
    // voice must survive past the clip's own length to drain the convolution
    // tail. Reaping it on `pos >= frames` would clip the end off.
    mixer.renderFrames(2048)
    expect(mixer.isVoiceActive(v)).toBe(true)

    mixer.renderFrames(8192)
    expect(mixer.isVoiceActive(v)).toBe(false)
    expect(Number(mixer.spatialErrors)).toBe(0)
  })

  test("rendering is deterministic", () => {
    const a = renderAt([2, 1, -1])
    const b = renderAt([2, 1, -1])
    expect(rms(a.left)).toBe(rms(b.left))
    expect(rms(a.right)).toBe(rms(b.right))
  })
})

describe("rejections", () => {
  test("a stereo clip is refused rather than silently downmixed", () => {
    const st = AudioClip.fromSamples(new Float32Array(2000), RATE, 2)
    const mixer = new AudioMixer({ sampleRate: RATE, channels: 2 })
    expect(() => mixer.playSpatial(st, { position: [1, 0, 0] })).toThrow(/mono clip/)
  })

  test("a mono mixer is refused", () => {
    const mixer = new AudioMixer({ sampleRate: RATE, channels: 1 })
    expect(() => mixer.playSpatial(source, { position: [1, 0, 0] })).toThrow(/stereo mixer/)
  })

  test("an unsupported sample rate is refused with the reason", () => {
    const mixer = new AudioMixer({ sampleRate: 32_000, channels: 2 })
    expect(() => mixer.playSpatial(source, { position: [1, 0, 0] })).toThrow(/44100 or 48000/)
  })

  test("a malformed position is refused", () => {
    const mixer = new AudioMixer({ sampleRate: RATE, channels: 2 })
    expect(() => mixer.playSpatial(source, { position: [1, 0] })).toThrow(/three finite numbers/)
    expect(() => mixer.playSpatial(source, { position: [1, 0, Number.NaN] })).toThrow(/finite/)
    expect(() => mixer.setListener({ forward: [1, 2] })).toThrow(/three finite numbers/)
  })

  test("setVoicePosition on a non-spatial voice reports failure", () => {
    const mixer = new AudioMixer({ sampleRate: RATE, channels: 2 })
    const v = mixer.play(source)
    expect(mixer.setVoicePosition(v, 1, 0, 0)).toBe(false)
    expect(mixer.setVoicePosition(9999, 1, 0, 0)).toBe(false)
  })
})
