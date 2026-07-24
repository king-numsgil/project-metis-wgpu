use super::bind_group::{GpuBindGroup, GpuBindGroupDescriptor, GpuBindGroupLayout, GpuBindGroupLayoutDescriptor, GpuPipelineLayout, GpuPipelineLayoutDescriptor};
use super::buffer::{GpuBuffer, GpuBufferDescriptor};
use super::command_encoder::{GpuCommandEncoder, GpuCommandEncoderDescriptor};
use super::convert;
use super::pipeline::{GpuComputePipeline, GpuComputePipelineDescriptor, GpuRenderPipeline, GpuRenderPipelineDescriptor, OwnedComputeArgs, OwnedRenderArgs, build_compute_pipeline, build_render_pipeline, build_compute_from_args, build_render_from_args, extract_compute_args, extract_render_args};
use super::error::with_validation_scope;
use super::query_set::{GpuQuerySet, GpuQuerySetDescriptor};
use super::queue::GpuQueue;
use super::sampler::{GpuSampler, GpuSamplerDescriptor};
use super::shader::{GpuShaderModule, GpuShaderModuleDescriptor};
use super::supported_features::GpuSupportedFeatures;
use super::texture::{GpuTexture, GpuTextureDescriptor};
use napi::bindgen_prelude::{AsyncTask, Function, PromiseRaw};
use napi::threadsafe_function::ThreadsafeFunction;
use napi::{Env, Task};
use napi_derive::napi;
use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::watch;

thread_local! {
    /// Open error scopes for this thread, keyed by device.
    ///
    /// wgpu 30 made error scopes guard-based, and the guard is `!Send`/`!Sync`
    /// with a **thread-local** stack inside wgpu itself. That is a poor fit for
    /// a binding whose `pushErrorScope`/`popErrorScope` are two independent JS
    /// calls, because the guard cannot be parked on `GpuDevice` (which napi
    /// requires to be `Send`). It is parked here instead, which is sound for
    /// exactly the reason wgpu's own stack is: every GPU call this crate
    /// exposes is a synchronous napi method running on the JS thread, so a
    /// scope is opened, filled and closed all on one thread.
    ///
    /// Keyed by device pointer rather than being one flat stack: two devices
    /// with interleaved scopes on the same thread would otherwise pop each
    /// other's guards.
    static ERROR_SCOPES: RefCell<HashMap<usize, Vec<wgpu::ErrorScopeGuard>>> =
        RefCell::new(HashMap::new());
}

// ── Async pipeline tasks (libuv thread pool) ──────────────────────────────────

pub(crate) struct ComputePipelineTask {
    device: Arc<wgpu::Device>,
    args: Option<OwnedComputeArgs>,
}

impl Task for ComputePipelineTask {
    type Output = GpuComputePipeline;
    type JsValue = GpuComputePipeline;

    fn compute(&mut self) -> napi::Result<GpuComputePipeline> {
        let args = self.args.take().expect("compute called twice");
        // Runs on a libuv worker, so the caller's error scope does not cover
        // it — see `gpu::error::with_validation_scope`.
        with_validation_scope(&self.device, "createComputePipelineAsync", || {
            Ok(build_compute_from_args(&self.device, args))
        })
    }

    fn resolve(&mut self, _env: Env, output: GpuComputePipeline) -> napi::Result<GpuComputePipeline> {
        Ok(output)
    }
}

pub(crate) struct RenderPipelineTask {
    device: Arc<wgpu::Device>,
    args: Option<OwnedRenderArgs>,
}

impl Task for RenderPipelineTask {
    type Output = GpuRenderPipeline;
    type JsValue = GpuRenderPipeline;

    fn compute(&mut self) -> napi::Result<GpuRenderPipeline> {
        let args = self.args.take().expect("compute called twice");
        with_validation_scope(&self.device, "createRenderPipelineAsync", || {
            Ok(build_render_from_args(&self.device, args))
        })
    }

    fn resolve(&mut self, _env: Env, output: GpuRenderPipeline) -> napi::Result<GpuRenderPipeline> {
        Ok(output)
    }
}

