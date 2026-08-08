// WebGPU spec type aliases — prepended to index.d.ts by scripts/prepend-dts-header.mjs

export type GPUTextureFormat =
  | 'r8unorm' | 'r8snorm' | 'r8uint' | 'r8sint'
  | 'r16uint' | 'r16sint' | 'r16float'
  | 'rg8unorm' | 'rg8snorm' | 'rg8uint' | 'rg8sint'
  | 'r32uint' | 'r32sint' | 'r32float'
  | 'rg16uint' | 'rg16sint' | 'rg16float'
  | 'rgba8unorm' | 'rgba8unorm-srgb' | 'rgba8snorm' | 'rgba8uint' | 'rgba8sint'
  | 'bgra8unorm' | 'bgra8unorm-srgb'
  | 'rgb9e5ufloat' | 'rgb10a2uint' | 'rgb10a2unorm' | 'rg11b10ufloat'
  | 'rg32uint' | 'rg32sint' | 'rg32float'
  | 'rgba16uint' | 'rgba16sint' | 'rgba16float'
  | 'rgba32uint' | 'rgba32sint' | 'rgba32float'
  | 'stencil8' | 'depth16unorm' | 'depth24plus' | 'depth24plus-stencil8'
  | 'depth32float' | 'depth32float-stencil8'
  | 'bc1-rgba-unorm' | 'bc1-rgba-unorm-srgb'
  | 'bc2-rgba-unorm' | 'bc2-rgba-unorm-srgb'
  | 'bc3-rgba-unorm' | 'bc3-rgba-unorm-srgb'
  | 'bc4-r-unorm' | 'bc4-r-snorm'
  | 'bc5-rg-unorm' | 'bc5-rg-snorm'
  | 'bc6h-rgb-ufloat' | 'bc6h-rgb-float'
  | 'bc7-rgba-unorm' | 'bc7-rgba-unorm-srgb'
  | 'etc2-rgb8unorm' | 'etc2-rgb8unorm-srgb'
  | 'etc2-rgb8a1unorm' | 'etc2-rgb8a1unorm-srgb'
  | 'etc2-rgba8unorm' | 'etc2-rgba8unorm-srgb'
  | 'eac-r11unorm' | 'eac-r11snorm'
  | 'eac-rg11unorm' | 'eac-rg11snorm'
  | 'astc-4x4-unorm' | 'astc-4x4-unorm-srgb'
  | 'astc-5x4-unorm' | 'astc-5x4-unorm-srgb'
  | 'astc-5x5-unorm' | 'astc-5x5-unorm-srgb'
  | 'astc-6x5-unorm' | 'astc-6x5-unorm-srgb'
  | 'astc-6x6-unorm' | 'astc-6x6-unorm-srgb'
  | 'astc-8x5-unorm' | 'astc-8x5-unorm-srgb'
  | 'astc-8x6-unorm' | 'astc-8x6-unorm-srgb'
  | 'astc-8x8-unorm' | 'astc-8x8-unorm-srgb'
  | 'astc-10x5-unorm' | 'astc-10x5-unorm-srgb'
  | 'astc-10x6-unorm' | 'astc-10x6-unorm-srgb'
  | 'astc-10x8-unorm' | 'astc-10x8-unorm-srgb'
  | 'astc-10x10-unorm' | 'astc-10x10-unorm-srgb'
  | 'astc-12x10-unorm' | 'astc-12x10-unorm-srgb'
  | 'astc-12x12-unorm' | 'astc-12x12-unorm-srgb'

export type GPUVertexFormat =
  | 'uint8' | 'uint8x2' | 'uint8x4'
  | 'sint8' | 'sint8x2' | 'sint8x4'
  | 'unorm8' | 'unorm8x2' | 'unorm8x4'
  | 'snorm8' | 'snorm8x2' | 'snorm8x4'
  | 'uint16' | 'uint16x2' | 'uint16x4'
  | 'sint16' | 'sint16x2' | 'sint16x4'
  | 'unorm16' | 'unorm16x2' | 'unorm16x4'
  | 'snorm16' | 'snorm16x2' | 'snorm16x4'
  | 'float16' | 'float16x2' | 'float16x4'
  | 'float32' | 'float32x2' | 'float32x3' | 'float32x4'
  | 'uint32' | 'uint32x2' | 'uint32x3' | 'uint32x4'
  | 'sint32' | 'sint32x2' | 'sint32x3' | 'sint32x4'
  | 'unorm10-10-10-2' | 'unorm8x4-bgra'

export type GPUCompareFunction =
  | 'never' | 'less' | 'equal' | 'less-equal'
  | 'greater' | 'not-equal' | 'greater-equal' | 'always'

export type GPUStencilOperation =
  | 'keep' | 'zero' | 'replace' | 'invert'
  | 'increment-clamp' | 'decrement-clamp'
  | 'increment-wrap' | 'decrement-wrap'

export type GPUBlendOperation = 'add' | 'subtract' | 'reverse-subtract' | 'min' | 'max'

export type GPUBlendFactor =
  | 'zero' | 'one'
  | 'src' | 'one-minus-src'
  | 'src-alpha' | 'one-minus-src-alpha'
  | 'dst' | 'one-minus-dst'
  | 'dst-alpha' | 'one-minus-dst-alpha'
  | 'src-alpha-saturated'
  | 'constant' | 'one-minus-constant'
  | 'src1' | 'one-minus-src1'
  | 'src1-alpha' | 'one-minus-src1-alpha'

export type GPUTextureDimension = '1d' | '2d' | '3d'

export type GPUTextureViewDimension = '1d' | '2d' | '2d-array' | 'cube' | 'cube-array' | '3d'

export type GPUTextureAspect = 'all' | 'stencil-only' | 'depth-only'

export type GPUAddressMode = 'clamp-to-edge' | 'repeat' | 'mirror-repeat'

export type GPUFilterMode = 'nearest' | 'linear'

export type GPUMipmapFilterMode = 'nearest' | 'linear'

export type GPUPowerPreference = 'low-power' | 'high-performance'

export type GPUPrimitiveTopology =
  | 'point-list' | 'line-list' | 'line-strip'
  | 'triangle-list' | 'triangle-strip'

export type GPUIndexFormat = 'uint16' | 'uint32'

export type GPUFrontFace = 'ccw' | 'cw'

export type GPUCullMode = 'none' | 'front' | 'back'

export type GPUVertexStepMode = 'vertex' | 'instance'

export type GPUBufferBindingType = 'uniform' | 'storage' | 'read-only-storage'

export type GPUSamplerBindingType = 'filtering' | 'non-filtering' | 'comparison'

export type GPUTextureSampleType = 'float' | 'unfilterable-float' | 'depth' | 'sint' | 'uint'

export type GPUStorageTextureAccess = 'write-only' | 'read-only' | 'read-write'

export type GPULoadOp = 'load' | 'clear'

export type GPUStoreOp = 'store' | 'discard'

export type GPUQueryType = 'occlusion' | 'timestamp'

/**
 * The WebGPU spec's feature set — https://www.w3.org/TR/webgpu/#gpufeaturename
 * Anything here is portable to a browser implementation.
 */
export type GPUFeatureName =
  | 'depth-clip-control'
  | 'depth32float-stencil8'
  | 'texture-compression-bc'
  | 'texture-compression-bc-sliced-3d'
  | 'texture-compression-etc2'
  | 'texture-compression-astc'
  | 'timestamp-query'
  | 'indirect-first-instance'
  | 'shader-f16'
  | 'rg11b10ufloat-renderable'
  | 'bgra8unorm-storage'
  | 'float32-filterable'
  | 'dual-source-blending'
  | 'clip-distances'
  | 'immediates'

/**
 * wgpu extensions with **no WebGPU spec equivalent**. They're separated from
 * `GPUFeatureName` on purpose: code using one of these is native-only by
 * construction and cannot run in a browser.
 *
 * Unlike spec features, support is genuinely patchy across backends — always
 * `adapter.features.has(...)` before putting one in `requiredFeatures`, and
 * keep a path that works without it.
 *
 * - `timestamp-query-inside-encoders` — `encoder.writeTimestamp()`, for timing
 *   spans between passes.
 * - `timestamp-query-inside-passes` — `pass.writeTimestamp()`, for timing
 *   individual draws/dispatches inside one pass.
 *
 * Two names left this union in the wgpu 30 upgrade, and neither was replaced:
 * `multi-draw-indirect` is now unconditional (wgpu dropped the feature gate),
 * and `push-constants` became the spec feature `immediates` on
 * `GPUFeatureName`. Requesting either by its old name is a `TypeError`.
 */
export type GPUNativeFeatureName =
  | 'timestamp-query-inside-encoders'
  | 'timestamp-query-inside-passes'

export type GPUErrorFilter = 'validation' | 'out-of-memory' | 'internal'

export type GPUDeviceLostReason = 'unknown' | 'destroyed'

export type GPUPresentMode = 'fifo' | 'mailbox' | 'immediate' | 'auto-no-vsync' | 'auto-vsync'

export type GPUAlphaMode = 'premultiplied' | 'postmultiplied' | 'inherit'

/**
 * Colour space a surface's swapchain is interpreted in, passed to
 * `surface.configure({ colorSpace })`.
 *
 * `auto` keeps the platform default (sRGB, standard dynamic range) and is what
 * you get by omitting the field. The `extended-*` variants request an HDR
 * swapchain and are only valid for formats that advertise them — `configure()`
 * rejects an unsupported pairing rather than silently downgrading it.
 *
 * - `srgb` — BT.709 primaries, sRGB transfer function, SDR.
 * - `extended-srgb` — sRGB primaries with values outside [0,1] permitted (HDR).
 * - `extended-srgb-linear` — as above with a linear transfer function.
 *   Native-only; there is no browser equivalent.
 */
export type GPUSurfaceColorSpace =
  | 'auto'
  | 'srgb'
  | 'extended-srgb'
  | 'extended-srgb-linear'

export type GPUCompilationMessageType = 'error' | 'warning' | 'info'


/* auto-generated by NAPI-RS */
/* eslint-disable */
/**
 * A decoded sound in memory. Produced by `loadAudioClip`/`decodeAudioClip`, or
 * built directly from samples with `AudioClip.fromSamples`.
 */
export declare class AudioClip {
  /**
   * Build a clip from interleaved f32 samples.
   *
   * This is the procedural-audio entry point, and it is also what makes the
   * mixer testable without touching a file or a decoder: a test can
   * synthesise an exact waveform, play it, and compare the mixer's output
   * against the arithmetic it should have performed.
   */
  static fromSamples(samples: Float32Array, sampleRate: number, channels: number): AudioClip
  /** A clip of silence. Useful as a timing spacer and as a mixer test bed. */
  static silence(frames: number, sampleRate: number, channels: number): AudioClip
  get sampleRate(): number
  get channels(): number
  /**
   * Number of sample *frames* — not samples. A stereo clip of 1000 frames
   * holds 2000 samples.
   */
  get frameCount(): number
  /** Length in seconds. */
  get duration(): number
  /**
   * A copy of every sample, interleaved.
   *
   * This copies — the samples are shared with any playing voice, so handing
   * JS a view that aliases them would let a `Float32Array` write into memory
   * the audio thread is reading.
   */
  getSamples(): Float32Array
  /** A copy of one channel, de-interleaved. `channel` is zero-based. */
  getChannel(channel: number): Float32Array
  /**
   * Largest absolute sample value. `0` for silence, `1.0` for a full-scale
   * signal — above `1.0` means the clip will clip when it reaches a device.
   */
  get peak(): number
}

/**
 * A software mixer. Holds voices, renders frames, and optionally drives an
 * SDL audio device.
 */
export declare class AudioMixer {
  constructor(options?: AudioMixerOptions | undefined | null)
  /**
   * Start a clip. Returns a voice ID usable with `stop`/`setVoiceGain`/…
   *
   * The voice holds its own reference to the clip's samples, so the returned
   * ID stays valid — and the sound keeps playing correctly — even if JS drops
   * the `AudioClip` immediately after this call.
   */
  play(clip: AudioClip, options?: AudioPlayOptions | undefined | null): number
  /** Stop one voice. Returns `false` if it had already ended. */
  stop(voice: number): boolean
  stopAll(): void
  /**
   * Whether a voice is still playing. False for a voice that has finished,
   * been stopped, or never existed — IDs are never reused, so there is no
   * ambiguity between those.
   */
  isVoiceActive(voice: number): boolean
  setVoiceGain(voice: number, gain: number): boolean
  setVoicePan(voice: number, pan: number): boolean
  /** A voice's playhead, in seconds into its clip. */
  voiceTime(voice: number): number | null
  get activeVoices(): number
  get masterGain(): number
  set masterGain(gain: number)
  get sampleRate(): number
  get channels(): number
  /** Total frames this mixer has produced, however it was driven. */
  get framesRendered(): number
  /**
   * Render `frames` frames and return them interleaved.
   *
   * Refused while a device or capture stream is open, because the callback
   * is pulling from the same state on another thread — two consumers of one
   * playhead produce audio that belongs to neither.
   */
  renderFrames(frames: number): Float32Array
  /**
   * Open a playback device and start feeding it.
   *
   * Pass a device ID from `sdlGetAudioPlaybackDevices()`, or omit for the
   * system default. Requires `sdlInit(SdlInitFlag.Audio)`.
   *
   * The device starts **paused** — call `resume()`. That is deliberate: it
   * gives a caller a moment to queue starting voices, instead of having the
   * first callback fire against an empty mixer and emit a blip of silence at
   * a random offset.
   */
  openDevice(deviceId?: number | undefined | null): void
  /**
   * Open the production audio pipeline **without a device**, so frames can be
   * pulled with `capture()`.
   *
   * This is the offline-render and test path: same `SDL_AudioStream`, same
   * callback, same mixing code — only the device binding is missing. It is
   * also how you bounce a mix to a file on a machine with no audio hardware.
   */
  openCapture(): void
  /**
   * Pull rendered frames out of an open mixer.
   *
   * Requesting data is what *drives* the callback — SDL calls it to make up
   * whatever the stream is short by — so this exercises the real audio path
   * rather than a parallel one.
   */
  capture(frames: number): Float32Array
  /** Whether a device or capture stream is open. */
  get isOpen(): boolean
  /** The bound device ID, or `null` when opened with `openCapture()`. */
  get deviceId(): number | null
  /** Start (or restart) playback on the bound device. */
  resume(): void
  /** Stop pulling frames. Voices keep their playheads; `resume()` continues. */
  pause(): void
  /**
   * Close the device/capture stream. Voices and their playheads survive, so
   * the mixer can be reopened, or fall back to `renderFrames`.
   *
   * Safe to call twice, and called automatically when the mixer is
   * collected — but call it explicitly, for the reason `GpuSurface.destroy`
   * exists: teardown order against `sdlQuit()` is not something a GC gets to
   * choose.
   */
  close(): void
}

/**
 * A handle to a physical GPU (or a software fallback), as chosen by
 * `requestAdapter` / `requestAdapterForWindow` / `enumerateAdapters`.
 *
 * Inspect `features`, `limits` and `info` to decide what to ask for, then call
 * `requestDevice` to get the `GpuDevice` you actually render with. An adapter
 * is cheap and read-only; the device is the object that owns resources.
 */
export declare class GpuAdapter {
  /**
   * The optional features this adapter supports. Every name you list in
   * `requestDevice`'s `requiredFeatures` must appear here, or device
   * creation rejects — check with `adapter.features.has(name)` first.
   */
  get features(): GpuSupportedFeatures
  /**
   * The maximum resource limits this adapter can grant. Any value requested
   * in `requestDevice`'s `requiredLimits` must fall within these.
   */
  get limits(): GpuSupportedLimits
  /**
   * `true` if this is a CPU/software rasterizer rather than real hardware
   * (`info.deviceType === "cpu"`). Such adapters are conformant but slow —
   * worth surfacing when performance is inexplicably bad.
   */
  get isFallbackAdapter(): boolean
  /**
   * Vendor / device / backend identification for this adapter (name, driver
   * backend, device type, subgroup size range). Useful for logging which GPU
   * was selected and for telling a discrete GPU from an integrated one.
   */
  get info(): GpuAdapterInfo
  /**
   * Create a logical `GpuDevice` and its default queue from this adapter.
   *
   * Pass `requiredFeatures` / `requiredLimits` in the descriptor to opt into
   * capabilities beyond the guaranteed baseline. The returned promise
   * **rejects** if the adapter can't meet a requested limit (the message
   * names every offender and the adapter) or an unknown/unsupported feature
   * is requested — mirroring the spec, which fails device creation rather
   * than handing back a device silently missing what you asked for.
   */
  requestDevice(descriptor?: GpuDeviceDescriptor | undefined | null): Promise<GpuDevice>
}

/**
 * A concrete set of resources (buffers, samplers, texture views) bound to a
 * `GpuBindGroupLayout`, created by `device.createBindGroup`. Attach it to a
 * pass with `pass.setBindGroup(index, group)`.
 */
export declare class GpuBindGroup {
  /** Debug label (read-write). */
  get label(): string | null
  set label(label: string)
}

/**
 * The declared shape of a bind group — which binding slots exist, their
 * resource types and which shader stages see them. Created by
 * `device.createBindGroupLayout` (or obtained from a pipeline via
 * `getBindGroupLayout`), then referenced by both a pipeline layout and the
 * bind groups validated against it.
 */
export declare class GpuBindGroupLayout {
  /** Debug label (read-write). */
  get label(): string | null
  set label(label: string)
}

export declare class GpuBuffer {
  /** Size of the buffer in bytes (as requested at creation). */
  get size(): number
  /** The `GPUBufferUsage` bitmask this buffer was created with. */
  get usage(): number
  /** The debug label (read-write). */
  get label(): string | null
  set label(label: string)
  /**
   * Current map state — the spec's three values: `"unmapped"`, `"pending"`
   * (a `mapAsync` is in flight) or `"mapped"`.
   */
  get mapState(): 'unmapped' | 'pending' | 'mapped'
  /**
   * Map the buffer for CPU access and resolve once the mapping is ready.
   *
   * `mode` is a `GPUMapMode` bitmask (`READ` or `WRITE`); the buffer must
   * have the matching `MAP_READ` / `MAP_WRITE` usage. `offset`/`size` bound
   * the mapped region (defaults: whole buffer from 0). This drives the
   * device poll internally, so the returned promise settling means the range
   * is ready for `getMappedRange`. Call `unmap()` before using the buffer on
   * the GPU again.
   *
   * `mapState` becomes `"pending"` **synchronously**, before this returns,
   * and `"mapped"` (or back to `"unmapped"` on failure) when the promise
   * settles. Mapping an already-mapped or already-pending buffer rejects.
   */
  mapAsync(mode: number, offset?: number | undefined | null, size?: number | undefined | null): Promise<void>
  /**
   * Return an `ArrayBuffer` that **aliases** the mapped memory directly — no
   * copy — matching the WebGPU spec (offset multiple of 8, size multiple of
   * 4; defaults to the whole buffer). The buffer must be mapped (via
   * `mapAsync` or `mappedAtCreation`). Wrap it to read/write, e.g.
   * `new Float32Array(range)`.
   *
   * The range stays valid until `unmap()` / `destroy()`, which **detach** it
   * (its `byteLength` becomes 0 and further access throws) so JS can never
   * read freed GPU memory. Writes into a `MAP_WRITE` / `mappedAtCreation`
   * range are flushed to the GPU by `unmap()`.
   *
   * Non-overlapping ranges may be requested with multiple calls. (Note:
   * mapped memory can be write-combining on some backends, so reading back a
   * value you just wrote into a write-mapped range is not guaranteed fast or
   * coherent — write-mapped ranges are meant to be written, not read.)
   */
  getMappedRange(offset?: number | undefined | null, size?: number | undefined | null): ArrayBuffer
  /**
   * Unmap the buffer, making it usable by the GPU again. Detaches every
   * `ArrayBuffer` handed out by `getMappedRange` (they become zero-length),
   * and flushes writes made into a `MAP_WRITE` / `mappedAtCreation` range.
   */
  unmap(): void
  /**
   * Free the buffer's GPU memory now. Detaches any mapped `ArrayBuffer`
   * first. Subsequent use is a validation error; the handle becomes inert.
   */
  destroy(): void
}

