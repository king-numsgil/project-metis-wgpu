# Fold drive formulas

# Fold drive — physics model & formula reference

## What the fold drive actually is

The fold drive is a subluminal Van Den Broeck–Alcubierre metric drive. It is not a rocket. The ship does not move through space — a bubble of warped spacetime forms around the ship and *the bubble moves*, carrying the ship along with it. Inside the bubble the ship sits in free-fall the entire time: no acceleration felt, no inertia to overcome, Newton's laws simply don't apply to something that isn't moving relative to its own local spacetime.

It is powered by the ship's fusion reactor and requires a capacitor bank to deliver energy in a controlled ramp during bubble formation. Every formula below is derived from real general relativity, with exactly one engineering handwave clearly labeled — not buried.

---

## The metric

The Alcubierre spacetime metric is ordinary flat spacetime with one modification:

$$
ds^2 = -c^2 dt^2 + (dx - v_s f(r_s), dt)^2 + dy^2 + dz^2
$$

**ELI5:** Inside the bubble, the function `f` equals 1 and space itself moves at velocity `v_s`, carrying the ship with it like a chip of wood on a wave. Outside the bubble, `f` equals 0 and space is completely undisturbed. The ship never "accelerates" in any meaningful sense — it's the geometry around it that's doing the moving.

---

## Formula 1 — The shape function

What controls the transition between "inside the bubble" and "outside the bubble":

$$
f(r_s) = \frac{\tanh(\sigma(r_s + R)) - \tanh(\sigma(r_s - R))}{2\tanh(\sigma R)}
$$

Where `r_s` is distance from the bubble center, `R` is the interior radius (sized to fit the ship), and `σ` is the wall sharpness — higher values mean a thinner transition wall.

**ELI5:** This function is exactly 1 at the ship's location and smoothly falls to 0 a short distance away. With `σ = 8`, that transition — the "wall" — happens over roughly 12.5 centimetres. Every bit of exotic physics in the entire drive is concentrated in that thin shell. Everywhere else, space is either fully warped (inside) or fully normal (outside).

---

## Formula 2 — Where the energy actually goes

Running Einstein's field equations backwards on the desired geometry reveals what stress-energy configuration the universe needs in order to produce this metric:

$$
\rho(r_s, \theta) = -\frac{c^4}{32\pi G} \cdot v_s^2 \cdot \sin^2(\theta) \cdot \left(\frac{df}{dr_s}\right)^2
$$

**The key insight, and the thing that dissolves the usual "exotic matter" sci-fi handwave:** `ρ` is negative in the wall. This is not exotic matter with negative mass. It's an **energy deficit** — the fold generators are putting energy into spacetime geometry, creating a region where the local stress-energy field has been withdrawn relative to baseline. A hole isn't made of hole-material. It's the absence of material. The negative sign falls directly out of the Einstein equations as a bookkeeping result, not a material requirement.

`ρ` is nonzero only where the shape function is actually changing — meaning only in that 12.5cm wall. Both inside the bubble and outside it, space is flat and `ρ = 0`.

---

## Formula 3 — Total energy of the bubble

Integrating the energy density across the entire wall:

$$
E_{Alc} = \frac{v_s^2 R^2}{8G} \sqrt{\frac{\pi}{2}} \cdot \frac{1}{\sigma}
$$

This comes from separating the integral into an angular piece (which evaluates cleanly to 4/3) and a radial piece (which, because the wall is thin compared to the bubble radius, simplifies to an analytic tanh-profile integral). Verified numerically against direct integration to under 1% error.

**ELI5:** Bubble energy scales with the *square* of bubble velocity and the *square* of bubble radius. Doubling your travel speed costs four times the energy. Doubling the size of your ship's bubble costs four times the energy too. This formula, on its own, gives genuinely enormous numbers — which is exactly the problem the next formula solves.

---

## Formula 4 — The Van Den Broeck trick

The `R²` term above means energy scales with the bubble's *exterior* surface area — and a ship-sized bubble has an enormous exterior. Van Den Broeck's 1999 insight was to nest two metric layers: a tiny exterior aperture `b` that's all the universe actually has to "pay for," wrapped around a full-sized interior `R` where the ship actually lives.

$$
E_{fold} = E_{Alc} \cdot \left(\frac{b}{R}\right)^3
$$

**ELI5:** The cubic power comes from area scaling (`b²`) combined with a velocity suppression factor (`b/R`) baked into the nested metric — together, `b³/R³`. Since `b` can be much, much smaller than `R`, this factor is a massive reduction. A 0.5m exterior aperture wrapped around a 30m interior bubble gives a reduction factor around 4.6×10⁻⁶ — turning an absurd 2.38×10²⁴ joule requirement into a merely enormous 11,000 petajoule requirement.