/// Returned by `device.popErrorScope()`. Mirrors the WebGPU `GPUError` base type
/// with an additional `type` discriminant in place of separate subclasses.
#[napi(object)]
pub struct GpuError {
    #[napi(ts_type = "GPUErrorFilter")]
    pub r#type: String,
    pub message: String,
}

/// Payload delivered when `device.lost` resolves.
#[napi(object)]
pub struct GpuDeviceLostInfo {
    #[napi(ts_type = "GPUDeviceLostReason")]
    pub reason: String,
    pub message: String,
}

/// Event object passed to the `onuncapturederror` handler.
#[napi(object)]
pub struct GpuUncapturedErrorEvent {
    pub error: GpuError,
}

/// Type alias used internally (and in adapter.rs) for the uncaptured-error TSFN.
pub(crate) type UncapturedErrorTsfn =
ThreadsafeFunction<GpuUncapturedErrorEvent, (), GpuUncapturedErrorEvent>;

#[napi]
pub struct GpuDevice {
    pub(crate) inner: Arc<wgpu::Device>,
    pub(crate) queue_inner: Arc<wgpu::Queue>,
    label: Option<String>,
    queue_label: Option<String>,
    raw_adapter_info: wgpu::AdapterInfo,
    /// Watch channel receiver for `device.lost`. Shared via Arc so async fns
    /// can clone a fresh receiver without borrowing &self across .await.
    lost_rx: Arc<watch::Receiver<Option<(String, String)>>>,
    /// Shared slot for the onuncapturederror TSFN set by JS.
    pub(crate) uncaptured_error_tsfn: Arc<Mutex<Option<UncapturedErrorTsfn>>>,
}

impl GpuDevice {
    pub(crate) fn new(
        device: Arc<wgpu::Device>,
        queue: Arc<wgpu::Queue>,
        label: Option<String>,
        queue_label: Option<String>,
        raw_adapter_info: wgpu::AdapterInfo,
        lost_rx: Arc<watch::Receiver<Option<(String, String)>>>,
        uncaptured_error_tsfn: Arc<Mutex<Option<UncapturedErrorTsfn>>>,
    ) -> Self {
        Self {
            inner: device,
            queue_inner: queue,
            label,
            queue_label,
            raw_adapter_info,
            lost_rx,
            uncaptured_error_tsfn,
        }
    }
}

#[napi]
impl GpuDevice {
    #[napi(getter)]
    pub fn label(&self) -> Option<String> {
        self.label.clone()
    }

    #[napi(getter)]
    pub fn features(&self) -> GpuSupportedFeatures {
        GpuSupportedFeatures::from_wgpu(self.inner.features())
    }

    #[napi(getter)]
    pub fn limits(&self) -> crate::gpu::adapter::GpuSupportedLimits {
        crate::gpu::adapter::limits_to_js(&self.inner.limits())
    }

    #[napi(getter)]
    pub fn adapter_info(&self) -> crate::gpu::adapter::GpuAdapterInfo {
        let i = &self.raw_adapter_info;
        crate::gpu::adapter::GpuAdapterInfo {
            vendor: i.vendor.to_string(),
            architecture: i.name.clone(),
            device: i.device.to_string(),
            description: i.name.clone(),
            backend_type: convert::backend_to_str(i.backend).to_string(),
            device_type: convert::device_type_to_str(i.device_type).to_string(),
            is_fallback_adapter: i.device_type == wgpu::DeviceType::Cpu,
            subgroup_min_size: i.subgroup_min_size,
            subgroup_max_size: i.subgroup_max_size,
        }
    }

    #[napi(getter)]
    pub fn queue(&self) -> GpuQueue {
        GpuQueue {
            inner: Arc::clone(&self.queue_inner),
            device: Arc::clone(&self.inner),
            label: self.queue_label.clone(),
        }
    }

    // ── device.lost ──────────────────────────────────────────────────────────

