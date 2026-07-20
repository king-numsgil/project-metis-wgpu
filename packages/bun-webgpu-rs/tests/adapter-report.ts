// Which adapters exist, which one gets picked, and can each actually run this
// engine? Run this when performance is inexplicable or `requestDevice` fails.
//
//   bun run tests/adapter-report.ts
import { enumerateAdapters, requestAdapter } from "../index.js";

// The limits this engine actually needs. Everything else it uses sits far below
// the WebGPU defaults, so a failure on one of these is the real blocker.
const NEEDED: Array<[string, number, string]> = [
    ["maxComputeWorkgroupsPerDimension", 65535, "cluster-build / light-cull dispatch"],
    ["maxComputeInvocationsPerWorkgroup", 256, "COMPUTE_WORKGROUP_SIZE = 64"],
    ["maxStorageBufferBindingSize", 134217728, "cluster light-index buffer"],
    ["maxTextureDimension2D", 8192, "shadow atlas at SHADOW_MAP_SIZE"],
];

const all = enumerateAdapters();
console.log(`${all.length} adapter(s) visible:\n`);

for (const [i, a] of all.entries()) {
    const info = a.info;
    const L = a.limits as unknown as Record<string, number>;
    const soft = info.deviceType === "Cpu";
    console.log(`  [${i}] ${info.description || "?"}`);
    console.log(`      backend ${info.backendType}   type ${info.deviceType}${soft ? "   <-- SOFTWARE RASTERIZER" : ""}`);

    const bad = NEEDED.filter(([k, need]) => (L[k] ?? 0) < need);
    if (bad.length === 0) {
        console.log(`      limits: OK for this engine`);
    } else {
        console.log(`      limits: CANNOT RUN THIS ENGINE —`);
        for (const [k, need, why] of bad) {
            console.log(`        ${k}: need ${need}, offers ${L[k] ?? 0}   (${why})`);
        }
    }
    console.log("");
}

// What the engine's own call would select.
for (const pref of ["high-performance", "low-power"] as const) {
    const picked = await requestAdapter({powerPreference: pref});
    console.log(
        `  powerPreference "${pref}" selects: ` +
            (picked ? `${picked.info.description || "?"} (${picked.info.deviceType})` : "nothing"),
    );
}

console.log(
    "\n  Note: a `deviceType` of DiscreteGpu says nothing about driver quality.\n" +
        "  Check the Vulkan driverID too (`vulkaninfo --summary`): a translation layer\n" +
        "  such as Mesa Dozen reports as a discrete GPU while being a D3D12 shim with\n" +
        "  conformanceVersion 0.0.0.0.",
);
process.exit(0);
