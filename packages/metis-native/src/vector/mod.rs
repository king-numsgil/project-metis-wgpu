mod commands;
mod font;
mod tessellator;

use std::f32::consts::PI;
use std::sync::Arc;

use lyon_path::math::point;
use lyon_path::geom::euclid::default::Transform2D;
use lyon_path::Path;
use lyon_tessellation::{FillTessellator, StrokeTessellator};
use napi_derive::napi;

use commands::{FillRule, PaintCommand};
use font::FontStore;
use tessellator::tessellate_command;

use crate::gpu::command_encoder::GpuRenderPassEncoder;
use crate::gpu::device::GpuDevice;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Font metrics in pixels at a given size.
#[napi(object)]
pub struct FontMetrics {
    pub ascender:     f64,
    pub descender:    f64,
    pub line_gap:     f64,
    pub line_height:  f64,
    pub cap_height:   f64,
    pub x_height:     f64,
    pub units_per_em: f64,
}

/// One tessellated draw call produced by `flush()`.
///
/// The caller iterates `drawCalls`, sets their own per-call bind groups
/// (paint, model matrix, …), then issues `drawIndexed` using `firstIndex`
/// and `indexCount`.  `id` is the value passed to `setId()` and can be used
/// to look up widget-level data.
#[napi(object)]
#[derive(Clone)]
pub struct DrawCall {
    pub first_index:  u32,
    pub index_count:  u32,
    pub id:           u32,
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

#[derive(Clone, Copy)]
enum DrawKind {
    Fill,
    Stroke,
}

struct PendingDraw {
    command: PaintCommand,
    id:      u32,
    #[allow(dead_code)] kind: DrawKind,
}

// ---------------------------------------------------------------------------
// VectorContext
// ---------------------------------------------------------------------------

/// 2-D vector drawing context backed by Lyon tessellation.
///
/// `VectorContext` owns the GPU vertex and index buffers for tessellated
/// geometry.  Color, paint, and model transforms are entirely the caller's
/// responsibility and are not tracked here.
///
/// Typical frame loop:
/// 1. Draw with the path / text / transform API.
/// 2. `flush()` — tessellates and uploads geometry to the GPU buffers.
/// 3. In your render pass:
///    a. Bind your pipeline.
///    b. `bindBuffers(pass)` — sets vertex buffer (slot 0, stride 16,
///       layout `[x, y, u, v]`) and index buffer (Uint32) on the pass.
///    c. Iterate `drawCalls`, set per-call bind groups, call `drawIndexed`.
///
/// Paths need not be closed: `stroke()` on an open path draws it open, and
/// `fill()` closes it implicitly (as canvas does).
#[napi]
pub struct VectorContext {
    // ── Drawing state ─────────────────────────────────────────────────────────
    path_builder:      Option<lyon_path::path::Builder>,
    current_path:      Option<Path>,
    /// Deferred outline for the last `draw_text`. Building the lyon `Path` for a
    /// string means re-parsing the face and outlining every glyph — far more
    /// expensive than the cached, pre-tessellated geometry `fill()` uses, and
    /// only `stroke()` ever needs it. So keep the inputs and expand on demand.
    text_path_source:  Option<TextPathSource>,
    /// Whether `begin()` has been called without a matching `end()`/`close()`.
    /// lyon panics if `build()` runs with a sub-path still open, or if `begin()`
    /// is called while one is — so every entry point that opens or consumes a
    /// sub-path has to keep this straight.
    subpath_open:      bool,
    /// Start point of the most recent sub-path. Canvas resumes from here after a
    /// `closePath()`, and lyon panics on a segment with no sub-path open, so the
    /// two requirements are the same bookkeeping.
    subpath_start:     Option<lyon_path::math::Point>,
    path_is_from_text: bool,
    text_fill_rule:    FillRule,
    pending_render:    Option<(Vec<[f32; 2]>, Vec<u32>, FillRule)>,
    local_stack:       Vec<Transform2D<f32>>,
    pending:           Vec<PendingDraw>,
    fonts:             FontStore,
    current_id:        u32,
    fill_tess:         FillTessellator,
    stroke_tess:       StrokeTessellator,
    tolerance:         f32,

