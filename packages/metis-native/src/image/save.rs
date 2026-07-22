//! Texture readback and image encoding — the write half of `image/`.
//!
//! This replaced a hand-rolled PNG encoder that lived in
//! `tests/helpers/screenshot.ts`: PNG-only, `rgba8unorm`-only, filter type 0, and
//! reached across package boundaries by five `metis-engine` files importing from
//! another package's *test* folder. Everything it did is native now, and the
//! things it couldn't do (BGRA surfaces, HDR output) come along for free.
//!
//! Three orthogonal entry points, so no caller pays for work it doesn't need:
//!
//! | want | call |
//! |---|---|
//! | pixels on disk | [`save_texture_to_file`] |
//! | pixels in JS (assertions) | [`read_texture_pixels`] |
//! | both | `read_texture_pixels` then [`save_pixels_to_file`] — one readback |
//!
//! Deliberately *not* a single `save + return pixels` call. That was the old
//! helper's shape and it forced every save-only caller to pay for a copy across
//! the napi boundary; splitting it keeps the common case free while still
//! letting a test do both from one GPU readback.

use super::generic_err;
use crate::gpu::{GpuDevice, GpuTexture};
use image::ImageEncoder;
use napi::bindgen_prelude::{AsyncTask, Uint8Array};
use napi::{Env, Task};
use napi_derive::napi;
use std::sync::Arc;

/// The parts of a `GpuTexture` a readback needs, detached from the napi handle
/// so it can move onto a worker thread.
struct TextureRef {
    inner: Arc<wgpu::Texture>,
    width: u32,
    height: u32,
    format: wgpu::TextureFormat,
    usage: u32,
}

impl TextureRef {
    fn of(t: &GpuTexture) -> Self {
        Self {
            inner: Arc::clone(&t.inner),
            width: t.width,
            height: t.height,
            format: t.format,
            usage: t.usage,
        }
    }
}

/// `GPUTextureUsage.COPY_SRC` — required on any texture being read back.
const USAGE_COPY_SRC: u32 = 1;

/// Image encodings this module can write, chosen from the output path's
/// extension. Kept as an explicit list so an unknown extension is a clear error
/// rather than a silently-wrong encoding.
#[derive(Clone, Copy, PartialEq)]
enum OutputFormat {
    Png,
    Jpeg,
    Tga,
    Hdr,
}

fn format_from_path(path: &str) -> napi::Result<OutputFormat> {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "png" => Ok(OutputFormat::Png),
        "jpg" | "jpeg" => Ok(OutputFormat::Jpeg),
        "tga" => Ok(OutputFormat::Tga),
        "hdr" => Ok(OutputFormat::Hdr),
        "" => Err(generic_err(format!("'{}' has no file extension — cannot pick an image encoding", path))),
        other => Err(generic_err(format!(
            "unsupported output extension '.{}' for '{}' — expected .png, .jpg/.jpeg, .tga or .hdr",
            other, path
        ))),
    }
}

/// How a texture's own format maps onto readback.
///
/// BGRA is the interesting case: it is what a surface/swapchain texture actually
/// is on most backends, and the old TS helper could not read it at all — which is
/// why `RenderContext` allocates a separate `rgba8unorm` capture texture just to
/// screenshot into. Swizzling two bytes per pixel here removes that constraint.
enum SourceKind {
    /// 8-bit RGBA already in the right channel order.
    Rgba8,
    /// 8-bit BGRA — needs R/B swapped on the way out.
    Bgra8,
    /// 16-bit float RGBA — HDR, only encodable as Radiance.
    Rgba16Float,
}

fn source_kind(format: wgpu::TextureFormat) -> napi::Result<SourceKind> {
    use wgpu::TextureFormat as F;
    match format {
        F::Rgba8Unorm | F::Rgba8UnormSrgb => Ok(SourceKind::Rgba8),
        F::Bgra8Unorm | F::Bgra8UnormSrgb => Ok(SourceKind::Bgra8),
        F::Rgba16Float => Ok(SourceKind::Rgba16Float),
        other => Err(generic_err(format!(
            "cannot read back texture format {:?} — supported: rgba8unorm(-srgb), bgra8unorm(-srgb), rgba16float",
            other
        ))),
    }
}

