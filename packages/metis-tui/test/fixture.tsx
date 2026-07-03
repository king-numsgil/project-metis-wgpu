// Headless render of the full TUI app via @opentui/core's test renderer.
// Run with `bun run fixture` from packages/metis-tui — prints ASCII frames
// to stdout so the app can be inspected without a real terminal.
import { createTestRenderer } from "@opentui/core/testing";
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui";
import { KeymapProvider } from "@opentui/keymap/react";
import { createRoot } from "@opentui/react";
import { act } from "react";
import { App } from "../src/App.tsx";

async function main(): Promise<void> {
    const testSetup = await createTestRenderer({width: 120, height: 44});
    const {renderer, mockInput, flush, captureCharFrame} = testSetup;

    // KeymapProvider needs a keymap built from the renderer instance, so we
    // drive the React root ourselves instead of using @opentui/react/test-utils'
    // testRender() (which creates the renderer internally, too late for this).
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const keymap = createDefaultOpenTuiKeymap(renderer);
    const root = createRoot(renderer);
    act(() => {
        root.render(
            <KeymapProvider keymap={keymap}>
                <App/>
            </KeymapProvider>,
        );
    });

    // Initial state renders synchronously, but the ship worker's first tick
    // (and any resulting layout changes) arrive async — let those settle.
    await act(async () => flush());
    console.log("=== initial frame ===");
    console.log(captureCharFrame());

    console.log("\n=== after pressing ` (toggle console) ===");
    mockInput.pressKey("`");
    await act(async () => flush());
    console.log(captureCharFrame());

    mockInput.pressKey("`");
    await act(async () => flush());

    act(() => {
        root.unmount();
    });
    renderer.destroy();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = false;
}

await main();
