// Canonical Roci-class reference numbers, cited directly from
// math/Fusion torch formulas.md (Formula 3, "Reference ship — Roci-class
// frigate") rather than re-derived here.
const TORCH_REFERENCE = {
    dryMassTonnes: 1000,
    sustainedAccelG: 1.2,
    fuelBurnGramsPerSec: 500, // D-He3, 5x neon doping for thrust
    burnDurationHours: 51,
    jetPowerTWRange: [74, 92] as const,
    specificPowerMWPerKgRange: [74, 92] as const,
    exhaustVelocityMaxC: 0.088, // Formula 2 — hard physical ceiling for D-He3
} as const;

// Formula 1 — D-He3 fusion yield: 18.3 MeV per reaction / 5.03u reactant mass.
const D_HE3_SPECIFIC_ENERGY_J_PER_KG = 3.5e14;

// Total fusion power released for a given burn rate (Formula 1, ideal — no
// conversion-efficiency losses applied). At the canonical 500 g/s burn this
// returns ~175 TW, matching the fold doc's reactor-output figure (176 TW)
// used for SMES charging almost exactly.
function reactorPowerWatts(fuelFlowGramsPerSec: number): number {
    const kgPerSec = fuelFlowGramsPerSec / 1000;
    return kgPerSec * D_HE3_SPECIFIC_ENERGY_J_PER_KG;
}

// ICF driver requirement — not documented in the torch doc, grounded instead
// in the real LIFE (Laser Inertial Fusion Energy) power-plant concept from
// LLNL: 132 MJ yield from a 2.2 MJ driver, a target gain of ~60. This
// reactor keeps paying that ~1.7% "driver tax" continuously while running,
// sourced from the primary cap — decoupling the primary bus from the
// reactor still pays this tax without the output coming back. A future,
// antimatter-catalyzed fusion tier would push this fraction toward zero.
const ICF_TARGET_GAIN = 60;
const LASER_DRIVER_FRACTION = 1 / ICF_TARGET_GAIN;

// Formula 1's own honest caveat: D-He3 side reactions leak 1-5% of total
// power as neutrons, unusable for directed thrust. Taking the middle of
// that stated range rather than either edge.
const NEUTRON_LOSS_FRACTION = 0.03;

// Not in the math/ docs — recalled from the original design chat: an
// induction coil around the nozzle skims a bit of exhaust velocity to feed
// the ship's capacitors while thrust is engaged. Stated as a velocity
// fraction (the tangible in-fiction dial) rather than a power fraction on
// purpose — since exhaust kinetic power scales as v_e^2, a 1% velocity cut
// only leaves (0.99)^2 ≈ 98.01% of the kinetic energy in the exhaust, so
// the coil is actually skimming ~2% of jet power, not 1%. That's a real
// consequence of the stated number, not a separate fudge.
const INDUCTION_COIL_VELOCITY_SKIM_FRACTION = 0.01;
const INDUCTION_COIL_POWER_SKIM_FRACTION = 1 - Math.pow(1 - INDUCTION_COIL_VELOCITY_SKIM_FRACTION, 2);

// Power actually available to become directed exhaust kinetic energy, net
// of the ICF driver tax (paid regardless of what the plasma is used for —
// see LASER_DRIVER_FRACTION) and neutron losses. Does not yet include the
// induction-coil skim, which is only paid while thrust is engaged.
function grossJetPowerWatts(fuelFlowGramsPerSec: number): number {
    return reactorPowerWatts(fuelFlowGramsPerSec) * (1 - LASER_DRIVER_FRACTION - NEUTRON_LOSS_FRACTION);
}

// Formula 3 (Formula 2 solved forward): exhaust velocity for a given jet
// power and total exhaust mass flow (fused D-He3 products plus any inert
// neon dilutant). Doping adds mass without adding power, so it necessarily
// lowers v_e for the same jetPowerW — undoped (mdot = fuel flow itself)
// lands just under the Formula 2 ceiling, short only by whatever losses are
// already baked into jetPowerW.
function exhaustVelocityMPerS(jetPowerW: number, totalExhaustFlowKgS: number): number {
    if (totalExhaustFlowKgS <= 0) return 0;
    return Math.sqrt((2 * jetPowerW) / totalExhaustFlowKgS);
}

// Formula 3: F = 2 * P_jet / v_e (equivalently mdot * v_e).
function thrustNewtons(jetPowerW: number, veMPerS: number): number {
    if (veMPerS <= 0) return 0;
    return (2 * jetPowerW) / veMPerS;
}

// Not documented — gameplay-pacing time constant for the neon doping valve
// spooling toward a newly-commanded ratio (physics/heat.ts's `relax()`
// handles the actual lag, still an exponential approach, not linear). Was
// 5s, matching-but-slower-than the coolant pump's own spool-up — played
// sluggish in practice, so cut down to read as a snappy tactical dial
// rather than a heavy mechanical valve.
const NEON_PUMP_LAG_TAU_S = 1.5;

export {
    D_HE3_SPECIFIC_ENERGY_J_PER_KG,
    exhaustVelocityMPerS,
    grossJetPowerWatts,
    ICF_TARGET_GAIN,
    INDUCTION_COIL_POWER_SKIM_FRACTION,
    INDUCTION_COIL_VELOCITY_SKIM_FRACTION,
    LASER_DRIVER_FRACTION,
    NEON_PUMP_LAG_TAU_S,
    NEUTRON_LOSS_FRACTION,
    reactorPowerWatts,
    thrustNewtons,
    TORCH_REFERENCE,
};
