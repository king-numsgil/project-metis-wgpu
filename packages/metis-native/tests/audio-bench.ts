/**
 * Arithmetic-bound benchmark. Run manually: `bun run tests/audio-bench.ts`.
 * Not a `.test.ts` — it asserts nothing, it reports numbers. Same shape as
 * `bench.ts`.
 *
 * ## Why this exists alongside `napi-overhead.test.ts`
 *
 * They measure different things, and using the wrong one produces a confident
 * wrong answer. `napi-overhead` measures the cost of *crossing* the boundary:
 * its calls are marshalling plus driver work, with almost no arithmetic per
 * call. This one is the opposite — the mixer's per-sample inner loop, with
 * index math, fractional stepping and interpolation.
 *
 * That difference is not theoretical. Asked whether `overflow-checks` was worth
 * enabling in the `fastdev` profile, `napi-overhead` showed **no signal at all**
 * (every reading inside run-to-run noise), while these benchmarks showed the
 * mixer loop taking about half again as long. Judging on `napi-overhead` alone
 * would have concluded the flag was free.
 *
 * Use this whenever changing a compiler flag, an allocator, or anything in
 * `mixer.rs`'s render path.
 */
import { AudioClip, AudioMixer, sdlGetPerformanceCounter, sdlGetPerformanceFrequency } from "../index.js"

const FREQ = Number(sdlGetPerformanceFrequency())
const us = (a: number, b: number) => ((b - a) / FREQ) * 1e6

function bench(name: string, iters: number, fn: () => void): void {
  for (let i = 0; i < Math.max(1, iters / 10); i++) fn() // warm up
  const samples: number[] = []
  for (let r = 0; r < 7; r++) {
    const t0 = Number(sdlGetPerformanceCounter())
    for (let i = 0; i < iters; i++) fn()
    const t1 = Number(sdlGetPerformanceCounter())
    samples.push(us(t0, t1) / iters)
  }
  samples.sort((a, b) => a - b)
  const median = samples[Math.floor(samples.length / 2)]!
  console.log(`${name}\t${median.toFixed(3)}\t${samples[0]!.toFixed(3)}`)
}

console.log("bench\tmedian_us\tbest_us")

// 1. The mixer render loop — per-sample arithmetic, index math, interpolation.
{
  const rate = 48_000
  const clip = AudioClip.fromSamples(
    Float32Array.from({ length: rate }, (_, i) => Math.sin((2 * Math.PI * 480 * i) / rate)),
    rate,
    1,
  )
  const m = new AudioMixer({ sampleRate: rate, channels: 2 })
  for (let v = 0; v < 32; v++) m.play(clip, { loop: true, pan: v / 32 - 0.5, gain: 0.02 })
  bench("mixer.renderFrames(1024)x32voices", 200, () => {
    m.renderFrames(1024)
  })
}

// 2. Resampling path — the fractional-position branch, exercised hard.
{
  const clip = AudioClip.fromSamples(
    Float32Array.from({ length: 22_050 }, (_, i) => Math.sin((2 * Math.PI * 480 * i) / 22_050)),
    22_050,
    1,
  )
  const m = new AudioMixer({ sampleRate: 48_000, channels: 2 })
  for (let v = 0; v < 32; v++) m.play(clip, { loop: true, rate: 1 + v / 64 })
  bench("mixer.renderFrames(1024)x32resampled", 200, () => {
    m.renderFrames(1024)
  })
}

// 3. Clip construction + deinterleave — bulk index arithmetic across a Vec.
{
  const samples = new Float32Array(48_000 * 2)
  const clip = AudioClip.fromSamples(samples, 48_000, 2)
  bench("clip.getChannel(1) 48k stereo", 200, () => {
    clip.getChannel(1)
  })
}