    /// Returns a Promise that resolves with `GPUDeviceLostInfo` when the device
    /// is lost (either via `destroy()` or a hardware/driver fault).
    #[napi(getter)]
    pub async fn lost(&self) -> napi::Result<GpuDeviceLostInfo> {
        let lost_rx = Arc::clone(&self.lost_rx);
        // Clone a fresh Receiver so we don't hold &self across .await.
        let mut rx = (*lost_rx).clone();
        loop {
            {
                let val = rx.borrow();
                if let Some((reason, message)) = val.as_ref() {
                    return Ok(GpuDeviceLostInfo {
                        reason: reason.clone(),
                        message: message.clone(),
                    });
                }
            }
            rx.changed().await.map_err(|e| {
                napi::Error::new(napi::Status::GenericFailure, e.to_string())
            })?;
        }
    }

    // ── onuncapturederror ─────────────────────────────────────────────────────

    /// Getter returns `undefined` (we cannot round-trip the JS function after
    /// converting it to a ThreadsafeFunction).
    #[napi(getter)]
    pub fn get_onuncapturederror(&self) {}

    /// Set an `onuncapturederror` handler. The handler is called with a
    /// `GpuUncapturedErrorEvent` whenever a GPU error escapes all error scopes.
    #[napi(setter)]
    pub fn set_onuncapturederror(
        &self,
        callback: Function<'_, GpuUncapturedErrorEvent, ()>,
    ) -> napi::Result<()> {
        let tsfn = callback
            .build_threadsafe_function::<GpuUncapturedErrorEvent>()
            .callee_handled::<true>()
            .build()?;
        *self.uncaptured_error_tsfn.lock().expect("uncaptured_error_tsfn lock") = Some(tsfn);
        Ok(())
    }

    // ── resource factories ────────────────────────────────────────────────────

    #[napi]
    pub fn create_buffer(&self, descriptor: GpuBufferDescriptor) -> napi::Result<GpuBuffer> {
        let size = descriptor.size as u64;
        let usage = convert::buffer_usage(descriptor.usage);
        let mapped_at_creation = descriptor.mapped_at_creation.unwrap_or(false);
        let buf = self.inner.create_buffer(&wgpu::BufferDescriptor {
            label: descriptor.label.as_deref(),
            size,
            usage,
            mapped_at_creation,
        });
        Ok(GpuBuffer::new(buf, Arc::clone(&self.inner), size, descriptor.usage, descriptor.label, mapped_at_creation))
    }

    #[napi]
    pub fn create_texture(&self, descriptor: GpuTextureDescriptor) -> napi::Result<GpuTexture> {
        let format = convert::texture_format(&descriptor.format)?;
        let dimension = descriptor.dimension.as_deref().map(convert::texture_dimension).transpose()?.unwrap_or(wgpu::TextureDimension::D2);
        let view_formats: Vec<wgpu::TextureFormat> = descriptor
            .view_formats
            .as_deref()
            .unwrap_or(&[])
            .iter()
            .map(|f| convert::texture_format(f))
            .collect::<napi::Result<_>>()?;
        let usage_flags = convert::texture_usage(descriptor.usage);
        let wgpu_desc = wgpu::TextureDescriptor {
            label: descriptor.label.as_deref(),
            size: wgpu::Extent3d {
                width: descriptor.size.width,
                height: descriptor.size.height.unwrap_or(1),
                depth_or_array_layers: descriptor.size.depth_or_array_layers.unwrap_or(1),
            },
            mip_level_count: descriptor.mip_level_count.unwrap_or(1),
            sample_count: descriptor.sample_count.unwrap_or(1),
            dimension,
            format,
            usage: usage_flags,
            view_formats: &view_formats,
        };
        let tex = self.inner.create_texture(&wgpu_desc);
        Ok(GpuTexture::from_desc(tex, &wgpu_desc, descriptor.usage))
    }

