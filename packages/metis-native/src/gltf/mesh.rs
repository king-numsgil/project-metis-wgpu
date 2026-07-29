//! Primitives → interleaved vertex buffers, index buffers, and the
//! `GPUVertexBufferLayout` that describes them.
//!
//! ## Why the importer repacks instead of handing back the file's buffers
//!
//! The faithful-looking alternative is to upload each glTF `buffer` verbatim and
//! report accessors as `(buffer, offset, stride, componentType)` triples. It was
//! rejected, and the reason is worth recording because it looks like the more
//! "spec compliant" option:
//!
//! - A glTF `bufferView` may be interleaved with a stride WebGPU cannot express
//!   as a single `GPUVertexBufferLayout` (attributes from different views, or
//!   several accessors sharing a view at odd offsets), so the caller ends up
//!   repacking anyway — just without the accessor machinery to do it correctly.
//! - **Sparse accessors have no buffer to point at.** An accessor with no
//!   `bufferView` at all is legal; there is literally nothing to bind.
//! - `UNSIGNED_BYTE` indices are legal in glTF and **do not exist in WebGPU**.
//! - `KHR_mesh_quantization` component types (`normalized` `BYTE`, `SHORT`) map
//!   to WebGPU vertex formats only for 2- and 4-component vectors, not 3.
//!
//! So a verbatim path is a correct-looking API that cannot represent a
//! conforming file. Repacking is done once, here, where the accessor rules
//! already live.
//!
//! ## Shader locations are fixed, not dense
//!
//! Each known semantic gets a **constant** `shaderLocation` (below), so one WGSL
//! vertex entry point can serve every mesh with the same attribute set, and a
//! pipeline can be cached by layout rather than rebuilt per primitive. The
//! alternative — packing locations densely from 0 in whatever order the file
//! lists attributes — makes two meshes with the same attributes minus one
//! disagree about what location 3 means.
//!
//! Custom (`_UNDERSCORE`) attributes and morph targets get locations *after* the
//! fixed block, allocated deterministically. Note WebGPU's default
//! `maxVertexAttributes` is 16: a primitive with many custom attributes plus
//! morph targets can exceed it, and that surfaces at `createRenderPipeline`,
//! not here — this file reports a layout, it does not create pipelines.

use super::accessor::{self, AccessorData};
use super::enums::{
    GltfAccessorType, GltfAttributeSemantic, GltfComponentType, GltfIndexFormat, GltfPrimitiveMode,
};
use crate::image::generic_err;

// ── fixed shader locations ──────────────────────────────────────────────────

const LOC_POSITION: u32 = 0;
const LOC_NORMAL: u32 = 1;
const LOC_TANGENT: u32 = 2;
const LOC_TEXCOORD: [u32; 4] = [3, 4, 5, 6];
const LOC_COLOR: [u32; 2] = [7, 8];
const LOC_JOINTS: [u32; 2] = [9, 11];
const LOC_WEIGHTS: [u32; 2] = [10, 12];
/// First location handed to `_UNDERSCORE` attributes, in sorted attribute order.
const LOC_CUSTOM_BASE: u32 = 13;

/// How `pack_vertices` hands out `shaderLocation`s.
#[derive(Clone, Copy)]
pub(crate) enum LocationPolicy {
    /// A primitive's own vertex buffer: known semantics take their fixed
    /// location from the table above, custom attributes are allocated upward
    /// from [`LOC_CUSTOM_BASE`].
    Canonical,
    /// A morph target: **every** attribute is allocated sequentially from
    /// `base`, including `POSITION`. Morph deltas are a second vertex buffer
    /// bound alongside the first, so a target's POSITION must not land on
    /// location 0 — where the base buffer's POSITION already is.
    Sequential { base: u32 },
}

/// What the source components get turned into on the way to the GPU.
#[derive(Clone, Copy)]
enum Conversion {
    /// Convert to `n` f32 components, padding with `pad` when the source has
    /// fewer (COLOR_0 as VEC3 gets alpha 1.0; a VEC3 TANGENT gets w 1.0).
    F32 { n: usize, pad: f32 },
    /// Convert to `n` u16 components — joint indices.
    U16 { n: usize },
    /// Copy the source components through unchanged.
    Raw,
}

/// A canonical destination for one attribute.
struct Canonical {
    format: &'static str,
    size: u32,
    conversion: Conversion,
}

