// Player-facing time compression. Formula-derived durations (a 17.4-hour
// reactor cold-start, a 500g/s burn sustained for 51 hours) are unplayable
// at 1:1 — everything here runs on a compressed clock instead. Every
// wall-clock second of gameplay represents this many in-fiction seconds of
// ship time elapsing. Displayed to the player as dimmed chrome so the gauges
// moving "too fast" has a legible explanation.
const REAL_MINUTES_PER_TICK_SECOND = 30;
const IN_FICTION_SECONDS_PER_TICK_SECOND = REAL_MINUTES_PER_TICK_SECOND * 60;

// Converts a true physical power (Watts — Joules per in-fiction-second) into
// the percent change to a `capacityPJ`-sized energy pool over one wall-clock
// tick of `dt` seconds.
function percentPerTick(powerWatts: number, dt: number, capacityPJ: number): number {
    const inFictionSeconds = dt * IN_FICTION_SECONDS_PER_TICK_SECOND;
    const joules = powerWatts * inFictionSeconds;
    const pj = joules / 1e15;
    return (pj / capacityPJ) * 100;
}

export {IN_FICTION_SECONDS_PER_TICK_SECOND, percentPerTick, REAL_MINUTES_PER_TICK_SECOND};
