/**
 * An audio player you can actually hear.
 *
 *   bun run demo:audio            (from packages/metis-native)
 *   bun run examples/audio-player.ts [path-to-audio-file]
 *
 * Plays a music track, and walks a looping footstep sound in a circle around
 * the listener using HRTF spatialisation — so the two halves of the audio
 * module are audible side by side.
 *
 * Arrow keys: up/down volume, left/right seek 10 s. Space pauses, R restarts,
 * S toggles the footsteps, Escape quits. **The transport controls act on the
 * music only** — the footsteps are a positioned loop, not a track.
 *
 * ## Why there is a window
 *
 * SDL delivers keyboard events to a focused window, so there is one — 480x120,
 * doing nothing. The readout goes to the terminal instead of being rendered
 * into it, because drawing text would drag in a device, a surface, a pipeline
 * and `VectorContext` for a demo whose subject is audio. **Keep the small
 * window focused** or the arrow keys go to whatever else has focus.
 *
 * ## What this demonstrates that the tests cannot
 *
 * The test suite runs against SDL's `dummy` driver and asserts on numbers; it
 * proves the mixer's arithmetic and the callback plumbing, and it proves them
 * on a machine with no sound card. What it cannot tell you is whether a real
 * driver, at a real buffer size, on a real device, produces continuous audio —
 * whether the callback keeps up. That is what this is for. If it stutters,
 * suspect the callback's critical section (`mixer.rs`) before suspecting the
 * mix itself, which the offline tests have already pinned sample-exactly.
 *
 * For the footsteps it checks the thing no test can: whether the HRTF actually
 * *localises* to a human. `audio-spatial.test.ts` proves the interaural time
 * difference is ~690 us and mirrors correctly, which is the physics — but only
 * ears can tell you the circle sounds like a circle rather than like a volume
 * knob sweeping. Close your eyes and point at it.
 */

import {
  AudioMixer,
  SdlEventType,
  SdlInitFlag,
  SdlScancode,
  loadAudioClip,
  sdlCreateWindow,
  sdlInit,
  sdlPollEvents,
  sdlQuit,
} from "../index.js"
import { join } from "node:path"

const DEFAULT_TRACK = join(
  import.meta.dir,
  "..",
  "tests",
  "assets",
  "psychronic-road-to-nowhere-264422.mp3",
)

const FOOTSTEPS = join(import.meta.dir, "..", "tests", "assets", "51124243-footstep-372877.mp3")

const SEEK_STEP = 10 // seconds
const VOLUME_STEP = 0.05
const POLL_MS = 16

/** Metres from the listener, and seconds per lap. */
const WALK_RADIUS = 2.5
const WALK_PERIOD = 8

/**
 * Peak the footsteps are normalised to.
 *
 * The source clip decodes with a peak of ~3.1 — MP3 decoding can overshoot, and
 * this one is mastered hot. Played at unity it would clip hard and drown the
 * music, so it is scaled to sit under the track. This is why `AudioClip.peak`
 * exists.
 */
const STEP_PEAK = 0.35

/** Seconds as m:ss. */
function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/** Which way the steps are, in words, for a readout you can check against your ears. */
function bearing(angleRadians: number): string {
  const deg = ((angleRadians * 180) / Math.PI) % 360
  const names = ["ahead", "ahead-right", "right", "behind-right", "behind", "behind-left", "left", "ahead-left"]
  return names[Math.round(deg / 45) % 8]!
}