/**
 * An opaque, recorded list of GPU commands produced by
 * `commandEncoder.finish()`. Hand it to `queue.submit([...])` to execute it.
 * A command buffer can only be submitted **once** — submitting again is an
 * error.
 */
export declare class GpuCommandBuffer {
  /** Debug label (read-write). */
  get label(): string | null
  set label(label: string)
}

/**
 * Records GPU commands into a command buffer. Created by
 * `device.createCommandEncoder`.
 *
 * Use it to open render/compute passes (`beginRenderPass` /
 * `beginComputePass`) and to record buffer/texture copies and query resolves
 * between them. While a pass is open the encoder is locked; it unlocks when
 * the pass `end()`s. Call `finish()` to produce the `GpuCommandBuffer` for
 * `queue.submit`.
 */
export declare class GpuCommandEncoder {
  /** The debug label (read-write). */
  get label(): string | null
  set label(label: string)
  /**
   * Begin a render pass with the given attachments and return its encoder.
   * The command encoder is locked until the returned pass `end()`s.
   */
  beginRenderPass(descriptor: GpuRenderPassDescriptor): GpuRenderPassEncoder
  /**
   * Begin a compute pass and return its encoder. The command encoder is
   * locked until the returned pass `end()`s.
   */
  beginComputePass(descriptor?: GpuComputePassDescriptor | undefined | null): GpuComputePassEncoder
  /**
   * Record a buffer-to-buffer copy of `size` bytes. `source` needs
   * `COPY_SRC`, `destination` needs `COPY_DST`; offsets and size must be
   * 4-byte aligned.
   */
  copyBufferToBuffer(source: GpuBuffer, sourceOffset: number, destination: GpuBuffer, destinationOffset: number, size: number): void
  /**
   * Record a copy from a buffer's packed pixel data into a texture region.
   * `source.bytesPerRow` must satisfy the 256-byte alignment rule; the buffer
   * needs `COPY_SRC` and the texture `COPY_DST`.
   */
  copyBufferToTexture(source: GpuImageCopyBuffer, destination: GpuImageCopyTexture, copySize: GpuExtent3D): void
  /**
   * Record a copy from a texture region into a buffer. `destination.bytesPerRow`
   * must be 256-byte aligned; the texture needs `COPY_SRC` and the buffer
   * `COPY_DST`. (For a convenient CPU readback, prefer `readTexturePixels`.)
   */
  copyTextureToBuffer(source: GpuImageCopyTexture, destination: GpuImageCopyBuffer, copySize: GpuExtent3D): void
  /**
   * Record a texture-to-texture copy of `copySize`. The two textures must
   * have compatible formats; `source` needs `COPY_SRC` and `destination`
   * `COPY_DST`.
   */
  copyTextureToTexture(source: GpuImageCopyTexture, destination: GpuImageCopyTexture, copySize: GpuExtent3D): void
  /**
   * Record a command that zero-fills a range of `buffer` (default: the whole
   * buffer). Offset and size must be 4-byte aligned.
   */
  clearBuffer(buffer: GpuBuffer, offset?: number | undefined | null, size?: number | undefined | null): void
  /**
   * Writes a timestamp into `querySet` at this point in the encoder's command
   * stream — i.e. *between* passes, measuring a span that brackets whole
   * passes plus the copies between them.
   *
   * Native-only, and needs both `timestamp-query` and
   * `timestamp-query-inside-encoders`. Calling it without them is a
   * validation error, which this binding only prints to stderr — gate it on
   * `adapter.features.has("timestamp-query-inside-encoders")`.
   */
  writeTimestamp(querySet: GpuQuerySet, queryIndex: number): void
  /**
   * Copy `queryCount` resolved query results (starting at `firstQuery`) into
   * `destination` at `destinationOffset` as `u64`s. For timestamp queries,
   * multiply the deltas by `queue.getTimestampPeriod()` to get nanoseconds.
   * The destination buffer needs `QUERY_RESOLVE` usage.
   */
  resolveQuerySet(querySet: GpuQuerySet, firstQuery: number, queryCount: number, destination: GpuBuffer, destinationOffset: number): void
  /**
   * Open a labelled debug group spanning subsequent encoder commands (and any
   * passes recorded within it), visible in GPU debuggers. Balance with
   * `popDebugGroup()`.
   */
  pushDebugGroup(groupLabel: string): void
  /** Close the most recent `pushDebugGroup()`. */
  popDebugGroup(): void
  /** Insert a single labelled marker at this point in the command stream. */
  insertDebugMarker(markerLabel: string): void
  /**
   * Finish recording and produce a `GpuCommandBuffer` for `queue.submit`.
   * The encoder is consumed — no further commands may be recorded, and any
   * open pass must have `end()`ed first.
   */
  finish(descriptor?: GpuCommandEncoderDescriptor | undefined | null): GpuCommandBuffer
}

/**
 * Records the dispatches of a single compute pass. Created by
 * `commandEncoder.beginComputePass(descriptor?)`.
 *
 * Set a compute pipeline and bind groups, then `dispatchWorkgroups`. Call
 * `end()` to finish and re-enable the parent encoder.
 */
export declare class GpuComputePassEncoder {
  /** Set the compute pipeline used by subsequent `dispatchWorkgroups` calls. */
  setPipeline(pipeline: GpuComputePipeline): void
  /**
   * Bind a `GpuBindGroup` (or `null` to clear the slot) at group `index`,
   * with one `dynamicOffsets` entry per dynamic-offset binding.
   */
  setBindGroup(index: number, bindGroup?: GpuBindGroup | undefined | null, dynamicOffsets?: Array<number> | undefined | null): void
  /**
   * Dispatch a grid of `x × y × z` workgroups (y, z default to 1) of the
   * bound compute pipeline.
   */
  dispatchWorkgroups(x: number, y?: number | undefined | null, z?: number | undefined | null): void
  /**
   * Open a labelled debug group in GPU debuggers. Balance with
   * `popDebugGroup()`.
   */
  pushDebugGroup(groupLabel: string): void
  /** Close the most recent `pushDebugGroup()`. */
  popDebugGroup(): void
  /** Insert a single labelled marker at this point in the pass. */
  insertDebugMarker(markerLabel: string): void
  /**
   * Like `dispatchWorkgroups`, but with the `[x, y, z]` counts read as three
   * `u32`s from `indirectBuffer` at `indirectOffset`. The buffer needs
   * `INDIRECT` usage.
   */
  dispatchWorkgroupsIndirect(indirectBuffer: GpuBuffer, indirectOffset: number): void
  /**
   * Upload immediate (push-constant) data at byte `offset` for the compute
   * stage. Requires the `immediates` feature and a non-zero
   * `maxImmediateSize` limit.
   */
  setImmediates(offset: number, data: Uint8Array): void
  /**
   * Writes a timestamp into `querySet` at the point the GPU reaches this
   * command *within* the pass — e.g. between two dispatches that
   * `timestampWrites` would lump together.
   *
   * Native-only, and needs both `timestamp-query` and
   * `timestamp-query-inside-passes`. Calling it without them is a validation
   * error, which this binding only prints to stderr — gate it on
   * `adapter.features.has("timestamp-query-inside-passes")`.
   */
  writeTimestamp(querySet: GpuQuerySet, queryIndex: number): void
  /**
   * Finish the compute pass and re-enable the parent `GpuCommandEncoder`. No
   * other method on this pass may be called afterwards.
   */
  end(): void
}

/**
 * A compiled compute pipeline (shader + layout), created by
 * `device.createComputePipeline(Async)`. Bind it in a compute pass with
 * `pass.setPipeline`.
 */
export declare class GpuComputePipeline {
  /** Debug label (read-write). */
  get label(): string | null
  set label(label: string)
  /**
   * Get the auto-generated bind group layout for group `index`. Useful when
   * the pipeline was created with `layout: "auto"` and you need a layout to
   * build matching bind groups.
   */
  getBindGroupLayout(index: number): GpuBindGroupLayout
}

/**
 * The logical GPU device — the root object you create resources from and the
 * owner of the default `queue`. Obtained via `adapter.requestDevice`.
 *
 * Every `createX` method here builds a GPU resource (buffers, textures,
 * samplers, bind groups, pipelines, shader modules, query sets, command
 * encoders). Errors from GPU work are surfaced through `pushErrorScope` /
 * `popErrorScope` or the `onuncapturederror` handler rather than as thrown
 * exceptions. Call `destroy()` at shutdown; `lost` resolves when the device
 * goes away.
 */
export declare class GpuDevice {
  /** The debug label (read-write). */
  get label(): string | null
  set label(label: string)
  /**
   * The features actually enabled on this device — a subset of what was
   * requested. Check with `device.features.has(name)` before using a
   * feature-gated code path.
   */
  get features(): GpuSupportedFeatures
  /**
   * The limits granted to this device (the requested values, or the adapter
   * defaults where none were requested).
   */
  get limits(): GpuSupportedLimits
  /**
   * Identification of the adapter this device was created from — the same
   * shape as `adapter.info`, kept accessible once you only hold the device.
   */
  get adapterInfo(): GpuAdapterInfo
  /**
   * The device's default queue — where you `submit` command buffers and call
   * `writeBuffer` / `writeTexture`. Returns a fresh handle to the same
   * underlying queue each time.
   */
  get queue(): GpuQueue
  /**
   * Returns a Promise that resolves with `GPUDeviceLostInfo` when the device
   * is lost (either via `destroy()` or a hardware/driver fault).
   */
  get lost(): Promise<GpuDeviceLostInfo>
  /**
   * The current uncaptured-error handler, or `null`.
   *
   * Readback is provided by the package's public entry (`webgpu.js`); the raw
   * `index.js` getter returns `undefined` (the native handler can't be read
   * back out), which is why the type here describes the `webgpu.js`
   * behaviour. Import from `metis-native`, not `metis-native/index.js`.
   */
  get onuncapturederror(): ((event: GpuUncapturedErrorEvent) => void) | null
  /**
   * Set an `onuncapturederror` handler. The handler is called with a
   * `GpuUncapturedErrorEvent` whenever a GPU error escapes all error scopes.
   */
  set onuncapturederror(callback: (arg: GpuUncapturedErrorEvent) => void)
  /**
   * Allocate a `GpuBuffer` of `descriptor.size` bytes with the given `usage`
   * flags. Set `mappedAtCreation` to fill it from the CPU before first use.
   */
  createBuffer(descriptor: GpuBufferDescriptor): GpuBuffer
  /**
   * Create a `GpuTexture` with the given size, `format`, mip/sample counts
   * and `usage` flags. For loading image or KTX2 files into a texture, prefer
   * `loadImageTexture` / `loadKtx2Texture`.
   */
  createTexture(descriptor: GpuTextureDescriptor): GpuTexture
  /**
   * Create a `GpuSampler` describing how shaders filter and address a texture.
   * Omitting the descriptor gives nearest-filtering, clamp-to-edge defaults.
   */
  createSampler(descriptor?: GpuSamplerDescriptor | undefined | null): GpuSampler
  /**
   * Create a `GpuBindGroupLayout`: the shape (binding indices, types and
   * stage visibility) that both a pipeline layout and a matching bind group
   * are validated against.
   */
  createBindGroupLayout(descriptor: GpuBindGroupLayoutDescriptor): GpuBindGroupLayout
  /**
   * Create a `GpuPipelineLayout` from an ordered list of bind group layouts
   * (plus an optional immediate-data size), defining the resource interface a
   * pipeline expects.
   */
  createPipelineLayout(descriptor: GpuPipelineLayoutDescriptor): GpuPipelineLayout
  /**
   * Create a `GpuBindGroup`: the concrete resources (buffers, samplers,
   * texture views) bound to a `GpuBindGroupLayout`, ready to bind in a pass.
   */
  createBindGroup(descriptor: GpuBindGroupDescriptor): GpuBindGroup
  /**
   * Compile a WGSL shader module from `descriptor.code`. Compilation errors
   * surface via `getCompilationInfo()` / error scopes, not as a throw.
   */
  createShaderModule(descriptor: GpuShaderModuleDescriptor): GpuShaderModule
  /**
   * Create a compute pipeline synchronously. This blocks while the driver
   * compiles the shader; use `createComputePipelineAsync` on a hot path to
   * keep it off the JS thread.
   */
  createComputePipeline(descriptor: GpuComputePipelineDescriptor): GpuComputePipeline
  /**
   * Create a compute pipeline off the JS thread. The returned promise
   * **rejects** with any validation error from compilation (an async task's
   * GPU work is outside a caller's `pushErrorScope`, so it reports errors
   * itself).
   */
  createComputePipelineAsync(descriptor: GpuComputePipelineDescriptor): Promise<GpuComputePipeline>
  /**
   * Create a render pipeline synchronously. This blocks while the driver
   * compiles the shaders; use `createRenderPipelineAsync` on a hot path to
   * keep it off the JS thread.
   */
  createRenderPipeline(descriptor: GpuRenderPipelineDescriptor): GpuRenderPipeline
  /**
   * Create a render pipeline off the JS thread. The returned promise
   * **rejects** with any validation error from compilation (the same async
   * error-reporting contract as `createComputePipelineAsync`).
   */
  createRenderPipelineAsync(descriptor: GpuRenderPipelineDescriptor): Promise<GpuRenderPipeline>
  /**
   * Create a `GpuCommandEncoder` to record a batch of GPU commands (passes,
   * copies) for later `queue.submit`.
   */
  createCommandEncoder(descriptor?: GpuCommandEncoderDescriptor | undefined | null): GpuCommandEncoder
  /**
   * Create a `GpuRenderBundleEncoder` for recording a reusable sequence of
   * render commands.
   *
   * `colorFormats` / `depthStencilFormat` / `sampleCount` describe the render
   * pass the bundle will be executed in and must match it, since the bundle
   * is compiled against them.
   */
  createRenderBundleEncoder(descriptor: GpuRenderBundleEncoderDescriptor): GpuRenderBundleEncoder
  /**
   * Create a `GpuQuerySet` of `count` slots for `"occlusion"` or
   * `"timestamp"` queries. Timestamp queries need the `timestamp-query`
   * feature.
   */
  createQuerySet(descriptor: GpuQuerySetDescriptor): GpuQuerySet
  /**
   * Begin capturing GPU errors of the given type.
   * `filter`: `"validation"` | `"out-of-memory"` | `"internal"`
   *
   * Scopes nest, and each one must be closed by a matching
   * `popErrorScope()`. Only work issued between the two is captured.
   */
  pushErrorScope(filter: GPUErrorFilter): void
  /**
   * End the current error scope and resolve with the first error captured,
   * or null.
   *
   * The scope closes when this is *called*, not when the returned promise
   * settles — so work issued immediately afterwards is already outside it,
   * and there is no need to await before continuing. Throws if no scope is
   * open on this device.
   */
  popErrorScope(): Promise<GpuError | null>
  /**
   * Process the device's internal queues (running map/submit callbacks) and
   * return `true` once the queue is empty. Pass `"wait"` to block until all
   * submitted work completes; omit (or anything else) for a non-blocking
   * poll. Handy before reading back a resource in a test or teardown path.
   */
  poll(maintain?: string | undefined | null): boolean
  /**
   * Destroy the device, freeing its resources and causing `lost` to resolve
   * with reason `"destroyed"`. Subsequent GPU calls become invalid. Release
   * any `GpuSurface` (via `surface.destroy()`) before tearing down here.
   */
  destroy(): void
}

/**
 * The full resource interface of a pipeline: an ordered set of bind group
 * layouts plus optional immediate-data size. Created by
 * `device.createPipelineLayout` and passed as a pipeline's `layout` (the
 * alternative to `"auto"`).
 */
export declare class GpuPipelineLayout {
  /** Debug label (read-write). */
  get label(): string | null
  set label(label: string)
}

/**
 * A pool of `count` query slots (occlusion or timestamp), created by
 * `device.createQuerySet`. Passes write into its slots
 * (`beginOcclusionQuery`, `writeTimestamp`, `timestampWrites`); read the
 * results back by `encoder.resolveQuerySet` into a buffer.
 */
export declare class GpuQuerySet {
  /** Debug label (read-write). */
  get label(): string | null
  set label(label: string)
  /** The kind of queries this set holds: `"occlusion"` or `"timestamp"`. */
  get type(): GPUQueryType
  /** The number of query slots in the set. */
  get count(): number
  /**
   * Release the query set. (It is also freed automatically once no handle
   * references it.)
   */
  destroy(): void
}

/**
 * The device's command queue, reached via `device.queue`. Submit recorded
 * command buffers here, and upload data straight to buffers/textures with
 * `writeBuffer` / `writeTexture`.
 */
export declare class GpuQueue {
  /** The queue's debug label (read-write). */
  get label(): string | null
  set label(label: string)
  /**
   * Nanoseconds per timestamp-query tick — the multiplier that turns the raw
   * `u64` deltas written by `writeTimestamp` / `timestampWrites` into real
   * time. Meaningless unless the `timestamp-query` feature is enabled, and
   * only comparable between two timestamps from the same queue submission.
   *
   * Not in the WebGPU spec, which has no way to interpret timestamp values
   * at all; wgpu exposes the period instead.
   */
  getTimestampPeriod(): number
  /**
   * Submit command buffers for execution, in order. Each `GpuCommandBuffer`
   * is consumed — it cannot be submitted twice.
   */
  submit(commandBuffers: Array<GpuCommandBuffer>): void
  /**
   * Upload `data` into `buffer` at `bufferOffset` (the common way to fill a
   * buffer without mapping it). `dataOffset`/`size` select a sub-slice of
   * `data`. The buffer needs `COPY_DST`. The write is staged and takes effect
   * at the next `submit`.
   */
  writeBuffer(buffer: GpuBuffer, bufferOffset: number, data: Uint8Array, dataOffset?: number | undefined | null, size?: number | undefined | null): void
  /**
   * Upload `data` into a texture region. `dataLayout` describes how the
   * source bytes are packed (`bytesPerRow` / `rowsPerImage`); the texture
   * needs `COPY_DST`. Unlike `commandEncoder.copyBufferToTexture`, there is
   * no 256-byte row-alignment requirement here.
   */
  writeTexture(destination: GpuImageCopyTexture, data: Uint8Array, dataLayout: GpuImageDataLayout, size: GpuExtent3D): void
  /**
   * Resolve once all work submitted to this queue so far has finished on the
   * GPU. Flushes any pending `writeBuffer` / `writeTexture` staging first, so
   * awaiting it guarantees earlier uploads have executed.
   */
  onSubmittedWorkDone(): Promise<void>
}

