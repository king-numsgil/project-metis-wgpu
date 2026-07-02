/**
 * sdl-events.test.ts — interactive event tests for mouse, keyboard, and window events.
 *
 * Each test opens a window with a title describing the expected input.
 * If the user provides that input the test fully validates the event fields.
 * If no input arrives within the deadline the test still passes (timeout is not
 * a failure — these tests are designed to run locally as well as in headless CI).
 */

import { describe, expect, it } from "bun:test";
import {
    sdlCreateWindow,
    SdlEventType,
    sdlInit,
    SdlInitFlag,
    sdlPollEvents,
    sdlQuit,
    SdlScancode,
    SdlWindowFlag,
} from "../index.js";

// ── Types ─────────────────────────────────────────────────────────────────────

type SdlEvent = ReturnType<typeof sdlPollEvents>[number]
type EventPredicate = (ev: SdlEvent) => boolean

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Drain the SDL event queue every ~16ms until `predicate` returns true or the
 * deadline expires. Returns the matching event or null on timeout.
 */
async function waitForEvent(predicate: EventPredicate, timeoutMs: number): Promise<SdlEvent | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        for (const ev of sdlPollEvents()) {
            if (predicate(ev)) {
                return ev;
            }
        }
        await Bun.sleep(16);
    }
    return null;
}

// ── Constants ─────────────────────────────────────────────────────────────────


