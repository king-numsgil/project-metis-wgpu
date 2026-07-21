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
 * - `multi-draw-indirect` — batched indirect draws from a GPU buffer.
 * - `push-constants` — small inline uniforms via `setImmediates()`. Also needs
 *   the `maxPushConstantSize` limit raised from its default of 0.
 */
export type GPUNativeFeatureName =
  | 'timestamp-query-inside-encoders'
  | 'timestamp-query-inside-passes'
  | 'multi-draw-indirect'
  | 'push-constants'

export type GPUErrorFilter = 'validation' | 'out-of-memory' | 'internal'

export type GPUDeviceLostReason = 'unknown' | 'destroyed'

export type GPUPresentMode = 'fifo' | 'mailbox' | 'immediate' | 'auto-no-vsync' | 'auto-vsync'

export type GPUAlphaMode = 'premultiplied' | 'postmultiplied' | 'inherit'

export type GPUCompilationMessageType = 'error' | 'warning' | 'info'


/* auto-generated by NAPI-RS */
/* eslint-disable */
export declare class GpuAdapter {
  get features(): GpuSupportedFeatures
  get limits(): GpuSupportedLimits
  get isFallbackAdapter(): boolean
  get info(): GpuAdapterInfo
  requestDevice(descriptor?: GpuDeviceDescriptor | undefined | null): Promise<GpuDevice>
}

export declare class GpuBindGroup {

}

export declare class GpuBindGroupLayout {

}

export declare class GpuBuffer {
  get size(): number
  get usage(): number
  get label(): string | null
  get mapState(): string
  mapAsync(mode: number, offset?: number | undefined | null, size?: number | undefined | null): Promise<void>
  getMappedRange(offset?: number | undefined | null, size?: number | undefined | null): Uint8Array
  writeMappedRange(data: Uint8Array, bufferOffset?: number | undefined | null, dataOffset?: number | undefined | null, size?: number | undefined | null): void
  unmap(): void
  destroy(): void
}

export declare class GpuCommandBuffer {

}

export declare class GpuCommandEncoder {
  get label(): string | null
  beginRenderPass(descriptor: GpuRenderPassDescriptor): GpuRenderPassEncoder
  beginComputePass(descriptor?: GpuComputePassDescriptor | undefined | null): GpuComputePassEncoder
  copyBufferToBuffer(source: GpuBuffer, sourceOffset: number, destination: GpuBuffer, destinationOffset: number, size: number): void
  copyBufferToTexture(source: GpuImageCopyBuffer, destination: GpuImageCopyTexture, copySize: GpuExtent3D): void
  copyTextureToBuffer(source: GpuImageCopyTexture, destination: GpuImageCopyBuffer, copySize: GpuExtent3D): void
  copyTextureToTexture(source: GpuImageCopyTexture, destination: GpuImageCopyTexture, copySize: GpuExtent3D): void
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
  resolveQuerySet(querySet: GpuQuerySet, firstQuery: number, queryCount: number, destination: GpuBuffer, destinationOffset: number): void
  pushDebugGroup(groupLabel: string): void
  popDebugGroup(): void
  insertDebugMarker(markerLabel: string): void
  finish(descriptor?: GpuCommandEncoderDescriptor | undefined | null): GpuCommandBuffer
}

export declare class GpuComputePassEncoder {
  setPipeline(pipeline: GpuComputePipeline): void
  setBindGroup(index: number, bindGroup?: GpuBindGroup | undefined | null, dynamicOffsets?: Array<number> | undefined | null): void
  dispatchWorkgroups(x: number, y?: number | undefined | null, z?: number | undefined | null): void
  pushDebugGroup(groupLabel: string): void
  popDebugGroup(): void
  insertDebugMarker(markerLabel: string): void
  dispatchWorkgroupsIndirect(indirectBuffer: GpuBuffer, indirectOffset: number): void
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
  end(): void
}

export declare class GpuComputePipeline {
  getBindGroupLayout(index: number): GpuBindGroupLayout
}

