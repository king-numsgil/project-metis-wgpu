//! The **compressed** loader: upload GPU-block-compressed textures from a KTX2
//! container, mip chain and all.
//!
//! This file is where every block-alignment rule in the package lives. Nothing
//! here is shared with [`super::uncompressed`] beyond the napi handle
//! construction — see [`super`] for why the two are kept apart.
//!
//! ## No transcoder, by design
//!
//! KTX2 is a container, and it can hold two very different things: **already
//! GPU-ready blocks** (BC/ETC2/ASTC, identified by the header's `vkFormat`), or
//! a **Basis Universal universal payload** that must be transcoded to whatever
//! the GPU supports at load time.
//!
//! Only the first is supported here, and that is a deliberate architectural
//! line rather than an unfinished feature. The mature Basis transcoder is C++
//! bindings, and putting a C++ decoder back in the texture path is precisely
//! what the SDL3_image removal bought out (a heap corruption that presented as
//! "the demos crash on startup" — see this package's `CLAUDE.md`). The
//! pure-Rust `basisu` crate exists but was v0.1.0 with ~10 downloads as of
//! 2026-07, which is not something to put in front of every texture load.
//!
//! So the "decoder" here is a header parse plus a memcpy: the blocks in the
//! file are the bytes the GPU samples. A malformed file produces an `Err`, not
//! a crash.
//!
//! ## Supercompression
//!
//! Zstandard is supported, via `ruzstd` (pure Rust — the `zstd` crate is C
//! bindings, same rule as above). Each level is an independent zstd frame and
//! is decompressed on the worker thread. ZLIB and BasisLZ are rejected with a
//! clear error.
//!
//! Zstd is worth having: BC blocks still compress ~2x on disk, so a `.ktx2`
//! with zstd is often smaller than the PNG it replaced while staying
//! compressed in VRAM.
//!
//! ## Making the files
//!
//! Encoding is an **offline asset-pipeline** job, not a runtime one — BC7
//! encoding is far too slow to do at load. Use `ktx` / `toktx` from
//! KTX-Software:
//!
//! ```text
//! ktx create --format BC7_UNORM_BLOCK --generate-mipmap --zstd 18 in.png out.ktx2
//! ktx create --format BC5_UNORM_BLOCK --generate-mipmap --zstd 18 normal.png normal.ktx2
//! ```

use super::{DEFAULT_TEXTURE_USAGE, generic_err, make_gpu_texture};
use crate::gpu::error::with_validation_scope;
use crate::gpu::{GpuDevice, GpuTexture};
use napi::bindgen_prelude::AsyncTask;
use napi::{Env, Task};
use napi_derive::napi;
use std::borrow::Cow;
use std::io::Read;
use std::sync::Arc;

#[napi(object)]
pub struct Ktx2LoadOptions {
    /// Debug label applied to the created GPU texture.
    pub label: Option<String>,
    /// `GpuTextureUsage` bitmask. Defaults to `TEXTURE_BINDING | COPY_DST`.
    pub usage: Option<u32>,
}

// Note there is no `colorSpace` option, unlike `loadImageTexture`. A KTX2 file
// states its own format, so sRGB-vs-linear is read out of the file (a
// `BC7_SRGB_BLOCK` becomes `bc7-rgba-unorm-srgb`); letting the caller override
// it would just be a way to silently contradict the asset.

/// One row of the vkFormat -> wgpu mapping.
///
/// A lookup table rather than a `match` because `ktx2::Format` is a newtype over
/// `NonZeroU32` with associated consts, not a real enum — its constants cannot
/// be used as match patterns. Same shape as `convert.rs`'s `FEATURES` table.
struct BlockFormat {
    ktx2: ktx2::Format,
    wgpu: wgpu::TextureFormat,
    /// The device feature that must be enabled to create this format.
    feature: wgpu::Features,
    /// The WebGPU spelling of `feature`, for the error message — this is the
    /// exact string the caller passes to `requestDevice`.
    feature_name: &'static str,
}

const BC: wgpu::Features = wgpu::Features::TEXTURE_COMPRESSION_BC;
const BC_NAME: &str = "texture-compression-bc";

