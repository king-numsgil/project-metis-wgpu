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

export {D_HE3_SPECIFIC_ENERGY_J_PER_KG, ICF_TARGET_GAIN, LASER_DRIVER_FRACTION, reactorPowerWatts, TORCH_REFERENCE};
