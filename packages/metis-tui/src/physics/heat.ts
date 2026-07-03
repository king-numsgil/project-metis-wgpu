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
// Not documented — real centrifugal pumps run a minimum recirculation flow
// whenever they're powered, load or no load, to avoid deadheading/overheating
// the pump itself. Sized as 10% of rated capacity per pump. Without this, a
// powered pump with the reactor still off shows 0 kg/s the whole startup
// sequence, which doesn't match a pump that's audibly, physically running.
const MIN_PUMP_FLOW_KG_S = MAX_SINGLE_PUMP_FLOW_KG_S * 0.1;
const BASELINE_FLUID_TEMP_K = 300;
const TARGET_FLUID_DELTA_T_K = 300; // the flow controller's setpoint: hold the loop this far above baseline
const CRITICAL_FLUID_TEMP_CAP_K = 20_000; // numerical ceiling for the "no flow, heat has nowhere to go" case

// --- Thermal mass network -------------------------------------------------
//
// Three lumped-capacitance nodes, each C = mass * specific heat, driven by
// real Q_in/Q_out energy balances rather than independent "chase this
// equilibrium with an arbitrary tau" formulas (the old approach let hull
// and fluid drift out of energy-conservation sync with each other — e.g. a
// stalled pump had no mechanism forcing "heat trapped in fluid" and "no
// heat reaching hull" to be the same physical event). Integrated with plain
// explicit Euler at the sim's existing 10Hz tick (see shipSim.ts) — dt is
// small enough relative to every node's response time here to stay stable.
//
// For a 1000t dry-mass reference hull (see torch.ts), with hull +
// superstructure combined budgeted at 10-15% of dry mass (not derived here,
// a structural-fraction estimate) split roughly 2:1 hull:superstructure:
const HULL_MASS_KG = 80_000; // ~8% of dry mass — radiator/armor substrate
const SUPERSTRUCTURE_MASS_KG = 40_000; // ~4% of dry mass — secondary structure, bolted to the hull but not built to radiate

// Loop inventory, sized off channel-volume reasoning (see math/ discussion):
// a ~2-3cm coolant channel layer across the hull radiator footprint at
// liquid lithium's ~500 kg/m3 lands around 40t. Plumbing (pump housings,
// piping, heat-exchanger core) isn't the coolant itself but sits in tight
// thermal contact with it — equilibrates on a much faster timescale with
// the fluid than with anything on the hull side — so its mass is folded
// into the fluid node's capacitance rather than the hull's.
const COOLANT_MASS_KG = 40_000;
const PLUMBING_MASS_KG = 60_000; // sized ~1.5x coolant mass — compact, lightweight loop hardware by real-engineering standards, not a real derivation

// Ta4HfC5's classical (Dulong-Petit) high-temperature specific-heat ceiling
// works out to ~259 J/kg-K (10 atoms/formula unit * 3R, / 962 g/mol formula
// mass). Real UHTC carbides measure somewhat above that near their
// operating extremes (electronic + anharmonic contributions), landing
// ~270-300 J/kg-K. 325 is a modest, acknowledged stretch past the top of
// real measured data — "better manufacturing and trace additives," not a
// fantasy number.
const HULL_SPECIFIC_HEAT_J_KG_K = 325;
// Generic aerospace steel/titanium-alloy structure (Ti-6Al-4V-class) —
// doesn't need the hull's exotic high-temp carbide since it was never meant
// to run anywhere near as hot. Real titanium/steel specific heats land
// ~450-530 J/kg-K, so 500 sits right in that range unmodified.
const SUPERSTRUCTURE_SPECIFIC_HEAT_J_KG_K = 500;
// Real titanium/steel structural alloys melt in the ~1700-1940K range —
// well *below* the hull's 4178K carbide ceiling, and below the hull's own
// steady-state operating temperature at canonical fuel flow. Superstructure
// cooking off before the actual radiator does is a real, intended risk of
// this design, not an oversight.
const SUPERSTRUCTURE_MELTING_POINT_K = 1800;
// Bare/untreated structural metal — no engineered high-emissivity coating
// like the hull's ZrB2-SiC layer, so it radiates far less efficiently per
// unit area (real polished/oxidized metal emissivity: ~0.1-0.3).
const SUPERSTRUCTURE_EMISSIVITY = 0.2;
// Not derived from a real hull-layout estimate — assumed smaller than the
// hull's 3000 m2 footprint in proportion to its smaller mass share, and
// with no fin multiplier since it isn't finned radiator geometry.
const SUPERSTRUCTURE_RADIATOR_AREA_M2 = 1500;
// Generic refractory structural alloy (Inconel/niobium/molybdenum-class)
// for pump housings and the heat-exchanger core — real values for any of
// these land in the same 250-450 J/kg-K neighborhood, so the specific
// choice doesn't matter much.
const PLUMBING_SPECIFIC_HEAT_J_KG_K = 350;