/// The BC family only. ETC2 and ASTC are valid KTX2 payloads and wgpu supports
/// both, but they are mobile-oriented formats and this crate targets desktop,
/// where BC is universal — so they are rejected with a pointed error rather
/// than mapped and left untested. Adding them is a table entry plus their
/// feature name if a mobile-class backend ever matters.
const BLOCK_FORMATS: &[BlockFormat] = &[
    // BC1 ("DXT1") — 4 bpp. KTX2 distinguishes RGB from RGBA at the container
    // level, but wgpu has only the RGBA form (the 1-bit alpha is a property of
    // the block encoding, not of the format), so both map to the same place.
    BlockFormat { ktx2: ktx2::Format::BC1_RGB_UNORM_BLOCK, wgpu: wgpu::TextureFormat::Bc1RgbaUnorm, feature: BC, feature_name: BC_NAME },
    BlockFormat { ktx2: ktx2::Format::BC1_RGB_SRGB_BLOCK, wgpu: wgpu::TextureFormat::Bc1RgbaUnormSrgb, feature: BC, feature_name: BC_NAME },
    BlockFormat { ktx2: ktx2::Format::BC1_RGBA_UNORM_BLOCK, wgpu: wgpu::TextureFormat::Bc1RgbaUnorm, feature: BC, feature_name: BC_NAME },
    BlockFormat { ktx2: ktx2::Format::BC1_RGBA_SRGB_BLOCK, wgpu: wgpu::TextureFormat::Bc1RgbaUnormSrgb, feature: BC, feature_name: BC_NAME },
    // BC2/BC3 ("DXT3"/"DXT5") — 8 bpp RGBA. Legacy; BC7 is better at the same
    // size. Mapped so old assets load, not because they should be authored.
    BlockFormat { ktx2: ktx2::Format::BC2_UNORM_BLOCK, wgpu: wgpu::TextureFormat::Bc2RgbaUnorm, feature: BC, feature_name: BC_NAME },
    BlockFormat { ktx2: ktx2::Format::BC2_SRGB_BLOCK, wgpu: wgpu::TextureFormat::Bc2RgbaUnormSrgb, feature: BC, feature_name: BC_NAME },
    BlockFormat { ktx2: ktx2::Format::BC3_UNORM_BLOCK, wgpu: wgpu::TextureFormat::Bc3RgbaUnorm, feature: BC, feature_name: BC_NAME },
    BlockFormat { ktx2: ktx2::Format::BC3_SRGB_BLOCK, wgpu: wgpu::TextureFormat::Bc3RgbaUnormSrgb, feature: BC, feature_name: BC_NAME },
    // BC4 — single channel, 4 bpp. Roughness / metallic / AO / masks.
    BlockFormat { ktx2: ktx2::Format::BC4_UNORM_BLOCK, wgpu: wgpu::TextureFormat::Bc4RUnorm, feature: BC, feature_name: BC_NAME },
    BlockFormat { ktx2: ktx2::Format::BC4_SNORM_BLOCK, wgpu: wgpu::TextureFormat::Bc4RSnorm, feature: BC, feature_name: BC_NAME },
    // BC5 — two channels, 8 bpp. The right format for tangent-space normal
    // maps: store XY, reconstruct Z in the shader. Markedly better than BC7 for
    // normals despite the same bitrate.
    BlockFormat { ktx2: ktx2::Format::BC5_UNORM_BLOCK, wgpu: wgpu::TextureFormat::Bc5RgUnorm, feature: BC, feature_name: BC_NAME },
    BlockFormat { ktx2: ktx2::Format::BC5_SNORM_BLOCK, wgpu: wgpu::TextureFormat::Bc5RgSnorm, feature: BC, feature_name: BC_NAME },
    // BC6H — HDR RGB, 8 bpp. The compressed counterpart to the `rgba16float`
    // textures `loadImageTexture` produces from Radiance `.hdr`: a 2K env map
    // drops from 16 MB to 4 MB. Note BC6H has no alpha channel.
    BlockFormat { ktx2: ktx2::Format::BC6H_UFLOAT_BLOCK, wgpu: wgpu::TextureFormat::Bc6hRgbUfloat, feature: BC, feature_name: BC_NAME },
    BlockFormat { ktx2: ktx2::Format::BC6H_SFLOAT_BLOCK, wgpu: wgpu::TextureFormat::Bc6hRgbFloat, feature: BC, feature_name: BC_NAME },
    // BC7 — RGBA, 8 bpp. The default for colour (albedo, emissive).
    BlockFormat { ktx2: ktx2::Format::BC7_UNORM_BLOCK, wgpu: wgpu::TextureFormat::Bc7RgbaUnorm, feature: BC, feature_name: BC_NAME },
    BlockFormat { ktx2: ktx2::Format::BC7_SRGB_BLOCK, wgpu: wgpu::TextureFormat::Bc7RgbaUnormSrgb, feature: BC, feature_name: BC_NAME },
];

fn lookup_format(f: ktx2::Format) -> Option<&'static BlockFormat> {
    BLOCK_FORMATS.iter().find(|e| e.ktx2 == f)
}

