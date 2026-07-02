# Fusion torch formulas

# Fusion torch drive — physics model & formula reference

## What the fusion torch actually is

The fusion torch is a D-He3 inertial confinement fusion rocket — the in-universe equivalent of the Epstein drive. It is still a rocket: it burns fuel, ejects mass out the back, and obeys the rocket equation. Nothing about it cheats Newton. What makes it feel magical is a single number — how much power it squeezes out of every kilogram of engine — that sits roughly ten thousand times beyond anything humanity has built or seriously designed on paper.

This is the honest part of the setting: one dial is pushed far past real engineering, and everything downstream of that dial is consistent, calculable, and grounded in actual fusion physics.

---

## The one magic number

Every torch drive's entire identity reduces to its **specific jet power** — watts of thrust-power per kilogram of engine mass. Real peer-reviewed fusion rocket concepts (VISTA, Discovery II, Direct Fusion Drive) land somewhere between 1 and 6 kilowatts per kilogram. The Metis torch needs 10 to 100 *megawatts* per kilogram to make 1g interplanetary travel work. That gap — not the fusion reaction itself, not the exhaust velocity — is the McGuffin. Everything else in this document is real physics built on top of that one assumption.

---

## Formula 1 — The fuel

D-He3 fusion releases energy by combining deuterium and helium-3 nuclei:

$$
D + {}^3\text{He} \rightarrow {}^4\text{He}\ (3.6\ \text{MeV}) + p\ (14.7\ \text{MeV})
$$

Total yield is 18.3 MeV per reaction, split unevenly between the two product particles because lighter particles carry more of the momentum-conserving kick — the proton gets about four-fifths of the energy.

Converting to a per-kilogram number for the fuel mixture:

$$
E_{sp} = \frac{18.3\ \text{MeV}}{5.03\ u} \approx 3.5 \times 10^{14}\ \text{J/kg}
$$

**ELI5:** One kilogram of D-He3 fuel mixture releases 350 trillion joules when fused — about 0.39% of its mass converted directly to energy via E=mc². That is an enormous number by any conventional standard. It is also nowhere near enough on its own to explain a torch drive — what matters next is how fast you can turn that energy into thrust.

**Honest caveat:** D-He3 isn't perfectly clean. Side reactions between deuterium nuclei leak 1–5% of total power as neutrons, which is the physical reason this fuel cycle is harder to ignite than simpler reactions and plausibly why it's a later-tier technology rather than a starting one.

---

## Formula 2 — The hard exhaust velocity ceiling

If every joule of fusion energy went perfectly into directed exhaust kinetic energy, exhaust velocity caps out at:

$$
v_{e,max} = \sqrt{2 E_{sp}} = 2.65 \times 10^7\ \text{m/s} = 0.088c
$$

**ELI5:** No D-He3 drive, however advanced, can throw exhaust out the back faster than 8.8% of the speed of light. This is a hard physical ceiling, not an engineering target — real drives sit well below it because converting fusion energy into directed exhaust motion is never perfectly efficient. This number becomes important later when it sets the wall on interstellar travel.

---

## Formula 3 — The master equation

For a ship holding steady acceleration `a` with exhaust velocity `v_e`, thrust `F = ṁv_e`, and jet power `P = ½ṁv_e²`:

$$
\frac{P_{jet}}{M_{ship}} = \frac{1}{2} a \cdot v_e \qquad F = \frac{2P_{jet}}{v_e}
$$

**ELI5:** Ship mass completely cancels out of the power requirement. A torch drive's entire performance identity collapses into one ratio — power per kilogram of ship, traded against how fast you want the exhaust moving. Pick an acceleration and an exhaust velocity, and the required specific jet power falls straight out:

| Mode | Specific power required | vs. best real concept |
| --- | --- | --- |
| 1g @ 0.088c (theoretical ceiling) | 129 MW/kg | ~20,000× |
| 1g @ 0.05c | 74 MW/kg | ~12,000× |
| 0.3g @ 0.05c | 22 MW/kg | ~3,500× |
| 0.1g @ 0.03c | 4.4 MW/kg | ~700× |

