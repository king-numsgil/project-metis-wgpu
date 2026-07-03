function formatPJPerSecond(watts: number): string {
    const pjPerSec = watts / 1e15;
    if (pjPerSec === 0) return "0 PJ/s";
    if (pjPerSec >= 0.01) return `${pjPerSec.toFixed(3)} PJ/s`;
    return `${pjPerSec.toExponential(2)} PJ/s`;
}

function formatTW(watts: number): string {
    return `${(watts / 1e12).toFixed(1)} TW`;
}

function formatKelvin(kelvin: number): string {
    return `${Math.round(kelvin).toLocaleString()} K`;
}

function formatFluxWm2(wattsPerM2: number): string {
    if (wattsPerM2 >= 1e6) return `${(wattsPerM2 / 1e6).toFixed(2)} MW/m²`;
    if (wattsPerM2 >= 1e3) return `${(wattsPerM2 / 1e3).toFixed(1)} kW/m²`;
    return `${wattsPerM2.toFixed(1)} W/m²`;
}

function formatFlowKgS(kgS: number): string {
    return `${Math.round(kgS).toLocaleString()} kg/s`;
}

export {formatFlowKgS, formatFluxWm2, formatKelvin, formatPJPerSecond, formatTW};
