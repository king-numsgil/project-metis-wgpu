/**
 * An audio player you can actually hear.
 *
 *   bun run demo:audio            (from packages/metis-native)
 *   bun run examples/audio-player.ts [path-to-audio-file]
 *
 * Arrow keys: up/down volume, left/right seek 10 s. Space pauses, R restarts,
 * Escape quits.
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

const SEEK_STEP = 10 // seconds
const VOLUME_STEP = 0.05
const POLL_MS = 16

/** Seconds as m:ss. */
function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
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

sdlInit(SdlInitFlag.Audio | SdlInitFlag.Video | SdlInitFlag.Events)

// The mixer runs at the clip's own rate so nothing resamples — this demo is
// about hearing the file, not the resampler. SDL converts to whatever the
// device actually wants.
const mixer = new AudioMixer({ sampleRate: clip.sampleRate, channels: 2 })
let volume = 0.6
mixer.masterGain = volume

let voice = mixer.play(clip)
const window = sdlCreateWindow("metis audio — keep me focused", 480, 120)

mixer.openDevice()
mixer.resume()

console.log(
  "\n  ↑/↓ volume   ←/→ seek 10s   space pause   R restart   Esc quit" +
    "\n  (keep the small window focused)\n",
)

let running = true
let paused = false

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

    const time = mixer.voiceTime(voice) ?? clip.duration
    const state = paused ? "paused " : mixer.activeVoices > 0 ? "playing" : "ended  "
    process.stdout.write(
      `\r  ${state}  ${clock(time)} / ${clock(clip.duration)}  ` +
        `${progressBar(time / clip.duration)}  vol ${(volume * 100).toFixed(0).padStart(3)}%  `,
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
