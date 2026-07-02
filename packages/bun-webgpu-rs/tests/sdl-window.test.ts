/**
 * sdl-window.test.ts — non-interactive tests for SdlWindow API, keyboard state,
 * and mouse state. No user input required; all run in CI.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
    sdlCreateWindow,
    sdlGetGlobalMouseState,
    sdlGetKeyboardState,
    sdlGetMouseState,
    sdlInit,
    SdlInitFlag,
    SdlMouseButton,
    SdlMouseButtonMask,
    sdlPollEvents,
    sdlQuit,
    SdlScancode,
    SdlWindowFlag,
} from "../index.js";

// ── Shared window ─────────────────────────────────────────────────────────────

let win: ReturnType<typeof sdlCreateWindow>;

beforeAll(() => {
    sdlInit(SdlInitFlag.Video | SdlInitFlag.Events);
    win = sdlCreateWindow("sdl-window-api-tests", 640, 480, 0);
    // drain any startup events so the window is fully ready
    sdlPollEvents();
});

afterAll(() => {
    win.destroy();
    sdlQuit();
});

// ── Window identity ───────────────────────────────────────────────────────────

describe("window identity", () => {
    it("id is a positive integer", () => {
        expect(win.id).toBeGreaterThan(0);
        expect(Number.isInteger(win.id)).toBe(true);
    });

    it("flags is a non-negative integer", () => {
        expect(win.flags).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(win.flags)).toBe(true);
    });

    it("SdlWindowFlag enum has expected values", () => {
        expect(SdlWindowFlag.Fullscreen).toBe(1);
        expect(SdlWindowFlag.Resizable).toBe(32);
        expect(SdlWindowFlag.Hidden).toBe(8);
        expect(SdlWindowFlag.Maximized).toBe(128);
        expect(SdlWindowFlag.Minimized).toBe(64);
    });
});

// ── Title ─────────────────────────────────────────────────────────────────────

describe("window title", () => {
    it("getter matches creation title", () => {
        expect(win.title).toBe("sdl-window-api-tests");
    });

    it("getTitle() matches title getter", () => {
        expect(win.getTitle()).toBe(win.title);
    });

    it("setTitle / getter round-trip", () => {
        win.setTitle("renamed");
        expect(win.title).toBe("renamed");
        win.setTitle("sdl-window-api-tests"); // restore
    });
});

// ── Size ──────────────────────────────────────────────────────────────────────

describe("window size", () => {
    it("width/height getters match creation size", () => {
        expect(win.width).toBe(640);
        expect(win.height).toBe(480);
    });

    it("getSize() returns positive integers", () => {
        const s = win.getSize();
        expect(s.width).toBeGreaterThan(0);
        expect(s.height).toBeGreaterThan(0);
        expect(Number.isInteger(s.width)).toBe(true);
        expect(Number.isInteger(s.height)).toBe(true);
    });

    it("getSizeInPixels() returns positive integers", () => {
        const s = win.getSizeInPixels();
        expect(s.width).toBeGreaterThan(0);
        expect(s.height).toBeGreaterThan(0);
    });

    it("setSize / getter round-trip", () => {
        win.setSize(800, 600);
        expect(win.width).toBe(800);
        expect(win.height).toBe(600);
        win.setSize(640, 480);
    });
});

// ── Position ──────────────────────────────────────────────────────────────────

describe("window position", () => {
    it("getPosition() returns finite numbers", () => {
        const p = win.getPosition();
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
    });

    it("setPosition does not throw", () => {
        expect(() => win.setPosition(50, 50)).not.toThrow();
        expect(() => win.setPosition(100, 100)).not.toThrow();
    });
});

// ── Opacity ───────────────────────────────────────────────────────────────────

describe("window opacity", () => {
    it("getOpacity() returns a value in [0, 1]", () => {
        const o = win.getOpacity();
        expect(o).toBeGreaterThanOrEqual(0);
        expect(o).toBeLessThanOrEqual(1);
    });

    it("setOpacity / getOpacity round-trip", () => {
        win.setOpacity(0.75);
        const o = win.getOpacity();
        expect(o).toBeCloseTo(0.75, 1);
        win.setOpacity(1.0);
    });
});

// ── Display scale ─────────────────────────────────────────────────────────────

describe("display scale", () => {
    it("getDisplayScale() returns a positive number", () => {
        const scale = win.getDisplayScale();
        expect(scale).toBeGreaterThan(0);
        expect(Number.isFinite(scale)).toBe(true);
    });
});

// ── State mutations (smoke tests — just verify they don't throw) ───────────────

describe("window state mutations", () => {
    it("show / hide", () => {
        expect(() => {
            win.show();
            win.hide();
            win.show();
        }).not.toThrow();
    });

    it("setResizable", () => {
        expect(() => {
            win.setResizable(true);
            win.setResizable(false);
        }).not.toThrow();
    });

    it("setBordered", () => {
        expect(() => {
            win.setBordered(false);
            win.setBordered(true);
        }).not.toThrow();
    });

    it("setAlwaysOnTop", () => {
        expect(() => {
            win.setAlwaysOnTop(true);
            win.setAlwaysOnTop(false);
        }).not.toThrow();
    });

    it("setFocusable", () => {
        expect(() => {
            win.setFocusable(true);
        }).not.toThrow();
    });
});

// ── Input grab ────────────────────────────────────────────────────────────────

describe("input grab", () => {
    it("setMouseGrab / getMouseGrab round-trip", () => {
        // Raise the window so it has focus — grab APIs may be no-ops without it
        win.raise();
        sdlPollEvents();
        expect(() => win.setMouseGrab(true)).not.toThrow();
        expect(() => win.setMouseGrab(false)).not.toThrow();
        // Verify it always ends up released
        expect(win.getMouseGrab()).toBe(false);
    });

    it("setKeyboardGrab / getKeyboardGrab round-trip", () => {
        win.raise();
        sdlPollEvents();
        expect(() => win.setKeyboardGrab(true)).not.toThrow();
        expect(() => win.setKeyboardGrab(false)).not.toThrow();
        expect(win.getKeyboardGrab()).toBe(false);
    });

    it("setMouseRect / getMouseRect round-trip", () => {
        win.setMouseRect({x: 10, y: 10, w: 200, h: 150});
        const r = win.getMouseRect();
        expect(r).not.toBeNull();
        expect(r!.x).toBe(10);
        expect(r!.y).toBe(10);
        expect(r!.w).toBe(200);
        expect(r!.h).toBe(150);
        win.setMouseRect(null); // release
        expect(win.getMouseRect()).toBeNull();
    });
});

// ── Keyboard state ────────────────────────────────────────────────────────────

describe("keyboard state handle", () => {
    it("len is SDL_SCANCODE_COUNT (typically 512)", () => {
        const KB = sdlGetKeyboardState();
        expect(KB.len).toBeGreaterThan(0);
        expect(KB.len).toBeLessThanOrEqual(512);
    });

    it("all keys are released at rest (no input in this process)", () => {
        sdlPollEvents(); // pump to refresh state
        const KB = sdlGetKeyboardState();
        // These keys cannot be held during a headless test run
        expect(KB.get(SdlScancode.A)).toBe(false);
        expect(KB.get(SdlScancode.Escape)).toBe(false);
        expect(KB.get(SdlScancode.Space)).toBe(false);
    });

    it("out-of-range scancode returns false", () => {
        const KB = sdlGetKeyboardState();
        expect(KB.get(SdlScancode.Count)).toBe(false);
        expect(KB.get(9999)).toBe(false);
    });

    it("SdlScancode enum has expected values", () => {
        expect(SdlScancode.A).toBe(4);
        expect(SdlScancode.W).toBe(26);
        expect(SdlScancode.Escape).toBe(41);
        expect(SdlScancode.Left).toBe(80);
        expect(SdlScancode.Count).toBe(512);
    });
});

// ── Mouse state ───────────────────────────────────────────────────────────────

describe("mouse state", () => {
    it("sdlGetMouseState() returns finite coords and a valid button mask", () => {
        sdlPollEvents();
        const s = sdlGetMouseState();
        expect(Number.isFinite(s.x)).toBe(true);
        expect(Number.isFinite(s.y)).toBe(true);
        expect(Number.isInteger(s.buttons)).toBe(true);
        expect(s.buttons).toBeGreaterThanOrEqual(0);
    });

    it("sdlGetGlobalMouseState() returns finite coords", () => {
        const s = sdlGetGlobalMouseState();
        expect(Number.isFinite(s.x)).toBe(true);
        expect(Number.isFinite(s.y)).toBe(true);
    });

    it("SdlMouseButton and SdlMouseButtonMask enums have expected values", () => {
        // Button indices are 1-based
        expect(SdlMouseButton.Left).toBe(1);
        expect(SdlMouseButton.Middle).toBe(2);
        expect(SdlMouseButton.Right).toBe(3);
        // Masks are power-of-two
        expect(SdlMouseButtonMask.LMask).toBe(1);
        expect(SdlMouseButtonMask.MMask).toBe(2);
        expect(SdlMouseButtonMask.RMask).toBe(4);
        expect(SdlMouseButtonMask.LMask & (SdlMouseButtonMask.LMask - 1)).toBe(0);
        expect(SdlMouseButtonMask.RMask & (SdlMouseButtonMask.RMask - 1)).toBe(0);
    });
});
