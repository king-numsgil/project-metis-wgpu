use super::bind_group::GpuBindGroup;
use super::buffer::GpuBuffer;
use super::convert;
use super::pipeline::{GpuComputePipeline, GpuRenderPipeline};
use super::query_set::GpuQuerySet;
use super::texture::{GpuTextureView, GpuImageCopyTexture, GpuImageCopyBuffer, GpuExtent3D};
use napi::bindgen_prelude::Reference;
use napi_derive::napi;
use std::sync::{Arc, Mutex};

// ── Shared encoder state ──────────────────────────────────────────────────────

pub(crate) struct EncoderState {
    pub encoder: Option<wgpu::CommandEncoder>,
}

// ── Command buffer ────────────────────────────────────────────────────────────

#[napi]
pub struct GpuCommandBuffer {
    pub(crate) inner: Mutex<Option<wgpu::CommandBuffer>>,
}

impl GpuCommandBuffer {
    pub(crate) fn take(&self) -> Option<wgpu::CommandBuffer> {
        self.inner.lock().unwrap().take()
    }
}

// ── Descriptor types ──────────────────────────────────────────────────────────

#[napi(object)]
pub struct GpuColor {
    pub r: f64,
    pub g: f64,
    pub b: f64,
    pub a: f64,
}

#[napi(object)]
pub struct GpuRenderPassColorAttachment {
    pub view: Reference<GpuTextureView>,
    pub resolve_target: Option<Reference<GpuTextureView>>,
    pub clear_value: Option<GpuColor>,
    #[napi(ts_type = "GPULoadOp")]
    pub load_op: String,
    #[napi(ts_type = "GPUStoreOp")]
    pub store_op: String,
}

#[napi(object)]
pub struct GpuRenderPassDepthStencilAttachment {
    pub view: Reference<GpuTextureView>,
    #[napi(ts_type = "GPULoadOp")]
    pub depth_load_op: Option<String>,
    #[napi(ts_type = "GPUStoreOp")]
    pub depth_store_op: Option<String>,
    pub depth_clear_value: Option<f64>,
    pub depth_read_only: Option<bool>,
    #[napi(ts_type = "GPULoadOp")]
    pub stencil_load_op: Option<String>,
    #[napi(ts_type = "GPUStoreOp")]
    pub stencil_store_op: Option<String>,
    pub stencil_clear_value: Option<u32>,
    pub stencil_read_only: Option<bool>,
}

#[napi(object)]
pub struct GpuRenderPassTimestampWrites {
    pub query_set: Reference<GpuQuerySet>,
    pub beginning_of_pass_write_index: Option<u32>,
    pub end_of_pass_write_index: Option<u32>,
}

#[napi(object)]
pub struct GpuRenderPassDescriptor {
    pub label: Option<String>,
    pub color_attachments: Vec<Option<GpuRenderPassColorAttachment>>,
    pub depth_stencil_attachment: Option<GpuRenderPassDepthStencilAttachment>,
    pub occlusion_query_set: Option<Reference<GpuQuerySet>>,
    pub timestamp_writes: Option<GpuRenderPassTimestampWrites>,
    pub max_draw_count: Option<f64>,
}

#[napi(object)]
pub struct GpuComputePassTimestampWrites {
    pub query_set: Reference<GpuQuerySet>,
    pub beginning_of_pass_write_index: Option<u32>,
    pub end_of_pass_write_index: Option<u32>,
}

#[napi(object)]
pub struct GpuComputePassDescriptor {
    pub label: Option<String>,
    pub timestamp_writes: Option<GpuComputePassTimestampWrites>,
}

#[napi(object)]
pub struct GpuCommandEncoderDescriptor {
    pub label: Option<String>,
}

// ── Render pass encoder ───────────────────────────────────────────────────────