/// Byte size of a `GPUVertexFormat`.
fn vertex_format_size(f: &str) -> u32 {
    let (comp, n) = match f {
        "uint8" | "sint8" | "unorm8" | "snorm8" => (1, 1),
        "uint8x2" | "sint8x2" | "unorm8x2" | "snorm8x2" => (1, 2),
        "uint8x4" | "sint8x4" | "unorm8x4" | "snorm8x4" | "unorm8x4-bgra" => (1, 4),
        "uint16" | "sint16" | "unorm16" | "snorm16" | "float16" => (2, 1),
        "uint16x2" | "sint16x2" | "unorm16x2" | "snorm16x2" | "float16x2" => (2, 2),
        "uint16x4" | "sint16x4" | "unorm16x4" | "snorm16x4" | "float16x4" => (2, 4),
        "float32" | "uint32" | "sint32" => (4, 1),
        "float32x2" | "uint32x2" | "sint32x2" => (4, 2),
        "float32x3" | "uint32x3" | "sint32x3" => (4, 3),
        "float32x4" | "uint32x4" | "sint32x4" => (4, 4),
        "unorm10-10-10-2" => (4, 1),
        _ => (4, 1),
    };
    comp * n
}

/// The direct (byte-preserving) `GPUVertexFormat` for a glTF component type and
/// dimension, when one exists.
///
/// WebGPU has no 1- or 3-component 8/16-bit vertex formats, so those fall
/// through to `None` and get converted to f32 by the caller. That gap is exactly
/// why `KHR_mesh_quantization` VEC3 positions cannot be passed through verbatim.
fn direct_format(comp: GltfComponentType, ty: GltfAccessorType, normalized: bool) -> Option<&'static str> {
    let n = ty.components();
    Some(match (comp, normalized, n) {
        (GltfComponentType::F32, _, 1) => "float32",
        (GltfComponentType::F32, _, 2) => "float32x2",
        (GltfComponentType::F32, _, 3) => "float32x3",
        (GltfComponentType::F32, _, 4) => "float32x4",
        (GltfComponentType::U8, true, 2) => "unorm8x2",
        (GltfComponentType::U8, true, 4) => "unorm8x4",
        (GltfComponentType::U8, false, 2) => "uint8x2",
        (GltfComponentType::U8, false, 4) => "uint8x4",
        (GltfComponentType::I8, true, 2) => "snorm8x2",
        (GltfComponentType::I8, true, 4) => "snorm8x4",
        (GltfComponentType::I8, false, 2) => "sint8x2",
        (GltfComponentType::I8, false, 4) => "sint8x4",
        (GltfComponentType::U16, true, 2) => "unorm16x2",
        (GltfComponentType::U16, true, 4) => "unorm16x4",
        (GltfComponentType::U16, false, 2) => "uint16x2",
        (GltfComponentType::U16, false, 4) => "uint16x4",
        (GltfComponentType::I16, true, 2) => "snorm16x2",
        (GltfComponentType::I16, true, 4) => "snorm16x4",
        (GltfComponentType::I16, false, 2) => "sint16x2",
        (GltfComponentType::I16, false, 4) => "sint16x4",
        (GltfComponentType::U32, _, 1) => "uint32",
        (GltfComponentType::U32, _, 2) => "uint32x2",
        (GltfComponentType::U32, _, 3) => "uint32x3",
        (GltfComponentType::U32, _, 4) => "uint32x4",
        _ => return None,
    })
}

/// Pick the destination format for one attribute.
///
/// The named semantics are pinned to a canonical format regardless of how the
/// file stored them — a `TEXCOORD_0` is `float32x2` whether the asset quantised
/// it to `unorm16x2` or not. That costs bandwidth (the point of quantisation)
/// and buys a layout that does not change shape per asset, which is the right
/// trade for an importer whose consumers build pipelines from what it reports.
/// Custom attributes take the opposite default and are passed through byte-exact
/// where WebGPU can express them, because nothing here knows what they mean.
fn canonical(semantic: GltfAttributeSemantic, data: &AccessorData) -> Canonical {
    let f32x = |n: usize, pad: f32| Canonical {
        format: match n {
            1 => "float32",
            2 => "float32x2",
            3 => "float32x3",
            _ => "float32x4",
        },
        size: 4 * n as u32,
        conversion: Conversion::F32 { n, pad },
    };
    match semantic {
        GltfAttributeSemantic::Position | GltfAttributeSemantic::Normal => f32x(3, 0.0),
        // A VEC3 TANGENT is out of spec but appears in the wild; w = 1 keeps the
        // handedness convention rather than producing a zero bitangent.
        GltfAttributeSemantic::Tangent => f32x(4, 1.0),
        GltfAttributeSemantic::TexCoord => f32x(2, 0.0),
        // COLOR_n is VEC3 or VEC4; the missing alpha is opaque, not transparent.
        GltfAttributeSemantic::Color => f32x(4, 1.0),
        GltfAttributeSemantic::Weights => f32x(4, 0.0),
        GltfAttributeSemantic::Joints => Canonical {
            format: "uint16x4",
            size: 8,
            conversion: Conversion::U16 { n: 4 },
        },
        GltfAttributeSemantic::Custom => {
            match direct_format(data.component_type, data.accessor_type, data.normalized) {
                Some(f) => Canonical { format: f, size: vertex_format_size(f), conversion: Conversion::Raw },
                None => f32x(data.components().min(4), 0.0),
            }
        }
    }
}