/// Dimensions of mip `level`, floor-halved and clamped at 1 — the standard mip
/// chain rule. Block-compressed mips are *not* required to be multiples of the
/// block size; the last few levels of a non-square texture routinely aren't.
fn mip_size(base: u32, level: u32) -> u32 {
    (base >> level).max(1)
}

/// Validated header fields, extracted so the checks all happen in one place
/// before any GPU resource is created.
struct Ktx2Info {
    width: u32,
    height: u32,
    format: &'static BlockFormat,
    level_count: u32,
}

/// Every way a KTX2 file can be valid-but-unsupported, rejected up front with a
/// message that says what to do about it.
///
/// This runs *before* `create_texture`, so a rejected file allocates no GPU
/// memory. Each arm returns `Err`; none of them can panic, which matters
/// because a panic here would abort the process rather than reject the promise.
fn validate(path: &str, reader: &ktx2::Reader<&[u8]>, features: wgpu::Features) -> napi::Result<Ktx2Info> {
    let header = reader.header();

    // VK_FORMAT_UNDEFINED means a universal (Basis) payload needing a transcoder.
    let format = header.format.ok_or_else(|| {
        generic_err(format!(
            "'{}' has no vkFormat, which means a Basis Universal payload that must be transcoded at load time. \
             This loader takes pre-compressed blocks only (see the module docs for why there is no transcoder) — \
             re-encode to a specific format, e.g. `ktx create --format BC7_UNORM_BLOCK`.",
            path
        ))
    })?;

    let format = lookup_format(format).ok_or_else(|| {
        generic_err(format!(
            "'{}' is {:?}, which this loader does not map to a wgpu format. \
             Supported: BC1-BC7 (use BC7 for colour, BC5 for normal maps, BC4 for masks, BC6H for HDR). \
             ETC2 and ASTC are deliberately unmapped — this crate targets desktop, where BC is universal.",
            path, format
        ))
    })?;

    // The feature gate. Checked here, on the worker thread, so it surfaces as a
    // rejected promise. Creating a texture with an unsupported format would
    // otherwise be a wgpu validation error — which this binding does not throw
    // on — and the caller would get an unusable handle instead of an error.
    if !features.contains(format.feature) {
        return Err(generic_err(format!(
            "'{}' is {:?}, which requires the '{}' device feature, but the device was not created with it. \
             There is no software fallback: block-compressed data cannot be uploaded to a device that cannot sample it. \
             Check `adapter.features.includes('{}')`, then pass it in `requestDevice({{ requiredFeatures: ['{}'] }}). \
             If the adapter genuinely lacks it, ship an uncompressed copy of the asset and use loadImageTexture instead.",
            path, format.wgpu, format.feature_name, format.feature_name, format.feature_name
        )));
    }

    if header.pixel_width == 0 {
        return Err(generic_err(format!("'{}' has zero width", path)));
    }
    // pixel_height == 0 marks a 1D texture; pixel_depth != 0 marks a 3D one.
    if header.pixel_height == 0 {
        return Err(generic_err(format!("'{}' is a 1D texture; only 2D textures are supported", path)));
    }
    if header.pixel_depth != 0 {
        return Err(generic_err(format!("'{}' is a 3D texture; only 2D textures are supported", path)));
    }
    if header.layer_count > 1 {
        return Err(generic_err(format!(
            "'{}' is a {}-layer texture array; only single-layer 2D textures are supported",
            path, header.layer_count
        )));
    }
    if header.face_count != 1 {
        return Err(generic_err(format!(
            "'{}' has {} faces (a cubemap); only single-face 2D textures are supported",
            path, header.face_count
        )));
    }

    if let Some(scheme) = header.supercompression_scheme {
        match scheme {
            ktx2::SupercompressionScheme::Zstandard => {} // supported below
            ktx2::SupercompressionScheme::BasisLZ => {
                return Err(generic_err(format!(
                    "'{}' uses BasisLZ supercompression, which requires a Basis transcoder rather than plain \
                     decompression. Re-encode with `--zstd` instead of BasisLZ.",
                    path
                )));
            }
            other => {
                return Err(generic_err(format!(
                    "'{}' uses {:?} supercompression, which is not supported. Re-encode uncompressed or with `--zstd`.",
                    path, other
                )));
            }
        }
    }

    // WebGPU requires a block-compressed texture's *base* dimensions to be a
    // multiple of the block size — `create_texture` rejects anything else, so
    // this cannot be papered over here. (Mip levels below the block size are
    // fine; see `upload_blocks` for how those are handled.) A correct encoder
    // pads the source to a block multiple, so this indicates a bad asset.
    let (block_w, block_h) = format.wgpu.block_dimensions();
    if header.pixel_width % block_w != 0 || header.pixel_height % block_h != 0 {
        return Err(generic_err(format!(
            "'{}' is {}x{}, which is not a multiple of {:?}'s {}x{} block size. \
             WebGPU cannot create a block-compressed texture with unaligned base dimensions. \
             Re-encode with dimensions padded to a multiple of {}x{}.",
            path, header.pixel_width, header.pixel_height, format.wgpu, block_w, block_h, block_w, block_h
        )));
    }

    // level_count == 0 is the file asking the application to generate mips. We
    // cannot: generating mips for block-compressed data would mean decoding,
    // downsampling and re-encoding on the CPU. Treat it as the single base level.
    let level_count = reader.levels().len().max(1) as u32;

    Ok(Ktx2Info { width: header.pixel_width, height: header.pixel_height, format, level_count })
}

