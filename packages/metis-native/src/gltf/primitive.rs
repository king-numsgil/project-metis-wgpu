//! The GPU-facing half of mesh import: the `#[napi(object)]` shapes a caller
//! sees, and the buffer creation that fills them.
//!
//! [`super::mesh`] is the pure packing math — accessors in, interleaved bytes
//! out, no `wgpu` anywhere. This file is what turns those bytes into
//! `GpuBuffer`s and pairs them with the layout description. The split follows
//! the same rule as `image/`'s two loaders: the part with the fiddly format
//! rules stays testable without a device.

use super::enums::{
    GltfAccessorType, GltfAttributeSemantic, GltfComponentType, GltfIndexFormat, GltfPrimitiveMode,
};
use super::mesh::{self, PackedVertices};
use crate::gpu::GpuBuffer;
use napi_derive::napi;
use std::sync::Arc;

/// One attribute of an interleaved vertex buffer, in the exact shape
/// `GPUVertexBufferLayout.attributes` wants — plus what the source accessor
/// held before canonicalisation, so a caller can tell a quantised asset from a
/// float one.
#[napi(object)]
pub struct GltfVertexAttribute {
    pub semantic: GltfAttributeSemantic,
    /// The glTF attribute name exactly as written: `POSITION`, `TEXCOORD_1`,
    /// `_BATCHID`.
    pub name: String,
    /// Set index for `TEXCOORD_n` / `COLOR_n` / `JOINTS_n` / `WEIGHTS_n`.
    pub set: u32,
    #[napi(ts_type = "GPUVertexFormat")]
    pub format: String,
    pub offset: u32,
    pub shader_location: u32,
    /// The accessor's `componentType` before this importer converted it.
    pub source_component_type: GltfComponentType,
    /// The accessor's `type` before conversion.
    pub source_type: GltfAccessorType,
    /// The accessor's `normalized` flag. Already applied — the values in the
    /// buffer are un-normalised floats when this is true and the destination
    /// format is a float one.
    pub source_normalized: bool,
}

/// Feeds straight into `GPUVertexBufferLayout` (`stepMode` is always
/// `"vertex"`).
#[napi(object)]
pub struct GltfVertexLayout {
    pub array_stride: u32,
    pub attributes: Vec<GltfVertexAttribute>,
}

/// One morph target's deltas, as its own vertex buffer.
///
/// Locations continue on from the primitive's base layout rather than restarting
/// at 0, so a pipeline can bind the base buffer and its targets together without
/// them colliding.
#[napi(object, object_from_js = false)]
pub struct GltfMorphTarget {
    pub name: Option<String>,
    pub buffer: GpuBuffer,
    pub layout: GltfVertexLayout,
}

/// One drawable primitive: an interleaved vertex buffer, an optional index
/// buffer, and everything needed to build a pipeline for them.
#[napi(object, object_from_js = false)]
pub struct GltfPrimitive {
    /// What the file said. `LineLoop` and `TriangleFan` have no WebGPU
    /// equivalent — see `gpuTopology`.
    pub mode: GltfPrimitiveMode,
    /// The topology to build the pipeline with. Differs from `mode` when the
    /// indices were rewritten (fan → `triangle-list`, loop → `line-strip`), and
    /// is `null` only if that rewrite was disabled via
    /// `convertUnsupportedTopologies: false`.
    #[napi(ts_type = "GPUPrimitiveTopology | null")]
    pub gpu_topology: Option<String>,
    /// Index into `GltfAsset.materials`. Always valid: a primitive with no
    /// material in the file points at `GltfAsset.defaultMaterial`.
    pub material: u32,

    pub vertex_count: u32,
    pub vertex_buffer: GpuBuffer,
    pub layout: GltfVertexLayout,

    /// `null` for a non-indexed primitive; draw with `draw(vertexCount)`.
    pub index_buffer: Option<GpuBuffer>,
    /// 0 when `indexBuffer` is null.
    pub index_count: u32,
    #[napi(ts_type = "GltfIndexFormat")]
    pub index_format: GltfIndexFormat,