/// Bytes per pixel on the GPU side for a readable format.
fn bytes_per_pixel(kind: &SourceKind) -> u32 {
    match kind {
        SourceKind::Rgba8 | SourceKind::Bgra8 => 4,
        SourceKind::Rgba16Float => 8,
    }
}

/// Copies a texture to CPU memory and returns **tight** rows (GPU row padding
/// stripped) in the source's own byte layout, plus the kind that describes it.
///
/// Runs on an async worker, so blocking on `poll(Wait)` here is fine — it is a
/// worker thread, not the JS thread.
fn readback(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    texture: &TextureRef,
) -> napi::Result<(Vec<u8>, SourceKind)> {
    let kind = source_kind(texture.format)?;
    if texture.usage & USAGE_COPY_SRC == 0 {
        return Err(generic_err(
            "texture was not created with GPUTextureUsage.COPY_SRC, so it cannot be read back".to_string(),
        ));
    }
    let (width, height) = (texture.width, texture.height);
    if width == 0 || height == 0 {
        return Err(generic_err("texture has zero width or height".to_string()));
    }

    let bpp = bytes_per_pixel(&kind);
    let tight_row = (width * bpp) as usize;
    // copyTextureToBuffer requires bytesPerRow to be a multiple of 256.
    let padded_row = tight_row.div_ceil(256) * 256;

    let staging = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("metis-native/readback"),
        size: (padded_row * height as usize) as u64,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });

    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
        label: Some("metis-native/readback"),
    });
    encoder.copy_texture_to_buffer(
        wgpu::TexelCopyTextureInfo {
            texture: &texture.inner,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::TexelCopyBufferInfo {
            buffer: &staging,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(padded_row as u32),
                rows_per_image: Some(height),
            },
        },
        wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
    );
    queue.submit(Some(encoder.finish()));

    let slice = staging.slice(..);
    let (tx, rx) = std::sync::mpsc::channel();
    slice.map_async(wgpu::MapMode::Read, move |r| {
        let _ = tx.send(r);
    });
    // Blocking wait is correct here: this runs on a libuv worker thread.
    device.poll(wgpu::Maintain::Wait);
    rx.recv()
        .map_err(|_| generic_err("readback mapping was dropped before completing".to_string()))?
        .map_err(|e| generic_err(format!("failed to map readback buffer: {:?}", e)))?;

    let mapped = slice.get_mapped_range();
    let mut tight = vec![0u8; tight_row * height as usize];
    for y in 0..height as usize {
        let src = y * padded_row;
        tight[y * tight_row..(y + 1) * tight_row].copy_from_slice(&mapped[src..src + tight_row]);
    }
    drop(mapped);
    staging.unmap();
    staging.destroy();

    Ok((tight, kind))
}

/// Normalises readback bytes to straight RGBA8, swizzling BGRA if needed.
///
/// Errors for float sources: an f16 buffer reinterpreted as RGBA8 would be
/// silently meaningless, and the "byte-vs-value reinterpretation" trap has
/// already cost this repo a debugging session once (see the MSM history in
/// metis-engine's `CLAUDE.md`).
fn to_rgba8(mut data: Vec<u8>, kind: &SourceKind) -> napi::Result<Vec<u8>> {
    match kind {
        SourceKind::Rgba8 => Ok(data),
        SourceKind::Bgra8 => {
            for px in data.chunks_exact_mut(4) {
                px.swap(0, 2);
            }
            Ok(data)
        }
        SourceKind::Rgba16Float => Err(generic_err(
            "texture is rgba16float — read it back as HDR with saveTextureToFile('*.hdr'); \
             8-bit pixel readback would reinterpret float bytes as colour"
                .to_string(),
        )),
    }
}

