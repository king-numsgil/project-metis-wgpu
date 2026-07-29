//! A glTF 2.0 importer that hands back ready-to-bind GPU resources.
//!
//! ```text
//! inspectGltf(path)                 -> GltfManifest   (JSON only; lists resources)
//! loadGltf(device, path, options?)  -> GltfAsset      (buffers, textures, scene graph)
//! ```
//!
//! Both are async and run on a libuv worker, like the two image loaders.
//!
//! ## What this module is for
//!
//! It parses `.gltf` and `.glb`, resolves every buffer and image (external file,
//! `data:` URI, GLB binary chunk, or `bufferView`), repacks each primitive into
//! an interleaved vertex buffer plus an index buffer, decodes and uploads every
//! texture, creates the samplers, and returns the whole scene graph — nodes,
//! materials, animations, skins, cameras, `KHR_lights_punctual` lights — as
//! typed plain data alongside the handles.
//!
//! ## Why so much of it is enums
//!
//! glTF's wire format is small integers and short strings: `mode: 4`,
//! `componentType: 5126`, `wrapS: 10497`. Passing those through to TypeScript as
//! numbers would make the binding a transliteration of the file format rather
//! than an API. Every closed set becomes a real `#[napi] enum` (see
//! [`enums`]); the only string unions that survive are the WebGPU ones
//! (`GPUVertexFormat`, `GPUPrimitiveTopology`), because those are the exact
//! values a caller hands to `createRenderPipeline`.
//!
//! ## Where the seams are
//!
//! Two hooks, both declarative rather than callback-based:
//!
//! - **`resourceOverrides`** — redirect or replace any buffer or image, matched
//!   by index or by the URI as written. This is the sidecar hook: swap a `.ktx2`
//!   in for a `.png`, read out of an archive, or drop a resource entirely.
//! - **`textureColorSpaces`** — override the sRGB/linear inference for a
//!   specific texture, for the assets where the material slots lie.
//!
//! They are declarative because the work happens on a worker thread. A JS
//! callback would have to be marshalled back to the JS thread and waited on,
//! turning every resource into a thread hop and making a load's behaviour depend
//! on whether the event loop is blocked. The `inspectGltf` → build overrides →
//! `loadGltf` shape gets the same expressiveness with none of that: you see the
//! real resource list before deciding.
//!
//! ## Extensions
//!
//! Supported natively: `KHR_materials_unlit`, `_emissive_strength`, `_ior`,
//! `_specular`, `_transmission`, `_volume`, `_clearcoat`, `_sheen`,
//! `_anisotropy`, `_iridescence`, `_dispersion`, `_variants`;
//! `KHR_texture_transform`; `KHR_lights_punctual`; `KHR_texture_basisu`;
//! `EXT_texture_webp`; `KHR_mesh_quantization`.
//!
//! Everything else is preserved as **raw JSON** on the object that carried it
//! (`GltfMaterial.extensions`, `GltfTexture.extensions`, `GltfAsset.extensions`)
//! rather than dropped, so a caller can implement an extension in TypeScript
//! without a Rust change.
//!
//! A file that lists an unimplemented extension in `extensionsRequired` is
//! **rejected** by default — that is what "required" means, and loading it
//! anyway produces geometry that is silently wrong (a Draco-compressed
//! primitive's accessors point at nothing useful). `strictRequiredExtensions:
//! false` downgrades it to a warning list on the returned asset.
//!
//! ## Not supported, deliberately
//!
//! - **`KHR_draco_mesh_compression` / `EXT_meshopt_compression`.** Both need a
//!   decompressor: Draco's is C++ (the exact dependency class this package
//!   removed with SDL3_image), and meshopt's reference decoder is C. Rejected
//!   with a message naming the extension and pointing at `gltf-transform`, which
//!   can strip either offline.
//! - **`KHR_materials_pbrSpecularGlossiness`.** Archived by Khronos in favour of
//!   metallic-roughness; a converter belongs in the asset pipeline.
//! - **Mipmap generation.** See [`texture`] for why, and why
//!   `KHR_texture_basisu` is the answer instead.

mod accessor;
mod animation;
mod enums;
mod material;
mod mesh;
mod primitive;
mod scene;
mod texture;
mod uri;

pub use animation::{GltfAnimation, GltfAnimationChannel, GltfAnimationSampler};
pub use enums::{
    GltfAccessorType, GltfAlphaMode, GltfAnimationPath, GltfAttributeSemantic, GltfCameraKind,
    GltfComponentType, GltfImageEncoding, GltfIndexFormat, GltfInterpolation, GltfLightKind,
    GltfMagFilter, GltfMinFilter, GltfPrimitiveMode, GltfResourceKind, GltfResourceSource,
    GltfWrapMode,
};
pub use material::{
    GltfAnisotropy, GltfClearcoat, GltfIridescence, GltfMaterial, GltfNormalTextureRef,
    GltfOcclusionTextureRef, GltfSheen, GltfSpecular, GltfTextureRef, GltfTextureTransform,
    GltfTransmission, GltfVolume,
};
pub use mesh::GltfVertexLayoutMode;
pub use primitive::{GltfMesh, GltfMorphTarget, GltfPrimitive, GltfVertexAttribute, GltfVertexLayout};
pub use scene::{
    GltfCamera, GltfLight, GltfNode, GltfOrthographic, GltfPerspective, GltfScene, GltfSkin,
};
pub use texture::{GltfSampler, GltfTexture};
pub use uri::GltfResourceOverride;

