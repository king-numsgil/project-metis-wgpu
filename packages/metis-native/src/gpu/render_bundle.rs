//! Render bundles — pre-recorded, replayable sequences of render commands.
//!
//! ## Why commands are buffered instead of recorded straight through
//!
//! wgpu's `RenderBundleEncoder<'a>` is **`!Send + !Sync`** by construction (it
//! asserts this; it represents an allocation on the recording thread), and napi
//! requires a `#[napi]` class to be `Send`. So the encoder cannot be parked on
//! `GpuRenderBundleEncoder` — the same constraint that shaped the error-scope
//! handling in `device.rs`.
//!
//! The resolution here is different, and simpler than a thread-local: this
//! encoder **records into a `Vec<BundleCommand>`** holding only `Arc` handles
//! (which are `Send + Sync`), and `finish()` creates the real wgpu encoder,
//! replays the list into it, and consumes it — all within one synchronous call.
//! Nothing `!Send` ever outlives a single napi method.
//!
//! The finished `wgpu::RenderBundle` *is* `Send + Sync`, so `GpuRenderBundle`
//! holds it directly.

use super::bind_group::GpuBindGroup;
use super::buffer::GpuBuffer;
use super::convert;
use super::pipeline::GpuRenderPipeline;
use napi_derive::napi;
use std::ops::Range;
use std::sync::{Arc, Mutex};

#[napi(object)]
pub struct GpuRenderBundleEncoderDescriptor {
    pub label: Option<String>,
    /// Formats of the colour attachments this bundle will be executed against.
    /// Must match the render pass that executes it. `null` marks an unused slot.
    #[napi(ts_type = "Array<GPUTextureFormat | undefined | null>")]
    pub color_formats: Vec<Option<String>>,
    /// Format of the depth/stencil attachment, if the target pass has one.
    #[napi(ts_type = "GPUTextureFormat")]
    pub depth_stencil_format: Option<String>,
    /// Sample count of the target pass. Defaults to 1.
    pub sample_count: Option<u32>,
    /// Set when the executing pass's depth attachment is read-only.
    pub depth_read_only: Option<bool>,
    /// Set when the executing pass's stencil attachment is read-only.
    pub stencil_read_only: Option<bool>,
}

#[napi(object)]
pub struct GpuRenderBundleDescriptor {
    pub label: Option<String>,
}

/// One recorded command, replayed into a real wgpu encoder by `finish()`.
/// Every variant holds owned/`Arc` data so the whole list stays `Send`.
enum BundleCommand {
    SetPipeline(Arc<wgpu::RenderPipeline>),
    SetBindGroup {
        index: u32,
        bind_group: Option<Arc<wgpu::BindGroup>>,
        offsets: Vec<u32>,
    },
    SetVertexBuffer {
        slot: u32,
        buffer: Arc<wgpu::Buffer>,
        offset: u64,
        end: u64,
    },
    SetIndexBuffer {
        buffer: Arc<wgpu::Buffer>,
        format: wgpu::IndexFormat,
        offset: u64,
        end: u64,
    },
    Draw {
        vertices: Range<u32>,
        instances: Range<u32>,
    },
    DrawIndexed {
        indices: Range<u32>,
        base_vertex: i32,
        instances: Range<u32>,
    },
    DrawIndirect {
        buffer: Arc<wgpu::Buffer>,
        offset: u64,
    },
    DrawIndexedIndirect {
        buffer: Arc<wgpu::Buffer>,
        offset: u64,
    },
    SetImmediates {
        offset: u32,
        data: Vec<u8>,
    },
}

/// A finished, immutable render bundle. Execute it (repeatedly, in any number of
/// passes) with `renderPass.executeBundles([bundle])`.
#[napi]
pub struct GpuRenderBundle {
    pub(crate) inner: Arc<wgpu::RenderBundle>,
    label: Mutex<Option<String>>,
}

#[napi]
impl GpuRenderBundle {
    /// Debug label (read-write).
    #[napi(getter)]
    pub fn label(&self) -> Option<String> {
        self.label.lock().unwrap().clone()
    }
    #[napi(setter)]
    pub fn set_label(&self, label: String) {
        *self.label.lock().unwrap() = Some(label);
    }
}

/// Records a reusable sequence of render commands, created by
/// `device.createRenderBundleEncoder(descriptor)`.
///
/// The command subset is the spec's `GPURenderCommandsMixin` — pipeline, bind
/// groups, vertex/index buffers and the `draw*` family. State set inside a
/// bundle does **not** leak into the pass that executes it, and vice versa.
///
/// Call `finish()` once to produce a `GpuRenderBundle`; the encoder is spent
/// afterwards.
#[napi]
pub struct GpuRenderBundleEncoder {
    device: Arc<wgpu::Device>,
    label: Option<String>,
    color_formats: Vec<Option<wgpu::TextureFormat>>,
    depth_stencil: Option<wgpu::RenderBundleDepthStencil>,
    sample_count: u32,
    commands: Mutex<Option<Vec<BundleCommand>>>,
}

