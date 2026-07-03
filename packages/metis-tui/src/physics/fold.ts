// Canonical Roci-class reference numbers, cited directly from
// math/Fold drive formulas.md ("Canonical numbers — Roci-class reference")
// rather than re-derived here.
const FOLD_REFERENCE = {
    foldVelocityC: 0.01,
    interiorRadiusM: 30,
    exteriorApertureM: 0.5,
    smesCapacityPJ: 11003, // Formula 4 — canonical E_fold
    reactorOutputTW: 176,
    coldStartHours: 17.4, // charging the SMES from empty, reactor alone
    topUpHours: 6.5, // capacitor-assisted, just replacing the ~10% conversion loss
    recoveryEfficiency: 0.9, // Formula 5 — the fold is a loan, not an expenditure
    requiredTensileStrengthPa: 1e18, // Formula 7 — the second labeled handwave
    steelTensileStrengthPa: 5e8,
} as const;

// The primary-cap gauge is an abstracted 0-100% for interactive pacing (see
// ship.tsx's REACTOR_START_INTERLOCK_FLOW etc.) — this just relabels that
// percentage in the canonical energy units from the fold-drive doc. It does
// NOT imply the gauge charges at the doc's real cold-start/top-up rate.
function pjFromPercent(percent: number): number {
    return (Math.max(0, Math.min(100, percent)) / 100) * FOLD_REFERENCE.smesCapacityPJ;
}

export {FOLD_REFERENCE, pjFromPercent};