use crate::gpu::GpuDevice;
use crate::gpu::error::with_validation_scope;
use crate::image::{ImageColorSpace, generic_err};
use napi::bindgen_prelude::AsyncTask;
use napi::{Env, Task};
use napi_derive::napi;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use uri::{Overrides, Substitution};

/// Extensions this importer understands. Anything here may appear in
/// `extensionsRequired` without the load failing.
///
/// **`KHR_mesh_quantization` is on the list without any code of its own**, and
/// that is correct rather than an oversight: it only widens which
/// `componentType`/`normalized` combinations may appear on vertex attributes,
/// and `accessor.rs` handles every combination the spec allows regardless of
/// which extension put it there.
const SUPPORTED_EXTENSIONS: &[&str] = &[
    "KHR_materials_unlit",
    "KHR_materials_emissive_strength",
    "KHR_materials_ior",
    "KHR_materials_specular",
    "KHR_materials_transmission",
    "KHR_materials_volume",
    "KHR_materials_clearcoat",
    "KHR_materials_sheen",
    "KHR_materials_anisotropy",
    "KHR_materials_iridescence",
    "KHR_materials_dispersion",
    "KHR_materials_variants",
    "KHR_texture_transform",
    "KHR_texture_basisu",
    "KHR_lights_punctual",
    "KHR_mesh_quantization",
    "EXT_texture_webp",
];

/// A rejection message for the extensions that cannot be papered over, written
/// once so the two call sites agree.
fn unsupported_reason(ext: &str) -> Option<&'static str> {
    match ext {
        "KHR_draco_mesh_compression" => Some(
            "Draco decompression needs a C++ decoder, which this package deliberately does not link \
             (see the SDL3_image removal in CLAUDE.md). Strip it offline with \
             `gltf-transform dedup --... ` / `gltf-transform draco --decode`.",
        ),
        "EXT_meshopt_compression" => Some(
            "meshopt decompression needs the C reference decoder, which this package deliberately \
             does not link. Strip it offline with `gltf-transform meshopt --decode`.",
        ),
        "KHR_materials_pbrSpecularGlossiness" => Some(
            "specular-glossiness was archived by Khronos in favour of metallic-roughness. Convert \
             offline with `gltf-transform metalrough`.",
        ),
        _ => None,
    }
}

// ── options ─────────────────────────────────────────────────────────────────

/// Force a specific colour space on one texture, overriding the inference
/// described in [`texture`].
#[napi(object)]
pub struct GltfTextureColorSpace {
    /// Index into the file's `textures` array.
    pub texture: u32,
    pub color_space: ImageColorSpace,
}

#[napi(object)]
pub struct GltfLoadOptions {
    /// Prefix for the debug labels put on every created buffer, texture and
    /// sampler. Defaults to the file's name.
    pub label: Option<String>,
    /// Directory that relative URIs resolve against. Defaults to the directory
    /// the glTF file is in, which is what the spec means by "relative to the
    /// glTF asset".
    pub base_directory: Option<String>,
    /// Redirect or replace individual buffers and images. See
    /// [`GltfResourceOverride`]; use `inspectGltf` to learn the URIs first.
    pub resource_overrides: Option<Vec<GltfResourceOverride>>,
    /// Override the sRGB/linear decision per texture.
    pub texture_color_spaces: Option<Vec<GltfTextureColorSpace>>,
    /// Extra `GPUBufferUsage` bits OR'd into every vertex buffer, on top of
    /// `VERTEX | COPY_DST`. Pass `STORAGE` to run compute over the geometry.
    pub extra_vertex_buffer_usage: Option<u32>,
    /// Extra `GPUBufferUsage` bits for index buffers, on top of
    /// `INDEX | COPY_DST`.
    pub extra_index_buffer_usage: Option<u32>,
    /// `GPUTextureUsage` bitmask for created textures. Defaults to
    /// `TEXTURE_BINDING | COPY_DST`.
    pub texture_usage: Option<u32>,
    /// Skip image decoding and texture creation entirely — every
    /// `GltfTexture.texture` comes back `null`. Useful for loading a scene
    /// graph without paying for its textures.
    pub load_images: Option<bool>,
    /// `maxAnisotropy` for created samplers. Defaults to 1. Silently clamped
    /// back to 1 for samplers that are not fully linear-filtered, because wgpu
    /// rejects that combination.
    pub max_anisotropy: Option<u16>,
    /// Rewrite `TRIANGLE_FAN` and `LINE_LOOP` primitives into index buffers
    /// WebGPU can draw. Defaults to true; see [`primitive::GltfPrimitive`].
    pub convert_unsupported_topologies: Option<bool>,
    /// Whether every primitive gets the file's own attribute set (`Source`,
    /// the default) or the fixed 48-byte position/normal/tangent/uv layout
    /// (`Standard`). See [`GltfVertexLayoutMode`].
    pub vertex_layout: Option<GltfVertexLayoutMode>,
    /// Reject a file whose `extensionsRequired` names something unimplemented.
    /// Defaults to true.
    pub strict_required_extensions: Option<bool>,
}

