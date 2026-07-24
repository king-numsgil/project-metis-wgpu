use super::bind_group::{GpuBindGroupLayout, GpuPipelineLayout};
use super::convert;
use super::shader::GpuShaderModule;
use napi::bindgen_prelude::Reference;
use napi_derive::napi;
use std::sync::Arc;

// ── Owned (Send) pipeline args for async creation ─────────────────────────────

pub(crate) struct OwnedComputeArgs {
    pub label: Option<String>,
    pub layout: Option<Arc<wgpu::PipelineLayout>>,
    pub module: Arc<wgpu::ShaderModule>,
    pub entry_point: Option<String>,
}

pub(crate) struct OwnedFragmentArgs {
    pub module: Arc<wgpu::ShaderModule>,
    pub ep: Option<String>,
    pub targets: Vec<Option<wgpu::ColorTargetState>>,
}

pub(crate) struct OwnedRenderArgs {
    pub label: Option<String>,
    pub layout: Option<Arc<wgpu::PipelineLayout>>,
    pub vertex_module: Arc<wgpu::ShaderModule>,
    pub vertex_ep: Option<String>,
    /// Index-aligned with the caller's `vertex.buffers`; `None` is a `null`
    /// slot, which must be preserved so later buffers keep their slot indices.
    pub vertex_buffers: Vec<Option<(u64, wgpu::VertexStepMode, Vec<wgpu::VertexAttribute>)>>,
    pub primitive: wgpu::PrimitiveState,
    pub depth_stencil: Option<wgpu::DepthStencilState>,
    pub multisample: wgpu::MultisampleState,
    pub fragment: Option<OwnedFragmentArgs>,
}

// ── Layout or "auto" ──────────────────────────────────────────────────────────

/// Represents `GPUPipelineLayout | "auto"`. Implements `FromNapiValue` manually
/// so it can handle both a string value ("auto") and a GpuPipelineLayout object.
pub struct PipelineLayoutOrAuto(pub Option<Arc<wgpu::PipelineLayout>>);

impl napi::bindgen_prelude::TypeName for PipelineLayoutOrAuto {
    fn type_name() -> &'static str {
        "GPUPipelineLayout | \"auto\""
    }
    fn value_type() -> napi::ValueType {
        napi::ValueType::Unknown
    }
}

impl napi::bindgen_prelude::ValidateNapiValue for PipelineLayoutOrAuto {}

impl napi::bindgen_prelude::FromNapiValue for PipelineLayoutOrAuto {
    unsafe fn from_napi_value(
        env: napi::sys::napi_env,
        napi_val: napi::sys::napi_value,
    ) -> napi::Result<Self> {
        // Check the JS type using raw integer constants from napi-sys
        let mut ty: napi::sys::napi_valuetype = 0;
        napi::sys::napi_typeof(env, napi_val, &mut ty);

        // napi_string = 4 (from napi::sys::ValueType::napi_string)
        if ty == napi::sys::ValueType::napi_string {
            // "auto" string — layout = None
            return Ok(PipelineLayoutOrAuto(None));
        }

        // Otherwise expect a GpuPipelineLayout object — unwrap via Reference
        let reference = Reference::<GpuPipelineLayout>::from_napi_value(env, napi_val)?;
        let arc = Arc::clone(&reference.inner);
        Ok(PipelineLayoutOrAuto(Some(arc)))
    }
}

impl napi::bindgen_prelude::ToNapiValue for PipelineLayoutOrAuto {
    unsafe fn to_napi_value(
        env: napi::sys::napi_env,
        _val: Self,
    ) -> napi::Result<napi::sys::napi_value> {
        // Descriptor structs are input-only; this path is never called.
        // Return undefined as a safe no-op.
        let mut result = std::ptr::null_mut();
        napi::sys::napi_get_undefined(env, &mut result);
        Ok(result)
    }
}

// ── Compute pipeline ──────────────────────────────────────────────────────────

#[napi(object)]
pub struct GpuProgrammableStage {
    pub module: Reference<GpuShaderModule>,
    pub entry_point: Option<String>,
}