/// Encodes tight pixel data and writes it to `path`.
///
/// `Rgba16Float` sources may only be written as Radiance `.hdr`, and 8-bit
/// sources may not be written as `.hdr` — mixing them would either clip the
/// range HDR exists to preserve or invent one that was never captured.
fn encode_to_file(data: Vec<u8>, kind: &SourceKind, width: u32, height: u32, path: &str) -> napi::Result<()> {
    let out_format = format_from_path(path)?;
    if let Some(parent) = std::path::Path::new(path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| generic_err(format!("failed to create directory for '{}': {}", path, e)))?;
        }
    }

    if matches!(kind, SourceKind::Rgba16Float) {
        if out_format != OutputFormat::Hdr {
            return Err(generic_err(format!(
                "source is an rgba16float texture — it can only be written as .hdr, not '{}'",
                path
            )));
        }
        // f16 -> f32 for the Radiance encoder.
        let mut rgb: Vec<image::Rgb<f32>> = Vec::with_capacity((width * height) as usize);
        for texel in data.chunks_exact(8) {
            let mut c = [0f32; 3];
            for (i, ch) in c.iter_mut().enumerate() {
                *ch = half::f16::from_bits(u16::from_le_bytes([texel[i * 2], texel[i * 2 + 1]])).to_f32();
            }
            rgb.push(image::Rgb(c));
        }
        if rgb.len() != (width as usize) * (height as usize) {
            return Err(generic_err("HDR buffer size did not match the texture dimensions".to_string()));
        }
        let file = std::fs::File::create(path)
            .map_err(|e| generic_err(format!("failed to create '{}': {}", path, e)))?;
        return image::codecs::hdr::HdrEncoder::new(std::io::BufWriter::new(file))
            .encode(&rgb, width as usize, height as usize)
            .map_err(|e| generic_err(format!("failed to encode '{}': {}", path, e)));
    }

    if out_format == OutputFormat::Hdr {
        return Err(generic_err(format!(
            "'{}' asks for HDR output, but the source is 8-bit — there is no high-dynamic-range data to write",
            path
        )));
    }

    let rgba = to_rgba8(data, kind)?;
    let buf = image::RgbaImage::from_raw(width, height, rgba)
        .ok_or_else(|| generic_err("pixel buffer size did not match the given dimensions".to_string()))?;
    let file = std::fs::File::create(path)
        .map_err(|e| generic_err(format!("failed to create '{}': {}", path, e)))?;
    let mut w = std::io::BufWriter::new(file);
    match out_format {
        OutputFormat::Png => image::codecs::png::PngEncoder::new(&mut w)
            .write_image(buf.as_raw(), width, height, image::ExtendedColorType::Rgba8)
            .map_err(|e| generic_err(format!("failed to encode '{}': {}", path, e))),
        // JPEG has no alpha channel; drop it rather than failing.
        OutputFormat::Jpeg => {
            let rgb = image::DynamicImage::ImageRgba8(buf).to_rgb8();
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut w, 92)
                .write_image(rgb.as_raw(), width, height, image::ExtendedColorType::Rgb8)
                .map_err(|e| generic_err(format!("failed to encode '{}': {}", path, e)))
        }
        OutputFormat::Tga => image::codecs::tga::TgaEncoder::new(&mut w)
            .write_image(buf.as_raw(), width, height, image::ExtendedColorType::Rgba8)
            .map_err(|e| generic_err(format!("failed to encode '{}': {}", path, e))),
        OutputFormat::Hdr => unreachable!("handled above"),
    }
}

// ── saveTextureToFile (async) ───────────────────────────────────────────────

pub(crate) struct SaveTextureTask {
    device: Arc<wgpu::Device>,
    queue: Arc<wgpu::Queue>,
    texture: TextureRef,
    path: String,
}

impl Task for SaveTextureTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> napi::Result<()> {
        let (data, kind) = readback(&self.device, &self.queue, &self.texture)?;
        encode_to_file(data, &kind, self.texture.width, self.texture.height, &self.path)
    }

    fn resolve(&mut self, _env: Env, _output: ()) -> napi::Result<()> {
        Ok(())
    }
}

