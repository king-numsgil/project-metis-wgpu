// Coolant loop: pump prime/power controls, plus the heat-management chain
// (flow rate -> fluid temp -> hull temp -> radiator flux) read straight off
// ship state — see shipSim.ts's tick handler for where that chain lags.
import type { MouseEvent } from "@opentui/core";
import { TextAttributes } from "@opentui/core";
import { type ReactNode, useCallback } from "react";
import { Bar } from "../components/Bar.tsx";
import { NoPower } from "../components/NoPower.tsx";
import { Switch } from "../components/Switch.tsx";
import { formatFlowKgS, formatFluxWm2, formatKelvin } from "../format.ts";
import {
    HEATSINK_SLUG_COUNT,
    HEATSINK_SLUG_TOTAL_CAPACITY_J,
    HULL_MELTING_POINT_K,
    LITHIUM_BOILING_POINT_K,
    MAX_SINGLE_PUMP_FLOW_KG_S,
    radiatorFluxFromHullTempWm2,
} from "../physics/heat.ts";
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
    // Against the 2-pump theoretical ceiling, not the abstracted ignition-gate
    // ramp — so it reflects real flow regardless of which pump(s) are running.
    const flowPercentOfMax = (flowKgS / (2 * MAX_SINGLE_PUMP_FLOW_KG_S)) * 100;
    const fluid = state.fluidTempK;
    const hull = state.hullTempK;
    const flux = radiatorFluxFromHullTempWm2(hull);
    const fluidCritical = fluid >= LITHIUM_BOILING_POINT_K;
    const hullCritical = hull >= HULL_MELTING_POINT_K;

    const slugFillPercent = (state.heatsinkSlugAbsorbedJ / HEATSINK_SLUG_TOTAL_CAPACITY_J) * 100;
    const heatsinkReady = !state.heatsinkDeployed && state.heatsinkSlugsRemaining > 0;
    const heatsinkLabel = state.heatsinkSlugsRemaining <= 0
        ? "CARTRIDGE EMPTY"
        : state.heatsinkDeployed
            ? "DUMPING HEAT…"
            : "DEPLOY HEATSINK SLUG";

    const handleDeployHeatsink = useCallback((event: MouseEvent): void => {
        if (heatsinkReady) {
            dispatch({type: "deployHeatsinkSlug"});
        }
        event.stopPropagation();
    }, [dispatch, heatsinkReady]);

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
                    <Bar value={Math.max(0, Math.min(100, flowPercentOfMax))} width={16}/>
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
                    <text fg="#888888">Superstructure</text>
                    <text fg={state.superstructureTempK > 300 ? "#CCCCCC" : "#555555"}>
                        {formatKelvin(state.superstructureTempK)}
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

                <box flexDirection="row" justifyContent="space-between" marginTop={1}>
                    <text fg="#888888">Heatsink</text>
                    <text fg="#666666">
                        {Array.from({length: HEATSINK_SLUG_COUNT}, (_, i) =>
                            i < state.heatsinkSlugsRemaining ? "●" : "○").join(" ")}
                    </text>
                </box>
                {state.heatsinkDeployed &&
                    <Bar value={slugFillPercent} width={16} fillColor="#00CCFF"/>
                }
                <box
                    onMouseDown={handleDeployHeatsink}
                    marginTop={state.heatsinkDeployed ? 0 : 1}
                    border
                    borderStyle="rounded"
                    borderColor={heatsinkReady ? "#00CCFF" : "#666666"}
                    alignItems="center"
                    padding={0}
                >
                    <text fg={heatsinkReady ? "#00CCFF" : "#555555"}>{heatsinkLabel}</text>
                </box>
            </>
        }
    </box>;
}