**The torch's entire stat block is two dials:** specific jet power (the McGuffin) and structural waste fraction (covered in Formula 5, sets radiator size and detectability).

---

## Formula 4 — Interplanetary travel times

Grant the specific power and the brachistochrone trajectory — accelerate to the midpoint, flip the ship, decelerate the rest of the way — becomes trivial:

$$
t_{total} = 2\sqrt{\frac{d}{a}} \qquad v_{peak} = \frac{a \cdot t_{total}}{2} \qquad \Delta v = 2v_{peak} \qquad \text{mass ratio} = e^{\Delta v / v_e}
$$

For a 1000t reference ship at `v_e = 0.05c`:

| Route | Travel time @ 1g | Peak speed | Fuel fraction |
| --- | --- | --- | --- |
| Earth–Mars (0.5 AU) | 2.0 days | 857 km/s | 11% |
| Earth–Jupiter (4.2 AU) | 5.9 days | 0.008c | 28% |
| Earth–Saturn (8.5 AU) | 8.3 days | 0.012c | 38% |
| Earth–Neptune (29 AU) | 15.4 days | 0.022c | 58% |

**ELI5:** Once you accept the specific power assumption, interplanetary travel is essentially solved. Fuel is cheap — even crossing the entire solar system burns only 10–60% of a ship's mass in fuel, in days rather than years. This is why the drama in a Tier 1 civilization lives in engineering and heat management, not in fuel gauges. He3 is the strategic currency of the setting, but nobody is sweating a single trip's fuel cost.

---

## Formula 5 — The waste heat wall

This is the actual bottleneck of torch technology — not energy, not fuel, but where the leftover heat goes. Thermodynamics demands some fraction of jet power lands in ship structure rather than leaving cleanly with the exhaust, and that fraction must be radiated away:

$$
P_{rad} = \varepsilon \sigma A T^4
$$

Where `ε` is emissivity, `σ` is the Stefan-Boltzmann constant, `A` is radiator area, and `T` is radiator temperature in kelvin.

**ELI5:** The fourth-power temperature dependence is the whole story. Run radiators hotter and their required area shrinks dramatically — doubling temperature cuts required area by sixteen times. This is why a fusion ship that wants small, hull-integrated radiators must run them glowing hot, and why "shoot their radiators" is a legitimate tactic against a ship that hasn't solved this problem well.

For a 1000t ship at 1g, 0.05c (74 TW jet power):

| Waste fraction landing in structure | Heat to shed | Radiator @ 1500K | Radiator @ 3000K |
| --- | --- | --- | --- |
| 0.1% | 74 GW | 256,000 m² | 16,000 m² |
| 1% | 735 GW | 2.56M m² | 160,000 m² |
| 5% | 3.7 TW | 12.8M m² | 800,000 m² |

The honest path to small, hull-mounted radiators (a few thousand m² rather than millions) requires structural waste fraction below roughly 0.01% **and** radiator temperatures in the 2500–3500K range. Both numbers are achievable design targets, not handwaves — they're knobs a ship designer turns deliberately.

---

## Formula 6 — Where the real cheat lives

D-He3 plasma at the temperatures needed for ignition (~100 keV, roughly a billion kelvin) radiates X-ray bremsstrahlung at a meaningful fraction of total fusion power — this is a real, irreducible physical effect, not an engineering failure. Even an optimistic 0.3% leak to ship structure produces roughly 55 GW of heat that must go somewhere, requiring radiator area in the thousands of square metres even at 3000K.

**This is the one genuine cheat in the torch's physics, and it should be named as such in any derivative design work.** A "magic" torch drive that fits radiators onto a compact hull is quietly assuming this bremsstrahlung leak is near zero, which no real D-He3 plasma allows. Everything else in the torch's physics — the reaction yield, the exhaust velocity ceiling, the radiator sizing, the rocket equation — is derived honestly. This one number is asserted rather than derived.

