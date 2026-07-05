# p-B¹¹ FRC Reactor — Design Specification

Successor tech to the D-He3 ICF torch drive. Same downstream role (propulsion + power gen from one reactor), completely different confinement paradigm, one full engineering generation harder to build. This doc covers the physics decisions, the formulas, and the resulting crew-facing behavior.

---

## 1. Reaction

p + B¹¹ → 3α + 8.7 MeV, aneutronic in principle. Not zero-neutron in practice — parasitic side branches (secondary reactions off the He4 products, minor p-p channels) put a real neutron fraction into the yield. This reactor's parasitic/side-channel loss is engineered down to **<0.4%**, not eliminated. Worth stating as "low-neutron," never "no-neutron," in any in-universe technical document.

**Energy per reaction:** 8.7 MeV = 1.394×10⁻¹² J
**Fuel consumed per reaction:** 1 proton (1.6726×10⁻²⁷ kg) + 1 B¹¹ nucleus (1.8280×10⁻²⁶ kg) = 1.9953×10⁻²⁶ kg total

---

## 2. Confinement geometry: FRC, not tokamak

**Field-Reversed Configuration** — a compact torus. Closed poloidal field only, no toroidal component, generated entirely by the plasma's own azimuthal diamagnetic current. No central solenoid, no toroidal field coil stack — just external ring-type mirror coils around a cylindrical vessel.

Why FRC over tokamak, specifically for p-B11:

- **High β** (plasma pressure approaching magnetic pressure) — needed headroom against p-B11's poor cross-section and the bremsstrahlung fight, versus a tokamak's few-percent β ceiling
- **Natural open ends** — field lines diverge into a mirror/expander at the vessel ends by geometry, which is also the exhaust mechanism (see §4) — no bolted-on divertor hardware fighting a closed topology
- **No central column** — nothing sitting in the highest-flux region to shield/replace, consistent with the low-neutron pitch

Tradeoff: compact tori are historically less mature and more prone to tilt/kink instability than tokamaks at scale. This is the in-universe justification for p-B11 FRC being a *later* tech tier than D-He3 ICF — not a fuel-sourcing problem, a stability-engineering problem that took a very long time to solve.

---

## 3. Confinement mode: continuous, not pulsed

D-He3 ICF is pulsed by necessity — inertial confinement has no field holding the plasma, just its own inertia for nanoseconds before it disperses. Repeat-the-implosion is the only mode available.

FRC is **continuous-flow, quasi-steady-state**. A magnetic field, not inertia, does confinement, so there's no clock running out the way there is on an imploding pellet. Fuel recirculates in the mirror, burns continuously, exhaust streams out continuously — more turbine than repeated detonation. "Continuous" still means *actively sustained* (ongoing neutral beam injection + current drive keeping the field and the non-thermal ion population alive), not a self-sustaining field that needs nothing — see §6 for what that sustainment costs.

---

## 4. Alpha extraction — the mirror-to-beam mechanism

Can't sort alphas from unreacted fuel electrostatically inside the reaction volume — protons, B11, and alphas are all positively charged. Sorting happens by **energy and geometry**, not charge:

1. Alphas exit fusion at ~2.9 MeV, well above the fuel ions' ~100-600 keV operating range. This energy gap is what everything downstream exploits.
2. The FRC's confining field naturally opens into a magnetic mirror/expander at the vessel ends. Low-energy fuel ions have small gyroradii and stay trapped, recirculating. High-energy alphas have large enough gyroradii and parallel velocity to leak preferentially — the "leak" is the exhaust mechanism, by design, not a confinement failure.
3. As the alphas ride down the diverging field, conservation of the magnetic moment (μ = ½mv⊥²/B) converts perpendicular gyration energy into parallel streaming energy — the corkscrewing particle straightens into a collimated beam by the time it exits the expander.
4. Only *now*, once it's an organized directional beam rather than plasma soup, do electrostatic/electromagnetic methods work:
   - **Direct conversion (power mode):** decelerate the beam against a staged electrostatic grid (traveling-wave direct converter) — running an accelerator backwards, converting KE straight to electrical potential
   - **Thrust (propulsion mode):** magnetically guide the beam out a nozzle as exhaust, no deceleration
   - **Split mode:** divert a controllable fraction of the beam cross-section to each — same reactor serves both ship functions, ratio is a control knob

