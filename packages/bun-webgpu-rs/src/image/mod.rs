//! Image file loaders that decode straight into wgpu textures.
//!
//! Design goals (per the binding's brief):
//! - **Pure Rust decoding.** Backed by the `image` crate — no C/C++ decoder in
//!   the path. This replaced SDL3_image, which was dropped after it was found to
//!   overflow its own surface on 16-bit grayscale PNG and corrupt the heap (see
//!   this package's `CLAUDE.md`). A decoder bug in safe Rust is a panic or an
//!   `Err`, not a smashed allocator.
//! - **File readers only.** A filesystem path in, a `GpuTexture` out. Byte-slice
//!   and stream entry points are deliberately not exposed.
//! - **No pixel bytes across the napi boundary.** The decoded image is uploaded
//!   directly into a `GpuTexture`; JS only ever sees the ready-to-bind handle,
//!   never a `Uint8Array` of pixels.
//! - **Strong enums, not magic numbers** — the sRGB/linear choice is an
//!   `ImageColorSpace` enum, matching the SDL binding's `#[napi] enum` style.
//! - **Async (libuv threadpool).** Decode + upload run off the JS thread via
//!   `AsyncTask`, so a large image doesn't block the frame loop. wgpu's
//!   `Device`/`Queue` are `Send + Sync` (already used off-thread for async
//!   pipeline creation), and each task owns its own decode buffers.

mod save;
pub use save::{read_texture_pixels, save_pixels_to_file, save_texture_to_file};

use crate::gpu::{GpuDevice, GpuTexture};
use napi::bindgen_prelude::AsyncTask;
use napi::{Env, Task};
use napi_derive::napi;
use std::sync::Arc;

/// `GpuTextureUsage.TEXTURE_BINDING | GpuTextureUsage.COPY_DST` — a sampleable
/// texture you can also re-upload to. The default for a loaded image.
const DEFAULT_TEXTURE_USAGE: u32 = 4 | 2;

/// How the decoded pixels are interpreted when the GPU samples them — the
/// sRGB/linear split every PBR pipeline needs (colour maps are sRGB, data maps
/// like normal/roughness are linear; see metis-engine's `texture.ts`).
///
/// **Ignored for floating-point source formats** (Radiance HDR): those carry
/// linear radiance by definition, so there is no sRGB transfer curve to undo and
/// no `-srgb` float texture format to request. See [`decode_image`].
#[napi]
pub enum ImageColorSpace {
    /// sRGB-encoded colour (albedo, emissive) — creates an `rgba8unorm-srgb`
    /// texture, so the hardware linearises on sample.
    Srgb,
    /// Raw linear data (normal, metallic, roughness, masks) — creates an
    /// `rgba8unorm` texture with no sRGB decode.
    Linear,
}

#[napi(object)]
pub struct ImageLoadOptions {
    /// Debug label applied to the created GPU texture.
    pub label: Option<String>,
    /// Colour space of the source pixels. Defaults to `Srgb`. Ignored for HDR.
    pub color_space: Option<ImageColorSpace>,
    /// `GpuTextureUsage` bitmask. Defaults to `TEXTURE_BINDING | COPY_DST`.
    pub usage: Option<u32>,
}

fn generic_err(msg: String) -> napi::Error {
    napi::Error::new(napi::Status::GenericFailure, msg)
}

struct ResolvedOptions {
    label: Option<String>,
    srgb: bool,
    usage: u32,
}

fn resolve_options(options: Option<ImageLoadOptions>) -> ResolvedOptions {
    let (label, color_space, usage) = match options {
        Some(o) => (o.label, o.color_space.unwrap_or(ImageColorSpace::Srgb), o.usage.unwrap_or(DEFAULT_TEXTURE_USAGE)),
        None => (None, ImageColorSpace::Srgb, DEFAULT_TEXTURE_USAGE),
    };
    ResolvedOptions { label, srgb: matches!(color_space, ImageColorSpace::Srgb), usage }
}

/// Build the napi `GpuTexture` handle from an already-uploaded wgpu texture.
/// Fields are `pub(crate)`, so this constructs one directly (all image textures
/// are single-mip, single-sample, 2D).
fn make_gpu_texture(inner: Arc<wgpu::Texture>, width: u32, height: u32, format: wgpu::TextureFormat, usage: u32) -> GpuTexture {
    GpuTexture {
        inner,
        width,
        height,
        depth_or_array_layers: 1,
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage,
    }
}

/// Decoded pixels plus the wgpu format they must be uploaded as.
struct DecodedImage {
    data: Vec<u8>,
    width: u32,
    height: u32,
    format: wgpu::TextureFormat,
    /// Bytes per pixel in `data` — 4 for RGBA8, 8 for RGBA16F.
    bytes_per_pixel: u32,
}

