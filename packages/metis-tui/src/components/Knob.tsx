import { MouseButton, type MouseEvent } from "@opentui/core";
import { type ReactNode, useCallback, useState } from "react";

interface KnobMode {
    readonly label: string;
}

interface KnobProps {
    readonly modes: readonly [KnobMode, KnobMode, ...KnobMode[]];
    readonly initialIndex?: number;
    readonly onChange?: (index: number, mode: KnobMode) => void;
    readonly label?: string;
    readonly width?: number;
}

function truncateLabel(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, maxLength - 1)}…`;
}

function Knob({modes, initialIndex = 0, onChange, label, width = 14}: KnobProps): ReactNode {
    if (modes.length < 2 || modes.length > 6) {
        throw new Error(`Knob requires 2-6 modes, got ${modes.length}`);
    }

    const [index, setIndex] = useState<number>(initialIndex);
    const [hovered, setHovered] = useState<boolean>(false);

    const handleClick = useCallback((event: MouseEvent): void => {
        const step = event.button === MouseButton.RIGHT ? -1 : 1;
        const nextIndex = (index + step + modes.length) % modes.length;
        setIndex(nextIndex);
        onChange?.(nextIndex, modes[nextIndex]!);
        event.stopPropagation();
    }, [index, modes, onChange]);

    return <box
        onMouseDown={handleClick}
        onMouseOver={() => setHovered(true)}
        onMouseOut={() => setHovered(false)}
        width={width}
        border
        borderStyle="rounded"
        borderColor={hovered ? "#FFFF00" : "#666666"}
        flexDirection="column"
        alignItems="center"
        padding={0}
    >
        {label !== undefined && <text fg="#888888">{truncateLabel(label, width)}</text>}
        <text fg={hovered ? "#FFFF00" : "#FFFFFF"}>
            {truncateLabel(modes[index]!.label, width)}
        </text>
        <box
            flexDirection="row"
            justifyContent="space-evenly"
            width={width}
        >
            {modes.map((mode, i) => (
                <text key={mode.label} fg={i === index ? (hovered ? "#FFFF00" : "#FFFFFF") : "#555555"}>
                    {i === index ? "●" : "○"}
                </text>
            ))}
        </box>
    </box>;
}

export type { KnobMode, KnobProps };
export { Knob };
