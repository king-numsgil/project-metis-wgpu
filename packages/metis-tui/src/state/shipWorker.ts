// Runs on a separate thread (Bun Worker). Owns the authoritative ship state
// and ticks the simulation independently of the render loop, matching the
// intended production architecture (sim thread @ 10Hz, render thread reads
// snapshots). The main thread only ever sees state via posted snapshots and
// only ever mutates it by posting actions here.
declare var self: Worker;

import { createInitialState, reducer, type ShipAction, type ShipState } from "./shipSim.ts";

const TICK_HZ = 10;
const TICK_MS = 1000 / TICK_HZ;

let state: ShipState = createInitialState();

function postSnapshot(): void {
    postMessage(state);
}

self.onmessage = (event: MessageEvent<ShipAction>): void => {
    state = reducer(state, event.data);
};

postSnapshot(); // let the client render the initial state without waiting a full tick

setInterval(() => {
    state = reducer(state, {type: "tick", dt: TICK_MS / 1000});
    postSnapshot();
}, TICK_MS);
