//! glTF images and samplers → `GpuTexture` and `GpuSampler`.
//!
//! ## Colour space is inferred from *use*, not from the image
//!
//! A PNG does not say whether it holds colour or data, and glTF does not put a
//! colour-space field on `images` either. What decides it is the material slot
//! the texture is bound to: `baseColorTexture` and `emissiveTexture` (and the
//! specular/sheen *colour* textures from the KHR extensions) are sRGB; normal,
//! occlusion and metallic-roughness maps are linear data that must not be
//! transfer-decoded.
//!
//! So this file scans every material first, marks which `textures[i]` land in a
//! colour slot, and creates `rgba8unorm-srgb` for those and `rgba8unorm` for the
//! rest. Getting this wrong is the classic "everything is slightly too bright /
//! the normals are subtly wrong" bug, and it produces no error of any kind.
//!
//! Two consequences worth stating:
//!
//! - **A texture used as both colour and data resolves to sRGB.** That is a
//!   conflict in the asset (the same bytes cannot be both), and sRGB is the
//!   safer guess because a colour map read as linear is visibly wrong while a
//!   mask read as sRGB is usually only slightly off. `textureColorSpaces` in the
//!   load options overrides it either way.
//! - **A texture referenced by no material at all defaults to linear**, since
//!   there is no evidence for sRGB and inventing a transfer curve is worse than
//!   not applying one.
//!
//! ## One image, many textures
//!
//! Several `textures[i]` can point at one `images[j]`, and glTF also allows the
//! same image to appear under two different samplers. The decode happens once
//! per (image, colour space) pair and each `GltfTexture` gets its **own napi
//! handle over the same `wgpu::Texture`**. They alias: `destroy()` on one frees
//! it for all of them.
//!
//! ## No mipmap generation
//!
//! Decoded images arrive with a single mip level and stay that way. Generating a
//! chain means either a CPU downsample (wrong for sRGB unless done in linear
//! space, and slow) or a render/compute pass per level (a pipeline, a shader and
//! a sampler this module would have to own). Neither belongs in a loader —
//! **`KHR_texture_basisu` is the supported answer**, since a `.ktx2` carries its
//! whole mip pyramid pre-built and lands on `image/compressed.rs` untouched.

use super::enums::{GltfImageEncoding, GltfMagFilter, GltfMinFilter, GltfWrapMode};
use crate::gpu::{GpuSampler, GpuTexture};
use crate::image::{ImageColorSpace, generic_err};
use napi_derive::napi;
use std::collections::HashMap;
use std::sync::Arc;

/// A glTF texture: the sampler/image pair, plus the GPU texture it produced.
#[napi(object, object_from_js = false)]
pub struct GltfTexture {
    pub name: Option<String>,
    /// The uploaded texture. `null` when the image was skipped by a
    /// `resourceOverride` or when `loadImages` was false.
    pub texture: Option<GpuTexture>,
    /// Index into `GltfAsset.samplers`. Always set — a texture with no sampler
    /// in the file points at the appended default one.
    pub sampler: u32,
    /// Index into the file's `images` array, for correlating with
    /// `GltfManifest.resources`.
    pub source: Option<u32>,
    /// How the pixels were interpreted. See the module docs for how this is
    /// decided.
    pub color_space: ImageColorSpace,
    pub encoding: GltfImageEncoding,
    /// Raw JSON of any extension on the `textures[i]` entry (for example
    /// `KHR_texture_basisu`), verbatim.
    pub extensions: Option<String>,
}

/// A glTF sampler and the `GpuSampler` created from it.
#[napi(object, object_from_js = false)]
pub struct GltfSampler {
    pub name: Option<String>,
    pub sampler: GpuSampler,
    pub mag_filter: GltfMagFilter,
    pub min_filter: GltfMinFilter,
    pub wrap_s: GltfWrapMode,
    pub wrap_t: GltfWrapMode,
    /// True for the sampler this importer appends for textures that declare
    /// none. glTF leaves that case to the implementation; the defaults chosen
    /// are `repeat`/`repeat` with trilinear filtering, which is what every other
    /// viewer does.
    pub is_default: bool,
}

fn wrap(w: gltf::texture::WrappingMode) -> GltfWrapMode {
    use gltf::texture::WrappingMode;
    match w {
        WrappingMode::ClampToEdge => GltfWrapMode::ClampToEdge,
        WrappingMode::MirroredRepeat => GltfWrapMode::MirroredRepeat,
        WrappingMode::Repeat => GltfWrapMode::Repeat,
    }
}

fn address_mode(w: GltfWrapMode) -> wgpu::AddressMode {
    match w {
        GltfWrapMode::ClampToEdge => wgpu::AddressMode::ClampToEdge,
        GltfWrapMode::MirroredRepeat => wgpu::AddressMode::MirrorRepeat,
        GltfWrapMode::Repeat => wgpu::AddressMode::Repeat,
    }
}

