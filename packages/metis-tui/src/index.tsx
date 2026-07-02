import "@opentui/react/runtime-plugin-support";

import { ConsolePosition, createCliRenderer } from "@opentui/core";
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui";
import { KeymapProvider } from "@opentui/keymap/react";
import { createRoot } from "@opentui/react";
import { App } from "./App.tsx";

const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    useMouse: true,
    targetFps: 30,
    screenMode: "alternate-screen",
    enableMouseMovement: true,
    externalOutputMode: "passthrough",
    consoleOptions: {
        position: ConsolePosition.BOTTOM,
        sizePercent: 30,
    },
});
const keymap = createDefaultOpenTuiKeymap(renderer);
createRoot(renderer).render(
    <KeymapProvider keymap={keymap}>
        <App/>
    </KeymapProvider>,
);