/**
 * A finished, immutable render bundle. Execute it (repeatedly, in any number of
 * passes) with `renderPass.executeBundles([bundle])`.
 */
export declare class GpuRenderBundle {
  /** Debug label (read-write). */
  get label(): string | null
  set label(label: string)
}

/**
 * Records a reusable sequence of render commands, created by
 * `device.createRenderBundleEncoder(descriptor)`.
 *
 * The command subset is the spec's `GPURenderCommandsMixin` — pipeline, bind
 * groups, vertex/index buffers and the `draw*` family. State set inside a
 * bundle does **not** leak into the pass that executes it, and vice versa.
 *
 * Call `finish()` once to produce a `GpuRenderBundle`; the encoder is spent
 * afterwards.
 */
export declare class GpuRenderBundleEncoder {
  /** Set the render pipeline used by subsequent `draw*` calls. */
  setPipeline(pipeline: GpuRenderPipeline): void
  /** Bind a `GpuBindGroup` (or `null` to clear the slot) at group `index`. */
  setBindGroup(index: number, bindGroup?: GpuBindGroup | undefined | null, dynamicOffsets?: Array<number> | undefined | null): void
  /** Bind `buffer` as the vertex buffer for `slot`. */
  setVertexBuffer(slot: number, buffer: GpuBuffer, offset?: number | undefined | null, size?: number | undefined | null): void
  /** Bind the index buffer used by `drawIndexed` / `drawIndexedIndirect`. */
  setIndexBuffer(buffer: GpuBuffer, indexFormat: GPUIndexFormat, offset?: number | undefined | null, size?: number | undefined | null): void
  /** Draw `vertexCount` vertices in `instanceCount` instances (default 1). */
  draw(vertexCount: number, instanceCount?: number | undefined | null, firstVertex?: number | undefined | null, firstInstance?: number | undefined | null): void
  /** Draw using the bound index buffer. */
  drawIndexed(indexCount: number, instanceCount?: number | undefined | null, firstIndex?: number | undefined | null, baseVertex?: number | undefined | null, firstInstance?: number | undefined | null): void
  /** Like `draw`, with parameters read from `indirectBuffer` (needs `INDIRECT`). */
  drawIndirect(indirectBuffer: GpuBuffer, indirectOffset: number): void
  /** Like `drawIndexed`, with parameters read from `indirectBuffer`. */
  drawIndexedIndirect(indirectBuffer: GpuBuffer, indirectOffset: number): void
  /** Upload immediate (push-constant) data. Requires the `immediates` feature. */
  setImmediates(offset: number, data: Uint8Array): void
  /**
   * Replay the recorded commands into a real wgpu bundle encoder and return
   * the finished `GpuRenderBundle`. The encoder is spent — further calls,
   * including a second `finish()`, are an error.
   */
  finish(descriptor?: GpuRenderBundleDescriptor | undefined | null): GpuRenderBundle
}

/**
 * Records the draw commands of a single render pass. Created by
 * `commandEncoder.beginRenderPass(descriptor)`, which binds the pass's colour
 * and depth/stencil attachments.
 *
 * Set pipeline, bind groups and vertex/index buffers, then issue `draw*`
 * calls; `setViewport` / `setScissorRect` and the debug-marker calls apply to
 * this pass only. Call `end()` to finish — after which the parent
 * `GpuCommandEncoder` is usable again and no further calls on this pass are
 * valid.
 */
export declare class GpuRenderPassEncoder {
  /** Set the render pipeline used by subsequent `draw*` calls. */
  setPipeline(pipeline: GpuRenderPipeline): void
  /**
   * Bind a `GpuBindGroup` (or `null` to clear the slot) at group `index`.
   * `dynamicOffsets` supplies one byte offset per dynamic-offset binding in
   * the group, in binding order.
   */
  setBindGroup(index: number, bindGroup?: GpuBindGroup | undefined | null, dynamicOffsets?: Array<number> | undefined | null): void
  /**
   * Bind `buffer` as the vertex buffer for `slot` (matching a
   * `vertex.buffers` layout entry). `offset`/`size` select a sub-range
   * (defaults: from 0 to the end of the buffer).
   */
  setVertexBuffer(slot: number, buffer: GpuBuffer, offset?: number | undefined | null, size?: number | undefined | null): void
  /**
   * Bind the index buffer used by `drawIndexed` / `drawIndexedIndirect`.
   * `indexFormat` is `"uint16"` or `"uint32"`; `offset`/`size` select a
   * sub-range (defaults: the whole buffer).
   */
  setIndexBuffer(buffer: GpuBuffer, indexFormat: GPUIndexFormat, offset?: number | undefined | null, size?: number | undefined | null): void
  /**
   * Draw `vertexCount` vertices from the bound vertex buffers, in
   * `instanceCount` instances (default 1), starting at `firstVertex` /
   * `firstInstance` (default 0).
   */
  draw(vertexCount: number, instanceCount?: number | undefined | null, firstVertex?: number | undefined | null, firstInstance?: number | undefined | null): void
  /**
   * Draw using the bound index buffer: `indexCount` indices in
   * `instanceCount` instances (default 1), starting at `firstIndex`
   * (default 0). `baseVertex` is added to each index; `firstInstance`
   * offsets the instance range.
   */
  drawIndexed(indexCount: number, instanceCount?: number | undefined | null, firstIndex?: number | undefined | null, baseVertex?: number | undefined | null, firstInstance?: number | undefined | null): void
  /**
   * Like `draw`, but with the parameters (vertex/instance counts and first
   * indices, packed as four `u32`s) read from `indirectBuffer` at
   * `indirectOffset`. The buffer needs `INDIRECT` usage.
   */
  drawIndirect(indirectBuffer: GpuBuffer, indirectOffset: number): void
  /**
   * Like `drawIndexed`, but with the parameters (five `u32`s) read from
   * `indirectBuffer` at `indirectOffset`. The buffer needs `INDIRECT` usage.
   */
  drawIndexedIndirect(indirectBuffer: GpuBuffer, indirectOffset: number): void
  /**
   * Set the viewport rectangle (pixels) and depth range that NDC coordinates
   * map into. Defaults to the full attachment with depth `0..1`.
   */
  setViewport(x: number, y: number, width: number, height: number, minDepth: number, maxDepth: number): void
  /**
   * Restrict rendering to the given pixel rectangle; fragments outside it are
   * discarded. Defaults to the full attachment.
   */
  setScissorRect(x: number, y: number, width: number, height: number): void
  /**
   * Set the constant colour used by the `constant` / `one-minus-constant`
   * blend factors.
   */
  setBlendConstant(color: GpuColor): void
  /**
   * Set the reference value compared against in stencil tests (for the
   * `replace` op and comparisons).
   */
  setStencilReference(reference: number): void
  /**
   * Open a labelled debug group, shown as a nested scope in RenderDoc / PIX /
   * Nsight. Must be balanced with `popDebugGroup()`.
   */
  pushDebugGroup(groupLabel: string): void
  /** Close the most recent `pushDebugGroup()`. */
  popDebugGroup(): void
  /**
   * Insert a single labelled marker at this point in the pass, visible in GPU
   * debuggers.
   */
  insertDebugMarker(markerLabel: string): void
  /**
   * Begin an occlusion query writing into slot `queryIndex` of the pass's
   * `occlusionQuerySet`. Draws until `endOcclusionQuery()` contribute to the
   * sample count. Queries must not be nested.
   */
  beginOcclusionQuery(queryIndex: number): void
  /** End the occlusion query opened by `beginOcclusionQuery()`. */
  endOcclusionQuery(): void
  /**
   * Upload immediate (push-constant) data at byte `offset`, visible to shader
   * stages that declare an immediates block. Requires the `immediates`
   * feature and a non-zero `maxImmediateSize` limit.
   */
  setImmediates(offset: number, data: Uint8Array): void
  /**
   * Writes a timestamp into `querySet` at the point the GPU reaches this
   * command *within* the pass — the granularity `timestampWrites` can't give
   * you, since that only brackets the pass as a whole.
   *
   * Native-only, and needs both `timestamp-query` and
   * `timestamp-query-inside-passes`. Calling it without them is a validation
   * error, which this binding only prints to stderr — gate it on
   * `adapter.features.has("timestamp-query-inside-passes")`.
   */
  writeTimestamp(querySet: GpuQuerySet, queryIndex: number): void
  /**
   * Execute pre-recorded `GpuRenderBundle`s in order, as if their commands
   * had been issued here.
   *
   * A bundle's state (pipeline, bind groups, vertex/index buffers) is scoped
   * to the bundle: it neither inherits from nor leaks into this pass, so any
   * state the pass needs afterwards must be re-set. The bundles' formats and
   * sample count must match this pass's attachments.
   */
  executeBundles(bundles: Array<GpuRenderBundle>): void
  /**
   * Finish the render pass and release the parent `GpuCommandEncoder` for
   * further recording. No other method on this pass may be called afterwards.
   */
  end(): void
}

/**
 * A compiled render pipeline — vertex + fragment state, primitive,
 * depth/stencil, multisample and layout baked together. Created by
 * `device.createRenderPipeline(Async)` and bound with `pass.setPipeline`.
 */
export declare class GpuRenderPipeline {
  /** Debug label (read-write). */
  get label(): string | null
  set label(label: string)
  /**
   * Get the auto-generated bind group layout for group `index` — chiefly for
   * pipelines created with `layout: "auto"`.
   */
  getBindGroupLayout(index: number): GpuBindGroupLayout
}

/**
 * Describes how a shader filters and addresses a texture when sampling
 * (min/mag/mip filters, address modes, LOD clamps, anisotropy, optional
 * comparison for shadow sampling). Created by `device.createSampler` and bound
 * through a bind group.
 */
export declare class GpuSampler {
  /** Debug label (read-write). */
  get label(): string | null
  set label(label: string)
}

/**
 * A compiled WGSL shader module created by `device.createShaderModule`,
 * referenced as the `module` of a pipeline's vertex/fragment/compute stage.
 * Compilation is deferred and never throws here — inspect diagnostics via
 * `getCompilationInfo()` or wrap creation in an error scope.
 */
export declare class GpuShaderModule {
  /** Debug label (read-write). */
  get label(): string | null
  set label(label: string)
  /**
   * Resolve with the compiler's diagnostics for this module — errors,
   * warnings and info messages, each with a source location. Empty on a clean
   * compile.
   */
  getCompilationInfo(): Promise<GpuCompilationInfo>
}

/**
 * Spec-compliant setlike<DOMString> shape for `GPUSupportedFeatures`.
 * Exposes `.has()`, `.size`, `.keys()`, `.values()`, `.entries()`, `.forEach()`.
 */
export declare class GpuSupportedFeatures {
  get size(): number
  has(key: GPUFeatureName | GPUNativeFeatureName): boolean
  /** Returns an iterator-compatible array of feature name strings (keys == values for a set). */
  keys(): Array<GPUFeatureName | GPUNativeFeatureName>
  values(): Array<GPUFeatureName | GPUNativeFeatureName>
  /** Returns `[[name, name], ...]` pairs (set entries: key === value). */
  entries(): Array<Array<string>>
  /**
   * Calls `callback(value, key)` for each feature name.
   * The third `set` argument from the spec is omitted for simplicity.
   */
  forEach(callback: (value: string, key: string) => void): void
}

export declare class GpuSurface {
  /**
   * Returns the adapter's preferred texture format for this surface.
   *
   * **Call this once at setup, never per frame.** It is not a cheap getter:
   * `get_capabilities` is a window-system round-trip (measured at ~6 ms on a
   * GTX 1070 / Vulkan / Windows), because it re-queries the surface's formats,
   * present modes and alpha modes from the driver every call. The result is a
   * property of the surface+adapter pair and doesn't change with window size,
   * so cache it — a render pipeline is built against one format anyway, so a
   * value that could change mid-run would be a bug, not a feature.
   */
  getPreferredFormat(): GPUTextureFormat
  /**
   * Configure the swapchain. Must be called before the first `getCurrentTexture()` and
   * again whenever the window is resized. When `present_mode` is omitted the
   * default is `Mailbox` (falling back to `Fifo` if the surface lacks it).
   */
  configure(device: GpuDevice, config: SurfaceConfiguration): void
  /**
   * Acquire the next swapchain image. Call `present()` on the returned
   * `GpuSurfaceTexture` after submitting your render commands.
   */
  getCurrentTexture(): GpuSurfaceTexture
  /**
   * Release the swapchain and the underlying `VkSurfaceKHR` / platform
   * surface. Idempotent; every method above returns an error afterwards.
   *
   * **Call this before `window.destroy()` and `sdlQuit()`.** It is not
   * optional bookkeeping — leaving it to the automatic drop at process exit
   * is a segfault on Linux/X11, reliably. A surface's teardown talks to the
   * window system: Mesa's Vulkan drivers destroy per-swapchain-image X11
   * present fences via `xcb_sync_destroy_fence`, on the xcb connection SDL
   * owns. `SDL_DestroyWindow`/`SDL_Quit` close that connection and free it,
   * so a surface dropped afterwards makes xcb calls through a dangling
   * connection pointer and crashes inside libxcb — far from the real cause,
   * with the addon nowhere near the top of the backtrace.
   *
   * The old `create_surface` doc ("the window must remain alive for the
   * entire lifetime of the surface") stated this invariant but gave callers
   * no way to *end* the surface's lifetime early, so it was unsatisfiable at
   * shutdown. This is that way.
   */
  destroy(): void
}

export declare class GpuSurfaceTexture {
  /** Create a view into the surface texture for use as a render attachment. */
  createView(): GpuTextureView
  /** Present the frame to the window. Must be called after queue.submit(). */
  present(): void
  /**
   * `true` when the swapchain is still functional but reconfiguring it would
   * improve performance (e.g. after a resize).
   */
  get suboptimal(): boolean
}

/**
 * A GPU texture (image) created by `device.createTexture`, `loadImageTexture`
 * or `loadKtx2Texture`. Bind it to shaders through a `GpuTextureView` (from
 * `createView`) or use it as a render attachment. The size/format/mip getters
 * report what it was created with — read `format` rather than assuming, since
 * the loaders pick it from the source.
 */
export declare class GpuTexture {
  /**
   * Debug label (read-write), as set at creation or reassigned. The label
   * given at creation is what GPU debuggers show.
   */
  get label(): string | null
  set label(label: string)
  /**
   * Create a `GpuTextureView` for binding or as a render attachment. The
   * descriptor can narrow to a single mip level, array layer or aspect, or
   * reinterpret the format — omit it for a default view of the whole texture.
   */
  createView(descriptor?: GpuTextureViewDescriptor | undefined | null): GpuTextureView
  get width(): number
  get height(): number
  get depthOrArrayLayers(): number
  get mipLevelCount(): number
  get sampleCount(): number
  get dimension(): GPUTextureDimension
  get format(): GPUTextureFormat
  /** The `GPUTextureUsage` bitmask this texture was created with. */
  get usage(): number
  /**
   * The view dimension a default `createView()` would produce for this
   * texture — `"2d"`, `"2d-array"`, `"3d"` or `"1d"`, inferred from the
   * texture's dimension and layer count.
   */
  get textureBindingViewDimension(): GPUTextureViewDimension
  /**
   * Free the texture's GPU memory now. Any views created from it, and any use
   * of it afterwards, become invalid.
   */
  destroy(): void
}

/**
 * A view onto a `GpuTexture` (a mip/layer/aspect subset, possibly with a
 * reinterpreted format), created by `texture.createView`. This is what you
 * actually put in a bind group entry or use as a render-pass attachment.
 */
export declare class GpuTextureView {
  /** Debug label (read-write). */
  get label(): string | null
  set label(label: string)
}

/**
 * An SDL audio stream: a queue that converts format, channel count and sample
 * rate between what you put in and what comes out.
 *
 * Useful on its own as a converter — put f32 stereo in, get s16 mono out — and
 * that unbound use needs no audio device, which makes it the one part of the
 * SDL audio path that is trivially testable anywhere.
 */
export declare class SdlAudioStream {
  /**
   * Queue f32 samples, interleaved, in the stream's **source** format.
   *
   * Errors if the sample count isn't a whole number of source frames — a
   * partial frame would shift every subsequent frame's channel assignment,
   * which produces audio that is wrong rather than short.
   */
  putSamples(samples: Float32Array): void
  /**
   * Pull up to `frames` converted frames out, as f32.
   *
   * Only valid when the destination format is `F32` — reinterpreting s16
   * bytes as floats is the byte-vs-value confusion this package has been
   * bitten by before, so it is refused rather than silently returning noise.
   * Use `getBytes()` for any other destination format.
   */
  getSamples(frames: number): Float32Array
  /**
   * Pull up to `frames` converted frames out as raw bytes in the destination
   * format.
   */
  getBytes(frames: number): Uint8Array
  /** Converted bytes ready to be read. */
  get available(): number
  /** Bytes still queued on the input side, not yet converted. */
  get queued(): number
  /**
   * Tell SDL no more input is coming, so it may convert the tail rather than
   * holding it back waiting for more.
   *
   * Without this the last partial chunk can sit in the stream indefinitely —
   * which reads as "the end of my sound is missing".
   */
  flush(): void
  /** Drop everything queued, both sides. */
  clear(): void
  get gain(): number
  set gain(gain: number)
  /**
   * Release the stream. Idempotent, and also runs on collection.
   *
   * The pointer is nulled rather than left dangling, so a call made after
   * `destroy()` reaches SDL's own null check and comes back as an error
   * (or `-1` from the byte counters) instead of reading freed memory.
   */
  destroy(): void
}

/** A system-defined or custom mouse cursor. Destroy with `.destroy()`. */
export declare class SdlCursor {
  /**
   * Release the cursor. Do not call on a cursor obtained from
   * `sdlGetCursor()` or `sdlGetDefaultCursor()`.
   */
  destroy(): void
}

