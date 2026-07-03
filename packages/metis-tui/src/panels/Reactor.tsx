// Reactor: fuel-flow throttle (drives power output live via Formula 1),
// ignition once the cooling interlock clears, and the coupling switch that
// gates whether the reactor's output reaches the capacitors.
import type { MouseEvent } from "@opentui/core";
import { TextAttributes } from "@opentui/core";
import { type ReactNode, useCallback } from "react";
import { Bar } from "../components/Bar.tsx";
import { Knob, type KnobMode } from "../components/Knob.tsx";
import { NoPower } from "../components/NoPower.tsx";
import { Switch } from "../components/Switch.tsx";
import { formatTW } from "../format.ts";
import { TORCH_REFERENCE, reactorPowerWatts } from "../physics/torch.ts";
import { REACTOR_START_INTERLOCK_FLOW, useShip } from "../state/ship.tsx";

const FUEL_FLOW_OPTIONS_G_S = [250, 500, 1000, 2000, 5000] as const;
const FUEL_FLOW_MODES: readonly [KnobMode, KnobMode, ...KnobMode[]] =
    FUEL_FLOW_OPTIONS_G_S.map((g) => ({label: `${g} g/s`})) as [KnobMode, KnobMode, ...KnobMode[]];

function statusColor(reactorState: string): string {
    switch (reactorState) {
        case "running": return "#00FF88";
        case "starting": return "#FFFF00";
        default: return "#888888";
    }
}

export function ReactorPanel(): ReactNode {
    const {state, dispatch} = useShip();
    const interlockOk = state.coolingFlow >= REACTOR_START_INTERLOCK_FLOW;
    const canStart = state.reactorState === "off" && interlockOk && state.primaryBusConnected;
    const powerOutputW = reactorPowerWatts(state.fuelFlowGramsPerSec);

    const handleStart = useCallback((event: MouseEvent): void => {
        if (canStart) {
            dispatch({type: "startReactor"});
        }
        event.stopPropagation();
    }, [dispatch, canStart]);

    const buttonLabel = state.reactorState === "running"
        ? "REACTOR ONLINE"
        : state.reactorState === "starting"
            ? "IGNITING…"
            : interlockOk
                ? "ENGAGE REACTOR"
                : "COOLANT FLOW REQUIRED";

    return <box
        border
        borderStyle="single"
        flexDirection="column"
        flexGrow={1}
        alignItems="stretch"
        padding={1}
    >
        <box alignItems="center">
            <text attributes={TextAttributes.DIM}>Reactor</text>
        </box>

        {!state.auxBusConnected
            ? <NoPower/>
            : <>
                <box flexDirection="row" justifyContent="space-between" marginTop={1}>
                    <text fg="#888888">Status</text>
                    <text fg={statusColor(state.reactorState)}>{state.reactorState.toUpperCase()}</text>
                </box>

                {state.reactorState === "starting" &&
                    <box flexDirection="row" justifyContent="space-between">
                        <text fg="#888888">Spool-up</text>
                        <Bar value={state.reactorStartProgress} width={16} fillColor="#FFFF00"/>
                    </box>
                }

                <box flexDirection="row" justifyContent="space-between">
                    <text fg="#888888">Capacitor feed</text>
                    <text fg={state.reactorCoupled ? "#00FF88" : "#555555"}>
                        {state.reactorCoupled
                            ? "CHARGING"
                            : state.reactorState === "running" ? "UNCOUPLED" : "—"}
                    </text>
                </box>

                <box flexDirection="row" justifyContent="space-between" marginTop={1}>
                    <text fg="#888888">Power output</text>
                    <text fg="#00FF88">{formatTW(powerOutputW)}</text>
                </box>

                <box flexDirection="row" justifyContent="space-between">
                    <text fg="#888888">Jet power (ref)</text>
                    <text fg="#666666">
                        {TORCH_REFERENCE.jetPowerTWRange[0]}–{TORCH_REFERENCE.jetPowerTWRange[1]} TW
                    </text>
                </box>

                <box marginTop={1}>
                    <Knob
                        label="Fuel flow"
                        width={20}
                        modes={FUEL_FLOW_MODES}
                        initialIndex={FUEL_FLOW_OPTIONS_G_S.indexOf(
                            state.fuelFlowGramsPerSec as (typeof FUEL_FLOW_OPTIONS_G_S)[number],
                        )}
                        onChange={(index) => dispatch({type: "setFuelFlow", gramsPerSec: FUEL_FLOW_OPTIONS_G_S[index]!})}
                    />
                </box>

                <box
                    onMouseDown={handleStart}
                    marginTop={1}
                    border
                    borderStyle="rounded"
                    borderColor={canStart ? "#00FF88" : "#666666"}
                    alignItems="center"
                    padding={0}
                >
                    <text fg={canStart ? "#00FF88" : "#555555"}>{buttonLabel}</text>
                </box>

                {state.reactorState === "running" &&
                    <box marginTop={1}>
                        <Switch
                            label={state.reactorCoupled ? "COUPLED TO CAPS" : "COUPLE TO CAPS"}
                            active={state.reactorCoupled}
                            onToggle={() => dispatch({type: "coupleReactor"})}
                        />
                    </box>
                }
            </>
        }
    </box>;
}
