//! Turning a glTF accessor into a flat, tightly-packed array of components.
//!
//! Everything awkward about glTF's binary layout is confined to this file, and
//! every consumer downstream of it sees a plain `Vec<f32>` or `Vec<u32>`. There
//! are four separate awkward things, and each one is a silent-corruption bug if
//! skipped rather than a loud failure:
//!
//! 1. **`bufferView.byteStride`.** Interleaved vertex data means consecutive
//!    elements are *not* adjacent. Reading `count * elementSize` contiguous
//!    bytes from the start offset produces a mesh that is subtly wrong — the
//!    right number of vertices, all in the wrong places — rather than an error.
//!
//! 2. **Matrix column padding.** glTF requires each column of a `MAT2`/`MAT3`
//!    accessor with 1- or 2-byte components to start on a 4-byte boundary, so a
//!    `MAT3` of `U8` occupies 12 bytes per element, not 9. Only matters for
//!    quantised matrices, which is to say: almost never, and then catastrophically.
//!
//! 3. **Sparse accessors.** An accessor may have *no* `bufferView` at all (it
//!    then reads as zeros) and a `sparse` block that overwrites a handful of
//!    elements by index. Ignoring sparse loses the only data the accessor has.
//!
//! 4. **`normalized`.** An integer accessor with `normalized: true` means a
//!    fixed-point fraction, and the un-normalising divisor differs per component
//!    type *and* differs between signed and unsigned (signed uses
//!    `max(v/MAX, -1)`, which is not the same as `v/MIN` for the extreme
//!    negative value). This is where `KHR_mesh_quantization` assets live.
//!
//! The output is deliberately *component-typed*, not byte-typed: a caller asks
//! for `f32` or `u32` and gets values, never a slice to reinterpret. This crate
//! has already lost a session to a byte-vs-value reinterpretation bug (see
//! `image/save.rs`), and an API that only hands back bytes invites the next one.

use super::enums::{GltfAccessorType, GltfComponentType};
use crate::image::generic_err;

/// One accessor's elements, de-strided, de-padded, sparse-substituted, and
/// tightly packed — but **not** yet converted from its component type.
pub(crate) struct AccessorData {
    pub(crate) component_type: GltfComponentType,
    pub(crate) accessor_type: GltfAccessorType,
    pub(crate) normalized: bool,
    pub(crate) count: usize,
    /// `count * accessor_type.components() * component_type.size()` bytes,
    /// little-endian, with no stride and no padding.
    pub(crate) bytes: Vec<u8>,
}

impl AccessorData {
    pub(crate) fn components(&self) -> usize {
        self.accessor_type.components()
    }
}

/// Byte span of one element *inside* the buffer, accounting for the 4-byte
/// column alignment glTF imposes on quantised matrices.
///
/// Returns `(element_span, column_stride, column_count, column_bytes)` where
/// `element_span` is what one element occupies in the source and the rest
/// describe how to copy it out without the padding.
fn element_layout(ty: GltfAccessorType, comp: GltfComponentType) -> (usize, usize, usize, usize) {
    let comp_size = comp.size();
    let (rows, cols) = match ty {
        GltfAccessorType::Mat2 => (2, 2),
        GltfAccessorType::Mat3 => (3, 3),
        GltfAccessorType::Mat4 => (4, 4),
        // Vectors and scalars are one "column" and never padded.
        other => (other.components(), 1),
    };
    let column_bytes = rows * comp_size;
    let column_stride = column_bytes.div_ceil(4) * 4;
    if cols == 1 {
        (column_bytes, column_bytes, 1, column_bytes)
    } else {
        (column_stride * cols, column_stride, cols, column_bytes)
    }
}