/** An open gamepad handle. Call `.close()` when done. */
export declare class SdlGamepad {
  instanceId(): number
  name(): string
  gamepadType(): string
  isConnected(): boolean
  getPlayerIndex(): number
  setPlayerIndex(index: number): void
  /** Axis value normalised to -1.0 .. 1.0 (triggers: 0.0 .. 1.0). */
  getAxis(axis: SdlGamepadAxis): number
  hasAxis(axis: SdlGamepadAxis): boolean
  getButton(button: SdlGamepadButton): boolean
  hasButton(button: SdlGamepadButton): boolean
  /** Rumble the gamepad. Values 0–65535, duration in milliseconds. */
  rumble(lowFreq: number, highFreq: number, durationMs: number): boolean
  /** Rumble the trigger motors. */
  rumbleTriggers(left: number, right: number, durationMs: number): boolean
  /** Set the LED colour (if supported). Components 0–255. */
  setLed(r: number, g: number, b: number): boolean
  /** Axis name → numeric constant. E.g. `"leftx"` → `SdlGamepadAxis.LeftX`. */
  axisFromString(s: string): number
  /** Button name → numeric constant. E.g. `"a"` → `SdlGamepadButton.South`. */
  buttonFromString(s: string): number
  /** Numeric axis constant → canonical name string. */
  axisToString(axis: SdlGamepadAxis): string
  /** Numeric button constant → canonical name string. */
  buttonToString(button: SdlGamepadButton): string
  close(): void
}

/** An open joystick handle. Call `.close()` when done. */
export declare class SdlJoystick {
  instanceId(): number
  name(): string
  joystickType(): string
  isConnected(): boolean
  numAxes(): number
  /** Axis value normalised to -1.0 .. 1.0. */
  getAxis(axis: number): number
  numButtons(): number
  getButton(button: number): boolean
  numHats(): number
  /** Current hat (D-pad) position. */
  getHat(hat: number): SdlJoyHat | null
  numBalls(): number
  getBall(ball: number): BallDelta
  /**
   * Rumble the joystick. `low_freq` and `high_freq` are 0–65535.
   * `duration_ms` is the duration in milliseconds.
   */
  rumble(lowFreq: number, highFreq: number, durationMs: number): boolean
  /** Rumble the trigger motors (if supported). Values 0–65535. */
  rumbleTriggers(left: number, right: number, durationMs: number): boolean
  /** Set the joystick LED colour (if supported). Components 0–255. */
  setLed(r: number, g: number, b: number): boolean
  close(): void
}

/**
 * A handle to SDL's live keyboard state array.
 *
 * Call `sdlGetKeyboardState()` **once** at startup — SDL keeps the underlying
 * memory continuously updated as you call `sdlPollEvents()` or
 * `sdlPumpEvents()`, so you never need to re-obtain it.
 *
 * ```ts
 * const KB = sdlGetKeyboardState()
 * // inside the game loop — no extra allocation:
 * if (KB.get(SdlScancode.W)) { /* W held *\/ }
 * ```
 */
export declare class SdlKeyboardState {
  /**
   * Returns `true` if the key identified by `scancode` is currently pressed.
   * A real `SdlScancode` past the tracked array (e.g. `SdlScancode.Count`)
   * returns `false`; a number that isn't a `SdlScancode` variant is rejected
   * at the napi boundary.
   */
  get(scancode: SdlScancode): boolean
  /** Total number of scancodes tracked (SdlScancode.Count, typically 512). */
  get len(): number
}

/**
 * An SDL3 OS window, created by `sdlCreateWindow`. Query and change its title,
 * size, position, opacity and display/grab state, and drive its lifecycle
 * (`show`/`hide`/`minimize`/`maximize`/`setFullscreen`).
 *
 * Pass it to `requestAdapterForWindow` / `createSurface` to render into it. At
 * shutdown release any `GpuSurface` (via `surface.destroy()`) **before**
 * calling `window.destroy()`.
 */
export declare class SdlWindow {
  get id(): number
  get flags(): number
  get title(): string
  setTitle(title: string): void
  getTitle(): string
  get width(): number
  get height(): number
  setSize(width: number, height: number): void
  /**
   * Returns `{width, height}` queried live from SDL (may differ from cached values
   * when the OS has resized the window).
   */
  getSize(): WindowSize
  /** Pixel size, which may differ from logical size on HiDPI displays. */
  getSizeInPixels(): WindowSize
  getPosition(): WindowPosition
  setPosition(x: number, y: number): void
  getOpacity(): number
  setOpacity(opacity: number): void
  getDisplayScale(): number
  show(): void
  hide(): void
  raise(): void
  maximize(): void
  minimize(): void
  restore(): void
  setFullscreen(fullscreen: boolean): void
  setResizable(resizable: boolean): void
  setBordered(bordered: boolean): void
  setAlwaysOnTop(onTop: boolean): void
  setFocusable(focusable: boolean): void
  /** Wait for the compositor to acknowledge any pending window-state changes. */
  sync(): void
  setKeyboardGrab(grabbed: boolean): void
  getKeyboardGrab(): boolean
  setMouseGrab(grabbed: boolean): void
  getMouseGrab(): boolean
  /**
   * Confine the mouse to a rectangle within this window.
   * Pass `null` to release the confinement.
   */
  setMouseRect(rect?: MouseRect | undefined | null): void
  getMouseRect(): MouseRect | null
  destroy(): void
}

/**
 * 2-D vector drawing context backed by Lyon tessellation.
 *
 * `VectorContext` owns the GPU vertex and index buffers for tessellated
 * geometry.  Color, paint, and model transforms are entirely the caller's
 * responsibility and are not tracked here.
 *
 * Typical frame loop:
 * 1. Draw with the path / text / transform API.
 * 2. `flush()` — tessellates and uploads geometry to the GPU buffers.
 * 3. In your render pass:
 *    a. Bind your pipeline.
 *    b. `bindBuffers(pass)` — sets vertex buffer (slot 0, stride 16,
 *       layout `[x, y, u, v]`) and index buffer (Uint32) on the pass.
 *    c. Iterate `drawCalls`, set per-call bind groups, call `drawIndexed`.
 *
 * Paths need not be closed: `stroke()` on an open path draws it open, and
 * `fill()` closes it implicitly (as canvas does).
 */
export declare class VectorContext {
  /**
   * Create a new `VectorContext`.
   *
   * - `device` — the wgpu device that owns the vertex / index buffers.
   * - `tolerance` — flattening tolerance **for paths** (`fill`/`stroke`), in
   *   the same pixel-space coordinates the path is built in (default
   *   `0.25`). Lower = smoother curves, more triangles.
   *
   * This does **not** affect text: glyph geometry is cached per size bucket
   * and flattened at a tolerance derived from the requested pixel size (see
   * `font.rs`), because a glyph is tessellated once in font units and then
   * only transformed.
   */
  constructor(device: GpuDevice, tolerance?: number | undefined | null)
  /**
   * Tag subsequent draw calls with `id`.  The value is surfaced in the
   * `drawCalls` array after `flush()`.
   */
  setId(id: number): void
  /**
   * Push a 2-D affine transform onto the stack, nesting it *inside* the
   * current top.  `matrix` is 6 floats in column-major order:
   * `[m00, m01, m10, m11, m20, m21]` — the same layout as canvas's
   * `setTransform(a, b, c, d, e, f)`.
   *
   * Nesting means a point is transformed by the innermost (most recently
   * pushed) transform first, then outward — so pushing `translate(100, 0)`
   * and then `scale(2)` draws a point at `(10, 10)` at `(120, 20)`: scaled in
   * the translated group's local space. This matches canvas/SVG.
   */
  pushTransform(matrix: Float32Array): void
  popTransform(): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  quadTo(cx: number, cy: number, x: number, y: number): void
  cubicTo(c1X: number, c1Y: number, c2X: number, c2Y: number, x: number, y: number): void
  /**
   * Arc centred at `(cx, cy)` with `radius`.  `sweepAngle` is a delta in
   * radians from `startAngle` (not an absolute end angle).
   */
  arc(cx: number, cy: number, radius: number, startAngle: number, sweepAngle: number): void
  closePath(): void
  fill(): void
  stroke(width: number): void
  loadFont(name: string, path: string, faceIndex?: number | undefined | null): void
  unloadFont(name: string): void
  drawText(text: string, fontName: string, sizePx: number, x: number, y: number): void
  fontMetrics(fontName: string, sizePx: number): FontMetrics
  measureText(fontName: string, sizePx: number, text: string): number
  /**
   * Tessellate all pending draw commands and upload the resulting geometry
   * to the GPU vertex and index buffers.  Resets the draw list.
   *
   * After this call, `drawCalls` is populated and ready to iterate.
   */
  flush(): void
  /**
   * The draw calls produced by the last `flush()`.
   *
   * Iterate this array inside your render pass to issue per-call bind
   * group updates (paint, model matrix, …) and `drawIndexed` calls.
   */
  get drawCalls(): Array<DrawCall>
  /**
   * Bind the tessellated vertex buffer (slot 0) and index buffer (Uint32)
   * onto `pass`.  Call this once before iterating `drawCalls`.
   *
   * Vertex layout — stride 16 bytes: `[x, y, u, v]` as `Float32x2` ×2.
   */
  bindBuffers(pass: GpuRenderPassEncoder): void
  /** Discard all pending draw commands without uploading anything. */
  clear(): void
}

export interface AudioDeviceInfo {
  /** Pass to `AudioMixer.openDevice()`. */
  id: number
  name: string
  /**
   * The format the hardware is running at. SDL will convert to it, so this
   * is informational — it does not constrain what you may send.
   */
  format: AudioFormatInfo
  /** SDL's preferred buffer size for this device, in sample frames. */
  bufferFrames: number
}

/**
 * What `inspectAudioFile` reports. Everything here comes from the container
 * header, so it is cheap — no packet is decoded.
 */
export interface AudioFileInfo {
  /** Container short name, e.g. `"wave"`, `"ogg"`, `"isomp4"`. */
  container: string
  /** Codec short name, e.g. `"pcm_s16le"`, `"flac"`, `"mp3"`. */
  codec: string
  sampleRate: number
  channels: number
  /**
   * Frame count, when the container states one. Absent for streamed
   * containers that don't record a length.
   */
  frameCount?: number
  /** Duration in seconds, when the frame count is known. */
  duration?: number
  /**
   * Bits per decoded sample, when the codec reports one. Absent for lossy
   * codecs, where the notion doesn't apply.
   */
  bitsPerSample?: number
}

/** A device's or stream's current format, as reported by SDL. */
export interface AudioFormatInfo {
  /** SDL's own name for the format, e.g. `"SDL_AUDIO_F32LE"`. */
  format: string
  channels: number
  freq: number
}

export interface AudioLoadOptions {
  /**
   * Resample to this rate at load time. Omit to keep the file's own rate and
   * let the mixer resample per-voice instead.
   *
   * Worth doing for a sound played often at a rate that differs from the
   * device's: the conversion happens once here instead of on every frame of
   * every voice.
   */
  targetSampleRate?: number
  /**
   * Downmix to a single channel. A mono clip is what the mixer's positional
   * panning actually wants — a stereo source carries its own left/right
   * image, which fights any attempt to place it in space.
   */
  forceMono?: boolean
  /** Stop after this many frames. Omit for the whole file. */
  maxFrames?: number
  /**
   * Format hint: a file extension (`"ogg"`, `".flac"`) or a MIME type
   * (`"audio/flac"`). Only a hint — probing decides. Chiefly useful for
   * `decodeAudioClip`, which has no filename to infer one from.
   */
  hint?: string
}

export interface AudioMixerOptions {
  /** Output rate. Defaults to 48000. */
  sampleRate?: number
  /** Output channel count: 1 or 2. Defaults to 2. */
  channels?: number
}

export interface AudioPlayOptions {
  /** Linear gain. Defaults to 1. */
  gain?: number
  /** Stereo position, -1 (left) to +1 (right). Defaults to 0. */
  pan?: number
  /** Repeat forever. Defaults to false. */
  loop?: boolean
  /**
   * Speed multiplier; pitch follows it, as with a tape machine. Defaults
   * to 1.
   */
  rate?: number
  /** Start this many seconds into the clip. Defaults to 0. */
  startTime?: number
}

export interface BallDelta {
  xrel: number
  yrel: number
}

/**
 * Create a wgpu rendering surface backed by an SDL3 window.
 *
 * The `SdlWindow` must remain alive (and unclosed) for the entire lifetime of
 * the returned `GpuSurface` — so at shutdown call `surface.destroy()` *before*
 * `window.destroy()` / `sdlQuit()`. Skipping it segfaults on Linux/X11; see
 * `GpuSurface::destroy`.
 */
export declare function createSurface(adapter: GpuAdapter, window: SdlWindow): GpuSurface

/**
 * Decode audio from bytes already in memory.
 *
 * The `Uint8Array` is **copied here, on the JS thread**, for the same reason
 * `GltfResourceOverride.bytes` is: it borrows JS-owned memory, which cannot
 * travel to a worker.
 */
export declare function decodeAudioClip(bytes: Uint8Array, options?: AudioLoadOptions | undefined | null): Promise<AudioClip>

/**
 * One tessellated draw call produced by `flush()`.
 *
 * The caller iterates `drawCalls`, sets their own per-call bind groups
 * (paint, model matrix, …), then issues `drawIndexed` using `firstIndex`
 * and `indexCount`.  `id` is the value passed to `setId()` and can be used
 * to look up widget-level data.
 */
export interface DrawCall {
  firstIndex: number
  indexCount: number
  id: number
}

/**
 * Lists **every** adapter the given backends expose, instead of letting wgpu
 * pick one. `requestAdapter` returns a single adapter chosen by
 * `powerPreference`, which is a hint — this is how you find out what it
 * actually had to choose between, and what each one reports.
 *
 * Worth reaching for when a machine has several GPUs, when performance is
 * inexplicably bad (a software rasterizer looks like a normal adapter until
 * you read `info.deviceType`), or when `requestDevice` fails on limits and you
 * need to know whether another adapter would do better.
 *
 * The returned adapters are usable, but for **windowed** rendering prefer
 * `requestAdapterForWindow` — an adapter picked from this list is not
 * guaranteed to be compatible with a given window's surface.
 */
export declare function enumerateAdapters(options?: GpuRequestAdapterOptions | undefined | null): Promise<Array<GpuAdapter>>

/** Font metrics in pixels at a given size. */
export interface FontMetrics {
  ascender: number
  descender: number
  lineGap: number
  lineHeight: number
  capHeight: number
  xHeight: number
  unitsPerEm: number
}

/** glTF `accessor.type` — how many components make one element. */
export declare enum GltfAccessorType {
  Scalar = 0,
  Vec2 = 1,
  Vec3 = 2,
  Vec4 = 3,
  Mat2 = 4,
  Mat3 = 5,
  Mat4 = 6
}

/** glTF `material.alphaMode`. */
export declare enum GltfAlphaMode {
  Opaque = 0,
  Mask = 1,
  Blend = 2
}

export interface GltfAnimation {
  name?: string
  samplers: Array<GltfAnimationSampler>
  channels: Array<GltfAnimationChannel>
  /**
   * Largest keyframe time across every sampler, in seconds — the length of
   * one loop. 0 when the animation has no keyframes.
   */
  duration: number
  extras?: string
}

export interface GltfAnimationChannel {
  /** Index into this animation's `samplers`. */
  sampler: number
  /**
   * Index into `GltfAsset.nodes`. `null` is legal — the spec allows a
   * channel with no target, which must be ignored rather than treated as
   * node 0.
   */
  targetNode?: number
  path: GltfAnimationPath
}

/** What an animation channel drives on its target node. */
export declare enum GltfAnimationPath {
  Translation = 0,
  Rotation = 1,
  Scale = 2,
  /** Morph target weights. */
  MorphTargetWeights = 3
}

export interface GltfAnimationSampler {
  interpolation: GltfInterpolation
  /** Keyframe times in seconds, strictly increasing. */
  input: Float32Array
  /**
   * Keyframe values, flattened. Length is
   * `input.length * valuesPerKeyframe`.
   */
  output: Float32Array
  /**
   * Components in one *value*: 3 for translation/scale, 4 for a rotation
   * quaternion, and the mesh's morph target count for weights.
   */
  components: number
  /**
   * Components consumed per keyframe — `components`, or `components * 3`
   * under `CubicSpline`.
   */
  valuesPerKeyframe: number
}

/** `KHR_materials_anisotropy`. */
export interface GltfAnisotropy {
  strength: number
  /** Radians, counter-clockwise from the tangent. */
  rotation: number
  texture?: GltfTextureRef
}

/**
 * A fully imported glTF asset: GPU handles plus the whole scene graph.
 *
 * This is a plain JS object, not a class — every field is materialised once
 * when the promise resolves. There is no lazy getter to re-pay for, and no
 * `destroy()`: the GPU handles are ordinary `GpuBuffer` / `GpuTexture` /
 * `GpuSampler` objects with their own `destroy()`, and freeing the asset means
 * destroying the ones you took.
 */
export interface GltfAsset {
  path: string
  version: string
  minVersion?: string
  generator?: string
  copyright?: string
  extensionsUsed: Array<string>
  extensionsRequired: Array<string>
  /**
   * Required extensions this importer does not implement. Always empty
   * unless `strictRequiredExtensions: false` was passed — in which case the
   * asset loaded anyway and this is the list of reasons to distrust it.
   */
  unsupportedRequiredExtensions: Array<string>
  /** Index into `scenes` of the file's default scene, when it names one. */
  defaultScene?: number
  scenes: Array<GltfScene>
  nodes: Array<GltfNode>
  meshes: Array<GltfMesh>
  /**
   * The file's materials, plus one appended default material at
   * `defaultMaterial`.
   */
  materials: Array<GltfMaterial>
  /**
   * Index of the appended glTF default material — what primitives with no
   * material of their own point at. It is always the last entry.
   */
  defaultMaterial: number
  textures: Array<GltfTexture>
  /**
   * The file's samplers, plus (when any texture needs it) one appended
   * default sampler; see `GltfSampler.isDefault`.
   */
  samplers: Array<GltfSampler>
  animations: Array<GltfAnimation>
  skins: Array<GltfSkin>
  cameras: Array<GltfCamera>
  /** `KHR_lights_punctual` lights, referenced by `GltfNode.light`. */
  lights: Array<GltfLight>
  /** `KHR_materials_variants` variant names, in index order. */
  variants: Array<string>
  /** Raw JSON of any document-level extension this importer does not model. */
  extensions?: string
  /** Raw JSON of the document's `asset.extras`. */
  extras?: string
}

/**
 * A glTF vertex attribute's meaning. The `_n` suffixed sets are the ones glTF
 * allows more than one of; `Custom` covers application-specific `_UNDERSCORE`
 * attributes, whose exact spelling is on `GltfVertexAttribute.name`.
 *
 * Sets above the ones named here (`TEXCOORD_4`, say) are reported as `Custom`
 * with the real name and `set` filled in, so nothing is silently dropped.
 */
export declare enum GltfAttributeSemantic {
  Position = 0,
  Normal = 1,
  Tangent = 2,
  TexCoord = 3,
  Color = 4,
  Joints = 5,
  Weights = 6,
  /**
   * An application-specific `_FOO` attribute, or a set index beyond the ones
   * this importer canonicalises.
   */
  Custom = 7
}

export interface GltfCamera {
  name?: string
  kind: GltfCameraKind
  /** Set when `kind` is `Perspective`. */
  perspective?: GltfPerspective
  /** Set when `kind` is `Orthographic`. */
  orthographic?: GltfOrthographic
  extras?: string
}

/** glTF `camera.type`. */
export declare enum GltfCameraKind {
  Perspective = 0,
  Orthographic = 1
}