// Non-napi helper so vector::VectorContext can drive the pass without wrapping
// every wgpu resource in a napi type.
impl GpuRenderPassEncoder {
    pub(crate) fn with_pass_raw<F, R>(&self, f: F) -> napi::Result<R>
    where
        F: FnOnce(&mut wgpu::RenderPass<'static>) -> napi::Result<R>,
    {
        let mut g = self.pass.lock().unwrap();
        let pass = g.as_mut().ok_or_else(|| {
            napi::Error::new(napi::Status::GenericFailure, "RenderPass already ended")
        })?;
        f(pass)
    }
}

#[napi]
pub struct GpuRenderPassEncoder {
    // SAFETY: lifetime erased to 'static. Invariants:
    // 1. encoder_storage holds Box<CommandEncoder> whose address pass borrows.
    // 2. encoder_storage must not be accessed while pass is Some.
    // 3. pass must be dropped before moving encoder out of encoder_storage.
    pass: Mutex<Option<wgpu::RenderPass<'static>>>,
    encoder_storage: Mutex<Option<Box<wgpu::CommandEncoder>>>,
    encoder_state: Arc<Mutex<EncoderState>>,
}

#[napi]
impl GpuRenderPassEncoder {
    #[napi]
    pub fn set_pipeline(&self, pipeline: &GpuRenderPipeline) -> napi::Result<()> {
        self.pass.lock().unwrap().as_mut()
            .ok_or_else(|| napi::Error::new(napi::Status::GenericFailure, "RenderPass already ended"))?
            .set_pipeline(&pipeline.inner);
        Ok(())
    }

    #[napi]
    pub fn set_bind_group(&self, index: u32, bind_group: Option<&GpuBindGroup>, dynamic_offsets: Option<Vec<u32>>) -> napi::Result<()> {
        let mut g = self.pass.lock().unwrap();
        let pass = g.as_mut().ok_or_else(|| napi::Error::new(napi::Status::GenericFailure, "RenderPass already ended"))?;
        let offsets = dynamic_offsets.as_deref().unwrap_or(&[]);
        match bind_group {
            Some(bg) => pass.set_bind_group(index, Some(&*bg.inner), offsets),
            None => pass.set_bind_group(index, None, offsets),
        }
        Ok(())
    }

    #[napi]
    pub fn set_vertex_buffer(&self, slot: u32, buffer: &GpuBuffer, offset: Option<f64>, size: Option<f64>) -> napi::Result<()> {
        let mut g = self.pass.lock().unwrap();
        let pass = g.as_mut().ok_or_else(|| napi::Error::new(napi::Status::GenericFailure, "RenderPass already ended"))?;
        let offset = offset.unwrap_or(0.0) as u64;
        let end = size.map_or(buffer.size, |s| offset + s as u64);
        pass.set_vertex_buffer(slot, buffer.inner.slice(offset..end));
        Ok(())
    }

