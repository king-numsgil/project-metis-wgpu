// Pure simulation state + reducer, no React/renderer dependencies, so this
// same module can run inside the Worker thread that owns the sim tick loop.
//
// Systems, roughly in cold-start order:
//   - Aux bus / primary bus: the two SMES-cap bus-tie switches. Primary has
//     a hard charge-interlock; both gate everything downstream of them.
//   - Cooling: two pumps, each with a prime (timed, costs a little charge)
//     then power step. `coolingFlow` is the abstracted 0-100 ignition-gate
//     ramp; `coolantFlowKgS`/`fluidTempK`/`hullTempK` are the real,
//     lagged heat-management chain (see physics/heat.ts) — two different
//     "flow" concepts living side by side on purpose.
//   - Reactor: ignition once coolingFlow clears the interlock, then a
//     continuous ICF driver tax paid from the primary cap regardless of
//     coupling — coupling only gates whether the (much bigger) output
//     flows back (see physics/torch.ts).
//   - Aux systems: life support/lighting/galley, drawing on the aux cap
//     when the reactor isn't covering them, with a hard cutout on empty.
//
// Everywhere a real formula exists (physics/torch.ts, physics/fold.ts,
// physics/heat.ts), it's cited to the math/ docs. Everywhere one doesn't
// (pump/ignition draw, thermal lag time constants, aux battery sizing),
// the constant below says so.

import { FOLD_REFERENCE } from "../physics/fold.ts";
import {
    AMBIENT_HULL_TEMP_K,
    BASELINE_FLUID_TEMP_K,
    demandedFlowKgS,
    FLOW_LAG_TAU_S,
    fluidEquilibriumTempK,
    FLUID_TEMP_LAG_TAU_S,
    heatGeneratedWatts,
    hullEquilibriumTempK,
    HULL_TEMP_LAG_TAU_S,
    MAX_SINGLE_PUMP_FLOW_KG_S,
    relax,
} from "../physics/heat.ts";
import { percentPerTick } from "../physics/time.ts";
import { LASER_DRIVER_FRACTION, reactorPowerWatts } from "../physics/torch.ts";

interface AuxSystems {
    readonly lifeSupport: boolean;
    readonly lighting: boolean;
    readonly galley: boolean;
}

type ReactorState = "off" | "starting" | "running";

interface ShipState {
    readonly primaryCap: number; // 0-100, SMES bank — feeds the primary bus
    readonly auxCap: number; // 0-100, aux battery — feeds the aux bus
    readonly auxBusConnected: boolean; // aux cap tied into instrumentation + hotel loads
    readonly primaryBusConnected: boolean; // primary cap tied into the primary electrical system
    readonly primaryPumpPriming: boolean;
    readonly primaryPumpPrimeProgress: number; // 0-100 while priming
    readonly primaryPumpPrimed: boolean;
    readonly primaryPumpPowered: boolean;
    readonly secondaryPumpPriming: boolean;
    readonly secondaryPumpPrimeProgress: number;
    readonly secondaryPumpPrimed: boolean;
    readonly secondaryPumpPowered: boolean; // extra cooling capacity for full reactor output — not yet load-bearing
    // 0-100, driven by the primary pump once powered — gates the ignition
    // interlock. Distinct from coolantFlowKgS below: this one is an
    // abstracted gameplay-pacing ramp, not a physical flow rate.
    readonly coolingFlow: number;
    readonly fuelFlowGramsPerSec: number; // pilot-set D-He3 burn rate — drives reactor power via Formula 1
    readonly reactorState: ReactorState;
    readonly reactorStartProgress: number; // 0-100 while "starting"
    readonly reactorCoupled: boolean; // reactor output tied to both caps — recharge only flows once coupled
    readonly aux: AuxSystems;
    readonly coolantFlowKgS: number; // actual heat-management flow — lags toward pump-capacity-limited demand
    readonly fluidTempK: number; // lags toward its Q=mdot*cp*deltaT equilibrium
    readonly hullTempK: number; // lags toward its Formula-5 equilibrium
}

type ShipAction =
    | { type: "tick"; dt: number }
    | { type: "toggleAuxBus" }
    | { type: "togglePrimaryBus" }
    | { type: "togglePrimaryPumpPrime" }
    | { type: "togglePrimaryPumpPower" }
    | { type: "toggleSecondaryPumpPrime" }
    | { type: "toggleSecondaryPumpPower" }
    | { type: "setFuelFlow"; gramsPerSec: number }
    | { type: "startReactor" }
    | { type: "coupleReactor" }
    | { type: "toggleAux"; system: keyof AuxSystems };