    // ── GPU resources ─────────────────────────────────────────────────────────
    device:       Arc<wgpu::Device>,
    queue:        Arc<wgpu::Queue>,
    vtx_buf:      Option<wgpu::Buffer>,
    vtx_buf_size: u64,
    idx_buf:      Option<wgpu::Buffer>,
    idx_buf_size: u64,
    draw_calls:   Vec<DrawCall>,
}

unsafe impl Send for VectorContext {}
unsafe impl Sync for VectorContext {}

/// Everything `expand_text_path` needs, so a `draw_text` outline can be built
/// lazily on the first `stroke()` instead of eagerly on every call.
struct TextPathSource {
    font_name: String,
    size_px:   f32,
    text:      String,
    x:         f32,
    y:         f32,
    transform: Transform2D<f32>,
}

fn current_local(stack: &[Transform2D<f32>]) -> Transform2D<f32> {
    stack.last().copied().unwrap_or_else(Transform2D::identity)
}

/// lyon **asserts** every point is finite and panics if not — and a panic across
/// the napi boundary aborts the process rather than throwing something JS can
/// catch. Canvas instead ignores non-finite arguments, which is both safer and
/// the semantics this API is modelled on. Checked after the local transform,
/// since a non-finite transform turns finite inputs non-finite.
fn finite(p: lyon_path::math::Point) -> bool {
    p.x.is_finite() && p.y.is_finite()
}

fn transform_finite(t: &Transform2D<f32>) -> bool {
    t.m11.is_finite() && t.m12.is_finite() && t.m21.is_finite()
        && t.m22.is_finite() && t.m31.is_finite() && t.m32.is_finite()
}

#[napi]
impl VectorContext {
    /// Create a new `VectorContext`.
    ///
    /// - `device` — the wgpu device that owns the vertex / index buffers.
    /// - `tolerance` — flattening tolerance **for paths** (`fill`/`stroke`), in
    ///   the same pixel-space coordinates the path is built in (default
    ///   `0.25`). Lower = smoother curves, more triangles.
    ///
    /// This does **not** affect text: glyph geometry is cached per size bucket
    /// and flattened at a tolerance derived from the requested pixel size (see
    /// `font.rs`), because a glyph is tessellated once in font units and then
    /// only transformed.
    #[napi(constructor)]
    pub fn new(device: &GpuDevice, tolerance: Option<f64>) -> napi::Result<Self> {
        Ok(VectorContext {
            path_builder: None,
            current_path: None,
            text_path_source: None,
            subpath_open: false,
            subpath_start: None,
            path_is_from_text: false,
            text_fill_rule: FillRule::NonZero,
            pending_render: None,
            local_stack: Vec::new(),
            pending: Vec::new(),
            fonts: FontStore::new(),
            current_id: 0,
            fill_tess: FillTessellator::new(),
            stroke_tess: StrokeTessellator::new(),
            tolerance: tolerance.map(|t| t as f32).unwrap_or(0.25),
            device: Arc::clone(&device.inner),
            queue: Arc::clone(&device.queue_inner),
            vtx_buf: None,
            vtx_buf_size: 0,
            idx_buf: None,
            idx_buf_size: 0,
            draw_calls: Vec::new(),
        })
    }

    // ── ID scope ──────────────────────────────────────────────────────────────

    /// Tag subsequent draw calls with `id`.  The value is surfaced in the
    /// `drawCalls` array after `flush()`.
    #[napi]
    pub fn set_id(&mut self, id: u32) {
        self.current_id = id;
    }

    // ── Transform API ─────────────────────────────────────────────────────────

