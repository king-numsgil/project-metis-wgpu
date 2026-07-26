// Coverage for zero-copy buffer mapping: `getMappedRange` returns an
// ArrayBuffer that ALIASES the mapped memory, and `unmap()`/`destroy()` DETACH
// it so JS can never read freed GPU memory.
//
// Two properties carry the weight here and neither is obvious:
//
//   * **Use-after-unmap is silent, not loud.** A detached ArrayBuffer reads as
//     zero-length and writes through a stale view are dropped on the floor —
//     no throw. So a "write it after unmap" bug loses data quietly; these tests
//     pin the detach so that can't regress into a use-after-free instead.
//   * **A write->read roundtrip cannot use one buffer.** The WebGPU spec allows
//     MAP_READ only with COPY_DST, and MAP_WRITE only with COPY_SRC, so no
//     buffer can be both. A real roundtrip goes through the GPU: write a
//     MAP_WRITE/mappedAtCreation buffer, copy it into a MAP_READ buffer, map
//     that. The last test in this file pins the usage rule itself.
import { beforeAll, describe, expect, it } from "bun:test";
import {
    type GpuAdapter,
    GPUBufferUsage,
    type GpuDevice,
    GPUMapMode,
    requestAdapter,
} from "../index.js";

let adapter: GpuAdapter | null = null;
let device: GpuDevice | null = null;

beforeAll(async () => {
    adapter = await requestAdapter();
    if (adapter) {
        device = await adapter.requestDevice({ label: "buffer-mapping-tests" });
    }
});

/** Copy `src` into a fresh MAP_READ buffer and read it back as bytes. */
async function readBackViaGpu(dev: GpuDevice, src: GpuBufferLike, size: number): Promise<Uint8Array> {
    const dst = dev.createBuffer({
        size,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const enc = dev.createCommandEncoder();
    enc.copyBufferToBuffer(src as never, 0, dst, 0, size);
    dev.queue.submit([enc.finish()]);
    await dev.queue.onSubmittedWorkDone();
    await dst.mapAsync(GPUMapMode.READ);
    // Copy OUT before unmap detaches the range.
    const out = new Uint8Array(dst.getMappedRange().slice(0));
    dst.unmap();
    dst.destroy();
    return out;
}
type GpuBufferLike = ReturnType<GpuDevice["createBuffer"]>;

// ── Roundtrips: write through a mapped range, read it back off the GPU ────────

describe("write -> read roundtrips", () => {
    it("mappedAtCreation: bytes written into the range survive unmap and reach the GPU", async () => {
        if (!device) return;
        const size = 64;
        const src = device.createBuffer({
            size,
            usage: GPUBufferUsage.COPY_SRC,
            mappedAtCreation: true,
        });
        const expected = new Uint8Array(size);
        for (let i = 0; i < size; i++) expected[i] = (i * 7) & 0xff;
        new Uint8Array(src.getMappedRange()).set(expected);
        src.unmap(); // flushes the write

        const got = await readBackViaGpu(device, src, size);
        expect(Array.from(got)).toEqual(Array.from(expected));
        src.destroy();
    });

    it("mapAsync(WRITE): the same roundtrip through an explicitly write-mapped buffer", async () => {
        if (!device) return;
        const size = 32;
        const src = device.createBuffer({
            size,
            usage: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC,
        });
        await src.mapAsync(GPUMapMode.WRITE);
        const expected = new Uint8Array(size).fill(0xab);
        new Uint8Array(src.getMappedRange()).set(expected);
        src.unmap();

        const got = await readBackViaGpu(device, src, size);
        expect(Array.from(got)).toEqual(Array.from(expected));
        src.destroy();
    });

    it("float data roundtrips bit-exactly (bytes reinterpreted, not converted)", async () => {
        if (!device) return;
        const values = new Float32Array([1.5, -2.25, 3.75e12, 0.1]);
        const size = values.byteLength;
        const src = device.createBuffer({
            size,
            usage: GPUBufferUsage.COPY_SRC,
            mappedAtCreation: true,
        });
        new Float32Array(src.getMappedRange()).set(values);
        src.unmap();

        const bytes = await readBackViaGpu(device, src, size);
        // Reinterpret through the buffer — `new Float32Array(bytes)` would
        // convert each byte to a float instead.
        const got = new Float32Array(bytes.buffer, bytes.byteOffset, values.length);
        expect(Array.from(got)).toEqual(Array.from(values));
        src.destroy();
    });

    it("a partial range (offset + size) writes only that window", async () => {
        if (!device) return;
        const size = 64;
        const src = device.createBuffer({
            size,
            usage: GPUBufferUsage.COPY_SRC,
            mappedAtCreation: true,
        });
        // Zero it, then write 0xFF into bytes 16..32 via an offset range.
        new Uint8Array(src.getMappedRange()).fill(0);
        const window = src.getMappedRange(16, 16);
        expect(window.byteLength).toBe(16);
        new Uint8Array(window).fill(0xff);
        src.unmap();

        const got = await readBackViaGpu(device, src, size);
        expect(got[15]).toBe(0);
        expect(got[16]).toBe(0xff);
        expect(got[31]).toBe(0xff);
        expect(got[32]).toBe(0);
        src.destroy();
    });
});

// ── Use-after-unmap: the detach contract ─────────────────────────────────────

describe("use after unmap", () => {
    it("unmap detaches the range AND any view already taken over it", () => {
        if (!device) return;
        const buf = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_SRC, mappedAtCreation: true });
        const range = buf.getMappedRange();
        const view = new Uint8Array(range); // taken BEFORE unmap
        view.set([1, 2, 3, 4]);
        expect(view.length).toBe(16);

        buf.unmap();

        // Both the ArrayBuffer and the pre-existing view go empty.
        expect(range.byteLength).toBe(0);
        expect(view.length).toBe(0);
        buf.destroy();
    });

    it("reads through a detached view yield undefined and writes are silently dropped (no throw)", () => {
        if (!device) return;
        const buf = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_SRC, mappedAtCreation: true });
        const view = new Uint8Array(buf.getMappedRange());
        buf.unmap();

        // This is the important, non-obvious half: JS does NOT throw here. The
        // detach is what makes it safe — without it these would touch freed GPU
        // memory instead of doing nothing.
        expect(() => {
            view[0] = 99;
        }).not.toThrow();
        expect(view[0]).toBeUndefined();
        buf.destroy();
    });

    it("getMappedRange() after unmap throws", () => {
        if (!device) return;
        const buf = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_SRC, mappedAtCreation: true });
        buf.getMappedRange();
        buf.unmap();
        expect(() => buf.getMappedRange()).toThrow(/not mapped/i);
        buf.destroy();
    });

    it("getMappedRange() before any mapping throws", () => {
        if (!device) return;
        const buf = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
        expect(() => buf.getMappedRange()).toThrow(/not mapped/i);
        buf.destroy();
    });

    it("destroy() detaches an outstanding range too", () => {
        if (!device) return;
        const buf = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_SRC, mappedAtCreation: true });
        const range = buf.getMappedRange();
        expect(range.byteLength).toBe(16);
        buf.destroy();
        expect(range.byteLength).toBe(0);
    });

    it("every non-overlapping range handed out is detached by one unmap", () => {
        if (!device) return;
        const buf = device.createBuffer({ size: 64, usage: GPUBufferUsage.COPY_SRC, mappedAtCreation: true });
        const a = buf.getMappedRange(0, 16);
        const b = buf.getMappedRange(16, 16);
        const c = buf.getMappedRange(32, 32);
        expect([a.byteLength, b.byteLength, c.byteLength]).toEqual([16, 16, 32]);
        buf.unmap();
        expect([a.byteLength, b.byteLength, c.byteLength]).toEqual([0, 0, 0]);
        buf.destroy();
    });

    it("a remap gives a live range while the previous one stays detached", async () => {
        if (!device) return;
        const buf = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC });
        await buf.mapAsync(GPUMapMode.WRITE);
        const first = buf.getMappedRange();
        buf.unmap();
        expect(first.byteLength).toBe(0);

        await buf.mapAsync(GPUMapMode.WRITE);
        const second = buf.getMappedRange();
        expect(second.byteLength).toBe(16);
        expect(first.byteLength).toBe(0); // still dead
        new Uint8Array(second).fill(5); // usable
        buf.unmap();
        buf.destroy();
    });
});

