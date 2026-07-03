# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`metis-tui` is a terminal-UI ship-systems sim: a starship power-plant control panel (SMES capacitors, coolant loop, fusion reactor) rendered with [OpenTUI](https://github.com/anomalyco/opentui) (`@opentui/core` + `@opentui/react`, a React reconciler that renders to a terminal instead of the DOM). It was scaffolded with `bun create tui` and is a standalone package in this monorepo — it does not currently depend on `bun-webgpu-rs` or `metis-game`.

## Commands

Run from `packages/metis-tui/` unless noted.

```powershell
# Install deps (from repo root)
bun install

# Run the TUI (watch mode)
bun dev

# Headless render check — mounts the app in a mock terminal and prints
# ASCII frames to stdout; use this to sanity-check panel/layout changes
# without a real terminal
bun run fixture

# Type-check this package
bunx tsc --noEmit

# Type-check the whole monorepo (also covers this package's files)
cd ../.. && bunx tsc --noEmit
```

There is no `bun test` suite here yet — `test/fixture.tsx` (above) is the only automated check, driving `@opentui/core/testing`'s `createTestRenderer` directly (not `@opentui/react/test-utils`' `testRender`, since the keymap must be built from the renderer instance *before* the React tree renders).

## Architecture

### Sim thread vs. render thread

The ship simulation runs on a separate thread from the UI, matching the intended production architecture (sim @ 10Hz, render reads snapshots):

- [`src/state/shipSim.ts`](src/state/shipSim.ts) — pure state + reducer, **no React or renderer imports**, so it can run inside a Worker unmodified.
- [`src/state/shipWorker.ts`](src/state/shipWorker.ts) — the Worker entry point. Owns the authoritative `ShipState`, ticks the reducer at 10Hz via `setInterval`, and `postMessage`s the full state snapshot after every tick.
- [`src/state/ship.tsx`](src/state/ship.tsx) — the React-side bridge (`ShipProvider`/`useShip`). Spawns the worker, sets React state from incoming snapshots, and `dispatch()` just forwards actions to the worker via `postMessage` — the main thread never runs the reducer itself.

Panels (`src/panels/*`) are pure presentational reads of `useShip().state`; they never touch the reducer or worker directly, and dispatch actions instead of mutating anything.

### Time compression

Formula-derived durations (17.4h reactor cold start, 51h burn) are unplayable at 1:1, so [`src/physics/time.ts`](src/physics/time.ts) defines the single compression constant (`REAL_MINUTES_PER_TICK_SECOND = 30`) and `percentPerTick()`, which converts a physical power (Watts) into a percent change to a `capacityPJ`-sized energy pool over one wall-clock tick. Every energy transfer in `shipSim.ts`'s tick handler goes through this function — it's the one place real Watts get translated into the 0–100 gauge values the panels render.

### Physics modules are cited to `math/*.md`

The `math/` directory holds the game's canonical formula docs (fold drive, fusion torch, null drive, slipspace). Physics code cites the specific formula/doc it implements rather than re-deriving numbers inline:

- [`src/physics/torch.ts`](src/physics/torch.ts) — D-He3 fusion yield (Formula 1) and the reference Roci-class numbers, from `math/Fusion torch formulas.md`.
- [`src/physics/fold.ts`](src/physics/fold.ts) — SMES capacity and fold-drive reference numbers (Formula 4), from `math/Fold drive formulas.md`.
- [`src/physics/heat.ts`](src/physics/heat.ts) — the heat chain (waste heat → demanded coolant flow → fluid temp → hull temp → radiator flux, Formula 5), plus gameplay-only lag time constants (`relax()`, first-order relaxation) that aren't in any doc.

`math/Null drive formulas.md` and `math/Slipspace formulas.md` don't have corresponding code yet — they're reference material for future systems.

When a constant *isn't* backed by a formula (pump draw, ignition transient, prime duration, thermal lag taus), the source comments say so explicitly and explain the reasoning (e.g. "sized as a small fraction of canonical reactor output" for pump draw) — preserve that distinction when touching these files, since it's the difference between "this number is derived" and "this number is tuned for feel."

### Component layout

- `src/index.tsx` — process entry: creates the `CliRenderer`, builds the default OpenTUI keymap, renders `<App/>`.
- `src/App.tsx` — top-level layout (three panels side by side) and global key bindings (`ctrl+q` quit, `` ` `` toggle console).
- `src/panels/*` — one panel per ship system (Capacitor, Cooling, Reactor); each shows a `NoPower` placeholder when the aux bus is disconnected.
- `src/components/*` — reusable widgets (`Bar` gauge, `Knob` multi-mode selector, `Switch` toggle, `NoPower`).
- `src/format.ts` — shared unit-formatting helpers (PJ/s, TW, Kelvin, W/m², kg/s) used across panels.
