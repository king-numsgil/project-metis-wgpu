// Primary (SMES) and aux capacitor banks: bus-tie switches, charge gauges,
// live in/out power rates, and the aux hotel-load toggles.
import { TextAttributes } from "@opentui/core";
import type { ReactNode } from "react";
import { Bar } from "../components/Bar.tsx";
import { Knob } from "../components/Knob.tsx";
import { NoPower } from "../components/NoPower.tsx";
import { Switch } from "../components/Switch.tsx";
import { formatPJPerSecond } from "../format.ts";
import { FOLD_REFERENCE, pjFromPercent } from "../physics/fold.ts";
import { grossJetPowerWatts, INDUCTION_COIL_POWER_SKIM_FRACTION, LASER_DRIVER_FRACTION, reactorPowerWatts } from "../physics/torch.ts";
import {
    AUX_CAPACITY_PJ,
    AUX_RECHARGE_SKIM,
    AUX_SYSTEM_DRAW_W,
    type AuxSystems,
    IGNITION_DRAW_W,
    PRIMARY_BUS_MIN_CHARGE,
    PUMP_DRAW_W,
    PUMP_PRIME_DRAW_W,
    useShip,
} from "../state/ship.tsx";

const AUX_LABELS: Record<keyof AuxSystems, string> = {
    lifeSupport: "Life support",
    lighting: "Lighting",
    galley: "Galley",
};

function formatPJ(pj: number): string {
    return Math.round(pj).toLocaleString();
}

function formatSmallPJ(pj: number): string {
    return pj.toFixed(3);
}

export function CapacitorPanel(): ReactNode {
    const {state, dispatch} = useShip();
    const activeAux = Object.values(state.aux).filter(Boolean).length;
    const fedByReactor = state.reactorState === "running" && state.reactorCoupled;
    const primaryBlocked = !state.primaryBusConnected && state.primaryCap < PRIMARY_BUS_MIN_CHARGE;

    // Matches shipSim.ts's tick handler exactly: thrust engaged means the
    // plasma's going out the nozzle, so only the induction coil's skim
    // reaches the primary cap instead of the full net-of-driver-tax rate.
    const primaryInW = fedByReactor
        ? state.thrustEngaged
            ? grossJetPowerWatts(state.fuelFlowGramsPerSec) * INDUCTION_COIL_POWER_SKIM_FRACTION
            : reactorPowerWatts(state.fuelFlowGramsPerSec) * (1 - LASER_DRIVER_FRACTION)
        : 0;
    const primaryOutW =
        (state.primaryPumpPowered ? PUMP_DRAW_W : 0) +
        (state.secondaryPumpPowered ? PUMP_DRAW_W : 0) +
        (state.primaryPumpPriming ? PUMP_PRIME_DRAW_W : 0) +
        (state.secondaryPumpPriming ? PUMP_PRIME_DRAW_W : 0) +
        (state.reactorState === "starting" ? IGNITION_DRAW_W : 0);

    // Aux gets a skim of whatever the primary actually receives, not of raw
    // reactor output — so it drops in step with the primary during thrust too.
    const auxInW = fedByReactor ? primaryInW * AUX_RECHARGE_SKIM : 0;
    const auxOutW = activeAux * AUX_SYSTEM_DRAW_W;

    return <box
        border
        borderStyle="single"
        flexDirection="column"
        flexGrow={1}
        alignItems="stretch"
        padding={1}
    >
        <box alignItems="center">
            <text attributes={TextAttributes.DIM}>Capacitor</text>
        </box>

        <box flexDirection="row" justifyContent="space-evenly" marginTop={1}>
            <Switch
                label={state.auxBusConnected ? "AUX BUS CONNECTED" : "AUX BUS DISCONNECTED"}
                active={state.auxBusConnected}
                onToggle={() => dispatch({type: "toggleAuxBus"})}
            />
            <Switch
                label={state.primaryBusConnected ? "PRIMARY BUS CONNECTED" : "PRIMARY BUS DISCONNECTED"}
                active={state.primaryBusConnected}
                blocked={primaryBlocked}
                onToggle={() => dispatch({type: "togglePrimaryBus"})}
            />
        </box>

        {!state.auxBusConnected
            ? <NoPower/>
            : <>
                <box flexDirection="row" justifyContent="space-between" marginTop={1}>
                    <text fg="#888888">Primary</text>
                    <Bar
                        value={state.primaryCap}
                        width={16}
                        fillColor={state.primaryCap < 15 ? "#FF4444" : "#00FF88"}
                    />
                </box>

                <box flexDirection="row" justifyContent="flex-end">
                    <text fg="#666666">
                        {formatPJ(pjFromPercent(state.primaryCap))} / {formatPJ(FOLD_REFERENCE.smesCapacityPJ)} PJ
                    </text>
                </box>

                <box flexDirection="row" justifyContent="space-between">
                    <text fg="#888888">Primary coil in</text>
                    <text fg={primaryInW > 0 ? "#00FF88" : "#555555"}>{formatPJPerSecond(primaryInW)}</text>
                </box>
                <box flexDirection="row" justifyContent="space-between">
                    <text fg="#888888">Primary coil out</text>
                    <text fg={primaryOutW > 0 ? "#FF9900" : "#555555"}>{formatPJPerSecond(primaryOutW)}</text>
                </box>

                <box flexDirection="row" justifyContent="space-between" marginTop={1}>
                    <text fg="#888888">Aux</text>
                    <Bar
                        value={state.auxCap}
                        width={16}
                        fillColor={state.auxCap < 15 ? "#FF4444" : "#00CCFF"}
                    />
                </box>

                <box flexDirection="row" justifyContent="flex-end">
                    <text fg="#666666">
                        {formatSmallPJ((state.auxCap / 100) * AUX_CAPACITY_PJ)} / {formatSmallPJ(AUX_CAPACITY_PJ)} PJ
                    </text>
                </box>

                <box flexDirection="row" justifyContent="space-between">
                    <text fg="#888888">Aux coil in</text>
                    <text fg={auxInW > 0 ? "#00CCFF" : "#555555"}>{formatPJPerSecond(auxInW)}</text>
                </box>
                <box flexDirection="row" justifyContent="space-between">
                    <text fg="#888888">Aux coil out</text>
                    <text fg={auxOutW > 0 ? "#FF9900" : "#555555"}>{formatPJPerSecond(auxOutW)}</text>
                </box>

                <box flexDirection="row" justifyContent="space-between">
                    <text fg="#888888">Aux bus</text>
                    <text fg={fedByReactor ? "#555555" : "#FFFF00"}>
                        {fedByReactor ? "fed by reactor" : `${activeAux} drawing on cap`}
                    </text>
                </box>

                <box flexDirection="row" justifyContent="space-evenly" marginTop={1}>
                    {(Object.keys(state.aux) as (keyof AuxSystems)[]).map((system) => (
                        <Knob
                            key={`${system}:${state.aux[system]}`}
                            label={AUX_LABELS[system]}
                            width={16}
                            modes={[{label: "OFF"}, {label: "ON"}]}
                            initialIndex={state.aux[system] ? 1 : 0}
                            onChange={() => dispatch({type: "toggleAux", system})}
                        />
                    ))}
                </box>
            </>
        }
    </box>;
}