/** `KHR_materials_clearcoat`. */
export interface GltfClearcoat {
  factor: number
  texture?: GltfTextureRef
  roughnessFactor: number
  roughnessTexture?: GltfTextureRef
  normalTexture?: GltfNormalTextureRef
}

/**
 * glTF `accessor.componentType`, reported so a caller can tell what the source
 * asset actually stored before this importer canonicalised it.
 */
export declare enum GltfComponentType {
  I8 = 0,
  U8 = 1,
  I16 = 2,
  U16 = 3,
  U32 = 4,
  F32 = 5
}

/** Object counts, so a caller can size its own arrays before loading. */
export interface GltfCounts {
  scenes: number
  nodes: number
  meshes: number
  primitives: number
  materials: number
  textures: number
  images: number
  samplers: number
  animations: number
  skins: number
  cameras: number
  lights: number
}

/**
 * The container an image's bytes are in. Decides which loader handles it:
 * `Ktx2` goes to the block-compressed path (`KHR_texture_basisu`), everything
 * else to the pixel decoder.
 */
export declare enum GltfImageEncoding {
  Png = 0,
  Jpeg = 1,
  /** `EXT_texture_webp`, or a plain `image/webp` source. */
  WebP = 2,
  /**
   * `KHR_texture_basisu`. Must carry pre-compressed BC blocks — see
   * `image/compressed.rs` for why there is no Basis transcoder.
   */
  Ktx2 = 3,
  /**
   * Radiance HDR. Not a core glTF image type, but this loader decodes it, so
   * it is reported rather than refused.
   */
  Hdr = 4,
  /**
   * No `mimeType` and no recognised signature. Still attempted — the decoder
   * sniffs magic bytes of its own.
   */
  Unknown = 5
}

/**
 * Index buffer element width. glTF also permits `UNSIGNED_BYTE`; WebGPU does
 * not, so byte indices are widened to `Uint16` during import.
 */
export declare enum GltfIndexFormat {
  Uint16 = 0,
  Uint32 = 1
}

/**
 * glTF `animation.sampler.interpolation`.
 *
 * `CubicSpline` is the one that changes the *shape* of the output data: each
 * keyframe carries three values (in-tangent, value, out-tangent) rather than
 * one, so `GltfAnimationSampler.output` is three times as long. That is
 * reported explicitly on the sampler rather than left to be inferred.
 */
export declare enum GltfInterpolation {
  Linear = 0,
  Step = 1,
  CubicSpline = 2
}

/** `KHR_materials_iridescence`. */
export interface GltfIridescence {
  factor: number
  texture?: GltfTextureRef
  ior: number
  /** Nanometres. */
  thicknessMinimum: number
  /** Nanometres. */
  thicknessMaximum: number
  /** Green channel selects between minimum and maximum thickness. */
  thicknessTexture?: GltfTextureRef
}

/**
 * A `KHR_lights_punctual` light. Note glTF's photometric units: point and spot
 * intensity is in candela (lm/sr), directional is in lux (lm/m²) — they are
 * **not** the same scale, which is why `kind` has to be consulted before the
 * value is used.
 */
export interface GltfLight {
  name?: string
  kind: GltfLightKind
  /** Linear RGB, nominally in `[0, 1]`. */
  color: Array<number>
  intensity: number
  /** `null` means unlimited. Ignored for directional lights. */
  range?: number
  /** Spot only, radians. Defaults to 0. */
  innerConeAngle: number
  /** Spot only, radians. Defaults to π/4. */
  outerConeAngle: number
  extras?: string
}

/** `KHR_lights_punctual` light type. */
export declare enum GltfLightKind {
  Directional = 0,
  Point = 1,
  Spot = 2
}

export interface GltfLoadOptions {
  /**
   * Prefix for the debug labels put on every created buffer, texture and
   * sampler. Defaults to the file's name.
   */
  label?: string
  /**
   * Directory that relative URIs resolve against. Defaults to the directory
   * the glTF file is in, which is what the spec means by "relative to the
   * glTF asset".
   */
  baseDirectory?: string
  /**
   * Redirect or replace individual buffers and images. See
   * [`GltfResourceOverride`]; use `inspectGltf` to learn the URIs first.
   */
  resourceOverrides?: Array<GltfResourceOverride>
  /** Override the sRGB/linear decision per texture. */
  textureColorSpaces?: Array<GltfTextureColorSpace>
  /**
   * Extra `GPUBufferUsage` bits OR'd into every vertex buffer, on top of
   * `VERTEX | COPY_DST`. Pass `STORAGE` to run compute over the geometry.
   */
  extraVertexBufferUsage?: number
  /**
   * Extra `GPUBufferUsage` bits for index buffers, on top of
   * `INDEX | COPY_DST`.
   */
  extraIndexBufferUsage?: number
  /**
   * `GPUTextureUsage` bitmask for created textures. Defaults to
   * `TEXTURE_BINDING | COPY_DST`.
   */
  textureUsage?: number
  /**
   * Skip image decoding and texture creation entirely — every
   * `GltfTexture.texture` comes back `null`. Useful for loading a scene
   * graph without paying for its textures.
   */
  loadImages?: boolean
  /**
   * `maxAnisotropy` for created samplers. Defaults to 1. Silently clamped
   * back to 1 for samplers that are not fully linear-filtered, because wgpu
   * rejects that combination.
   */
  maxAnisotropy?: number
  /**
   * Rewrite `TRIANGLE_FAN` and `LINE_LOOP` primitives into index buffers
   * WebGPU can draw. Defaults to true; see [`primitive::GltfPrimitive`].
   */
  convertUnsupportedTopologies?: boolean
  /**
   * Whether every primitive gets the file's own attribute set (`Source`,
   * the default) or the fixed 48-byte position/normal/tangent/uv layout
   * (`Standard`). See [`GltfVertexLayoutMode`].
   */
  vertexLayout?: GltfVertexLayoutMode
  /**
   * Reject a file whose `extensionsRequired` names something unimplemented.
   * Defaults to true.
   */
  strictRequiredExtensions?: boolean
}

/** glTF sampler `magFilter`. */
export declare enum GltfMagFilter {
  Nearest = 0,
  Linear = 1
}

/**
 * What `inspectGltf` returns: everything about a glTF file that can be known
 * without reading a single byte of its binary payload.
 */
export interface GltfManifest {
  path: string
  /** Where relative URIs will resolve against. */
  baseDirectory: string
  /** True for `.glb` (a binary container), false for `.gltf` (plain JSON). */
  isBinary: boolean
  /** Byte length of the GLB binary chunk, or `null` for a `.gltf`. */
  binaryChunkLength?: number
  version: string
  minVersion?: string
  generator?: string
  copyright?: string
  extensionsUsed: Array<string>
  extensionsRequired: Array<string>
  /**
   * The subset of `extensionsRequired` this importer does not implement.
   * Non-empty means `loadGltf` will reject unless
   * `strictRequiredExtensions` is false.
   */
  unsupportedRequiredExtensions: Array<string>
  resources: Array<GltfResource>
  counts: GltfCounts
}

/**
 * One glTF material with every supported extension folded in and every spec
 * default applied.
 */
export interface GltfMaterial {
  name?: string
  alphaMode: GltfAlphaMode
  /** Only meaningful when `alphaMode` is `Mask`. Defaults to 0.5. */
  alphaCutoff: number
  doubleSided: boolean
  /** Linear RGBA. Multiplies `baseColorTexture` and any `COLOR_0` attribute. */
  baseColorFactor: Array<number>
  baseColorTexture?: GltfTextureRef
  metallicFactor: number
  roughnessFactor: number
  /**
   * Blue channel is metallic, green is roughness. (Red is unused by the core
   * spec and is where `KHR_materials_*` extensions sometimes stash data.)
   */
  metallicRoughnessTexture?: GltfTextureRef
  normalTexture?: GltfNormalTextureRef
  occlusionTexture?: GltfOcclusionTextureRef
  /** Linear RGB, before `emissiveStrength`. */
  emissiveFactor: Array<number>
  emissiveTexture?: GltfTextureRef
  /**
   * `KHR_materials_emissive_strength`. Defaults to 1; values above 1 are the
   * whole point of the extension and require an HDR pipeline to show.
   */
  emissiveStrength: number
  /** `KHR_materials_unlit`: shade as unlit base colour, ignoring lights. */
  unlit: boolean
  /**
   * `KHR_materials_ior`. Defaults to 1.5 (the value the core spec's
   * dielectric `f0` of 0.04 corresponds to).
   */
  ior: number
  /** `KHR_materials_dispersion`. Defaults to 0. */
  dispersion: number
  specular?: GltfSpecular
  transmission?: GltfTransmission
  volume?: GltfVolume
  clearcoat?: GltfClearcoat
  sheen?: GltfSheen
  anisotropy?: GltfAnisotropy
  iridescence?: GltfIridescence
  /**
   * Raw JSON of every extension on this material that the fields above do
   * **not** model — verbatim, so a caller can implement one without a Rust
   * change. `null` when there are none.
   */
  extensions?: string
  /** Raw JSON of the material's `extras`. `null` when absent. */
  extras?: string
}

export interface GltfMesh {
  name?: string
  /** Default morph target weights, overridden per node by `GltfNode.weights`. */
  weights: Array<number>
  primitives: Array<GltfPrimitive>
  extras?: string
}

/**
 * glTF sampler `minFilter`. The four mipmap modes collapse to a
 * (`minFilter`, `mipmapFilter`) pair on the created `GpuSampler`.
 */
export declare enum GltfMinFilter {
  Nearest = 0,
  Linear = 1,
  NearestMipmapNearest = 2,
  LinearMipmapNearest = 3,
  NearestMipmapLinear = 4,
  LinearMipmapLinear = 5
}

/**
 * One morph target's deltas, as its own vertex buffer.
 *
 * Locations continue on from the primitive's base layout rather than restarting
 * at 0, so a pipeline can bind the base buffer and its targets together without
 * them colliding.
 */
export interface GltfMorphTarget {
  name?: string
  buffer: GpuBuffer
  layout: GltfVertexLayout
}

export interface GltfNode {
  name?: string
  /** Indices into `GltfAsset.nodes`. */
  children: Array<number>
  /** Index into `GltfAsset.meshes`. */
  mesh?: number
  /** Index into `GltfAsset.skins`. Only valid together with `mesh`. */
  skin?: number
  /** Index into `GltfAsset.cameras`. */
  camera?: number
  /** Index into `GltfAsset.lights` (`KHR_lights_punctual`). */
  light?: number
  /** Column-major 4x4, ready for a uniform buffer. */
  matrix: Array<number>
  translation: Array<number>
  /** Quaternion as `[x, y, z, w]` — glTF's order, not `[w, x, y, z]`. */
  rotation: Array<number>
  scale: Array<number>
  /**
   * True when the file wrote a `matrix`; false when it wrote TRS (or
   * nothing, in which case both forms are the identity).
   */
  hasMatrix: boolean
  /** Morph target weights overriding the mesh's own, when present. */
  weights: Array<number>
  extras?: string
}

/** The normal-map slot: a texture reference plus its `scale`. */
export interface GltfNormalTextureRef {
  index: number
  texCoord: number
  /** Multiplies the sampled X and Y before the normal is reconstructed. */
  scale: number
  transform?: GltfTextureTransform
}

/** The occlusion slot: a texture reference plus its `strength`. */
export interface GltfOcclusionTextureRef {
  index: number
  texCoord: number
  strength: number
  transform?: GltfTextureTransform
}

export interface GltfOrthographic {
  xmag: number
  ymag: number
  znear: number
  zfar: number
}

export interface GltfPerspective {
  /**
   * `null` means "use the viewport's aspect ratio" — the spec's wording, and
   * not something this importer can resolve for the caller.
   */
  aspectRatio?: number
  /** Vertical field of view, radians. */
  yfov: number
  znear: number
  /** `null` means an infinite projection. */
  zfar?: number
}

/**
 * One drawable primitive: an interleaved vertex buffer, an optional index
 * buffer, and everything needed to build a pipeline for them.
 */
export interface GltfPrimitive {
  /**
   * What the file said. `LineLoop` and `TriangleFan` have no WebGPU
   * equivalent — see `gpuTopology`.
   */
  mode: GltfPrimitiveMode
  /**
   * The topology to build the pipeline with. Differs from `mode` when the
   * indices were rewritten (fan → `triangle-list`, loop → `line-strip`), and
   * is `null` only if that rewrite was disabled via
   * `convertUnsupportedTopologies: false`.
   */
  gpuTopology?: GPUPrimitiveTopology | null
  /**
   * Index into `GltfAsset.materials`. Always valid: a primitive with no
   * material in the file points at `GltfAsset.defaultMaterial`.
   */
  material: number
  vertexCount: number
  vertexBuffer: GpuBuffer
  layout: GltfVertexLayout
  /** `null` for a non-indexed primitive; draw with `draw(vertexCount)`. */
  indexBuffer?: GpuBuffer
  /** 0 when `indexBuffer` is null. */
  indexCount: number
  indexFormat: GltfIndexFormat
  /**
   * The POSITION accessor's `min`, when the file declares one — a
   * ready-made object-space AABB corner. `null` if absent.
   */
  min?: Array<number>
  /** The POSITION accessor's `max`. */
  max?: Array<number>
  morphTargets: Array<GltfMorphTarget>
  extras?: string
}

/**
 * glTF `mesh.primitive.mode`, faithfully. Note two of these have **no WebGPU
 * equivalent** (`LineLoop`, `TriangleFan`); see `GltfPrimitive.gpuTopology`.
 */
export declare enum GltfPrimitiveMode {
  Points = 0,
  Lines = 1,
  LineLoop = 2,
  LineStrip = 3,
  Triangles = 4,
  TriangleStrip = 5,
  TriangleFan = 6
}

/** One external or embedded resource, as listed by `inspectGltf`. */
export interface GltfResource {
  kind: GltfResourceKind
  /**
   * Index within `buffers` or `images` — the value a `resourceOverride`
   * matches on.
   */
  index: number
  name?: string
  source: GltfResourceSource
  /**
   * The URI exactly as written in the file: not percent-decoded, not
   * resolved. This is the string a `resourceOverride` matches on. A `data:`
   * URI is truncated here — it can be megabytes — so match those by index.
   */
  uri?: string
  /** The absolute path the loader will read, for `External` resources only. */
  resolvedPath?: string
  /** The file's declared `mimeType`, when it declares one. */
  mimeType?: string
  /**
   * Declared `byteLength` for buffers, or the length of the `bufferView` for
   * an embedded image. `null` when the file does not say.
   */
  byteLength?: number
}

/**
 * What a resource listed in a `GltfManifest` actually is. The two kinds live in
 * separate index spaces — a `Buffer` index indexes `buffers`, an `Image` index
 * indexes `images` — which is why an override has to name both.
 */
export declare enum GltfResourceKind {
  /** A `buffers[i]` entry: raw binary backing accessors and buffer views. */
  Buffer = 0,
  /** An `images[i]` entry: the encoded bytes of a texture. */
  Image = 1
}

/**
 * A caller-supplied substitution for one resource.
 *
 * Matched by `index` (within its `kind`) or by the exact `uri` as it appears in
 * the file. Exactly one of `path`, `bytes` or `skip` says what to do.
 *
 * `bytes` is the one place in this package where a byte array crosses the napi
 * boundary inbound, and it is a considered exception: the whole point of the
 * hook is to let JS supply data the filesystem does not have (an archive
 * member, a decrypted blob, a procedurally generated buffer). It is opt-in and
 * per-resource, so the default path still reads files only.
 */
export interface GltfResourceOverride {
  /**
   * Which index space `index` refers to. Required even when matching by URI,
   * because buffers and images can name the same URI.
   */
  kind: GltfResourceKind
  /** Match `buffers[index]` / `images[index]`. Mutually exclusive with `uri`. */
  index?: number
  /**
   * Match the resource whose `uri` is exactly this string, as written in the
   * file (not percent-decoded, not resolved). Mutually exclusive with `index`.
   */
  uri?: string
  /**
   * Read this filesystem path instead. Relative paths resolve against the
   * process working directory, not the glTF base directory — an override is
   * the caller's own path, not the asset's.
   */
  path?: string
  /** Use these bytes instead. Copied on the JS thread before the load starts. */
  bytes?: Uint8Array
  /**
   * Drop the resource. For an image this yields a `GltfTexture` with a `null`
   * `texture`; for a buffer it is an error, since accessors would dangle.
   */
  skip?: boolean
}

/**
 * Where a resource's bytes come from, which is what decides whether an
 * override can usefully redirect it.
 */
export declare enum GltfResourceSource {
  /**
   * A relative or absolute URI resolved against the base directory — the
   * sidecar case, and the only one with a `resolvedPath`.
   */
  External = 0,
  /** An RFC 2397 `data:` URI embedded in the JSON. */
  DataUri = 1,
  /**
   * The GLB binary chunk (a `buffers[0]` with no `uri`, or an image whose
   * `bufferView` points into it).
   */
  BinaryChunk = 2,
  /** An image stored in a `bufferView` of some other buffer. */
  BufferView = 3
}

/** A glTF sampler and the `GpuSampler` created from it. */
export interface GltfSampler {
  name?: string
  sampler: GpuSampler
  magFilter: GltfMagFilter
  minFilter: GltfMinFilter
  wrapS: GltfWrapMode
  wrapT: GltfWrapMode
  /**
   * True for the sampler this importer appends for textures that declare
   * none. glTF leaves that case to the implementation; the defaults chosen
   * are `repeat`/`repeat` with trilinear filtering, which is what every other
   * viewer does.
   */
  isDefault: boolean
}

export interface GltfScene {
  name?: string
  /** Indices into `GltfAsset.nodes` — the roots of this scene. */
  nodes: Array<number>
  extras?: string
}

/** `KHR_materials_sheen`. */
export interface GltfSheen {
  colorFactor: Array<number>
  colorTexture?: GltfTextureRef
  roughnessFactor: number
  roughnessTexture?: GltfTextureRef
}

export interface GltfSkin {
  name?: string
  /**
   * Indices into `GltfAsset.nodes`, in joint order — the order the shader's
   * joint matrix array must be built in.
   */
  joints: Array<number>
  /** The common root of the joints, when the file names one. */
  skeleton?: number
  /**
   * 16 floats per joint, column-major, in `joints` order. `null` when the
   * file omits them, which the spec says means identity for every joint.
   */
  inverseBindMatrices?: Float32Array
  extras?: string
}

/** `KHR_materials_specular`. */
export interface GltfSpecular {
  factor: number
  /** Linear RGB. */
  colorFactor: Array<number>
  /** Alpha channel scales `factor`. */
  texture?: GltfTextureRef
  /** RGB scales `colorFactor`. */
  colorTexture?: GltfTextureRef
}

