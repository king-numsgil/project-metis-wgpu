// Coolant loop: pump prime/power controls, plus the heat-management chain
// (flow rate -> fluid temp -> hull temp -> radiator flux) read straight off
// ship state — see shipSim.ts's tick handler for where that chain lags.
import { TextAttributes } from "@opentui/core";
import type { ReactNode } from "react";
import { Bar } from "../components/Bar.tsx";
import { NoPower } from "../components/NoPower.tsx";
import { Switch } from "../components/Switch.tsx";
import { formatFlowKgS, formatFluxWm2, formatKelvin } from "../format.ts";
import { HULL_MELTING_POINT_K, LITHIUM_BOILING_POINT_K, radiatorFluxFromHullTempWm2 } from "../physics/heat.ts";
import { useShip } from "../state/ship.tsx";

function pumpLabel(priming: boolean, primed: boolean, powered: boolean): string {
    if (priming) return "PRIMING";
    if (!primed) return "UNPRIMED";
    return powered ? "RUNNING" : "PRIMED";
}

function pumpColor(label: string): string {
    switch (label) {
        case "RUNNING": return "#00FF88";
        case "PRIMED": return "#FFFF00";
        case "PRIMING": return "#FF9900";
        default: return "#555555";
    }
}

export function CoolingPanel(): ReactNode {
    const {state, dispatch} = useShip();
    const primaryStatus = pumpLabel(state.primaryPumpPriming, state.primaryPumpPrimed, state.primaryPumpPowered);
    const secondaryStatus = pumpLabel(state.secondaryPumpPriming, state.secondaryPumpPrimed, state.secondaryPumpPowered);

    const flowKgS = state.coolantFlowKgS;
    const fluid = state.fluidTempK;
    const hull = state.hullTempK;
    const flux = radiatorFluxFromHullTempWm2(hull);
    const fluidCritical = fluid >= LITHIUM_BOILING_POINT_K;
    const hullCritical = hull >= HULL_MELTING_POINT_K;

    return <box
        border
        borderStyle="single"
        flexDirection="column"
        flexGrow={1}
        alignItems="stretch"
        padding={1}
    >
        <box alignItems="center">
            <text attributes={TextAttributes.DIM}>Cooling</text>
        </box>

        {!state.auxBusConnected
            ? <NoPower/>
            : <>
                <box flexDirection="row" justifyContent="space-between" marginTop={1}>
                    <text fg="#888888">Flow</text>
                    <Bar value={state.coolingFlow} width={16}/>
                </box>
                <box flexDirection="row" justifyContent="flex-end">
                    <text fg="#666666">{formatFlowKgS(flowKgS)}</text>
                </box>

                <box flexDirection="row" justifyContent="space-between">
                    <text fg="#888888">Fluid temp</text>
                    <text fg={fluidCritical ? "#FF4444" : fluid > 1200 ? "#FF9900" : "#00CCFF"}>
                        {formatKelvin(fluid)}
                    </text>
                </box>

                <box flexDirection="row" justifyContent="space-between">
                    <text fg="#888888">Hull temp</text>
                    <text fg={hullCritical ? "#FF4444" : hull > 3700 ? "#FF9900" : hull > 300 ? "#FFFF00" : "#555555"}>
                        {hullCritical ? "MELTING" : formatKelvin(hull)}
                    </text>
                </box>
                <box flexDirection="row" justifyContent="space-between">
                    <text fg="#888888">Radiator flux</text>
                    <text fg={flux > 0 ? "#FF9900" : "#555555"}>{formatFluxWm2(flux)}</text>
                </box>

                <box flexDirection="row" justifyContent="space-between" marginTop={1}>
                    <text fg="#888888">Primary pump</text>
                    <text fg={pumpColor(primaryStatus)}>{primaryStatus}</text>
                </box>
                {state.primaryPumpPriming &&
                    <Bar value={state.primaryPumpPrimeProgress} width={16} fillColor="#FF9900"/>
                }
                <box flexDirection="row" justifyContent="space-evenly">
                    <Switch
                        label="PRIME"
                        active={state.primaryPumpPrimed || state.primaryPumpPriming}
                        disabled={!state.primaryBusConnected}
                        onToggle={() => dispatch({type: "togglePrimaryPumpPrime"})}
                    />
                    <Switch
                        label="POWER"
                        active={state.primaryPumpPowered}
                        disabled={!state.primaryPumpPrimed}
                        onToggle={() => dispatch({type: "togglePrimaryPumpPower"})}
                    />
                </box>

                <box flexDirection="row" justifyContent="space-between" marginTop={1}>
                    <text fg="#888888">Secondary pump</text>
                    <text fg={pumpColor(secondaryStatus)}>{secondaryStatus}</text>
                </box>
                {state.secondaryPumpPriming &&
                    <Bar value={state.secondaryPumpPrimeProgress} width={16} fillColor="#FF9900"/>
                }
                <box flexDirection="row" justifyContent="space-evenly">
                    <Switch
                        label="PRIME"
                        active={state.secondaryPumpPrimed || state.secondaryPumpPriming}
                        disabled={!state.primaryBusConnected}
                        onToggle={() => dispatch({type: "toggleSecondaryPumpPrime"})}
                    />
                    <Switch
                        label="POWER"
                        active={state.secondaryPumpPowered}
                        disabled={!state.secondaryPumpPrimed}
                        onToggle={() => dispatch({type: "toggleSecondaryPumpPower"})}
                    />
                </box>
            </>
        }
    </box>;
}