struct ResolvedOptions {
    label: Option<String>,
    base_directory: Option<String>,
    overrides: Overrides,
    color_spaces: Vec<(u32, ImageColorSpace)>,
    extra_vertex_usage: u32,
    extra_index_usage: u32,
    texture_usage: u32,
    load_images: bool,
    max_anisotropy: u16,
    convert_topology: bool,
    layout_mode: GltfVertexLayoutMode,
    strict: bool,
}

/// Take the options off the JS thread.
///
/// This runs synchronously in the `#[napi]` entry point, **before** the
/// `AsyncTask` is built, because `GltfResourceOverride.bytes` is a `Uint8Array`
/// borrowing JS-owned memory and must be copied out here.
fn resolve_options(options: Option<GltfLoadOptions>) -> napi::Result<ResolvedOptions> {
    let o = options.unwrap_or(GltfLoadOptions {
        label: None,
        base_directory: None,
        resource_overrides: None,
        texture_color_spaces: None,
        extra_vertex_buffer_usage: None,
        extra_index_buffer_usage: None,
        texture_usage: None,
        load_images: None,
        max_anisotropy: None,
        convert_unsupported_topologies: None,
        vertex_layout: None,
        strict_required_extensions: None,
    });
    Ok(ResolvedOptions {
        label: o.label,
        base_directory: o.base_directory,
        overrides: Overrides::from_js(o.resource_overrides)?,
        color_spaces: o
            .texture_color_spaces
            .unwrap_or_default()
            .into_iter()
            .map(|c| (c.texture, c.color_space))
            .collect(),
        extra_vertex_usage: o.extra_vertex_buffer_usage.unwrap_or(0),
        extra_index_usage: o.extra_index_buffer_usage.unwrap_or(0),
        texture_usage: o.texture_usage.unwrap_or(crate::image::DEFAULT_TEXTURE_USAGE),
        load_images: o.load_images.unwrap_or(true),
        max_anisotropy: o.max_anisotropy.unwrap_or(1),
        convert_topology: o.convert_unsupported_topologies.unwrap_or(true),
        layout_mode: o.vertex_layout.unwrap_or(GltfVertexLayoutMode::Source),
        strict: o.strict_required_extensions.unwrap_or(true),
    })
}

// ── manifest (inspectGltf) ──────────────────────────────────────────────────

/// One external or embedded resource, as listed by `inspectGltf`.
#[napi(object)]
pub struct GltfResource {
    pub kind: GltfResourceKind,
    /// Index within `buffers` or `images` — the value a `resourceOverride`
    /// matches on.
    pub index: u32,
    pub name: Option<String>,
    pub source: GltfResourceSource,
    /// The URI exactly as written in the file: not percent-decoded, not
    /// resolved. This is the string a `resourceOverride` matches on. A `data:`
    /// URI is truncated here — it can be megabytes — so match those by index.
    pub uri: Option<String>,
    /// The absolute path the loader will read, for `External` resources only.
    pub resolved_path: Option<String>,
    /// The file's declared `mimeType`, when it declares one.
    pub mime_type: Option<String>,
    /// Declared `byteLength` for buffers, or the length of the `bufferView` for
    /// an embedded image. `null` when the file does not say.
    pub byte_length: Option<f64>,
}

/// Object counts, so a caller can size its own arrays before loading.
#[napi(object)]
pub struct GltfCounts {
    pub scenes: u32,
    pub nodes: u32,
    pub meshes: u32,
    pub primitives: u32,
    pub materials: u32,
    pub textures: u32,
    pub images: u32,
    pub samplers: u32,
    pub animations: u32,
    pub skins: u32,
    pub cameras: u32,
    pub lights: u32,
}

/// What `inspectGltf` returns: everything about a glTF file that can be known
/// without reading a single byte of its binary payload.
#[napi(object)]
pub struct GltfManifest {
    pub path: String,
    /// Where relative URIs will resolve against.
    pub base_directory: String,
    /// True for `.glb` (a binary container), false for `.gltf` (plain JSON).
    pub is_binary: bool,
    /// Byte length of the GLB binary chunk, or `null` for a `.gltf`.
    pub binary_chunk_length: Option<f64>,
    pub version: String,
    pub min_version: Option<String>,
    pub generator: Option<String>,
    pub copyright: Option<String>,
    pub extensions_used: Vec<String>,
    pub extensions_required: Vec<String>,
    /// The subset of `extensionsRequired` this importer does not implement.
    /// Non-empty means `loadGltf` will reject unless
    /// `strictRequiredExtensions` is false.
    pub unsupported_required_extensions: Vec<String>,
    pub resources: Vec<GltfResource>,
    pub counts: GltfCounts,
}

// ── the asset (loadGltf) ────────────────────────────────────────────────────