Species selectivity (burning fuel escapes less than product alphas) is the actual unsolved-in-reality engineering problem — the thing this setting's engineers spent decades tuning via mirror ratio, field profile, and injection geometry.

**Unidirectional exhaust** (needed for a single-ended thrust drive, since FRC exhausts both ends symmetrically by default): achieved via asymmetric mirror ratio — tight confinement on the power end, leaky expander on the thrust end.

---

## 5. Loss suppression: bremsstrahlung and the Te/Ti split

Bremsstrahlung is not a side-channel or an impurity effect — any free electron deflecting off any ion radiates, as a fundamental consequence of having electrons in a plasma at all. It cannot be "purified away." The two real physics levers:

1. **Large sustained Te/Ti decoupling** — keep electron temperature low while the ion population runs hot and non-Maxwellian (peaked near the ~600 keV cross-section optimum via continuous neutral beam injection). Bremsstrahlung scales with electron temperature/density; fusion rate scales with the ion distribution. Decoupling them is the actual mechanism, not "fine temperature control."
2. **Bremsstrahlung photon recapture** — high-albedo chamber walls reflecting/recycling emitted X-rays back into usable heat/power rather than losing them outright.

This reactor's spec: combined radiative + side-channel loss **<0.4%** of gross fusion power, achieved via #1 and #2 above — a mastery-of-mechanism claim, not a "very precise thermostat" claim.

---

## 6. Energy balance — the formulas

$$
P_{net} = \eta_{conv} \times (1 - f_{loss}) \times P_{fusion} - P_{sustain}
$$

- η_conv = direct conversion efficiency ≈ 0.85 (staged electrostatic decelerator)
- f_loss = combined radiative + side-channel loss ≈ 0.004 (0.4%)
- P_sustain = injector + current-drive power required to keep the FRC alive

### The sustainment floor model

P_sustain is **not** a flat percentage of output. It has a fixed floor component (minimum absolute power to maintain the confining field and Te/Ti split *at all*, set by plasma physics — field decay rate, collisional relaxation rate) plus a small variable term that scales with fusion output:

$$
P_{sustain} \approx P_{floor} + k \times P_{fusion}
$$

- **Near rated output:** floor is negligible relative to output, so sustainment reads as a small flat fraction (this reactor: **6%** at rated-normal operation)
- **Near the floor:** fixed cost dominates a shrinking output, sustainment fraction climbs steeply
- **At P_fusion = P_floor exactly:** net output is **zero** — every watt produced goes to keeping the reactor alive, nothing left over. This is the true minimum stable operating point, not an arbitrary low-throttle guess.
- **Below P_floor:** the reactor cannot self-sustain on its own output at all. Requires external (battery) power injection to idle, or must shut down.

**P_floor is a reactor-specific stat, not a universal constant.** It's set by the confinement hardware actually mounted on the hull — bigger/more advanced core, different floor. Treat it as a datasheet dial per reactor model, the same way rated-max output is. (300 GW used throughout this doc as the worked example for one specific reactor class.)

### Worked example — this reactor: P_floor = 300 GW, rated max = 300 TW

| Fusion power | Fuel flow (total) | Proton | B¹¹ | Sustainment | Net output |
|---|---|---|---|---|---|
| 400 GW | 5.7 g/s | 0.48 g/s | 5.2 g/s | 75% | ~100 GW |
| 1 TW | 14.3 g/s | 1.2 g/s | 13.1 g/s | ~15-30%* | ~700-850 GW |
| 100 MW | 1.43 mg/s | 0.12 mg/s | 1.31 mg/s | — | (below floor, needs battery) |
| 1 GW | 14.3 mg/s | 1.20 mg/s | 13.1 mg/s | ~6%** | 787 MW |
| 300 TW (rated max) | 4.29 kg/s | 0.36 kg/s | 3.93 kg/s | 6% | 236 TW |

\* illustrative — exact curve between floor and rated output depends on k, not derived here
\** 6% figure strictly applies at/near rated design point; shown at 1 GW for the original toy example, not internally consistent with the floor model — treat the 1 GW row as the pre-floor-model baseline calc, superseded by the P_floor framework above

**Fuel flow and net output scale linearly with fusion power for a fixed reactor operating point** (same density/temperature setpoint). Scaling up *beyond* what a given reactor volume supports requires a physically larger reactor, not just more fuel — density/β stability limits, not fuel-flow math, are the wall there.

