# Null drive formulas

# Null drive — physics model & formula reference

## What the null drive actually is

The null drive is a unified ZPE (zero-point energy) extraction and propulsion system. It does two things simultaneously using the same power plant:

1. **Inertia suppression** — it modifies how strongly the ship's mass resists acceleration, by restructuring the local quantum vacuum field (the ZPF) around the ship. Less inertia means the same thrust produces dramatically higher acceleration.
2. **ADCE thrust** — it generates reactionless thrust by creating an asymmetric pattern of photon pair production in the vacuum, causing momentum to flow preferentially in one direction. The vacuum itself absorbs the recoil. No exhaust, no reaction mass.

Unlike the fold drive, which wraps spacetime around the ship, the null drive pushes the ship physically through space. The crew feels every newton. Instability isn't an abstraction — it's people getting thrown into bulkheads.

---

## State variables

These are the quantities the sim tracks at every moment:

| Variable | What it is |
| --- | --- |
| `CCI` | Cavity Coherence Integrity — health of the drive array, 0–1 |
| `velocity` | Ship speed along thrust axis (m/s) |
| `time` | Elapsed simulation time (s) |

---

## Ship class parameters

Every ship class has these fixed values baked in at design time:

| Parameter | Symbol | What it means |
| --- | --- | --- |
| Rated power | `P_rated` | Max continuous ZPE extraction flux (TW). The ceiling on everything. |
| Base mass | `m_base` | Ship rest mass (tonnes). |
| Thrust coupling efficiency | `k_T` | How efficiently the drive converts power to thrust. 0–1. Military ships have higher k_T than freighters. |
| Minimum inertia factor | `μ_min` | The lowest inertia multiplier achievable — you can't suppress inertia to zero, the hull resists. 0–1. |
| CCI burn rate | `β_T` | How fast sustained thrust degrades the cavity array. |
| CCI recovery rate | `γ` | How fast the array naturally recovers when not being hammered. |

---

## Control inputs

The pilot (or automation layer) sets two throttles at any moment:

| Input | Symbol | What it does |
| --- | --- | --- |
| Thrust throttle | `θ_T` | Fraction of P_rated going to ADCE thrust. 0–1. |
| Inertia throttle | `θ_I` | Fraction of P_rated going to inertia suppression. 0–1. |

**Hard constraint:** the two throttles can't exceed the rated power together:

$$
\theta_T + \theta_I \leq 1.0
$$

If they do, thrust is clamped:

$$
\theta_T = \max(0,\ 1.0 - \theta_I)
$$

The automation layer's job is to solve this allocation optimally given a single "go fast" input. Pilots who want both knobs can have them.

---

## Formula 1 — Thrust force

How hard the drive is pushing, in newtons:

$$
F = k_T \cdot P_{rated} \cdot \theta_T \cdot k_{scale}
$$

Where `k_scale = 2.67 × 10⁻⁷ N/W` is the vacuum momentum coupling constant — a fixed physical property of the drive technology, derived by anchoring the model so a 1000t frigate at 50% thrust produces ~1g of acceleration.

**ELI5:** Power in, scaled by how good the drive is at converting it, scaled by the throttle position, scaled by how efficiently the vacuum gives up momentum. The result is a force in newtons pointing wherever the drive array is aimed.

**Note:** CCI does not appear here. A degraded drive doesn't push less hard — it pushes less *accurately*. See instability below.

---

## Formula 2 — Inertia reduction factor

How much the ship's effective mass is reduced:

$$
\mu = \mu_{min} + (1 - \mu_{min}) \cdot e^{-\alpha \cdot \theta_I}
$$

Where `α = 3.0` is the inertia coupling constant.

**ELI5:** At `θ_I = 0` (no inertia power), the exponential term is 1, so `μ = 1.0` — full mass, no suppression. As you push more power into inertia suppression, μ drops exponentially toward `μ_min`. The exponential shape means you get big gains quickly at low throttle, with diminishing returns as you approach maximum suppression.

At `α = 3.0` and `μ_min = 0.05`, a frigate running 30% inertia power achieves roughly `μ ≈ 0.41` — less than half its rest mass. At 60% inertia power it's down to `μ ≈ 0.10`.

**Note:** CCI also does not appear here. Inertia suppression is a field configuration — like a superconducting magnet, it holds its state without continuously paying for it degradation-wise. The drive being banged up doesn't randomly restore your inertia.

---

## Formula 3 — Effective mass

The mass the flight model actually works with:

$$
m_{eff} = m_{base} \cdot \mu
$$