#[napi(object)]
pub struct GpuComputePipelineDescriptor {
    pub label: Option<String>,
    #[napi(ts_type = "GpuPipelineLayout | 'auto'")]
    pub layout: PipelineLayoutOrAuto,
    pub compute: GpuProgrammableStage,
}

#[napi]
pub struct GpuComputePipeline {
    pub(crate) inner: Arc<wgpu::ComputePipeline>,
}

impl GpuComputePipeline {
    pub(crate) fn new(inner: wgpu::ComputePipeline) -> Self {
        Self { inner: Arc::new(inner) }
    }
}

#[napi]
impl GpuComputePipeline {
    #[napi]
    pub fn get_bind_group_layout(&self, index: u32) -> GpuBindGroupLayout {
        GpuBindGroupLayout::new(self.inner.get_bind_group_layout(index))
    }
}

// ── Render pipeline ───────────────────────────────────────────────────────────

#[napi(object)]
pub struct GpuBlendComponent {
    #[napi(ts_type = "GPUBlendOperation")]
    pub operation: Option<String>,
    #[napi(ts_type = "GPUBlendFactor")]
    pub src_factor: Option<String>,
    #[napi(ts_type = "GPUBlendFactor")]
    pub dst_factor: Option<String>,
}

#[napi(object)]
pub struct GpuBlendState {
    pub color: GpuBlendComponent,
    pub alpha: GpuBlendComponent,
}

#[napi(object)]
pub struct GpuColorTargetState {
    #[napi(ts_type = "GPUTextureFormat")]
    pub format: String,
    pub blend: Option<GpuBlendState>,
    pub write_mask: Option<u32>,
}

#[napi(object)]
pub struct GpuFragmentState {
    pub module: Reference<GpuShaderModule>,
    pub entry_point: Option<String>,
    pub targets: Vec<Option<GpuColorTargetState>>,
}

#[napi(object)]
pub struct GpuVertexAttribute {
    #[napi(ts_type = "GPUVertexFormat")]
    pub format: String,
    pub offset: f64,
    pub shader_location: u32,
}

#[napi(object)]
pub struct GpuVertexBufferLayout {
    pub array_stride: f64,
    #[napi(ts_type = "GPUVertexStepMode")]
    pub step_mode: Option<String>,
    pub attributes: Vec<GpuVertexAttribute>,
}

#[napi(object)]
pub struct GpuVertexState {
    pub module: Reference<GpuShaderModule>,
    pub entry_point: Option<String>,
    pub buffers: Option<Vec<Option<GpuVertexBufferLayout>>>,
}

#[napi(object)]
pub struct GpuPrimitiveState {
    #[napi(ts_type = "GPUPrimitiveTopology")]
    pub topology: Option<String>,
    #[napi(ts_type = "GPUIndexFormat")]
    pub strip_index_format: Option<String>,
    #[napi(ts_type = "GPUFrontFace")]
    pub front_face: Option<String>,
    #[napi(ts_type = "GPUCullMode")]
    pub cull_mode: Option<String>,
    pub unclipped_depth: Option<bool>,
}

#[napi(object)]
pub struct GpuStencilFaceState {
    #[napi(ts_type = "GPUCompareFunction")]
    pub compare: Option<String>,
    #[napi(ts_type = "GPUStencilOperation")]
    pub fail_op: Option<String>,
    #[napi(ts_type = "GPUStencilOperation")]
    pub depth_fail_op: Option<String>,
    #[napi(ts_type = "GPUStencilOperation")]
    pub pass_op: Option<String>,
}

#[napi(object)]
pub struct GpuDepthStencilState {
    #[napi(ts_type = "GPUTextureFormat")]
    pub format: String,
    pub depth_write_enabled: Option<bool>,
    #[napi(ts_type = "GPUCompareFunction")]
    pub depth_compare: Option<String>,
    pub stencil_front: Option<GpuStencilFaceState>,
    pub stencil_back: Option<GpuStencilFaceState>,
    pub stencil_read_mask: Option<u32>,
    pub stencil_write_mask: Option<u32>,
    pub depth_bias: Option<i32>,
    pub depth_bias_slope_scale: Option<f64>,
    pub depth_bias_clamp: Option<f64>,
}

