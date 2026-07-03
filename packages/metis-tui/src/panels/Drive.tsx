// Torch drive thrust: neon doping dilutes the exhaust mass flow to trade
// exhaust velocity for thrust (Formula 2/3), and an induction coil skims a
// little of that velocity back to the caps while engaged — see
// physics/torch.ts for the breakdown. Thrust/v_e are pure functions of the
// *actual* (lagged) doping ratio shipSim.ts's tick handler tracks — the
// neon valve spools toward the pilot's dial rather than snapping to it.
import { TextAttributes } from "@opentui/core";
import type { ReactNode } from "react";
import { Bar } from "../components/Bar.tsx";
import { Knob, type KnobMode } from "../components/Knob.tsx";
import { NoPower } from "../components/NoPower.tsx";
import { Switch } from "../components/Switch.tsx";
import { formatMassKg, formatThrustN, formatVelocityKmS } from "../format.ts";
import {
    exhaustVelocityMPerS,
    grossJetPowerWatts,
    INDUCTION_COIL_POWER_SKIM_FRACTION,
    thrustNewtons,
    TORCH_REFERENCE,
} from "../physics/torch.ts";
import { NEON_RESERVE_INITIAL_KG, useShip } from "../state/ship.tsx";

const STANDARD_GRAVITY_M_S2 = 9.80665;
const DRY_MASS_KG = TORCH_REFERENCE.dryMassTonnes * 1000;

const DOPING_RATIO_OPTIONS = [0, 1, 3, 5, 10] as const;
const DOPING_RATIO_MODES: readonly [KnobMode, KnobMode, ...KnobMode[]] =
    DOPING_RATIO_OPTIONS.map((r) => ({label: `${r}x`})) as [KnobMode, KnobMode, ...KnobMode[]];

export function DrivePanel(): ReactNode {
    const {state, dispatch} = useShip();

    const neonFraction = state.neonReserveKg / NEON_RESERVE_INITIAL_KG;
    const canEngageThrust = state.thrustEngaged || state.reactorState === "running";

    const neonFlowGramsPerSec = state.thrustEngaged ? state.fuelFlowGramsPerSec * state.neonDopingActualRatio : 0;
    const totalExhaustFlowKgS = state.thrustEngaged ? (state.fuelFlowGramsPerSec + neonFlowGramsPerSec) / 1000 : 0;

    const grossJetPowerW = grossJetPowerWatts(state.fuelFlowGramsPerSec);
    const netJetPowerW = grossJetPowerW * (1 - INDUCTION_COIL_POWER_SKIM_FRACTION);
    const veMPerS = state.thrustEngaged ? exhaustVelocityMPerS(netJetPowerW, totalExhaustFlowKgS) : 0;
    const thrustN = state.thrustEngaged ? thrustNewtons(netJetPowerW, veMPerS) : 0;
    // Wet mass — as the neon reserve burns down, the same thrust yields more
    // acceleration, same as any rocket getting lighter as it burns propellant.
    // D-He3 fuel mass isn't tracked/depleted anywhere yet, so it's not
    // included here — a much smaller effect than the neon reserve anyway.
    const currentShipMassKg = DRY_MASS_KG + state.neonReserveKg;
    const accelerationG = thrustN / (currentShipMassKg * STANDARD_GRAVITY_M_S2);

    return <box
        border
        borderStyle="single"
        flexDirection="column"
        flexGrow={1}
        alignItems="stretch"
        padding={1}
    >
        <box alignItems="center">
            <text attributes={TextAttributes.DIM}>Drive</text>
        </box>

        {!state.auxBusConnected
            ? <NoPower/>
            : <>
                <box flexDirection="row" justifyContent="space-between" marginTop={1}>
                    <text fg="#888888">Neon reserve</text>
                    <Bar value={Math.max(0, Math.min(100, neonFraction * 100))} width={16} fillColor="#00CCFF"/>
                </box>
                <box flexDirection="row" justifyContent="flex-end">
                    <text fg="#666666">{formatMassKg(state.neonReserveKg)} / {formatMassKg(NEON_RESERVE_INITIAL_KG)}</text>
                </box>

                <box marginTop={1}>
                    <Knob
                        label="Neon doping"
                        width={20}
                        modes={DOPING_RATIO_MODES}
                        initialIndex={DOPING_RATIO_OPTIONS.indexOf(
                            state.dopingRatio as (typeof DOPING_RATIO_OPTIONS)[number],
                        )}
                        onChange={(index) => dispatch({type: "setDopingRatio", ratio: DOPING_RATIO_OPTIONS[index]!})}
                    />
                </box>

                <box marginTop={1}>
                    <Switch
                        label={state.thrustEngaged ? "THRUST ENGAGED" : "THRUST DISENGAGED"}
                        active={state.thrustEngaged}
                        disabled={!canEngageThrust}
                        onToggle={() => dispatch({type: "toggleThrustEngaged"})}
                    />
                </box>

                <box flexDirection="row" justifyContent="space-between" marginTop={1}>
                    <text fg="#888888">Exhaust velocity</text>
                    <text fg={state.thrustEngaged ? "#00FF88" : "#555555"}>{formatVelocityKmS(veMPerS)}</text>
                </box>
                <box flexDirection="row" justifyContent="space-between">
                    <text fg="#888888">Thrust</text>
                    <text fg={state.thrustEngaged ? "#00FF88" : "#555555"}>{formatThrustN(thrustN)}</text>
                </box>
                <box flexDirection="row" justifyContent="space-between">
                    <text fg="#888888">Acceleration</text>
                    <text fg={state.thrustEngaged ? "#00FF88" : "#555555"}>{accelerationG.toFixed(2)}g</text>
                </box>
            </>
        }
    </box>;
}
