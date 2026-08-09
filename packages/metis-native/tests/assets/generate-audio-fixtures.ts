// Regenerates the committed `tone-*.{flac,ogg,m4a}` fixtures used by
// audio-codecs.test.ts.
//
//     bun run tests/assets/generate-audio-fixtures.ts
//
// Requires ffmpeg on PATH (developed against 9.0; `winget install Gyan.FFmpeg`,
// or set FFMPEG to an absolute path). The outputs are **committed**, so the test
// suite does not need ffmpeg installed — same arrangement as
// `generate-ktx2-fixtures.ts`, and for the same reason: fixtures should be
// reproducible rather than mystery binaries.
//
// ## Why a synthetic tone rather than a piece of music
//
// The MP3 in this directory is the real-content tier, and real content can only
// support weak assertions — "it isn't silent", "the channels differ". A tone at
// a known frequency can be checked *analytically*: `goertzel` asks whether
// 480 Hz came back at 480 Hz, in the left channel and not the right. That
// distinguishes a decoder that swapped channels, misreported the sample rate, or
// de-interleaved with the wrong stride — none of which any level-based check
// notices, because all three produce a buffer of the right length full of
// plausible floats.
//
// The tier-2 property that matters for *codec* coverage is a real encoder, not
// real content. libFLAC, libvorbis and ffmpeg's AAC and ALAC encoders were not
// written to make these tests pass, which is the whole point of the tier.
//
// ## Why these exact frequencies
//
// 480 Hz and 960 Hz at 48 kHz are 100 and 50 samples per cycle, so a whole
// number of cycles fits any multiple of 100 frames and the analysis is exact
// rather than leaky (see `tests/helpers/dsp.ts`). Distinct tones per channel are
// what makes a channel swap observable — the same reasoning as the KTX2
// fixture's four different quadrants.
//
// Amplitude is 0.5, well clear of full scale, so the lossy encoders have
// headroom and nothing clips on the way through.
//
// ## Why 16-bit source
//
// FLAC and ALAC are lossless, so a 16-bit source means their decoded output must
// be **bit-identical** to the WAV's — the strongest assertion available on any
// of these files, and one that is only true because nothing quantises on the way
// in or out.
import { execFileSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { interleave, sine } from "../helpers/dsp.js";
import { buildWav } from "../helpers/wav-build.js";

const HERE = import.meta.dir;
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";

const RATE = 48_000;
const FRAMES = RATE; // one second
const TONE_L = 480;
const TONE_R = 960;
const AMPLITUDE = 0.5;

const source = join(HERE, "tone-source.wav");

writeFileSync(
    source,
    buildWav({
        samples: interleave([
            sine(TONE_L, RATE, FRAMES, AMPLITUDE),
            sine(TONE_R, RATE, FRAMES, AMPLITUDE),
        ]),
        sampleRate: RATE,
        channels: 2,
        encoding: "s16",
    }),
);

const ffmpeg = (...args: string[]) =>
    execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-i", source, ...args], {
        stdio: "inherit",
    });

// `-q:a 8` on Vorbis and 192k on AAC are deliberately generous. These are
// decoder fixtures, not bitrate tests: the tones should survive cleanly enough
// that a failure means the decode is wrong, not that the encoder threw the
// signal away.
ffmpeg("-c:a", "flac", join(HERE, "tone.flac"));
ffmpeg("-c:a", "libvorbis", "-q:a", "8", join(HERE, "tone.ogg"));
ffmpeg("-c:a", "aac", "-b:a", "192k", join(HERE, "tone-aac.m4a"));
ffmpeg("-c:a", "alac", join(HERE, "tone-alac.m4a"));

unlinkSync(source);
console.log("wrote tone.flac, tone.ogg, tone-aac.m4a, tone-alac.m4a");