/// One attribute in the packed vertex, resolved but not yet written.
pub(crate) struct AttributeDescription {
    pub(crate) semantic: GltfAttributeSemantic,
    pub(crate) name: String,
    pub(crate) set: u32,
    pub(crate) format: &'static str,
    pub(crate) offset: u32,
    pub(crate) shader_location: u32,
    pub(crate) source_component_type: GltfComponentType,
    pub(crate) source_type: GltfAccessorType,
    pub(crate) source_normalized: bool,
}

/// An attribute mid-pack: its description plus the source data and the
/// conversion still to be applied. Only `pack_vertices` uses this;
/// `pack_standard` writes its bytes directly and produces descriptions alone.
struct PreparedAttribute {
    desc: AttributeDescription,
    data: AccessorData,
    conversion: Conversion,
    size: u32,
}

/// A packed vertex buffer plus the layout that reads it.
pub(crate) struct PackedVertices {
    pub(crate) bytes: Vec<u8>,
    pub(crate) array_stride: u32,
    pub(crate) vertex_count: u32,
    pub(crate) attributes: Vec<AttributeDescription>,
    /// First `shaderLocation` not used by this layout — where the next buffer
    /// (a morph target) starts allocating.
    pub(crate) next_location: u32,
}

/// Split `TEXCOORD_2` into (`TexCoord`, 2). Anything unrecognised is `Custom`.
fn classify_semantic(name: &str) -> (GltfAttributeSemantic, u32) {
    let (base, set) = match name.rsplit_once('_') {
        Some((b, n)) if n.chars().all(|c| c.is_ascii_digit()) && !n.is_empty() => {
            (b, n.parse::<u32>().unwrap_or(0))
        }
        _ => (name, 0),
    };
    match base {
        "POSITION" => (GltfAttributeSemantic::Position, 0),
        "NORMAL" => (GltfAttributeSemantic::Normal, 0),
        "TANGENT" => (GltfAttributeSemantic::Tangent, 0),
        "TEXCOORD" if (set as usize) < LOC_TEXCOORD.len() => (GltfAttributeSemantic::TexCoord, set),
        "COLOR" if (set as usize) < LOC_COLOR.len() => (GltfAttributeSemantic::Color, set),
        "JOINTS" if (set as usize) < LOC_JOINTS.len() => (GltfAttributeSemantic::Joints, set),
        "WEIGHTS" if (set as usize) < LOC_WEIGHTS.len() => (GltfAttributeSemantic::Weights, set),
        // A set index past the fixed block (TEXCOORD_4, …) keeps its real name
        // and set but is treated as custom, so it still reaches the GPU.
        _ => (GltfAttributeSemantic::Custom, set),
    }
}

fn fixed_location(semantic: GltfAttributeSemantic, set: u32) -> Option<u32> {
    let s = set as usize;
    Some(match semantic {
        GltfAttributeSemantic::Position => LOC_POSITION,
        GltfAttributeSemantic::Normal => LOC_NORMAL,
        GltfAttributeSemantic::Tangent => LOC_TANGENT,
        GltfAttributeSemantic::TexCoord => *LOC_TEXCOORD.get(s)?,
        GltfAttributeSemantic::Color => *LOC_COLOR.get(s)?,
        GltfAttributeSemantic::Joints => *LOC_JOINTS.get(s)?,
        GltfAttributeSemantic::Weights => *LOC_WEIGHTS.get(s)?,
        GltfAttributeSemantic::Custom => return None,
    })
}

