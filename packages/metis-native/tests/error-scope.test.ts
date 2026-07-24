// Coverage for `pushErrorScope` / `popErrorScope`.
//
// These exist as a pair of independent JS calls, but wgpu 30 made error scopes
// **guard-based**: `push_error_scope` hands back an `ErrorScopeGuard` that is
// `!Send`, `!Sync`, and pushed onto a stack that is thread-local *inside wgpu*.
// A guard therefore cannot be parked on `GpuDevice` (napi requires `Send`), and
// is parked in a thread-local in `device.rs` instead.
//
// That plumbing has a failure mode worth pinning: an implementation that lost
// the guard, or popped the wrong one, would still return `null` from every
// `popErrorScope()` — and every *existing* test that uses an error scope asserts
// exactly that, because they use it to prove an operation raised no error. So
// the suite would stay green with error capture completely broken.
//
// The first test below is the one that catches it: it provokes a validation
// error on purpose and requires it to come back. The nesting test covers the
// other half — that a device's guards pop LIFO rather than in call order.
import { expect, test } from "bun:test";
import { requestAdapter } from "../index.js";

const adapter = await requestAdapter();
const device = await adapter!.requestDevice({});

test("a scope captures a validation error raised inside it", async () => {
    device.pushErrorScope("validation");
    device.createShaderModule({ code: "definitely not wgsl" });
    const err = await device.popErrorScope();
    expect(err).not.toBeNull();
    expect(err!.type).toBe("validation");
    expect(err!.message).toContain("parsing error");
});

test("a scope resolves null when nothing goes wrong", async () => {
    device.pushErrorScope("validation");
    device.createShaderModule({ code: "@compute @workgroup_size(1) fn m() {}" });
    expect(await device.popErrorScope()).toBeNull();
});

test("nested scopes pop LIFO — the innermost one captures", async () => {
    device.pushErrorScope("validation"); // outer
    device.pushErrorScope("validation"); // inner
    device.createShaderModule({ code: "bad inner" });

    const inner = await device.popErrorScope();
    const outer = await device.popErrorScope();

    expect(inner).not.toBeNull(); // inner was innermost, so it caught it
    expect(outer).toBeNull(); // and the error did not also escape to outer
});

// The spec has `popErrorScope()` *reject* on an empty stack. It must not throw
// synchronously out of the call — a synchronous throw is not something a
// `.catch()` on the returned promise can ever see.
test("popping with no open scope rejects rather than throwing", async () => {
    await expect(device.popErrorScope()).rejects.toThrow(/no matching pushErrorScope/);
});
