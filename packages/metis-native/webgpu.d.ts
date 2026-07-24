// Types for the WebGPU compatibility layer (webgpu.js) — the package's public
// entry. Re-exports the generated binding and adds the spec ergonomics that are
// layered on in JS. Import from "./index.js" for the un-augmented surface.

export * from "./index.js";

import type { GPUFeatureName, GPUNativeFeatureName } from "./index.js";

/**
 * Base class for errors surfaced by `device.popErrorScope()` and the
 * `uncapturederror` event. Subclassed so `err instanceof GPUValidationError`
 * works. Carries `.message`; `.type` is a non-spec convenience kept for
 * compatibility (spec code should branch on `instanceof`).
 */
export declare class GPUError extends Error {
  readonly type: "validation" | "out-of-memory" | "internal";
}
export declare class GPUValidationError extends GPUError {}
export declare class GPUOutOfMemoryError extends GPUError {}
export declare class GPUInternalError extends GPUError {}

/** Event delivered to `uncapturederror` listeners. */
export interface GPUUncapturedErrorEvent {
  readonly type: "uncapturederror";
  readonly error: GPUError;
}

declare module "./index.js" {
  interface GpuSupportedFeatures {
    /** Iterate the feature names — `for (const f of device.features)`. */
    [Symbol.iterator](): IterableIterator<GPUFeatureName | GPUNativeFeatureName>;
  }
  interface GpuDevice {
    /** Register an `uncapturederror` listener (in addition to `onuncapturederror`). */
    addEventListener(
      type: "uncapturederror",
      listener: (event: GPUUncapturedErrorEvent) => void,
    ): void;
    removeEventListener(
      type: "uncapturederror",
      listener: (event: GPUUncapturedErrorEvent) => void,
    ): void;
  }
}