/// A fully imported glTF asset: GPU handles plus the whole scene graph.
///
/// This is a plain JS object, not a class — every field is materialised once
/// when the promise resolves. There is no lazy getter to re-pay for, and no
/// `destroy()`: the GPU handles are ordinary `GpuBuffer` / `GpuTexture` /
/// `GpuSampler` objects with their own `destroy()`, and freeing the asset means
/// destroying the ones you took.
#[napi(object, object_from_js = false)]
pub struct GltfAsset {
    pub path: String,
    pub version: String,
    pub min_version: Option<String>,
    pub generator: Option<String>,
    pub copyright: Option<String>,
    pub extensions_used: Vec<String>,
    pub extensions_required: Vec<String>,
    /// Required extensions this importer does not implement. Always empty
    /// unless `strictRequiredExtensions: false` was passed — in which case the
    /// asset loaded anyway and this is the list of reasons to distrust it.
    pub unsupported_required_extensions: Vec<String>,

    /// Index into `scenes` of the file's default scene, when it names one.
    pub default_scene: Option<u32>,
    pub scenes: Vec<GltfScene>,
    pub nodes: Vec<GltfNode>,
    pub meshes: Vec<GltfMesh>,
    /// The file's materials, plus one appended default material at
    /// `defaultMaterial`.
    pub materials: Vec<GltfMaterial>,
    /// Index of the appended glTF default material — what primitives with no
    /// material of their own point at. It is always the last entry.
    pub default_material: u32,
    pub textures: Vec<GltfTexture>,
    /// The file's samplers, plus (when any texture needs it) one appended
    /// default sampler; see `GltfSampler.isDefault`.
    pub samplers: Vec<GltfSampler>,
    pub animations: Vec<GltfAnimation>,
    pub skins: Vec<GltfSkin>,
    pub cameras: Vec<GltfCamera>,
    /// `KHR_lights_punctual` lights, referenced by `GltfNode.light`.
    pub lights: Vec<GltfLight>,
    /// `KHR_materials_variants` variant names, in index order.
    pub variants: Vec<String>,

    /// Raw JSON of any document-level extension this importer does not model.
    pub extensions: Option<String>,
    /// Raw JSON of the document's `asset.extras`.
    pub extras: Option<String>,
}

// ── parsing ─────────────────────────────────────────────────────────────────

struct Parsed {
    gltf: gltf::Gltf,
    path: String,
    base_dir: PathBuf,
    is_binary: bool,
}

fn parse(path: &str, base_directory: Option<&str>) -> napi::Result<Parsed> {
    let bytes = std::fs::read(path)
        .map_err(|e| generic_err(format!("failed to read '{}': {}", path, e)))?;
    // The GLB magic is the only reliable discriminator; an exporter writing
    // binary content to a `.gltf` name is unusual but not illegal, and the
    // reverse (JSON in a `.glb`) shows up in hand-assembled test files.
    let is_binary = bytes.starts_with(b"glTF");
    let gltf = gltf::Gltf::from_slice_without_validation(&bytes)
        .map_err(|e| generic_err(format!("failed to parse '{}' as glTF: {}", path, e)))?;
    validate(&gltf.document, path)?;

    let base_dir = match base_directory {
        Some(d) => PathBuf::from(d),
        None => Path::new(path).parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from(".")),
    };
    Ok(Parsed { gltf, path: path.to_owned(), base_dir, is_binary })
}

/// Run gltf-json's structural validation, minus the one class of error that is
/// not ours to act on.
///
/// **The validation is not optional and is not run through `Gltf::from_slice`,
/// and both halves of that matter.**
///
/// It has to happen, because the `gltf` crate's typed accessors `unwrap()` a
/// `Checked<T>` — an unrecognised `componentType` or `mode` is `Checked::Invalid`
/// and reading it *panics*, which across the napi boundary aborts the process
/// rather than rejecting a promise. Validation is what turns that into an error.
///
/// But `Gltf::from_slice` also rejects any `extensionsRequired` entry that
/// **gltf-json** does not model (`Error::Unsupported`), and that is a different
/// question from whether *this importer* supports it. Half the extensions here
/// are parsed from raw JSON precisely because the crate has no feature for them
/// (`KHR_materials_clearcoat` and friends — see `material.rs`), so deferring to
/// the crate's list would reject files this code handles correctly. That
/// judgement belongs to `SUPPORTED_EXTENSIONS` and `check_required`, which is
/// also what makes `strictRequiredExtensions: false` mean anything.
fn validate(doc: &gltf::Document, path: &str) -> napi::Result<()> {
    use gltf::json::validation::{Error as VErr, Validate};

    let root = doc.as_json();
    let mut problems: Vec<String> = Vec::new();
    root.validate(root, gltf::json::Path::new, &mut |p, e| {
        if e == VErr::Unsupported {
            return;
        }
        if problems.len() < 8 {
            problems.push(format!("{}: {:?}", p(), e));
        }
    });

    if problems.is_empty() {
        Ok(())
    } else {
        Err(generic_err(format!("'{path}' is not valid glTF: {}", problems.join("; "))))
    }
}

fn unsupported_required(doc: &gltf::Document) -> Vec<String> {
    doc.extensions_required()
        .filter(|e| !SUPPORTED_EXTENSIONS.contains(e))
        .map(str::to_owned)
        .collect()
}