**`b` is the generational technology parameter.** Early fold drives might manage `b ≈ 2m`. Mature drives push `b ≈ 0.1m` or smaller. Because the scaling is cubic, small improvements in manufacturing this aperture produce massive reductions in required energy — this is the natural "tech tree" knob for fold drive mastery across civilizational tiers.

---

## Canonical numbers — Roci-class reference (1000t, 0.01c)

| Parameter | Value | Notes |
| --- | --- | --- |
| `v_s` | 0.01c = 30,000 km/s | canonical fold velocity |
| `R` | 30 m | interior bubble radius |
| `b` | 0.5 m | exterior aperture |
| `σ` | 8 m⁻¹ | wall sharpness |
| `E_Alc` | 2.38×10²⁴ J | without Van Den Broeck — ~26,000t mass-equivalent |
| `(b/R)³` | 4.63×10⁻⁶ | Van Den Broeck reduction factor |
| `E_fold` | **11,003 PJ** | canonical fold energy |
| Reactor output | 176 TW | at 500 g/s D-He3 burn |
| Charge time (reactor only) | 17.4 h |  |
| Charge time (with capacitor assist + overburn) | 6.5 h |  |

**Velocity cost curve:** energy scales as `v_s²`. Going from 0.01c to 0.1c costs 100× more energy — this is the real, physics-derived ceiling on fold speed, not an arbitrary rule.

---

## The one labeled handwave

**The fold generators can create and maintain a macroscopic stress-energy deficit in the local field.**

The Casimir effect already proves that `ρ < 0` is physically possible at microscopic scales — this isn't invented physics. The handwave is purely one of *engineering scale*: the civilization figured out how to produce this effect at ship-sized scope rather than atomic scope. The mechanism of the generators themselves is off-screen. Everything upstream and downstream of that one assumption — the metric, the shape function, the integration, the Van Den Broeck factor, the energy recovery below — is derived from real, peer-reviewed general relativity.

---

## Formula 5 — Energy recovery (the fold is a loan, not an expenditure)

The fold is not a one-way fuel cost. It's an energy loan to spacetime itself:

- **Bubble formation:** fold generators push `E_fold` into the spacetime stress-energy field
- **Bubble collapse:** spacetime returns the energy back to the fold generators
- **Net loss:** conversion inefficiency only, estimated at roughly 10% per cycle

$$
\text{Actual fuel cost per fold} \approx 0.10 \times E_{fold}
$$

For the canonical Roci-class numbers, that's about 1,100 PJ — roughly 3.1 tonnes of D-He3, not the full 31 tonnes the raw energy figure would suggest.

**ELI5:** This single insight changes the entire operational picture of fold travel. The reactor isn't paying for the fold in full each time — it's only paying for the losses. A ship doesn't need to carry "one fold's worth of fuel" per jump, just "one fold's worth of inefficiency."

---

## The SMES capacitor bank

Fold generators need energy delivered in a controlled ramp during bubble construction — a fusion reactor alone can't spike output fast enough. The answer is **Superconducting Magnetic Energy Storage**: energy stored as a persistent current in a superconducting coil, with no resistive losses and near-instant discharge.

### Formula 6 — Toroid energy storage

A toroid (donut shape) is chosen specifically because it produces **zero external magnetic field** — all flux stays contained inside the tube, meaning no interference with navigation, weapons, or crew.

$$
V_{toroid} = 2\pi^2 R a^2 \qquad E = \frac{B^2 V}{2\mu_0} \qquad B = \sqrt{\frac{2\mu_0 E}{V}}
$$

Where `R` is the major radius of the torus, `a` is the minor radius (tube thickness), and `B` is magnetic field strength.

### Formula 7 — The wall problem

Magnetic pressure inside the coil tries to burst the containment:

$$
P_{mag} = \frac{B^2}{2\mu_0} \qquad \sigma_{hoop} = \frac{P_{mag} \cdot a}{t}
$$

Where `t` is wall thickness. The hard constraint is `σ_hoop ≤ σ_t` of whatever structural material contains the coil — and critically, the maximum achievable energy density equals the material's tensile strength, in the same SI units. This is not a coincidence; it falls directly out of the physics of magnetic pressure vessels.

**The material gap is severe.** For a ship-sized toroid storing the canonical 11,003 PJ, required tensile strength is around 10¹⁸ Pa. Steel manages 5×10⁸ Pa — ten orders of magnitude short. Even theoretical-maximum carbon nanotubes or graphene fall seven and six orders of magnitude short respectively.