**ELI5:** Take the ship's real mass, multiply by the inertia factor. A 1000t ship with `μ = 0.1` behaves like a 100t ship for the purposes of acceleration. Newton's second law then gives you:

$$
a = \frac{F}{m_{eff}}
$$

This is real acceleration. The crew feels it.

---

## Formula 4 — Net forward acceleration

Combining thrust and effective mass into what actually moves the ship:

$$
a_{fwd} = \frac{F_{fwd}}{m_{eff}}
$$

Where `F_fwd` is the forward component of thrust after instability is applied (see below). In a clean nominal drive with no instability, `F_fwd = F` and this is just Newton's second law with reduced inertia.

---

## Formula 5 — CCI degradation and recovery

How the cavity array's health changes over time:

$$
\frac{d(CCI)}{dt} = -(\beta_T \cdot \theta_T^2 + \beta_I \cdot \theta_I) \cdot CCI + \gamma \cdot (1 - CCI)
$$

Breaking it apart:

**Degradation term:** $-(\beta_T \cdot \theta_T^2 + \beta_I \cdot \theta_I) \cdot CCI$

- Thrust degradation is **quadratic** in throttle (`θ_T²`). Doubling your thrust more than doubles the CCI burn rate. This is intentional — it makes the sprint penalty steep.
- Inertia degradation is **linear** and uses a much smaller coefficient (`β_I = 0.01`, fixed). Inertia suppression is low-stress; it barely touches CCI.
- The whole degradation term is multiplied by current CCI — a healthy array degrades faster than an already-damaged one, making damage somewhat self-limiting.

**Recovery term:** $\gamma \cdot (1 - CCI)$

- Always present, always positive. Proportional to how much room is left to recover — fast when barely damaged, slow when nearly dead.
- Recovery wins over degradation below the crossover throttle:

$$
\theta_{T,crossover} = \sqrt{\frac{\gamma}{\beta_T}}
$$

At default parameters (`γ = 0.04`, `β_T = 0.09`), crossover is at **θ_T ≈ 66.7%**. Sustained thrust below this level costs no net CCI — the array recovers as fast as it degrades. Above it, you're on a clock.

**ELI5:** The drive array is like a muscle. Light use lets it recover in real time. Heavy use accumulates fatigue faster than it can heal. The crossover point is your "sustainable effort" ceiling. Sprint above it, and you will eventually hit instability territory — it's just a question of how long you have.

---

## Formula 6 — Instability

When CCI drops below 40%, the cavity array loses geometric precision. Photon pairs are no longer produced perfectly asymmetrically — some go sideways, some produce spurious angular momentum. The crew feels this as erratic acceleration and unexpected torque.

**Severity function:**

$$
\text{severity}(CCI) = \max!\left(0,\ \left(\frac{0.4 - CCI}{0.4}\right)^{1.5}\right)
$$

- At CCI = 0.40: severity = 0.0 — perfectly clean.
- At CCI = 0.30: severity ≈ 0.09 — barely perceptible.
- At CCI = 0.15: severity ≈ 0.35 — noticeable, demands pilot attention.
- At CCI = 0.05: severity ≈ 0.79 — violent, hard to control.
- At CCI = 0.00: severity = 1.0 — maximum chaos.

The 1.5 exponent keeps it gentle through the degraded zone and makes it accelerate sharply in the critical zone — producing the intended "manageable → oh no" progression.

**Vector deviation:**

$$
\phi \sim \mathcal{U}(-\phi_{max},\ \phi_{max}), \quad \phi_{max} = \text{severity} \times 60°
$$

The thrust vector deviates randomly up to ±φ_max from the intended axis each timestep. In the actual flight model this should be a slowly drifting stochastic process (Ornstein-Uhlenbeck) rather than white noise — so the ship feels like it's fighting turbulence rather than having a seizure.

**Forward thrust after deviation:**

$$
F_{fwd} = F \cdot \cos(\phi)
$$

**Spurious torque:**

$$
\tau = F \cdot \sin(\phi) \cdot r
$$

Where `r` is a random moment arm (±20m × severity) representing which part of the distributed cavity array is misfiring. This torque is applied to the ship's angular momentum — the flight model's attitude control system has to fight it.

**ELI5:** Below 40% CCI, the drive starts aiming poorly. By the time you're critical, it's pointing in wildly random directions each moment, physically throwing the crew around and making the ship nearly impossible to point. The smart play is short sprints with throttle-back recovery windows — never let CCI bleed into critical unless you're committed to coasting through the consequences.

---

## Formula 7 — Catastrophic decoherence

