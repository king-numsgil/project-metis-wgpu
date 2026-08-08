// Shutdown ordering for AudioMixer and SdlAudioStream.
//
// `SDL_Quit` destroys SDL's own audio streams and closes its devices. A mixer
// finalised *after* that — because the caller never called `close()` and left it
// to the garbage collector — would then destroy the same stream a second time.
// On Windows that is `STATUS_HEAP_CORRUPTION` (0xC0000374) at process exit,
// deterministically, with every test in the suite already reported green.
//
// This is the same shape as `surface-teardown.test.ts`: a handle whose teardown
// talks to a subsystem that has gone away, failing after the last line of user
// code has run, where nothing can catch it. It runs in a **subprocess** for the
// same reason — in-process it takes the runner down instead of failing a test,
// and the exit code is the only available assertion.
//
// The fix under test is the `audio_subsystem_alive()` guard in `audio/device.rs`.
// Mutation-checked: remove it and every case below exits 0xC0000374 while the
// rest of the audio suite stays green.
import { describe, expect, it } from "bun:test"

// `.href` (a `file://` URL) rather than a filesystem path: this is interpolated
// into a string literal in generated source, where a Windows path's backslashes
// would be eaten as escapes. Same reasoning as `surface-teardown.test.ts`.
const PRELUDE = /* ts */ `
import {
    AudioClip, AudioMixer, SdlInitFlag, sdlCreateAudioStream, sdlInit, sdlQuit, sdlSetHint,
} from "${new URL("../index.js", import.meta.url).href}";

sdlSetHint("SDL_AUDIO_DRIVER", "dummy");
sdlInit(SdlInitFlag.Audio);
const clip = AudioClip.fromSamples(new Float32Array(4800).fill(0.25), 48000, 1);
`

const DONE = "AUDIO-TEARDOWN-OK"

async function runScript(body: string): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(["bun", "run", "-"], {
    stdin: new TextEncoder().encode(`${PRELUDE}${body}\nconsole.log(${JSON.stringify(DONE)});`),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code, out, err] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  return { code, out, err }
}

/**
 * The marker and the exit code catch different failures, and both are needed —
 * exactly as in `surface-teardown.test.ts`. The marker alone would not catch
 * this bug at all: the crash happens during process *exit*, long after the
 * script body has printed it.
 */
function expectClean({ code, out, err }: { code: number; out: string; err: string }) {
  expect(`${code} ${out.includes(DONE) ? DONE : `<missing ${DONE}>`}\n${err}`).toBe(`0 ${DONE}\n`)
}

describe("audio teardown ordering", () => {
  it("survives an open device left to the garbage collector", async () => {
    expectClean(
      await runScript(`
            for (let i = 0; i < 8; i++) {
                const m = new AudioMixer({ sampleRate: 48000, channels: 2 });
                m.play(clip, { loop: true });
                m.openDevice();
                m.resume();
            }
            Bun.gc(true);
            sdlQuit();
        `),
    )
  }, 60_000)

  it("survives mixers that are never collected at all", async () => {
    // No `Bun.gc`, so the finalisers run during process teardown — after
    // `sdlQuit`, which is the ordering that actually crashed.
    expectClean(
      await runScript(`
            const kept = [];
            for (let i = 0; i < 4; i++) {
                const m = new AudioMixer({ sampleRate: 48000, channels: 2 });
                m.play(clip, { loop: true });
                m.openDevice();
                m.resume();
                kept.push(m);
            }
            sdlQuit();
        `),
    )
  }, 60_000)

  it("survives an abandoned capture stream", async () => {
    expectClean(
      await runScript(`
            const m = new AudioMixer({ sampleRate: 48000, channels: 2 });
            m.play(clip);
            m.openCapture();
            m.capture(512);
            sdlQuit();
        `),
    )
  }, 60_000)

  it("survives an abandoned SdlAudioStream", async () => {
    expectClean(
      await runScript(`
            const spec = { channels: 1, freq: 48000 };
            for (let i = 0; i < 4; i++) {
                const s = sdlCreateAudioStream(spec, spec);
                s.putSamples(new Float32Array(480));
            }
            Bun.gc(true);
            sdlQuit();
        `),
    )
  }, 60_000)

  it("closing explicitly before quitting is clean, and close() after quit is a no-op", async () => {
    expectClean(
      await runScript(`
            const m = new AudioMixer({ sampleRate: 48000, channels: 2 });
            m.play(clip);
            m.openDevice();
            m.resume();
            m.close();
            sdlQuit();
            // Calling close() again after SDL is gone must be inert, not fatal:
            // teardown helpers run in finally blocks that don't know the order.
            m.close();
        `),
    )
  }, 60_000)

  it("reopening after a close works, and the second device also tears down", async () => {
    expectClean(
      await runScript(`
            const m = new AudioMixer({ sampleRate: 48000, channels: 2 });
            m.openDevice();
            m.close();
            m.openDevice();
            m.resume();
            m.close();
            sdlQuit();
        `),
    )
  }, 60_000)
})