**This is the second labeled handwave:** the SMES structural shell requires a far-future material with tensile strength around 10¹⁷–10¹⁸ Pa, physically motivated by speculative topological condensed matter structures rather than ordinary chemical bonding — a genuinely different mechanism, not just "better steel."

### Operational numbers by ship class

| Ship class | Fusion rate | Top-up time | Cold-start time |
| --- | --- | --- | --- |
| Civilian freighter | 500 g/s | 1.74 h | 17.4 h |
| Military escort | 1000 g/s | 52 min | 8.7 h |
| Destroyer | 2000 g/s | 26 min | 4.35 h |
| Carrier | 5000 g/s | 10 min | 1.74 h |

**Cold-start** means the SMES bank is fully discharged and must charge from nothing — a real tactical vulnerability window. **Top-up** means only replacing the ~10% conversion loss from a previous fold, which is dramatically faster.

---

## Bubble physics and interaction rules

**Visual signature:** the exterior is a 0.5m sphere of violently warped spacetime. During charging, a faint gravitational lens grows around the ship. At full charge, the bubble is a blindingly bright ring (an Einstein ring equivalent — background starlight compressed into the boundary) with a dark interior, since light cannot easily traverse the wall gradient. **Fold drives are not stealthy.** Every gravitational sensor in range detects bubble formation immediately.

**The bubble moves, the ship doesn't.** From an outside observer's frame, this is a 0.5m gravitational anomaly traveling at 30,000 km/s from origin to destination. Travel time is real elapsed time — Earth to Mars at 0.01c still takes roughly 21 hours. Origin, vector, destination, and arrival time are all calculable by anyone with a gravitational sensor the moment the bubble forms.

**Crew are blind and deaf during fold.** Light follows null geodesics that bend around the bubble rather than penetrating it — no sensor data gets in or out while folding.

### Interaction table

| Object crossing the wall | Result |
| --- | --- |
| Bullet / railgun slug | Vector scrambled in the 12.5cm transition zone — almost certainly misses. Bubble unaffected. |
| Missile | Guidance corrupted by sensor scrambling, tumbles, may detonate inside the wall. Bubble logs the tensor disturbance. |
| Laser / EM signal | Bent around the bubble along null geodesics. Cannot penetrate. |
| Two bubbles intersecting | Both metric configurations fight in the overlap. Both destabilize, both capacitor banks receive chaotic energy return, both ships drop to normal space at the intersection point. Catastrophic for everyone involved. |
| Ship partially clipping the bubble | Tidal forces across the thin wall shear off the clipped section. Bubble detects the mass contribution and may abort or collapse violently. |
| Large mass in the formation zone | Fold generators abort outright — the stress-energy tensor in the formation zone doesn't match the target geometry. Capacitor bank discharges with no energy return. Ship is left fully depleted. |

**Combat implications:** no folding inside an active battlefield. Debris density and the probability of bubble intersection or wall clipping make it suicidal. Fold drives are strategic, not tactical — you fold *to* the engagement, never *in* it. Retreating requires burning clear on the torch drive first, then folding once safely outside the debris field. And critically: **you cannot bluff your destination.** The moment the bubble forms, its vector is calculable by anyone watching, and there is no way to fake or redirect it after the fact.

**Fold traffic control is existential infrastructure** in any developed system — many bubbles moving at 30,000 km/s through inhabited space, any one of which passing through a habitat or ship unannounced is catastrophic. Whoever controls fold traffic lanes holds enormous leverage, since deliberately routing a bubble through a target is close to the most deniable weapon imaginable.

---

## Ship class parameters

```
FoldDrive {
  v_s           // m/s — target fold velocity, capped near 0.01c for power reasons
  R             // m — interior bubble radius, sized to ship hull
  b             // m — exterior aperture, the generational tech parameter
  sigma         // m⁻¹ — wall sharpness
  E_fold        // J — derived from Formulas 3 and 4
  P_reactor     // W — fusion reactor output feeding the SMES bank
  E_smes        // J — capacitor bank capacity (Formula 6)
  sigma_t       // Pa — structural tensile strength of the SMES containment shell
  recovery_eff  // 0-1 — fraction of E_fold recovered on bubble collapse (~0.90 canonical)
}
```

The single most important tuning knob for differentiating ship classes and tech tiers is `b` — the exterior aperture. Because energy scales as `b³`, a civilization's mastery of fold technology is best expressed entirely through how small they can manufacture this one parameter.