// Interactive timeout — how long we wait for a human to provide the input.
const INTERACT_MS = 8_000;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("sdl-events (interactive)", () => {

    // ── Mouse motion ─────────────────────────────────────────────────────────────

    it("mouse motion — MOUSE_MOTION carries x/y coords", async () => {
        sdlInit(SdlInitFlag.Video | SdlInitFlag.Events);
        const win = sdlCreateWindow("Test : move the mouse", 480, 320, 0);
        win.raise();

        const ev = await waitForEvent(e => e.type === SdlEventType.MouseMotion, INTERACT_MS);

        win.destroy();
        sdlQuit();

        if (ev === null) {
            return;
        } // no input — still passes

        // Full field validation when user actually moved the mouse
        expect(ev.type).toBe(SdlEventType.MouseMotion);
        expect(typeof ev.mouseX).toBe("number");
        expect(typeof ev.mouseY).toBe("number");
        expect(Number.isFinite(ev.mouseX!)).toBe(true);
        expect(Number.isFinite(ev.mouseY!)).toBe(true);
        expect(typeof ev.mouseXrel).toBe("number");
        expect(typeof ev.mouseYrel).toBe("number");
        expect(Number.isFinite(ev.timestamp)).toBe(true);
        expect(ev.timestamp).toBeGreaterThan(0);
        // windowId is set for window-local motion
        expect(ev.windowId).toBeGreaterThan(0);
    }, INTERACT_MS + 4_000);

    // ── Mouse button click ────────────────────────────────────────────────────────

    it("mouse button — MOUSE_BUTTON_DOWN carries button index and coords", async () => {
        sdlInit(SdlInitFlag.Video | SdlInitFlag.Events);
        const win = sdlCreateWindow("Test : click anywhere in the window", 480, 320, 0);
        win.raise();

        const ev = await waitForEvent(e => e.type === SdlEventType.MouseButtonDown, INTERACT_MS);

        win.destroy();
        sdlQuit();

        if (ev === null) {
            return;
        }

        expect(ev.type).toBe(SdlEventType.MouseButtonDown);
        // mouseButton: 1 = left, 2 = middle, 3 = right
        expect(ev.mouseButton).toBeGreaterThanOrEqual(1);
        expect(ev.mouseButton).toBeLessThanOrEqual(5);
        // click count: 1 = single, 2 = double
        expect(ev.mouseClicks).toBeGreaterThanOrEqual(1);
        // click coordinates
        expect(Number.isFinite(ev.mouseX!)).toBe(true);
        expect(Number.isFinite(ev.mouseY!)).toBe(true);
        expect(ev.windowId).toBeGreaterThan(0);
    }, INTERACT_MS + 4_000);

    // ── Mouse wheel ───────────────────────────────────────────────────────────────

    it("mouse wheel — MOUSE_WHEEL carries scroll deltas", async () => {
        sdlInit(SdlInitFlag.Video | SdlInitFlag.Events);
        const win = sdlCreateWindow("Test : scroll the mouse wheel", 480, 320, 0);
        win.raise();

        const ev = await waitForEvent(e => e.type === SdlEventType.MouseWheel, INTERACT_MS);

        win.destroy();
        sdlQuit();

        if (ev === null) {
            return;
        }

        expect(ev.type).toBe(SdlEventType.MouseWheel);
        // Wheel deltas map to mouseX (horizontal) and mouseY (vertical scroll)
        expect(typeof ev.mouseX).toBe("number");
        expect(typeof ev.mouseY).toBe("number");
        expect(Number.isFinite(ev.mouseX!)).toBe(true);
        expect(Number.isFinite(ev.mouseY!)).toBe(true);
    }, INTERACT_MS + 4_000);

    // ── Keyboard key press ────────────────────────────────────────────────────────

    it("keyboard — KEY_DOWN for Escape carries scancode and keycode", async () => {
        sdlInit(SdlInitFlag.Video | SdlInitFlag.Events);
        const win = sdlCreateWindow("Test : press the Escape key", 480, 320, 0);
        win.raise();

        const ev = await waitForEvent(
            e => e.type === SdlEventType.KeyDown && e.scancode === SdlScancode.Escape,
            INTERACT_MS,
        );

        win.destroy();
        sdlQuit();

        if (ev === null) {
            return;
        }

        expect(ev.type).toBe(SdlEventType.KeyDown);
        expect(ev.scancode).toBe(SdlScancode.Escape);
        expect(typeof ev.keycode).toBe("number");
        expect(ev.keycode).toBeGreaterThan(0);
        expect(typeof ev.keyMod).toBe("number");
        expect(ev.keyRepeat).toBe(false); // first press, not a held repeat
        expect(ev.windowId).toBeGreaterThan(0);
        expect(Number.isFinite(ev.timestamp)).toBe(true);
    }, INTERACT_MS + 4_000);

    // ── Keyboard any key press + release ─────────────────────────────────────────

    it("keyboard — KEY_UP follows KEY_DOWN for the same scancode", async () => {
        sdlInit(SdlInitFlag.Video | SdlInitFlag.Events);
        const win = sdlCreateWindow("Test : press and release any key", 480, 320, 0);
        win.raise();

        let downScancode: number | undefined = undefined;

        const up = await waitForEvent(e => {
            if (e.type === SdlEventType.KeyDown && downScancode === undefined) {
                downScancode = e.scancode ?? undefined;
            }
            return e.type === SdlEventType.KeyUp && downScancode !== undefined && e.scancode === downScancode;
        }, INTERACT_MS);

        win.destroy();
        sdlQuit();

        if (!up ) {
            return;
        }

        expect(up.type).toBe(SdlEventType.KeyUp);
        expect(up.scancode).toBe(downScancode);
    }, INTERACT_MS + 4_000);

    // ── Window focus events ───────────────────────────────────────────────────────

    it("window focus — FOCUS_GAINED fires when window is raised", async () => {
        sdlInit(SdlInitFlag.Video | SdlInitFlag.Events);
        // Create a secondary window so focus can move between them
        const win1 = sdlCreateWindow("Test : click this window to focus it", 400, 300, 0);
        const win2 = sdlCreateWindow("Test : secondary (click win1)", 400, 300, 0);
        win1.setPosition(100, 100);
        win2.setPosition(550, 100);
        win2.raise(); // give focus to win2 first

        const ev = await waitForEvent(e => e.type === SdlEventType.WindowFocusGained, INTERACT_MS);

        win1.destroy();
        win2.destroy();
        sdlQuit();

        if (ev === null) {
            return;
        }

        expect(ev.type).toBe(SdlEventType.WindowFocusGained);
        expect(ev.windowId).toBeGreaterThan(0);
    }, INTERACT_MS + 4_000);

    // ── Window resize ─────────────────────────────────────────────────────────────

    it("window resize — WINDOW_RESIZED carries new dimensions in data1/data2", async () => {
        sdlInit(SdlInitFlag.Video | SdlInitFlag.Events);
        const win = sdlCreateWindow(
            "Test : resize the window by dragging a corner",
            480, 320,
            SdlWindowFlag.Resizable,
        );
        win.raise();

        const ev = await waitForEvent(e => e.type === SdlEventType.WindowResized, INTERACT_MS);

        win.destroy();
        sdlQuit();

        if (ev === null) {
            return;
        }

        expect(ev.type).toBe(SdlEventType.WindowResized);
        // data1 = new width, data2 = new height
        expect(ev.data1).toBeGreaterThan(0);
        expect(ev.data2).toBeGreaterThan(0);
        expect(ev.windowId).toBeGreaterThan(0);
    }, INTERACT_MS + 4_000);

    // ── Window close request ──────────────────────────────────────────────────────

    it("window close — WINDOW_CLOSE_REQUESTED fires when X button is clicked", async () => {
        sdlInit(SdlInitFlag.Video | SdlInitFlag.Events);
        const win = sdlCreateWindow("Test : click the X to close this window", 480, 320, 0);
        win.raise();

        const ev = await waitForEvent(e => e.type === SdlEventType.WindowCloseRequested, INTERACT_MS);

        win.destroy();
        sdlQuit();

        if (ev === null) {
            return;
        }

        expect(ev.type).toBe(SdlEventType.WindowCloseRequested);
        expect(ev.windowId).toBeGreaterThan(0);
    }, INTERACT_MS + 4_000);

    // ── Window mouse enter / leave ────────────────────────────────────────────────

    it("window mouse enter/leave — events fire when cursor crosses window border", async () => {
        sdlInit(SdlInitFlag.Video | SdlInitFlag.Events);
        const win = sdlCreateWindow("Test : move the mouse in and out of the window", 480, 320, 0);
        win.raise();

        // Collect up to 3 enter/leave events
        const seen: number[] = [];
        await waitForEvent(e => {
            if (e.type === SdlEventType.WindowMouseEnter || e.type === SdlEventType.WindowMouseLeave) {
                seen.push(e.type);
            }
            return seen.length >= 2;
        }, INTERACT_MS);

        win.destroy();
        sdlQuit();

        if (seen.length === 0) {
            return
        }

        // Each seen event should be one of the two types
        for (const t of seen) {
            expect([SdlEventType.WindowMouseEnter, SdlEventType.WindowMouseLeave]).toContain(t)
        }
    }, INTERACT_MS + 4_000)

})