/// Copy `count` elements out of `src`, honouring `stride` between elements and
/// stripping matrix column padding.
fn gather(
    src: &[u8],
    start: usize,
    count: usize,
    stride: usize,
    element_span: usize,
    column_stride: usize,
    columns: usize,
    column_bytes: usize,
    what: &str,
) -> napi::Result<Vec<u8>> {
    let packed_element = columns * column_bytes;
    let mut out = vec![0u8; count * packed_element];
    for i in 0..count {
        let base = start + i * stride;
        if base + element_span > src.len() {
            return Err(generic_err(format!(
                "{what}: element {i} of {count} runs past the end of its buffer \
                 (needs bytes {}..{}, buffer is {} bytes)",
                base,
                base + element_span,
                src.len()
            )));
        }
        for c in 0..columns {
            let s = base + c * column_stride;
            let d = i * packed_element + c * column_bytes;
            out[d..d + column_bytes].copy_from_slice(&src[s..s + column_bytes]);
        }
    }
    Ok(out)
}

/// Read an accessor into packed component bytes.
///
/// `buffers[i]` is the fully-resolved contents of `buffers[i]` in the file, or
/// `None` if that buffer was skipped by an override — which is an error here
/// rather than silently zero-filled, because an accessor that reads zeros looks
/// like a degenerate mesh, not like a missing file.
pub(crate) fn read_accessor(
    accessor: &gltf::Accessor<'_>,
    buffers: &[Option<Vec<u8>>],
    what: &str,
) -> napi::Result<AccessorData> {
    let comp = GltfComponentType::from_gltf(accessor.data_type());
    let ty = GltfAccessorType::from_gltf(accessor.dimensions());
    let count = accessor.count();
    let (element_span, column_stride, columns, column_bytes) = element_layout(ty, comp);
    let packed_element = columns * column_bytes;

    // No bufferView: the spec says every element reads as zero, and a `sparse`
    // block (below) supplies whatever is actually non-zero.
    let mut bytes = match accessor.view() {
        None => vec![0u8; count * packed_element],
        Some(view) => {
            let buf = buffer_bytes(buffers, view.buffer().index(), what)?;
            let stride = view.stride().unwrap_or(element_span);
            if stride < element_span {
                return Err(generic_err(format!(
                    "{what}: bufferView byteStride is {stride} but one element is {element_span} bytes"
                )));
            }
            let start = view.offset() + accessor.offset();
            // The view's own length bounds the read; a stride-based walk can
            // legally end mid-view, but must not leave it.
            let view_end = view.offset() + view.length();
            if count > 0 && start + (count - 1) * stride + element_span > view_end.min(buf.len()) {
                return Err(generic_err(format!(
                    "{what}: accessor of {count} elements (stride {stride}) runs past the end of its bufferView"
                )));
            }
            gather(buf, start, count, stride, element_span, column_stride, columns, column_bytes, what)?
        }
    };

    if let Some(sparse) = accessor.sparse() {
        apply_sparse(&mut bytes, &sparse, buffers, count, packed_element, what)?;
    }

    Ok(AccessorData { component_type: comp, accessor_type: ty, normalized: accessor.normalized(), count, bytes })
}

fn buffer_bytes<'a>(buffers: &'a [Option<Vec<u8>>], index: usize, what: &str) -> napi::Result<&'a [u8]> {
    match buffers.get(index) {
        Some(Some(b)) => Ok(b.as_slice()),
        Some(None) => Err(generic_err(format!(
            "{what}: buffers[{index}] was skipped by a resourceOverride, but an accessor still reads from it"
        ))),
        None => Err(generic_err(format!("{what}: references buffers[{index}], which does not exist"))),
    }
}