    /// The POSITION accessor's `min`, when the file declares one — a
    /// ready-made object-space AABB corner. `null` if absent.
    pub min: Option<Vec<f64>>,
    /// The POSITION accessor's `max`.
    pub max: Option<Vec<f64>>,

    pub morph_targets: Vec<GltfMorphTarget>,
    pub extras: Option<String>,
}

#[napi(object, object_from_js = false)]
pub struct GltfMesh {
    pub name: Option<String>,
    /// Default morph target weights, overridden per node by `GltfNode.weights`.
    pub weights: Vec<f64>,
    pub primitives: Vec<GltfPrimitive>,
    pub extras: Option<String>,
}

/// Create a GPU buffer holding `bytes`, via `mappedAtCreation`.
///
/// `mappedAtCreation` rather than `queue.write_buffer` on purpose: an importer
/// creates a buffer and fills it exactly once, so there is no reason to stage
/// through the queue and then flush it. It also avoids the trap
/// `image/uncompressed.rs` documents — a staged write that has not been
/// submitted when the resource is destroyed — because there is nothing staged.
///
/// wgpu requires a mapped-at-creation buffer's size to be a multiple of
/// `COPY_BUFFER_ALIGNMENT` (4), so the allocation is rounded up; the padding is
/// never read, since draw calls are bounded by `vertexCount`/`indexCount`.
pub(crate) fn create_buffer(
    device: &Arc<wgpu::Device>,
    bytes: &[u8],
    usage: wgpu::BufferUsages,
    usage_bits: u32,
    label: &str,
) -> GpuBuffer {
    let size = (bytes.len() as u64).max(4).div_ceil(4) * 4;
    // `BufferViewMut::copy_from_slice` writes the whole view, and the view is
    // the padded size — so pad the source rather than writing a sub-slice.
    // (wgpu's write-only view has no `Index`, deliberately: mapped memory can be
    // write-combining. See `gpu/buffer.rs` for the same constraint on the JS
    // mapping path.)
    let padded: std::borrow::Cow<'_, [u8]> = if bytes.len() as u64 == size {
        std::borrow::Cow::Borrowed(bytes)
    } else {
        let mut v = bytes.to_vec();
        v.resize(size as usize, 0);
        std::borrow::Cow::Owned(v)
    };

    let buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some(label),
        size,
        usage,
        mapped_at_creation: true,
    });
    {
        // Infallible in practice: the buffer was created mapped, one line up,
        // and nothing else can have taken a view of it.
        let mut view = buffer.slice(..).get_mapped_range_mut().expect("freshly mapped buffer");
        view.copy_from_slice(&padded);
    }
    buffer.unmap();
    GpuBuffer::new(buffer, Arc::clone(device), size, usage_bits, Some(label.to_owned()), false)
}

/// `GPUBufferUsage.VERTEX | COPY_DST`.
pub(crate) const VERTEX_USAGE: u32 = 32 | 8;
/// `GPUBufferUsage.INDEX | COPY_DST`.
pub(crate) const INDEX_USAGE: u32 = 16 | 8;

pub(crate) fn layout_of(packed: &PackedVertices) -> GltfVertexLayout {
    GltfVertexLayout {
        array_stride: packed.array_stride,
        attributes: packed
            .attributes
            .iter()
            .map(|a| GltfVertexAttribute {
                semantic: a.semantic,
                name: a.name.clone(),
                set: a.set,
                format: a.format.to_owned(),
                offset: a.offset,
                shader_location: a.shader_location,
                source_component_type: a.source_component_type,
                source_type: a.source_type,
                source_normalized: a.source_normalized,
            })
            .collect(),
    }
}

/// Build one primitive: pack, upload, describe.
pub(crate) struct BuildOptions {
    pub(crate) layout_mode: mesh::GltfVertexLayoutMode,
    pub(crate) convert_topology: bool,
    pub(crate) extra_vertex_usage: u32,
    pub(crate) extra_index_usage: u32,
}