/// glTF's six `minFilter` values collapse into WebGPU's (minFilter,
/// mipmapFilter) pair. The two non-mipmapped values keep `Nearest` mipmapping,
/// which is a no-op on the single-level textures this loader produces and the
/// closest thing WebGPU has to "no mip chain".
fn min_filter_pair(f: GltfMinFilter) -> (wgpu::FilterMode, wgpu::MipmapFilterMode) {
    use wgpu::{FilterMode as F, MipmapFilterMode as M};
    match f {
        GltfMinFilter::Nearest => (F::Nearest, M::Nearest),
        GltfMinFilter::Linear => (F::Linear, M::Nearest),
        GltfMinFilter::NearestMipmapNearest => (F::Nearest, M::Nearest),
        GltfMinFilter::LinearMipmapNearest => (F::Linear, M::Nearest),
        GltfMinFilter::NearestMipmapLinear => (F::Nearest, M::Linear),
        GltfMinFilter::LinearMipmapLinear => (F::Linear, M::Linear),
    }
}

pub(crate) struct SamplerSpec {
    pub(crate) name: Option<String>,
    pub(crate) mag: GltfMagFilter,
    pub(crate) min: GltfMinFilter,
    pub(crate) wrap_s: GltfWrapMode,
    pub(crate) wrap_t: GltfWrapMode,
    pub(crate) is_default: bool,
}

pub(crate) fn sampler_spec(s: &gltf::texture::Sampler<'_>) -> SamplerSpec {
    SamplerSpec {
        name: s.name().map(str::to_owned),
        mag: match s.mag_filter() {
            Some(gltf::texture::MagFilter::Nearest) => GltfMagFilter::Nearest,
            _ => GltfMagFilter::Linear,
        },
        min: match s.min_filter() {
            Some(gltf::texture::MinFilter::Nearest) => GltfMinFilter::Nearest,
            Some(gltf::texture::MinFilter::Linear) => GltfMinFilter::Linear,
            Some(gltf::texture::MinFilter::NearestMipmapNearest) => GltfMinFilter::NearestMipmapNearest,
            Some(gltf::texture::MinFilter::LinearMipmapNearest) => GltfMinFilter::LinearMipmapNearest,
            Some(gltf::texture::MinFilter::NearestMipmapLinear) => GltfMinFilter::NearestMipmapLinear,
            _ => GltfMinFilter::LinearMipmapLinear,
        },
        wrap_s: wrap(s.wrap_s()),
        wrap_t: wrap(s.wrap_t()),
        is_default: false,
    }
}

pub(crate) fn default_sampler_spec() -> SamplerSpec {
    SamplerSpec {
        name: None,
        mag: GltfMagFilter::Linear,
        min: GltfMinFilter::LinearMipmapLinear,
        wrap_s: GltfWrapMode::Repeat,
        wrap_t: GltfWrapMode::Repeat,
        is_default: true,
    }
}

pub(crate) fn build_sampler(
    device: &wgpu::Device,
    spec: &SamplerSpec,
    max_anisotropy: u16,
    label: Option<&str>,
) -> GltfSampler {
    let (min, mipmap) = min_filter_pair(spec.min);
    let mag = match spec.mag {
        GltfMagFilter::Nearest => wgpu::FilterMode::Nearest,
        GltfMagFilter::Linear => wgpu::FilterMode::Linear,
    };
    // wgpu rejects anisotropy > 1 unless all three filters are Linear, and a
    // rejected sampler is a validation error rather than a thrown one — so the
    // request is silently clamped for nearest-filtered samplers instead.
    let aniso = if max_anisotropy > 1
        && min == wgpu::FilterMode::Linear
        && mag == wgpu::FilterMode::Linear
        && mipmap == wgpu::MipmapFilterMode::Linear
    {
        max_anisotropy
    } else {
        1
    };

    let inner = device.create_sampler(&wgpu::SamplerDescriptor {
        label,
        address_mode_u: address_mode(spec.wrap_s),
        address_mode_v: address_mode(spec.wrap_t),
        address_mode_w: wgpu::AddressMode::ClampToEdge,
        mag_filter: mag,
        min_filter: min,
        mipmap_filter: mipmap,
        lod_min_clamp: 0.0,
        lod_max_clamp: 32.0,
        compare: None,
        anisotropy_clamp: aniso,
        border_color: None,
    });

    GltfSampler {
        name: spec.name.clone(),
        sampler: GpuSampler::new(inner, label.map(str::to_owned)),
        mag_filter: spec.mag,
        min_filter: spec.min,
        wrap_s: spec.wrap_s,
        wrap_t: spec.wrap_t,
        is_default: spec.is_default,
    }
}

// ── image decoding ──────────────────────────────────────────────────────────

