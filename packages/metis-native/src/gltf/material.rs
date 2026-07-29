//! glTF materials, flattened into one struct per material with every supported
//! extension already merged in.
//!
//! ## Two sources of truth, on purpose
//!
//! The `gltf` crate models a handful of `KHR_materials_*` extensions natively
//! (see `Cargo.toml` for the exact feature list) and leaves everything it does
//! not know about in a raw `extensions` map. This file reads **both**: the typed
//! accessors for the modelled ones, and `serde_json` for the rest —
//! `KHR_materials_clearcoat`, `_sheen`, `_anisotropy`, `_iridescence`,
//! `_dispersion`.
//!
//! That split is a property of the dependency, not of the spec, and it is
//! deliberately invisible in the output: `material.clearcoat` and
//! `material.transmission` look identical from TypeScript even though one came
//! from a typed accessor and the other from JSON. If a future `gltf` release
//! grows a `KHR_materials_clearcoat` feature, moving that one across should
//! change nothing a caller can observe.
//!
//! ## Unrecognised extensions are kept, not dropped
//!
//! Whatever this file does not model is serialised back out as JSON on
//! `GltfMaterial.extensions`. An importer that silently discards vendor
//! extensions is one that quietly loses data whenever an exporter is upgraded;
//! keeping the raw object costs a string and lets a caller implement an
//! extension without touching Rust. `extras` is carried the same way.
//!
//! ## Defaults are materialised, not left null
//!
//! Every factor comes back with the spec's default already applied
//! (`metallicFactor` 1, `ior` 1.5, `emissiveStrength` 1, …) rather than as
//! `null` meaning "look it up". A consumer that forgets one default renders a
//! subtly wrong material with no error, and there is exactly one right answer
//! per field, so it is filled in here.

use super::enums::GltfAlphaMode;
use napi_derive::napi;
use serde_json::Value;

/// A reference from a material slot to `textures[index]`, plus the UV set it
/// samples and any `KHR_texture_transform` applied to it.
#[napi(object)]
pub struct GltfTextureRef {
    /// Index into `GltfAsset.textures`.
    pub index: u32,
    /// Which `TEXCOORD_n` attribute this slot samples.
    pub tex_coord: u32,
    /// `KHR_texture_transform`, when present. Note its own `texCoord` (if set)
    /// **overrides** the one above — that is the extension's rule, and it is
    /// left as written rather than pre-applied so a caller can tell them apart.
    pub transform: Option<GltfTextureTransform>,
}

/// `KHR_texture_transform`: a 2D affine transform applied to UVs before sampling.
#[napi(object)]
pub struct GltfTextureTransform {
    /// `[u, v]`.
    pub offset: Vec<f64>,
    /// Counter-clockwise radians.
    pub rotation: f64,
    /// `[u, v]`.
    pub scale: Vec<f64>,
    /// Overrides the slot's `texCoord` when present.
    pub tex_coord: Option<u32>,
}

/// The normal-map slot: a texture reference plus its `scale`.
#[napi(object)]
pub struct GltfNormalTextureRef {
    pub index: u32,
    pub tex_coord: u32,
    /// Multiplies the sampled X and Y before the normal is reconstructed.
    pub scale: f64,
    pub transform: Option<GltfTextureTransform>,
}

/// The occlusion slot: a texture reference plus its `strength`.
#[napi(object)]
pub struct GltfOcclusionTextureRef {
    pub index: u32,
    pub tex_coord: u32,
    pub strength: f64,
    pub transform: Option<GltfTextureTransform>,
}

/// `KHR_materials_specular`.
#[napi(object)]
pub struct GltfSpecular {
    pub factor: f64,
    /// Linear RGB.
    pub color_factor: Vec<f64>,
    /// Alpha channel scales `factor`.
    pub texture: Option<GltfTextureRef>,
    /// RGB scales `colorFactor`.
    pub color_texture: Option<GltfTextureRef>,
}

/// `KHR_materials_transmission`.
#[napi(object)]
pub struct GltfTransmission {
    pub factor: f64,
    /// Red channel scales `factor`.
    pub texture: Option<GltfTextureRef>,
}

/// `KHR_materials_volume`. Only meaningful together with transmission.
#[napi(object)]
pub struct GltfVolume {
    pub thickness_factor: f64,
    /// Green channel scales `thicknessFactor`.
    pub thickness_texture: Option<GltfTextureRef>,
    /// Distance at which the transmitted colour equals `attenuationColor`.
    /// The spec's default is `+Infinity`; it is reported as `Infinity`, not as
    /// a sentinel, so arithmetic on it behaves.
    pub attenuation_distance: f64,
    pub attenuation_color: Vec<f64>,
}

