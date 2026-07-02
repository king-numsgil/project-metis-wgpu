# Slipspace formulas

# Slipspace drive — physics model & formula reference

## What slipspace actually is

Slipspace is Metis's faster-than-light travel layer. It has nothing to do with the fold drive — fold stays purely subluminal, contracting and expanding ordinary 4D spacetime around a ship the way a treadmill moves the ground instead of the runner. Slipspace works on a completely different idea: normal space has more dimensions than the four we can see, but seven of them are compactified — curled up so tightly they're invisible and inaccessible to anything built out of ordinary matter. A slip drive doesn't tunnel through space and it doesn't warp it. It locally switches off whatever holds those extra dimensions shut, in a roughly spherical region, and the compactified dimensions spring open there. From outside, that region looks exactly like a classic wormhole mouth — a glowing, roughly spherical hole a ship can fly into. That appearance is a side effect, not the mechanism. There's no tunnel behind it. There's just a patch of space where 4D briefly becomes 11D.

A ship that flies into that threshold doesn't get teleported. It crosses into the 11-dimensional layer proper — a genuinely separate domain that doesn't interact with normal space at all, the same way two different rooms don't interact just because there's a door between them. The ship then travels through that layer for a real duration, the way it would travel through normal space, before generating a second threshold of its own to tear back out into 4D space at the destination.

This is a deliberately fictional mechanism. We went looking for real physics first — wormhole throats (Morris-Thorne), exotic-matter warp metrics (Alcubierre), and even published higher-dimensional ("braneworld hyperdrive") variants of warp metrics — and none of them produce a survivable energy budget for a starship-sized aperture. The real numbers came out between 10^38 and 10^46 joules, which is "boil a planet" territory no matter how the math is sliced. So slipspace is written as a discovered, not derived, technology: it works, the civilizations using it can engineer it, but nobody's first-principles model fully explains why the energy cost is survivable. That's intentional — it mirrors how plenty of real engineering works in practice, and it leaves room for in-universe disagreement between physicists about what's really going on.

## Why a stability bubble is needed

A ship is built out of ordinary 4D matter — atoms, bonds, structures that assume exactly three spatial dimensions plus time. Drop that into an environment with seven extra directions available and the physics holding it together doesn't have a clean "11D version." Electromagnetic forces, structural bonds, pressure — none of it is guaranteed to behave sanely once particles have new directions to exist in. So every ship that slips needs an active stability bubble: a field that keeps the ship's own local patch of space behaving like normal 4D space, holding the ship coherent against an 11D environment its physics was never built for. This isn't a nice-to-have. Without it, "ship" stops meaning "ship" very quickly.

## Why it's never perfectly safe

Massive objects — stars, planets — still curve the 11D layer the same way they curve normal spacetime. That means a ship's computer can detect them from inside slipspace as gravitational "shadows," and a correctly-calculated transit threads a course around them and exits cleanly near the destination. The catch is that slipspace is turbulent. It's not a calm, empty corridor — it's messy, with currents and eddies that constantly degrade the precision of every measurement the ship's sensors take. Better tech (sharper sensors, faster computers) shrinks that error, but never removes it. There is no tech level at which slip travel becomes risk-free. That's a deliberate design choice: slip travel should always carry some irreducible danger, scaling down with civilizational sophistication but never hitting zero.

## Why speed isn't the right stat

Early drafts of this system tried to give slipspace a velocity — light-years per hour — the same way you'd describe a car's speed. That fell apart for a simple reason: with a galaxy of tens of thousands of stars that the game wants players jumping between constantly, no real-time velocity number works for every ship. A number small enough to keep a corvette's jump under fifteen minutes makes a capital ship's jump over an hour. A number that keeps capital ships reasonable makes corvettes' jumps feel instant and over before they register.

The fix: stop treating slipspace transit as something with a duration that scales with distance. Jump duration is now a near-flat gameplay constant — every jump takes roughly the same handful of seconds in real time, the way Elite Dangerous treats a hyperspace jump as a short loading-screen-like beat rather than a real-time crawl. What scales with ship mass and tech level instead is **range** — how far a ship can safely jump in one go. A light, well-equipped ship might safely cross dozens of light-years in one jump. A lumbering capital ship might only manage a handful, and need to chain several jumps with waypoints to cover the same ground. That's a much better lever for gameplay: it creates real route-planning tension without ever asking a player to sit through a long timer.