export declare class GpuDevice {
  get label(): string | null
  get features(): GpuSupportedFeatures
  get limits(): GpuSupportedLimits
  get adapterInfo(): GpuAdapterInfo
  get queue(): GpuQueue
  /**
   * Returns a Promise that resolves with `GPUDeviceLostInfo` when the device
   * is lost (either via `destroy()` or a hardware/driver fault).
   */
  get lost(): Promise<GpuDeviceLostInfo>
  /**
   * Getter returns `undefined` (we cannot round-trip the JS function after
   * converting it to a ThreadsafeFunction).
   */
  get onuncapturederror(): void
  /**
   * Set an `onuncapturederror` handler. The handler is called with a
   * `GpuUncapturedErrorEvent` whenever a GPU error escapes all error scopes.
   */
  set onuncapturederror(callback: (arg: GpuUncapturedErrorEvent) => void)
  createBuffer(descriptor: GpuBufferDescriptor): GpuBuffer
  createTexture(descriptor: GpuTextureDescriptor): GpuTexture
  createSampler(descriptor?: GpuSamplerDescriptor | undefined | null): GpuSampler
  createBindGroupLayout(descriptor: GpuBindGroupLayoutDescriptor): GpuBindGroupLayout
  createPipelineLayout(descriptor: GpuPipelineLayoutDescriptor): GpuPipelineLayout
  createBindGroup(descriptor: GpuBindGroupDescriptor): GpuBindGroup
  createShaderModule(descriptor: GpuShaderModuleDescriptor): GpuShaderModule
  createComputePipeline(descriptor: GpuComputePipelineDescriptor): GpuComputePipeline
  createComputePipelineAsync(descriptor: GpuComputePipelineDescriptor): Promise<GpuComputePipeline>
  createRenderPipeline(descriptor: GpuRenderPipelineDescriptor): GpuRenderPipeline
  createRenderPipelineAsync(descriptor: GpuRenderPipelineDescriptor): Promise<GpuRenderPipeline>
  createCommandEncoder(descriptor?: GpuCommandEncoderDescriptor | undefined | null): GpuCommandEncoder
  createQuerySet(descriptor: GpuQuerySetDescriptor): GpuQuerySet
  /**
   * Begin capturing GPU errors of the given type.
   * `filter`: `"validation"` | `"out-of-memory"` | `"internal"`
   */
  pushErrorScope(filter: GPUErrorFilter): void
  /** End the current error scope and resolve with the first error captured, or null. */
  popErrorScope(): Promise<GpuError | null>
  /** Poll device for completion. Returns true if queue is empty. */
  poll(maintain?: string | undefined | null): boolean
  destroy(): void
}

export declare class GpuPipelineLayout {

}

export declare class GpuQuerySet {
  get type(): GPUQueryType
  get count(): number
  destroy(): void
}

export declare class GpuQueue {
  get label(): string | null
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
  submit(commandBuffers: Array<GpuCommandBuffer>): void
  writeBuffer(buffer: GpuBuffer, bufferOffset: number, data: Uint8Array, dataOffset?: number | undefined | null, size?: number | undefined | null): void
  writeTexture(destination: GpuImageCopyTexture, data: Uint8Array, dataLayout: GpuImageDataLayout, size: GpuExtent3D): void
  onSubmittedWorkDone(): Promise<void>
}

