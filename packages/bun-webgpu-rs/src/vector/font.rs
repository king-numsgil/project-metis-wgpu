use std::collections::HashMap;
use lyon_path::path::Builder;
use lyon_path::geom::euclid::default::Transform2D;
use lyon_path::math::{point, vector};
use lyon_path::Path;
use lyon_tessellation::{FillOptions, FillRule as LyonFillRule, FillTessellator};
use ttf_parser::Face;

use crate::vector::commands::FillRule;
use crate::vector::tessellator::PositionCollector;

// ---------------------------------------------------------------------------
// Glyph cache
// ---------------------------------------------------------------------------

struct CachedGlyph {
    /// Position-only vertices in font units (no scale, no Y-flip).
    vertices: Vec<[f32; 2]>,
    indices: Vec<u32>,
    #[allow(dead_code)]
    advance: f32,
}

const PREWARM_RANGES: &[(u32, u32)] = &[
    (0x0020, 0x007E), // Basic Latin
    (0x00A0, 0x00FF), // Latin-1 Supplement
    (0x0152, 0x0153), // Œ / œ
    (0x2000, 0x206F), // General Punctuation
    (0x2190, 0x21FF), // Arrows
    (0x2200, 0x22FF), // Mathematical Operators
    (0x2100, 0x214F), // Letterlike Symbols
    (0x25A0, 0x25FF), // Geometric Shapes
    (0x2600, 0x26FF), // Miscellaneous Symbols
];

// ---------------------------------------------------------------------------
// Font store
// ---------------------------------------------------------------------------

struct FontEntry {
    bytes: Vec<u8>,
    face_index: u32,
    glyph_cache: HashMap<u16, CachedGlyph>,
    fill_rule: FillRule,
}

pub struct FontStore {
    fonts: HashMap<String, FontEntry>,
}

impl FontStore {
    pub fn new() -> Self {
        FontStore { fonts: HashMap::new() }
    }

    pub fn load(&mut self, name: String, path: &str, face_index: u32) -> Result<(), String> {
        let bytes = std::fs::read(path)
            .map_err(|e| format!("Failed to read font file '{}': {}", path, e))?;
        let face = Face::parse(&bytes, face_index)
            .map_err(|e| format!("Failed to parse font '{}': {:?}", path, e))?;
        let fill_rule = detect_fill_rule(&face);
        let glyph_cache = prewarm_cache(&face, fill_rule.clone());
        self.fonts.insert(name, FontEntry { bytes, face_index, glyph_cache, fill_rule });
        Ok(())
    }

    pub fn unload(&mut self, name: &str) {
        self.fonts.remove(name);
    }

    fn parse<'a>(&'a self, name: &str) -> Result<(Face<'a>, FillRule), String> {
        let entry = self.fonts.get(name)
            .ok_or_else(|| format!("Unknown font: '{}'", name))?;
        let face = Face::parse(&entry.bytes, entry.face_index)
            .map_err(|e| format!("Failed to parse font '{}': {:?}", name, e))?;
        Ok((face, entry.fill_rule.clone()))
    }
}

fn detect_fill_rule(face: &Face) -> FillRule {
    if face.tables().cff.is_some() { FillRule::EvenOdd } else { FillRule::NonZero }
}

// ---------------------------------------------------------------------------
// Cache pre-warming
// ---------------------------------------------------------------------------

fn prewarm_cache(face: &Face, fill_rule: FillRule) -> HashMap<u16, CachedGlyph> {
    let mut cache = HashMap::new();
    let mut tess = FillTessellator::new();
    let lyon_rule = to_lyon_fill_rule(&fill_rule);
    let options = FillOptions::default()
        .with_tolerance(0.25)
        .with_fill_rule(lyon_rule);
    let upm = face.units_per_em() as f32;
    for &(lo, hi) in PREWARM_RANGES {
        for cp in lo..=hi {
            let ch = match char::from_u32(cp) { Some(c) => c, None => continue };
            let glyph_id = match face.glyph_index(ch) { Some(id) => id, None => continue };
            if cache.contains_key(&glyph_id.0) { continue; }
            if let Some(glyph) = tessellate_glyph_in_font_units(face, glyph_id, upm, &options, &mut tess) {
                cache.insert(glyph_id.0, glyph);
            }
        }
    }
    cache
}

