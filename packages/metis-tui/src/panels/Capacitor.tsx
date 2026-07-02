import { TextAttributes } from "@opentui/core";
import type { ReactNode } from "react";

export function CapacitorPanel(): ReactNode {
    return <box
        border
        borderStyle="single"
        flexDirection="column"
        flexGrow={1}
        alignItems="stretch"
    >
        <box alignItems="center">
            <text attributes={TextAttributes.DIM}>Capacitor</text>
        </box>
    </box>;
}