#[napi(object)]
pub struct GpuMultisampleState {
    pub count: Option<u32>,
    pub mask: Option<u32>,
    pub alpha_to_coverage_enabled: Option<bool>,
}

#[napi(object)]
pub struct GpuRenderPipelineDescriptor {
    pub label: Option<String>,
    #[napi(ts_type = "GpuPipelineLayout | 'auto'")]
    pub layout: PipelineLayoutOrAuto,
    pub vertex: GpuVertexState,
    pub primitive: Option<GpuPrimitiveState>,
    pub depth_stencil: Option<GpuDepthStencilState>,
    pub multisample: Option<GpuMultisampleState>,
    pub fragment: Option<GpuFragmentState>,
}

#[napi]
pub struct GpuRenderPipeline {
    pub(crate) inner: Arc<wgpu::RenderPipeline>,
}

impl GpuRenderPipeline {
    pub(crate) fn new(inner: wgpu::RenderPipeline) -> Self {
        Self { inner: Arc::new(inner) }
    }
}

#[napi]
impl GpuRenderPipeline {
    #[napi]
    pub fn get_bind_group_layout(&self, index: u32) -> GpuBindGroupLayout {
        GpuBindGroupLayout::new(self.inner.get_bind_group_layout(index))
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn blend_component(c: &GpuBlendComponent) -> napi::Result<wgpu::BlendComponent> {
    Ok(wgpu::BlendComponent {
        operation: c.operation.as_deref().map(convert::blend_operation).transpose()?.unwrap_or(wgpu::BlendOperation::Add),
        src_factor: c.src_factor.as_deref().map(convert::blend_factor).transpose()?.unwrap_or(wgpu::BlendFactor::One),
        dst_factor: c.dst_factor.as_deref().map(convert::blend_factor).transpose()?.unwrap_or(wgpu::BlendFactor::Zero),
    })
}

fn stencil_face(s: &Option<GpuStencilFaceState>) -> napi::Result<wgpu::StencilFaceState> {
    let s = match s {
        None => return Ok(wgpu::StencilFaceState::IGNORE),
        Some(s) => s
    };
    Ok(wgpu::StencilFaceState {
        compare: s.compare.as_deref().map(convert::compare_function).transpose()?.unwrap_or(wgpu::CompareFunction::Always),
        fail_op: s.fail_op.as_deref().map(convert::stencil_operation).transpose()?.unwrap_or(wgpu::StencilOperation::Keep),
        depth_fail_op: s.depth_fail_op.as_deref().map(convert::stencil_operation).transpose()?.unwrap_or(wgpu::StencilOperation::Keep),
        pass_op: s.pass_op.as_deref().map(convert::stencil_operation).transpose()?.unwrap_or(wgpu::StencilOperation::Keep),
    })
}

// ── Builders ──────────────────────────────────────────────────────────────────

pub fn build_compute_pipeline(device: &wgpu::Device, desc: &GpuComputePipelineDescriptor) -> napi::Result<GpuComputePipeline> {
    let layout: Option<&wgpu::PipelineLayout> = desc.layout.0.as_deref();

    let ep = desc.compute.entry_point.as_deref();
    let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
        label: desc.label.as_deref(),
        layout,
        module: &desc.compute.module.inner,
        entry_point: ep,
        compilation_options: wgpu::PipelineCompilationOptions::default(),
        cache: None,
    });
    Ok(GpuComputePipeline::new(pipeline))
}