fn check_required(doc: &gltf::Document, path: &str, strict: bool) -> napi::Result<Vec<String>> {
    let missing = unsupported_required(doc);
    if strict && !missing.is_empty() {
        let detail: Vec<String> = missing
            .iter()
            .map(|e| match unsupported_reason(e) {
                Some(why) => format!("  - {e}: {why}"),
                None => format!("  - {e}: not implemented by this importer."),
            })
            .collect();
        return Err(generic_err(format!(
            "'{path}' lists extensions in `extensionsRequired` that this importer does not \
             implement, so it cannot be loaded correctly:\n{}\n\
             Pass `strictRequiredExtensions: false` to load it anyway (the result will be wrong \
             wherever the extension mattered).",
            detail.join("\n")
        )));
    }
    Ok(missing)
}

// ── resource resolution ─────────────────────────────────────────────────────

/// Fetch a resource's bytes, honouring any override.
///
/// `None` means the caller asked for the resource to be skipped. The second
/// element is a media type learned while fetching — only a `data:` URI carries
/// one, and it is the *only* mime hint an embedded image has when the glTF
/// `images[i]` entry omits `mimeType` (which is legal for `uri` images).
fn fetch(
    overrides: &Overrides,
    kind: GltfResourceKind,
    index: u32,
    uri: Option<&str>,
    base_dir: &Path,
    what: &str,
) -> napi::Result<Option<(Vec<u8>, Option<String>)>> {
    match overrides.lookup(kind, index, uri) {
        Some(Substitution::Skip) => return Ok(None),
        Some(Substitution::Bytes(b)) => return Ok(Some((b.as_ref().clone(), None))),
        Some(Substitution::Path(p)) => {
            return std::fs::read(p)
                .map(|b| Some((b, None)))
                .map_err(|e| generic_err(format!("{what}: override path '{}' could not be read: {e}", p.display())));
        }
        None => {}
    }

    let uri = uri.ok_or_else(|| {
        generic_err(format!("{what}: has no URI and no GLB binary chunk to read from"))
    })?;
    if uri.starts_with("data:") {
        let d = uri::decode_data_uri(uri)?;
        return Ok(Some((d.bytes, d.media_type)));
    }
    let path = uri::resolve_uri(base_dir, uri)?;
    std::fs::read(&path)
        .map(|b| Some((b, None)))
        .map_err(|e| generic_err(format!("{what}: '{}' could not be read: {e}", path.display())))
}

/// Resolve every `buffers[i]` to its contents.
fn resolve_buffers(parsed: &Parsed, overrides: &Overrides) -> napi::Result<Vec<Option<Vec<u8>>>> {
    let mut out = Vec::new();
    for buffer in parsed.gltf.buffers() {
        let index = buffer.index() as u32;
        let what = format!("buffers[{index}]");
        let bytes = match buffer.source() {
            gltf::buffer::Source::Bin => {
                // An override can still replace the GLB chunk — pass `None` as
                // the URI so only an index match applies.
                match overrides.lookup(GltfResourceKind::Buffer, index, None) {
                    Some(Substitution::Skip) => None,
                    Some(Substitution::Bytes(b)) => Some(b.as_ref().clone()),
                    Some(Substitution::Path(p)) => Some(std::fs::read(p).map_err(|e| {
                        generic_err(format!("{what}: override path '{}' could not be read: {e}", p.display()))
                    })?),
                    None => Some(parsed.gltf.blob.clone().ok_or_else(|| {
                        generic_err(format!(
                            "{what}: refers to the GLB binary chunk, but '{}' has no binary chunk",
                            parsed.path
                        ))
                    })?),
                }
            }
            gltf::buffer::Source::Uri(uri) => {
                fetch(overrides, GltfResourceKind::Buffer, index, Some(uri), &parsed.base_dir, &what)?
                    .map(|(b, _)| b)
            }
        };

        // A short buffer is worth catching here: every downstream error would
        // otherwise name an accessor, which is one indirection away from the
        // actual problem (a truncated download, a stale `.bin`).
        if let Some(b) = &bytes {
            if b.len() < buffer.length() {
                return Err(generic_err(format!(
                    "{what}: declares byteLength {} but only {} bytes are available",
                    buffer.length(),
                    b.len()
                )));
            }
        }
        out.push(bytes);
    }
    Ok(out)
}

/// The bytes and declared mime type of `images[i]`.
fn resolve_image(
    parsed: &Parsed,
    overrides: &Overrides,
    buffers: &[Option<Vec<u8>>],
    image: &gltf::Image<'_>,
) -> napi::Result<Option<(Vec<u8>, Option<String>)>> {
    let index = image.index() as u32;
    let what = format!("images[{index}]");
    match image.source() {
        gltf::image::Source::Uri { uri, mime_type } => {
            let fetched = fetch(overrides, GltfResourceKind::Image, index, Some(uri), &parsed.base_dir, &what)?;
            // The `images[i].mimeType` wins when present; a `data:` URI's own
            // media type is the fallback, since that form often omits it.
            Ok(fetched.map(|(b, data_uri_mime)| (b, mime_type.map(str::to_owned).or(data_uri_mime))))
        }
        gltf::image::Source::View { view, mime_type } => {
            match overrides.lookup(GltfResourceKind::Image, index, None) {
                Some(Substitution::Skip) => return Ok(None),
                Some(Substitution::Bytes(b)) => {
                    return Ok(Some((b.as_ref().clone(), Some(mime_type.to_owned()))));
                }
                Some(Substitution::Path(p)) => {
                    let b = std::fs::read(p).map_err(|e| {
                        generic_err(format!("{what}: override path '{}' could not be read: {e}", p.display()))
                    })?;
                    return Ok(Some((b, Some(mime_type.to_owned()))));
                }
                None => {}
            }
            let buf = buffers
                .get(view.buffer().index())
                .and_then(|b| b.as_ref())
                .ok_or_else(|| generic_err(format!("{what}: its bufferView's buffer is unavailable")))?;
            let start = view.offset();
            let end = start + view.length();
            if end > buf.len() {
                return Err(generic_err(format!("{what}: its bufferView runs past the end of its buffer")));
            }
            Ok(Some((buf[start..end].to_vec(), Some(mime_type.to_owned()))))
        }
    }
}

