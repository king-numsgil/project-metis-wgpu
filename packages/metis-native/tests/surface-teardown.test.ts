// Shutdown ordering for GpuSurface.
//
// A surface's teardown talks to the window system — Mesa's Vulkan drivers
// destroy per-swapchain-image X11 present fences via `xcb_sync_destroy_fence`,
// on the xcb connection SDL owns. So a surface dropped *after*
// `window.destroy()`/`sdlQuit()` calls through a freed connection and segfaults
// inside libxcb, with the addon nowhere near the top of the backtrace.
//
// Both cases below run in a **subprocess**, because the failure mode is a
// process-level crash at exit: it isn't catchable, and in-process it would take
// the test runner down with it rather than failing a test. The exit code is the
// assertion. This mirrors the VectorContext panic matrix (see CLAUDE.md) —
// same reason, same shape.
import { describe, expect, it } from "bun:test";

// The import below uses `.href` (a `file://` URL), not the `.pathname.replace(...)`
// idiom the rest of the repo uses to strip Windows' leading slash. That idiom is for
// paths passed to a function at runtime; this one is interpolated into a **string
// literal in generated source**, where a Windows path's backslashes would be eaten as
// escapes (`"F:\Programming"` → `F:Programming`). A URL needs no escaping either way.
const PRELUDE = /* ts */ `
import {
    createSurface, requestAdapterForWindow, sdlCreateWindow, sdlInit, SdlInitFlag, sdlQuit,
} from "${new URL("../index.js", import.meta.url).href}";

sdlInit(SdlInitFlag.Video);
const wnd = sdlCreateWindow("surface-teardown", 320, 240);
const adapter = await requestAdapterForWindow(wnd);
if (!adapter) { console.log("SKIP:no-adapter"); sdlQuit(); process.exit(0); }
const device = await adapter.requestDevice({});
const surface = createSurface(adapter, wnd);
surface.configure(device, { width: 320, height: 240 });
const frame = surface.getCurrentTexture();
frame.createView();
frame.present();
`;

// The marker and the exit code catch *different* failures, and both are needed.
//
//   - The exit code catches the bug itself. Mutation-checked: restoring the old
//     ordering (surface dropped after `wnd.destroy()`/`sdlQuit()`) exits **132**.
//   - The marker catches a vacuous pass — a child that never ran the script, or
//     that skipped for lack of an adapter, exits 0 and would otherwise "pass".
//
// The marker alone is NOT sufficient, which is the non-obvious part: under the
// buggy ordering the marker still prints, because the segfault happens during
// process *exit*, after the script body has already run to completion.
const DONE = "TEARDOWN-OK";

async function runScript(body: string): Promise<{code: number; out: string; err: string}> {
    const proc = Bun.spawn(["bun", "run", "-"], {
        stdin: new TextEncoder().encode(`${PRELUDE}${body}\nconsole.log(${JSON.stringify(DONE)});`),
        stdout: "pipe",
        stderr: "pipe",
    });
    const [code, out, err] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ]);
    return {code, out, err};
}

/** Asserts the child exited cleanly *and* ran to completion, or reports why not. */
function expectClean({code, out, err}: {code: number; out: string; err: string}) {
    if (out.includes("SKIP:no-adapter")) return; // headless machine — nothing to test
    expect(`${code} ${out.includes(DONE) ? DONE : `<missing ${DONE}>`}\n${err}`)
        .toBe(`0 ${DONE}\n`);
}

describe("surface teardown ordering", () => {
    it("exits cleanly when the surface is destroyed before the window", async () => {
        expectClean(await runScript(`
            surface.destroy();
            device.destroy();
            wnd.destroy();
            sdlQuit();
        `));
    }, 60_000);

    it("destroy() is idempotent and leaves the surface unusable, not crashing", async () => {
        expectClean(await runScript(`
            surface.destroy();
            surface.destroy();          // second call must be a no-op, not a double free
            let threw = false;
            try { surface.getCurrentTexture(); } catch { threw = true; }
            if (!threw) { console.error("expected getCurrentTexture() to throw"); process.exit(3); }
            device.destroy();
            wnd.destroy();
            sdlQuit();
        `));
    }, 60_000);
});
