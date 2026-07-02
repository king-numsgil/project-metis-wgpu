import { useBindings } from "@opentui/keymap/react";
import { useRenderer } from "@opentui/react";
import { type ReactNode } from "react";
import { CapacitorPanel } from "./panels/Capacitor.tsx";
import { ReactorPanel } from "./panels/Reactor.tsx";

export function App(): ReactNode {
    const renderer = useRenderer();

    useBindings(() => ({
        commands: [
            {
                name: "Quit",
                run() {
                    renderer.destroy();
                },
            },
            {
                name: "ShowConsole",
                run() {
                    renderer.console.toggle();
                },
            },
        ],
        bindings: [
            {key: "ctrl+q", cmd: "Quit"},
            {key: "`", cmd: "ShowConsole"},
        ],
    }), [renderer]);

    return <box
        alignItems="flex-start"
        justifyContent="flex-start"
        flexGrow={1}
        flexDirection="row"
    >
        <CapacitorPanel/>
        <ReactorPanel/>
    </box>;
}
