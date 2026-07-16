// Timestamp queries end-to-end: pass-level `timestampWrites` (spec) and the
// native `writeTimestamp` entry points, resolved into a buffer and read back.
//
// Every test degrades to a skip rather than a failure when the adapter lacks
// the feature — `timestamp-query` is optional in the spec, and the two
// `*-inside-*` features are native wgpu extensions with genuinely patchy
// backend support.
import { beforeAll, describe, expect, it } from "bun:test";
import {
    type GpuAdapter,
    GPUBufferUsage,
    type GpuDevice,
    GPUMapMode,
    type GpuQuerySet,
    requestAdapter,
} from "../index.js";

let adapter: GpuAdapter | null = null;
let device: GpuDevice | null = null;
let hasTimestamp = false;
let hasInsideEncoders = false;
let hasInsidePasses = false;

beforeAll(async () => {
    adapter = await requestAdapter();
    if (!adapter) {
        return;
    }
    hasTimestamp = adapter.features.has("timestamp-query");
    hasInsideEncoders = adapter.features.has("timestamp-query-inside-encoders");
    hasInsidePasses = adapter.features.has("timestamp-query-inside-passes");

    const required: Array<"timestamp-query" | "timestamp-query-inside-encoders" | "timestamp-query-inside-passes"> = [];
    if (hasTimestamp) {
        required.push("timestamp-query");
    }
    if (hasInsideEncoders) {
        required.push("timestamp-query-inside-encoders");
    }
    if (hasInsidePasses) {
        required.push("timestamp-query-inside-passes");
    }
    device = await adapter.requestDevice({label: "timestamp-test-device", requiredFeatures: required});
});

/** Resolves `count` queries and maps them back as raw u64 ticks. */
async function readQueries(dev: GpuDevice, querySet: GpuQuerySet, count: number): Promise<BigUint64Array> {
    const byteSize = count * 8;
    const resolve = dev.createBuffer({
        label: "ts-resolve",
        size: byteSize,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    const readback = dev.createBuffer({
        label: "ts-readback",
        size: byteSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const encoder = dev.createCommandEncoder();
    encoder.resolveQuerySet(querySet, 0, count, resolve, 0);
    encoder.copyBufferToBuffer(resolve, 0, readback, 0, byteSize);
    dev.queue.submit([encoder.finish()]);
    await dev.queue.onSubmittedWorkDone();

    await readback.mapAsync(GPUMapMode.READ);
    // getMappedRange hands back the raw bytes; reinterpret them as u64 via the
    // underlying ArrayBuffer. `new BigUint64Array(bytes)` would convert *values*.
    const bytes = readback.getMappedRange();
    const ticks = new BigUint64Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + byteSize));
    readback.unmap();
    resolve.destroy();
    readback.destroy();
    return ticks;
}

describe("timestamp query features", () => {
    it("reports timestamp features as typed names", () => {
        if (!adapter) {
            return;
        }
        const names = adapter.features.keys();
        expect(Array.isArray(names)).toBe(true);
        // Whatever is present must round-trip through the shared name table.
        for (const n of names) {
            expect(adapter.features.has(n)).toBe(true);
        }
    });

    it("rejects an unknown feature name instead of silently dropping it", async () => {
        if (!adapter) {
            return;
        }
        await expect(
            adapter.requestDevice({
                // Deliberately bogus — the spec has requestDevice reject rather
                // than hand back a device quietly missing the feature.
                requiredFeatures: ["not-a-real-feature" as "timestamp-query"],
            }),
        ).rejects.toThrow(/GPUFeatureName/);
    });
});

describe("queue.getTimestampPeriod", () => {
    it("returns a positive ns-per-tick multiplier", () => {
        if (!device) {
            return;
        }
        const period = device.queue.getTimestampPeriod();
        expect(typeof period).toBe("number");
        expect(period).toBeGreaterThan(0);
        expect(Number.isFinite(period)).toBe(true);
    });
});

describe("pass timestampWrites (spec)", () => {
    it("brackets a compute pass with a monotonically increasing pair", async () => {
        if (!device || !hasTimestamp) {
            return;
        }
        const dev = device;
        const querySet = dev.createQuerySet({label: "ts-pass", type: "timestamp", count: 2});
        expect(querySet.type).toBe("timestamp");
        expect(querySet.count).toBe(2);

        const encoder = dev.createCommandEncoder();
        const pass = encoder.beginComputePass({
            timestampWrites: {querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1},
        });
        pass.end();
        dev.queue.submit([encoder.finish()]);
        await dev.queue.onSubmittedWorkDone();

        const ticks = await readQueries(dev, querySet, 2);
        expect(ticks.length).toBe(2);
        expect(ticks[1]! >= ticks[0]!).toBe(true);

        // The delta must land in a sane wall-clock range once scaled by the
        // period — this is what catches a wrong-units or wrong-endianness bug,
        // which a bare "second >= first" assertion would sail past.
        const deltaMs = (Number(ticks[1]! - ticks[0]!) * dev.queue.getTimestampPeriod()) / 1e6;
        expect(deltaMs).toBeGreaterThanOrEqual(0);
        expect(deltaMs).toBeLessThan(1000);
        querySet.destroy();
    });
});

describe("encoder.writeTimestamp (native: timestamp-query-inside-encoders)", () => {
    it("records timestamps between passes", async () => {
        if (!device || !hasTimestamp || !hasInsideEncoders) {
            return;
        }
        const dev = device;
        const querySet = dev.createQuerySet({label: "ts-encoder", type: "timestamp", count: 2});

        const encoder = dev.createCommandEncoder();
        encoder.writeTimestamp(querySet, 0);
        encoder.beginComputePass({}).end();
        encoder.writeTimestamp(querySet, 1);
        dev.queue.submit([encoder.finish()]);
        await dev.queue.onSubmittedWorkDone();

        const ticks = await readQueries(dev, querySet, 2);
        expect(ticks[1]! >= ticks[0]!).toBe(true);
        querySet.destroy();
    });
});

describe("pass.writeTimestamp (native: timestamp-query-inside-passes)", () => {
    it("records timestamps inside a compute pass", async () => {
        if (!device || !hasTimestamp || !hasInsidePasses) {
            return;
        }
        const dev = device;
        const querySet = dev.createQuerySet({label: "ts-inside", type: "timestamp", count: 2});

        const encoder = dev.createCommandEncoder();
        const pass = encoder.beginComputePass({});
        pass.writeTimestamp(querySet, 0);
        pass.writeTimestamp(querySet, 1);
        pass.end();
        dev.queue.submit([encoder.finish()]);
        await dev.queue.onSubmittedWorkDone();

        const ticks = await readQueries(dev, querySet, 2);
        expect(ticks[1]! >= ticks[0]!).toBe(true);
        querySet.destroy();
    });
});