/// `KHR_materials_clearcoat`.
#[napi(object)]
pub struct GltfClearcoat {
    pub factor: f64,
    pub texture: Option<GltfTextureRef>,
    pub roughness_factor: f64,
    pub roughness_texture: Option<GltfTextureRef>,
    pub normal_texture: Option<GltfNormalTextureRef>,
}

/// `KHR_materials_sheen`.
#[napi(object)]
pub struct GltfSheen {
    pub color_factor: Vec<f64>,
    pub color_texture: Option<GltfTextureRef>,
    pub roughness_factor: f64,
    pub roughness_texture: Option<GltfTextureRef>,
}

/// `KHR_materials_anisotropy`.
#[napi(object)]
pub struct GltfAnisotropy {
    pub strength: f64,
    /// Radians, counter-clockwise from the tangent.
    pub rotation: f64,
    pub texture: Option<GltfTextureRef>,
}

/// `KHR_materials_iridescence`.
#[napi(object)]
pub struct GltfIridescence {
    pub factor: f64,
    pub texture: Option<GltfTextureRef>,
    pub ior: f64,
    /// Nanometres.
    pub thickness_minimum: f64,
    /// Nanometres.
    pub thickness_maximum: f64,
    /// Green channel selects between minimum and maximum thickness.
    pub thickness_texture: Option<GltfTextureRef>,
}

/// One glTF material with every supported extension folded in and every spec
/// default applied.
#[napi(object)]
pub struct GltfMaterial {
    pub name: Option<String>,
    pub alpha_mode: GltfAlphaMode,
    /// Only meaningful when `alphaMode` is `Mask`. Defaults to 0.5.
    pub alpha_cutoff: f64,
    pub double_sided: bool,

    /// Linear RGBA. Multiplies `baseColorTexture` and any `COLOR_0` attribute.
    pub base_color_factor: Vec<f64>,
    pub base_color_texture: Option<GltfTextureRef>,
    pub metallic_factor: f64,
    pub roughness_factor: f64,
    /// Blue channel is metallic, green is roughness. (Red is unused by the core
    /// spec and is where `KHR_materials_*` extensions sometimes stash data.)
    pub metallic_roughness_texture: Option<GltfTextureRef>,

    pub normal_texture: Option<GltfNormalTextureRef>,
    pub occlusion_texture: Option<GltfOcclusionTextureRef>,

    /// Linear RGB, before `emissiveStrength`.
    pub emissive_factor: Vec<f64>,
    pub emissive_texture: Option<GltfTextureRef>,
    /// `KHR_materials_emissive_strength`. Defaults to 1; values above 1 are the
    /// whole point of the extension and require an HDR pipeline to show.
    pub emissive_strength: f64,

    /// `KHR_materials_unlit`: shade as unlit base colour, ignoring lights.
    pub unlit: bool,
    /// `KHR_materials_ior`. Defaults to 1.5 (the value the core spec's
    /// dielectric `f0` of 0.04 corresponds to).
    pub ior: f64,
    /// `KHR_materials_dispersion`. Defaults to 0.
    pub dispersion: f64,

    pub specular: Option<GltfSpecular>,
    pub transmission: Option<GltfTransmission>,
    pub volume: Option<GltfVolume>,
    pub clearcoat: Option<GltfClearcoat>,
    pub sheen: Option<GltfSheen>,
    pub anisotropy: Option<GltfAnisotropy>,
    pub iridescence: Option<GltfIridescence>,

    /// Raw JSON of every extension on this material that the fields above do
    /// **not** model — verbatim, so a caller can implement one without a Rust
    /// change. `null` when there are none.
    pub extensions: Option<String>,
    /// Raw JSON of the material's `extras`. `null` when absent.
    pub extras: Option<String>,
}

// ── raw-JSON helpers, for the extensions `gltf` does not model ──────────────

fn f64_at(v: &Value, key: &str, default: f64) -> f64 {
    v.get(key).and_then(Value::as_f64).unwrap_or(default)
}

fn vec_at(v: &Value, key: &str, default: &[f64]) -> Vec<f64> {
    v.get(key)
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_f64).collect::<Vec<_>>())
        .filter(|a| a.len() == default.len())
        .unwrap_or_else(|| default.to_vec())
}