    #[napi]
    pub fn create_sampler(&self, descriptor: Option<GpuSamplerDescriptor>) -> napi::Result<GpuSampler> {
        let sampler = if let Some(ref d) = descriptor {
            let wgpu_desc = super::sampler::build_descriptor(d)?;
            self.inner.create_sampler(&wgpu_desc)
        } else {
            self.inner.create_sampler(&wgpu::SamplerDescriptor::default())
        };
        Ok(GpuSampler::new(sampler))
    }

    #[napi]
    pub fn create_bind_group_layout(&self, descriptor: GpuBindGroupLayoutDescriptor) -> napi::Result<GpuBindGroupLayout> {
        GpuBindGroupLayout::from_desc(&self.inner, &descriptor)
    }

    #[napi]
    pub fn create_pipeline_layout(&self, descriptor: GpuPipelineLayoutDescriptor) -> napi::Result<GpuPipelineLayout> {
        // `Option` entries here are `null` bind group layouts — an unused group
        // index that still occupies its slot, same rule as vertex buffers.
        let bgl_refs: Vec<Option<&wgpu::BindGroupLayout>> = descriptor
            .bind_group_layouts
            .iter()
            .map(|bgl| Some(&*bgl.inner))
            .collect();
        // wgpu 30 replaced per-stage push-constant ranges with a single
        // `immediate_size`: immediates are visible to every stage, so the
        // stage mask this used to build had no meaning to begin with.
        let layout = self.inner.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: descriptor.label.as_deref(),
            bind_group_layouts: &bgl_refs,
            immediate_size: descriptor.immediate_size.unwrap_or(0),
        });
        Ok(GpuPipelineLayout::new(layout))
    }

    #[napi]
    pub fn create_bind_group(&self, descriptor: GpuBindGroupDescriptor) -> napi::Result<GpuBindGroup> {
        GpuBindGroup::from_desc(&self.inner, &descriptor)
    }

    #[napi]
    pub fn create_shader_module(&self, descriptor: GpuShaderModuleDescriptor) -> GpuShaderModule {
        let module = self.inner.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: descriptor.label.as_deref(),
            source: wgpu::ShaderSource::Wgsl(descriptor.code.into()),
        });
        GpuShaderModule::new(module)
    }

    #[napi]
    pub fn create_compute_pipeline(&self, descriptor: GpuComputePipelineDescriptor) -> napi::Result<GpuComputePipeline> {
        build_compute_pipeline(&self.inner, &descriptor)
    }

    #[allow(private_interfaces)]
    #[napi(ts_return_type = "Promise<GpuComputePipeline>")]
    pub fn create_compute_pipeline_async(&self, descriptor: GpuComputePipelineDescriptor) -> napi::Result<AsyncTask<ComputePipelineTask>> {
        let device = Arc::clone(&self.inner);
        let args = extract_compute_args(&descriptor);
        Ok(AsyncTask::new(ComputePipelineTask { device, args: Some(args) }))
    }

    #[napi]
    pub fn create_render_pipeline(&self, descriptor: GpuRenderPipelineDescriptor) -> napi::Result<GpuRenderPipeline> {
        build_render_pipeline(&self.inner, &descriptor)
    }

    #[allow(private_interfaces)]
    #[napi(ts_return_type = "Promise<GpuRenderPipeline>")]
    pub fn create_render_pipeline_async(&self, descriptor: GpuRenderPipelineDescriptor) -> napi::Result<AsyncTask<RenderPipelineTask>> {
        let device = Arc::clone(&self.inner);
        let args = extract_render_args(&descriptor)?;
        Ok(AsyncTask::new(RenderPipelineTask { device, args: Some(args) }))
    }

    #[napi]
    pub fn create_command_encoder(&self, descriptor: Option<GpuCommandEncoderDescriptor>) -> GpuCommandEncoder {
        let label = descriptor.as_ref().and_then(|d| d.label.clone());
        let encoder = self.inner.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: label.as_deref(),
        });
        GpuCommandEncoder::new(encoder, label)
    }

    #[napi]
    pub fn create_query_set(&self, descriptor: GpuQuerySetDescriptor) -> napi::Result<GpuQuerySet> {
        let qt = convert::query_type(&descriptor.r#type)?;
        let qs = self.inner.create_query_set(&wgpu::QuerySetDescriptor {
            label: descriptor.label.as_deref(),
            ty: qt,
            count: descriptor.count,
        });
        Ok(GpuQuerySet::new(qs, qt, descriptor.count))
    }

    // ── error scopes ─────────────────────────────────────────────────────────

    /// Begin capturing GPU errors of the given type.
    /// `filter`: `"validation"` | `"out-of-memory"` | `"internal"`
    ///
    /// Scopes nest, and each one must be closed by a matching
    /// `popErrorScope()`. Only work issued between the two is captured.
    #[napi]
    pub fn push_error_scope(&self, #[napi(
        ts_arg_type = "GPUErrorFilter"
    )] filter: String) -> napi::Result<()> {
        let f = match filter.as_str() {
            "validation" => wgpu::ErrorFilter::Validation,
            "out-of-memory" => wgpu::ErrorFilter::OutOfMemory,
            "internal" => wgpu::ErrorFilter::Internal,
            other => return Err(napi::Error::new(
                napi::Status::InvalidArg,
                format!("Unknown GPUErrorFilter '{other}'; expected 'validation', 'out-of-memory', or 'internal'"),
            )),
        };
        let guard = self.inner.push_error_scope(f);
        ERROR_SCOPES.with(|scopes| {
            scopes
                .borrow_mut()
                .entry(Arc::as_ptr(&self.inner) as usize)
                .or_default()
                .push(guard)
        });
        Ok(())
    }

    /// End the current error scope and resolve with the first error captured,
    /// or null.
    ///
    /// The scope closes when this is *called*, not when the returned promise
    /// settles — so work issued immediately afterwards is already outside it,
    /// and there is no need to await before continuing. Throws if no scope is
    /// open on this device.
    // Deliberately not an `async fn`: napi would run the whole body on a tokio
    // worker, and the wgpu 30 scope guard lives in a thread-local belonging to
    // the JS thread (see ERROR_SCOPES). The guard is therefore taken and popped
    // here, synchronously, and only the resulting future — which is `Send` — is
    // handed to the runtime.
    #[napi(ts_return_type = "Promise<GpuError | null>")]
    pub fn pop_error_scope<'env>(&self, env: &'env Env) -> napi::Result<PromiseRaw<'env, Option<GpuError>>> {
        let key = Arc::as_ptr(&self.inner) as usize;
        let guard = ERROR_SCOPES
            .with(|scopes| scopes.borrow_mut().get_mut(&key).and_then(|stack| stack.pop()));

        // Pop on this thread (the guard is `!Send`), but report an empty stack
        // by *rejecting* the returned promise rather than throwing out of the
        // call. The spec has `popErrorScope()` reject with an `OperationError`
        // here, and a synchronous throw is not something `.catch()` sees.
        let pending = guard.map(|g| g.pop());
        env.spawn_future(async move {
            let Some(pending) = pending else {
                return Err(napi::Error::new(
                    napi::Status::GenericFailure,
                    "popErrorScope() with no matching pushErrorScope() on this thread",
                ));
            };
            Ok(pending.await.map(|e| {
                let r#type = match &e {
                    wgpu::Error::Validation { .. } => "validation",
                    wgpu::Error::OutOfMemory { .. } => "out-of-memory",
                    wgpu::Error::Internal { .. } => "internal",
                };
                GpuError { r#type: r#type.to_string(), message: e.to_string() }
            }))
        })
    }

    /// Poll device for completion. Returns true if queue is empty.
    #[napi]
    pub fn poll(&self, maintain: Option<String>) -> bool {
        let m = match maintain.as_deref() {
            Some("wait") => wgpu::PollType::wait_indefinitely(),
            _ => wgpu::PollType::Poll,
        };
        matches!(self.inner.poll(m), Ok(wgpu::PollStatus::QueueEmpty))
    }

    #[napi]
    pub fn destroy(&self) {
        self.inner.destroy();
    }
}