const FLUID_NODE_CAPACITANCE_J_PER_K =
    COOLANT_MASS_KG * COOLANT_SPECIFIC_HEAT_J_KG_K + PLUMBING_MASS_KG * PLUMBING_SPECIFIC_HEAT_J_KG_K;
const HULL_CAPACITANCE_J_PER_K = HULL_MASS_KG * HULL_SPECIFIC_HEAT_J_KG_K;
const SUPERSTRUCTURE_CAPACITANCE_J_PER_K = SUPERSTRUCTURE_MASS_KG * SUPERSTRUCTURE_SPECIFIC_HEAT_J_KG_K;

// --- Emergency heatsink cartridge ------------------------------------------
//
// A consumable, open-cycle PCM heat dump clamped against the hull when
// deployed — the Elite Dangerous "heatsink" concept, and the doc's own
// `heat_sink_cap` ship-class parameter, finally implemented. Lithium
// hydride, not the doc's illustrative water: same light-atom trick behind
// every other high-specific-heat material in this file (2 atoms/formula
// unit, 7.95 g/mol — even lighter than the coolant lithium itself), it
// melts rather than boils (a discrete ejectable slug, not a vented gas),
// and it shares the ship's existing lithium-handling supply chain instead
// of needing a separate consumable logistics chain.
const HEATSINK_SLUG_MASS_KG = 1500;
const HEATSINK_SLUG_COUNT = 5;
const HEATSINK_MATERIAL_MELT_POINT_K = 965; // real LiH melting point
// Real measured LiH specific heat near room temp; the Dulong-Petit classical
// high-temperature ceiling for this formula unit works out much higher
// (~6.3 kJ/kg-K), consistent with the same "light atoms inflate J/kg-K"
// pattern used for the coolant lithium and the hull carbide elsewhere.
const HEATSINK_MATERIAL_SPECIFIC_HEAT_J_KG_K = 3500;
// Not a confident literature figure — cross-checked two ways and both land
// in the same neighborhood: a recalled reference value (~2.69 MJ/kg), and
// independently via a Richard's-rule-style estimate (ΔH ≈ 3R * T_melt /
// molar mass ≈ 3.0 MJ/kg). Taking the middle of that range.
const HEATSINK_MATERIAL_LATENT_HEAT_J_KG = 2.85e6;

const HEATSINK_SLUG_SENSIBLE_CAPACITY_J =
    HEATSINK_SLUG_MASS_KG * HEATSINK_MATERIAL_SPECIFIC_HEAT_J_KG_K * (HEATSINK_MATERIAL_MELT_POINT_K - AMBIENT_HULL_TEMP_K);
const HEATSINK_SLUG_LATENT_CAPACITY_J = HEATSINK_SLUG_MASS_KG * HEATSINK_MATERIAL_LATENT_HEAT_J_KG;
const HEATSINK_SLUG_TOTAL_CAPACITY_J = HEATSINK_SLUG_SENSIBLE_CAPACITY_J + HEATSINK_SLUG_LATENT_CAPACITY_J;

// Not derived from a real contact-area estimate. Sized so a deploy is
// clearly *felt* rather than a rounding error: at canonical fuel flow the
// reactor's continuous waste heat (~8.75 GW) completely dwarfs one slug's
// entire capacity (~7.8 GJ, under a second's worth of that output) — no UA
// value lets a slug out-cool a reactor running flat out for any real
// stretch of time. This value drains one slug in ~10s at typical operating
// hull temps, giving a sharp, visible dip while running (a genuine but
// partial reprieve) and a dramatic one if deployed with the reactor
// throttled down or decoupled, where it isn't fighting that firehose.
const UA_HULL_HEATSINK_W_PER_K = 500_000;

// Superstructure is "connected to the hull but not designed to radiate
// effectively" — mounted through thermal-isolator standoffs (real spacecraft
// practice for exactly this reason: break the conductive bridge between
// structural elements you don't want thermally tied together), so the
// hull<->superstructure conductance is deliberately weak, not a bare
// structural joint. Not derived from a real contact-area/isolator estimate
// — sized so the superstructure settles at a real, comfortable margin below
// its own melting point at canonical fuel flow, while still creeping toward
// risk at the higher throttle tiers (mirroring the hull's own tiered risk).
const UA_HULL_SUPERSTRUCTURE_W_PER_K = 15_000;

// Not documented — thermal/mechanical inertia time constant for the pump's
// mechanical spool-up (wall-clock seconds to close ~63% of the gap to a new
// flow target). This is the one lag left as an arbitrary tau: it's a
// mechanical/control-system response, not a thermal capacitance, so it
// doesn't fit the energy-balance treatment above.
const FLOW_LAG_TAU_S = 3;

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

// Rate at which the coolant loop is currently carrying heat from the fluid
// node toward the hull's heat-exchanger interface: mdot * cp * (T above
// baseline). This is the fluid node's only heat *exit* — zero flow means
// zero transport, so a stalled pump correctly traps all generated heat in
// the fluid (nothing reaches the hull) instead of needing a special case.
function fluidHeatRejectionWatts(fluidTempK: number, flowKgS: number): number {
    return flowKgS * COOLANT_SPECIFIC_HEAT_J_KG_K * Math.max(0, fluidTempK - BASELINE_FLUID_TEMP_K);
}