## Why overreaching isn't just "ship explodes"

A ship can still attempt a jump longer than its safe range — the drive doesn't refuse, it just gets less accurate. Pushed past safe range, two things degrade together, because they share the same root cause (the navigation computer running out of road on the precision math): the chance of a genuinely dangerous exit (popping out inside a mass shadow) goes up, and even when the exit isn't dangerous, the ship tends to land further from its intended destination — sometimes a clean arrival right next to the target star, sometimes a sloppy arrival several AU out that needs real in-system travel to close the gap. This means overreaching is a dial, not a coin flip: push a little past safe range and you'll probably just need some extra coasting time; push a lot past it and you're gambling with the ship.

---

## State variables

Quantities tracked live during a jump attempt:

| Variable | What it is |
| --- | --- |
| `phase` | Where the ship is in the jump: threshold-open, in-transit, or threshold-close |
| `precision_error` | Accumulated navigation drift from turbulence — the thing that determines exit accuracy |
| `bubble_integrity` | Health of the 4D-stability field holding the ship coherent in the 11D layer |
| `hull_stress` | Accumulated structural strain from turbulence acting on the hull |

## Ship class parameters

Fixed values baked into a hull design:

| Parameter | Symbol | What it means |
| --- | --- | --- |
| Ship mass | `m` | Tonnes. Drives both safe range and hull stress resistance. |
| Threshold radius capability | `R` | Max threshold radius the drive can open (m). Gates hull size against drive class — needs to be roughly half the ship's largest cross-section. |
| Hull rating | `hull_rating` | A new foundational stat representing structural/armor quality, independent of raw mass. |
| Reactor output | (feeds `k_thresh`, `k_bubble` budget) | How much power the ship can actually commit to threshold and bubble costs. |

## Control / environment inputs

| Input | Symbol | What it does |
| --- | --- | --- |
| Attempted jump distance | `distance` | Light-years the pilot is trying to cross in one jump |
| Local turbulence | `turbulence` | Regional "weather" value for slipspace roughness — tied to proximity to mass concentrations or just a seeded regional field |
| Tech level | `tech` | Civilizational/drive sophistication — improves safe range and reduces (but never zeroes) risk |

---

## Formula 1 — Threshold (decompactification) energy

The one-time cost to suppress confinement and open a threshold of a given radius. This is a real cost paid twice per jump — once to open at the origin, once to tear open the exit at the destination.

```
E_threshold = k_thresh × 4πR² × (1 + turbulence_local)
```

**ELI5:** the cost scales with the surface area of the threshold sphere, not its volume — because the fiction is that you're suppressing confinement across a boundary, not filling an entire sphere's worth of space with the effect. Doubling the radius roughly quadruples the cost (area scales with the square of radius), which is much more forgiving than trying to scale a held-open tunnel, and it's why this mechanism survived where the wormhole-throat math didn't. Local turbulence adds a surcharge — it's harder to punch a clean threshold in rough slipspace weather.

`k_thresh` is a free tuning constant (energy per square meter, in whatever unit system the engine ultimately uses) — pure balancing knob, no physical claim attached.

## Formula 2 — Stability bubble power

A sustained power draw — not a one-time cost — because the bubble has to hold for the entire transit.

```
P_bubble = k_bubble × m^0.75 × (1 + turbulence)^1.5
```

**ELI5:** heavier ships cost more to keep coherent (more 4D matter to protect), but the cost grows slower than mass itself — a `0.75` exponent means doubling the ship's mass less than doubles the bubble's power draw, similar in spirit to how the fold drive turned out to be forgiving on scale. Turbulence is the opposite story: it's deliberately punishing, with an exponent above 1, because fighting a rougher environment should cost disproportionately more, not just a little more.

Total bubble energy for a transit is `P_bubble × duration`, where `duration` comes from Formula 5 below.

`k_bubble`, and the two exponents (`0.75` and `1.5`), are all free tuning constants.