/// Interleave a set of glTF attributes into one vertex buffer.
pub(crate) fn pack_vertices<'a>(
    attributes: impl Iterator<Item = (String, gltf::Accessor<'a>)>,
    buffers: &[Option<Vec<u8>>],
    policy: LocationPolicy,
    what: &str,
) -> napi::Result<PackedVertices> {
    let mut prepared: Vec<PreparedAttribute> = Vec::new();
    let location_base = match policy {
        LocationPolicy::Canonical => LOC_CUSTOM_BASE,
        LocationPolicy::Sequential { base } => base,
    };
    let mut custom_next = location_base;
    let mut vertex_count: Option<usize> = None;

    // `primitive.attributes()` iterates a sorted map, so the order — and
    // therefore the custom-attribute locations — is stable for a given file.
    for (name, acc) in attributes {
        let (semantic, set) = classify_semantic(&name);
        let data = accessor::read_accessor(&acc, buffers, &format!("{what} attribute '{name}'"))?;

        match vertex_count {
            None => vertex_count = Some(data.count),
            Some(n) if n != data.count => {
                return Err(generic_err(format!(
                    "{what}: attribute '{name}' has {} elements but a previous attribute had {n}; \
                     glTF requires every attribute of a primitive to have the same count",
                    data.count
                )));
            }
            _ => {}
        }

        let c = canonical(semantic, &data);
        let fixed = match policy {
            LocationPolicy::Canonical => fixed_location(semantic, set),
            LocationPolicy::Sequential { .. } => None,
        };
        let location = match fixed {
            Some(l) => l,
            None => {
                let l = custom_next;
                custom_next += 1;
                l
            }
        };

        prepared.push(PreparedAttribute {
            desc: AttributeDescription {
                semantic,
                name,
                set,
                format: c.format,
                offset: 0, // assigned below, once the order is known
                shader_location: location,
                source_component_type: data.component_type,
                source_type: data.accessor_type,
                source_normalized: data.normalized,
            },
            data,
            conversion: c.conversion,
            size: c.size,
        });
    }

    let vertex_count = vertex_count.unwrap_or(0);
    if prepared.is_empty() {
        return Err(generic_err(format!("{what}: has no vertex attributes")));
    }

    // Layout order follows shaderLocation, so the packed bytes are laid out the
    // same way for any file with the same attribute set.
    prepared.sort_by_key(|a| a.desc.shader_location);

    // WebGPU requires an attribute offset to be a multiple of the smaller of 4
    // and the format's component size, and `arrayStride` to be a multiple of 4.
    // Aligning everything to 4 satisfies both without a per-format special case.
    let mut offset = 0u32;
    for a in prepared.iter_mut() {
        a.desc.offset = offset;
        offset += a.size.div_ceil(4) * 4;
    }
    let array_stride = offset.max(4);

    let mut bytes = vec![0u8; vertex_count * array_stride as usize];
    for a in &prepared {
        write_attribute(&mut bytes, array_stride as usize, a, vertex_count);
    }

    let next_location = prepared
        .iter()
        .map(|a| a.desc.shader_location + 1)
        .max()
        .unwrap_or(location_base)
        .max(custom_next);

    Ok(PackedVertices {
        bytes,
        array_stride,
        vertex_count: vertex_count as u32,
        next_location,
        attributes: prepared.into_iter().map(|a| a.desc).collect(),
    })
}

/// Write one attribute's converted components into every vertex slot.
fn write_attribute(dst: &mut [u8], stride: usize, a: &PreparedAttribute, vertex_count: usize) {
    let src_comps = a.data.components();
    let base = a.desc.offset as usize;
    match a.conversion {
        Conversion::F32 { n, pad } => {
            let values = accessor::to_f32(&a.data);
            for v in 0..vertex_count {
                for c in 0..n {
                    let x = if c < src_comps { values[v * src_comps + c] } else { pad };
                    let o = v * stride + base + c * 4;
                    dst[o..o + 4].copy_from_slice(&x.to_le_bytes());
                }
            }
        }
        Conversion::U16 { n } => {
            let values = accessor::to_u32(&a.data);
            for v in 0..vertex_count {
                for c in 0..n {
                    let x = if c < src_comps { values[v * src_comps + c].min(u16::MAX as u32) as u16 } else { 0 };
                    let o = v * stride + base + c * 2;
                    dst[o..o + 2].copy_from_slice(&x.to_le_bytes());
                }
            }
        }
        Conversion::Raw => {
            let elem = src_comps * a.data.component_type.size();
            for v in 0..vertex_count {
                let o = v * stride + base;
                dst[o..o + elem].copy_from_slice(&a.data.bytes[v * elem..(v + 1) * elem]);
            }
        }
    }
}

// ── indices and topology ────────────────────────────────────────────────────

pub(crate) struct PackedIndices {
    pub(crate) bytes: Vec<u8>,
    pub(crate) format: GltfIndexFormat,
    pub(crate) count: u32,
}