fn tessellate_glyph_in_font_units(
    face: &Face,
    glyph_id: ttf_parser::GlyphId,
    upm: f32,
    options: &FillOptions,
    tess: &mut FillTessellator,
) -> Option<CachedGlyph> {
    let mut path_builder = Path::builder();
    let mut writer = GlyphWriter { builder: &mut path_builder, transform: Transform2D::identity() };
    face.outline_glyph(glyph_id, &mut writer)?;
    let path = path_builder.build();
    let mut collector = PositionCollector::new();
    tess.tessellate_path(&path, options, &mut collector).ok()?;
    if collector.positions.is_empty() { return None; }
    let advance = face.glyph_hor_advance(glyph_id).map(|a| a as f32).unwrap_or(upm * 0.5);
    Some(CachedGlyph { vertices: collector.positions, indices: collector.indices, advance })
}

// ---------------------------------------------------------------------------
// GlyphWriter
// ---------------------------------------------------------------------------

struct GlyphWriter<'a> {
    builder: &'a mut Builder,
    transform: Transform2D<f32>,
}

impl ttf_parser::OutlineBuilder for GlyphWriter<'_> {
    fn move_to(&mut self, x: f32, y: f32) {
        self.builder.begin(self.transform.transform_point(point(x, y)));
    }
    fn line_to(&mut self, x: f32, y: f32) {
        self.builder.line_to(self.transform.transform_point(point(x, y)));
    }
    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        self.builder.quadratic_bezier_to(
            self.transform.transform_point(point(x1, y1)),
            self.transform.transform_point(point(x, y)),
        );
    }
    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        self.builder.cubic_bezier_to(
            self.transform.transform_point(point(x1, y1)),
            self.transform.transform_point(point(x2, y2)),
            self.transform.transform_point(point(x, y)),
        );
    }
    fn close(&mut self) { self.builder.close(); }
}

// ---------------------------------------------------------------------------
// render_text
// ---------------------------------------------------------------------------