If CCI reaches zero, the array fully decoheres. Drive shuts down immediately and unconditionally. The ship coasts ballistically.

Recovery is passive only — the array rebuilds at rate `γ · (1 - CCI)` with the drive offline. It will not come back online until CCI exceeds the critical threshold (15%). At default parameters this takes roughly 10 seconds from zero — long enough to matter tactically.

---

## Thresholds summary

| CCI level | Name | Effect |
| --- | --- | --- |
| 1.0 – 0.40 | Nominal | Clean thrust, no instability |
| 0.40 – 0.15 | Degraded | Instability onset, scales from mild to significant |
| 0.15 – 0.00 | Critical | Severe to violent instability, near-uncontrollable |
| 0.00 | Decoherence | Drive offline, passive recovery only |

---

## Default frigate parameters

| Parameter | Value | Notes |
| --- | --- | --- |
| `P_rated` | 100 TW | Sustains ~10 MN thrust at 50% throttle |
| `m_base` | 1,000 t | Roci-class reference ship |
| `k_T` | 0.75 | Military-grade thrust efficiency |
| `μ_min` | 0.05 | Can suppress inertia to 5% of rest mass |
| `β_T` | 0.09 | CCI burn rate |
| `γ` | 0.04 | CCI recovery rate |
| Crossover | 66.7% θ_T | Sustainable sprint ceiling |
| `k_scale` | 2.67 × 10⁻⁷ N/W | Vacuum coupling constant (fixed) |

At 50% thrust, no inertia suppression, full CCI: **~1g sustained, indefinitely.**
At 100% thrust, 0% inertia suppression, full CCI: **~2g, CCI draining at ~0.05/s.**
At 60% thrust, 40% inertia suppression, full CCI: **~4–5g effective, CCI near-neutral.**

---

## Gravity mode

Gravity mode is the second field configuration of the same null drive hardware. Where inertia mode manipulates the ZPF coupling of matter (how strongly mass resists acceleration), gravity mode manipulates the stress-energy coupling of matter (how strongly mass curves spacetime). These are two different physical interactions on two different fields — the hardware does both, but not simultaneously. The field geometries are incompatible.

In gravity mode, ADCE thrust is unavailable and inertial mass returns to `m_base`. The ship can still coast on existing velocity. What it gains is control over its gravitational mass — both reduction and amplification.

---

### What gravity mode is used for

**Reduction (m_grav < 100%):** The ship's gravitational signature shrinks. Below roughly 30% gravitational mass the ship becomes nearly invisible to gravitational sensors and stops meaningfully contributing to local spacetime curvature — which means fold drive metric formation near it proceeds normally, as if it isn't there. A gravitational stealth ship.

**Amplification (m_grav > 100%):** The ship becomes a local gravity source. At sufficient amplification it disrupts fold metric formation in the surrounding volume — enemies cannot fold in or out of the area. A fold drive interdictor.

**Mode-switching rapidly:** A ship oscillating between field configurations is generating gravitational waves. At sufficient intensity these stress hull materials and disrupt sensitive electronics in the vicinity. A weapon of last resort.

---

### The three mass types

This is the key physical distinction the null drive exploits:

| Mass type | Symbol | What it controls | Null drive effect |
| --- | --- | --- | --- |
| Gravitational mass | `m_grav` | How strongly gravity pulls the ship; contribution to spacetime curvature | Tunable in gravity mode |
| Inertial mass | `m_inertia = m_base × μ` | Resistance to acceleration | Tunable in inertia mode |
| Momentum mass | `m_base` | Carries kinetic energy and momentum | Never changes |

Momentum is always `p = m_base × v`. Coasting at high velocity with `m_grav = 0.1` does not reduce your momentum — it only changes how gravity interacts with you and how you appear to sensors. This is the "slightly cheating" principle: conservation of momentum is fully honoured, but the cost of *changing* momentum (inertia) and the gravitational *signature* of that momentum (gravity) are separately negotiable.

---

### Formula G1 — Gravitational mass power cost

The power required to maintain a given gravitational mass target, in terawatts:

For $m < 1.0$ (reduction):

$$
P_{grav}(m) = \frac{m_{base}}{m_{ref}} \cdot \kappa_R \cdot \left(\frac{1 - m}{m - \varepsilon}\right)^2
$$

For $m > 1.0$ (amplification):

$$
P_{grav}(m) = \frac{m_{base}}{m_{ref}} \cdot \kappa_A \cdot \left(e^{\lambda(m - 1)} - 1\right)
$$

At $m = 1.0$ (nominal), $P_{grav} = 0$.

Where:

- `m` — current gravitational mass multiplier (1.0 = 100% = nominal)
- `m_base` — ship rest mass in tonnes
- `m_ref = 1000 t` — reference mass for normalisation (1kt frigate baseline)
- `κ_R` — reduction cost coefficient (TW per 1kt at the reference deviation)
- `κ_A` — amplification cost coefficient (TW per 1kt) — **the interdictor knob**
- `λ` — amplification curve steepness
- `ε = 0.05` — prevents division by zero as `m` approaches zero

**ELI5 — reduction side:** The formula blows up as `m` approaches `ε`. At 50% mass it's affordable. At 30% you're at maximum power draw. Below 30% the cost exceeds rated power — the drive physically cannot go further. This is the soft floor with teeth: not a hard wall, but quicksand that gets exponentially deeper.

**ELI5 — amplification side:** At 100% mass, cost is zero — nominal mass is the natural state and costs nothing to maintain. Push to 200% and you're spending real power. Push to 500% and you're spending a lot. Push past what rated power can sustain and you hit the amplification ceiling. An interdictor-class ship has a shallow `κ_A` curve — reaching 400–500% mass at affordable cost is its whole design purpose.

**ELI5 — mass scaling:** A 50,000t dreadnought costs 50× more to gravitationally manipulate than a 1,000t frigate at the same percentage target. Bigger ships need proportionally more powerful drives to achieve the same gravity mode performance. Ship mass and drive power are independent axes of ship design.

---

### Formula G2 — Power ceiling and achievable target

The drive cannot exceed rated power. If the target `m_grav` would cost more than `P_rated`, the achievable mass is found by solving:

$$
P_{grav}(m_{achievable}) = P_{rated}
$$

This has no closed form — it's solved numerically (binary search) each tick. The pilot sets a target; the drive shows what it can actually reach given current rated power.

**Reduction floor** (analytically approximated):

$$
m_{floor} \approx \varepsilon + \sqrt{\frac{\kappa_R \cdot m_{base} / m_{ref}}{P_{rated}}}^{-1}
$$

In plain terms: a more powerful drive can push further below nominal, a heavier ship needs more power to reach the same floor, and a high `κ_R` makes reduction universally expensive regardless of ship size.

---

### Formula G3 — Progressive mass change

`m_grav` does not snap to target — it approaches at a rate controlled by `grav_rate`:

$$
\frac{d(m_{grav})}{dt} = \text{grav\_rate} \cdot (m_{grav,target} - m_{grav})
$$

Time to reach 95% of a new target: roughly `3 / grav_rate` seconds.

**ELI5:** The ZPF field configuration takes time to restructure. A fast drive (`grav_rate = 1.0`) transitions in ~3 seconds. A slow drive (`grav_rate = 0.2`) takes ~15 seconds. This delay is tactically significant — committing to gravity mode and then needing to switch back is a vulnerability window.

**Retroactive addition to inertia mode:** `μ` has the same lag treatment:

$$
\frac{d(\mu)}{dt} = \alpha_{rate} \cdot (\mu_{target} - \mu)
$$

Where `μ_target` is the equilibrium inertia factor from Formula 2. `alpha_rate` is a ship class parameter — a nimble interceptor restructures its inertia field fast, a heavy capital ship responds sluggishly.

---

### Formula G4 — CCI degradation in gravity mode

Gravity mode shares the CCI pool with inertia mode. Degradation is driven by power draw as a fraction of rated power — same philosophy as thrust mode, different stress profile:

$$
\frac{d(CCI)}{dt} = -\beta_G \cdot \min!\left(\frac{P_{grav}}{P_{rated}},\ 1.0\right) \cdot CCI + \gamma \cdot (1 - CCI)
$$

Where:

- `β_G` — gravity mode CCI burn rate (ship class param, typically lower than `β_T` — gravity mode stresses the array less than rapid cavity oscillation)
- The `min(..., 1.0)` clamps degradation at maximum rated power — trying to push past the floor burns CCI at maximum rate but still doesn't get you there
- Recovery term `γ` is identical to inertia mode

**CCI crossover in gravity mode** — the power fraction at which recovery equals degradation:

$$
\left(\frac{P_{grav}}{P_{rated}}\right)_{crossover} = \frac{\gamma}{\beta_G}
$$

At default parameters (`γ = 0.04`, `β_G = 0.06`), crossover is at 66.7% power draw — meaning you can sustain a gravitational mass that costs up to 66.7% of rated power indefinitely without net CCI loss. Push harder and you're on a clock, exactly like thrust sprinting.

---

### Formula G5 — Mode switch interlock