**The legitimate escape valve for combat:** rather than radiating continuously, a ship can absorb waste heat into an open-cycle coolant (water boiling off at 2.26 MJ/kg) for the duration of a short engagement. Shedding 55 GW this way burns coolant at a rate that would be absurd over a multi-day cruise but is trivial for a five-minute combat burst. This is why heat problems bite hardest on sustained cruise and nearly vanish during action — exactly the kind of asymmetry a DCS-style heat-budget mechanic should model explicitly rather than hide.

---

## Formula 7 — Interstellar collapse (why slipspace has to exist)

The relativistic rocket equation, for a flip-and-burn trip that accelerates to cruise speed and decelerates to a full stop at the destination:

$$
\text{mass ratio} = \left(\frac{1+\beta}{1-\beta}\right)^{c/v_e}
$$

Where `β = v_cruise / c`. At the theoretical D-He3 ceiling (`v_e = 0.088c`, so `c/v_e ≈ 11.4`):

| Cruise speed | Mass ratio (round trip with braking) | Coast time to nearest star |
| --- | --- | --- |
| 0.05c | 3.1 | ~85 years |
| 0.1c | 9.8 | ~42 years |
| 0.2c | 100 | ~21 years |
| 0.3c | 1,140 | ~14 years |
| 0.5c | 264,000 | ~8 years |

**ELI5:** A torch ship at its absolute physical ceiling and accepting an 85-year one-way coast can manage 0.05c with a sane fuel fraction. Anything faster, or anything that wants to actually stop at the destination, costs fuel mass that grows explosively. A round trip at a reasonable 0.2c is 99% fuel — a number no amount of engineering cleverness fixes, because it's baked into the exponential structure of the rocket equation itself, not into any specific technology limitation.

**This is the load-bearing worldbuilding fact:** the fusion torch physically cannot do interstellar travel at civilizational scale. Slipspace isn't a redundant convenience bolted on top of the torch — it exists because the torch's own physics forbids casual travel between stars. The boundary between "where the torch works" and "where you need slipspace" is a real, calculated number (roughly 0.1c, mass ratio ≈ 10), which is what makes the tech ladder feel discovered rather than arbitrarily assigned.

**Reality anchor:** Project Daedalus (British Interplanetary Society, 1973–78) is the most rigorous real engineering study of this problem. It reached 0.12c using 50,000 tonnes of fuel for a 450 tonne payload — and only by refusing to decelerate at all (a flyby, not a stop). Braking at the destination roughly halves max velocity and doubles travel time. Daedalus is the honest ceiling of what fusion alone can do; the Metis torch's interstellar wall sits in the same place for the same physical reasons.

---

## Ship class parameters

```
FusionTorch {
  P_specific      // W/kg — specific jet power, the core McGuffin (10-130 MW/kg range)
  v_e             // m/s — exhaust velocity, capped at 0.088c
  m_dry           // t — ship dry mass
  waste_fraction  // 0-1 — fraction of jet power leaking to structure (sets radiator size)
  radiator_temp   // K — radiator operating temperature (2500-3500K for compact designs)
  radiator_area   // m² — derived from waste_fraction and radiator_temp via Formula 5
  heat_sink_cap   // GJ — open-cycle coolant budget for combat bursts
}
```

## Reference ship — Roci-class frigate

| Parameter | Value | Notes |
| --- | --- | --- |
| Dry mass | 1,000 t | reference hull |
| Fuel burn (canonical) | 500 g/s D-He3 | with 5× neon doping for thrust |
| Acceleration | ~1.2g | sustained |
| Burn duration | 51 hours | at canonical fuel burn |
| Jet power | ~74–92 TW | depending on exhaust velocity setting |
| Specific jet power | ~74–92 MW/kg | the McGuffin number for this hull |

At these numbers, Earth–Mars opposition crossing takes 2 days, fuel cost is roughly 11% of wet mass, and the ship never approaches the rocket equation's exponential wall — because it never needs to leave the solar system. That wall is exactly where slipspace takes over.