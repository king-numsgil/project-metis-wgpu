//! The scene graph and everything hanging off it that is not geometry:
//! nodes, scenes, cameras, `KHR_lights_punctual` lights, and skins.
//!
//! Nothing here touches the GPU. It is plain data, converted once, so the
//! traversal a consumer has to write (world transforms, frustum culling, joint
//! matrices) is ordinary TypeScript over ordinary arrays.
//!
//! ## Node transforms are reported twice, on purpose
//!
//! glTF lets a node carry **either** a 4x4 `matrix` **or** a
//! translation/rotation/scale triple, never both. Reporting only what the file
//! used pushes the "which one is it?" branch into every consumer; reporting only
//! one form loses information (a decomposed TRS cannot represent a sheared
//! matrix, and a matrix cannot be interpolated by an animation channel that
//! targets `rotation`).
//!
//! So both are always filled in — `matrix` is the composed form, `translation`
//! /`rotation`/`scale` the decomposed one — and `hasMatrix` says which the file
//! actually wrote. Animation channels target the TRS fields, so a node animated
//! by a channel is one whose `hasMatrix` is false; the spec requires that.
//!
//! `matrix` is **column-major**, matching both glTF and WGSL, so it can be
//! uploaded to a uniform buffer without transposing.

use super::enums::{GltfCameraKind, GltfLightKind};
use super::material::extras_json;
use napi::bindgen_prelude::Float32Array;
use napi_derive::napi;

#[napi(object)]
pub struct GltfScene {
    pub name: Option<String>,
    /// Indices into `GltfAsset.nodes` — the roots of this scene.
    pub nodes: Vec<u32>,
    pub extras: Option<String>,
}

#[napi(object)]
pub struct GltfNode {
    pub name: Option<String>,
    /// Indices into `GltfAsset.nodes`.
    pub children: Vec<u32>,
    /// Index into `GltfAsset.meshes`.
    pub mesh: Option<u32>,
    /// Index into `GltfAsset.skins`. Only valid together with `mesh`.
    pub skin: Option<u32>,
    /// Index into `GltfAsset.cameras`.
    pub camera: Option<u32>,
    /// Index into `GltfAsset.lights` (`KHR_lights_punctual`).
    pub light: Option<u32>,

    /// Column-major 4x4, ready for a uniform buffer.
    pub matrix: Vec<f64>,
    pub translation: Vec<f64>,
    /// Quaternion as `[x, y, z, w]` — glTF's order, not `[w, x, y, z]`.
    pub rotation: Vec<f64>,
    pub scale: Vec<f64>,
    /// True when the file wrote a `matrix`; false when it wrote TRS (or
    /// nothing, in which case both forms are the identity).
    pub has_matrix: bool,

    /// Morph target weights overriding the mesh's own, when present.
    pub weights: Vec<f64>,
    pub extras: Option<String>,
}

#[napi(object)]
pub struct GltfPerspective {
    /// `null` means "use the viewport's aspect ratio" — the spec's wording, and
    /// not something this importer can resolve for the caller.
    pub aspect_ratio: Option<f64>,
    /// Vertical field of view, radians.
    pub yfov: f64,
    pub znear: f64,
    /// `null` means an infinite projection.
    pub zfar: Option<f64>,
}

#[napi(object)]
pub struct GltfOrthographic {
    pub xmag: f64,
    pub ymag: f64,
    pub znear: f64,
    pub zfar: f64,
}

#[napi(object)]
pub struct GltfCamera {
    pub name: Option<String>,
    pub kind: GltfCameraKind,
    /// Set when `kind` is `Perspective`.
    pub perspective: Option<GltfPerspective>,
    /// Set when `kind` is `Orthographic`.
    pub orthographic: Option<GltfOrthographic>,
    pub extras: Option<String>,
}

/// A `KHR_lights_punctual` light. Note glTF's photometric units: point and spot
/// intensity is in candela (lm/sr), directional is in lux (lm/m²) — they are
/// **not** the same scale, which is why `kind` has to be consulted before the
/// value is used.
#[napi(object)]
pub struct GltfLight {
    pub name: Option<String>,
    pub kind: GltfLightKind,
    /// Linear RGB, nominally in `[0, 1]`.
    pub color: Vec<f64>,
    pub intensity: f64,
    /// `null` means unlimited. Ignored for directional lights.
    pub range: Option<f64>,
    /// Spot only, radians. Defaults to 0.
    pub inner_cone_angle: f64,
    /// Spot only, radians. Defaults to π/4.
    pub outer_cone_angle: f64,
    pub extras: Option<String>,
}