const SMES_CAPACITY_PJ = FOLD_REFERENCE.smesCapacityPJ;

// Hard interlock: not enough charge in the primary cap to even attempt a cold start.
const PRIMARY_BUS_MIN_CHARGE = 20;
// Hard interlock: cooling loop must be flowing before ignition is even attempted.
const REACTOR_START_INTERLOCK_FLOW = 80;

// Gameplay-pacing constants below — no formula backs these, they're timed
// for how long a startup step should feel, not derived from anything.
const REACTOR_START_DURATION_S = 3; // ignition sequence length
const COOLING_SPOOL_RATE = 25; // coolingFlow %/s while the primary pump is powered
const COOLING_DECAY_RATE = 20; // coolingFlow %/s once the pump is off
const PUMP_PRIME_DURATION_S = 2; // wall-clock seconds to prime a pump before it can be powered
const DEFAULT_FUEL_FLOW_GRAMS_PER_SEC = 500; // canonical civilian-freighter burn rate

// Reactor power is Formula-1-derived (see physics/torch.ts) and scales live
// with the pilot's fuel flow selection. Pumps and ignition aren't documented
// anywhere — these are our own equipment, sized as small fractions of the
// *canonical* (500 g/s) reactor output so they don't scale with throttle and
// stay grounded in a real-world ballpark (real coolant pumps run roughly
// 0.1-0.2% of a reactor's thermal output; ignition transients — containment
// ramp-up, igniter capacitor discharge — are modeled as a bigger but still
// brief spike).
const CANONICAL_REACTOR_POWER_W = reactorPowerWatts(DEFAULT_FUEL_FLOW_GRAMS_PER_SEC);
const PUMP_DRAW_W = CANONICAL_REACTOR_POWER_W * 0.0015; // ~262 GW per pump while powered
const PUMP_PRIME_DRAW_W = PUMP_DRAW_W * 0.5; // priming sips less than full pump operation
const IGNITION_DRAW_W = CANONICAL_REACTOR_POWER_W * 0.02; // ~3.5 TW transient during "starting"
const AUX_RECHARGE_SKIM = 0.1; // aux cap gets a 10% skim of whatever the primary cap receives

// The aux battery is a much smaller reserve than the primary SMES bank — sized
// so that life support + lighting + galley, drawing a combined 25% of one
// coolant pump's rating, sustain for ~5.7h fully off the reactor.
const AUX_CAPACITY_PJ = 1.35;
const AUX_SYSTEM_DRAW_W = (PUMP_DRAW_W * 0.25) / 3; // ~21.9 GW per system

const NO_AUX_SYSTEMS: AuxSystems = {lifeSupport: false, lighting: false, galley: false};

function createInitialState(): ShipState {
    return {
        primaryCap: 60,
        auxCap: 60,
        auxBusConnected: false,
        primaryBusConnected: false,
        primaryPumpPriming: false,
        primaryPumpPrimeProgress: 0,
        primaryPumpPrimed: false,
        primaryPumpPowered: false,
        secondaryPumpPriming: false,
        secondaryPumpPrimeProgress: 0,
        secondaryPumpPrimed: false,
        secondaryPumpPowered: false,
        coolingFlow: 0,
        fuelFlowGramsPerSec: DEFAULT_FUEL_FLOW_GRAMS_PER_SEC,
        reactorState: "off",
        reactorStartProgress: 0,
        reactorCoupled: false,
        aux: NO_AUX_SYSTEMS,
        coolantFlowKgS: 0,
        fluidTempK: BASELINE_FLUID_TEMP_K,
        hullTempK: AMBIENT_HULL_TEMP_K,
    };
}

function clamp(n: number, lo = 0, hi = 100): number {
    return Math.min(hi, Math.max(lo, n));
}