/// Which `textures[i]` are bound to a slot that carries colour rather than data.
///
/// See [`texture`] for why this is inferred from material slots and what
/// happens when an asset uses one texture both ways.
fn srgb_textures(doc: &gltf::Document) -> std::collections::HashSet<usize> {
    let mut set = std::collections::HashSet::new();
    for m in doc.materials() {
        let pbr = m.pbr_metallic_roughness();
        if let Some(t) = pbr.base_color_texture() {
            set.insert(t.texture().index());
        }
        if let Some(t) = m.emissive_texture() {
            set.insert(t.texture().index());
        }
        if let Some(s) = m.specular() {
            if let Some(t) = s.specular_color_texture() {
                set.insert(t.texture().index());
            }
        }
        // KHR_materials_sheen's colour texture is raw JSON here, so it is read
        // the same way `material.rs` reads the rest of that extension.
        if let Some(idx) = m
            .extension_value("KHR_materials_sheen")
            .and_then(|v| v.pointer("/sheenColorTexture/index"))
            .and_then(|v| v.as_u64())
        {
            set.insert(idx as usize);
        }
    }
    set
}

// ── the load itself ─────────────────────────────────────────────────────────

fn build_asset(
    device: &Arc<wgpu::Device>,
    queue: &Arc<wgpu::Queue>,
    parsed: &Parsed,
    opts: &ResolvedOptions,
    unsupported: Vec<String>,
) -> napi::Result<GltfAsset> {
    let doc = &parsed.gltf.document;
    let label_prefix = opts.label.clone().unwrap_or_else(|| {
        Path::new(&parsed.path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| parsed.path.clone())
    });

    let buffers = resolve_buffers(parsed, &opts.overrides)?;

    // ── materials (the default is appended, so a primitive index is never null)
    let mut materials: Vec<GltfMaterial> = doc.materials().map(|m| material::convert(&m)).collect();
    let default_material = materials.len() as u32;
    materials.push(material::default_material());

    // ── samplers: the file's, plus one default if any texture omits its own
    let mut sampler_specs: Vec<texture::SamplerSpec> =
        doc.samplers().map(|s| texture::sampler_spec(&s)).collect();
    let needs_default = doc.textures().any(|t| t.sampler().index().is_none());
    let default_sampler_index = sampler_specs.len() as u32;
    if needs_default {
        sampler_specs.push(texture::default_sampler_spec());
    }
    let samplers: Vec<GltfSampler> = sampler_specs
        .iter()
        .enumerate()
        .map(|(i, spec)| {
            texture::build_sampler(device, spec, opts.max_anisotropy, Some(&format!("{label_prefix} sampler {i}")))
        })
        .collect();

    // ── textures
    let srgb_set = srgb_textures(doc);
    let mut cache = texture::ImageCache::new(opts.texture_usage);
    let mut textures = Vec::new();
    for t in doc.textures() {
        let t_index = t.index();
        let source = texture::resolve_source(&t)?;
        let image = doc.images().nth(source).ok_or_else(|| texture::missing_image(source))?;

        let color_space = opts
            .color_spaces
            .iter()
            .find(|(i, _)| *i as usize == t_index)
            .map(|(_, cs)| *cs)
            .unwrap_or(if srgb_set.contains(&t_index) { ImageColorSpace::Srgb } else { ImageColorSpace::Linear });
        let srgb = matches!(color_space, ImageColorSpace::Srgb);

        let (gpu_texture, encoding) = if !opts.load_images {
            (None, GltfImageEncoding::Unknown)
        } else {
            match resolve_image(parsed, &opts.overrides, &buffers, &image)? {
                None => (None, GltfImageEncoding::Unknown),
                Some((bytes, mime)) => {
                    let encoding = texture::detect_encoding(&bytes, mime.as_deref());
                    let label = format!(
                        "{label_prefix} texture {t_index}{}",
                        t.name().map(|n| format!(" ({n})")).unwrap_or_default()
                    );
                    let tex = cache.get(
                        device,
                        queue,
                        source,
                        srgb,
                        &bytes,
                        encoding,
                        mime.as_deref(),
                        &label,
                    )?;
                    (Some(tex), encoding)
                }
            }
        };

        textures.push(GltfTexture {
            name: t.name().map(str::to_owned),
            texture: gpu_texture,
            sampler: t.sampler().index().map(|i| i as u32).unwrap_or(default_sampler_index),
            source: Some(source as u32),
            color_space,
            encoding,
            extensions: texture::texture_extensions(&t),
        });
    }

    // ── meshes
    let build_opts = primitive::BuildOptions {
        layout_mode: opts.layout_mode,
        convert_topology: opts.convert_topology,
        extra_vertex_usage: opts.extra_vertex_usage,
        extra_index_usage: opts.extra_index_usage,
    };
    let mut meshes = Vec::new();
    for m in doc.meshes() {
        let mut primitives = Vec::new();
        for p in m.primitives() {
            let label = format!(
                "{label_prefix} mesh {}{} primitive {}",
                m.index(),
                m.name().map(|n| format!(" ({n})")).unwrap_or_default(),
                p.index()
            );
            primitives.push(primitive::build(device, &p, &buffers, default_material, &build_opts, &label)?);
        }
        meshes.push(GltfMesh {
            name: m.name().map(str::to_owned),
            weights: m.weights().map(|w| w.iter().map(|&x| x as f64).collect()).unwrap_or_default(),
            primitives,
            extras: material::extras_json(m.extras()),
        });
    }

    // ── the rest of the graph
    let mut animations = Vec::new();
    for a in doc.animations() {
        animations.push(animation::convert(&a, &buffers)?);
    }
    let mut skins = Vec::new();
    for s in doc.skins() {
        skins.push(scene::convert_skin(&s, &buffers)?);
    }

    Ok(GltfAsset {
        path: parsed.path.clone(),
        version: doc.as_json().asset.version.clone(),
        min_version: doc.as_json().asset.min_version.clone(),
        generator: doc.as_json().asset.generator.clone(),
        copyright: doc.as_json().asset.copyright.clone(),
        extensions_used: doc.extensions_used().map(str::to_owned).collect(),
        extensions_required: doc.extensions_required().map(str::to_owned).collect(),
        unsupported_required_extensions: unsupported,
        default_scene: doc.default_scene().map(|s| s.index() as u32),
        scenes: doc.scenes().map(|s| scene::convert_scene(&s)).collect(),
        nodes: doc.nodes().map(|n| scene::convert_node(&n)).collect(),
        meshes,
        materials,
        default_material,
        textures,
        samplers,
        animations,
        skins,
        cameras: doc.cameras().map(|c| scene::convert_camera(&c)).collect(),
        lights: doc.lights().map(|it| it.map(|l| scene::convert_light(&l)).collect()).unwrap_or_default(),
        variants: doc
            .variants()
            .map(|it| it.map(|v| v.name().to_owned()).collect())
            .unwrap_or_default(),
        extensions: document_extensions(doc),
        extras: material::extras_json(&doc.as_json().asset.extras),
    })
}

