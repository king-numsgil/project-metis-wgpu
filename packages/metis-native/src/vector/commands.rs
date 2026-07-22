use lyon_path::Path;

#[derive(Clone, Debug)]
pub enum FillRule {
    NonZero,
    EvenOdd,
}

#[derive(Clone, Debug)]
pub enum PaintCommand {
    Fill {
        path: Path,
        fill_rule: FillRule,
    },
    Stroke {
        path: Path,
        width: f32,
    },
    /// Pre-tessellated geometry from the glyph cache — positions already
    /// transformed to screen space, indices using local (0-based) numbering.
    PreTessellated {
        vertices: Vec<[f32; 2]>,
        indices: Vec<u32>,
    },
}
