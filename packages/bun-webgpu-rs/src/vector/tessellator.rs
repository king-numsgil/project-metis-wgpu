use lyon_path::Path;
use lyon_tessellation::{
    FillGeometryBuilder, FillOptions, FillRule, FillTessellator, FillVertex,
    GeometryBuilder, GeometryBuilderError, StrokeGeometryBuilder, StrokeOptions,
    StrokeTessellator, StrokeVertex, VertexId,
    LineCap, LineJoin,
};

use crate::vector::commands::{FillRule as CmdFillRule, PaintCommand};

// ---------------------------------------------------------------------------
// Position-only geometry builder
// ---------------------------------------------------------------------------

pub struct PositionCollector {
    pub positions: Vec<[f32; 2]>,
    pub indices: Vec<u32>,
    base_vertex: u32,
}

impl PositionCollector {
    pub fn new() -> Self {
        PositionCollector {
            positions: Vec::with_capacity(64),
            indices: Vec::with_capacity(96),
            base_vertex: 0,
        }
    }
}

impl GeometryBuilder for PositionCollector {
    fn begin_geometry(&mut self) {
        self.base_vertex = self.positions.len() as u32;
    }

    fn add_triangle(&mut self, a: VertexId, b: VertexId, c: VertexId) {
        self.indices.push(a.0 + self.base_vertex);
        self.indices.push(b.0 + self.base_vertex);
        self.indices.push(c.0 + self.base_vertex);
    }
}

impl FillGeometryBuilder for PositionCollector {
    fn add_fill_vertex(&mut self, vertex: FillVertex) -> Result<VertexId, GeometryBuilderError> {
        let local_id = self.positions.len() as u32 - self.base_vertex;
        let pos = vertex.position();
        self.positions.push([pos.x, pos.y]);
        Ok(VertexId(local_id))
    }
}

impl StrokeGeometryBuilder for PositionCollector {
    fn add_stroke_vertex(&mut self, vertex: StrokeVertex) -> Result<VertexId, GeometryBuilderError> {
        let local_id = self.positions.len() as u32 - self.base_vertex;
        let pos = vertex.position();
        self.positions.push([pos.x, pos.y]);
        Ok(VertexId(local_id))
    }
}

// ---------------------------------------------------------------------------
// Internal tessellation helpers
// ---------------------------------------------------------------------------

fn fill_positions(
    tessellator: &mut FillTessellator,
    path: &Path,
    fill_rule: &CmdFillRule,
    tolerance: f32,
    collector: &mut PositionCollector,
) -> bool {
    let lyon_rule = match fill_rule {
        CmdFillRule::NonZero => FillRule::NonZero,
        CmdFillRule::EvenOdd => FillRule::EvenOdd,
    };
    let options = FillOptions::default()
        .with_tolerance(tolerance)
        .with_fill_rule(lyon_rule);
    match tessellator.tessellate_path(path, &options, collector) {
        Ok(_) => true,
        Err(e) => { eprintln!("Fill tessellation failed: {:?}", e); false }
    }
}

fn stroke_positions(
    tessellator: &mut StrokeTessellator,
    path: &Path,
    width: f32,
    tolerance: f32,
    collector: &mut PositionCollector,
) -> bool {
    let options = StrokeOptions::default()
        .with_tolerance(tolerance)
        .with_line_width(width)
        .with_line_cap(LineCap::Round)
        .with_line_join(LineJoin::Round);
    match tessellator.tessellate_path(path, &options, collector) {
        Ok(_) => true,
        Err(e) => { eprintln!("Stroke tessellation failed: {:?}", e); false }
    }
}

fn aabb(positions: &[[f32; 2]]) -> (f32, f32, f32, f32) {
    let mut min_x = f32::MAX;
    let mut min_y = f32::MAX;
    let mut max_x = f32::MIN;
    let mut max_y = f32::MIN;
    for &[x, y] in positions {
        if x < min_x { min_x = x; }
        if y < min_y { min_y = y; }
        if x > max_x { max_x = x; }
        if y > max_y { max_y = y; }
    }
    (min_x, min_y, max_x, max_y)
}

/// Emit `[x, y, u, v]` vertices (16 bytes stride).
/// UVs are derived from the tight AABB of the draw call's geometry.
/// Color is not stored per-vertex — it lives in a per-instance color buffer.
fn emit_vertices(
    positions: &[[f32; 2]],
    local_indices: &[u32],
    out_vertices: &mut Vec<f32>,
    out_indices: &mut Vec<u32>,
) {
    let vertex_base = (out_vertices.len() / 4) as u32;

    let (min_x, min_y, max_x, max_y) = aabb(positions);
    let w = max_x - min_x;
    let h = max_y - min_y;

    out_vertices.reserve(positions.len() * 4);
    out_indices.reserve(local_indices.len());

    for &[x, y] in positions {
        let u = if w > 0.0 { (x - min_x) / w } else { 0.0 };
        let v = if h > 0.0 { (y - min_y) / h } else { 0.0 };
        out_vertices.extend_from_slice(&[x, y, u, v]);
    }
    for &idx in local_indices {
        out_indices.push(idx + vertex_base);
    }
}

// ---------------------------------------------------------------------------
// Public tessellation entry point
// ---------------------------------------------------------------------------

/// Returns `true` if geometry was produced and appended to the output vecs.
pub fn tessellate_command(
    cmd: PaintCommand,
    tolerance: f32,
    fill_tess: &mut FillTessellator,
    stroke_tess: &mut StrokeTessellator,
    vertices: &mut Vec<f32>,
    indices: &mut Vec<u32>,
) -> bool {
    let mut collector = PositionCollector::new();
    let ok = match cmd {
        PaintCommand::Fill { path, fill_rule } => {
            fill_positions(fill_tess, &path, &fill_rule, tolerance, &mut collector)
        }
        PaintCommand::Stroke { path, width } => {
            stroke_positions(stroke_tess, &path, width, tolerance, &mut collector)
        }
        PaintCommand::PreTessellated { vertices, indices } => {
            collector.positions = vertices;
            collector.indices = indices;
            true
        }
    };

    if !ok || collector.positions.is_empty() {
        return ok;
    }

    emit_vertices(&collector.positions, &collector.indices, vertices, indices);
    true
}