impl GpuRenderBundleEncoder {
    pub(crate) fn new(
        device: Arc<wgpu::Device>,
        descriptor: GpuRenderBundleEncoderDescriptor,
    ) -> napi::Result<Self> {
        let color_formats = descriptor
            .color_formats
            .iter()
            .map(|f| match f {
                Some(name) => convert::texture_format(name).map(Some),
                None => Ok(None),
            })
            .collect::<napi::Result<Vec<_>>>()?;

        let depth_stencil = match descriptor.depth_stencil_format {
            Some(ref f) => Some(wgpu::RenderBundleDepthStencil {
                format: convert::texture_format(f)?,
                depth_read_only: descriptor.depth_read_only.unwrap_or(false),
                stencil_read_only: descriptor.stencil_read_only.unwrap_or(false),
            }),
            None => None,
        };

        // A bundle layout must have at least one attachment. wgpu **panics**
        // inside `finish()` on an all-null/empty colour list with no
        // depth-stencil ("Render bundle encoder has already ended"), and a panic
        // across the napi boundary aborts the process rather than throwing
        // something JS can catch — so it is rejected here, up front, with a
        // message that says what is wrong.
        if depth_stencil.is_none() && !color_formats.iter().any(|f| f.is_some()) {
            return Err(napi::Error::new(
                napi::Status::InvalidArg,
                "createRenderBundleEncoder: needs at least one non-null entry in `colorFormats`, \
                 or a `depthStencilFormat`",
            ));
        }

        Ok(Self {
            device,
            label: descriptor.label,
            color_formats,
            depth_stencil,
            sample_count: descriptor.sample_count.unwrap_or(1),
            commands: Mutex::new(Some(Vec::new())),
        })
    }

    /// Push a command, or error if `finish()` already consumed the encoder.
    fn record(&self, cmd: BundleCommand) -> napi::Result<()> {
        let mut guard = self.commands.lock().unwrap();
        let list = guard.as_mut().ok_or_else(|| {
            napi::Error::new(
                napi::Status::GenericFailure,
                "RenderBundleEncoder already finished",
            )
        })?;
        list.push(cmd);
        Ok(())
    }
}

#[napi]
impl GpuRenderBundleEncoder {
    /// Set the render pipeline used by subsequent `draw*` calls.
    #[napi]
    pub fn set_pipeline(&self, pipeline: &GpuRenderPipeline) -> napi::Result<()> {
        self.record(BundleCommand::SetPipeline(Arc::clone(&pipeline.inner)))
    }

    /// Bind a `GpuBindGroup` (or `null` to clear the slot) at group `index`.
    #[napi]
    pub fn set_bind_group(
        &self,
        index: u32,
        bind_group: Option<&GpuBindGroup>,
        dynamic_offsets: Option<Vec<u32>>,
    ) -> napi::Result<()> {
        self.record(BundleCommand::SetBindGroup {
            index,
            bind_group: bind_group.map(|bg| Arc::clone(&bg.inner)),
            offsets: dynamic_offsets.unwrap_or_default(),
        })
    }

    /// Bind `buffer` as the vertex buffer for `slot`.
    #[napi]
    pub fn set_vertex_buffer(
        &self,
        slot: u32,
        buffer: &GpuBuffer,
        offset: Option<f64>,
        size: Option<f64>,
    ) -> napi::Result<()> {
        let offset = offset.unwrap_or(0.0) as u64;
        let end = size.map_or(buffer.size, |s| offset + s as u64);
        self.record(BundleCommand::SetVertexBuffer {
            slot,
            buffer: Arc::clone(&buffer.inner),
            offset,
            end,
        })
    }

    /// Bind the index buffer used by `drawIndexed` / `drawIndexedIndirect`.
    #[napi]
    pub fn set_index_buffer(
        &self,
        buffer: &GpuBuffer,
        #[napi(ts_arg_type = "GPUIndexFormat")] index_format: String,
        offset: Option<f64>,
        size: Option<f64>,
    ) -> napi::Result<()> {
        let format = convert::index_format(&index_format)?;
        let offset = offset.unwrap_or(0.0) as u64;
        let end = size.map_or(buffer.size, |s| offset + s as u64);
        self.record(BundleCommand::SetIndexBuffer {
            buffer: Arc::clone(&buffer.inner),
            format,
            offset,
            end,
        })
    }

    /// Draw `vertexCount` vertices in `instanceCount` instances (default 1).
    #[napi]
    pub fn draw(
        &self,
        vertex_count: u32,
        instance_count: Option<u32>,
        first_vertex: Option<u32>,
        first_instance: Option<u32>,
    ) -> napi::Result<()> {
        let fv = first_vertex.unwrap_or(0);
        let fi = first_instance.unwrap_or(0);
        let ic = instance_count.unwrap_or(1);
        self.record(BundleCommand::Draw {
            vertices: fv..fv + vertex_count,
            instances: fi..fi + ic,
        })
    }