/// Read a texture back and write it to `path`, off the JS thread. The encoding
/// is chosen from the extension: `.png`, `.jpg`/`.jpeg`, `.tga`, `.hdr`.
/// Parent directories are created as needed.
///
/// The texture must have been created with `GPUTextureUsage.COPY_SRC`.
/// `rgba8unorm(-srgb)` and `bgra8unorm(-srgb)` are both supported (BGRA is
/// swizzled), so a surface-format texture can be saved directly.
/// `rgba16float` may only be written as `.hdr`.
#[allow(private_interfaces)]
#[napi(ts_return_type = "Promise<void>")]
pub fn save_texture_to_file(device: &GpuDevice, texture: &GpuTexture, path: String) -> napi::Result<AsyncTask<SaveTextureTask>> {
    Ok(AsyncTask::new(SaveTextureTask {
        device: Arc::clone(&device.inner),
        queue: Arc::clone(&device.queue_inner),
        texture: TextureRef::of(texture),
        path,
    }))
}

// ── readTexturePixels (async) ───────────────────────────────────────────────

pub(crate) struct ReadPixelsTask {
    device: Arc<wgpu::Device>,
    queue: Arc<wgpu::Queue>,
    texture: TextureRef,
}

impl Task for ReadPixelsTask {
    type Output = Vec<u8>;
    type JsValue = Uint8Array;

    fn compute(&mut self) -> napi::Result<Vec<u8>> {
        let (data, kind) = readback(&self.device, &self.queue, &self.texture)?;
        to_rgba8(data, &kind)
    }

    fn resolve(&mut self, _env: Env, output: Vec<u8>) -> napi::Result<Uint8Array> {
        Ok(output.into())
    }
}

/// Read a texture back as **tight RGBA8 bytes** (GPU row padding stripped),
/// off the JS thread — for asserting on pixels without writing a file.
///
/// The texture must have `GPUTextureUsage.COPY_SRC`. BGRA sources are swizzled
/// to RGBA. `rgba16float` is rejected: reinterpreting f16 bytes as 8-bit colour
/// is silently meaningless, so save it as `.hdr` instead.
#[allow(private_interfaces)]
#[napi(ts_return_type = "Promise<Uint8Array>")]
pub fn read_texture_pixels(device: &GpuDevice, texture: &GpuTexture) -> napi::Result<AsyncTask<ReadPixelsTask>> {
    Ok(AsyncTask::new(ReadPixelsTask {
        device: Arc::clone(&device.inner),
        queue: Arc::clone(&device.queue_inner),
        texture: TextureRef::of(texture),
    }))
}

// ── savePixelsToFile (async) ────────────────────────────────────────────────

pub(crate) struct SavePixelsTask {
    pixels: Vec<u8>,
    width: u32,
    height: u32,
    path: String,
}

impl Task for SavePixelsTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> napi::Result<()> {
        let expected = (self.width as usize) * (self.height as usize) * 4;
        if self.pixels.len() != expected {
            return Err(generic_err(format!(
                "expected {} bytes for {}x{} RGBA8, got {}",
                expected,
                self.width,
                self.height,
                self.pixels.len()
            )));
        }
        encode_to_file(std::mem::take(&mut self.pixels), &SourceKind::Rgba8, self.width, self.height, &self.path)
    }

    fn resolve(&mut self, _env: Env, _output: ()) -> napi::Result<()> {
        Ok(())
    }
}

/// Encode tight **RGBA8** bytes and write them to `path`, off the JS thread.
/// Encoding is chosen from the extension (`.hdr` is rejected — 8-bit input
/// carries no high-dynamic-range data). Parent directories are created as needed.
///
/// Pair with [`read_texture_pixels`] when a caller wants both the pixels and a
/// file from a single GPU readback.
#[allow(private_interfaces)]
#[napi(ts_return_type = "Promise<void>")]
pub fn save_pixels_to_file(pixels: Uint8Array, width: u32, height: u32, path: String) -> napi::Result<AsyncTask<SavePixelsTask>> {
    Ok(AsyncTask::new(SavePixelsTask {
        pixels: pixels.to_vec(),
        width,
        height,
        path,
    }))
}
