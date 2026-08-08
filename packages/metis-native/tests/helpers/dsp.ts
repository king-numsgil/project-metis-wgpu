/**
 * Signal generation and analysis for the audio tests.
 *
 * The problem these solve: nobody running this suite can hear it, and the
 * failures that matter are inaudible-by-assertion anyway. A decoder that
 * swaps stereo channels, a mixer that pans the wrong way, a resampler that
 * shifts pitch — every one of them produces a buffer of exactly the right
 * length, full of plausible-looking floats. `expect(clip.frameCount)` is green
 * through all of them.
 *
 * So the tests assert on *content*: either sample-exact equality against
 * arithmetic done by hand, or the amount of energy at a specific frequency in
 * a specific channel. `goertzel` is what makes the second one cheap.
 *
 * ## Pick frequencies that fit the buffer
 *
 * Every helper here is exact when the analysed window holds a whole number of
 * cycles, and leaks a little when it doesn't. The fixtures therefore use
 * 480 Hz and 960 Hz at 48 kHz — 100 and 50 samples per cycle — so any buffer
 * length that is a multiple of 100 frames is an exact fit and the numbers come
 * out clean. If you add a fixture, keep that property; it is the difference
 * between asserting `> 0.9` and asserting `≈ 1.0`.
 */

/** A sine wave. Frequency in Hz, phase in radians. */
export function sine(
  freq: number,
  sampleRate: number,
  frames: number,
  amplitude = 1,
  phase = 0,
): Float32Array {
  const out = new Float32Array(frames)
  const w = (2 * Math.PI * freq) / sampleRate
  for (let i = 0; i < frames; i++) out[i] = amplitude * Math.sin(w * i + phase)
  return out
}

/** Interleave per-channel buffers into one frame-major buffer. */
export function interleave(channels: Float32Array[]): Float32Array {
  const n = channels.length
  const frames = channels[0]!.length
  for (const c of channels) {
    if (c.length !== frames) throw new Error("interleave: channels differ in length")
  }
  const out = new Float32Array(frames * n)
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < n; c++) out[f * n + c] = channels[c]![f]!
  }
  return out
}

/** Split a frame-major buffer back into one buffer per channel. */
export function deinterleave(samples: Float32Array, channels: number): Float32Array[] {
  const frames = Math.floor(samples.length / channels)
  const out: Float32Array[] = []
  for (let c = 0; c < channels; c++) {
    const ch = new Float32Array(frames)
    for (let f = 0; f < frames; f++) ch[f] = samples[f * channels + c]!
    out.push(ch)
  }
  return out
}

/**
 * The stereo case of `deinterleave`, as a tuple.
 *
 * Exists because `deinterleave` returns an array, and under
 * `noUncheckedIndexedAccess` destructuring one gives
 * `Float32Array | undefined` — which every panning assertion would then have to
 * launder with a `!`. The channel count is checked once, here.
 */
export function stereo(samples: Float32Array): [Float32Array, Float32Array] {
  const [left, right] = deinterleave(samples, 2)
  if (!left || !right) throw new Error("stereo: expected two channels")
  return [left, right]
}

/** Root mean square — the level of a signal, not its instantaneous value. */
export function rms(x: ArrayLike<number>): number {
  if (x.length === 0) return 0
  let sum = 0
  for (let i = 0; i < x.length; i++) sum += x[i]! * x[i]!
  return Math.sqrt(sum / x.length)
}

/** Largest absolute value. */
export function peak(x: ArrayLike<number>): number {
  let m = 0
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]!))
  return m
}

/** Largest absolute difference between two equal-length buffers. */
export function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) {
    throw new Error(`maxAbsDiff: length mismatch, ${a.length} vs ${b.length}`)
  }
  let m = 0
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!))
  return m
}

/**
 * Amplitude of one frequency component, via the Goertzel algorithm.
 *
 * Goertzel is a single-bin DFT: O(n) for one frequency, no FFT library, no
 * power-of-two length requirement. Exactly what these tests need — they always
 * know which frequency they are asking about.
 *
 * The return value is scaled to be directly comparable with the amplitude that
 * went in: a unit-amplitude sine at `freq` reads back ≈ 1.0.
 */
export function goertzel(x: ArrayLike<number>, sampleRate: number, freq: number): number {
  const n = x.length
  if (n === 0) return 0
  const w = (2 * Math.PI * freq) / sampleRate
  const cw = Math.cos(w)
  const coeff = 2 * cw

  let s1 = 0
  let s2 = 0
  for (let i = 0; i < n; i++) {
    const s0 = x[i]! + coeff * s1 - s2
    s2 = s1
    s1 = s0
  }
  const real = s1 - s2 * cw
  const imag = s2 * Math.sin(w)
  // 2/n converts the one-sided bin magnitude back to a peak amplitude.
  return (2 * Math.hypot(real, imag)) / n
}

/**
 * Which of `candidates` carries the most energy. Used to assert that a
 * resampled or rate-shifted signal landed on the pitch it should have, without
 * assuming anything about the ones it shouldn't.
 */
export function dominantFrequency(
  x: ArrayLike<number>,
  sampleRate: number,
  candidates: number[],
): number {
  let best = candidates[0]!
  let bestMag = -1
  for (const f of candidates) {
    const m = goertzel(x, sampleRate, f)
    if (m > bestMag) {
      bestMag = m
      best = f
    }
  }
  return best
}
