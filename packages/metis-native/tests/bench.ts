/**
 * Bun benchmarks for metis-native.
 * Run with: bun run tests/bench.ts
 */
import {
    type GpuBuffer,
    GPUBufferUsage,
    type GpuComputePipeline,
    type GpuDevice,
    GPUMapMode,
    requestAdapter,
} from "../index.js";

const COMPUTE_SHADER = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> buf: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  buf[gid.x] = f32(gid.x) * 2.0;
}
`;

async function setup(): Promise<{
    device: GpuDevice;
    pipeline: GpuComputePipeline;
    storageBuffer: GpuBuffer;
    readBuffer: GpuBuffer
}> {
    const adapter = await requestAdapter();
    if (!adapter) {
        throw new Error("No GPU adapter found");
    }
    const device = await adapter.requestDevice({label: "bench-device"});

    const module = device.createShaderModule({code: COMPUTE_SHADER});
    const pipeline = device.createComputePipeline({
        layout: "auto",
        compute: {module, entryPoint: "main"},
    });

    const N = 1024;
    const storageBuffer = device.createBuffer({
        size: N * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const readBuffer = device.createBuffer({
        size: N * 4,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    return {device, pipeline, storageBuffer, readBuffer};
}

// ── Benchmarks ────────────────────────────────────────────────────────────────

const ITERATIONS = 1000;
const WARMUP = 100;

async function benchCommandEncoding(device: GpuDevice, pipeline: GpuComputePipeline, storageBuffer: GpuBuffer) {
    const bgl = pipeline.getBindGroupLayout(0);
    const bindGroup = device.createBindGroup({
        layout: bgl,
        entries: [{binding: 0, buffer: {buffer: storageBuffer}}],
    });

    // Warmup
    for (let i = 0; i < WARMUP; i++) {
        const enc = device.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(1);
        pass.end();
        enc.finish();
    }

    const start = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
        const enc = device.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(1);
        pass.end();
        enc.finish();
    }
    const elapsed = performance.now() - start;

    console.log(`[bench] command encoding (${ITERATIONS} iters): ${elapsed.toFixed(2)}ms total, ${(elapsed / ITERATIONS).toFixed(3)}ms/iter`);
}

async function benchBufferWrite(device: GpuDevice) {
    const buf = device.createBuffer({
        size: 65536,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    const data = new Uint8Array(65536).fill(1);

    // Warmup
    for (let i = 0; i < WARMUP; i++) {
        device.queue.writeBuffer(buf, 0, data);
    }

    const start = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
        device.queue.writeBuffer(buf, 0, data);
    }
    const elapsed = performance.now() - start;

    console.log(`[bench] queue.writeBuffer 64KB (${ITERATIONS} iters): ${elapsed.toFixed(2)}ms total, ${(elapsed / ITERATIONS).toFixed(3)}ms/iter`);
    buf.destroy();
}

async function benchBufferCreation(device: GpuDevice) {
    // Warmup
    for (let i = 0; i < WARMUP; i++) {
        const b = device.createBuffer({size: 1024, usage: GPUBufferUsage.STORAGE});
        b.destroy();
    }

    const start = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
        const b = device.createBuffer({size: 1024, usage: GPUBufferUsage.STORAGE});
        b.destroy();
    }
    const elapsed = performance.now() - start;

    console.log(`[bench] createBuffer+destroy (${ITERATIONS} iters): ${elapsed.toFixed(2)}ms total, ${(elapsed / ITERATIONS).toFixed(3)}ms/iter`);
}

async function benchGpuRoundtrip(device: GpuDevice, pipeline: GpuComputePipeline, storageBuffer: GpuBuffer, readBuffer: GpuBuffer) {
    const N = 1024;
    const bgl = pipeline.getBindGroupLayout(0);
    const bindGroup = device.createBindGroup({
        layout: bgl,
        entries: [{binding: 0, buffer: {buffer: storageBuffer}}],
    });

    const ITERS = 20;
    // Warmup
    for (let i = 0; i < 3; i++) {
        const enc = device.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(Math.ceil(N / 64));
        pass.end();
        enc.copyBufferToBuffer(storageBuffer, 0, readBuffer, 0, N * 4);
        device.queue.submit([enc.finish()]);
        await readBuffer.mapAsync(GPUMapMode.READ);
        readBuffer.getMappedRange();
        readBuffer.unmap();
    }

    const start = performance.now();
    for (let i = 0; i < ITERS; i++) {
        const enc = device.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(Math.ceil(N / 64));
        pass.end();
        enc.copyBufferToBuffer(storageBuffer, 0, readBuffer, 0, N * 4);
        device.queue.submit([enc.finish()]);
        await readBuffer.mapAsync(GPUMapMode.READ);
        readBuffer.getMappedRange();
        readBuffer.unmap();
    }
    const elapsed = performance.now() - start;

    console.log(`[bench] GPU compute+readback ${N} floats (${ITERS} iters): ${elapsed.toFixed(2)}ms total, ${(elapsed / ITERS).toFixed(2)}ms/iter`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const {device, pipeline, storageBuffer, readBuffer} = await setup();
console.log("GPU device ready. Running benchmarks...\n");

await benchCommandEncoding(device, pipeline, storageBuffer);
await benchBufferWrite(device);
await benchBufferCreation(device);
await benchGpuRoundtrip(device, pipeline, storageBuffer, readBuffer);

storageBuffer.destroy();
readBuffer.destroy();
device.destroy()