pub fn build_render_pipeline(device: &wgpu::Device, desc: &GpuRenderPipelineDescriptor) -> napi::Result<GpuRenderPipeline> {
    // Vertex buffers.
    //
    // A `null` entry in `vertex.buffers` is a *used slot with no buffer* — the
    // spec keeps it in place so the entries that follow keep their slot indices.
    // These two vectors therefore stay index-aligned with the caller's array and
    // carry `None` through; dropping the holes (as this did before wgpu 30 gave
    // us `Option` here) silently shifts every later buffer down a slot.
    let mut vert_attrs_storage: Vec<Option<Vec<wgpu::VertexAttribute>>> = Vec::new();
    let mut vert_buffers: Vec<Option<wgpu::VertexBufferLayout<'_>>> = Vec::new();

    if let Some(ref buffers) = desc.vertex.buffers {
        for maybe_buf in buffers {
            let attrs = match maybe_buf {
                Some(buf) => Some(
                    buf.attributes
                        .iter()
                        .map(|a| -> napi::Result<_> {
                            Ok(wgpu::VertexAttribute {
                                format: convert::vertex_format(&a.format)?,
                                offset: a.offset as u64,
                                shader_location: a.shader_location,
                            })
                        })
                        .collect::<napi::Result<_>>()?,
                ),
                None => None,
            };
            vert_attrs_storage.push(attrs);
        }
        for (maybe_buf, attrs) in buffers.iter().zip(vert_attrs_storage.iter()) {
            match (maybe_buf, attrs) {
                (Some(buf), Some(attrs)) => {
                    let step_mode = buf.step_mode.as_deref().map(convert::vertex_step_mode).transpose()?.unwrap_or(wgpu::VertexStepMode::Vertex);
                    vert_buffers.push(Some(wgpu::VertexBufferLayout {
                        array_stride: buf.array_stride as u64,
                        step_mode,
                        attributes: attrs,
                    }));
                }
                _ => vert_buffers.push(None),
            }
        }
    }

    // Fragment targets
    let mut frag_targets: Vec<Option<wgpu::ColorTargetState>> = Vec::new();
    if let Some(ref frag) = desc.fragment {
        for maybe_target in &frag.targets {
            if let Some(ref t) = maybe_target {
                let blend = if let Some(ref b) = t.blend {
                    Some(wgpu::BlendState { color: blend_component(&b.color)?, alpha: blend_component(&b.alpha)? })
                } else {
                    None
                };
                frag_targets.push(Some(wgpu::ColorTargetState {
                    format: convert::texture_format(&t.format)?,
                    blend,
                    write_mask: convert::color_write(t.write_mask.unwrap_or(0xF)),
                }));
            } else {
                frag_targets.push(None);
            }
        }
    }

    // Depth/stencil
    let depth_stencil = if let Some(ref ds) = desc.depth_stencil {
        Some(wgpu::DepthStencilState {
            format: convert::texture_format(&ds.format)?,
            // Both are `Option` in wgpu 30, matching the spec: "not provided"
            // is distinct from `false`/`always`, and is what a depth-less
            // (stencil-only) attachment wants. Pass the caller's intent through
            // rather than inventing a default.
            depth_write_enabled: ds.depth_write_enabled,
            depth_compare: ds.depth_compare.as_deref().map(convert::compare_function).transpose()?,
            stencil: wgpu::StencilState {
                front: stencil_face(&ds.stencil_front)?,
                back: stencil_face(&ds.stencil_back)?,
                read_mask: ds.stencil_read_mask.unwrap_or(0xFFFF_FFFF),
                write_mask: ds.stencil_write_mask.unwrap_or(0xFFFF_FFFF),
            },
            bias: wgpu::DepthBiasState {
                constant: ds.depth_bias.unwrap_or(0),
                slope_scale: ds.depth_bias_slope_scale.unwrap_or(0.0) as f32,
                clamp: ds.depth_bias_clamp.unwrap_or(0.0) as f32,
            },
        })
    } else {
        None
    };

    // Primitive
    let prim = if let Some(ref p) = desc.primitive {
        wgpu::PrimitiveState {
            topology: p.topology.as_deref().map(convert::primitive_topology).transpose()?.unwrap_or(wgpu::PrimitiveTopology::TriangleList),
            strip_index_format: p.strip_index_format.as_deref().map(convert::index_format).transpose()?,
            front_face: p.front_face.as_deref().map(convert::front_face).transpose()?.unwrap_or(wgpu::FrontFace::Ccw),
            cull_mode: p.cull_mode.as_deref().map(convert::cull_mode).transpose()?.flatten(),
            unclipped_depth: p.unclipped_depth.unwrap_or(false),
            ..Default::default()
        }
    } else {
        wgpu::PrimitiveState::default()
    };

    // Multisample
    let multisample = if let Some(ref ms) = desc.multisample {
        wgpu::MultisampleState {
            count: ms.count.unwrap_or(1),
            mask: ms.mask.unwrap_or(!0) as u64,
            alpha_to_coverage_enabled: ms.alpha_to_coverage_enabled.unwrap_or(false),
        }
    } else {
        wgpu::MultisampleState::default()
    };

    // Pipeline layout
    let layout: Option<&wgpu::PipelineLayout> = desc.layout.0.as_deref();

    // Fragment
    let fragment = if let Some(ref frag) = desc.fragment {
        Some(wgpu::FragmentState {
            module: &frag.module.inner,
            entry_point: frag.entry_point.as_deref(),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            targets: &frag_targets,
        })
    } else {
        None
    };

    let vertex_ep = desc.vertex.entry_point.as_deref();
    let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: desc.label.as_deref(),
        layout,
        vertex: wgpu::VertexState {
            module: &desc.vertex.module.inner,
            entry_point: vertex_ep,
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            buffers: &vert_buffers,
        },
        primitive: prim,
        depth_stencil,
        multisample,
        fragment,
        // Multiview is configured per render pass in wgpu 30.
        multiview_mask: None,
        cache: None,
    });
    Ok(GpuRenderPipeline::new(pipeline))
}