/// Decompress one zstd-supercompressed level.
///
/// `expected` is the size computed from the *dimensions*, not from the file's
/// `uncompressed_byte_length` — a corrupt or hostile header must not be able to
/// drive a huge pre-allocation. `read_to_end` grows past it if the frame really
/// is larger, and the caller checks the final length either way.
fn decompress_zstd(src: &[u8], expected: usize, path: &str, level: u32) -> napi::Result<Vec<u8>> {
    let mut decoder = ruzstd::decoding::StreamingDecoder::new(src)
        .map_err(|e| generic_err(format!("'{}': zstd frame for mip level {} is malformed: {}", path, level, e)))?;
    let mut out = Vec::with_capacity(expected);
    decoder
        .read_to_end(&mut out)
        .map_err(|e| generic_err(format!("'{}': zstd decompression failed for mip level {}: {}", path, level, e)))?;
    Ok(out)
}

/// Uploads a whole mip pyramid of blocks into a fresh texture.
///
/// **This is the block-alignment code, and it is the one real difference from
/// the uncompressed path.** Three things differ from a pixel upload:
///
/// - `bytes_per_row` counts **blocks**, not pixels: `blocks_wide * block_bytes`.
///   For BC7 that is `ceil(w/4) * 16`, not `w * 4`.
/// - `rows_per_image` counts **rows of blocks**, so `ceil(h/4)`.
/// - The copy `Extent3d` is in texels, but it must be the **physical** size —
///   the logical mip size rounded *up* to a whole block — not the logical size.
///   This is the tail of the mip chain: level 6 of a 64x64 BC7 texture is 1x1
///   logically but occupies a full 4x4 block, and wgpu rejects a copy width that
///   is not a block multiple ("Copy width is not a multiple of block width").
///   Passing the logical size looks obviously right and fails on every mipped
///   texture, at the small levels only — which is why the tests assert on an
///   error scope rather than just on the returned handle.
fn upload_blocks(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    info: &Ktx2Info,
    levels: &[Cow<'_, [u8]>],
    usage: u32,
    label: Option<&str>,
) -> Arc<wgpu::Texture> {
    let format = info.format.wgpu;
    let (block_w, block_h) = format.block_dimensions();
    // Safe to unwrap: every format in BLOCK_FORMATS is a colour format with a
    // defined block size, so `block_copy_size(None)` is always `Some`.
    let block_bytes = format.block_copy_size(None).unwrap_or(0);

    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label,
        size: wgpu::Extent3d { width: info.width, height: info.height, depth_or_array_layers: 1 },
        mip_level_count: info.level_count,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: crate::gpu::convert::texture_usage(usage),
        view_formats: &[],
    });

    for (i, data) in levels.iter().enumerate() {
        let level = i as u32;
        let w = mip_size(info.width, level);
        let h = mip_size(info.height, level);
        let blocks_wide = w.div_ceil(block_w);
        let blocks_high = h.div_ceil(block_h);

        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: level,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            data,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(blocks_wide * block_bytes),
                rows_per_image: Some(blocks_high),
            },
            wgpu::Extent3d {
                width: blocks_wide * block_w,
                height: blocks_high * block_h,
                depth_or_array_layers: 1,
            },
        );
    }

    // Flush the staged writes for the same reason the uncompressed path does —
    // `write_texture` only queues the copy, so without this a texture loaded and
    // destroyed before any submit leaves staged writes against freed memory.
    queue.submit(std::iter::empty());
    Arc::new(texture)
}

// ── loadKtx2Texture (async) ─────────────────────────────────────────────────

pub struct LoadKtx2Task {
    device: Arc<wgpu::Device>,
    queue: Arc<wgpu::Queue>,
    path: String,
    usage: u32,
    label: Option<String>,
}

