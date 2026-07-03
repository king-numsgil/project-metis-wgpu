import type { ReactNode } from "react";

interface BarProps {
    readonly value: number; // 0-100
    readonly width?: number;
    readonly fillColor?: string;
    readonly trackColor?: string;
}

function Bar({value, width = 20, fillColor = "#00FF88", trackColor = "#333333"}: BarProps): ReactNode {
    const clamped = Math.min(100, Math.max(0, value));
    const filled = Math.round((clamped / 100) * width);
    return <box flexDirection="row">
        <text fg={fillColor}>{"█".repeat(filled)}</text>
        <text fg={trackColor}>{"░".repeat(width - filled)}</text>
    </box>;
}

export type {BarProps};
export {Bar};