fn pack_index_bytes(indices: &[u32], vertex_count: u32) -> PackedIndices {
    // Widening `UNSIGNED_BYTE` to `Uint16` is not an optimisation, it is
    // required: WebGPU has no 8-bit index format at all.
    if vertex_count <= u16::MAX as u32 && indices.iter().all(|&i| i <= u16::MAX as u32) {
        let mut bytes = Vec::with_capacity(indices.len() * 2);
        for &i in indices {
            bytes.extend_from_slice(&(i as u16).to_le_bytes());
        }
        PackedIndices { bytes, format: GltfIndexFormat::Uint16, count: indices.len() as u32 }
    } else {
        let mut bytes = Vec::with_capacity(indices.len() * 4);
        for &i in indices {
            bytes.extend_from_slice(&i.to_le_bytes());
        }
        PackedIndices { bytes, format: GltfIndexFormat::Uint32, count: indices.len() as u32 }
    }
}

pub(crate) fn mode_from_gltf(m: gltf::mesh::Mode) -> GltfPrimitiveMode {
    use gltf::mesh::Mode;
    match m {
        Mode::Points => GltfPrimitiveMode::Points,
        Mode::Lines => GltfPrimitiveMode::Lines,
        Mode::LineLoop => GltfPrimitiveMode::LineLoop,
        Mode::LineStrip => GltfPrimitiveMode::LineStrip,
        Mode::Triangles => GltfPrimitiveMode::Triangles,
        Mode::TriangleStrip => GltfPrimitiveMode::TriangleStrip,
        Mode::TriangleFan => GltfPrimitiveMode::TriangleFan,
    }
}

/// The `GPUPrimitiveTopology` a mode maps to, or `None` when WebGPU has no
/// equivalent and the indices were not rewritten.
pub(crate) fn gpu_topology(m: GltfPrimitiveMode) -> Option<&'static str> {
    Some(match m {
        GltfPrimitiveMode::Points => "point-list",
        GltfPrimitiveMode::Lines => "line-list",
        GltfPrimitiveMode::LineStrip => "line-strip",
        GltfPrimitiveMode::Triangles => "triangle-list",
        GltfPrimitiveMode::TriangleStrip => "triangle-strip",
        GltfPrimitiveMode::LineLoop | GltfPrimitiveMode::TriangleFan => return None,
    })
}

/// Resolve a primitive's indices, rewriting the two modes WebGPU cannot draw.
///
/// `TRIANGLE_FAN` and `LINE_LOOP` are in the glTF spec and absent from WebGPU
/// (D3D12 dropped fans, and WebGPU followed). Reporting them and leaving the
/// caller to cope means every consumer writes the same rewrite — so it happens
/// here, and `GltfPrimitive.mode` still reports what the file said while
/// `gpuTopology` reports what the buffers now hold.
///
/// A fan or loop with **no** index buffer gets one generated, since the rewrite
/// is expressible only as indices.
/// What `resolve_indices` worked out about a primitive's topology.
pub(crate) struct ResolvedIndices {
    /// The index buffer to upload, or `None` for a primitive that stays
    /// non-indexed.
    pub(crate) packed: Option<PackedIndices>,
    /// The same indices as `u32`, and for a non-indexed primitive the implied
    /// sequence `0..vertexCount`. Normal and tangent generation walk this, so
    /// it exists even when nothing is uploaded.
    pub(crate) list: Vec<u32>,
    pub(crate) mode: GltfPrimitiveMode,
    pub(crate) gpu_topology: Option<&'static str>,
    /// True when `list` walks triangles three at a time — the precondition for
    /// generating normals or tangents.
    pub(crate) is_triangle_list: bool,
}

pub(crate) fn resolve_indices(
    primitive: &gltf::Primitive<'_>,
    buffers: &[Option<Vec<u8>>],
    vertex_count: u32,
    convert_topology: bool,
    what: &str,
) -> napi::Result<ResolvedIndices> {
    let mode = mode_from_gltf(primitive.mode());

    let source: Option<Vec<u32>> = match primitive.indices() {
        Some(acc) => {
            let data = accessor::read_accessor(&acc, buffers, &format!("{what} indices"))?;
            if data.accessor_type != GltfAccessorType::Scalar {
                return Err(generic_err(format!("{what}: index accessor must be SCALAR")));
            }
            let idx = accessor::to_u32(&data);
            if let Some(&bad) = idx.iter().find(|&&i| i >= vertex_count) {
                return Err(generic_err(format!(
                    "{what}: index {bad} is out of range for {vertex_count} vertices"
                )));
            }
            Some(idx)
        }
        None => None,
    };

    let needs_rewrite = convert_topology
        && matches!(mode, GltfPrimitiveMode::TriangleFan | GltfPrimitiveMode::LineLoop);

    if !needs_rewrite {
        let list = source.clone().unwrap_or_else(|| (0..vertex_count).collect());
        return Ok(ResolvedIndices {
            packed: source.map(|i| pack_index_bytes(&i, vertex_count)),
            list,
            mode,
            gpu_topology: gpu_topology(mode),
            is_triangle_list: matches!(mode, GltfPrimitiveMode::Triangles),
        });
    }

    let seq: Vec<u32> = source.unwrap_or_else(|| (0..vertex_count).collect());
    let (rewritten, topology) = match mode {
        GltfPrimitiveMode::TriangleFan => {
            let mut out = Vec::with_capacity(seq.len().saturating_sub(2) * 3);
            for i in 1..seq.len().saturating_sub(1) {
                out.extend_from_slice(&[seq[0], seq[i], seq[i + 1]]);
            }
            (out, "triangle-list")
        }
        _ => {
            // LINE_LOOP is LINE_STRIP that closes back onto its first vertex.
            let mut out = seq.clone();
            if let Some(&first) = seq.first() {
                out.push(first);
            }
            (out, "line-strip")
        }
    };

    Ok(ResolvedIndices {
        packed: Some(pack_index_bytes(&rewritten, vertex_count)),
        is_triangle_list: topology == "triangle-list",
        list: rewritten,
        mode,
        gpu_topology: Some(topology),
    })
}

