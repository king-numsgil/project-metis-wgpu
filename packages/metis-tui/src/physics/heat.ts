// Formula 5 (Fusion torch doc) — waste heat radiated from a fixed-area
// hull-mounted radiator: P = epsilon * sigma * A * T^4. The doc's own
// conclusion is that hull-mounted radiators (a few thousand m², not
// millions) need a structural waste fraction below ~0.01%. Set to half that
// (0.005%) here — a deliberate, acknowledged fudge. Originally introduced
// to keep fuel-flow tiers usable after moving off hafnium carbide; kept
// unchanged through the later material swaps below, which now cover the
// whole fuel-flow range on their own (see HULL_FIN_AREA_MULTIPLIER).
const WASTE_FRACTION = 0.00005;

// Not documented — a design estimate for this reference ship's exterior
// radiator *footprint* (the flat, hull-skin area). Distinct from the
// effective radiating area below, which is larger due to fin geometry.
const HULL_RADIATOR_AREA_M2 = 3000;
const STEFAN_BOLTZMANN = 5.67e-8;
const AMBIENT_HULL_TEMP_K = 300; // cold-and-dark baseline — a lived-in ship, not deep space (2.7K)

// Hull radiator: a two-layer system, because temperature (T^4) and
// emissivity (linear) are solved by different engineering choices in real
// thermal-protection design, and modeling them as one material was the
// mistake in every earlier version of this file.
//   - Structural substrate: Ta4HfC5-class ultra-high-temperature carbide,
//     real measured melting point ~4,178K (the widely-cited 4,215K figure
//     traces to a 1930s unit-conversion error — using the corrected value).
//   - Emissivity coating: ZrB2-SiC, a real UHTC coating system used on
//     hypersonic leading edges, measured 0.85-0.9 emissivity depending on
//     formulation/temperature — using the same 0.88 used for the
//     (rejected) GRC-9 proposal.
// At this area, even the 5000 g/s (carrier) tier now only *just* survives
// at equilibrium (~65K margin) rather than blowing past the limit — see
// HULL_FIN_AREA_MULTIPLIER below for why.
const RADIATOR_EMISSIVITY = 0.88;
const HULL_MELTING_POINT_K = 4178;

// Real radiator engineering (ISS panels, terrestrial heat exchangers)
// extends *effective* radiating area past the flat footprint via fins,
// without growing the ship's silhouette — plausible for a "3rd millennium"
// hull via additive-manufactured fin/lattice geometry baked into the skin.
// 2x is deliberately conservative: real finned exchangers often do better,
// but this is a warship, and denser fin structures trade away structural
// strength — not a call to push further without a reason to.
const HULL_FIN_AREA_MULTIPLIER = 2;
const HULL_EFFECTIVE_RADIATOR_AREA_M2 = HULL_RADIATOR_AREA_M2 * HULL_FIN_AREA_MULTIPLIER;

// Coolant: liquid lithium — the standard coolant/breeder choice in real
// fusion reactor concepts, real specific heat ~4380 J/kg-K, handles the
// glowing-hot end of a compact hull radiator loop without needing the heavy
// pressurization a water loop would (liquid at 454-1615K at 1atm — the
// upper end is this module's CRITICAL threshold below). Not documented: the
// per-pump flow ceiling and the control system's target delta-T.
const COOLANT_SPECIFIC_HEAT_J_KG_K = 4380;
const LITHIUM_BOILING_POINT_K = 1615;
const MAX_SINGLE_PUMP_FLOW_KG_S = 13_300; // one pump's rating — two pumps double the ceiling
const BASELINE_FLUID_TEMP_K = 300;
const TARGET_FLUID_DELTA_T_K = 300; // the flow controller's setpoint: hold the loop this far above baseline
const CRITICAL_FLUID_TEMP_CAP_K = 20_000; // numerical ceiling for the "no flow, heat has nowhere to go" case

// Not documented — thermal/mechanical inertia time constants (wall-clock
// seconds to close ~63% of the gap to a new target). No formula backs
// these; they're paced for gameplay feel, cascading pump -> fluid -> hull
// so each stage visibly catches up to the last rather than jumping.
const FLOW_LAG_TAU_S = 3;
const FLUID_TEMP_LAG_TAU_S = 5;
const HULL_TEMP_LAG_TAU_S = 10;

function heatGeneratedWatts(reactorPowerW: number): number {
    return reactorPowerW * WASTE_FRACTION;
}

// How much flow the control system WANTS to hold the design delta-T at the
// current heat load. The caller clamps this against the pumps' physical
// rating — demand can exceed what's actually installed and running.
function demandedFlowKgS(heatGeneratedW: number): number {
    if (heatGeneratedW <= 0) return 0;
    return heatGeneratedW / (COOLANT_SPECIFIC_HEAT_J_KG_K * TARGET_FLUID_DELTA_T_K);
}

// Equilibrium fluid temperature the loop is heading toward, given current
// heat load and ACTUAL (possibly lagging, possibly capacity-limited) flow.
function fluidEquilibriumTempK(heatGeneratedW: number, flowKgS: number): number {
    if (heatGeneratedW <= 0) return BASELINE_FLUID_TEMP_K;
    if (flowKgS <= 0) return CRITICAL_FLUID_TEMP_CAP_K;
    return Math.min(
        CRITICAL_FLUID_TEMP_CAP_K,
        BASELINE_FLUID_TEMP_K + heatGeneratedW / (flowKgS * COOLANT_SPECIFIC_HEAT_J_KG_K),
    );
}

// Equilibrium hull temperature (Formula 5), against the *effective*
// (finned) radiating area, not the flat footprint. As long as SOME coolant
// is moving, all generated heat eventually reaches the hull (just via a
// hotter fluid if flow is short of demand) — only a fully stalled loop
// traps heat at the reactor instead of delivering it.
function hullEquilibriumTempK(heatGeneratedW: number, flowKgS: number): number {
    if (heatGeneratedW <= 0 || flowKgS <= 0) return AMBIENT_HULL_TEMP_K;
    return Math.pow(heatGeneratedW / (RADIATOR_EMISSIVITY * STEFAN_BOLTZMANN * HULL_EFFECTIVE_RADIATOR_AREA_M2), 0.25);
}

// Actual instantaneous flux radiated by the hull at its current (possibly
// still-lagging) temperature — Formula 5 applied forward. Not an
// independent lag: flux is bound to hull temp, which already carries one.
function radiatorFluxFromHullTempWm2(hullK: number): number {
    return RADIATOR_EMISSIVITY * STEFAN_BOLTZMANN * Math.pow(hullK, 4);
}

// First-order relaxation toward a target — thermal/mechanical inertia.
function relax(current: number, target: number, tauSeconds: number, dt: number): number {
    return current + (target - current) * Math.min(1, dt / tauSeconds);
}

export {
    AMBIENT_HULL_TEMP_K,
    BASELINE_FLUID_TEMP_K,
    demandedFlowKgS,
    FLOW_LAG_TAU_S,
    fluidEquilibriumTempK,
    FLUID_TEMP_LAG_TAU_S,
    heatGeneratedWatts,
    HULL_EFFECTIVE_RADIATOR_AREA_M2,
    HULL_FIN_AREA_MULTIPLIER,
    HULL_MELTING_POINT_K,
    HULL_RADIATOR_AREA_M2,
    hullEquilibriumTempK,
    HULL_TEMP_LAG_TAU_S,
    LITHIUM_BOILING_POINT_K,
    MAX_SINGLE_PUMP_FLOW_KG_S,
    radiatorFluxFromHullTempWm2,
    relax,
    WASTE_FRACTION,
};
