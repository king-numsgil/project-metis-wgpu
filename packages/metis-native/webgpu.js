// Hand-written WebGPU-spec compatibility layer over the napi-generated binding.
//
// napi can express most of the WebGPU surface directly (see index.js), but a
// few spec ergonomics have no napi representation and are added here in pure JS:
//
//   1. `GPUValidationError` / `GPUOutOfMemoryError` / `GPUInternalError` — real
//      classes, so `err instanceof GPUValidationError` works. `popErrorScope()`
//      and the uncaptured-error event resolve/deliver these instead of a plain
//      `{ type, message }` object. (The `.type` field is retained as a
//      non-spec convenience, so existing code keeps working.)
//   2. `device.addEventListener('uncapturederror', ...)` + a readable
//      `device.onuncapturederror`, over the binding's single write-only setter.
//   3. `GpuSupportedFeatures` iteration (`for (const f of device.features)`).
//   4. A stable, memoized `device.lost` promise (the binding mints a fresh one
//      per access).
//
// This module makes NO N-API calls — it only wraps the generated binding — and
// is the package's public entry (see package.json `main`). Import the raw
// binding from `./index.js` if you ever need the un-augmented surface.

const native = require("./index.js");

// ── 1. GPUError hierarchy ─────────────────────────────────────────────────────

class GPUError extends Error {
  constructor(type, message) {
    super(message);
    this.name = new.target.name;
    // Non-spec, kept for compatibility with `err.type` callers; spec code
    // should branch on `instanceof` instead.
    this.type = type;
  }
}
class GPUValidationError extends GPUError {
  constructor(message) { super("validation", message); }
}
class GPUOutOfMemoryError extends GPUError {
  constructor(message) { super("out-of-memory", message); }
}
class GPUInternalError extends GPUError {
  constructor(message) { super("internal", message); }
}

/** Map the binding's `{ type, message }` (or null) to a GPUError subclass. */
function toGpuError(e) {
  if (!e) return null;
  switch (e.type) {
    case "validation": return new GPUValidationError(e.message);
    case "out-of-memory": return new GPUOutOfMemoryError(e.message);
    default: return new GPUInternalError(e.message);
  }
}

const DeviceProto = native.GpuDevice && native.GpuDevice.prototype;

if (DeviceProto) {
  // popErrorScope() -> resolve a GPUError subclass instance (or null).
  const nativePop = DeviceProto.popErrorScope;
  DeviceProto.popErrorScope = function popErrorScope() {
    return nativePop.call(this).then(toGpuError);
  };

  // ── 2. uncapturederror: EventTarget-style + readable handler ────────────────
  const onUncaughtDesc = Object.getOwnPropertyDescriptor(DeviceProto, "onuncapturederror");
  const nativeSetOnUncaught = onUncaughtDesc && onUncaughtDesc.set;
  const state = new WeakMap(); // device -> { handler, listeners:Set }

  const stateFor = (device) => {
    let s = state.get(device);
    if (!s) {
      s = { handler: null, listeners: new Set() };
      state.set(device, s);
      // Register ONE native dispatcher that fans out to the handler + listeners,
      // wrapping the raw error into a GPUError subclass.
      if (nativeSetOnUncaught) {
        nativeSetOnUncaught.call(device, (ev) => {
          const event = { type: "uncapturederror", error: toGpuError(ev && ev.error) };
          if (s.handler) { try { s.handler(event); } catch { /* swallow */ } }
          for (const l of s.listeners) { try { l(event); } catch { /* swallow */ } }
        });
      }
    }
    return s;
  };

  Object.defineProperty(DeviceProto, "onuncapturederror", {
    configurable: true,
    get() { return stateFor(this).handler; },
    set(fn) { stateFor(this).handler = typeof fn === "function" ? fn : null; },
  });

  DeviceProto.addEventListener = function addEventListener(type, listener) {
    if (type === "uncapturederror" && typeof listener === "function") {
      stateFor(this).listeners.add(listener);
    }
  };
  DeviceProto.removeEventListener = function removeEventListener(type, listener) {
    if (type === "uncapturederror") {
      const s = state.get(this);
      if (s) s.listeners.delete(listener);
    }
  };

  // ── 4. Stable device.lost promise ───────────────────────────────────────────
  const lostDesc = Object.getOwnPropertyDescriptor(DeviceProto, "lost");
  if (lostDesc && lostDesc.get) {
    const nativeLostGet = lostDesc.get;
    const lostCache = new WeakMap();
    Object.defineProperty(DeviceProto, "lost", {
      configurable: true,
      get() {
        let p = lostCache.get(this);
        if (!p) { p = nativeLostGet.call(this); lostCache.set(this, p); }
        return p;
      },
    });
  }
}

// ── 3. GpuSupportedFeatures iteration ─────────────────────────────────────────

if (native.GpuSupportedFeatures && native.GpuSupportedFeatures.prototype) {
  native.GpuSupportedFeatures.prototype[Symbol.iterator] = function () {
    return this.keys()[Symbol.iterator]();
  };
}

// ── Re-export the full binding plus the added error classes ───────────────────

module.exports = Object.assign({}, native, {
  GPUError,
  GPUValidationError,
  GPUOutOfMemoryError,
  GPUInternalError,
});