---

## 7. Thrust and specific impulse

### Pure alpha exhaust (undoped)

Alpha exit velocity from 2.9 MeV kinetic energy:

$$
v_{ex} = \sqrt{\frac{2E}{m_\alpha}} \approx 1.182\times10^7 \text{ m/s} \, (\sim\!3.9\% \, c)
$$

$$
I_{sp} = v_{ex}/g_0 \approx 1{,}205{,}000 \text{ s}
$$

$$
F = \dot{m} \times v_{ex}
$$

At 300 TW rated max (4.29 kg/s fuel flow ≈ total exhaust mass flow): **F ≈ 50.7 MN**, undoped, at ~1.2 million seconds Isp. Extreme Isp, modest thrust — a patient-burn cruise mode.

### Doped exhaust (neon/argon seed injection)

Seed mass injected into the exhaust stream, entrained and accelerated by the alpha-driven nozzle rather than fusing itself. Standard high-thrust/high-Isp tradeoff:

$$
P_{jet} = \frac{1}{2}\dot{m}v_{ex}^2 \quad\Rightarrow\quad F = \frac{2P_{jet}}{v_{ex}}
$$

Same jet power, lower effective v_ex (heavier/slower entrained exhaust) → thrust rises as 1/v_ex. Example: ~100x v_ex reduction → ~100x thrust increase for the same jet power. At 300 TW: **~5 GN thrust at ~12,000 s Isp** in doped mode.

**Seed injection rate is the crew-facing throttle** between cruise mode (pure alpha, minimal thrust, absurd Isp) and maneuver mode (doped, real thrust, still-excellent Isp) — independent control axis from the power/thrust routing split in §4.

---

## 8. Cold start sequence

Millennium-tier engineering compresses this from a naive 5-15 minute estimate down to **~2.5 minutes nominal**, but does not eliminate it — the rate-limiting stage is physics-limited (plasma stability), not just an engineering/power-delivery bottleneck.

| Stage | What's happening | Approx. duration | Power source |
|---|---|---|---|
| 1. Field formation | Coils energize, initial FRC topology forms (theta-pinch/merging-compression) | ~5-10 s | Battery (sharp transient spike) |
| 2. Ramp to operating density/temp | Neutral beam injection climbs, ion temp rises toward ~300+ keV, Te/Ti decoupling establishes | ~90-150 s | Battery → transitions to self-sustaining mid-stage |
| 3. Distribution stabilizing | Non-thermal ion tail settles, bremsstrahlung recapture confirmed tracking | ~20-30 s | Self-sustaining |
| 4. Throttle to commanded output | Move along the now-stable curve to rated-normal/rated-max | ~10-20 s | Self-sustaining |

**Self-sustainment crosses over during Stage 2**, roughly the **30-50% mark of the ramp timeline** (first minute-ish of a ~2.5 min total) — not at the end of the sequence. Fusion output isn't linear against ramp time; cross-section climbs steeply once ion temperature clears the useful range, so output crosses P_floor well before the ramp is complete. This gives crews a real, early go/no-go checkpoint rather than a coin-flip near the finish line.

Stage 2's floor is physics (instability risk from ramping too fast on a freshly-formed, not-yet-robust topology), not power delivery — "better engineers" buys a much better active stabilization/real-time instability-damping control loop, which compresses the safe ramp rate, but doesn't remove the limit entirely. A damaged ship or degraded control system reverts toward the original 5-15 minute range — a natural reliability/damage-state dial.

### Abort doctrine (crew-trainable, no physics degree required)

Watching the fusion-output-vs-time curve during Stage 2:

- **Monotonic but slower than nominal** → control loop is compensating for something (fuel impurity, under-spec injector) and still winning. Not dangerous, let it ride, flag for maintenance after.
- **Any oscillation/spiking** → control loop is losing against an instability it can't fully damp, and amplitude may be actively growing. Abort immediately — a single spike and the onset of runaway divergence look identical in the moment, so don't wait to find out which one it is.

Same doctrine class as fission-plant watchstanding: no one's solving transport equations in real time, they're trained on shape-of-curve pattern recognition. Lets a ship run competent generalist engineers instead of requiring an onboard confinement specialist.

