/**
 * The SDL side: drivers, devices, streams, and the audio callback.
 *
 * ## How this runs on a machine with no speakers
 *
 * Two independent tricks, and both are worth knowing because they cover
 * different failures:
 *
 * 1. **SDL's `dummy` audio driver.** Selected with a hint before `sdlInit`, it
 *    provides a real logical device that consumes frames into nothing. That
 *    exercises device enumeration, opening, binding, pause/resume and teardown
 *    — everything except whether a sound card exists.
 *
 * 2. **`AudioMixer.openCapture()`.** This builds the *production* audio path —
 *    the same `SDL_AudioStream`, the same C callback, the same mixing code —
 *    and simply binds no device. Pulling frames out of it drives the callback
 *    exactly as a device would, so the frames can be compared against
 *    `renderFrames`. If the callback plumbing breaks, this fails with a number,
 *    not with silence nobody notices.
 *
 * The second is the one that makes the whole audio path testable rather than
 * merely smoke-tested. `capture()` and `renderFrames()` reaching the same
 * `render_into` by different routes is the property under test; if they ever
 * disagree, one of the two paths is lying.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"

import {
  AudioClip,
  AudioMixer,
  SdlAudioFormat,
  SdlInitFlag,
  sdlCreateAudioStream,
  sdlGetAudioDrivers,
  sdlGetAudioPlaybackDevices,
  sdlGetAudioRecordingDevices,
  sdlGetCurrentAudioDriver,
  sdlInit,
  sdlQuit,
  sdlSetHint,
} from "../index.js"

import { goertzel, interleave, maxAbsDiff, peak, sine, stereo } from "./helpers/dsp.js"

const RATE = 48_000
const TONE = 480

beforeAll(() => {
  // Must be set before the audio subsystem starts — SDL reads it while
  // choosing a backend, and changing it afterwards does nothing.
  sdlSetHint("SDL_AUDIO_DRIVER", "dummy")
  sdlInit(SdlInitFlag.Audio)
})

afterAll(() => {
  sdlQuit()
})

function toneClip(amplitude = 0.5, frames = 4800): AudioClip {
  return AudioClip.fromSamples(sine(TONE, RATE, frames, amplitude), RATE, 1)
}

describe("drivers", () => {
  test("the build ships several drivers, including dummy", () => {
    const drivers = sdlGetAudioDrivers()
    expect(drivers.length).toBeGreaterThan(0)
    expect(drivers).toContain("dummy")
  })

  test("the hint selected the driver we asked for", () => {
    expect(sdlGetCurrentAudioDriver()).toBe("dummy")
  })
})

describe("device enumeration", () => {
  test("the dummy driver offers a playback device with a sane format", () => {
    const devices = sdlGetAudioPlaybackDevices()
    expect(devices.length).toBeGreaterThan(0)

    const d = devices[0]!
    expect(d.id).toBeGreaterThan(0)
    expect(typeof d.name).toBe("string")
    expect(d.format.channels).toBeGreaterThan(0)
    expect(d.format.freq).toBeGreaterThan(0)
    expect(d.format.format).toContain("SDL_AUDIO")
  })

  test("recording devices enumerate without throwing", () => {
    expect(Array.isArray(sdlGetAudioRecordingDevices())).toBe(true)
  })
})

describe("SdlAudioStream as a pure converter", () => {
  test("identical specs round-trip bit-exactly", () => {
    const spec = { format: SdlAudioFormat.F32, channels: 1, freq: RATE }
    const stream = sdlCreateAudioStream(spec, spec)

    const source = sine(TONE, RATE, 1000, 0.5)
    stream.putSamples(source)
    stream.flush()

    const out = stream.getSamples(1000)
    expect(out.length).toBe(1000)
    // No conversion means no arithmetic, so anything but zero difference is a
    // bug in the copy itself.
    expect(maxAbsDiff(out, source)).toBe(0)
    stream.destroy()
  })

  test("stereo to mono downmixes both channels", () => {
    const stream = sdlCreateAudioStream(
      { format: SdlAudioFormat.F32, channels: 2, freq: RATE },
      { format: SdlAudioFormat.F32, channels: 1, freq: RATE },
    )

    const l = sine(TONE, RATE, 4800, 0.6)
    const r = sine(TONE * 2, RATE, 4800, 0.4)
    stream.putSamples(interleave([l, r]))
    stream.flush()

    const out = stream.getSamples(4800)
    expect(out.length).toBe(4800)
    // Both tones must be present. A downmix that dropped a channel would leave
    // exactly one of these at zero, at the right length and the right level.
    expect(goertzel(out, RATE, TONE)).toBeGreaterThan(0.1)
    expect(goertzel(out, RATE, TONE * 2)).toBeGreaterThan(0.1)
    stream.destroy()
  })

  test("resampling changes the frame count, not the pitch", () => {
    const stream = sdlCreateAudioStream(
      { format: SdlAudioFormat.F32, channels: 1, freq: RATE },
      { format: SdlAudioFormat.F32, channels: 1, freq: RATE / 2 },
    )

    stream.putSamples(sine(TONE, RATE, 4800, 0.5))
    stream.flush()

    const out = stream.getSamples(4800)
    // Half the input rate: about half the frames back.
    expect(out.length).toBeGreaterThan(2200)
    expect(out.length).toBeLessThanOrEqual(2400)
    expect(goertzel(out, RATE / 2, TONE)).toBeGreaterThan(0.3)
    stream.destroy()
  })

  test("a non-f32 destination refuses getSamples instead of returning noise", () => {
    const stream = sdlCreateAudioStream(
      { format: SdlAudioFormat.F32, channels: 1, freq: RATE },
      { format: SdlAudioFormat.S16, channels: 1, freq: RATE },
    )
    stream.putSamples(sine(TONE, RATE, 100, 0.5))
    stream.flush()

    expect(() => stream.getSamples(100)).toThrow(/F32/)
    // The bytes are still reachable by the honest route.
    const bytes = stream.getBytes(100)
    expect(bytes.length).toBe(200)
    stream.destroy()
  })

  test("a partial frame is refused rather than shifting every later frame", () => {
    const stream = sdlCreateAudioStream(
      { format: SdlAudioFormat.F32, channels: 2, freq: RATE },
      { format: SdlAudioFormat.F32, channels: 2, freq: RATE },
    )
    expect(() => stream.putSamples(new Float32Array(5))).toThrow(/whole number/)
    stream.destroy()
  })

  test("queued and available track the conversion", () => {
    const spec = { format: SdlAudioFormat.F32, channels: 1, freq: RATE }
    const stream = sdlCreateAudioStream(spec, spec)
    expect(stream.available).toBe(0)

    stream.putSamples(new Float32Array(1000))
    stream.flush()
    expect(stream.available).toBe(4000)

    stream.clear()
    expect(stream.available).toBe(0)
    stream.destroy()
  })

  test("destroy is idempotent", () => {
    const spec = { format: SdlAudioFormat.F32, channels: 1, freq: RATE }
    const stream = sdlCreateAudioStream(spec, spec)
    stream.destroy()
    expect(() => stream.destroy()).not.toThrow()
  })
})

describe("the mixer's audio callback, without a device", () => {
  /**
   * The keystone test. Two mixers configured identically and given identical
   * voices; one rendered directly, the other pulled through SDL's stream
   * machinery by the real callback. The samples must be identical, because
   * both are the same `render_into` — the source specs match, so SDL performs
   * no conversion in between.
   *
   * Mutation check: make the callback render into a buffer it doesn't hand
   * back, or drop the `SDL_PutAudioStreamData` call, and this fails while every
   * `renderFrames` test in `audio-mixer.test.ts` stays green.
   */
  test("capture() produces exactly what renderFrames() would", () => {
    const frames = 2048

    const reference = new AudioMixer({ sampleRate: RATE, channels: 2 })
    reference.play(toneClip(0.5), { pan: -0.5 })
    const expected = reference.renderFrames(frames)

    const captured = new AudioMixer({ sampleRate: RATE, channels: 2 })
    captured.play(toneClip(0.5), { pan: -0.5 })
    captured.openCapture()
    expect(captured.isOpen).toBe(true)
    expect(captured.deviceId).toBeNull()

    const got = captured.capture(frames)
    expect(got.length).toBe(expected.length)
    expect(maxAbsDiff(got, expected)).toBe(0)

    captured.close()
    expect(captured.isOpen).toBe(false)
  })

  test("the callback advances the playhead across successive pulls", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 1 })
    m.play(AudioClip.fromSamples(Float32Array.from({ length: 1000 }, (_, i) => i), RATE, 1))
    m.openCapture()

    const a = m.capture(400)
    const b = m.capture(400)
    expect(a[0]).toBeCloseTo(0, 3)
    // Continuous, not restarted: the second pull picks up where the first
    // stopped. A callback that re-rendered from frame zero each time would
    // return 0 here and be inaudible as a bug in a tone.
    expect(b[0]).toBeCloseTo(400, 3)
    expect(m.framesRendered).toBeGreaterThanOrEqual(800)
    m.close()
  })

  test("panning survives the callback path intact", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 2 })
    m.play(toneClip(1.0), { pan: -1 })
    m.openCapture()

    const [l, r] = stereo(m.capture(2048))
    expect(peak(l)).toBeCloseTo(1.0, 3)
    expect(peak(r)).toBeLessThan(1e-6)
    m.close()
  })

  test("renderFrames is refused while open, so the two never race", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 2 })
    m.openCapture()
    expect(() => m.renderFrames(128)).toThrow(/capture\(\)/)
    m.close()
    // Closing hands control back.
    expect(m.renderFrames(128).length).toBe(256)
  })

  test("capture is refused before opening", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 2 })
    expect(() => m.capture(128)).toThrow(/openCapture/)
  })

  test("opening twice is an error rather than a leaked stream", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 2 })
    m.openCapture()
    expect(() => m.openCapture()).toThrow(/already open/)
    m.close()
  })

  test("close is idempotent and voices survive it", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 1 })
    const v = m.play(toneClip(0.5))
    m.openCapture()
    m.capture(100)
    m.close()
    m.close()
    expect(m.isVoiceActive(v)).toBe(true)
  })
})