// ── mapState, including the transient "pending" ──────────────────────────────

describe("mapState", () => {
    it("goes unmapped -> pending (synchronously) -> mapped -> unmapped", async () => {
        if (!device) return;
        const buf = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
        expect(buf.mapState).toBe("unmapped");

        const pending = buf.mapAsync(GPUMapMode.READ);
        // The spec requires this to be observable before the promise settles.
        expect(buf.mapState).toBe("pending");

        await pending;
        expect(buf.mapState).toBe("mapped");

        buf.unmap();
        expect(buf.mapState).toBe("unmapped");
        buf.destroy();
    });

    it("mappedAtCreation reports 'mapped' immediately", () => {
        if (!device) return;
        const buf = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_SRC, mappedAtCreation: true });
        expect(buf.mapState).toBe("mapped");
        buf.unmap();
        buf.destroy();
    });

    it("mapping an already-pending buffer rejects", async () => {
        if (!device) return;
        const buf = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
        const first = buf.mapAsync(GPUMapMode.READ);
        expect(() => buf.mapAsync(GPUMapMode.READ)).toThrow(/already mapped|pending/i);
        await first;
        buf.unmap();
        buf.destroy();
    });
});

// ── The spec rule that shapes all of the above ───────────────────────────────

describe("buffer usage rules", () => {
    it("MAP_READ | MAP_WRITE is rejected, so one buffer can never be both", async () => {
        if (!device) return;
        // Per the spec, MAP_READ may only pair with COPY_DST and MAP_WRITE only
        // with COPY_SRC. This is *why* the roundtrip tests above have to copy
        // through the GPU rather than writing and reading one mapped buffer.
        device.pushErrorScope("validation");
        const bad = device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.MAP_WRITE,
        });
        const err = await device.popErrorScope();
        expect(err).not.toBeNull();
        bad.destroy();
    });
});
