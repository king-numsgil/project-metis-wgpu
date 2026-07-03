import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createInitialState, type ShipAction, type ShipState } from "./shipSim.ts";

interface ShipContextValue {
    readonly state: ShipState;
    readonly dispatch: (action: ShipAction) => void;
}

const ShipContext = createContext<ShipContextValue | null>(null);

function ShipProvider({children}: { children: ReactNode }): ReactNode {
    const [state, setState] = useState<ShipState>(createInitialState);
    const workerRef = useRef<Worker | null>(null);

    useEffect(() => {
        const worker = new Worker(new URL("./shipWorker.ts", import.meta.url).href);
        // Sim tick loop is the worker's own business — don't let it keep this
        // process alive once everything else (the renderer, stdin) has shut down.
        worker.unref();
        worker.onmessage = (event: MessageEvent<ShipState>) => setState(event.data);
        workerRef.current = worker;

        return () => {
            worker.terminate();
            workerRef.current = null;
        };
    }, []);

    const dispatch = (action: ShipAction): void => {
        workerRef.current?.postMessage(action);
    };

    return <ShipContext.Provider value={{state, dispatch}}>{children}</ShipContext.Provider>;
}

function useShip(): ShipContextValue {
    const ctx = useContext(ShipContext);
    if (!ctx) {
        throw new Error("useShip must be used within a ShipProvider");
    }
    return ctx;
}

export {ShipProvider, useShip};
export {
    AUX_CAPACITY_PJ,
    AUX_RECHARGE_SKIM,
    AUX_SYSTEM_DRAW_W,
    IGNITION_DRAW_W,
    NEON_RESERVE_INITIAL_KG,
    PRIMARY_BUS_MIN_CHARGE,
    PUMP_DRAW_W,
    PUMP_PRIME_DRAW_W,
    REACTOR_START_INTERLOCK_FLOW,
} from "./shipSim.ts";
export type {AuxSystems, ReactorState, ShipState} from "./shipSim.ts";