    #[napi]
    pub fn set_index_buffer(&self, buffer: &GpuBuffer, #[napi(
        ts_arg_type = "GPUIndexFormat"
    )] index_format: String, offset: Option<f64>, size: Option<f64>) -> napi::Result<()> {
        let mut g = self.pass.lock().unwrap();
        let pass = g.as_mut().ok_or_else(|| napi::Error::new(napi::Status::GenericFailure, "RenderPass already ended"))?;
        let fmt = convert::index_format(&index_format)?;
        let offset = offset.unwrap_or(0.0) as u64;
        let end = size.map_or(buffer.size, |s| offset + s as u64);
        pass.set_index_buffer(buffer.inner.slice(offset..end), fmt);
        Ok(())
    }

    #[napi]
    pub fn draw(&self, vertex_count: u32, instance_count: Option<u32>, first_vertex: Option<u32>, first_instance: Option<u32>) -> napi::Result<()> {
        let fv = first_vertex.unwrap_or(0);
        let fi = first_instance.unwrap_or(0);
        let ic = instance_count.unwrap_or(1);
        let mut g = self.pass.lock().unwrap();
        g.as_mut().ok_or_else(|| napi::Error::new(napi::Status::GenericFailure, "RenderPass already ended"))?
            .draw(fv..fv + vertex_count, fi..fi + ic);
        Ok(())
    }

    #[napi]
    pub fn draw_indexed(&self, index_count: u32, instance_count: Option<u32>, first_index: Option<u32>, base_vertex: Option<i32>, first_instance: Option<u32>) -> napi::Result<()> {
        let fi = first_index.unwrap_or(0);
        let ic = instance_count.unwrap_or(1);
        let fis = first_instance.unwrap_or(0);
        let mut g = self.pass.lock().unwrap();
        g.as_mut().ok_or_else(|| napi::Error::new(napi::Status::GenericFailure, "RenderPass already ended"))?
            .draw_indexed(fi..fi + index_count, base_vertex.unwrap_or(0), fis..fis + ic);
        Ok(())
    }

    #[napi]
    pub fn draw_indirect(&self, indirect_buffer: &GpuBuffer, indirect_offset: f64) -> napi::Result<()> {
        let mut g = self.pass.lock().unwrap();
        g.as_mut().ok_or_else(|| napi::Error::new(napi::Status::GenericFailure, "RenderPass already ended"))?
            .draw_indirect(&indirect_buffer.inner, indirect_offset as u64);
        Ok(())
    }

    #[napi]
    pub fn draw_indexed_indirect(&self, indirect_buffer: &GpuBuffer, indirect_offset: f64) -> napi::Result<()> {
        let mut g = self.pass.lock().unwrap();
        g.as_mut().ok_or_else(|| napi::Error::new(napi::Status::GenericFailure, "RenderPass already ended"))?
            .draw_indexed_indirect(&indirect_buffer.inner, indirect_offset as u64);
        Ok(())
    }

    #[napi]
    pub fn set_viewport(&self, x: f64, y: f64, width: f64, height: f64, min_depth: f64, max_depth: f64) -> napi::Result<()> {
        let mut g = self.pass.lock().unwrap();
        g.as_mut().ok_or_else(|| napi::Error::new(napi::Status::GenericFailure, "RenderPass already ended"))?
            .set_viewport(x as f32, y as f32, width as f32, height as f32, min_depth as f32, max_depth as f32);
        Ok(())
    }

    #[napi]
    pub fn set_scissor_rect(&self, x: u32, y: u32, width: u32, height: u32) -> napi::Result<()> {
        let mut g = self.pass.lock().unwrap();
        g.as_mut().ok_or_else(|| napi::Error::new(napi::Status::GenericFailure, "RenderPass already ended"))?
            .set_scissor_rect(x, y, width, height);
        Ok(())
    }

    #[napi]
    pub fn set_blend_constant(&self, color: GpuColor) -> napi::Result<()> {
        let mut g = self.pass.lock().unwrap();
        g.as_mut().ok_or_else(|| napi::Error::new(napi::Status::GenericFailure, "RenderPass already ended"))?
            .set_blend_constant(wgpu::Color { r: color.r, g: color.g, b: color.b, a: color.a });
        Ok(())
    }

    #[napi]
    pub fn set_stencil_reference(&self, reference: u32) -> napi::Result<()> {
        let mut g = self.pass.lock().unwrap();
        g.as_mut().ok_or_else(|| napi::Error::new(napi::Status::GenericFailure, "RenderPass already ended"))?
            .set_stencil_reference(reference);
        Ok(())
    }

    #[napi]
    pub fn push_debug_group(&self, group_label: String) -> napi::Result<()> {
        let mut g = self.pass.lock().unwrap();
        g.as_mut().ok_or_else(|| napi::Error::new(napi::Status::GenericFailure, "RenderPass already ended"))?
            .push_debug_group(&group_label);
        Ok(())
    }

    #[napi]
    pub fn pop_debug_group(&self) -> napi::Result<()> {
        let mut g = self.pass.lock().unwrap();
        g.as_mut().ok_or_else(|| napi::Error::new(napi::Status::GenericFailure, "RenderPass already ended"))?
            .pop_debug_group();
        Ok(())
    }

    #[napi]
    pub fn insert_debug_marker(&self, marker_label: String) -> napi::Result<()> {
        let mut g = self.pass.lock().unwrap();
        g.as_mut().ok_or_else(|| napi::Error::new(napi::Status::GenericFailure, "RenderPass already ended"))?
            .insert_debug_marker(&marker_label);
        Ok(())
    }

    #[napi]
    pub fn begin_occlusion_query(&self, query_index: u32) -> napi::Result<()> {
        let mut g = self.pass.lock().unwrap();
        g.as_mut().ok_or_else(|| napi::Error::new(napi::Status::GenericFailure, "RenderPass already ended"))?
            .begin_occlusion_query(query_index);
        Ok(())
    }

    #[napi]
    pub fn end_occlusion_query(&self) -> napi::Result<()> {
        let mut g = self.pass.lock().unwrap();
        g.as_mut().ok_or_else(|| napi::Error::new(napi::Status::GenericFailure, "RenderPass already ended"))?
            .end_occlusion_query();
        Ok(())
    }

    #[napi]
    pub fn set_immediates(&self, offset: u32, data: napi::bindgen_prelude::Uint8Array) -> napi::Result<()> {
        let mut g = self.pass.lock().unwrap();
        g.as_mut().ok_or_else(|| napi::Error::new(napi::Status::GenericFailure, "RenderPass already ended"))?
            .set_push_constants(wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT, offset, &data);
        Ok(())
    }

    /// Writes a timestamp into `querySet` at the point the GPU reaches this
    /// command *within* the pass — the granularity `timestampWrites` can't give
    /// you, since that only brackets the pass as a whole.
    ///
    /// Native-only, and needs both `timestamp-query` and
    /// `timestamp-query-inside-passes`. Calling it without them is a validation
    /// error, which this binding only prints to stderr — gate it on
    /// `adapter.features.has("timestamp-query-inside-passes")`.
    #[napi]
    pub fn write_timestamp(&self, query_set: &GpuQuerySet, query_index: u32) -> napi::Result<()> {
        let mut g = self.pass.lock().unwrap();
        g.as_mut().ok_or_else(|| napi::Error::new(napi::Status::GenericFailure, "RenderPass already ended"))?
            .write_timestamp(&query_set.inner, query_index);
        Ok(())
    }

    #[napi]
    pub fn end(&self) -> napi::Result<()> {
        // Drop pass first to release the mutable borrow of the encoder
        { drop(self.pass.lock().unwrap().take()); }
        let boxed = self.encoder_storage.lock().unwrap().take()
            .ok_or_else(|| napi::Error::new(napi::Status::GenericFailure, "RenderPass already ended"))?;
        self.encoder_state.lock().unwrap().encoder = Some(*boxed);
        Ok(())
    }
}

