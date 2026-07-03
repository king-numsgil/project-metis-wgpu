import { useBindings } from "@opentui/keymap/react";
import { useRenderer } from "@opentui/react";
import { type ReactNode } from "react";
import { CapacitorPanel } from "./panels/Capacitor.tsx";
import { CoolingPanel } from "./panels/Cooling.tsx";
import { DrivePanel } from "./panels/Drive.tsx";
import { ReactorPanel } from "./panels/Reactor.tsx";
import { REAL_MINUTES_PER_TICK_SECOND } from "./physics/time.ts";
import { ShipProvider } from "./state/ship.tsx";

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

    return <ShipProvider>
        <box flexDirection="column" flexGrow={1}>
            <box
                alignItems="flex-start"
                justifyContent="flex-start"
                flexGrow={1}
                flexDirection="row"
            >
                <CapacitorPanel/>
                <CoolingPanel/>
                <ReactorPanel/>
                <DrivePanel/>
            </box>
            <box alignItems="flex-end">
                <text fg="#444444">1s = {REAL_MINUTES_PER_TICK_SECOND}min ship time</text>
            </box>
        </box>
    </ShipProvider>;
}
