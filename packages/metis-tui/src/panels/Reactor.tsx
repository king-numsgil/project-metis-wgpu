import { TextAttributes } from "@opentui/core";
import type { ReactNode } from "react";

export function ReactorPanel(): ReactNode {
    return <box
        border
        borderStyle="single"
        flexDirection="column"
        flexGrow={1}
        alignItems="stretch"
    >
        <box alignItems="center">
            <text attributes={TextAttributes.DIM}>Reactor</text>
        </box>
    </box>;
}