#[napi(object)]
pub struct GltfSkin {
    pub name: Option<String>,
    /// Indices into `GltfAsset.nodes`, in joint order — the order the shader's
    /// joint matrix array must be built in.
    pub joints: Vec<u32>,
    /// The common root of the joints, when the file names one.
    pub skeleton: Option<u32>,
    /// 16 floats per joint, column-major, in `joints` order. `null` when the
    /// file omits them, which the spec says means identity for every joint.
    pub inverse_bind_matrices: Option<Float32Array>,
    pub extras: Option<String>,
}

pub(crate) fn convert_scene(s: &gltf::Scene<'_>) -> GltfScene {
    GltfScene {
        name: s.name().map(str::to_owned),
        nodes: s.nodes().map(|n| n.index() as u32).collect(),
        extras: extras_json(s.extras()),
    }
}

pub(crate) fn convert_node(n: &gltf::Node<'_>) -> GltfNode {
    let transform = n.transform();
    let has_matrix = matches!(transform, gltf::scene::Transform::Matrix { .. });
    // `matrix()` composes TRS when the file wrote TRS, and `decomposed()`
    // factors the matrix when it wrote a matrix — so both are always available
    // whichever form the file used.
    let matrix = n.transform().matrix();
    let (translation, rotation, scale) = n.transform().decomposed();

    GltfNode {
        name: n.name().map(str::to_owned),
        children: n.children().map(|c| c.index() as u32).collect(),
        mesh: n.mesh().map(|m| m.index() as u32),
        skin: n.skin().map(|s| s.index() as u32),
        camera: n.camera().map(|c| c.index() as u32),
        light: n.light().map(|l| l.index() as u32),
        matrix: matrix.iter().flatten().map(|&x| x as f64).collect(),
        translation: translation.iter().map(|&x| x as f64).collect(),
        rotation: rotation.iter().map(|&x| x as f64).collect(),
        scale: scale.iter().map(|&x| x as f64).collect(),
        has_matrix,
        weights: n.weights().map(|w| w.iter().map(|&x| x as f64).collect()).unwrap_or_default(),
        extras: extras_json(n.extras()),
    }
}

pub(crate) fn convert_camera(c: &gltf::Camera<'_>) -> GltfCamera {
    match c.projection() {
        gltf::camera::Projection::Perspective(p) => GltfCamera {
            name: c.name().map(str::to_owned),
            kind: GltfCameraKind::Perspective,
            perspective: Some(GltfPerspective {
                aspect_ratio: p.aspect_ratio().map(|x| x as f64),
                yfov: p.yfov() as f64,
                znear: p.znear() as f64,
                zfar: p.zfar().map(|x| x as f64),
            }),
            orthographic: None,
            extras: extras_json(c.extras()),
        },
        gltf::camera::Projection::Orthographic(o) => GltfCamera {
            name: c.name().map(str::to_owned),
            kind: GltfCameraKind::Orthographic,
            perspective: None,
            orthographic: Some(GltfOrthographic {
                xmag: o.xmag() as f64,
                ymag: o.ymag() as f64,
                znear: o.znear() as f64,
                zfar: o.zfar() as f64,
            }),
            extras: extras_json(c.extras()),
        },
    }
}

pub(crate) fn convert_light(l: &gltf::khr_lights_punctual::Light<'_>) -> GltfLight {
    use gltf::khr_lights_punctual::Kind;
    let (kind, inner, outer) = match l.kind() {
        Kind::Directional => (GltfLightKind::Directional, 0.0, std::f32::consts::FRAC_PI_4),
        Kind::Point => (GltfLightKind::Point, 0.0, std::f32::consts::FRAC_PI_4),
        Kind::Spot { inner_cone_angle, outer_cone_angle } => {
            (GltfLightKind::Spot, inner_cone_angle, outer_cone_angle)
        }
    };
    GltfLight {
        name: l.name().map(str::to_owned),
        kind,
        color: l.color().iter().map(|&x| x as f64).collect(),
        intensity: l.intensity() as f64,
        range: l.range().map(|x| x as f64),
        inner_cone_angle: inner as f64,
        outer_cone_angle: outer as f64,
        extras: extras_json(l.extras()),
    }
}

pub(crate) fn convert_skin(
    s: &gltf::Skin<'_>,
    buffers: &[Option<Vec<u8>>],
) -> napi::Result<GltfSkin> {
    let ibm = match s.inverse_bind_matrices() {
        None => None,
        Some(acc) => {
            let data = super::accessor::read_accessor(
                &acc,
                buffers,
                &format!("skin {} inverseBindMatrices", s.index()),
            )?;
            Some(Float32Array::new(super::accessor::to_f32(&data)))
        }
    };
    Ok(GltfSkin {
        name: s.name().map(str::to_owned),
        joints: s.joints().map(|j| j.index() as u32).collect(),
        skeleton: s.skeleton().map(|n| n.index() as u32),
        inverse_bind_matrices: ibm,
        extras: extras_json(s.extras()),
    })
}