    /// Push a 2-D affine transform onto the stack, nesting it *inside* the
    /// current top.  `matrix` is 6 floats in column-major order:
    /// `[m00, m01, m10, m11, m20, m21]` — the same layout as canvas's
    /// `setTransform(a, b, c, d, e, f)`.
    ///
    /// Nesting means a point is transformed by the innermost (most recently
    /// pushed) transform first, then outward — so pushing `translate(100, 0)`
    /// and then `scale(2)` draws a point at `(10, 10)` at `(120, 20)`: scaled in
    /// the translated group's local space. This matches canvas/SVG.
    #[napi]
    pub fn push_transform(&mut self, matrix: napi::bindgen_prelude::Float32Array) {
        let m = matrix.as_ref();
        let t = Transform2D::new(
            m.get(0).copied().unwrap_or(1.0),
            m.get(1).copied().unwrap_or(0.0),
            m.get(2).copied().unwrap_or(0.0),
            m.get(3).copied().unwrap_or(1.0),
            m.get(4).copied().unwrap_or(0.0),
            m.get(5).copied().unwrap_or(0.0),
        );
        // A non-finite matrix would make every transformed point non-finite and
        // panic lyon. Canvas ignores such a transform; still push a level, so the
        // caller's matching popTransform doesn't pop the parent instead.
        // `a.then(&b)` applies a, then b — so nesting is t.then(parent): the new
        // (inner) transform first, then the enclosing one. The reverse
        // (parent.then(&t)) applies the parent to the point first, which makes a
        // transform *stack* useless for its only purpose, since a child's
        // coordinates would not be in its parent's local space.
        let combined = if transform_finite(&t) {
            t.then(&current_local(&self.local_stack))
        } else {
            current_local(&self.local_stack)
        };
        self.local_stack.push(combined);
    }

    #[napi]
    pub fn pop_transform(&mut self) {
        if !self.local_stack.is_empty() { self.local_stack.pop(); }
    }

    // ── Path construction ─────────────────────────────────────────────────────

    #[napi]
    pub fn begin_path(&mut self) {
        self.path_builder = Some(Path::builder());
        self.current_path = None;
        self.text_path_source = None;
        self.subpath_open = false;
        self.subpath_start = None;
        self.pending_render = None;
        self.path_is_from_text = false;
        self.text_fill_rule = FillRule::NonZero;
    }

    #[napi]
    pub fn move_to(&mut self, x: f64, y: f64) {
        let lt = current_local(&self.local_stack);
        let p = lt.transform_point(point(x as f32, y as f32));
        if !finite(p) { return; }
        if let Some(b) = &mut self.path_builder {
            // A second moveTo starts a new sub-path; the previous one has to be
            // ended (unclosed) first or lyon panics.
            if self.subpath_open { b.end(false); }
            b.begin(p);
            self.subpath_open = true;
            self.subpath_start = Some(p);
        }
    }

    #[napi]
    pub fn line_to(&mut self, x: f64, y: f64) {
        let lt = current_local(&self.local_stack);
        let p = lt.transform_point(point(x as f32, y as f32));
        if !finite(p) { return; }
        // Canvas: a lineTo with no sub-path *at all* is just a moveTo — it starts
        // one and draws no segment.
        let fresh = !self.subpath_open && self.subpath_start.is_none();
        if !self.open_subpath(p) { return; }
        if fresh { return; }
        if let Some(b) = &mut self.path_builder { b.line_to(p); }
    }

    #[napi]
    pub fn quad_to(&mut self, cx: f64, cy: f64, x: f64, y: f64) {
        let lt = current_local(&self.local_stack);
        let ctrl = lt.transform_point(point(cx as f32, cy as f32));
        let end  = lt.transform_point(point(x  as f32, y  as f32));
        if !finite(ctrl) || !finite(end) { return; }
        // Canvas: with no sub-path, one starts at the first control point and the
        // curve is still drawn (unlike lineTo).
        if !self.open_subpath(ctrl) { return; }
        if let Some(b) = &mut self.path_builder { b.quadratic_bezier_to(ctrl, end); }
    }

    #[napi]
    pub fn cubic_to(&mut self, c1x: f64, c1y: f64, c2x: f64, c2y: f64, x: f64, y: f64) {
        let lt = current_local(&self.local_stack);
        let c1  = lt.transform_point(point(c1x as f32, c1y as f32));
        let c2  = lt.transform_point(point(c2x as f32, c2y as f32));
        let end = lt.transform_point(point(x   as f32, y   as f32));
        if !finite(c1) || !finite(c2) || !finite(end) { return; }
        if !self.open_subpath(c1) { return; }
        if let Some(b) = &mut self.path_builder { b.cubic_bezier_to(c1, c2, end); }
    }