/// Identify a container from its magic bytes, falling back to the declared
/// `mimeType`.
///
/// Signature first, `mimeType` second — the same precedence
/// `image/uncompressed.rs` uses for extensions, and for the same reason: a
/// mislabelled asset is common and a corrupt one is not.
pub(crate) fn detect_encoding(bytes: &[u8], mime_type: Option<&str>) -> GltfImageEncoding {
    const KTX2: &[u8] = &[0xAB, 0x4B, 0x54, 0x58, 0x20, 0x32, 0x30, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A];
    if bytes.starts_with(KTX2) {
        return GltfImageEncoding::Ktx2;
    }
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        return GltfImageEncoding::Png;
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return GltfImageEncoding::Jpeg;
    }
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return GltfImageEncoding::WebP;
    }
    if bytes.starts_with(b"#?RADIANCE") || bytes.starts_with(b"#?RGBE") {
        return GltfImageEncoding::Hdr;
    }
    match mime_type {
        Some("image/png") => GltfImageEncoding::Png,
        Some("image/jpeg") => GltfImageEncoding::Jpeg,
        Some("image/webp") => GltfImageEncoding::WebP,
        Some("image/ktx2") => GltfImageEncoding::Ktx2,
        Some("image/vnd.radiance") => GltfImageEncoding::Hdr,
        _ => GltfImageEncoding::Unknown,
    }
}

/// A decoded image, cached so several `textures[i]` over one `images[j]` decode
/// once.
struct UploadedImage {
    inner: Arc<wgpu::Texture>,
    width: u32,
    height: u32,
    mip_level_count: u32,
    format: wgpu::TextureFormat,
}

/// Decodes and uploads images on demand, keyed by (image index, sRGB).
///
/// The colour space is part of the key because it changes the *texture format*,
/// not just how it is sampled — one image used as both albedo and a mask really
/// does need two GPU textures.
pub(crate) struct ImageCache {
    cache: HashMap<(usize, bool), UploadedImage>,
    usage: u32,
}

impl ImageCache {
    pub(crate) fn new(usage: u32) -> Self {
        Self { cache: HashMap::new(), usage }
    }

    /// Get (decoding if necessary) a fresh napi handle over `images[index]`.
    ///
    /// Each call mints a **new** `GpuTexture` handle over the same
    /// `wgpu::Texture`; they alias, and `destroy()` on any of them frees it for
    /// all. That is the price of `#[napi(object)]` fields owning their values,
    /// and it is benign for loaded textures, which are read-only.
    pub(crate) fn get(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        index: usize,
        srgb: bool,
        bytes: &[u8],
        encoding: GltfImageEncoding,
        mime_type: Option<&str>,
        label: &str,
    ) -> napi::Result<GpuTexture> {
        if !self.cache.contains_key(&(index, srgb)) {
            let uploaded = match encoding {
                GltfImageEncoding::Ktx2 => {
                    // A KTX2 states its own format, so `srgb` is not consulted —
                    // same rule as `loadKtx2Texture`. See `image/compressed.rs`.
                    let t = crate::image::upload_ktx2_bytes(device, queue, bytes, label, self.usage, Some(label))?;
                    UploadedImage {
                        inner: Arc::clone(&t.inner),
                        width: t.width,
                        height: t.height,
                        mip_level_count: t.mip_level_count,
                        format: t.format,
                    }
                }
                _ => {
                    let img = crate::image::decode_image_bytes(bytes, label, srgb, mime_type)?;
                    let inner = crate::image::upload_texture(device, queue, &img, self.usage, Some(label));
                    UploadedImage {
                        inner,
                        width: img.width,
                        height: img.height,
                        mip_level_count: 1,
                        format: img.format,
                    }
                }
            };
            self.cache.insert((index, srgb), uploaded);
        }

        let u = &self.cache[&(index, srgb)];
        Ok(crate::image::make_gpu_texture(
            Arc::clone(&u.inner),
            u.width,
            u.height,
            u.mip_level_count,
            u.format,
            self.usage,
            Some(label.to_owned()),
        ))
    }
}

/// `KHR_texture_basisu` (and any other extension) may point a texture at a
/// different image than the core `source`. Returns the image index to use.
pub(crate) fn resolve_source(t: &gltf::Texture<'_>) -> napi::Result<usize> {
    if let Some(v) = t.extension_value("KHR_texture_basisu") {
        if let Some(src) = v.get("source").and_then(|s| s.as_u64()) {
            return Ok(src as usize);
        }
    }
    if let Some(v) = t.extension_value("EXT_texture_webp") {
        if let Some(src) = v.get("source").and_then(|s| s.as_u64()) {
            return Ok(src as usize);
        }
    }
    Ok(t.source().index())
}

/// Serialise a texture entry's extensions back out, so `KHR_texture_basisu` and
/// friends stay visible to the caller.
pub(crate) fn texture_extensions(t: &gltf::Texture<'_>) -> Option<String> {
    let map = t.extensions()?;
    if map.is_empty() { None } else { serde_json::to_string(map).ok() }
}

pub(crate) fn missing_image(index: usize) -> napi::Error {
    generic_err(format!("texture references images[{index}], which does not exist"))
}
