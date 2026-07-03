import type { ReactNode } from "react";

function NoPower(): ReactNode {
    return <box alignItems="center" justifyContent="center" flexGrow={1}>
        <text fg="#333333">NO POWER</text>
    </box>;
}

export {NoPower};