Switching from gravity mode back to inertia mode is gated by mass restoration:

$$
\text{can\_switch} = |m_{grav} - 1.0| \leq 0.02
$$

While restoring, the drive is in gravity mode with zero power input — `m_grav` drifts back toward 1.0 at rate `grav_rate` passively. CCI recovers during this window since power draw is falling toward zero.

**ELI5:** You pushed to 500% mass for an interdiction. You need to maneuver. You cut gravity throttle — mass starts drifting back toward 100%. You're stuck in gravity mode with no ADCE thrust, full inertial mass, coasting ballistically, waiting for the field to unwind. At `grav_rate = 0.5` that's roughly 6 seconds from 500% back to the switch window. Six seconds is a long time in combat. The interdictor play is powerful but it commits you.

---

### Formula G6 — Gravitational wave emission

When `m_grav` is changing, the ship emits gravitational waves. The power output follows the quadrupole radiation formula from general relativity:

$$
P_{gw} = \frac{G}{5c^5} \cdot \left(m_{base} \cdot \frac{d^2 m_{grav}}{dt^2}\right)^2 \cdot r_{ship}^2
$$

Where:

- `G = 6.674 × 10⁻¹¹ N·m²/kg²` — gravitational constant
- `c` — speed of light
- `r_ship` — effective radiating radius of the ship (metres)
- The second derivative `d²m_grav/dt²` means it's the *acceleration* of mass change that matters — slow steady transitions produce almost nothing; rapid oscillation produces strong waves

**Effective fold jamming radius:**

$$
r_{jam} = \sqrt{\frac{P_{gw}}{P_{threshold}}}
$$

Where `P_threshold` is a property of the fold drive being jammed — its metric formation sensitivity to local spacetime perturbation. A sophisticated Tier 2 fold drive is more resistant. A Tier 3 fold drive is presumably hardened against exactly this.

**ELI5:** A ship sitting quietly at 300% mass produces almost no gravitational waves — the mass is static. A ship rapidly oscillating between 50% and 500% mass produces strong gravitational waves — it's the change that radiates, not the state. So the most aggressive interdictor play is rapid mass oscillation, generating maximum jamming radius, but burning CCI fast and leaving the ship unable to maneuver the entire time.

---

### Updated ship class parameter set

```
NullDrive {
  // Shared
  P_rated       // TW — extraction flux ceiling
  m_base        // t — rest mass
  gamma         // CCI recovery rate (both modes)
  CCI_crit      // catastrophic decoherence threshold

  // Inertia mode
  k_T           // thrust coupling efficiency (dimensionless, 0–1)
  mu_min        // minimum inertia multiplier (dimensionless, 0–1)
  beta_T        // CCI thrust degradation rate
  alpha         // inertia coupling constant (controls μ vs θ_I curve shape)
  alpha_rate    // how fast μ responds to θ_I changes (s⁻¹)

  // Gravity mode
  kappa_R       // gravitational reduction cost (TW per 1kt at reference deviation)
  kappa_A       // gravitational amplification cost (TW per 1kt) ← interdictor knob
  lambda        // amplification curve steepness
  beta_G        // CCI gravity mode degradation rate
  grav_rate     // how fast m_grav moves toward target (s⁻¹)
  r_ship        // effective radiating radius for gravitational wave calculation (m)
}
```

Sixteen parameters total. The interdictor variant primarily differs in `kappa_A` — shallower amplification curve, same everything else. A stealth variant might have very low `kappa_R` for cheap deep reduction and high `kappa_A` to discourage amplification use.

---

### Default frigate parameters — gravity mode additions

| Parameter | Value | Notes |
| --- | --- | --- |
| `kappa_R` | 20 TW | Reduction cost at 1kt reference — gives ~35% floor at 100 TW rated power |
| `kappa_A` | 15 TW | Amplification cost at 1kt reference |
| `lambda` | 0.8 | Amplification steepness — reaches P_rated at roughly 400% mass |
| `beta_G` | 0.06 | Gravity CCI burn rate — gentler than `beta_T` |
| `grav_rate` | 0.5 s⁻¹ | ~6 seconds to transition 95% of the way to a new target |
| `r_ship` | 50 m | Radiating radius for gravitational wave calculation |

A 1kt frigate with 100 TW rated power can sustain down to roughly **35% gravitational mass** indefinitely without net CCI loss, and can push to **~500% gravitational mass** before hitting the amplification ceiling. An interdictor-class ship with `kappa_A = 5 TW` and `P_rated = 500 TW` can sustain 800–900% mass at moderate CCI cost — enough to jam fold drives across a substantial volume of space.