pub fn render_text(
    font_store: &mut FontStore,
    font_name: &str,
    size_px: f32,
    text: &str,
    origin_x: f32,
    origin_y: f32,
    local_transform: &Transform2D<f32>,
    fill_tess: &mut FillTessellator,
    tolerance: f32,
    out_vertices: &mut Vec<[f32; 2]>,
    out_indices: &mut Vec<u32>,
) -> Result<FillRule, String> {
    struct GlyphWork {
        glyph_id_u16: u16,
        transform: Transform2D<f32>,
        need_tessellation: bool,
        is_notdef: bool,
    }

    let fill_rule;
    let upm;
    let mut work_items: Vec<GlyphWork> = Vec::new();
    let mut notdef_params: Vec<(f32, f32, f32, f32, f32, Transform2D<f32>)> = Vec::new();

    {
        let entry = font_store.fonts.get(font_name)
            .ok_or_else(|| format!("Unknown font: '{}'", font_name))?;
        let face = Face::parse(&entry.bytes, entry.face_index)
            .map_err(|e| format!("Failed to parse font '{}': {:?}", font_name, e))?;
        fill_rule = entry.fill_rule.clone();
        upm = face.units_per_em() as f32;
        let scale = size_px / upm;
        let mut cursor_fu: f32 = 0.0;
        for ch in text.chars() {
            let glyph_id = face.glyph_index(ch);
            let is_whitespace = ch.is_ascii_whitespace();
            let advance_fu = glyph_id
                .and_then(|id| face.glyph_hor_advance(id))
                .map(|a| a as f32)
                .unwrap_or(upm * 0.5);
            let cursor_px = cursor_fu * scale + origin_x;
            let glyph_transform = Transform2D::scale(scale, -scale)
                .then_translate(vector(cursor_px, origin_y))
                .then(local_transform);
            match glyph_id {
                None => {
                    if !is_whitespace {
                        notdef_params.push((size_px, cursor_px, origin_y, scale, upm, *local_transform));
                    }
                }
                Some(id) => {
                    let in_cache = entry.glyph_cache.contains_key(&id.0);
                    work_items.push(GlyphWork {
                        glyph_id_u16: id.0,
                        transform: glyph_transform,
                        need_tessellation: !in_cache,
                        is_notdef: false,
                    });
                }
            }
            cursor_fu += advance_fu;
        }
    }

    let mut new_entries: Vec<(u16, CachedGlyph)> = Vec::new();
    let has_misses = work_items.iter().any(|w| w.need_tessellation);
    if has_misses {
        let lyon_rule = to_lyon_fill_rule(&fill_rule);
        let options = FillOptions::default().with_tolerance(tolerance).with_fill_rule(lyon_rule);
        let entry = font_store.fonts.get(font_name).unwrap();
        let face = Face::parse(&entry.bytes, entry.face_index)
            .map_err(|e| format!("Failed to parse font '{}': {:?}", font_name, e))?;
        for item in &work_items {
            if !item.need_tessellation { continue; }
            if new_entries.iter().any(|(id, _)| *id == item.glyph_id_u16) { continue; }
            let glyph_id = ttf_parser::GlyphId(item.glyph_id_u16);
            if let Some(glyph) = tessellate_glyph_in_font_units(&face, glyph_id, upm, &options, fill_tess) {
                new_entries.push((item.glyph_id_u16, glyph));
            }
        }
    }

    if !new_entries.is_empty() {
        let entry = font_store.fonts.get_mut(font_name).unwrap();
        for (id, glyph) in new_entries {
            entry.glyph_cache.insert(id, glyph);
        }
    }

    {
        let entry = font_store.fonts.get(font_name).unwrap();
        for item in &work_items {
            if item.is_notdef { continue; }
            let cached = match entry.glyph_cache.get(&item.glyph_id_u16) {
                Some(c) => c,
                None => continue,
            };
            let base = out_vertices.len() as u32;
            for &[x, y] in &cached.vertices {
                let p = item.transform.transform_point(point(x, y));
                out_vertices.push([p.x, p.y]);
            }
            for &idx in &cached.indices {
                out_indices.push(idx + base);
            }
        }
    }

    for (size_px, cursor_px, origin_y, scale, upm, lt) in notdef_params {
        append_notdef_box(out_vertices, out_indices, size_px, cursor_px, origin_y, scale, upm, &lt);
    }

    Ok(fill_rule)
}

fn append_notdef_box(
    out_vertices: &mut Vec<[f32; 2]>,
    out_indices: &mut Vec<u32>,
    size_px: f32,
    cursor_px: f32,
    origin_y: f32,
    scale: f32,
    upm: f32,
    local_transform: &Transform2D<f32>,
) {
    let width  = upm * 0.5 * scale;
    let height = size_px * 0.7;
    let inset  = size_px * 0.05;
    let p0 = local_transform.transform_point(point(cursor_px + inset,         origin_y - height + inset));
    let p1 = local_transform.transform_point(point(cursor_px + width - inset, origin_y - height + inset));
    let p2 = local_transform.transform_point(point(cursor_px + width - inset, origin_y - inset));
    let p3 = local_transform.transform_point(point(cursor_px + inset,         origin_y - inset));
    let base = out_vertices.len() as u32;
    out_vertices.push([p0.x, p0.y]);
    out_vertices.push([p1.x, p1.y]);
    out_vertices.push([p2.x, p2.y]);
    out_vertices.push([p3.x, p3.y]);
    out_indices.extend_from_slice(&[base, base+1, base+2, base, base+2, base+3]);
}

// ---------------------------------------------------------------------------
// expand_text_path — for stroke support
// ---------------------------------------------------------------------------