    /// Draw using the bound index buffer.
    #[napi]
    pub fn draw_indexed(
        &self,
        index_count: u32,
        instance_count: Option<u32>,
        first_index: Option<u32>,
        base_vertex: Option<i32>,
        first_instance: Option<u32>,
    ) -> napi::Result<()> {
        let fi = first_index.unwrap_or(0);
        let ic = instance_count.unwrap_or(1);
        let fis = first_instance.unwrap_or(0);
        self.record(BundleCommand::DrawIndexed {
            indices: fi..fi + index_count,
            base_vertex: base_vertex.unwrap_or(0),
            instances: fis..fis + ic,
        })
    }

    /// Like `draw`, with parameters read from `indirectBuffer` (needs `INDIRECT`).
    #[napi]
    pub fn draw_indirect(
        &self,
        indirect_buffer: &GpuBuffer,
        indirect_offset: f64,
    ) -> napi::Result<()> {
        self.record(BundleCommand::DrawIndirect {
            buffer: Arc::clone(&indirect_buffer.inner),
            offset: indirect_offset as u64,
        })
    }

    /// Like `drawIndexed`, with parameters read from `indirectBuffer`.
    #[napi]
    pub fn draw_indexed_indirect(
        &self,
        indirect_buffer: &GpuBuffer,
        indirect_offset: f64,
    ) -> napi::Result<()> {
        self.record(BundleCommand::DrawIndexedIndirect {
            buffer: Arc::clone(&indirect_buffer.inner),
            offset: indirect_offset as u64,
        })
    }

    /// Upload immediate (push-constant) data. Requires the `immediates` feature.
    #[napi]
    pub fn set_immediates(
        &self,
        offset: u32,
        data: napi::bindgen_prelude::Uint8Array,
    ) -> napi::Result<()> {
        self.record(BundleCommand::SetImmediates {
            offset,
            data: data.to_vec(),
        })
    }

    /// Replay the recorded commands into a real wgpu bundle encoder and return
    /// the finished `GpuRenderBundle`. The encoder is spent — further calls,
    /// including a second `finish()`, are an error.
    #[napi]
    pub fn finish(
        &self,
        descriptor: Option<GpuRenderBundleDescriptor>,
    ) -> napi::Result<GpuRenderBundle> {
        let commands = self.commands.lock().unwrap().take().ok_or_else(|| {
            napi::Error::new(
                napi::Status::GenericFailure,
                "RenderBundleEncoder already finished",
            )
        })?;

        // The wgpu encoder is `!Send`, so it is created, filled and consumed
        // entirely within this synchronous call (see the module docs).
        let mut encoder =
            self.device
                .create_render_bundle_encoder(&wgpu::RenderBundleEncoderDescriptor {
                    label: self.label.as_deref(),
                    color_formats: &self.color_formats,
                    depth_stencil: self.depth_stencil,
                    sample_count: self.sample_count,
                    multiview: None,
                });

        for cmd in &commands {
            match cmd {
                BundleCommand::SetPipeline(p) => encoder.set_pipeline(p),
                BundleCommand::SetBindGroup {
                    index,
                    bind_group,
                    offsets,
                } => encoder.set_bind_group(*index, bind_group.as_deref(), offsets),
                BundleCommand::SetVertexBuffer {
                    slot,
                    buffer,
                    offset,
                    end,
                } => encoder.set_vertex_buffer(*slot, buffer.slice(*offset..*end)),
                BundleCommand::SetIndexBuffer {
                    buffer,
                    format,
                    offset,
                    end,
                } => encoder.set_index_buffer(buffer.slice(*offset..*end), *format),
                BundleCommand::Draw {
                    vertices,
                    instances,
                } => encoder.draw(vertices.clone(), instances.clone()),
                BundleCommand::DrawIndexed {
                    indices,
                    base_vertex,
                    instances,
                } => encoder.draw_indexed(indices.clone(), *base_vertex, instances.clone()),
                BundleCommand::DrawIndirect { buffer, offset } => {
                    encoder.draw_indirect(buffer, *offset)
                }
                BundleCommand::DrawIndexedIndirect { buffer, offset } => {
                    encoder.draw_indexed_indirect(buffer, *offset)
                }
                BundleCommand::SetImmediates { offset, data } => {
                    encoder.set_immediates(*offset, data)
                }
            }
        }

        let label = descriptor.and_then(|d| d.label);
        let bundle = encoder.finish(&wgpu::RenderBundleDescriptor {
            label: label.as_deref(),
        });
        Ok(GpuRenderBundle {
            inner: Arc::new(bundle),
            label: Mutex::new(label),
        })
    }
}