/** A glTF texture: the sampler/image pair, plus the GPU texture it produced. */
export interface GltfTexture {
  name?: string
  /**
   * The uploaded texture. `null` when the image was skipped by a
   * `resourceOverride` or when `loadImages` was false.
   */
  texture?: GpuTexture
  /**
   * Index into `GltfAsset.samplers`. Always set — a texture with no sampler
   * in the file points at the appended default one.
   */
  sampler: number
  /**
   * Index into the file's `images` array, for correlating with
   * `GltfManifest.resources`.
   */
  source?: number
  /**
   * How the pixels were interpreted. See the module docs for how this is
   * decided.
   */
  colorSpace: ImageColorSpace
  encoding: GltfImageEncoding
  /**
   * Raw JSON of any extension on the `textures[i]` entry (for example
   * `KHR_texture_basisu`), verbatim.
   */
  extensions?: string
}

/**
 * Force a specific colour space on one texture, overriding the inference
 * described in [`texture`].
 */
export interface GltfTextureColorSpace {
  /** Index into the file's `textures` array. */
  texture: number
  colorSpace: ImageColorSpace
}

/**
 * A reference from a material slot to `textures[index]`, plus the UV set it
 * samples and any `KHR_texture_transform` applied to it.
 */
export interface GltfTextureRef {
  /** Index into `GltfAsset.textures`. */
  index: number
  /** Which `TEXCOORD_n` attribute this slot samples. */
  texCoord: number
  /**
   * `KHR_texture_transform`, when present. Note its own `texCoord` (if set)
   * **overrides** the one above — that is the extension's rule, and it is
   * left as written rather than pre-applied so a caller can tell them apart.
   */
  transform?: GltfTextureTransform
}

/** `KHR_texture_transform`: a 2D affine transform applied to UVs before sampling. */
export interface GltfTextureTransform {
  /** `[u, v]`. */
  offset: Array<number>
  /** Counter-clockwise radians. */
  rotation: number
  /** `[u, v]`. */
  scale: Array<number>
  /** Overrides the slot's `texCoord` when present. */
  texCoord?: number
}

/** `KHR_materials_transmission`. */
export interface GltfTransmission {
  factor: number
  /** Red channel scales `factor`. */
  texture?: GltfTextureRef
}

/**
 * One attribute of an interleaved vertex buffer, in the exact shape
 * `GPUVertexBufferLayout.attributes` wants — plus what the source accessor
 * held before canonicalisation, so a caller can tell a quantised asset from a
 * float one.
 */
export interface GltfVertexAttribute {
  semantic: GltfAttributeSemantic
  /**
   * The glTF attribute name exactly as written: `POSITION`, `TEXCOORD_1`,
   * `_BATCHID`.
   */
  name: string
  /** Set index for `TEXCOORD_n` / `COLOR_n` / `JOINTS_n` / `WEIGHTS_n`. */
  set: number
  format: GPUVertexFormat
  offset: number
  shaderLocation: number
  /** The accessor's `componentType` before this importer converted it. */
  sourceComponentType: GltfComponentType
  /** The accessor's `type` before conversion. */
  sourceType: GltfAccessorType
  /**
   * The accessor's `normalized` flag. Already applied — the values in the
   * buffer are un-normalised floats when this is true and the destination
   * format is a float one.
   */
  sourceNormalized: boolean
}

/**
 * Feeds straight into `GPUVertexBufferLayout` (`stepMode` is always
 * `"vertex"`).
 */
export interface GltfVertexLayout {
  arrayStride: number
  attributes: Array<GltfVertexAttribute>
}

/** Which vertex layout an import produces. */
export declare enum GltfVertexLayoutMode {
  /**
   * Exactly the attributes the file has, at their canonical locations —
   * faithful, and a different `arrayStride` per primitive.
   */
  Source = 0,
  /**
   * **Always** `POSITION` (float32x3), `NORMAL` (float32x3), `TANGENT`
   * (float32x4), `TEXCOORD_0` (float32x2) at locations 0-3, `arrayStride`
   * 48 — for a renderer that wants one pipeline for every mesh.
   *
   * This is lossy in both directions and deliberately so: missing
   * attributes are **synthesised**, and every other attribute (`COLOR_0`,
   * joints, weights, custom `_FOO`) is **dropped**. Use `Source` if any of
   * that matters.
   */
  Standard = 1
}

/** `KHR_materials_volume`. Only meaningful together with transmission. */
export interface GltfVolume {
  thicknessFactor: number
  /** Green channel scales `thicknessFactor`. */
  thicknessTexture?: GltfTextureRef
  /**
   * Distance at which the transmitted colour equals `attenuationColor`.
   * The spec's default is `+Infinity`; it is reported as `Infinity`, not as
   * a sentinel, so arithmetic on it behaves.
   */
  attenuationDistance: number
  attenuationColor: Array<number>
}

/**
 * glTF sampler `wrapS`/`wrapT`. Maps 1:1 onto `GPUAddressMode`, which is what
 * the created `GpuSampler` is configured with.
 */
export declare enum GltfWrapMode {
  ClampToEdge = 0,
  MirroredRepeat = 1,
  Repeat = 2
}

export interface GpuAdapterInfo {
  vendor: string
  architecture: string
  device: string
  description: string
  backendType: string
  deviceType: string
  isFallbackAdapter: boolean
  subgroupMinSize: number
  subgroupMaxSize: number
}

export interface GpuBindGroupDescriptor {
  label?: string
  layout: GpuBindGroupLayout
  entries: Array<GpuBindGroupEntry>
}

export interface GpuBindGroupEntry {
  binding: number
  buffer?: GpuBufferBinding
  sampler?: GpuSampler
  textureView?: GpuTextureView
}

export interface GpuBindGroupLayoutDescriptor {
  label?: string
  entries: Array<GpuBindGroupLayoutEntry>
}

export interface GpuBindGroupLayoutEntry {
  binding: number
  visibility: number
  buffer?: GpuBufferBindingLayout
  sampler?: GpuSamplerBindingLayout
  texture?: GpuTextureBindingLayout
  storageTexture?: GpuStorageTextureBindingLayout
}

export interface GpuBlendComponent {
  operation?: GPUBlendOperation
  srcFactor?: GPUBlendFactor
  dstFactor?: GPUBlendFactor
}

export interface GpuBlendState {
  color: GpuBlendComponent
  alpha: GpuBlendComponent
}

export interface GpuBufferBinding {
  buffer: GpuBuffer
  offset?: number
  size?: number
}

export interface GpuBufferBindingLayout {
  bindingType?: GPUBufferBindingType
  hasDynamicOffset?: boolean
  minBindingSize?: number
}

export interface GpuBufferDescriptor {
  label?: string
  size: number
  usage: number
  mappedAtCreation?: boolean
}

export declare enum GPUBufferUsage {
  MAP_READ = 1,
  MAP_WRITE = 2,
  COPY_SRC = 4,
  COPY_DST = 8,
  INDEX = 16,
  VERTEX = 32,
  UNIFORM = 64,
  STORAGE = 128,
  INDIRECT = 256,
  QUERY_RESOLVE = 512
}

export interface GpuColor {
  r: number
  g: number
  b: number
  a: number
}

export interface GpuColorTargetState {
  format: GPUTextureFormat
  blend?: GpuBlendState
  writeMask?: number
}

export declare enum GPUColorWrite {
  RED = 1,
  GREEN = 2,
  BLUE = 4,
  ALPHA = 8,
  ALL = 15
}

export interface GpuCommandEncoderDescriptor {
  label?: string
}

export interface GpuCompilationInfo {
  messages: Array<GpuCompilationMessage>
}

export interface GpuCompilationMessage {
  message: string
  type: GPUCompilationMessageType
  lineNum: number
  linePos: number
  offset: number
  length: number
}

export interface GpuComputePassDescriptor {
  label?: string
  timestampWrites?: GpuComputePassTimestampWrites
}

export interface GpuComputePassTimestampWrites {
  querySet: GpuQuerySet
  beginningOfPassWriteIndex?: number
  endOfPassWriteIndex?: number
}

export interface GpuComputePipelineDescriptor {
  label?: string
  layout: GpuPipelineLayout | 'auto'
  compute: GpuProgrammableStage
}

export interface GpuDepthStencilState {
  format: GPUTextureFormat
  depthWriteEnabled?: boolean
  depthCompare?: GPUCompareFunction
  stencilFront?: GpuStencilFaceState
  stencilBack?: GpuStencilFaceState
  stencilReadMask?: number
  stencilWriteMask?: number
  depthBias?: number
  depthBiasSlopeScale?: number
  depthBiasClamp?: number
}

export interface GpuDeviceDescriptor {
  label?: string
  requiredFeatures?: Array<GPUFeatureName | GPUNativeFeatureName>
  requiredLimits?: GpuRequiredLimits
  defaultQueue?: GpuQueueDescriptor
}

/** Payload delivered when `device.lost` resolves. */
export interface GpuDeviceLostInfo {
  reason: GPUDeviceLostReason
  message: string
}

/**
 * Returned by `device.popErrorScope()`. Mirrors the WebGPU `GPUError` base type
 * with an additional `type` discriminant in place of separate subclasses.
 */
export interface GpuError {
  type: GPUErrorFilter
  message: string
}

export interface GpuExtent3D {
  width: number
  height?: number
  depthOrArrayLayers?: number
}

export interface GpuFragmentState {
  module: GpuShaderModule
  entryPoint?: string
  targets: Array<GpuColorTargetState | undefined | null>
}

export interface GpuImageCopyBuffer {
  buffer: GpuBuffer
  offset?: number
  bytesPerRow?: number
  rowsPerImage?: number
}

export interface GpuImageCopyTexture {
  texture: GpuTexture
  mipLevel?: number
  origin?: GpuOrigin3D
  aspect?: GPUTextureAspect
}

export interface GpuImageDataLayout {
  offset?: number
  bytesPerRow?: number
  rowsPerImage?: number
}

export declare enum GPUMapMode {
  READ = 1,
  WRITE = 2
}

export interface GpuMultisampleState {
  count?: number
  mask?: number
  alphaToCoverageEnabled?: boolean
}

export interface GpuOrigin3D {
  x?: number
  y?: number
  z?: number
}

export interface GpuPipelineLayoutDescriptor {
  label?: string
  bindGroupLayouts: Array<GpuBindGroupLayout>
  immediateSize?: number
}

export interface GpuPrimitiveState {
  topology?: GPUPrimitiveTopology
  stripIndexFormat?: GPUIndexFormat
  frontFace?: GPUFrontFace
  cullMode?: GPUCullMode
  unclippedDepth?: boolean
}

export interface GpuProgrammableStage {
  module: GpuShaderModule
  entryPoint?: string
}

export interface GpuQuerySetDescriptor {
  label?: string
  type: GPUQueryType
  count: number
}

export interface GpuQueueDescriptor {
  label?: string
}

export interface GpuRenderBundleDescriptor {
  label?: string
}

export interface GpuRenderBundleEncoderDescriptor {
  label?: string
  /**
   * Formats of the colour attachments this bundle will be executed against.
   * Must match the render pass that executes it. `null` marks an unused slot.
   */
  colorFormats: Array<GPUTextureFormat | undefined | null>
  /** Format of the depth/stencil attachment, if the target pass has one. */
  depthStencilFormat?: GPUTextureFormat
  /** Sample count of the target pass. Defaults to 1. */
  sampleCount?: number
  /** Set when the executing pass's depth attachment is read-only. */
  depthReadOnly?: boolean
  /** Set when the executing pass's stencil attachment is read-only. */
  stencilReadOnly?: boolean
}

export interface GpuRenderPassColorAttachment {
  view: GpuTextureView
  resolveTarget?: GpuTextureView
  clearValue?: GpuColor
  loadOp: GPULoadOp
  storeOp: GPUStoreOp
  /**
   * Which z-slice of a 3D texture view this attachment renders into.
   * Required when `view` is a `"3d"` view, and must be omitted otherwise.
   */
  depthSlice?: number
}

export interface GpuRenderPassDepthStencilAttachment {
  view: GpuTextureView
  depthLoadOp?: GPULoadOp
  depthStoreOp?: GPUStoreOp
  depthClearValue?: number
  depthReadOnly?: boolean
  stencilLoadOp?: GPULoadOp
  stencilStoreOp?: GPUStoreOp
  stencilClearValue?: number
  stencilReadOnly?: boolean
}

export interface GpuRenderPassDescriptor {
  label?: string
  colorAttachments: Array<GpuRenderPassColorAttachment | undefined | null>
  depthStencilAttachment?: GpuRenderPassDepthStencilAttachment
  occlusionQuerySet?: GpuQuerySet
  timestampWrites?: GpuRenderPassTimestampWrites
  maxDrawCount?: number
}

export interface GpuRenderPassTimestampWrites {
  querySet: GpuQuerySet
  beginningOfPassWriteIndex?: number
  endOfPassWriteIndex?: number
}

export interface GpuRenderPipelineDescriptor {
  label?: string
  layout: GpuPipelineLayout | 'auto'
  vertex: GpuVertexState
  primitive?: GpuPrimitiveState
  depthStencil?: GpuDepthStencilState
  multisample?: GpuMultisampleState
  fragment?: GpuFragmentState
}

export interface GpuRequestAdapterOptions {
  powerPreference?: GPUPowerPreference
  forceFallbackAdapter?: boolean
  /**
   * Pin the wgpu instance to a specific graphics backend.
   * Accepted values: `"vulkan"`, `"dx12"`, `"metal"`, `"gl"`.
   * Omit (or pass `null`) to let wgpu pick from all available backends.
   */
  backend?: 'vulkan' | 'dx12' | 'metal' | 'gl'
}

export interface GpuRequiredLimits {
  maxTextureDimension1D?: number
  maxTextureDimension2D?: number
  maxTextureDimension3D?: number
  maxTextureArrayLayers?: number
  maxBindGroups?: number
  maxBindingsPerBindGroup?: number
  maxDynamicUniformBuffersPerPipelineLayout?: number
  maxDynamicStorageBuffersPerPipelineLayout?: number
  maxSampledTexturesPerShaderStage?: number
  maxSamplersPerShaderStage?: number
  maxStorageBuffersPerShaderStage?: number
  maxStorageTexturesPerShaderStage?: number
  maxUniformBuffersPerShaderStage?: number
  maxUniformBufferBindingSize?: number
  maxStorageBufferBindingSize?: number
  minUniformBufferOffsetAlignment?: number
  minStorageBufferOffsetAlignment?: number
  maxVertexBuffers?: number
  maxBufferSize?: number
  maxVertexAttributes?: number
  maxVertexBufferArrayStride?: number
  maxComputeWorkgroupStorageSize?: number
  maxComputeInvocationsPerWorkgroup?: number
  maxComputeWorkgroupSizeX?: number
  maxComputeWorkgroupSizeY?: number
  maxComputeWorkgroupSizeZ?: number
  maxComputeWorkgroupsPerDimension?: number
  /**
   * Bytes of immediate data a pipeline layout may declare (what earlier
   * versions of this API, and wgpu before 30, called push constants).
   * Defaults to **0**, so requesting the `immediates` feature without also
   * raising this yields a device that accepts no immediates at all — set both.
   */
  maxImmediateSize?: number
}

export interface GpuSamplerBindingLayout {
  samplerType?: GPUSamplerBindingType
}

export interface GpuSamplerDescriptor {
  label?: string
  addressModeU?: GPUAddressMode
  addressModeV?: GPUAddressMode
  addressModeW?: GPUAddressMode
  magFilter?: GPUFilterMode
  minFilter?: GPUFilterMode
  mipmapFilter?: GPUFilterMode
  lodMinClamp?: number
  lodMaxClamp?: number
  compare?: GPUCompareFunction
  maxAnisotropy?: number
}

export interface GpuShaderModuleDescriptor {
  label?: string
  /**
   * WGSL source. This binding takes WGSL only — there is no SPIR-V or GLSL
   * entry point.
   *
   * The spec's optional `sourceMap` / `compilationHints` may also be passed:
   * undeclared properties are ignored here, and `webgpu.d.ts` types them so
   * spec-shaped descriptors compile. Neither affects compilation — wgpu has
   * no use for either.
   */
  code: string
}

export declare enum GPUShaderStage {
  VERTEX = 1,
  FRAGMENT = 2,
  COMPUTE = 4
}

export interface GpuStencilFaceState {
  compare?: GPUCompareFunction
  failOp?: GPUStencilOperation
  depthFailOp?: GPUStencilOperation
  passOp?: GPUStencilOperation
}

export interface GpuStorageTextureBindingLayout {
  access?: GPUStorageTextureAccess
  format: string
  viewDimension?: GPUTextureViewDimension
}

export interface GpuSupportedLimits {
  maxTextureDimension1D: number
  maxTextureDimension2D: number
  maxTextureDimension3D: number
  maxTextureArrayLayers: number
  maxBindGroups: number
  maxBindGroupsPlusVertexBuffers: number
  maxBindingsPerBindGroup: number
  maxDynamicUniformBuffersPerPipelineLayout: number
  maxDynamicStorageBuffersPerPipelineLayout: number
  maxSampledTexturesPerShaderStage: number
  maxSamplersPerShaderStage: number
  maxStorageBuffersPerShaderStage: number
  maxStorageTexturesPerShaderStage: number
  maxUniformBuffersPerShaderStage: number
  maxUniformBufferBindingSize: number
  maxStorageBufferBindingSize: number
  minUniformBufferOffsetAlignment: number
  minStorageBufferOffsetAlignment: number
  maxVertexBuffers: number
  maxBufferSize: number
  maxVertexAttributes: number
  maxVertexBufferArrayStride: number
  maxInterStageShaderVariables: number
  maxColorAttachments: number
  maxColorAttachmentBytesPerSample: number
  maxComputeWorkgroupStorageSize: number
  maxComputeInvocationsPerWorkgroup: number
  maxComputeWorkgroupSizeX: number
  maxComputeWorkgroupSizeY: number
  maxComputeWorkgroupSizeZ: number
  maxComputeWorkgroupsPerDimension: number
  maxImmediateSize: number
  maxStorageBuffersInVertexStage: number
  maxStorageBuffersInFragmentStage: number
  maxStorageTexturesInVertexStage: number
  maxStorageTexturesInFragmentStage: number
}

export interface GpuTextureBindingLayout {
  sampleType?: GPUTextureSampleType
  viewDimension?: GPUTextureViewDimension
  multisampled?: boolean
}

export interface GpuTextureDescriptor {
  label?: string
  size: GpuExtent3D
  mipLevelCount?: number
  sampleCount?: number
  dimension?: GPUTextureDimension
  format: GPUTextureFormat
  usage: number
  viewFormats?: Array<string>
}

export declare enum GPUTextureUsage {
  COPY_SRC = 1,
  COPY_DST = 2,
  TEXTURE_BINDING = 4,
  STORAGE_BINDING = 8,
  RENDER_ATTACHMENT = 16,
  TRANSIENT_ATTACHMENT = 32
}

export interface GpuTextureViewDescriptor {
  label?: string
  format?: string
  dimension?: GPUTextureViewDimension
  aspect?: GPUTextureAspect
  baseMipLevel?: number
  mipLevelCount?: number
  baseArrayLayer?: number
  arrayLayerCount?: number
}

/** Event object passed to the `onuncapturederror` handler. */
export interface GpuUncapturedErrorEvent {
  error: GpuError
}

export interface GpuVertexAttribute {
  format: GPUVertexFormat
  offset: number
  shaderLocation: number
}