function progressBar(fraction: number, width = 40): string {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)))
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`
}

const path = process.argv[2] ?? DEFAULT_TRACK

console.log(`loading ${path} …`)
const clip = await loadAudioClip(path)
console.log(
  `${clip.channels}ch @ ${clip.sampleRate} Hz, ${clock(clip.duration)} ` +
    `(${clip.frameCount.toLocaleString()} frames, peak ${clip.peak.toFixed(3)})`,
)

// Mono is a hard requirement for `playSpatial` — a stereo source carries its own
// image and cannot be placed — so it is requested at load rather than hoped for.
const steps = await loadAudioClip(FOOTSTEPS, { forceMono: true })
console.log(
  `footsteps: ${steps.channels}ch @ ${steps.sampleRate} Hz, ${steps.duration.toFixed(2)}s, ` +
    `peak ${steps.peak.toFixed(2)} -> normalised to ${STEP_PEAK}`,
)

sdlInit(SdlInitFlag.Audio | SdlInitFlag.Video | SdlInitFlag.Events)

// The mixer runs at the music's own rate so the track never resamples. Steam
// Audio's default HRTF only loads at 44100 or 48000, so anything else falls back
// to 48000 and the music resamples per-voice instead — losing the no-resample
// property is a better trade than losing spatial audio entirely.
const spatialRates = [44_100, 48_000]
const mixerRate = spatialRates.includes(clip.sampleRate) ? clip.sampleRate : 48_000
const mixer = new AudioMixer({ sampleRate: mixerRate, channels: 2 })
let volume = 0.6
mixer.masterGain = volume

let voice = mixer.play(clip)

// The listener sits at the origin facing -Z, matching the coordinate convention
// `playSpatial` documents (right-handed, -Z forward, +Y up — as in glTF).
mixer.setListener({ position: [0, 0, 0], forward: [0, 0, -1], up: [0, 1, 0] })

let stepVoice: number | null = null
let stepsEnabled = true
let spatialNote = ""
try {
  stepVoice = mixer.playSpatial(steps, {
    position: [0, 0, -WALK_RADIUS],
    loop: true,
    gain: STEP_PEAK / Math.max(steps.peak, 1e-6),
    refDistance: 1,
  })
} catch (e) {
  // Most likely phonon.dll is missing, since it is gitignored. The music should
  // still play — a demo that dies because one of its two sounds is unavailable
  // is worse than one that says so and carries on.
  stepsEnabled = false
  spatialNote = `  (spatial audio unavailable: ${(e as Error).message.split("\n")[0]})`
}

const window = sdlCreateWindow("metis audio — keep me focused", 480, 120)

mixer.openDevice()
mixer.resume()

console.log(
  "\n  ↑/↓ volume   ←/→ seek 10s   space pause   R restart   S footsteps   Esc quit" +
    "\n  (transport controls affect the music only; keep the small window focused)" +
    spatialNote +
    "\n",
)

let running = true
let paused = false
const started = Date.now()

/** Re-plays from a position when the voice has been reaped, so the transport keeps working past the end. */
function seekTo(seconds: number): void {
  if (mixer.seekVoice(voice, seconds)) return
  voice = mixer.play(clip, { startTime: Math.max(0, Math.min(seconds, clip.duration)) })
}

function onKey(scancode: number): void {
  switch (scancode) {
    case SdlScancode.Escape:
      running = false
      break
    case SdlScancode.Up:
    case SdlScancode.Down: {
      const dir = scancode === SdlScancode.Up ? 1 : -1
      volume = Math.max(0, Math.min(2, volume + dir * VOLUME_STEP))
      mixer.masterGain = volume
      break
    }
    case SdlScancode.Right:
    case SdlScancode.Left: {
      const dir = scancode === SdlScancode.Right ? 1 : -1
      seekTo((mixer.voiceTime(voice) ?? 0) + dir * SEEK_STEP)
      break
    }
    case SdlScancode.Space:
      paused = !paused
      if (paused) mixer.pause()
      else mixer.resume()
      break
    case SdlScancode.R:
      seekTo(0)
      break
    case SdlScancode.S:
      // Toggling the footsteps, not the transport — handy for A/B-ing the
      // spatialisation against the bare track.
      if (stepVoice !== null) {
        stepsEnabled = !stepsEnabled
        mixer.setVoiceGain(stepVoice, stepsEnabled ? STEP_PEAK / Math.max(steps.peak, 1e-6) : 0)
      }
      break
  }
}

try {
  while (running) {
    for (const ev of sdlPollEvents()) {
      if (ev.type === SdlEventType.Quit) running = false
      // `keyRepeat` is ignored so holding an arrow doesn't scrub away the whole
      // track in a second; one press is one step.
      else if (ev.type === SdlEventType.KeyDown && !ev.keyRepeat) onKey(ev.scancode!)
    }

    // Walk the footsteps around the listener. Position is pushed every frame;
    // the HRTF re-reads it per block, so the motion is continuous rather than
    // stepped at the block rate.
    let walk = ""
    if (stepVoice !== null) {
      const angle = ((Date.now() - started) / 1000 / WALK_PERIOD) * Math.PI * 2
      const x = Math.sin(angle) * WALK_RADIUS
      const z = -Math.cos(angle) * WALK_RADIUS
      if (!mixer.setVoicePosition(stepVoice, x, 0, z)) stepVoice = null
      walk = stepsEnabled ? `  steps ${bearing(angle).padEnd(12)}` : `  steps ${"off".padEnd(12)}`
    }

    // Surfaced only when non-zero: Steam Audio failing mid-render drops voices
    // silently (the audio thread cannot throw), so this counter is the only
    // evidence it happened.
    const errs = Number(mixer.spatialErrors)
    const errNote = errs > 0 ? `  !spatialErrors ${errs}` : ""

    const time = mixer.voiceTime(voice) ?? clip.duration
    const state = paused ? "paused " : mixer.activeVoices > 0 ? "playing" : "ended  "
    process.stdout.write(
      `\r  ${state}  ${clock(time)} / ${clock(clip.duration)}  ` +
        `${progressBar(time / clip.duration, 28)}  vol ${(volume * 100).toFixed(0).padStart(3)}%` +
        walk +
        errNote,
    )

    await Bun.sleep(POLL_MS)
  }
} finally {
  // Order matters and is the documented rule: close the mixer (which destroys
  // the stream and closes the logical device) before SDL goes away. The
  // `audio_subsystem_alive` guard makes getting this wrong survivable rather
  // than a heap corruption, but survivable is not the same as correct.
  console.log("\n")
  mixer.close()
  window.destroy()
  sdlQuit()
}