    /// Arc centred at `(cx, cy)` with `radius`.  `sweepAngle` is a delta in
    /// radians from `startAngle` (not an absolute end angle).
    #[napi]
    pub fn arc(&mut self, cx: f64, cy: f64, radius: f64, start_angle: f64, sweep_angle: f64) {
        let lt    = current_local(&self.local_stack);
        let cx    = cx as f32;
        let cy    = cy as f32;
        let r     = radius as f32;
        let start = start_angle as f32;
        let sweep = sweep_angle as f32;
        if !cx.is_finite() || !cy.is_finite() || !r.is_finite()
            || !start.is_finite() || !sweep.is_finite() { return; }
        // Clamp to one full turn, as canvas does. Without this the step count
        // grows with |sweep| without bound: arc(…, sweep = 1e6) tessellated to
        // ~92M indices (~370 MB of buffers) from a single call.
        let sweep = sweep.clamp(-2.0 * PI, 2.0 * PI);
        let steps = ((sweep.abs() / (2.0 * PI)) * 64.0).ceil().max(4.0) as usize;
        let step_angle = sweep / steps as f32;
        let first = lt.transform_point(point(cx + r * start.cos(), cy + r * start.sin()));
        if !finite(first) { return; }
        let builder = match &mut self.path_builder { Some(b) => b, None => return };
        if self.subpath_open { builder.end(false); }
        builder.begin(first);
        self.subpath_open = true;
        self.subpath_start = Some(first);
        for i in 1..=steps {
            let angle = start + step_angle * i as f32;
            let p = lt.transform_point(point(cx + r * angle.cos(), cy + r * angle.sin()));
            if finite(p) { builder.line_to(p); }
        }
    }

    #[napi]
    pub fn close_path(&mut self) {
        if let Some(b) = &mut self.path_builder {
            if self.subpath_open {
                b.close();
                self.subpath_open = false;
            }
        }
    }

    // ── Paint ─────────────────────────────────────────────────────────────────

    #[napi]
    pub fn fill(&mut self) { self.push_fill_command(); }

    #[napi]
    pub fn stroke(&mut self, width: f64) { self.push_stroke_command(width as f32); }

    /// Opens a sub-path if none is current, per canvas:
    /// - after `closePath()`, the new sub-path starts at the *closed* sub-path's
    ///   start point (so a following segment is drawn from there);
    /// - if no sub-path was ever started, it begins at `fallback`.
    ///
    /// Returns whether the builder is ready to take a segment. lyon panics on a
    /// segment with no open sub-path, so every segment method goes through this.
    fn open_subpath(&mut self, fallback: lyon_path::math::Point) -> bool {
        if self.subpath_open { return true; }
        let start = self.subpath_start.unwrap_or(fallback);
        let Some(b) = &mut self.path_builder else { return false };
        b.begin(start);
        self.subpath_open = true;
        self.subpath_start = Some(start);
        true
    }

    fn take_path(&mut self) -> Option<Path> {
        if let Some(mut builder) = self.path_builder.take() {
            // An open sub-path is the normal case for stroke() — a polyline that
            // shouldn't have a closing segment. End it without closing so build()
            // doesn't panic and the geometry stays open.
            if self.subpath_open {
                builder.end(false);
                self.subpath_open = false;
            }
            self.subpath_start = None;
            let path = builder.build();
            self.current_path = Some(path.clone());
            return Some(path);
        }
        // A path was requested for text that only had its fill geometry built —
        // expand the outline now (see `text_path_source`).
        if self.current_path.is_none() {
            if let Some(src) = self.text_path_source.take() {
                let mut builder = Path::builder();
                // Can't realistically fail: draw_text resolved this same font
                // through render_text before recording the source.
                font::expand_text_path(
                    &self.fonts, &src.font_name, src.size_px, &src.text,
                    src.x, src.y, &src.transform, &mut builder,
                ).ok()?;
                self.current_path = Some(builder.build());
            }
        }
        self.current_path.clone()
    }