export interface GpuVertexBufferLayout {
  arrayStride: number
  stepMode?: GPUVertexStepMode
  attributes: Array<GpuVertexAttribute>
}

export interface GpuVertexState {
  module: GpuShaderModule
  entryPoint?: string
  buffers?: Array<GpuVertexBufferLayout | undefined | null>
}

/**
 * How the decoded pixels are interpreted when the GPU samples them — the
 * sRGB/linear split every PBR pipeline needs (colour maps are sRGB, data maps
 * like normal/roughness are linear; see metis-engine's `texture.ts`).
 *
 * **Ignored for floating-point source formats** (Radiance HDR): those carry
 * linear radiance by definition, so there is no sRGB transfer curve to undo and
 * no `-srgb` float texture format to request — an `.hdr` load always yields
 * `rgba16float` regardless of this option.
 *
 * KTX2 has no equivalent option — a `.ktx2` file states its own format, so
 * `loadKtx2Texture` reads the colour space out of the file rather than taking
 * it from the caller.
 */
export declare enum ImageColorSpace {
  /**
   * sRGB-encoded colour (albedo, emissive) — creates an `rgba8unorm-srgb`
   * texture, so the hardware linearises on sample.
   */
  Srgb = 0,
  /**
   * Raw linear data (normal, metallic, roughness, masks) — creates an
   * `rgba8unorm` texture with no sRGB decode.
   */
  Linear = 1
}

export interface ImageLoadOptions {
  /** Debug label applied to the created GPU texture. */
  label?: string
  /** Colour space of the source pixels. Defaults to `Srgb`. Ignored for HDR. */
  colorSpace?: ImageColorSpace
  /** `GpuTextureUsage` bitmask. Defaults to `TEXTURE_BINDING | COPY_DST`. */
  usage?: number
}

/**
 * Read an audio file's container header — format, rate, channels, duration —
 * without decoding it.
 */
export declare function inspectAudioFile(path: string, hint?: string | undefined | null): Promise<AudioFileInfo>

/**
 * Parse a `.gltf` or `.glb` and report what it contains and what it depends on
 * — **without reading any external file, decoding any image, or touching the
 * GPU.** No device is needed.
 *
 * This is the first half of the override workflow: the `resources` it lists
 * carry the exact `index` and `uri` values a `GltfResourceOverride` matches on,
 * so a caller can decide what to substitute before `loadGltf` reads anything.
 * It is also the cheap way to answer "does this asset need an extension I do
 * not support" (`unsupportedRequiredExtensions`) or "how big is this scene"
 * (`counts`).
 */
export declare function inspectGltf(path: string, baseDirectory?: string | undefined | null): Promise<GltfManifest>

export interface Ktx2LoadOptions {
  /** Debug label applied to the created GPU texture. */
  label?: string
  /** `GpuTextureUsage` bitmask. Defaults to `TEXTURE_BINDING | COPY_DST`. */
  usage?: number
}

/**
 * Decode an audio file into memory. Decoding runs on a worker thread.
 *
 * `ts_return_type` because napi cannot infer a `Task`'s `JsValue` — without it
 * the generated signature is `Promise<unknown>` and every caller has to cast.
 * Same reason, same fix as `loadGltf`/`loadImageTexture`.
 */
export declare function loadAudioClip(path: string, options?: AudioLoadOptions | undefined | null): Promise<AudioClip>

/**
 * Import a glTF 2.0 asset (`.gltf` or `.glb`) into GPU buffers, textures and
 * samplers, plus its whole scene graph as typed data — off the JS thread.
 *
 * Each primitive comes back as an **interleaved vertex buffer** with a
 * `layout` in the exact shape `GPUVertexBufferLayout` wants, an index buffer
 * (`Uint16`/`Uint32` — glTF's byte indices are widened, since WebGPU has no
 * 8-bit index format), and a `gpuTopology` string ready for
 * `createRenderPipeline`. Materials arrive with every spec default applied and
 * every supported `KHR_*` extension folded in; anything unrecognised is kept as
 * raw JSON rather than dropped.
 *
 * Texture colour space is inferred from which material slot each texture is
 * bound to (base colour and emissive are sRGB, normal/occlusion/metallic-
 * roughness are linear) and can be overridden per texture.
 *
 * Use `inspectGltf` first if you need to redirect the file's external
 * resources — it lists every buffer and image URI, which is what
 * `resourceOverrides` matches on.
 *
 * The promise rejects on a malformed file, a missing resource, a required
 * extension this importer does not implement, or a wgpu validation error
 * during upload.
 */
export declare function loadGltf(device: GpuDevice, path: string, options?: GltfLoadOptions | undefined | null): Promise<GltfAsset>

/**
 * Decode an image file (PNG, TGA, JPEG, Radiance HDR) straight into a
 * `GpuTexture` ready to bind, off the JS thread. The pixels never cross into JS.
 *
 * Decoding is pure Rust (the `image` crate) — see the module docs for why
 * SDL3_image was dropped.
 *
 * `path` is a filesystem path. The returned promise rejects with a decode error
 * string on failure. The resulting texture's `format` is `rgba8unorm(-srgb)`
 * for 8-bit sources and `rgba16float` for HDR — read it off the returned handle
 * rather than assuming. The result always has **one mip level**; for a
 * pre-built mip chain of GPU-compressed blocks, use `loadKtx2Texture`.
 */
export declare function loadImageTexture(device: GpuDevice, path: string, options?: ImageLoadOptions | undefined | null): Promise<GpuTexture>

/**
 * Load a **KTX2** file of GPU-block-compressed texture data (BC1-BC7),
 * including its full mip chain, straight into a `GpuTexture` — off the JS
 * thread, with no decoding step: the blocks in the file are the bytes the GPU
 * samples, so they stay compressed in VRAM (a 2K BC7 texture is 5.5 MB rather
 * than 16 MB).
 *
 * Unlike `loadImageTexture` there is no `colorSpace` option — the file states
 * its own format, and `BC7_SRGB_BLOCK` becomes `bc7-rgba-unorm-srgb`
 * accordingly. Read `format` and `mipLevelCount` off the returned handle.
 *
 * **Requires the `texture-compression-bc` device feature.** The returned
 * promise rejects with an actionable error if the device lacks it — there is
 * no software fallback, so ship an uncompressed asset for such devices. In
 * practice every desktop GPU on Windows and Linux supports BC.
 *
 * Zstandard supercompression is handled transparently. BasisLZ payloads are
 * rejected (they need a transcoder — see the module docs). Cubemaps, texture
 * arrays and 3D textures are rejected for now.
 */
export declare function loadKtx2Texture(device: GpuDevice, path: string, options?: Ktx2LoadOptions | undefined | null): Promise<GpuTexture>

export interface MouseRect {
  x: number
  y: number
  w: number
  h: number
}

export interface MouseState {
  /** Cursor X relative to the focused window. */
  x: number
  /** Cursor Y relative to the focused window. */
  y: number
  /** SDL_MouseButtonFlags bitmask — compare against `SdlMouseButtonMask` values. */
  buttons: number
}

/**
 * Read a texture back as **tight RGBA8 bytes** (GPU row padding stripped),
 * off the JS thread — for asserting on pixels without writing a file.
 *
 * The texture must have `GPUTextureUsage.COPY_SRC`. BGRA sources are swizzled
 * to RGBA. `rgba16float` is rejected: reinterpreting f16 bytes as 8-bit colour
 * is silently meaningless, so save it as `.hdr` instead.
 */
export declare function readTexturePixels(device: GpuDevice, texture: GpuTexture): Promise<Uint8Array>

/**
 * Top-level entry point. In a browser this would be `navigator.gpu.requestAdapter()`;
 * here we export it directly from the module.
 */
export declare function requestAdapter(options?: GpuRequestAdapterOptions | undefined | null): Promise<GpuAdapter | null>

/**
 * Like `requestAdapter`, but selects an adapter that is guaranteed to be
 * compatible with the given SDL3 window's rendering surface.
 *
 * This is the correct entry point for windowed rendering: requesting an
 * adapter without a surface hint may yield an adapter that cannot render to
 * the window at all.
 */
export declare function requestAdapterForWindow(window: SdlWindow, options?: GpuRequestAdapterOptions | undefined | null): Promise<GpuAdapter | null>

/**
 * Encode tight **RGBA8** bytes and write them to `path`, off the JS thread.
 * Encoding is chosen from the extension (`.hdr` is rejected — 8-bit input
 * carries no high-dynamic-range data). Parent directories are created as needed.
 *
 * Pair with `readTexturePixels` when a caller wants both the pixels and a
 * file from a single GPU readback.
 */
export declare function savePixelsToFile(pixels: Uint8Array, width: number, height: number, path: string): Promise<void>

/**
 * Read a texture back and write it to `path`, off the JS thread. The encoding
 * is chosen from the extension: `.png`, `.jpg`/`.jpeg`, `.tga`, `.hdr`.
 * Parent directories are created as needed.
 *
 * The texture must have been created with `GPUTextureUsage.COPY_SRC`.
 * `rgba8unorm(-srgb)` and `bgra8unorm(-srgb)` are both supported (BGRA is
 * swizzled), so a surface-format texture can be saved directly.
 * `rgba16float` may only be written as `.hdr`.
 */
export declare function saveTextureToFile(device: GpuDevice, texture: GpuTexture, path: string): Promise<void>

/**
 * Sample formats an `SdlAudioStream` can convert between.
 *
 * Native byte order only. SDL also defines big-endian variants of each; they
 * exist for reading foreign files, which is the decoder's job here, not the
 * audio device's — so exposing them would only offer a way to get the byte
 * order wrong on a desktop target.
 */
export declare enum SdlAudioFormat {
  /** Unsigned 8-bit. */
  U8 = 0,
  /** Signed 8-bit. */
  S8 = 1,
  /** Signed 16-bit, native order. What most hardware actually wants. */
  S16 = 2,
  /** Signed 32-bit, native order. */
  S32 = 3,
  /**
   * 32-bit float, native order. The mixer's format, and SDL's own internal
   * working format — picking it means SDL does no conversion at all.
   */
  F32 = 4
}

/**
 * An audio format description: what samples look like, how many channels, how
 * fast.
 */
export interface SdlAudioSpecJs {
  /** Defaults to `F32` when omitted. */
  format?: SdlAudioFormat
  /** Defaults to 2. */
  channels?: number
  /** Sample frames per second. Defaults to 48000. */
  freq?: number
}

/**
 * Enable mouse capture so the window receives mouse events even when the
 * cursor leaves it. Pass `false` to release.
 */
export declare function sdlCaptureMouse(enabled: boolean): void

/**
 * Create a standalone audio stream converting `src` to `dst`.
 *
 * Both specs default to f32 stereo 48 kHz. Identical specs mean SDL performs
 * no conversion, so what comes out is bit-identical to what went in.
 */
export declare function sdlCreateAudioStream(src?: SdlAudioSpecJs | undefined | null, dst?: SdlAudioSpecJs | undefined | null): SdlAudioStream

/** Create a system cursor from a `SdlSystemCursor` shape enum value. */
export declare function sdlCreateSystemCursor(shape: SdlSystemCursor): SdlCursor

/**
 * Create a window of `width` × `height` (logical pixels) with the given title.
 * `flags` is a bitmask of `SdlWindowFlag` values (e.g. `Resizable | Hidden`),
 * defaulting to none. Requires `sdlInit(SdlInitFlag.Video)` first.
 */
export declare function sdlCreateWindow(title: string, width: number, height: number, flags?: number | undefined | null): SdlWindow

/** Returns `true` if the cursor is currently visible. */
export declare function sdlCursorVisible(): boolean

export interface SdlEvent {
  type: SdlEventType
  /** Nanoseconds since SDL was initialised (SDL_GetTicksNS epoch). */
  timestamp: number
  windowId?: number
  displayId?: number
  /** For WINDOW_MOVED / WINDOW_RESIZED / DISPLAY_ORIENTATION — first value. */
  data1?: number
  /** For WINDOW_MOVED / WINDOW_RESIZED — second value. */
  data2?: number
  scancode?: SdlScancode
  keycode?: SdlKeycode
  /** Keyboard modifier bitmask — AND with `SdlKeymod` values. */
  keyMod?: number
  keyRepeat?: boolean
  text?: string
  /** Source app for DROP events (may be null → None). */
  textSource?: string
  mouseX?: number
  mouseY?: number
  mouseXrel?: number
  mouseYrel?: number
  mouseButton?: SdlMouseButton
  mouseClicks?: number
  /** Button-mask for MOUSE_MOTION (SDL_MouseButtonFlags) — AND with `SdlMouseButtonMask` values. */
  mouseButtons?: number
  which?: number
  /** Joystick axis index (device-specific raw index). */
  axis?: number
  /** Axis value normalised to -1.0 .. 1.0. */
  axisValue?: number
  /** Hat index. */
  hat?: number
  hatValue?: SdlJoyHat
  /** Joystick button index (device-specific raw index). */
  button?: number
  /** Joystick trackball relative X motion. */
  ballXrel?: number
  /** Joystick trackball relative Y motion. */
  ballYrel?: number
  batteryState?: SdlPowerState
  batteryPercent?: number
  gamepadAxis?: SdlGamepadAxis
  gamepadButton?: SdlGamepadButton
  touchpad?: number
  finger?: number
  touchpadX?: number
  touchpadY?: number
  touchpadPressure?: number
  sensorType?: SdlSensorType
  /** Up to 3 sensor floats (accelerometer / gyro / etc.). */
  sensorData?: Array<number>
  touchId?: number
  fingerId?: number
  touchX?: number
  touchY?: number
  touchDx?: number
  touchDy?: number
  touchPressure?: number
  dropX?: number
  dropY?: number
  audioDeviceId?: number
  audioRecording?: boolean
}

export declare enum SdlEventType {
  Quit = 256,
  Terminating = 257,
  LowMemory = 258,
  WillEnterBackground = 259,
  DidEnterBackground = 260,
  WillEnterForeground = 261,
  DidEnterForeground = 262,
  LocaleChanged = 263,
  DisplayOrientation = 337,
  DisplayAdded = 338,
  DisplayRemoved = 339,
  DisplayMoved = 340,
  DisplayCurrentModeChanged = 342,
  DisplayContentScaleChanged = 343,
  WindowShown = 514,
  WindowHidden = 515,
  WindowExposed = 516,
  WindowMoved = 517,
  WindowResized = 518,
  WindowPixelSizeChanged = 519,
  WindowMinimized = 521,
  WindowMaximized = 522,
  WindowRestored = 523,
  WindowMouseEnter = 524,
  WindowMouseLeave = 525,
  WindowFocusGained = 526,
  WindowFocusLost = 527,
  WindowCloseRequested = 528,
  WindowDisplayChanged = 531,
  WindowDisplayScaleChanged = 532,
  WindowOccluded = 534,
  WindowEnterFullscreen = 535,
  WindowLeaveFullscreen = 536,
  WindowDestroyed = 537,
  WindowHdrStateChanged = 538,
  KeyDown = 768,
  KeyUp = 769,
  TextEditing = 770,
  TextInput = 771,
  KeymapChanged = 772,
  KeyboardAdded = 773,
  KeyboardRemoved = 774,
  MouseMotion = 1024,
  MouseButtonDown = 1025,
  MouseButtonUp = 1026,
  MouseWheel = 1027,
  MouseAdded = 1028,
  MouseRemoved = 1029,
  JoystickAxisMotion = 1536,
  JoystickBallMotion = 1537,
  JoystickHatMotion = 1538,
  JoystickButtonDown = 1539,
  JoystickButtonUp = 1540,
  JoystickAdded = 1541,
  JoystickRemoved = 1542,
  JoystickBatteryUpdated = 1543,
  JoystickUpdateComplete = 1544,
  GamepadAxisMotion = 1616,
  GamepadButtonDown = 1617,
  GamepadButtonUp = 1618,
  GamepadAdded = 1619,
  GamepadRemoved = 1620,
  GamepadRemapped = 1621,
  GamepadTouchpadDown = 1622,
  GamepadTouchpadMotion = 1623,
  GamepadTouchpadUp = 1624,
  GamepadSensorUpdate = 1625,
  GamepadUpdateComplete = 1626,
  FingerDown = 1792,
  FingerUp = 1793,
  FingerMotion = 1794,
  FingerCanceled = 1795,
  ClipboardUpdate = 2304,
  DropFile = 4096,
  DropText = 4097,
  DropBegin = 4098,
  DropComplete = 4099,
  DropPosition = 4100,
  AudioDeviceAdded = 4352,
  AudioDeviceRemoved = 4353,
  AudioDeviceFormatChanged = 4354,
  SensorUpdate = 4608,
  RenderTargetsReset = 8192,
  RenderDeviceReset = 8193,
  RenderDeviceLost = 8194
}

/**
 * Gamepad axis indices for `SdlGamepad.getAxis()`.
 * Sticks range -1..1; triggers (`LeftTrigger`, `RightTrigger`) range 0..1.
 */
export declare enum SdlGamepadAxis {
  Invalid = -1,
  LeftX = 0,
  LeftY = 1,
  RightX = 2,
  RightY = 3,
  LeftTrigger = 4,
  RightTrigger = 5
}

/**
 * Gamepad button indices for `SdlGamepad.getButton()`.
 * Face buttons use compass directions: `South` = A on Xbox, cross on PS.
 */
export declare enum SdlGamepadButton {
  Invalid = -1,
  South = 0,
  East = 1,
  West = 2,
  North = 3,
  Back = 4,
  Guide = 5,
  Start = 6,
  LeftStick = 7,
  RightStick = 8,
  LeftShoulder = 9,
  RightShoulder = 10,
  DpadUp = 11,
  DpadDown = 12,
  DpadLeft = 13,
  DpadRight = 14,
  Misc1 = 15,
  Touchpad = 20
}

/** Returns `true` if gamepad events are currently delivered to the event queue. */
export declare function sdlGamepadEventsEnabled(): boolean

/**
 * Every audio driver this SDL build was compiled with, e.g.
 * `["wasapi", "directsound", "disk", "dummy"]`.
 *
 * Set one before `sdlInit` with `sdlSetHint("SDL_AUDIO_DRIVER", name)`.
 */
export declare function sdlGetAudioDrivers(): Array<string>

/** Playback (output) devices. Requires `sdlInit(SdlInitFlag.Audio)`. */
export declare function sdlGetAudioPlaybackDevices(): Array<AudioDeviceInfo>

/**
 * Recording (input) devices. Enumeration only — this package does not capture
 * audio yet.
 */
export declare function sdlGetAudioRecordingDevices(): Array<AudioDeviceInfo>

/**
 * The driver actually in use, or `null` before the audio subsystem is
 * initialised.
 */
export declare function sdlGetCurrentAudioDriver(): string | null

/** Get the currently active cursor (not owned — do not call `.destroy()` on it). */
export declare function sdlGetCursor(): SdlCursor | null

/** Get the default system cursor. */
export declare function sdlGetDefaultCursor(): SdlCursor | null

/** Return the last SDL error string (empty string if none). */
export declare function sdlGetError(): string

/** Human-readable name (without opening the device). */
export declare function sdlGetGamepadNameForId(instanceId: number): string