/// Parse a glTF `textureInfo` object out of raw JSON, transform and all.
fn texture_ref_json(v: Option<&Value>) -> Option<GltfTextureRef> {
    let v = v?;
    let index = v.get("index")?.as_u64()? as u32;
    Some(GltfTextureRef {
        index,
        tex_coord: f64_at(v, "texCoord", 0.0) as u32,
        transform: transform_json(v.pointer("/extensions/KHR_texture_transform")),
    })
}

fn normal_texture_ref_json(v: Option<&Value>) -> Option<GltfNormalTextureRef> {
    let v = v?;
    let index = v.get("index")?.as_u64()? as u32;
    Some(GltfNormalTextureRef {
        index,
        tex_coord: f64_at(v, "texCoord", 0.0) as u32,
        scale: f64_at(v, "scale", 1.0),
        transform: transform_json(v.pointer("/extensions/KHR_texture_transform")),
    })
}

fn transform_json(v: Option<&Value>) -> Option<GltfTextureTransform> {
    let v = v?;
    Some(GltfTextureTransform {
        offset: vec_at(v, "offset", &[0.0, 0.0]),
        rotation: f64_at(v, "rotation", 0.0),
        scale: vec_at(v, "scale", &[1.0, 1.0]),
        tex_coord: v.get("texCoord").and_then(Value::as_u64).map(|n| n as u32),
    })
}

// ── typed-accessor helpers, for the ones `gltf` models ─────────────────────

fn texture_ref(info: Option<gltf::texture::Info<'_>>) -> Option<GltfTextureRef> {
    let info = info?;
    Some(GltfTextureRef {
        index: info.texture().index() as u32,
        tex_coord: info.tex_coord(),
        transform: info.texture_transform().map(|t| GltfTextureTransform {
            offset: t.offset().iter().map(|&x| x as f64).collect(),
            rotation: t.rotation() as f64,
            scale: t.scale().iter().map(|&x| x as f64).collect(),
            tex_coord: t.tex_coord(),
        }),
    })
}

/// Everything this file does not model, re-serialised. Returns `None` rather
/// than `"{}"` when the map is empty, so `if (material.extensions)` works.
fn leftover_extensions(map: Option<&serde_json::Map<String, Value>>) -> Option<String> {
    let map = map?;
    let rest: serde_json::Map<String, Value> = map
        .iter()
        .filter(|(k, _)| !MODELLED_EXTENSIONS.contains(&k.as_str()))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    if rest.is_empty() { None } else { serde_json::to_string(&rest).ok() }
}

/// Material extensions whose contents already have typed fields above, so they
/// are not repeated in the raw `extensions` passthrough.
const MODELLED_EXTENSIONS: &[&str] = &[
    "KHR_materials_clearcoat",
    "KHR_materials_sheen",
    "KHR_materials_anisotropy",
    "KHR_materials_iridescence",
    "KHR_materials_dispersion",
];

pub(crate) fn extras_json(extras: &gltf::json::Extras) -> Option<String> {
    extras.as_ref().map(|raw| raw.get().to_owned())
}