pub(crate) fn build(
    device: &Arc<wgpu::Device>,
    primitive: &gltf::Primitive<'_>,
    buffers: &[Option<Vec<u8>>],
    default_material: u32,
    opts: &BuildOptions,
    label: &str,
) -> napi::Result<GltfPrimitive> {
    // Indices are resolved first because `Standard` mode's normal and tangent
    // synthesis walks the triangle list.
    let position_count = primitive
        .get(&gltf::Semantic::Positions)
        .map(|a| a.count() as u32)
        .unwrap_or(0);
    let indices = mesh::resolve_indices(primitive, buffers, position_count, opts.convert_topology, label)?;

    let packed = match opts.layout_mode {
        mesh::GltfVertexLayoutMode::Source => {
            let attributes = primitive
                .attributes()
                .map(|(sem, acc)| (sem.to_string(), acc))
                .collect::<Vec<_>>();
            mesh::pack_vertices(attributes.into_iter(), buffers, mesh::LocationPolicy::Canonical, label)?
        }
        mesh::GltfVertexLayoutMode::Standard => mesh::pack_standard(primitive, buffers, &indices, label)?,
    };

    let vertex_usage_bits = VERTEX_USAGE | opts.extra_vertex_usage;
    let vertex_buffer = create_buffer(
        device,
        &packed.bytes,
        crate::gpu::convert::buffer_usage(vertex_usage_bits),
        vertex_usage_bits,
        &format!("{label} vertices"),
    );

    let (mode, gpu_topology) = (indices.mode, indices.gpu_topology);
    let index_usage_bits = INDEX_USAGE | opts.extra_index_usage;
    let (index_buffer, index_count, index_format) = match indices.packed {
        None => (None, 0, GltfIndexFormat::Uint16),
        Some(p) => {
            let b = create_buffer(
                device,
                &p.bytes,
                crate::gpu::convert::buffer_usage(index_usage_bits),
                index_usage_bits,
                &format!("{label} indices"),
            );
            (Some(b), p.count, p.format)
        }
    };

    // Morph targets continue the base layout's locations so both can be bound
    // to one pipeline.
    let mut next_location = packed.next_location;
    let mut morph_targets = Vec::new();
    for (i, target) in primitive.morph_targets().enumerate() {
        let attrs: Vec<(String, gltf::Accessor<'_>)> = [
            target.positions().map(|a| ("POSITION".to_owned(), a)),
            target.normals().map(|a| ("NORMAL".to_owned(), a)),
            target.tangents().map(|a| ("TANGENT".to_owned(), a)),
        ]
        .into_iter()
        .flatten()
        .collect();
        if attrs.is_empty() {
            continue;
        }
        let target_label = format!("{label} morph target {i}");
        let packed_target = mesh::pack_vertices(
            attrs.into_iter(),
            buffers,
            mesh::LocationPolicy::Sequential { base: next_location },
            &target_label,
        )?;
        next_location = packed_target.next_location;
        let buffer = create_buffer(
            device,
            &packed_target.bytes,
            crate::gpu::convert::buffer_usage(vertex_usage_bits),
            vertex_usage_bits,
            &target_label,
        );
        morph_targets.push(GltfMorphTarget {
            name: None,
            layout: layout_of(&packed_target),
            buffer,
        });
    }

    let position = primitive.get(&gltf::Semantic::Positions);
    let bounds = position.map(|a| {
        (
            json_numbers(a.min()),
            json_numbers(a.max()),
        )
    });

    Ok(GltfPrimitive {
        mode,
        gpu_topology: gpu_topology.map(str::to_owned),
        material: primitive.material().index().map(|i| i as u32).unwrap_or(default_material),
        vertex_count: packed.vertex_count,
        layout: layout_of(&packed),
        vertex_buffer,
        index_buffer,
        index_count,
        index_format,
        min: bounds.as_ref().and_then(|b| b.0.clone()),
        max: bounds.as_ref().and_then(|b| b.1.clone()),
        morph_targets,
        extras: super::material::extras_json(primitive.extras()),
    })
}

fn json_numbers(v: Option<gltf::json::Value>) -> Option<Vec<f64>> {
    let arr = v?;
    let arr = arr.as_array()?;
    Some(arr.iter().filter_map(|x| x.as_f64()).collect())
}