/// Document-level extensions this importer models are stripped; the rest are
/// handed back verbatim so a caller can act on them.
fn document_extensions(doc: &gltf::Document) -> Option<String> {
    let map = doc.extensions()?;
    let rest: serde_json::Map<String, serde_json::Value> = map
        .iter()
        .filter(|(k, _)| !matches!(k.as_str(), "KHR_lights_punctual" | "KHR_materials_variants"))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    if rest.is_empty() { None } else { serde_json::to_string(&rest).ok() }
}

// ── inspectGltf ─────────────────────────────────────────────────────────────

pub struct InspectTask {
    path: String,
    base_directory: Option<String>,
}

impl Task for InspectTask {
    type Output = GltfManifest;
    type JsValue = GltfManifest;

    fn compute(&mut self) -> napi::Result<GltfManifest> {
        let parsed = parse(&self.path, self.base_directory.as_deref())?;
        let doc = &parsed.gltf.document;

        let mut resources = Vec::new();
        for b in doc.buffers() {
            let uri = match b.source() {
                gltf::buffer::Source::Bin => None,
                gltf::buffer::Source::Uri(u) => Some(u),
            };
            resources.push(GltfResource {
                kind: GltfResourceKind::Buffer,
                index: b.index() as u32,
                name: b.name().map(str::to_owned),
                source: uri::classify(uri),
                uri: uri.map(uri::truncate),
                resolved_path: external_path(&parsed.base_dir, uri),
                mime_type: None,
                byte_length: Some(b.length() as f64),
            });
        }
        for i in doc.images() {
            let (uri, mime, source, len) = match i.source() {
                gltf::image::Source::Uri { uri, mime_type } => {
                    (Some(uri), mime_type.map(str::to_owned), uri::classify(Some(uri)), None)
                }
                gltf::image::Source::View { view, mime_type } => (
                    None,
                    Some(mime_type.to_owned()),
                    GltfResourceSource::BufferView,
                    Some(view.length() as f64),
                ),
            };
            resources.push(GltfResource {
                kind: GltfResourceKind::Image,
                index: i.index() as u32,
                name: i.name().map(str::to_owned),
                source,
                uri: uri.map(uri::truncate),
                resolved_path: external_path(&parsed.base_dir, uri),
                mime_type: mime,
                byte_length: len,
            });
        }

        let json = doc.as_json();
        Ok(GltfManifest {
            path: parsed.path.clone(),
            base_directory: parsed.base_dir.to_string_lossy().into_owned(),
            is_binary: parsed.is_binary,
            binary_chunk_length: parsed.gltf.blob.as_ref().map(|b| b.len() as f64),
            version: json.asset.version.clone(),
            min_version: json.asset.min_version.clone(),
            generator: json.asset.generator.clone(),
            copyright: json.asset.copyright.clone(),
            extensions_used: doc.extensions_used().map(str::to_owned).collect(),
            extensions_required: doc.extensions_required().map(str::to_owned).collect(),
            unsupported_required_extensions: unsupported_required(doc),
            resources,
            counts: GltfCounts {
                scenes: doc.scenes().count() as u32,
                nodes: doc.nodes().count() as u32,
                meshes: doc.meshes().count() as u32,
                primitives: doc.meshes().map(|m| m.primitives().count() as u32).sum(),
                materials: doc.materials().count() as u32,
                textures: doc.textures().count() as u32,
                images: doc.images().count() as u32,
                samplers: doc.samplers().count() as u32,
                animations: doc.animations().count() as u32,
                skins: doc.skins().count() as u32,
                cameras: doc.cameras().count() as u32,
                lights: doc.lights().map(|it| it.count() as u32).unwrap_or(0),
            },
        })
    }