## Formula 3 — Max safe range

This is the headline ship stat — what used to be "speed" before the redesign. It's how far, in light-years, a ship can jump in one go while staying inside safe precision tolerances.

```
max_safe_range = r_ref × √(m_ref / m) × [1 + (f_max − 1) × (1 − e^(−tech / tech_scale))]
```

**ELI5:** there are two multipliers stacked on a baseline range (`r_ref`, the safe range of a reference 1000-tonne ship at tech level zero).

The mass term, `√(m_ref / m)`, is an inverse-square-root curve: lighter ships get more range, heavier ships get less, but the falloff is gentle rather than brutal — a ship ten times lighter than reference doesn't get ten times the range, it gets about 3.16 times the range (the square root of ten). This rewards small ships without making capital ships feel completely punished.

The tech term is a capped improvement curve. At `tech = 0` it equals exactly 1 (no bonus). As tech increases, it climbs toward a ceiling of `f_max` (currently 3, meaning "triple the baseline range, at most") but never exceeds it, no matter how high tech goes. This is the asymptotic-improvement shape: gains are large early, then flatten out, so a maximally advanced civilization is dramatically better than a primitive one, but tech alone can never make range unlimited.

`r_ref`, `f_max`, and `tech_scale` (how quickly the tech bonus approaches its ceiling) are all free tuning constants.

## Formula 4 — Overreach and exit drift

When `distance` (the attempted jump) exceeds `max_safe_range`, the ship is overreaching. Define:

```
overreach_fraction = max(0, distance − max_safe_range) / max_safe_range
```

This single number then drives both consequences of overreaching together, since they share the same root cause — the navigation computer running low on usable precision the further past safe range you push it.

**Exit distance from the target star (in-system drift):**

```
exit_distance_AU = k_exit × overreach_fraction^p_exit
```