---

## 9. Envelope protection and failure severity

**In-flight throttle response** (once at steady-state, no cold-start involved):
- Fusion power level (mass flow up/down within rated range): short ramp, seconds — moving along an already-stable curve, not building one from scratch
- Power/thrust routing split (§4 split mode): effectively instant — downstream field/electrode routing decision, not a change to the reaction itself

**Hard ceiling at rated max:** injection rate has a control-system-enforced cap, not a crew-discipline cap. Rated max (300 TW in this reactor's case) is set at the edge of the proven-stable operating envelope with margin, not a marketing number — same feedback loop that watches the Stage 2 ramp curve keeps watching permanently and clamps injection before instability threshold. Crew can command past it; the reactor won't comply. Analogous to flight envelope protection ignoring a control input that would over-stress the airframe.

**"Rated max" vs. "theoretical max":** the safeguard clamp sits at 300 TW; the actual instability threshold is somewhat higher, with margin built in. Manually disabling envelope protection to push past rated max is a real (if reckless) crew option — mechanically identical in kind to overriding a flight envelope limiter.

**Failure severity scales with energy density at time of failure, not linearly with how far over-limit you push:**

- **Confinement failure near/below P_floor** (e.g., a botched cold start abort scenario): plasma inventory at that moment is small — barely-formed field, trickle of fuel throughput. Loss of confinement dumps a modest, localized energy burst. Bad day for the reactor compartment, survivable for the ship.
- **Confinement failure at high output (rated-max-and-above, e.g., an overridden-safeguard redline push):** mature, dense, fully fusion-active plasma carries an enormous instantaneous energy inventory with no slow bleed-off path once the magnetic bottle fails. Full inventory — thermal/kinetic energy plus fuel mid-transit through the core — releases essentially all at once into the surrounding structure. No literal stellar physics required; this reads mechanically as an uncontained multi-terawatt release with no containment vessel designed to survive it — effectively catastrophic hull loss.

This is why overriding the safeguard is a genuine last-resort narrative beat rather than free power: the downside isn't proportional to the extra output gained, it's however badly the energy-density-at-failure term scales, which is worse.

---

## 10. Tech-ladder placement and comparative complexity

Slots as the direct successor to the D-He3 ICF torch — same downstream role (propulsion + power from one core), not a separate branch. A full generational leap in reactor engineering, not an incremental upgrade, across three independent axes:

| Axis | D-He3 ICF | p-B¹¹ FRC |
|---|---|---|
| Confinement | Inertial, pulsed — brute-force compression, hold together via inertia for nanoseconds | Magnetic, continuous — self-organized topology sustained indefinitely against real-time instability |
| Species/temperature control | Get hot enough, fast enough, once per pulse | Continuous, active Te/Ti distribution-function shaping — never "solved," always maintained |
| Product handling | Fusion products dump into a thermal-cycle blast chamber — well-understood 20th-century-adjacent problem | Clean directional alpha beam via μ-invariant field divergence, split in real time between direct-conversion and thrust — an entire extra subsystem ICF doesn't need |

ICF is a very precisely thrown punch, repeated. FRC is sustaining a metastable, actively-controlled, multi-parameter plasma state forever while also routing where the energy goes, continuously. The "cleaner torch" framing is true of the *output* — thrust and power characteristics read as a straightforward upgrade — but the machine underneath is a different species entirely.

---

## Open items / not covered here

- **Battery/hotel-power endurance while fully dark (reactor shut down, coasting on stored power alone).** Deliberately out of scope for this document — battery systems are handled as a separate cross-cutting doc, since nothing else in the setting (including the fold drive) can be fed by them either. Reactor-side conclusion reached: full shutdown-and-coast is the sane choice over floor-idling for any stealth-relevant scenario, since floor-idle at P_floor still radiates a real, continuous heat/power signature, while full shutdown eliminates it entirely at the cost of the cold-start sequence in §8 to get back underway.
- **k (variable sustainment coefficient) and the exact floor-to-rated sustainment curve** — flagged in §6 but not derived; the 1 TW / 400 GW rows in the table are illustrative, not rigorously fit.
- **P_floor as a stat dial** — this doc uses 300 GW throughout as one specific reactor's worked example. Different hulls/reactor classes should carry their own P_floor and rated-max pair as part of their datasheet, not inherit this one.