    fn push_fill_command(&mut self) {
        if let Some((verts, idxs, _fill_rule)) = self.pending_render.take() {
            self.pending.push(PendingDraw {
                command: PaintCommand::PreTessellated { vertices: verts, indices: idxs },
                id:   self.current_id,
                kind: DrawKind::Fill,
            });
            return;
        }
        let fill_rule = if self.path_is_from_text { self.text_fill_rule.clone() } else { FillRule::NonZero };
        let path = match self.take_path() { Some(p) => p, None => return };
        self.pending.push(PendingDraw {
            command: PaintCommand::Fill { path, fill_rule },
            id:   self.current_id,
            kind: DrawKind::Fill,
        });
    }

    fn push_stroke_command(&mut self, width: f32) {
        self.pending_render = None;
        let path = match self.take_path() { Some(p) => p, None => return };
        self.pending.push(PendingDraw {
            command: PaintCommand::Stroke { path, width },
            id:   self.current_id,
            kind: DrawKind::Stroke,
        });
    }

    // ── Font API ──────────────────────────────────────────────────────────────

    #[napi]
    pub fn load_font(&mut self, name: String, path: String, face_index: Option<u32>) -> napi::Result<()> {
        self.fonts.load(name, &path, face_index.unwrap_or(0)).map_err(napi::Error::from_reason)
    }

    #[napi]
    pub fn unload_font(&mut self, name: String) { self.fonts.unload(&name); }

    #[napi]
    pub fn draw_text(&mut self, text: String, font_name: String, size_px: f64, x: f64, y: f64) -> napi::Result<()> {
        if text.contains('\n') || text.contains('\r') {
            return Err(napi::Error::from_reason(
                "drawText is single-line only; split multi-line text in the caller",
            ));
        }
        let lt = current_local(&self.local_stack);
        // Non-finite position/size would put NaN vertices straight into the
        // buffer via the cached fill path (silently drawing nothing), and panic
        // lyon via the outline path on stroke(). Ignore, as canvas does.
        if !(x as f32).is_finite() || !(y as f32).is_finite()
            || !(size_px as f32).is_finite() || !transform_finite(&lt) {
            return Ok(());
        }
        let mut pre_verts: Vec<[f32; 2]> = Vec::new();
        let mut pre_idxs:  Vec<u32>      = Vec::new();
        let fill_rule = font::render_text(
            &mut self.fonts, &font_name, size_px as f32,
            &text, x as f32, y as f32, &lt,
            &mut self.fill_tess,
            &mut pre_verts, &mut pre_idxs,
        ).map_err(napi::Error::from_reason)?;
        self.pending_render = Some((pre_verts, pre_idxs, fill_rule.clone()));

        // Only record what an outline would need; expanding it here would double
        // the cost of every drawText and be discarded by the usual fill() path.
        self.text_path_source = Some(TextPathSource {
            font_name, size_px: size_px as f32, text, x: x as f32, y: y as f32, transform: lt,
        });
        self.current_path = None;
        self.path_builder = None;
        self.subpath_open = false;
        self.subpath_start = None;
        self.path_is_from_text = true;
        self.text_fill_rule = fill_rule;
        Ok(())
    }

    #[napi]
    pub fn font_metrics(&self, font_name: String, size_px: f64) -> napi::Result<FontMetrics> {
        let (asc, desc, gap, lh, cap, xh, upm) =
            font::get_font_metrics(&self.fonts, &font_name, size_px as f32)
                .map_err(napi::Error::from_reason)?;
        Ok(FontMetrics {
            ascender:     asc  as f64,
            descender:    desc as f64,
            line_gap:     gap  as f64,
            line_height:  lh   as f64,
            cap_height:   cap  as f64,
            x_height:     xh   as f64,
            units_per_em: upm  as f64,
        })
    }

    #[napi]
    pub fn measure_text(&self, font_name: String, size_px: f64, text: String) -> napi::Result<f64> {
        if text.contains('\n') || text.contains('\r') {
            return Err(napi::Error::from_reason(
                "measureText is single-line only; split multi-line text in the caller",
            ));
        }
        font::measure_text_width(&self.fonts, &font_name, size_px as f32, &text)
            .map(|w| w as f64)
            .map_err(napi::Error::from_reason)
    }

    // ── Flush / bind / clear ──────────────────────────────────────────────────

