import type { MouseEvent } from "@opentui/core";
import { type ReactNode, useCallback } from "react";

interface SwitchProps {
    readonly label: string;
    readonly active: boolean;
    readonly disabled?: boolean;
    // Visually flags "won't actually engage right now" (e.g. an interlock)
    // without fully disabling the click, so the pilot gets feedback on why.
    readonly blocked?: boolean;
    readonly onToggle: () => void;
}

function Switch({label, active, disabled = false, blocked = false, onToggle}: SwitchProps): ReactNode {
    const handleClick = useCallback((event: MouseEvent): void => {
        if (!disabled) {
            onToggle();
        }
        event.stopPropagation();
    }, [disabled, onToggle]);

    const color = disabled ? "#444444" : blocked ? "#FF6666" : active ? "#FFFF00" : "#FFFFFF";
    const borderColor = disabled ? "#333333" : blocked ? "#FF6666" : active ? "#FFFF00" : "#666666";

    return <box
        onMouseDown={handleClick}
        border
        borderStyle="rounded"
        borderColor={borderColor}
        alignItems="center"
        padding={0}
    >
        <text fg={color}>{label}</text>
    </box>;
}

export type {SwitchProps};
export {Switch};