describe("a real (dummy-backed) playback device", () => {
  test("opens, starts paused, resumes and closes", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 2 })
    m.play(toneClip(0.3), { loop: true })

    m.openDevice()
    expect(m.isOpen).toBe(true)
    // Bound to a real logical device, so an ID is reported — unlike the
    // capture path, which reports null.
    expect(m.deviceId).toBeGreaterThan(0)

    m.resume()
    m.pause()
    m.close()
    expect(m.isOpen).toBe(false)
  })

  test("opens a device by explicit ID", () => {
    const devices = sdlGetAudioPlaybackDevices()
    const m = new AudioMixer({ sampleRate: RATE, channels: 2 })
    m.openDevice(devices[0]!.id)
    expect(m.isOpen).toBe(true)
    m.close()
  })

  test("an invalid device ID fails cleanly and leaves nothing open", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 2 })
    expect(() => m.openDevice(999_999)).toThrow()
    // The stream must have been torn down on the failure path, not orphaned —
    // otherwise this second attempt would report "already open".
    expect(m.isOpen).toBe(false)
    m.openCapture()
    expect(m.isOpen).toBe(true)
    m.close()
  })

  test("resume and pause need an open mixer", () => {
    const m = new AudioMixer({ sampleRate: RATE, channels: 2 })
    expect(() => m.resume()).toThrow(/not open/)
    expect(() => m.pause()).toThrow(/not open/)
  })

  // Teardown of a mixer left to the garbage collector is deliberately NOT
  // tested here — it lives in `audio-teardown.test.ts`, in a subprocess.
  //
  // This was tried in-process first and is worth recording as a mistake: the
  // regression it guards against is heap corruption at process exit, so a
  // failure does not fail the test, it kills the runner. Mutation-checked, the
  // in-process version took this whole file down with it and reported *no*
  // results for the other 22 tests — strictly worse than not having it, because
  // a red run with no output looks like a broken machine rather than a bug.
})