/** Instance IDs of all connected gamepads. */
export declare function sdlGetGamepads(): Array<number>

/** Gamepad type string (without opening). E.g. `"XBOX360"`, `"PS4"`, `"UNKNOWN"`. */
export declare function sdlGetGamepadTypeForId(instanceId: number): string

/** Global desktop cursor position. */
export declare function sdlGetGlobalMouseState(): MouseState

/** Query the current value of an SDL hint. Returns `null` if the hint is unset. */
export declare function sdlGetHint(name: string): string | null

/** Human-readable name for a joystick instance (before opening it). */
export declare function sdlGetJoystickNameForId(instanceId: number): string

/**
 * Instance IDs of all currently connected joysticks.
 * Pass an ID to `sdlOpenJoystick()` to get an `SdlJoystick`.
 */
export declare function sdlGetJoysticks(): Array<number>

/**
 * Joystick type string for an instance (before opening it).
 * Returns e.g. `"GAMEPAD"`, `"WHEEL"`, `"FLIGHT_STICK"`, `"UNKNOWN"`.
 */
export declare function sdlGetJoystickTypeForId(instanceId: number): string

/**
 * Returns a handle to SDL's internal keyboard-state array.
 *
 * The array is updated automatically on every `sdlPollEvents()` /
 * `sdlPumpEvents()` call — call this function **once** and reuse the handle.
 */
export declare function sdlGetKeyboardState(): SdlKeyboardState

/** Keycode from name string (inverse of `sdlGetKeyName`). Returns `Unknown` on failure. */
export declare function sdlGetKeyFromName(name: string): SdlKeycode

/**
 * Convert a scancode to the corresponding keycode (layout-dependent).
 * Returns `Unknown` if the result is not a recognised keycode variant.
 */
export declare function sdlGetKeyFromScancode(scancode: SdlScancode, modState?: number | undefined | null, keyEvent?: boolean | undefined | null): SdlKeycode

/** Human-readable name for a keycode (e.g. "A", "Return", "Escape"). */
export declare function sdlGetKeyName(keycode: SdlKeycode): string

/**
 * Current keyboard modifier state (SDL_Keymod bit-mask).
 * Compare against `SdlKeymod` values: `if (sdlGetModState() & SdlKeymod.Shift) { ... }`.
 */
export declare function sdlGetModState(): number

/**
 * Current mouse position relative to the focused window, plus button mask.
 * State is updated when events are polled.
 */
export declare function sdlGetMouseState(): MouseState

/**
 * High-resolution performance counter value.
 * Use together with `sdlGetPerformanceFrequency()` to compute elapsed seconds:
 * ```
 * const t0 = sdlGetPerformanceCounter()
 * // ...
 * const dt = (sdlGetPerformanceCounter() - t0) / sdlGetPerformanceFrequency()
 * ```
 */
export declare function sdlGetPerformanceCounter(): number

/** Counter ticks per second for `sdlGetPerformanceCounter()`. */
export declare function sdlGetPerformanceFrequency(): number

/** Returns `true` if relative mouse mode is enabled for `window`. */
export declare function sdlGetRelativeMouseMode(window: SdlWindow): boolean

/** Relative mouse motion since the last call. Does not move the cursor. */
export declare function sdlGetRelativeMouseState(): MouseState

/**
 * Convert a keycode back to the scancode that would produce it.
 * Returns `Unknown` if the result is not a recognised scancode variant.
 */
export declare function sdlGetScancodeFromKey(keycode: SdlKeycode): SdlScancode

/** Scancode from name string. Returns `Unknown` on failure. */
export declare function sdlGetScancodeFromName(name: string): SdlScancode

/** Human-readable name for a scancode (e.g. "A", "Left", "F1"). */
export declare function sdlGetScancodeName(scancode: SdlScancode): string

/**
 * Milliseconds elapsed since SDL was initialised (wraps after ~49 days).
 * Suitable for frame delta-time and coarse profiling.
 */
export declare function sdlGetTicks(): number

/** Returns `true` if any gamepad is connected. */
export declare function sdlHasGamepad(): boolean

/** Returns `true` if at least one joystick is connected. */
export declare function sdlHasJoystick(): boolean

/** Hide the mouse cursor. */
export declare function sdlHideCursor(): void

/** Initialize SDL subsystems. `flags` is a bitmask of `SdlInitFlag` values. */
export declare function sdlInit(flags: number): void

/** SDL subsystem init flags. OR together the flags you need and pass to `sdlInit`. */
export declare enum SdlInitFlag {
  Audio = 16,
  Video = 32,
  Joystick = 512,
  Haptic = 4096,
  Gamepad = 8192,
  Events = 16384,
  Sensor = 32768,
  Camera = 65536
}

/** Returns `true` if the given joystick instance is a recognised gamepad. */
export declare function sdlIsGamepad(instanceId: number): boolean

/**
 * Joystick hat (D-pad) position. SDL pre-enumerates all diagonal combinations,
 * so every valid hat value maps to exactly one variant.
 */
export declare enum SdlJoyHat {
  Centered = 0,
  Up = 1,
  Right = 2,
  Down = 4,
  Left = 8,
  RightUp = 3,
  RightDown = 6,
  LeftUp = 9,
  LeftDown = 12
}

/** Returns `true` if joystick events are currently delivered to the event queue. */
export declare function sdlJoystickEventsEnabled(): boolean

/**
 * Virtual key identifiers (layout-dependent, Unicode codepoints for printable
 * keys; extended keys have the scancode-mask bit 0x40000000 set).
 * Letters use their **lowercase** codepoint: `SdlKeycode::A = 97` ('a').
 * Compare against `SdlEvent.keycode`.
 */
export declare enum SdlKeycode {
  Unknown = 0,
  Backspace = 8,
  Tab = 9,
  Return = 13,
  Escape = 27,
  Space = 32,
  Exclaim = 33,
  DblApostrophe = 34,
  Hash = 35,
  Dollar = 36,
  Percent = 37,
  Ampersand = 38,
  Apostrophe = 39,
  LeftParen = 40,
  RightParen = 41,
  Asterisk = 42,
  Plus = 43,
  Comma = 44,
  Minus = 45,
  Period = 46,
  Slash = 47,
  Num0 = 48,
  Num1 = 49,
  Num2 = 50,
  Num3 = 51,
  Num4 = 52,
  Num5 = 53,
  Num6 = 54,
  Num7 = 55,
  Num8 = 56,
  Num9 = 57,
  Colon = 58,
  Semicolon = 59,
  Less = 60,
  Equals = 61,
  Greater = 62,
  Question = 63,
  At = 64,
  LeftBracket = 91,
  Backslash = 92,
  RightBracket = 93,
  Caret = 94,
  Underscore = 95,
  Grave = 96,
  A = 97,
  B = 98,
  C = 99,
  D = 100,
  E = 101,
  F = 102,
  G = 103,
  H = 104,
  I = 105,
  J = 106,
  K = 107,
  L = 108,
  M = 109,
  N = 110,
  O = 111,
  P = 112,
  Q = 113,
  R = 114,
  S = 115,
  T = 116,
  U = 117,
  V = 118,
  W = 119,
  X = 120,
  Y = 121,
  Z = 122,
  Delete = 127,
  Capslock = 1073741881,
  F1 = 1073741882,
  F2 = 1073741883,
  F3 = 1073741884,
  F4 = 1073741885,
  F5 = 1073741886,
  F6 = 1073741887,
  F7 = 1073741888,
  F8 = 1073741889,
  F9 = 1073741890,
  F10 = 1073741891,
  F11 = 1073741892,
  F12 = 1073741893,
  PrintScreen = 1073741894,
  ScrollLock = 1073741895,
  Pause = 1073741896,
  Insert = 1073741897,
  Home = 1073741898,
  PageUp = 1073741899,
  End = 1073741901,
  PageDown = 1073741902,
  Right = 1073741903,
  Left = 1073741904,
  Down = 1073741905,
  Up = 1073741906,
  NumLockClear = 1073741907,
  KpDivide = 1073741908,
  KpMultiply = 1073741909,
  KpMinus = 1073741910,
  KpPlus = 1073741911,
  KpEnter = 1073741912,
  Kp1 = 1073741913,
  Kp2 = 1073741914,
  Kp3 = 1073741915,
  Kp4 = 1073741916,
  Kp5 = 1073741917,
  Kp6 = 1073741918,
  Kp7 = 1073741919,
  Kp8 = 1073741920,
  Kp9 = 1073741921,
  Kp0 = 1073741922,
  KpPeriod = 1073741923,
  NonUsBackslash = 1073741924,
  Application = 1073741925,
  LCtrl = 1073742048,
  LShift = 1073742049,
  LAlt = 1073742050,
  LGui = 1073742051,
  RCtrl = 1073742052,
  RShift = 1073742053,
  RAlt = 1073742054,
  RGui = 1073742055
}

/**
 * Keyboard modifier bit-flags. OR together to check multiple modifiers.
 * Use with `sdlGetModState()` and `SdlEvent.keyMod`.
 */
export declare enum SdlKeymod {
  None = 0,
  LShift = 1,
  RShift = 2,
  Level5 = 4,
  LCtrl = 64,
  RCtrl = 128,
  LAlt = 256,
  RAlt = 512,
  LGui = 1024,
  RGui = 2048,
  Num = 4096,
  Caps = 8192,
  Mode = 16384,
  Scroll = 32768,
  /** Either shift key. */
  Shift = 3,
  /** Either ctrl key. */
  Ctrl = 192,
  /** Either alt key. */
  Alt = 768,
  /** Either GUI (Win/Cmd) key. */
  Gui = 3072
}

/** Lock all joystick state for thread-safe access. */
export declare function sdlLockJoysticks(): void

/**
 * Emit to SDL_LOG_CATEGORY_APPLICATION at INFO priority.
 * Routed through SDL's log system so external log callbacks receive it.
 */
export declare function sdlLog(message: string): void

/**
 * Emit with an explicit category and priority.
 *
 * `category`: `"app"` | `"error"` | `"assert"` | `"system"` | `"audio"` | `"video"` | `"render"` | `"input"` | `"gpu"`
 *
 * `priority`: `"trace"` | `"verbose"` | `"debug"` | `"info"` | `"warn"` | `"error"` | `"critical"`
 */
export declare function sdlLogMessage(category: string, priority: string, message: string): void

/** Mouse button indices (used in `MOUSE_BUTTON_DOWN/UP` event `.mouseButton` field). */
export declare enum SdlMouseButton {
  Left = 1,
  Middle = 2,
  Right = 3,
  X1 = 4,
  X2 = 5
}

/** Mouse button bitmasks for `sdlGetMouseState().buttons`. */
export declare enum SdlMouseButtonMask {
  LMask = 1,
  MMask = 2,
  RMask = 4,
  X1Mask = 8,
  X2Mask = 16
}

/** Open a gamepad by joystick instance ID. */
export declare function sdlOpenGamepad(instanceId: number): SdlGamepad

/** Open a joystick by instance ID. The returned handle must be closed with `.close()`. */
export declare function sdlOpenJoystick(instanceId: number): SdlJoystick

/**
 * Drain SDL's event queue and return all pending events.
 * One napi round-trip regardless of queue depth.
 */
export declare function sdlPollEvents(): Array<SdlEvent>

/** Battery / power status reported by joystick battery events. */
export declare enum SdlPowerState {
  Unknown = 0,
  OnBattery = 1,
  NoBattery = 2,
  Charging = 3,
  Charged = 4
}

/**
 * Update the event queue without returning events.
 * Call before `sdlGetKeyboardState()` if you haven't called `sdlPollEvents()`.
 */
export declare function sdlPumpEvents(): void

/** Clean up all initialized SDL subsystems. */
export declare function sdlQuit(): void

/** Reset the keyboard state to "all keys released". */
export declare function sdlResetKeyboard(): void

/**
 * Physical key identifiers (USB HID position, layout-independent).
 * Use with `SdlKeyboardState.get()` and compare against `SdlEvent.scancode`.
 */
export declare enum SdlScancode {
  Unknown = 0,
  A = 4,
  B = 5,
  C = 6,
  D = 7,
  E = 8,
  F = 9,
  G = 10,
  H = 11,
  I = 12,
  J = 13,
  K = 14,
  L = 15,
  M = 16,
  N = 17,
  O = 18,
  P = 19,
  Q = 20,
  R = 21,
  S = 22,
  T = 23,
  U = 24,
  V = 25,
  W = 26,
  X = 27,
  Y = 28,
  Z = 29,
  Num1 = 30,
  Num2 = 31,
  Num3 = 32,
  Num4 = 33,
  Num5 = 34,
  Num6 = 35,
  Num7 = 36,
  Num8 = 37,
  Num9 = 38,
  Num0 = 39,
  Return = 40,
  Escape = 41,
  Backspace = 42,
  Tab = 43,
  Space = 44,
  Minus = 45,
  Equals = 46,
  LeftBracket = 47,
  RightBracket = 48,
  Backslash = 49,
  NonUsHash = 50,
  Semicolon = 51,
  Apostrophe = 52,
  Grave = 53,
  Comma = 54,
  Period = 55,
  Slash = 56,
  Capslock = 57,
  F1 = 58,
  F2 = 59,
  F3 = 60,
  F4 = 61,
  F5 = 62,
  F6 = 63,
  F7 = 64,
  F8 = 65,
  F9 = 66,
  F10 = 67,
  F11 = 68,
  F12 = 69,
  PrintScreen = 70,
  ScrollLock = 71,
  Pause = 72,
  Insert = 73,
  Home = 74,
  PageUp = 75,
  Delete = 76,
  End = 77,
  PageDown = 78,
  Right = 79,
  Left = 80,
  Down = 81,
  Up = 82,
  NumLockClear = 83,
  KpDivide = 84,
  KpMultiply = 85,
  KpMinus = 86,
  KpPlus = 87,
  KpEnter = 88,
  Kp1 = 89,
  Kp2 = 90,
  Kp3 = 91,
  Kp4 = 92,
  Kp5 = 93,
  Kp6 = 94,
  Kp7 = 95,
  Kp8 = 96,
  Kp9 = 97,
  Kp0 = 98,
  KpPeriod = 99,
  NonUsBackslash = 100,
  Application = 101,
  LCtrl = 224,
  LShift = 225,
  LAlt = 226,
  LGui = 227,
  RCtrl = 228,
  RShift = 229,
  RAlt = 230,
  RGui = 231,
  Count = 512
}

/** Sensor type reported in gamepad sensor and generic sensor events. */
export declare enum SdlSensorType {
  Invalid = -1,
  Unknown = 0,
  Accel = 1,
  Gyro = 2,
  AccelL = 3,
  GyroL = 4,
  AccelR = 5,
  GyroR = 6
}

/**
 * Make `cursor` the active cursor. Pass the cursor returned by
 * `sdlCreateSystemCursor()`.
 */
export declare function sdlSetCursor(cursor: SdlCursor): void

/**
 * Enable or disable delivery of gamepad events to the event queue. When
 * disabled you must call `sdlUpdateGamepads()` yourself to refresh state.
 */
export declare function sdlSetGamepadEventsEnabled(enabled: boolean): void

/**
 * Override an SDL hint at normal priority. Returns `true` on success.
 *
 * Common hints for game engines:
 * - `"SDL_RENDER_VSYNC"` → `"1"` / `"0"`
 * - `"SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS"` → `"1"`
 * - `"SDL_MOUSE_RELATIVE_MODE_WARP"` → `"1"`
 */
export declare function sdlSetHint(name: string, value: string): boolean

/** Enable or disable joystick events being added to the event queue. */
export declare function sdlSetJoystickEventsEnabled(enabled: boolean): void

/** Set the minimum log priority for a category. Messages below this level are dropped. */
export declare function sdlSetLogPriority(category: string, priority: string): void

/** Override the modifier state programmatically (useful for simulated input). */
export declare function sdlSetModState(modstate: number): void

/**
 * Enable or disable relative mouse mode for `window`.
 * In relative mode the cursor is hidden and only delta motion is reported.
 */
export declare function sdlSetRelativeMouseMode(window: SdlWindow, enabled: boolean): void

/** Show the mouse cursor. */
export declare function sdlShowCursor(): void

/**
 * Enable text-input mode for `window`. SDL will send `TEXT_INPUT` events
 * with composed UTF-8 text (IME-aware).
 */
export declare function sdlStartTextInput(window: SdlWindow): void

/** Disable text-input mode. */
export declare function sdlStopTextInput(window: SdlWindow): void

/** System cursor shapes for `sdlCreateSystemCursor()`. */
export declare enum SdlSystemCursor {
  Default = 0,
  Text = 1,
  Wait = 2,
  Crosshair = 3,
  Progress = 4,
  NwseResize = 5,
  NeswResize = 6,
  EwResize = 7,
  NsResize = 8,
  Move = 9,
  NotAllowed = 10,
  Pointer = 11,
  NwResize = 12,
  NResize = 13,
  NeResize = 14,
  EResize = 15,
  SeResize = 16,
  SResize = 17,
  SwResize = 18,
  WResize = 19
}

/** Returns `true` if text-input mode is currently active for `window`. */
export declare function sdlTextInputActive(window: SdlWindow): boolean

/** Release the lock taken by `sdlLockJoysticks()`. */
export declare function sdlUnlockJoysticks(): void

/**
 * Manually refresh gamepad state. Not needed while gamepad events are enabled
 * and you call `sdlPollEvents()`; use it when polling gamepads with events off.
 */
export declare function sdlUpdateGamepads(): void

/** Update joystick state (not needed if you call `sdlPollEvents()`). */
export declare function sdlUpdateJoysticks(): void

/** Move the cursor to global desktop coordinates. */
export declare function sdlWarpMouseGlobal(x: number, y: number): void

/** Move the cursor to `(x, y)` within `window`. */
export declare function sdlWarpMouseInWindow(window: SdlWindow, x: number, y: number): void

/**
 * SDL window creation / state flags. OR together the flags you need and pass
 * to `sdlCreateWindow`, or check them against `window.flags`.
 */
export declare enum SdlWindowFlag {
  Fullscreen = 1,
  Occluded = 4,
  Hidden = 8,
  Borderless = 16,
  Resizable = 32,
  Minimized = 64,
  Maximized = 128,
  MouseGrabbed = 256,
  InputFocus = 512,
  MouseFocus = 1024,
  External = 2048,
  Modal = 4096,
  AlwaysOnTop = 65536,
  KeyboardGrabbed = 1048576,
  Transparent = 1073741824
}

export interface SurfaceConfiguration {
  width: number
  height: number
  format?: string
  presentMode?: GPUPresentMode
  alphaMode?: GPUAlphaMode
  /**
   * Colour space the swapchain is interpreted in. Omit for `"auto"`, which
   * keeps the platform default (sRGB, SDR). The extended variants are how
   * you opt into an HDR swapchain; they are only valid for formats whose
   * `format_capabilities` advertise them.
   */
  colorSpace?: GPUSurfaceColorSpace
}

export interface WindowPosition {
  x: number
  y: number
}

export interface WindowSize {
  width: number
  height: number
}