    fn resolve(&mut self, _env: Env, output: GltfManifest) -> napi::Result<GltfManifest> {
        Ok(output)
    }
}

fn external_path(base_dir: &Path, uri: Option<&str>) -> Option<String> {
    let uri = uri?;
    if uri.starts_with("data:") {
        return None;
    }
    uri::resolve_uri(base_dir, uri).ok().map(|p| p.to_string_lossy().into_owned())
}

/// Parse a `.gltf` or `.glb` and report what it contains and what it depends on
/// — **without reading any external file, decoding any image, or touching the
/// GPU.** No device is needed.
///
/// This is the first half of the override workflow: the `resources` it lists
/// carry the exact `index` and `uri` values a `GltfResourceOverride` matches on,
/// so a caller can decide what to substitute before `loadGltf` reads anything.
/// It is also the cheap way to answer "does this asset need an extension I do
/// not support" (`unsupportedRequiredExtensions`) or "how big is this scene"
/// (`counts`).
#[napi(ts_return_type = "Promise<GltfManifest>")]
pub fn inspect_gltf(path: String, base_directory: Option<String>) -> AsyncTask<InspectTask> {
    AsyncTask::new(InspectTask { path, base_directory })
}

// ── loadGltf ────────────────────────────────────────────────────────────────

pub struct LoadGltfTask {
    device: Arc<wgpu::Device>,
    queue: Arc<wgpu::Queue>,
    path: String,
    options: ResolvedOptions,
}

impl Task for LoadGltfTask {
    type Output = GltfAsset;
    type JsValue = GltfAsset;

    fn compute(&mut self) -> napi::Result<GltfAsset> {
        let parsed = parse(&self.path, self.options.base_directory.as_deref())?;
        let unsupported = check_required(&parsed.gltf.document, &self.path, self.options.strict)?;

        // Parsing, URI resolution and accessor decoding are pure CPU and reject
        // bad input themselves. Buffer creation and texture upload are not, and
        // they run here on a libuv worker where the caller's error scope does
        // not reach — see `gpu::error::with_validation_scope`. Without this a
        // rejected upload would hand back a complete-looking asset full of
        // garbage, which is exactly the failure mode `image/compressed.rs`
        // documents.
        with_validation_scope(&self.device, &format!("loadGltf('{}')", self.path), || {
            build_asset(&self.device, &self.queue, &parsed, &self.options, unsupported)
        })
    }

    fn resolve(&mut self, _env: Env, output: GltfAsset) -> napi::Result<GltfAsset> {
        Ok(output)
    }
}

/// Import a glTF 2.0 asset (`.gltf` or `.glb`) into GPU buffers, textures and
/// samplers, plus its whole scene graph as typed data — off the JS thread.
///
/// Each primitive comes back as an **interleaved vertex buffer** with a
/// `layout` in the exact shape `GPUVertexBufferLayout` wants, an index buffer
/// (`Uint16`/`Uint32` — glTF's byte indices are widened, since WebGPU has no
/// 8-bit index format), and a `gpuTopology` string ready for
/// `createRenderPipeline`. Materials arrive with every spec default applied and
/// every supported `KHR_*` extension folded in; anything unrecognised is kept as
/// raw JSON rather than dropped.
///
/// Texture colour space is inferred from which material slot each texture is
/// bound to (base colour and emissive are sRGB, normal/occlusion/metallic-
/// roughness are linear) and can be overridden per texture.
///
/// Use `inspectGltf` first if you need to redirect the file's external
/// resources — it lists every buffer and image URI, which is what
/// `resourceOverrides` matches on.
///
/// The promise rejects on a malformed file, a missing resource, a required
/// extension this importer does not implement, or a wgpu validation error
/// during upload.
#[napi(ts_return_type = "Promise<GltfAsset>")]
pub fn load_gltf(
    device: &GpuDevice,
    path: String,
    options: Option<GltfLoadOptions>,
) -> napi::Result<AsyncTask<LoadGltfTask>> {
    Ok(AsyncTask::new(LoadGltfTask {
        device: Arc::clone(&device.inner),
        queue: Arc::clone(&device.queue_inner),
        path,
        options: resolve_options(options)?,
    }))
}
