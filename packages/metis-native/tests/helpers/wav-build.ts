/**
 * A minimal WAV writer, so the decode tests can build their own fixtures.
 *
 * Same reasoning as `gltf-build.ts` and the inline KTX2 writer: a fixture built
 * byte by byte in the test needs no committed binary, and — more usefully —
 * every sample in it is a value the test computed, so the assertion can be
 * "these are the exact samples I encoded" rather than "this looks like audio".
 *
 * It covers the four PCM flavours symphonia's `pcm` codec decodes from a RIFF
 * container: unsigned 8-bit, signed 16/24-bit, and 32-bit float. Between them
 * they exercise every sample-conversion path into `AudioClip`'s f32, which is
 * where an off-by-a-half-LSB or a sign-extension bug would live.
 *
 * ## The known limitation, and why it is fine
 *
 * These are *self-authored* fixtures: this writer and the assertions agree
 * because the same person wrote both in the same afternoon — the exact trap
 * `gltf-samples.test.ts` exists to escape. A misreading of the WAV spec would
 * be baked into both sides. What saves it here is that the *decoder* is
 * symphonia, which was not written to make these tests pass; if this writer
 * emitted a malformed header, symphonia would reject it rather than agree
 * with it.
 *
 * The gap that remains is the compressed codecs (FLAC, MP3, Vorbis, AAC),
 * which cannot be hand-authored. See `generate-audio-fixtures.ts`.
 */

export type WavEncoding = "u8" | "s16" | "s24" | "f32"

const BITS: Record<WavEncoding, number> = { u8: 8, s16: 16, s24: 24, f32: 32 }

/** WAVE format tags: 1 = integer PCM, 3 = IEEE float. */
const FORMAT_TAG: Record<WavEncoding, number> = { u8: 1, s16: 1, s24: 1, f32: 3 }

export interface WavOptions {
  /** Interleaved samples, nominally in [-1, 1]. */
  samples: Float32Array
  sampleRate: number
  channels: number
  encoding: WavEncoding
}

/**
 * Quantise one float sample to the target encoding.
 *
 * **Scale by `2^(bits-1)`, not `2^(bits-1) - 1`,** and clamp. That asymmetry is
 * the actual PCM convention — two's complement has one more negative code than
 * positive, so -1.0 lands exactly on the negative rail and +1.0 clamps one code
 * short of the positive one. Unsigned 8-bit is the same mapping biased by 128.
 *
 * This is not a detail to eyeball. It was got wrong here first (a `127.5` scale
 * for u8), and the symptom was a round-trip error of 0.0085 against a tolerance
 * of 0.0078 — close enough to look like ordinary rounding noise rather than a
 * mismatched convention. It was settled by feeding known byte values through
 * the decoder and reading off the mapping: symphonia produces exactly
 * `(u - 128) / 128`. If you touch this, re-run that probe rather than
 * reasoning about it.
 */
function quantise(v: number, encoding: WavEncoding): number {
  const clamped = Math.max(-1, Math.min(1, v))
  switch (encoding) {
    case "u8":
      return Math.max(0, Math.min(255, Math.round(clamped * 128) + 128))
    case "s16":
      return Math.max(-32768, Math.min(32767, Math.round(clamped * 32768)))
    case "s24":
      return Math.max(-8388608, Math.min(8388607, Math.round(clamped * 8388608)))
    case "f32":
      return v
  }
}

/** Build a complete `.wav` file in memory. */
export function buildWav(options: WavOptions): Uint8Array {
  const { samples, sampleRate, channels, encoding } = options
  if (channels < 1) throw new Error("buildWav: channels must be >= 1")
  if (samples.length % channels !== 0) {
    throw new Error(
      `buildWav: ${samples.length} samples is not a whole number of ${channels}-channel frames`,
    )
  }

  const bits = BITS[encoding]
  const bytesPerSample = bits / 8
  const blockAlign = channels * bytesPerSample
  const dataBytes = samples.length * bytesPerSample
  // RIFF header (12) + fmt chunk (8 + 16) + data chunk header (8).
  const headerBytes = 44
  const buf = new Uint8Array(headerBytes + dataBytes)
  const view = new DataView(buf.buffer)

  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) buf[offset + i] = s.charCodeAt(i)
  }

  ascii(0, "RIFF")
  view.setUint32(4, headerBytes - 8 + dataBytes, true)
  ascii(8, "WAVE")

  ascii(12, "fmt ")
  view.setUint32(16, 16, true) // PCM fmt chunk size
  view.setUint16(20, FORMAT_TAG[encoding], true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true) // byte rate
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bits, true)

  ascii(36, "data")
  view.setUint32(40, dataBytes, true)

  let o = headerBytes
  for (let i = 0; i < samples.length; i++) {
    const q = quantise(samples[i]!, encoding)
    switch (encoding) {
      case "u8":
        view.setUint8(o, q)
        break
      case "s16":
        view.setInt16(o, q, true)
        break
      case "s24": {
        // No setInt24 — write the low three bytes of the two's-complement
        // value, little-endian.
        const u = q < 0 ? q + 0x1000000 : q
        view.setUint8(o, u & 0xff)
        view.setUint8(o + 1, (u >> 8) & 0xff)
        view.setUint8(o + 2, (u >> 16) & 0xff)
        break
      }
      case "f32":
        view.setFloat32(o, q, true)
        break
    }
    o += bytesPerSample
  }

  return buf
}

/**
 * The quantisation error to expect back from a round trip through `encoding`.
 *
 * One full code step: rounding costs half a step, and a sample at the positive
 * rail costs another half when it clamps. `f32` is lossless in range, so its
 * tolerance is a float-rounding epsilon rather than a quantisation step.
 */
export function quantisationTolerance(encoding: WavEncoding): number {
  switch (encoding) {
    case "u8":
      return 1 / 128
    case "s16":
      return 1 / 32768
    case "s24":
      return 1 / 8388608
    case "f32":
      return 1e-7
  }
}