// ── the fixed "standard" layout ─────────────────────────────────────────────

/// Which vertex layout an import produces.
#[napi_derive::napi]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GltfVertexLayoutMode {
    /// Exactly the attributes the file has, at their canonical locations —
    /// faithful, and a different `arrayStride` per primitive.
    Source,
    /// **Always** `POSITION` (float32x3), `NORMAL` (float32x3), `TANGENT`
    /// (float32x4), `TEXCOORD_0` (float32x2) at locations 0-3, `arrayStride`
    /// 48 — for a renderer that wants one pipeline for every mesh.
    ///
    /// This is lossy in both directions and deliberately so: missing
    /// attributes are **synthesised**, and every other attribute (`COLOR_0`,
    /// joints, weights, custom `_FOO`) is **dropped**. Use `Source` if any of
    /// that matters.
    Standard,
}

/// `arrayStride` of [`GltfVertexLayoutMode::Standard`].
pub(crate) const STANDARD_STRIDE: u32 = 48;

/// Build the fixed 48-byte layout, synthesising whatever the file omits.
///
/// The three synthesis rules, and how far each is from the spec:
///
/// - **Missing `NORMAL`.** glTF says a client MUST use *flat* normals. Flat
///   normals need one vertex per face — de-indexing, which changes
///   `vertexCount` and silently invalidates every other accessor's indexing.
///   So this computes **smooth** normals instead (area-weighted accumulation of
///   face normals, which falls out of not normalising the cross product). It is
///   a deviation, it is recorded here rather than hidden, and it only applies to
///   an asset that already omitted normals.
/// - **Missing `TANGENT`.** glTF says a client SHOULD compute tangents when a
///   normal texture needs them, and names MikkTSpace. This is the ordinary
///   UV-derived tangent (per-triangle `dP/du` accumulated per vertex, then
///   Gram-Schmidt against N, `w` from the handedness of `dP/dv`) — the same
///   construction MikkTSpace starts from, without its vertex-splitting. Good
///   enough for smooth-shaded assets; not bit-compatible with a MikkTSpace
///   baker, so an asset that ships tangents keeps its own.
/// - **Missing `TEXCOORD_0`.** Zero-filled. With no UVs there is also no
///   UV-derived tangent, so the tangent falls back to an arbitrary-but-stable
///   perpendicular to N — which keeps the shader's TBN basis well-defined and
///   means nothing for normal mapping, because an untextured mesh has no
///   normal map to sample.
pub(crate) fn pack_standard(
    primitive: &gltf::Primitive<'_>,
    buffers: &[Option<Vec<u8>>],
    indices: &ResolvedIndices,
    what: &str,
) -> napi::Result<PackedVertices> {
    let pos_acc = primitive
        .get(&gltf::Semantic::Positions)
        .ok_or_else(|| generic_err(format!("{what}: has no POSITION attribute")))?;
    let pos_data = accessor::read_accessor(&pos_acc, buffers, &format!("{what} attribute 'POSITION'"))?;
    let positions = accessor::to_f32(&pos_data);
    let n = pos_data.count;
    if pos_data.components() != 3 {
        return Err(generic_err(format!("{what}: POSITION must be VEC3")));
    }

    let normals = match primitive.get(&gltf::Semantic::Normals) {
        Some(acc) => {
            let d = accessor::read_accessor(&acc, buffers, &format!("{what} attribute 'NORMAL'"))?;
            let v = accessor::to_f32(&d);
            if v.len() >= n * 3 { v } else { generate_normals(&positions, n, indices) }
        }
        None => generate_normals(&positions, n, indices),
    };

    let uvs = match primitive.get(&gltf::Semantic::TexCoords(0)) {
        Some(acc) => {
            let d = accessor::read_accessor(&acc, buffers, &format!("{what} attribute 'TEXCOORD_0'"))?;
            (accessor::to_f32(&d), true)
        }
        None => (vec![0.0; n * 2], false),
    };
    let (uvs, has_uvs) = uvs;

    let tangents = match primitive.get(&gltf::Semantic::Tangents) {
        Some(acc) => {
            let d = accessor::read_accessor(&acc, buffers, &format!("{what} attribute 'TANGENT'"))?;
            let raw = accessor::to_f32(&d);
            let comps = d.components();
            // A VEC3 TANGENT is out of spec but occurs; w = 1 keeps handedness.
            (0..n)
                .flat_map(|i| {
                    let w = if comps >= 4 { raw[i * comps + 3] } else { 1.0 };
                    [raw[i * comps], raw[i * comps + 1], raw[i * comps + 2], w]
                })
                .collect()
        }
        None if has_uvs => generate_tangents(&positions, &normals, &uvs, n, indices),
        None => fallback_tangents(&normals, n),
    };

    let stride = STANDARD_STRIDE as usize;
    let mut bytes = vec![0u8; n * stride];
    for i in 0..n {
        let o = i * stride;
        let put = |bytes: &mut [u8], off: usize, v: f32| {
            bytes[off..off + 4].copy_from_slice(&v.to_le_bytes());
        };
        for c in 0..3 {
            put(&mut bytes, o + c * 4, positions[i * 3 + c]);
            put(&mut bytes, o + 12 + c * 4, normals[i * 3 + c]);
        }
        for c in 0..4 {
            put(&mut bytes, o + 24 + c * 4, tangents[i * 4 + c]);
        }
        for c in 0..2 {
            put(&mut bytes, o + 40 + c * 4, uvs[i * 2 + c]);
        }
    }

    // Every attribute here is f32 in the buffer whatever the source held, so
    // the reported `source*` fields describe the *destination* rather than the
    // accessor. That loss is part of what `Standard` mode trades away; `Source`
    // mode reports the real accessor types.
    let describe = |semantic, name: &str, format: &'static str, offset, location, ty| AttributeDescription {
        semantic,
        name: name.to_owned(),
        set: 0,
        format,
        offset,
        shader_location: location,
        source_component_type: GltfComponentType::F32,
        source_type: ty,
        source_normalized: false,
    };
    let attributes = vec![
        describe(GltfAttributeSemantic::Position, "POSITION", "float32x3", 0, 0, GltfAccessorType::Vec3),
        describe(GltfAttributeSemantic::Normal, "NORMAL", "float32x3", 12, 1, GltfAccessorType::Vec3),
        describe(GltfAttributeSemantic::Tangent, "TANGENT", "float32x4", 24, 2, GltfAccessorType::Vec4),
        describe(GltfAttributeSemantic::TexCoord, "TEXCOORD_0", "float32x2", 40, 3, GltfAccessorType::Vec2),
    ];

    Ok(PackedVertices {
        bytes,
        array_stride: STANDARD_STRIDE,
        vertex_count: n as u32,
        next_location: 4,
        attributes,
    })
}