/// Convert one `gltf::Material` into the flattened form above.
pub(crate) fn convert(m: &gltf::Material<'_>) -> GltfMaterial {
    let pbr = m.pbr_metallic_roughness();
    let ext = m.extensions();
    let get = |name: &str| ext.and_then(|e| e.get(name));

    let clearcoat = get("KHR_materials_clearcoat").map(|v| GltfClearcoat {
        factor: f64_at(v, "clearcoatFactor", 0.0),
        texture: texture_ref_json(v.get("clearcoatTexture")),
        roughness_factor: f64_at(v, "clearcoatRoughnessFactor", 0.0),
        roughness_texture: texture_ref_json(v.get("clearcoatRoughnessTexture")),
        normal_texture: normal_texture_ref_json(v.get("clearcoatNormalTexture")),
    });

    let sheen = get("KHR_materials_sheen").map(|v| GltfSheen {
        color_factor: vec_at(v, "sheenColorFactor", &[0.0, 0.0, 0.0]),
        color_texture: texture_ref_json(v.get("sheenColorTexture")),
        roughness_factor: f64_at(v, "sheenRoughnessFactor", 0.0),
        roughness_texture: texture_ref_json(v.get("sheenRoughnessTexture")),
    });

    let anisotropy = get("KHR_materials_anisotropy").map(|v| GltfAnisotropy {
        strength: f64_at(v, "anisotropyStrength", 0.0),
        rotation: f64_at(v, "anisotropyRotation", 0.0),
        texture: texture_ref_json(v.get("anisotropyTexture")),
    });

    let iridescence = get("KHR_materials_iridescence").map(|v| GltfIridescence {
        factor: f64_at(v, "iridescenceFactor", 0.0),
        texture: texture_ref_json(v.get("iridescenceTexture")),
        ior: f64_at(v, "iridescenceIor", 1.3),
        thickness_minimum: f64_at(v, "iridescenceThicknessMinimum", 100.0),
        thickness_maximum: f64_at(v, "iridescenceThicknessMaximum", 400.0),
        thickness_texture: texture_ref_json(v.get("iridescenceThicknessTexture")),
    });

    let dispersion = get("KHR_materials_dispersion")
        .map(|v| f64_at(v, "dispersion", 0.0))
        .unwrap_or(0.0);

    GltfMaterial {
        name: m.name().map(str::to_owned),
        alpha_mode: match m.alpha_mode() {
            gltf::material::AlphaMode::Opaque => GltfAlphaMode::Opaque,
            gltf::material::AlphaMode::Mask => GltfAlphaMode::Mask,
            gltf::material::AlphaMode::Blend => GltfAlphaMode::Blend,
        },
        alpha_cutoff: m.alpha_cutoff().unwrap_or(0.5) as f64,
        double_sided: m.double_sided(),

        base_color_factor: pbr.base_color_factor().iter().map(|&x| x as f64).collect(),
        base_color_texture: texture_ref(pbr.base_color_texture()),
        metallic_factor: pbr.metallic_factor() as f64,
        roughness_factor: pbr.roughness_factor() as f64,
        metallic_roughness_texture: texture_ref(pbr.metallic_roughness_texture()),

        normal_texture: m.normal_texture().map(|n| GltfNormalTextureRef {
            index: n.texture().index() as u32,
            tex_coord: n.tex_coord(),
            scale: n.scale() as f64,
            transform: transform_json(
                n.extensions().and_then(|e| e.get("KHR_texture_transform")),
            ),
        }),
        occlusion_texture: m.occlusion_texture().map(|o| GltfOcclusionTextureRef {
            index: o.texture().index() as u32,
            tex_coord: o.tex_coord(),
            strength: o.strength() as f64,
            transform: transform_json(
                o.extensions().and_then(|e| e.get("KHR_texture_transform")),
            ),
        }),

        emissive_factor: m.emissive_factor().iter().map(|&x| x as f64).collect(),
        emissive_texture: texture_ref(m.emissive_texture()),
        emissive_strength: m.emissive_strength().unwrap_or(1.0) as f64,

        unlit: m.unlit(),
        ior: m.ior().unwrap_or(1.5) as f64,
        dispersion,

        specular: m.specular().map(|s| GltfSpecular {
            factor: s.specular_factor() as f64,
            color_factor: s.specular_color_factor().iter().map(|&x| x as f64).collect(),
            texture: texture_ref(s.specular_texture()),
            color_texture: texture_ref(s.specular_color_texture()),
        }),
        transmission: m.transmission().map(|t| GltfTransmission {
            factor: t.transmission_factor() as f64,
            texture: texture_ref(t.transmission_texture()),
        }),
        volume: m.volume().map(|v| GltfVolume {
            thickness_factor: v.thickness_factor() as f64,
            thickness_texture: texture_ref(v.thickness_texture()),
            attenuation_distance: v.attenuation_distance() as f64,
            attenuation_color: v.attenuation_color().iter().map(|&x| x as f64).collect(),
        }),
        clearcoat,
        sheen,
        anisotropy,
        iridescence,

        extensions: leftover_extensions(ext),
        extras: extras_json(m.extras()),
    }
}

/// The material a primitive with no `material` index gets.
///
/// glTF specifies this exactly — it is not "whatever looks reasonable" — so it
/// is materialised rather than left as `null` for the caller to invent.
pub(crate) fn default_material() -> GltfMaterial {
    GltfMaterial {
        name: None,
        alpha_mode: GltfAlphaMode::Opaque,
        alpha_cutoff: 0.5,
        double_sided: false,
        base_color_factor: vec![1.0, 1.0, 1.0, 1.0],
        base_color_texture: None,
        metallic_factor: 1.0,
        roughness_factor: 1.0,
        metallic_roughness_texture: None,
        normal_texture: None,
        occlusion_texture: None,
        emissive_factor: vec![0.0, 0.0, 0.0],
        emissive_texture: None,
        emissive_strength: 1.0,
        unlit: false,
        ior: 1.5,
        dispersion: 0.0,
        specular: None,
        transmission: None,
        volume: None,
        clearcoat: None,
        sheen: None,
        anisotropy: None,
        iridescence: None,
        extensions: None,
        extras: None,
    }
}