// ── Compute pass encoder ──────────────────────────────────────────────────────

#[napi]
pub struct GpuComputePassEncoder {
    // Same SAFETY invariants as GpuRenderPassEncoder
    pass: Mutex<Option<wgpu::ComputePass<'static>>>,
    encoder_storage: Mutex<Option<Box<wgpu::CommandEncoder>>>,
    encoder_state: Arc<Mutex<EncoderState>>,
}

#[napi]
impl GpuComputePassEncoder {
    #[napi]
    pub fn set_pipeline(&self, pipeline: &GpuComputePipeline) -> napi::Result<()> {
        let mut g = self.pass.lock().unwrap();
        g.as_mut().ok_or_else(|| napi::Error::new(napi::Status::GenericFailure, "ComputePass already ended"))?
            .set_pipeline(&pipeline.inner);
        Ok(())
    }

    #[napi]
    pub fn set_bind_group(&self, index: u32, bind_group: Option<&GpuBindGroup>, dynamic_offsets: Option<Vec<u32>>) -> napi::Result<()> {
        let mut g = self.pass.lock().unwrap();
        let pass = g.as_mut().ok_or_else(|| napi::Error::new(napi::Status::GenericFailure, "ComputePass already ended"))?;
        let offsets = dynamic_offsets.as_deref().unwrap_or(&[]);
        match bind_group {
            Some(bg) => pass.set_bind_group(index, Some(&*bg.inner), offsets),
            None => pass.set_bind_group(index, None, offsets),
        }
        Ok(())
    }

    #[napi]
    pub fn dispatch_workgroups(&self, x: u32, y: Option<u32>, z: Option<u32>) -> napi::Result<()> {
        let mut g = self.pass.lock().unwrap();
        g.as_mut().ok_or_else(|| napi::Error::new(napi::Status::GenericFailure, "ComputePass already ended"))?
            .dispatch_workgroups(x, y.unwrap_or(1), z.unwrap_or(1));
        Ok(())
    }

    #[napi]
    pub fn push_debug_group(&self, group_label: String) -> napi::Result<()> {
        let mut g = self.pass.lock().unwrap();
        g.as_mut().ok_or_else(|| napi::Error::new(napi::Status::GenericFailure, "ComputePass already ended"))?
            .push_debug_group(&group_label);
        Ok(())
    }

    #[napi]
    pub fn pop_debug_group(&self) -> napi::Result<()> {
        let mut g = self.pass.lock().unwrap();
        g.as_mut().ok_or_else(|| napi::Error::new(napi::Status::GenericFailure, "ComputePass already ended"))?
            .pop_debug_group();
        Ok(())
    }

    #[napi]
    pub fn insert_debug_marker(&self, marker_label: String) -> napi::Result<()> {
        let mut g = self.pass.lock().unwrap();
        g.as_mut().ok_or_else(|| napi::Error::new(napi::Status::GenericFailure, "ComputePass already ended"))?
            .insert_debug_marker(&marker_label);
        Ok(())
    }