fn normalize3(v: [f32; 3]) -> [f32; 3] {
    let len = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    if len > 1e-20 { [v[0] / len, v[1] / len, v[2] / len] } else { [0.0, 0.0, 1.0] }
}

fn generate_normals(positions: &[f32], n: usize, indices: &ResolvedIndices) -> Vec<f32> {
    let mut acc = vec![0.0f32; n * 3];
    if indices.is_triangle_list {
        for tri in indices.list.chunks_exact(3) {
            let (a, b, c) = (tri[0] as usize, tri[1] as usize, tri[2] as usize);
            if a >= n || b >= n || c >= n {
                continue;
            }
            let p = |i: usize| [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
            let (pa, pb, pc) = (p(a), p(b), p(c));
            let e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
            let e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
            // Deliberately un-normalised: the cross product's magnitude is
            // twice the triangle area, so accumulating it area-weights the
            // average for free.
            let cr = [
                e1[1] * e2[2] - e1[2] * e2[1],
                e1[2] * e2[0] - e1[0] * e2[2],
                e1[0] * e2[1] - e1[1] * e2[0],
            ];
            for &v in &[a, b, c] {
                for c3 in 0..3 {
                    acc[v * 3 + c3] += cr[c3];
                }
            }
        }
    }
    for i in 0..n {
        let v = normalize3([acc[i * 3], acc[i * 3 + 1], acc[i * 3 + 2]]);
        acc[i * 3] = v[0];
        acc[i * 3 + 1] = v[1];
        acc[i * 3 + 2] = v[2];
    }
    acc
}

fn generate_tangents(
    positions: &[f32],
    normals: &[f32],
    uvs: &[f32],
    n: usize,
    indices: &ResolvedIndices,
) -> Vec<f32> {
    let mut tan = vec![0.0f32; n * 3];
    let mut bitan = vec![0.0f32; n * 3];

    if indices.is_triangle_list {
        for tri in indices.list.chunks_exact(3) {
            let (a, b, c) = (tri[0] as usize, tri[1] as usize, tri[2] as usize);
            if a >= n || b >= n || c >= n {
                continue;
            }
            let p = |i: usize| [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
            let t = |i: usize| [uvs[i * 2], uvs[i * 2 + 1]];
            let (pa, pb, pc) = (p(a), p(b), p(c));
            let (ta, tb, tc) = (t(a), t(b), t(c));
            let e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
            let e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
            let du1 = tb[0] - ta[0];
            let dv1 = tb[1] - ta[1];
            let du2 = tc[0] - ta[0];
            let dv2 = tc[1] - ta[1];
            let det = du1 * dv2 - du2 * dv1;
            // A degenerate UV triangle (collapsed or mirrored onto a line) has
            // no defined tangent; skipping it leaves the vertex to be covered
            // by its other triangles, and the fallback below catches a vertex
            // that has none.
            if det.abs() < 1e-20 {
                continue;
            }
            let r = 1.0 / det;
            let sdir = [
                (dv2 * e1[0] - dv1 * e2[0]) * r,
                (dv2 * e1[1] - dv1 * e2[1]) * r,
                (dv2 * e1[2] - dv1 * e2[2]) * r,
            ];
            let tdir = [
                (du1 * e2[0] - du2 * e1[0]) * r,
                (du1 * e2[1] - du2 * e1[1]) * r,
                (du1 * e2[2] - du2 * e1[2]) * r,
            ];
            for &v in &[a, b, c] {
                for c3 in 0..3 {
                    tan[v * 3 + c3] += sdir[c3];
                    bitan[v * 3 + c3] += tdir[c3];
                }
            }
        }
    }

    let mut out = vec![0.0f32; n * 4];
    for i in 0..n {
        let nn = [normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]];
        let t = [tan[i * 3], tan[i * 3 + 1], tan[i * 3 + 2]];
        let dot = nn[0] * t[0] + nn[1] * t[1] + nn[2] * t[2];
        // Gram-Schmidt: the tangent must be perpendicular to the *shading*
        // normal, which interpolation has already tilted away from the
        // geometric one.
        let ortho = [t[0] - nn[0] * dot, t[1] - nn[1] * dot, t[2] - nn[2] * dot];
        let len = (ortho[0] * ortho[0] + ortho[1] * ortho[1] + ortho[2] * ortho[2]).sqrt();
        let t = if len > 1e-12 {
            [ortho[0] / len, ortho[1] / len, ortho[2] / len]
        } else {
            arbitrary_perpendicular(nn)
        };
        // w is the bitangent's handedness, the glTF/MikkTSpace convention the
        // shader's TBN reconstruction expects.
        let cr = [
            nn[1] * t[2] - nn[2] * t[1],
            nn[2] * t[0] - nn[0] * t[2],
            nn[0] * t[1] - nn[1] * t[0],
        ];
        let b = [bitan[i * 3], bitan[i * 3 + 1], bitan[i * 3 + 2]];
        let w = if cr[0] * b[0] + cr[1] * b[1] + cr[2] * b[2] < 0.0 { -1.0 } else { 1.0 };
        out[i * 4] = t[0];
        out[i * 4 + 1] = t[1];
        out[i * 4 + 2] = t[2];
        out[i * 4 + 3] = w;
    }
    out
}

/// Any unit vector perpendicular to `n`, chosen so the result varies smoothly
/// and never degenerates.
fn arbitrary_perpendicular(n: [f32; 3]) -> [f32; 3] {
    let up = if n[1].abs() > 0.99 { [1.0, 0.0, 0.0] } else { [0.0, 1.0, 0.0] };
    normalize3([
        up[1] * n[2] - up[2] * n[1],
        up[2] * n[0] - up[0] * n[2],
        up[0] * n[1] - up[1] * n[0],
    ])
}

fn fallback_tangents(normals: &[f32], n: usize) -> Vec<f32> {
    let mut out = vec![0.0f32; n * 4];
    for i in 0..n {
        let t = arbitrary_perpendicular([normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]]);
        out[i * 4] = t[0];
        out[i * 4 + 1] = t[1];
        out[i * 4 + 2] = t[2];
        out[i * 4 + 3] = 1.0;
    }
    out
}