/// Decodes an image file into a GPU-uploadable buffer.
///
/// **The old "output is always RGBA8" invariant is gone**, because HDR breaks it:
/// Radiance `.hdr` carries linear radiance well outside `[0,1]`, and quantising
/// that to 8 bits would discard exactly the range the format exists to preserve.
/// The destination format is therefore chosen from the *source*:
///
/// - 8-bit sources (PNG/TGA/JPEG) -> `rgba8unorm` or `rgba8unorm-srgb`, honouring
///   `srgb`. 16-bit PNGs are down-converted to 8 bits keeping the high byte,
///   which is what the previous SDL_image path did too.
/// - Float sources (HDR) -> `rgba16float`, and `srgb` is **ignored**. Radiance is
///   linear by definition, there is no `-srgb` float format in WebGPU, and f16
///   holds HDR range at half the footprint of f32 (a 2K env map: 16 MB, not 32).
///   It also matches the `rgba16float` targets metis-engine's HDR chain already
///   renders into, so a loaded env map needs no conversion downstream.
///
/// The source format is **sniffed from the file's magic bytes**, with the
/// extension as fallback — so a mislabelled PNG, JPEG or HDR still loads.
/// **TGA is the exception**: it has no signature (the TGA 2.0
/// `TRUEVISION-XFILE` footer is optional and usually absent), so nothing can
/// identify it from content and a `.tga` file must actually be named `.tga`.
/// `tests/image-formats.test.ts` pins both halves of that.
fn decode_image(path: &str, srgb: bool) -> napi::Result<DecodedImage> {
    let reader = image::ImageReader::open(path)
        .map_err(|e| generic_err(format!("failed to open '{}': {}", path, e)))?
        .with_guessed_format()
        .map_err(|e| generic_err(format!("failed to read '{}': {}", path, e)))?;
    let source_format = reader.format();
    let decoded = reader
        .decode()
        .map_err(|e| generic_err(format!("failed to decode '{}': {}", path, e)))?;

    let (width, height) = (decoded.width(), decoded.height());
    if width == 0 || height == 0 {
        return Err(generic_err(format!("'{}' decoded to a zero-sized image", path)));
    }

    // Radiance HDR is the only float source enabled; everything else is 8-bit.
    if matches!(source_format, Some(image::ImageFormat::Hdr)) {
        let rgba = decoded.to_rgba32f();
        let mut data = Vec::with_capacity(rgba.as_raw().len() * 2);
        for &c in rgba.as_raw() {
            data.extend_from_slice(&half::f16::from_f32(c).to_le_bytes());
        }
        return Ok(DecodedImage { data, width, height, format: wgpu::TextureFormat::Rgba16Float, bytes_per_pixel: 8 });
    }

    let format = if srgb { wgpu::TextureFormat::Rgba8UnormSrgb } else { wgpu::TextureFormat::Rgba8Unorm };
    Ok(DecodedImage { data: decoded.to_rgba8().into_raw(), width, height, format, bytes_per_pixel: 4 })
}

/// Uploads decoded pixels into a fresh texture.
fn upload_texture(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    img: &DecodedImage,
    usage: u32,
    label: Option<&str>,
) -> Arc<wgpu::Texture> {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label,
        size: wgpu::Extent3d { width: img.width, height: img.height, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: img.format,
        usage: crate::gpu::convert::texture_usage(usage),
        view_formats: &[],
    });
    // Queue::write_texture stages a synchronous copy, so the decode buffer only
    // has to live across this call — it does, and no 256-byte row alignment is
    // required here (that constraint is only for buffer<->texture GPU copies).
    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture: &texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        &img.data,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(img.width * img.bytes_per_pixel),
            rows_per_image: Some(img.height),
        },
        wgpu::Extent3d { width: img.width, height: img.height, depth_or_array_layers: 1 },
    );
    // Flush the staged write. `write_texture` only *queues* the copy — it is
    // otherwise not executed until the caller's next submit, so a texture that
    // was loaded and then destroyed before any submit leaves a staged write
    // against freed memory, and the next unrelated submit fails validation with
    // "Texture has been destroyed". Submitting nothing here costs one empty
    // submit per load (these are not per-frame calls) and makes the returned
    // handle genuinely self-contained: usable, and safe to destroy, immediately.
    queue.submit(std::iter::empty());
    Arc::new(texture)
}

// ── loadImageTexture (async) ────────────────────────────────────────────────

pub(crate) struct LoadTextureTask {
    device: Arc<wgpu::Device>,
    queue: Arc<wgpu::Queue>,
    path: String,
    srgb: bool,
    usage: u32,
    label: Option<String>,
}

impl Task for LoadTextureTask {
    type Output = GpuTexture;
    type JsValue = GpuTexture;

    fn compute(&mut self) -> napi::Result<GpuTexture> {
        let img = decode_image(&self.path, self.srgb)?;
        let inner = upload_texture(&self.device, &self.queue, &img, self.usage, self.label.as_deref());
        Ok(make_gpu_texture(inner, img.width, img.height, img.format, self.usage))
    }

    fn resolve(&mut self, _env: Env, output: GpuTexture) -> napi::Result<GpuTexture> {
        Ok(output)
    }
}

/// Decode an image file (PNG, TGA, JPEG, Radiance HDR) straight into a
/// `GpuTexture` ready to bind, off the JS thread. The pixels never cross into JS.
///
/// Decoding is pure Rust (the `image` crate) — see the module docs for why
/// SDL3_image was dropped.
///
/// `path` is a filesystem path. The returned promise rejects with a decode error
/// string on failure. The resulting texture's `format` is `rgba8unorm(-srgb)`
/// for 8-bit sources and `rgba16float` for HDR — read it off the returned handle
/// rather than assuming.
#[allow(private_interfaces)]
#[napi(ts_return_type = "Promise<GpuTexture>")]
pub fn load_image_texture(device: &GpuDevice, path: String, options: Option<ImageLoadOptions>) -> napi::Result<AsyncTask<LoadTextureTask>> {
    let opts = resolve_options(options);
    Ok(AsyncTask::new(LoadTextureTask {
        device: Arc::clone(&device.inner),
        queue: Arc::clone(&device.queue_inner),
        path,
        srgb: opts.srgb,
        usage: opts.usage,
        label: opts.label,
    }))
}