// ── Async-capable helpers ─────────────────────────────────────────────────────

pub(crate) fn extract_compute_args(desc: &GpuComputePipelineDescriptor) -> OwnedComputeArgs {
    OwnedComputeArgs {
        label: desc.label.clone(),
        layout: desc.layout.0.clone(),
        module: Arc::clone(&desc.compute.module.inner),
        entry_point: desc.compute.entry_point.clone(),
    }
}

pub(crate) fn build_compute_from_args(device: &wgpu::Device, args: OwnedComputeArgs) -> GpuComputePipeline {
    let layout = args.layout.as_deref();
    let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
        label: args.label.as_deref(),
        layout,
        module: &args.module,
        entry_point: args.entry_point.as_deref(),
        compilation_options: wgpu::PipelineCompilationOptions::default(),
        cache: None,
    });
    GpuComputePipeline::new(pipeline)
}

pub(crate) fn extract_render_args(desc: &GpuRenderPipelineDescriptor) -> napi::Result<OwnedRenderArgs> {
    let mut vertex_buffers: Vec<Option<(u64, wgpu::VertexStepMode, Vec<wgpu::VertexAttribute>)>> = Vec::new();
    if let Some(ref buffers) = desc.vertex.buffers {
        for maybe_buf in buffers {
            match maybe_buf {
                Some(buf) => {
                    let step_mode = buf.step_mode.as_deref().map(convert::vertex_step_mode).transpose()?.unwrap_or(wgpu::VertexStepMode::Vertex);
                    let attrs = buf.attributes.iter()
                        .map(|a| -> napi::Result<_> {
                            Ok(wgpu::VertexAttribute {
                                format: convert::vertex_format(&a.format)?,
                                offset: a.offset as u64,
                                shader_location: a.shader_location,
                            })
                        })
                        .collect::<napi::Result<Vec<_>>>()?;
                    vertex_buffers.push(Some((buf.array_stride as u64, step_mode, attrs)));
                }
                None => vertex_buffers.push(None),
            }
        }
    }

    let primitive = if let Some(ref p) = desc.primitive {
        wgpu::PrimitiveState {
            topology: p.topology.as_deref().map(convert::primitive_topology).transpose()?.unwrap_or(wgpu::PrimitiveTopology::TriangleList),
            strip_index_format: p.strip_index_format.as_deref().map(convert::index_format).transpose()?,
            front_face: p.front_face.as_deref().map(convert::front_face).transpose()?.unwrap_or(wgpu::FrontFace::Ccw),
            cull_mode: p.cull_mode.as_deref().map(convert::cull_mode).transpose()?.flatten(),
            unclipped_depth: p.unclipped_depth.unwrap_or(false),
            ..Default::default()
        }
    } else {
        wgpu::PrimitiveState::default()
    };

    let depth_stencil = if let Some(ref ds) = desc.depth_stencil {
        Some(wgpu::DepthStencilState {
            format: convert::texture_format(&ds.format)?,
            // Both are `Option` in wgpu 30, matching the spec: "not provided"
            // is distinct from `false`/`always`, and is what a depth-less
            // (stencil-only) attachment wants. Pass the caller's intent through
            // rather than inventing a default.
            depth_write_enabled: ds.depth_write_enabled,
            depth_compare: ds.depth_compare.as_deref().map(convert::compare_function).transpose()?,
            stencil: wgpu::StencilState {
                front: stencil_face(&ds.stencil_front)?,
                back: stencil_face(&ds.stencil_back)?,
                read_mask: ds.stencil_read_mask.unwrap_or(0xFFFF_FFFF),
                write_mask: ds.stencil_write_mask.unwrap_or(0xFFFF_FFFF),
            },
            bias: wgpu::DepthBiasState {
                constant: ds.depth_bias.unwrap_or(0),
                slope_scale: ds.depth_bias_slope_scale.unwrap_or(0.0) as f32,
                clamp: ds.depth_bias_clamp.unwrap_or(0.0) as f32,
            },
        })
    } else {
        None
    };

    let multisample = if let Some(ref ms) = desc.multisample {
        wgpu::MultisampleState {
            count: ms.count.unwrap_or(1),
            mask: ms.mask.unwrap_or(!0) as u64,
            alpha_to_coverage_enabled: ms.alpha_to_coverage_enabled.unwrap_or(false),
        }
    } else {
        wgpu::MultisampleState::default()
    };

    let fragment = if let Some(ref frag) = desc.fragment {
        let mut targets: Vec<Option<wgpu::ColorTargetState>> = Vec::new();
        for maybe_t in &frag.targets {
            if let Some(ref t) = maybe_t {
                let blend = if let Some(ref b) = t.blend {
                    Some(wgpu::BlendState { color: blend_component(&b.color)?, alpha: blend_component(&b.alpha)? })
                } else {
                    None
                };
                targets.push(Some(wgpu::ColorTargetState {
                    format: convert::texture_format(&t.format)?,
                    blend,
                    write_mask: convert::color_write(t.write_mask.unwrap_or(0xF)),
                }));
            } else {
                targets.push(None);
            }
        }
        Some(OwnedFragmentArgs {
            module: Arc::clone(&frag.module.inner),
            ep: frag.entry_point.clone(),
            targets,
        })
    } else {
        None
    };

    Ok(OwnedRenderArgs {
        label: desc.label.clone(),
        layout: desc.layout.0.clone(),
        vertex_module: Arc::clone(&desc.vertex.module.inner),
        vertex_ep: desc.vertex.entry_point.clone(),
        vertex_buffers,
        primitive,
        depth_stencil,
        multisample,
        fragment,
    })
}