    #[napi]
    pub fn dispatch_workgroups_indirect(&self, indirect_buffer: &GpuBuffer, indirect_offset: f64) -> napi::Result<()> {
        let mut g = self.pass.lock().unwrap();
        g.as_mut().ok_or_else(|| napi::Error::new(napi::Status::GenericFailure, "ComputePass already ended"))?
            .dispatch_workgroups_indirect(&indirect_buffer.inner, indirect_offset as u64);
        Ok(())
    }

    #[napi]
    pub fn set_immediates(&self, offset: u32, data: napi::bindgen_prelude::Uint8Array) -> napi::Result<()> {
        let mut g = self.pass.lock().unwrap();
        g.as_mut().ok_or_else(|| napi::Error::new(napi::Status::GenericFailure, "ComputePass already ended"))?
            .set_push_constants(offset, &data);
        Ok(())
    }

    /// Writes a timestamp into `querySet` at the point the GPU reaches this
    /// command *within* the pass — e.g. between two dispatches that
    /// `timestampWrites` would lump together.
    ///
    /// Native-only, and needs both `timestamp-query` and
    /// `timestamp-query-inside-passes`. Calling it without them is a validation
    /// error, which this binding only prints to stderr — gate it on
    /// `adapter.features.has("timestamp-query-inside-passes")`.
    #[napi]
    pub fn write_timestamp(&self, query_set: &GpuQuerySet, query_index: u32) -> napi::Result<()> {
        let mut g = self.pass.lock().unwrap();
        g.as_mut().ok_or_else(|| napi::Error::new(napi::Status::GenericFailure, "ComputePass already ended"))?
            .write_timestamp(&query_set.inner, query_index);
        Ok(())
    }

    #[napi]
    pub fn end(&self) -> napi::Result<()> {
        { drop(self.pass.lock().unwrap().take()); }
        let boxed = self.encoder_storage.lock().unwrap().take()
            .ok_or_else(|| napi::Error::new(napi::Status::GenericFailure, "ComputePass already ended"))?;
        self.encoder_state.lock().unwrap().encoder = Some(*boxed);
        Ok(())
    }
}

// ── Command encoder ───────────────────────────────────────────────────────────

#[napi]
pub struct GpuCommandEncoder {
    state: Arc<Mutex<EncoderState>>,
    label: Option<String>,
}

impl GpuCommandEncoder {
    pub(crate) fn new(encoder: wgpu::CommandEncoder, label: Option<String>) -> Self {
        Self { state: Arc::new(Mutex::new(EncoderState { encoder: Some(encoder) })), label }
    }

    fn with_encoder<F, R>(&self, f: F) -> napi::Result<R>
    where
        F: FnOnce(&mut wgpu::CommandEncoder) -> napi::Result<R>,
    {
        let mut state = self.state.lock().unwrap();
        let enc = state.encoder.as_mut().ok_or_else(|| {
            napi::Error::new(napi::Status::GenericFailure, "CommandEncoder finished or locked by active pass")
        })?;
        f(enc)
    }
}

#[napi]
impl GpuCommandEncoder {
    #[napi(getter)]
    pub fn label(&self) -> Option<String> { self.label.clone() }