**ELI5:** this is the "galaxy map slider" number — how far from the intended star the ship actually pops out, in astronomical units. The curve is deliberately accelerating (`p_exit > 1`, currently 2.2): a small overreach barely matters (10% overreach lands you well under 1 AU off target, basically a rounding error), but pushing further gets punishing fast (100% overreach — attempting double a ship's safe range — lands you tens of AU out, real coasting-time territory; 200% overreach can put you hundreds of AU out). That shape is what makes the slider interesting rather than flat: the first bit of "going further" is nearly free, and then there's a real knee where it starts costing you serious in-system travel time.

`k_exit` (the drift distance at exactly 100% overreach) and `p_exit` (how sharply the curve accelerates) are both free tuning constants.

**Danger tier (not a separate roll — read directly off overreach_fraction):**

- `overreach_fraction = 0`: clean arrival, nominal precision, exit lands near the target.
- `0 < overreach_fraction < 0.5`: sloppy exit — elevated drift, but no meaningful danger, just extra in-system coasting.
- `overreach_fraction ≥ 0.5`: severe drift, real risk of a dangerous exit (popping out inside a mass shadow).

This keeps overreach as a continuous dial a pilot or galaxy-map UI can show directly, rather than hiding the risk behind an opaque dice roll.

## Formula 5 — Jump duration (gameplay constant)

```
duration = base_duration × (1 + 0.3 × turbulence) × (1 + 0.5 × overreach_fraction)
```

**ELI5:** this is deliberately almost flat. `base_duration` (default around 20 seconds) is the real number that matters — every jump takes roughly that long in real time, regardless of how many light-years it covers, which is what makes a 20,000-plus star galaxy actually playable without every jump becoming a chore. Turbulence and overreach both nudge the duration up a little (the computer's working harder), but neither term is allowed to make duration scale with distance the way it would in a "real" constant-velocity model. This is the formula that explicitly breaks from "physically derived" and into "gameplay-first" — it exists to serve pacing, not lore accuracy.

## Formula 6 — Hull stress accumulation and tolerance

Ties directly into the gravitational-mass idea from the null drive: heavier ships are harder for turbulence to physically rattle, with a tunable cutoff point past which a ship essentially stops caring about turbulence at all.

**Resistance factor (how much of the turbulence a ship's mass shrugs off):**

```
resistance_factor = 1 / (1 + (m / m_cutoff)^sharpness)
```

**Stress accumulation rate:**

```
stress_rate = turbulence × resistance_factor
```

**Accumulated stress over a transit:**

```
hull_stress = stress_rate × duration
```

**Tolerance (the budget before structural failure):**

```
tolerance = hull_rating × (1 + hull_mass_coeff × m)
```

A jump is survivable exactly when `hull_stress ≤ tolerance`.

**ELI5:** `resistance_factor` is a sigmoid — at very low mass it's close to 1 (the ship feels essentially full turbulence), at `m = m_cutoff` it's exactly 0.5 (half the turbulence gets through), and well above `m_cutoff` it drops toward 0 (the ship is so massive that turbulence barely registers — too big to care). `sharpness` controls how hard that transition is: a low value gives a gradual taper, a high value gives a sharp knee right at `m_cutoff`.

This is intentionally a separate system from `max_safe_range` and the speed/mass curve. They're related (both are turbulence pushing back against a ship) but conceptually distinct: `max_safe_range` is about navigation precision (can the computer find a clean exit), while hull stress is about raw structural survival (does the ship's frame hold together physically). A ship can have plenty of safe range left and still be accumulating dangerous stress if it's light and the local turbulence is bad — and conversely, a heavy ship deep into overreach territory for navigation purposes might still be in no structural danger at all, because its mass alone is shrugging off the strain.

`tolerance` deliberately doesn't scale only with mass — it's dominated by `hull_rating`, a new design stat representing build quality, reinforcement, and structural engineering, with only a small additional bonus from raw mass (`hull_mass_coeff`). This keeps a "flimsy heavy ship" and a "reinforced heavy ship" meaningfully different, rather than letting tonnage alone guarantee survivability.

`m_cutoff`, `sharpness`, and `hull_mass_coeff` are all free, independently tunable constants — set per-setting or even per-hull-design if you want certain ship lines to advertise unusually high turbulence resistance as a selling point.

---

## Free tuning constants — full list

| Constant | Controls | Used in |
| --- | --- | --- |
| `k_thresh` | Threshold energy per unit area | Formula 1 |
| `k_bubble` | Bubble power baseline | Formula 2 |
| `r_ref` | Baseline safe range at reference mass/tech | Formula 3 |
| `f_max` | Maximum tech-driven range multiplier (ceiling) | Formula 3 |
| `tech_scale` | How quickly tech approaches its ceiling | Formula 3 |
| `k_exit` | Exit drift distance at 100% overreach | Formula 4 |
| `p_exit` | How sharply exit drift accelerates with overreach | Formula 4 |
| `base_duration` | Baseline real-time jump duration | Formula 5 |
| `m_cutoff` | Mass at which hull stress resistance hits 50% | Formula 6 |
| `sharpness` | How sharp the stress-resistance cutoff is | Formula 6 |
| `hull_mass_coeff` | How much raw mass contributes to stress tolerance | Formula 6 |

Eleven independently tunable knobs, none of which require touching the shape of any curve to rebalance — every one is a pure coefficient or exponent sitting on top of a locked mechanism.

## What's physically real vs. invented here

For transparency, since this system mixes real theoretical physics with deliberate fiction once the real math hit a wall:

**Grounded in real (if speculative) theoretical physics:** the idea of compactified extra dimensions (Kaluza-Klein-style), the idea that wormhole-like geometries can behave very differently when analyzed in a higher-dimensional embedding rather than plain 4D spacetime, and the real, published energy costs for Morris-Thorne throats and Alcubierre-style warp metrics (which is precisely the math that ruled those mechanisms out for ship-scale slip travel).

**Deliberately invented, with no claim to derivation:** the specific "field cancellation" trigger mechanism (locally switching off whatever holds compactified dimensions shut), the visual wormhole-like appearance of the threshold as a side effect of that cancellation, the existence and behavior of the 4D-stability bubble, and every formula in this document. These are fiction built to be internally consistent and tunable for gameplay — not predictions, not derivations, and not citable to any real paper. That's a deliberate, considered choice once the real physics made a ship-scale slip drive numerically impossible, not a shortcut taken to avoid doing the math.