pub fn expand_text_path(
    font_store: &FontStore,
    font_name: &str,
    size_px: f32,
    text: &str,
    origin_x: f32,
    origin_y: f32,
    local_transform: &Transform2D<f32>,
    builder: &mut Builder,
) -> Result<FillRule, String> {
    let (face, fill_rule) = font_store.parse(font_name)?;
    let upm = face.units_per_em() as f32;
    let scale = size_px / upm;
    let mut cursor_fu: f32 = 0.0;
    for ch in text.chars() {
        let glyph_id = face.glyph_index(ch);
        let is_whitespace = ch.is_ascii_whitespace();
        let advance_fu = glyph_id
            .and_then(|id| face.glyph_hor_advance(id))
            .map(|a| a as f32)
            .unwrap_or(upm * 0.5);
        let cursor_px = cursor_fu * scale + origin_x;
        match glyph_id {
            None => {
                if !is_whitespace {
                    write_notdef_box(builder, size_px, cursor_px, origin_y, scale, upm, local_transform);
                }
            }
            Some(id) => {
                let glyph_transform = Transform2D::scale(scale, -scale)
                    .then_translate(vector(cursor_px, origin_y))
                    .then(local_transform);
                let mut writer = GlyphWriter { builder, transform: glyph_transform };
                let has_outline = face.outline_glyph(id, &mut writer).is_some();
                if !has_outline && !is_whitespace {
                    write_notdef_box(builder, size_px, cursor_px, origin_y, scale, upm, local_transform);
                }
            }
        }
        cursor_fu += advance_fu;
    }
    Ok(fill_rule)
}

fn write_notdef_box(
    builder: &mut Builder,
    size_px: f32,
    cursor_px: f32,
    origin_y: f32,
    scale: f32,
    upm: f32,
    local_transform: &Transform2D<f32>,
) {
    let width  = upm * 0.5 * scale;
    let height = size_px * 0.7;
    let inset  = size_px * 0.05;
    let p0 = local_transform.transform_point(point(cursor_px + inset,         origin_y - height + inset));
    let p1 = local_transform.transform_point(point(cursor_px + width - inset, origin_y - height + inset));
    let p2 = local_transform.transform_point(point(cursor_px + width - inset, origin_y - inset));
    let p3 = local_transform.transform_point(point(cursor_px + inset,         origin_y - inset));
    builder.begin(p0);
    builder.line_to(p1);
    builder.line_to(p2);
    builder.line_to(p3);
    builder.close();
}

// ---------------------------------------------------------------------------
// Metric helpers
// ---------------------------------------------------------------------------

pub fn measure_text_width(font_store: &FontStore, font_name: &str, size_px: f32, text: &str) -> Result<f32, String> {
    let (face, _) = font_store.parse(font_name)?;
    let upm = face.units_per_em() as f32;
    let scale = size_px / upm;
    let mut cursor_fu: f32 = 0.0;
    for ch in text.chars() {
        cursor_fu += face
            .glyph_index(ch)
            .and_then(|id| face.glyph_hor_advance(id))
            .map(|a| a as f32)
            .unwrap_or(upm * 0.5);
    }
    Ok(cursor_fu * scale)
}

pub fn get_font_metrics(font_store: &FontStore, font_name: &str, size_px: f32) -> Result<(f32, f32, f32, f32, f32, f32, f32), String> {
    let (face, _) = font_store.parse(font_name)?;
    let upm = face.units_per_em() as f32;
    let scale = size_px / upm;
    let ascender  = face.ascender()  as f32 * scale;
    let descender = face.descender() as f32 * scale;
    let line_gap  = face.line_gap()  as f32 * scale;
    let line_height = ascender - descender + line_gap;
    let cap_height = face.capital_height().map(|v| v as f32 * scale).unwrap_or(ascender * 0.72);
    let x_height   = face.x_height()      .map(|v| v as f32 * scale).unwrap_or(ascender * 0.53);
    Ok((ascender, descender, line_gap, line_height, cap_height, x_height, upm))
}

fn to_lyon_fill_rule(rule: &FillRule) -> LyonFillRule {
    match rule {
        FillRule::NonZero => LyonFillRule::NonZero,
        FillRule::EvenOdd => LyonFillRule::EvenOdd,
    }
}