    #[napi]
    pub fn begin_render_pass(&self, descriptor: GpuRenderPassDescriptor) -> napi::Result<GpuRenderPassEncoder> {
        // Build color attachments — borrows from descriptor items (all Reference<T> are 'static)
        let mut color_attachments: Vec<Option<wgpu::RenderPassColorAttachment<'_>>> =
            Vec::with_capacity(descriptor.color_attachments.len());
        for maybe_att in &descriptor.color_attachments {
            if let Some(ref att) = maybe_att {
                let clear = att.clear_value.as_ref().map(|c| [c.r, c.g, c.b, c.a]);
                let mut ops = convert::color_load_op(&att.load_op, clear)?;
                ops.store = convert::store_op(&att.store_op)?;
                color_attachments.push(Some(wgpu::RenderPassColorAttachment {
                    view: att.view.inner.as_ref(),
                    resolve_target: att.resolve_target.as_ref().map(|rv| rv.inner.as_ref()),
                    ops,
                }));
            } else {
                color_attachments.push(None);
            }
        }

        // Build depth/stencil attachment as an owned value (not a reference to a local)
        let ds_attachment: Option<wgpu::RenderPassDepthStencilAttachment<'_>> =
            if let Some(ref d) = descriptor.depth_stencil_attachment {
                let depth_ops = convert::depth_ops(
                    d.depth_load_op.as_deref(),
                    d.depth_store_op.as_deref(),
                    d.depth_clear_value,
                )?;
                let stencil_ops = convert::stencil_ops(
                    d.stencil_load_op.as_deref(),
                    d.stencil_store_op.as_deref(),
                    d.stencil_clear_value,
                )?;
                Some(wgpu::RenderPassDepthStencilAttachment {
                    view: d.view.inner.as_ref(),
                    depth_ops,
                    stencil_ops,
                })
            } else {
                None
            };

        // Build timestamp writes as an owned value
        let ts_attachment: Option<wgpu::RenderPassTimestampWrites<'_>> =
            if let Some(ref tw) = descriptor.timestamp_writes {
                Some(wgpu::RenderPassTimestampWrites {
                    query_set: tw.query_set.inner.as_ref(),
                    beginning_of_pass_write_index: tw.beginning_of_pass_write_index,
                    end_of_pass_write_index: tw.end_of_pass_write_index,
                })
            } else {
                None
            };

        let occlusion_qs: Option<&wgpu::QuerySet> =
            descriptor.occlusion_query_set.as_ref().map(|qs| qs.inner.as_ref());

        // Take encoder out of shared state and heap-allocate for stable address
        let mut state_guard = self.state.lock().unwrap();
        let encoder = state_guard.encoder.take().ok_or_else(|| {
            napi::Error::new(napi::Status::GenericFailure, "CommandEncoder locked by active pass or already finished")
        })?;
        let mut boxed = Box::new(encoder);

        // SAFETY:
        // - boxed heap-allocates CommandEncoder at a stable address.
        // - RenderPass<'static> holds a mutable borrow of the encoder via raw pointer.
        // - encoder_storage keeps boxed alive alongside the pass.
        // - end() drops the pass before moving encoder back.
        // - All texture/query-set resources remain alive via their own Arcs.
        let render_pass: wgpu::RenderPass<'static> = unsafe {
            let ptr = boxed.as_mut() as *mut wgpu::CommandEncoder;
            let enc_ref: &'static mut wgpu::CommandEncoder = &mut *ptr;
            let pass = enc_ref.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: descriptor.label.as_deref(),
                color_attachments: &color_attachments,
                depth_stencil_attachment: ds_attachment,
                timestamp_writes: ts_attachment,
                occlusion_query_set: occlusion_qs,
            });
            std::mem::transmute::<wgpu::RenderPass<'_>, wgpu::RenderPass<'static>>(pass)
        };
        drop(state_guard);

        Ok(GpuRenderPassEncoder {
            pass: Mutex::new(Some(render_pass)),
            encoder_storage: Mutex::new(Some(boxed)),
            encoder_state: Arc::clone(&self.state),
        })
    }

    #[napi]
    pub fn begin_compute_pass(&self, descriptor: Option<GpuComputePassDescriptor>) -> napi::Result<GpuComputePassEncoder> {
        // Borrow, don't clone: `descriptor` is owned by this call and outlives
        // the pass creation below. begin_render_pass already does it this way.
        let label = descriptor.as_ref().and_then(|d| d.label.as_deref());

        // Build timestamp writes as an owned value
        let ts_attachment: Option<wgpu::ComputePassTimestampWrites<'_>> =
            if let Some(ref d) = descriptor {
                if let Some(ref tw) = d.timestamp_writes {
                    Some(wgpu::ComputePassTimestampWrites {
                        query_set: tw.query_set.inner.as_ref(),
                        beginning_of_pass_write_index: tw.beginning_of_pass_write_index,
                        end_of_pass_write_index: tw.end_of_pass_write_index,
                    })
                } else {
                    None
                }
            } else {
                None
            };

        let mut state_guard = self.state.lock().unwrap();
        let encoder = state_guard.encoder.take().ok_or_else(|| {
            napi::Error::new(napi::Status::GenericFailure, "CommandEncoder locked by active pass or already finished")
        })?;
        let mut boxed = Box::new(encoder);

        // SAFETY: same invariants as begin_render_pass
        let compute_pass: wgpu::ComputePass<'static> = unsafe {
            let ptr = boxed.as_mut() as *mut wgpu::CommandEncoder;
            let enc_ref: &'static mut wgpu::CommandEncoder = &mut *ptr;
            let pass = enc_ref.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label,
                timestamp_writes: ts_attachment,
            });
            std::mem::transmute::<wgpu::ComputePass<'_>, wgpu::ComputePass<'static>>(pass)
        };
        drop(state_guard);

        Ok(GpuComputePassEncoder {
            pass: Mutex::new(Some(compute_pass)),
            encoder_storage: Mutex::new(Some(boxed)),
            encoder_state: Arc::clone(&self.state),
        })
    }

    #[napi]
    pub fn copy_buffer_to_buffer(
        &self,
        source: &GpuBuffer,
        source_offset: f64,
        destination: &GpuBuffer,
        destination_offset: f64,
        size: f64,
    ) -> napi::Result<()> {
        self.with_encoder(|enc| {
            enc.copy_buffer_to_buffer(
                &source.inner,
                source_offset as u64,
                &destination.inner,
                destination_offset as u64,
                size as u64,
            );
            Ok(())
        })
    }

    #[napi]
    pub fn copy_buffer_to_texture(
        &self,
        source: GpuImageCopyBuffer,
        destination: GpuImageCopyTexture,
        copy_size: GpuExtent3D,
    ) -> napi::Result<()> {
        self.with_encoder(|enc| {
            let src = wgpu::TexelCopyBufferInfo {
                buffer: source.buffer.inner.as_ref(),
                layout: wgpu::TexelCopyBufferLayout {
                    offset: source.offset.unwrap_or(0.0) as u64,
                    bytes_per_row: source.bytes_per_row,
                    rows_per_image: source.rows_per_image,
                },
            };
            let aspect = destination.aspect.as_deref().map(convert::texture_aspect).transpose()?
                .unwrap_or(wgpu::TextureAspect::All);
            let origin = destination.origin.as_ref()
                .map(|o| wgpu::Origin3d { x: o.x.unwrap_or(0), y: o.y.unwrap_or(0), z: o.z.unwrap_or(0) })
                .unwrap_or(wgpu::Origin3d::ZERO);
            let dst = wgpu::TexelCopyTextureInfo {
                texture: destination.texture.inner.as_ref(),
                mip_level: destination.mip_level.unwrap_or(0),
                origin,
                aspect,
            };
            let size = wgpu::Extent3d {
                width: copy_size.width,
                height: copy_size.height.unwrap_or(1),
                depth_or_array_layers: copy_size.depth_or_array_layers.unwrap_or(1),
            };
            enc.copy_buffer_to_texture(src, dst, size);
            Ok(())
        })
    }

    #[napi]
    pub fn copy_texture_to_buffer(
        &self,
        source: GpuImageCopyTexture,
        destination: GpuImageCopyBuffer,
        copy_size: GpuExtent3D,
    ) -> napi::Result<()> {
        self.with_encoder(|enc| {
            let aspect = source.aspect.as_deref().map(convert::texture_aspect).transpose()?
                .unwrap_or(wgpu::TextureAspect::All);
            let origin = source.origin.as_ref()
                .map(|o| wgpu::Origin3d { x: o.x.unwrap_or(0), y: o.y.unwrap_or(0), z: o.z.unwrap_or(0) })
                .unwrap_or(wgpu::Origin3d::ZERO);
            let src = wgpu::TexelCopyTextureInfo {
                texture: source.texture.inner.as_ref(),
                mip_level: source.mip_level.unwrap_or(0),
                origin,
                aspect,
            };
            let dst = wgpu::TexelCopyBufferInfo {
                buffer: destination.buffer.inner.as_ref(),
                layout: wgpu::TexelCopyBufferLayout {
                    offset: destination.offset.unwrap_or(0.0) as u64,
                    bytes_per_row: destination.bytes_per_row,
                    rows_per_image: destination.rows_per_image,
                },
            };
            let size = wgpu::Extent3d {
                width: copy_size.width,
                height: copy_size.height.unwrap_or(1),
                depth_or_array_layers: copy_size.depth_or_array_layers.unwrap_or(1),
            };
            enc.copy_texture_to_buffer(src, dst, size);
            Ok(())
        })
    }

    #[napi]
    pub fn copy_texture_to_texture(
        &self,
        source: GpuImageCopyTexture,
        destination: GpuImageCopyTexture,
        copy_size: GpuExtent3D,
    ) -> napi::Result<()> {
        let src_aspect = source.aspect.as_deref().map(convert::texture_aspect).transpose()?
            .unwrap_or(wgpu::TextureAspect::All);
        let src_origin = source.origin.as_ref()
            .map(|o| wgpu::Origin3d { x: o.x.unwrap_or(0), y: o.y.unwrap_or(0), z: o.z.unwrap_or(0) })
            .unwrap_or(wgpu::Origin3d::ZERO);
        let dst_aspect = destination.aspect.as_deref().map(convert::texture_aspect).transpose()?
            .unwrap_or(wgpu::TextureAspect::All);
        let dst_origin = destination.origin.as_ref()
            .map(|o| wgpu::Origin3d { x: o.x.unwrap_or(0), y: o.y.unwrap_or(0), z: o.z.unwrap_or(0) })
            .unwrap_or(wgpu::Origin3d::ZERO);
        self.with_encoder(|enc| {
            let src = wgpu::TexelCopyTextureInfo {
                texture: source.texture.inner.as_ref(),
                mip_level: source.mip_level.unwrap_or(0),
                origin: src_origin,
                aspect: src_aspect,
            };
            let dst = wgpu::TexelCopyTextureInfo {
                texture: destination.texture.inner.as_ref(),
                mip_level: destination.mip_level.unwrap_or(0),
                origin: dst_origin,
                aspect: dst_aspect,
            };
            let size = wgpu::Extent3d {
                width: copy_size.width,
                height: copy_size.height.unwrap_or(1),
                depth_or_array_layers: copy_size.depth_or_array_layers.unwrap_or(1),
            };
            enc.copy_texture_to_texture(src, dst, size);
            Ok(())
        })
    }

    #[napi]
    pub fn clear_buffer(&self, buffer: &GpuBuffer, offset: Option<f64>, size: Option<f64>) -> napi::Result<()> {
        self.with_encoder(|enc| {
            enc.clear_buffer(&buffer.inner, offset.unwrap_or(0.0) as u64, size.map(|s| s as u64));
            Ok(())
        })
    }

    /// Writes a timestamp into `querySet` at this point in the encoder's command
    /// stream — i.e. *between* passes, measuring a span that brackets whole
    /// passes plus the copies between them.
    ///
    /// Native-only, and needs both `timestamp-query` and
    /// `timestamp-query-inside-encoders`. Calling it without them is a
    /// validation error, which this binding only prints to stderr — gate it on
    /// `adapter.features.has("timestamp-query-inside-encoders")`.
    #[napi]
    pub fn write_timestamp(&self, query_set: &GpuQuerySet, query_index: u32) -> napi::Result<()> {
        self.with_encoder(|enc| {
            enc.write_timestamp(&query_set.inner, query_index);
            Ok(())
        })
    }

    #[napi]
    pub fn resolve_query_set(
        &self,
        query_set: &GpuQuerySet,
        first_query: u32,
        query_count: u32,
        destination: &GpuBuffer,
        destination_offset: f64,
    ) -> napi::Result<()> {
        self.with_encoder(|enc| {
            enc.resolve_query_set(
                &query_set.inner,
                first_query..first_query + query_count,
                &destination.inner,
                destination_offset as u64,
            );
            Ok(())
        })
    }

    #[napi]
    pub fn push_debug_group(&self, group_label: String) -> napi::Result<()> {
        self.with_encoder(|enc| {
            enc.push_debug_group(&group_label);
            Ok(())
        })
    }

    #[napi]
    pub fn pop_debug_group(&self) -> napi::Result<()> {
        self.with_encoder(|enc| {
            enc.pop_debug_group();
            Ok(())
        })
    }

    #[napi]
    pub fn insert_debug_marker(&self, marker_label: String) -> napi::Result<()> {
        self.with_encoder(|enc| {
            enc.insert_debug_marker(&marker_label);
            Ok(())
        })
    }

    #[napi]
    pub fn finish(&self, _descriptor: Option<GpuCommandEncoderDescriptor>) -> napi::Result<GpuCommandBuffer> {
        let mut state = self.state.lock().unwrap();
        let encoder = state.encoder.take().ok_or_else(|| {
            napi::Error::new(napi::Status::GenericFailure, "CommandEncoder already finished or locked by active pass")
        })?;
        Ok(GpuCommandBuffer { inner: Mutex::new(Some(encoder.finish())) })
    }
}