/// Overwrite the elements a sparse block names.
///
/// The values side is a plain packed array (no stride, no sparse of its own);
/// the indices side is its own little accessor with a `U8`/`U16`/`U32` type.
fn apply_sparse(
    dst: &mut [u8],
    sparse: &gltf::accessor::sparse::Sparse<'_>,
    buffers: &[Option<Vec<u8>>],
    count: usize,
    packed_element: usize,
    what: &str,
) -> napi::Result<()> {
    let n = sparse.count();
    let indices = sparse.indices();
    let index_size = match indices.index_type() {
        gltf::accessor::sparse::IndexType::U8 => 1usize,
        gltf::accessor::sparse::IndexType::U16 => 2,
        gltf::accessor::sparse::IndexType::U32 => 4,
    };

    let iview = indices.view();
    let ibuf = buffer_bytes(buffers, iview.buffer().index(), what)?;
    let istart = iview.offset() + indices.offset();
    if istart + n * index_size > ibuf.len() {
        return Err(generic_err(format!("{what}: sparse indices run past the end of their buffer")));
    }

    let vview = sparse.values().view();
    let vbuf = buffer_bytes(buffers, vview.buffer().index(), what)?;
    let vstart = vview.offset() + sparse.values().offset();
    if vstart + n * packed_element > vbuf.len() {
        return Err(generic_err(format!("{what}: sparse values run past the end of their buffer")));
    }

    for i in 0..n {
        let o = istart + i * index_size;
        let target = match index_size {
            1 => ibuf[o] as usize,
            2 => u16::from_le_bytes([ibuf[o], ibuf[o + 1]]) as usize,
            _ => u32::from_le_bytes([ibuf[o], ibuf[o + 1], ibuf[o + 2], ibuf[o + 3]]) as usize,
        };
        if target >= count {
            return Err(generic_err(format!(
                "{what}: sparse index {target} is out of range for an accessor of {count} elements"
            )));
        }
        let d = target * packed_element;
        let s = vstart + i * packed_element;
        dst[d..d + packed_element].copy_from_slice(&vbuf[s..s + packed_element]);
    }
    Ok(())
}

// ── component conversion ────────────────────────────────────────────────────

/// Read component `i` as an `f32`, applying `normalized` if set.
///
/// The signed normalisation is `max(v / MAX, -1)` rather than `v / -MIN`,
/// per the glTF spec: two's complement has one more negative value than
/// positive, and both `-127` and `-128` must map to exactly `-1.0`.
fn component_f32(data: &AccessorData, i: usize) -> f32 {
    let b = &data.bytes;
    match data.component_type {
        GltfComponentType::F32 => f32::from_le_bytes([b[i * 4], b[i * 4 + 1], b[i * 4 + 2], b[i * 4 + 3]]),
        GltfComponentType::U8 => {
            let v = b[i] as f32;
            if data.normalized { v / 255.0 } else { v }
        }
        GltfComponentType::I8 => {
            let v = b[i] as i8 as f32;
            if data.normalized { (v / 127.0).max(-1.0) } else { v }
        }
        GltfComponentType::U16 => {
            let v = u16::from_le_bytes([b[i * 2], b[i * 2 + 1]]) as f32;
            if data.normalized { v / 65535.0 } else { v }
        }
        GltfComponentType::I16 => {
            let v = i16::from_le_bytes([b[i * 2], b[i * 2 + 1]]) as f32;
            if data.normalized { (v / 32767.0).max(-1.0) } else { v }
        }
        GltfComponentType::U32 => u32::from_le_bytes([b[i * 4], b[i * 4 + 1], b[i * 4 + 2], b[i * 4 + 3]]) as f32,
    }
}

/// Read component `i` as a `u32`, ignoring `normalized` (an index or a joint
/// id is an integer even when the accessor mislabels it).
fn component_u32(data: &AccessorData, i: usize) -> u32 {
    let b = &data.bytes;
    match data.component_type {
        GltfComponentType::U8 => b[i] as u32,
        GltfComponentType::I8 => b[i] as i8 as i32 as u32,
        GltfComponentType::U16 => u16::from_le_bytes([b[i * 2], b[i * 2 + 1]]) as u32,
        GltfComponentType::I16 => i16::from_le_bytes([b[i * 2], b[i * 2 + 1]]) as i32 as u32,
        GltfComponentType::U32 => u32::from_le_bytes([b[i * 4], b[i * 4 + 1], b[i * 4 + 2], b[i * 4 + 3]]),
        GltfComponentType::F32 => f32::from_le_bytes([b[i * 4], b[i * 4 + 1], b[i * 4 + 2], b[i * 4 + 3]]) as u32,
    }
}

/// Every component, in element order, as `f32`.
pub(crate) fn to_f32(data: &AccessorData) -> Vec<f32> {
    let n = data.count * data.components();
    (0..n).map(|i| component_f32(data, i)).collect()
}

/// Every component, in element order, as `u32`.
pub(crate) fn to_u32(data: &AccessorData) -> Vec<u32> {
    let n = data.count * data.components();
    (0..n).map(|i| component_u32(data, i)).collect()
}