export declare class GpuRenderPassEncoder {
  setPipeline(pipeline: GpuRenderPipeline): void
  setBindGroup(index: number, bindGroup?: GpuBindGroup | undefined | null, dynamicOffsets?: Array<number> | undefined | null): void
  setVertexBuffer(slot: number, buffer: GpuBuffer, offset?: number | undefined | null, size?: number | undefined | null): void
  setIndexBuffer(buffer: GpuBuffer, indexFormat: GPUIndexFormat, offset?: number | undefined | null, size?: number | undefined | null): void
  draw(vertexCount: number, instanceCount?: number | undefined | null, firstVertex?: number | undefined | null, firstInstance?: number | undefined | null): void
  drawIndexed(indexCount: number, instanceCount?: number | undefined | null, firstIndex?: number | undefined | null, baseVertex?: number | undefined | null, firstInstance?: number | undefined | null): void
  drawIndirect(indirectBuffer: GpuBuffer, indirectOffset: number): void
  drawIndexedIndirect(indirectBuffer: GpuBuffer, indirectOffset: number): void
  setViewport(x: number, y: number, width: number, height: number, minDepth: number, maxDepth: number): void
  setScissorRect(x: number, y: number, width: number, height: number): void
  setBlendConstant(color: GpuColor): void
  setStencilReference(reference: number): void
  pushDebugGroup(groupLabel: string): void
  popDebugGroup(): void
  insertDebugMarker(markerLabel: string): void
  beginOcclusionQuery(queryIndex: number): void
  endOcclusionQuery(): void
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
  end(): void
}

export declare class GpuRenderPipeline {
  getBindGroupLayout(index: number): GpuBindGroupLayout
}

export declare class GpuSampler {

}

export declare class GpuShaderModule {
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

export declare class GpuTexture {
  createView(descriptor?: GpuTextureViewDescriptor | undefined | null): GpuTextureView
  get width(): number
  get height(): number
  get depthOrArrayLayers(): number
  get mipLevelCount(): number
  get sampleCount(): number
  get dimension(): GPUTextureDimension
  get format(): GPUTextureFormat
  get usage(): number
  get textureBindingViewDimension(): GPUTextureViewDimension
  destroy(): void
}

export declare class GpuTextureView {

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
export declare function enumerateAdapters(options?: GpuRequestAdapterOptions | undefined | null): Array<GpuAdapter>

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

export interface GpuRenderPassColorAttachment {
  view: GpuTextureView
  resolveTarget?: GpuTextureView
  clearValue?: GpuColor
  loadOp: GPULoadOp
  storeOp: GPUStoreOp
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
   * Bytes of push-constant data a pipeline layout may declare. Defaults to
   * **0**, so requesting the `push-constants` feature without also raising
   * this yields a device that accepts no push constants at all — set both.
   *
   * Reported back on `limits` as `maxImmediateSize`: this is wgpu's
   * `max_push_constant_size`, which the WebGPU spec later renamed to
   * "immediate size". Same limit, two names.
   */
  maxPushConstantSize?: number
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
 * no `-srgb` float texture format to request. See [`decode_image`].
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
 * Decode an image file (PNG, TGA, JPEG, Radiance HDR) straight into a
 * `GpuTexture` ready to bind, off the JS thread. The pixels never cross into JS.
 *
 * Decoding is pure Rust (the `image` crate) — see the module docs for why
 * SDL3_image was dropped.
 *
 * `path` is a filesystem path. The returned promise rejects with a decode error
 * string on failure. The resulting texture's `format` is `rgba8unorm(-srgb)`
 * for 8-bit sources and `rgba16float` for HDR — read it off the returned handle
 * rather than assuming.
 */
export declare function loadImageTexture(device: GpuDevice, path: string, options?: ImageLoadOptions | undefined | null): Promise<GpuTexture>

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
export declare function readTexturePixels(device: GpuDevice, texture: GpuTexture): Promise<Buffer>

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
 * Pair with [`read_texture_pixels`] when a caller wants both the pixels and a
 * file from a single GPU readback.
 */
export declare function savePixelsToFile(pixels: Buffer, width: number, height: number, path: string): Promise<void>

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
 * Enable mouse capture so the window receives mouse events even when the
 * cursor leaves it. Pass `false` to release.
 */
export declare function sdlCaptureMouse(enabled: boolean): void

/** Create a system cursor from a `SdlSystemCursor` shape enum value. */
export declare function sdlCreateSystemCursor(shape: SdlSystemCursor): SdlCursor

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

export declare function sdlGamepadEventsEnabled(): boolean

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

export declare function sdlUnlockJoysticks(): void

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
}

export interface WindowPosition {
  x: number
  y: number
}

export interface WindowSize {
  width: number
  height: number
}