function reducer(state: ShipState, action: ShipAction): ShipState {
    switch (action.type) {
        case "toggleAuxBus": {
            const auxBusConnected = !state.auxBusConnected;
            return {...state, auxBusConnected, aux: auxBusConnected ? state.aux : NO_AUX_SYSTEMS};
        }

        case "togglePrimaryBus": {
            if (!state.primaryBusConnected && state.primaryCap < PRIMARY_BUS_MIN_CHARGE) {
                return state; // hard interlock: not enough charge to attempt a cold start
            }
            const primaryBusConnected = !state.primaryBusConnected;
            return {
                ...state,
                primaryBusConnected,
                primaryPumpPowered: primaryBusConnected && state.primaryPumpPowered,
                secondaryPumpPowered: primaryBusConnected && state.secondaryPumpPowered,
            };
        }

        case "togglePrimaryPumpPrime": {
            if (!state.primaryBusConnected) return state;
            if (state.primaryPumpPrimed) {
                return {...state, primaryPumpPrimed: false, primaryPumpPowered: false};
            }
            if (state.primaryPumpPriming) {
                return {...state, primaryPumpPriming: false, primaryPumpPrimeProgress: 0};
            }
            return {...state, primaryPumpPriming: true, primaryPumpPrimeProgress: 0};
        }

        case "togglePrimaryPumpPower": {
            if (!state.primaryPumpPrimed) return state;
            return {...state, primaryPumpPowered: !state.primaryPumpPowered};
        }

        case "toggleSecondaryPumpPrime": {
            if (!state.primaryBusConnected) return state;
            if (state.secondaryPumpPrimed) {
                return {...state, secondaryPumpPrimed: false, secondaryPumpPowered: false};
            }
            if (state.secondaryPumpPriming) {
                return {...state, secondaryPumpPriming: false, secondaryPumpPrimeProgress: 0};
            }
            return {...state, secondaryPumpPriming: true, secondaryPumpPrimeProgress: 0};
        }

        case "toggleSecondaryPumpPower": {
            if (!state.secondaryPumpPrimed) return state;
            return {...state, secondaryPumpPowered: !state.secondaryPumpPowered};
        }

        case "setFuelFlow":
            return {...state, fuelFlowGramsPerSec: action.gramsPerSec};

        case "toggleAux": {
            if (!state.auxBusConnected) return state;
            return {...state, aux: {...state.aux, [action.system]: !state.aux[action.system]}};
        }

        case "startReactor": {
            if (state.reactorState !== "off" || state.coolingFlow < REACTOR_START_INTERLOCK_FLOW) {
                return state;
            }
            return {...state, reactorState: "starting", reactorStartProgress: 0};
        }

        case "coupleReactor": {
            if (state.reactorState !== "running") return state;
            return {...state, reactorCoupled: !state.reactorCoupled};
        }

        case "tick": {
            const {dt} = action;
            let primaryCap = state.primaryCap;
            let auxCap = state.auxCap;
            let coolingFlow = state.coolingFlow;
            let reactorState = state.reactorState;
            let reactorStartProgress = state.reactorStartProgress;
            let reactorCoupled = state.reactorCoupled;
            let aux = state.aux;

            let primaryPumpPriming = state.primaryPumpPriming;
            let primaryPumpPrimeProgress = state.primaryPumpPrimeProgress;
            let primaryPumpPrimed = state.primaryPumpPrimed;
            if (primaryPumpPriming) {
                primaryPumpPrimeProgress += (100 / PUMP_PRIME_DURATION_S) * dt;
                primaryCap = clamp(primaryCap - percentPerTick(PUMP_PRIME_DRAW_W, dt, SMES_CAPACITY_PJ));
                if (primaryPumpPrimeProgress >= 100) {
                    primaryPumpPriming = false;
                    primaryPumpPrimeProgress = 0;
                    primaryPumpPrimed = true;
                }
            }

            let secondaryPumpPriming = state.secondaryPumpPriming;
            let secondaryPumpPrimeProgress = state.secondaryPumpPrimeProgress;
            let secondaryPumpPrimed = state.secondaryPumpPrimed;
            if (secondaryPumpPriming) {
                secondaryPumpPrimeProgress += (100 / PUMP_PRIME_DURATION_S) * dt;
                primaryCap = clamp(primaryCap - percentPerTick(PUMP_PRIME_DRAW_W, dt, SMES_CAPACITY_PJ));
                if (secondaryPumpPrimeProgress >= 100) {
                    secondaryPumpPriming = false;
                    secondaryPumpPrimeProgress = 0;
                    secondaryPumpPrimed = true;
                }
            }

            if (state.primaryPumpPowered && primaryCap > 0) {
                coolingFlow = clamp(coolingFlow + COOLING_SPOOL_RATE * dt);
                primaryCap = clamp(primaryCap - percentPerTick(PUMP_DRAW_W, dt, SMES_CAPACITY_PJ));
            } else {
                coolingFlow = clamp(coolingFlow - COOLING_DECAY_RATE * dt);
            }
            if (state.secondaryPumpPowered && primaryCap > 0) {
                primaryCap = clamp(primaryCap - percentPerTick(PUMP_DRAW_W, dt, SMES_CAPACITY_PJ));
            }

            if (reactorState === "starting") {
                primaryCap = clamp(primaryCap - percentPerTick(IGNITION_DRAW_W, dt, SMES_CAPACITY_PJ));
                reactorStartProgress += (100 / REACTOR_START_DURATION_S) * dt;
                if (coolingFlow < REACTOR_START_INTERLOCK_FLOW) {
                    // Cooling collapsed mid-spool — ignition aborts, nothing gained.
                    reactorState = "off";
                    reactorStartProgress = 0;
                } else if (reactorStartProgress >= 100) {
                    reactorState = "running";
                    reactorStartProgress = 100;
                }
            }

            // Heat: reactor power -> waste heat -> demanded coolant flow (capped
            // by what pumps are actually installed and running) -> fluid temp ->
            // hull temp, each stage lagging toward its equilibrium rather than
            // jumping — see physics/heat.ts for the constants and reasoning.
            const heatGeneratedW = reactorState === "running"
                ? heatGeneratedWatts(reactorPowerWatts(state.fuelFlowGramsPerSec))
                : 0;
            const pumpCapacityKgS =
                (state.primaryPumpPowered ? MAX_SINGLE_PUMP_FLOW_KG_S : 0) +
                (state.secondaryPumpPowered ? MAX_SINGLE_PUMP_FLOW_KG_S : 0);
            const targetFlowKgS = Math.min(demandedFlowKgS(heatGeneratedW), pumpCapacityKgS);
            const coolantFlowKgS = relax(state.coolantFlowKgS, targetFlowKgS, FLOW_LAG_TAU_S, dt);

            const fluidTarget = fluidEquilibriumTempK(heatGeneratedW, coolantFlowKgS);
            const fluidTempK = relax(state.fluidTempK, fluidTarget, FLUID_TEMP_LAG_TAU_S, dt);

            const hullTarget = hullEquilibriumTempK(heatGeneratedW, coolantFlowKgS);
            const hullTempK = relax(state.hullTempK, hullTarget, HULL_TEMP_LAG_TAU_S, dt);

            const auxFedByReactor = reactorState === "running" && reactorCoupled;
            const activeAux = Object.values(aux).filter(Boolean).length;
            const auxLoadW = activeAux * AUX_SYSTEM_DRAW_W;

            if (reactorState === "running") {
                // ICF needs continuous driver power to keep firing — that tax is
                // paid from the primary cap regardless of coupling. Coupling only
                // gates whether the (much bigger) fusion output flows back.
                const reactorPowerW = reactorPowerWatts(state.fuelFlowGramsPerSec);
                const laserDriverW = reactorPowerW * LASER_DRIVER_FRACTION;
                if (reactorCoupled) {
                    primaryCap = clamp(primaryCap + percentPerTick(reactorPowerW - laserDriverW, dt, SMES_CAPACITY_PJ));
                    const auxSupplyW = reactorPowerW * AUX_RECHARGE_SKIM;
                    auxCap = clamp(auxCap + percentPerTick(auxSupplyW - auxLoadW, dt, AUX_CAPACITY_PJ));
                } else {
                    // Decoupled but still running: paying the driver tax, none of the output comes back.
                    primaryCap = clamp(primaryCap - percentPerTick(laserDriverW, dt, SMES_CAPACITY_PJ));
                    auxCap = clamp(auxCap - percentPerTick(auxLoadW, dt, AUX_CAPACITY_PJ));
                }
            } else {
                auxCap = clamp(auxCap - percentPerTick(auxLoadW, dt, AUX_CAPACITY_PJ));
            }

            if (auxCap <= 0 && !auxFedByReactor) {
                // Hard cutout: dead aux bank drops every aux system, no graceful brownout.
                aux = NO_AUX_SYSTEMS;
            }

            if (reactorState !== "running") {
                reactorCoupled = false;
            }

            return {
                ...state,
                primaryCap,
                auxCap,
                coolingFlow,
                primaryPumpPriming,
                primaryPumpPrimeProgress,
                primaryPumpPrimed,
                secondaryPumpPriming,
                secondaryPumpPrimeProgress,
                secondaryPumpPrimed,
                reactorState,
                reactorStartProgress,
                reactorCoupled,
                aux,
                coolantFlowKgS,
                fluidTempK,
                hullTempK,
            };
        }
    }
}

export {
    AUX_CAPACITY_PJ,
    AUX_RECHARGE_SKIM,
    AUX_SYSTEM_DRAW_W,
    createInitialState,
    IGNITION_DRAW_W,
    PRIMARY_BUS_MIN_CHARGE,
    PUMP_DRAW_W,
    PUMP_PRIME_DRAW_W,
    reducer,
    REACTOR_START_INTERLOCK_FLOW,
};
export type {AuxSystems, ReactorState, ShipAction, ShipState};