impl Task for LoadKtx2Task {
    type Output = GpuTexture;
    type JsValue = GpuTexture;

    fn compute(&mut self) -> napi::Result<GpuTexture> {
        let bytes = std::fs::read(&self.path)
            .map_err(|e| generic_err(format!("failed to read '{}': {}", self.path, e)))?;

        let reader = ktx2::Reader::new(bytes.as_slice())
            .map_err(|e| generic_err(format!("'{}' is not a valid KTX2 file: {:?}", self.path, e)))?;

        let info = validate(&self.path, &reader, self.device.features())?;

        let format = info.format.wgpu;
        let (block_w, block_h) = format.block_dimensions();
        let block_bytes = format.block_copy_size(None).unwrap_or(0) as usize;

        // Decompress if needed and check every level's size *before* touching
        // the GPU. A short level would otherwise become a wgpu validation error
        // (which this binding does not throw on), leaving the caller with a
        // texture full of garbage and no indication anything went wrong.
        let zstd = matches!(reader.header().supercompression_scheme, Some(ktx2::SupercompressionScheme::Zstandard));
        let mut levels: Vec<Cow<'_, [u8]>> = Vec::with_capacity(info.level_count as usize);

        for (i, level) in reader.levels().enumerate() {
            let idx = i as u32;
            let w = mip_size(info.width, idx);
            let h = mip_size(info.height, idx);
            let expected = (w.div_ceil(block_w) as usize) * (h.div_ceil(block_h) as usize) * block_bytes;

            let data: Cow<'_, [u8]> = if zstd {
                Cow::Owned(decompress_zstd(level.data, expected, &self.path, idx)?)
            } else {
                Cow::Borrowed(level.data)
            };

            if data.len() < expected {
                return Err(generic_err(format!(
                    "'{}': mip level {} is truncated — {} bytes present, {} required for {}x{} of {:?}",
                    self.path, idx, data.len(), expected, w, h, format
                )));
            }
            levels.push(data);
        }

        // Everything above is pure CPU parsing and rejects bad input itself.
        // From here on wgpu is involved, and this runs on a libuv worker where
        // the caller's error scope does not reach — see `with_validation_scope`.
        // A wrong `bytes_per_row` or copy extent is a validation error, not a
        // panic, so without this it would hand back a plausible texture full of
        // garbage.
        let inner = with_validation_scope(
            &self.device,
            &format!("loadKtx2Texture('{}')", self.path),
            || Ok(upload_blocks(&self.device, &self.queue, &info, &levels, self.usage, self.label.as_deref())),
        )?;
        Ok(make_gpu_texture(inner, info.width, info.height, info.level_count, format, self.usage))
    }

    fn resolve(&mut self, _env: Env, output: GpuTexture) -> napi::Result<GpuTexture> {
        Ok(output)
    }
}

/// Load a **KTX2** file of GPU-block-compressed texture data (BC1-BC7),
/// including its full mip chain, straight into a `GpuTexture` — off the JS
/// thread, with no decoding step: the blocks in the file are the bytes the GPU
/// samples, so they stay compressed in VRAM (a 2K BC7 texture is 5.5 MB rather
/// than 16 MB).
///
/// Unlike `loadImageTexture` there is no `colorSpace` option — the file states
/// its own format, and `BC7_SRGB_BLOCK` becomes `bc7-rgba-unorm-srgb`
/// accordingly. Read `format` and `mipLevelCount` off the returned handle.
///
/// **Requires the `texture-compression-bc` device feature.** The returned
/// promise rejects with an actionable error if the device lacks it — there is
/// no software fallback, so ship an uncompressed asset for such devices. In
/// practice every desktop GPU on Windows and Linux supports BC.
///
/// Zstandard supercompression is handled transparently. BasisLZ payloads are
/// rejected (they need a transcoder — see the module docs). Cubemaps, texture
/// arrays and 3D textures are rejected for now.
#[napi(ts_return_type = "Promise<GpuTexture>")]
pub fn load_ktx2_texture(device: &GpuDevice, path: String, options: Option<Ktx2LoadOptions>) -> napi::Result<AsyncTask<LoadKtx2Task>> {
    let (label, usage) = match options {
        Some(o) => (o.label, o.usage.unwrap_or(DEFAULT_TEXTURE_USAGE)),
        None => (None, DEFAULT_TEXTURE_USAGE),
    };
    Ok(AsyncTask::new(LoadKtx2Task {
        device: Arc::clone(&device.inner),
        queue: Arc::clone(&device.queue_inner),
        path,
        usage,
        label,
    }))
}