pub(crate) fn build_render_from_args(device: &wgpu::Device, args: OwnedRenderArgs) -> GpuRenderPipeline {
    let vert_buffers: Vec<Option<wgpu::VertexBufferLayout<'_>>> = args.vertex_buffers.iter()
        .map(|slot| slot.as_ref().map(|(stride, step_mode, attrs)| wgpu::VertexBufferLayout {
            array_stride: *stride,
            step_mode: *step_mode,
            attributes: attrs.as_slice(),
        }))
        .collect();

    let layout_ref = args.layout.as_deref();

    let fragment = args.fragment.as_ref().map(|f| wgpu::FragmentState {
        module: &f.module,
        entry_point: f.ep.as_deref(),
        compilation_options: wgpu::PipelineCompilationOptions::default(),
        targets: f.targets.as_slice(),
    });

    let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: args.label.as_deref(),
        layout: layout_ref,
        vertex: wgpu::VertexState {
            module: &args.vertex_module,
            entry_point: args.vertex_ep.as_deref(),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            buffers: &vert_buffers,
        },
        primitive: args.primitive,
        depth_stencil: args.depth_stencil,
        multisample: args.multisample,
        fragment,
        // Multiview is configured per render pass in wgpu 30.
        multiview_mask: None,
        cache: None,
    });
    GpuRenderPipeline::new(pipeline)
}