// Net radiative power the hull sheds to its surroundings (Formula 5,
// against the *effective* finned area). The ambient^4 term is negligible in
// practice — hull equilibrium temps run into the thousands of K, dwarfing
// 300^4 — but it's free to include and keeps the balance technically net
// rather than gross.
function hullRadiatedWatts(hullTempK: number): number {
    return RADIATOR_EMISSIVITY * STEFAN_BOLTZMANN * HULL_EFFECTIVE_RADIATOR_AREA_M2 *
        (Math.pow(hullTempK, 4) - Math.pow(AMBIENT_HULL_TEMP_K, 4));
}

// Conductive exchange between hull and superstructure — positive when heat
// flows hull -> superstructure. Genuinely bidirectional: once the hull cools
// below the superstructure (e.g. after a coolant-loop stall), heat correctly
// flows back the other way instead of getting stuck.
function hullSuperstructureConductionWatts(hullTempK: number, superstructureTempK: number): number {
    return UA_HULL_SUPERSTRUCTURE_W_PER_K * (hullTempK - superstructureTempK);
}

// Superstructure's own (poor) direct radiative loss to space — its only
// heat exit besides conducting back into the hull.
function superstructureRadiatedWatts(superstructureTempK: number): number {
    return SUPERSTRUCTURE_EMISSIVITY * STEFAN_BOLTZMANN * SUPERSTRUCTURE_RADIATOR_AREA_M2 *
        (Math.pow(superstructureTempK, 4) - Math.pow(AMBIENT_HULL_TEMP_K, 4));
}

// Rate at which a deployed heatsink slug pulls heat off the hull. One-way by
// design (the slug is being deliberately clamped against the hot hull to
// absorb heat, not passively exchanging it) — moot in practice anyway, since
// the hull always runs far hotter than the slug's whole 300-965K range.
function heatsinkDrawWatts(hullTempK: number, slugTempK: number): number {
    return UA_HULL_HEATSINK_W_PER_K * Math.max(0, hullTempK - slugTempK);
}

// Slug temperature implied by how much energy it's absorbed so far: rises
// with sensible heat until it hits the LiH melting point, then plateaus
// while the latent heat of fusion soaks up the rest of its capacity.
function heatsinkSlugTempK(absorbedJ: number): number {
    if (absorbedJ < HEATSINK_SLUG_SENSIBLE_CAPACITY_J) {
        return AMBIENT_HULL_TEMP_K + absorbedJ / (HEATSINK_SLUG_MASS_KG * HEATSINK_MATERIAL_SPECIFIC_HEAT_J_KG_K);
    }
    return HEATSINK_MATERIAL_MELT_POINT_K;
}

// Actual instantaneous flux radiated by the hull at its current temperature
// — Formula 5 applied forward, per unit area, for the cockpit readout.
function radiatorFluxFromHullTempWm2(hullK: number): number {
    return RADIATOR_EMISSIVITY * STEFAN_BOLTZMANN * Math.pow(hullK, 4);
}

// First-order relaxation toward a target — used only for the pump's
// mechanical flow response now; thermal nodes are integrated directly from
// their energy balances above.
function relax(current: number, target: number, tauSeconds: number, dt: number): number {
    return current + (target - current) * Math.min(1, dt / tauSeconds);
}

export {
    AMBIENT_HULL_TEMP_K,
    BASELINE_FLUID_TEMP_K,
    CRITICAL_FLUID_TEMP_CAP_K,
    demandedFlowKgS,
    FLOW_LAG_TAU_S,
    FLUID_NODE_CAPACITANCE_J_PER_K,
    fluidHeatRejectionWatts,
    heatGeneratedWatts,
    HEATSINK_MATERIAL_MELT_POINT_K,
    HEATSINK_SLUG_COUNT,
    HEATSINK_SLUG_TOTAL_CAPACITY_J,
    heatsinkDrawWatts,
    heatsinkSlugTempK,
    HULL_CAPACITANCE_J_PER_K,
    HULL_EFFECTIVE_RADIATOR_AREA_M2,
    HULL_FIN_AREA_MULTIPLIER,
    HULL_MELTING_POINT_K,
    HULL_RADIATOR_AREA_M2,
    hullRadiatedWatts,
    hullSuperstructureConductionWatts,
    LITHIUM_BOILING_POINT_K,
    MAX_SINGLE_PUMP_FLOW_KG_S,
    MIN_PUMP_FLOW_KG_S,
    radiatorFluxFromHullTempWm2,
    relax,
    SUPERSTRUCTURE_CAPACITANCE_J_PER_K,
    SUPERSTRUCTURE_MELTING_POINT_K,
    superstructureRadiatedWatts,
    WASTE_FRACTION,
};