    /// Tessellate all pending draw commands and upload the resulting geometry
    /// to the GPU vertex and index buffers.  Resets the draw list.
    ///
    /// After this call, `drawCalls` is populated and ready to iterate.
    #[napi]
    pub fn flush(&mut self) {
        let pending = std::mem::take(&mut self.pending);
        self.current_path   = None;
        self.path_builder   = None;
        self.text_path_source = None;
        self.subpath_open   = false;
        self.subpath_start  = None;
        self.pending_render = None;
        self.local_stack.clear();
        self.draw_calls.clear();

        if pending.is_empty() { return; }

        let mut all_vertices: Vec<f32> = Vec::new();
        let mut all_indices:  Vec<u32> = Vec::new();
        let mut draw_calls: Vec<DrawCall> = Vec::with_capacity(pending.len());

        for draw in pending {
            let first_index = all_indices.len() as u32;
            let ok = tessellate_command(
                draw.command,
                self.tolerance,
                &mut self.fill_tess,
                &mut self.stroke_tess,
                &mut all_vertices,
                &mut all_indices,
            );
            if ok {
                let index_count = all_indices.len() as u32 - first_index;
                if index_count > 0 {
                    draw_calls.push(DrawCall { first_index, index_count, id: draw.id });
                }
            }
        }

        // Upload vertex buffer (grow-only).
        let vtx_bytes = (all_vertices.len() * 4) as u64;
        if vtx_bytes > 0 {
            if vtx_bytes > self.vtx_buf_size {
                self.vtx_buf_size = vtx_bytes.next_power_of_two().max(4096);
                self.vtx_buf = Some(self.device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("vector-vtx"),
                    size:  self.vtx_buf_size,
                    usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                }));
            }
            let bytes = unsafe {
                std::slice::from_raw_parts(all_vertices.as_ptr() as *const u8, all_vertices.len() * 4)
            };
            self.queue.write_buffer(self.vtx_buf.as_ref().unwrap(), 0, bytes);
        }

        // Upload index buffer (grow-only).
        let idx_bytes = (all_indices.len() * 4) as u64;
        if idx_bytes > 0 {
            if idx_bytes > self.idx_buf_size {
                self.idx_buf_size = idx_bytes.next_power_of_two().max(4096);
                self.idx_buf = Some(self.device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("vector-idx"),
                    size:  self.idx_buf_size,
                    usage: wgpu::BufferUsages::INDEX | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                }));
            }
            let bytes = unsafe {
                std::slice::from_raw_parts(all_indices.as_ptr() as *const u8, all_indices.len() * 4)
            };
            self.queue.write_buffer(self.idx_buf.as_ref().unwrap(), 0, bytes);
        }

        self.draw_calls = draw_calls;
    }

    /// The draw calls produced by the last `flush()`.
    ///
    /// Iterate this array inside your render pass to issue per-call bind
    /// group updates (paint, model matrix, …) and `drawIndexed` calls.
    #[napi(getter)]
    pub fn draw_calls(&self) -> Vec<DrawCall> {
        self.draw_calls.clone()
    }

    /// Bind the tessellated vertex buffer (slot 0) and index buffer (Uint32)
    /// onto `pass`.  Call this once before iterating `drawCalls`.
    ///
    /// Vertex layout — stride 16 bytes: `[x, y, u, v]` as `Float32x2` ×2.
    #[napi]
    pub fn bind_buffers(&self, pass: &GpuRenderPassEncoder) -> napi::Result<()> {
        let vtx_buf = match &self.vtx_buf { Some(b) => b, None => return Ok(()) };
        let idx_buf = match &self.idx_buf { Some(b) => b, None => return Ok(()) };
        pass.with_pass_raw(|rpass| {
            rpass.set_vertex_buffer(0, vtx_buf.slice(..));
            rpass.set_index_buffer(idx_buf.slice(..), wgpu::IndexFormat::Uint32);
            Ok(())
        })
    }

    /// Discard all pending draw commands without uploading anything.
    #[napi]
    pub fn clear(&mut self) {
        self.pending.clear();
        self.current_path   = None;
        self.path_builder   = None;
        self.text_path_source = None;
        self.subpath_open   = false;
        self.subpath_start  = None;
        self.pending_render = None;
        self.local_stack.clear();
        self.draw_calls.clear();
    }
}
