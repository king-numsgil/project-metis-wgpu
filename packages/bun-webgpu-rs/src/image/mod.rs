//! SDL3_image file loaders that decode straight into wgpu textures.
//!
//! Design goals (per the binding's brief):
//! - **File readers only.** SDL_image's `*_IO` / `SDL_IOStream` and
//!   `SDL_Renderer`-based (`IMG_LoadTexture*`) entry points are deliberately
//!   *not* exposed — only `IMG_Load` / `IMG_LoadAnimation`, which read a path.
//! - **No pixel bytes across the napi boundary.** The decoded surface is
//!   converted to RGBA8 and uploaded directly into a `GpuTexture`; JS only ever
//!   sees the ready-to-bind handle, never a `Uint8Array` of pixels.
//! - **Strong enums, not magic numbers** — the sRGB/linear choice is an
//!   `ImageColorSpace` enum, matching the SDL binding's `#[napi] enum` style.
//! - **Async (libuv threadpool).** Decode + upload run off the JS thread via
//!   `AsyncTask`, so a large image doesn't block the frame loop. This is safe:
//!   SDL3_image has no init (no `IMG_Init` in 3.x, so no init-thread coupling),
//!   `IMG_Load` carries no main-thread requirement (unlike SDL video/renderer),
//!   SDL3's pixel formats are const (the old cross-thread format-list race is
//!   gone), and each call owns its own surface — never shared across threads.
//!   `SDL_GetError` is thread-local, so errors are read inside the worker task.
//!   wgpu's `Device`/`Queue` are `Send + Sync` (already used off-thread for
//!   async pipeline creation).

use crate::gpu::{GpuDevice, GpuTexture};
use napi::bindgen_prelude::AsyncTask;
use napi::{Env, Task};
use napi_derive::napi;
use sdl3_image_sys::image::{IMG_FreeAnimation, IMG_Load, IMG_LoadAnimation};
use sdl3_sys::error::SDL_GetError;
use sdl3_sys::pixels::SDL_PIXELFORMAT_RGBA32;
use sdl3_sys::surface::{SDL_ConvertSurface, SDL_DestroySurface, SDL_Surface};
use std::ffi::{CStr, CString};
use std::sync::Arc;

/// `GpuTextureUsage.TEXTURE_BINDING | GpuTextureUsage.COPY_DST` — a sampleable
/// texture you can also re-upload to. The default for a loaded image.
const DEFAULT_TEXTURE_USAGE: u32 = 4 | 2;

/// How the decoded pixels are interpreted when the GPU samples them — the
/// sRGB/linear split every PBR pipeline needs (colour maps are sRGB, data maps
/// like normal/roughness are linear; see metis-engine's `texture.ts`).
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
pub struct SdlImageLoadOptions {
    /// Debug label applied to the created GPU texture(s).
    pub label: Option<String>,
    /// Colour space of the source pixels. Defaults to `Srgb`.
    pub color_space: Option<ImageColorSpace>,
    /// `GpuTextureUsage` bitmask. Defaults to `TEXTURE_BINDING | COPY_DST`.
    pub usage: Option<u32>,
}

fn sdl_error() -> String {
    unsafe { CStr::from_ptr(SDL_GetError()).to_string_lossy().into_owned() }
}

fn generic_err(msg: String) -> napi::Error {
    napi::Error::new(napi::Status::GenericFailure, msg)
}

struct ResolvedOptions {
    label: Option<String>,
    format: wgpu::TextureFormat,
    usage: u32,
}

fn resolve_options(options: Option<SdlImageLoadOptions>) -> ResolvedOptions {
    let (label, color_space, usage) = match options {
        Some(o) => (o.label, o.color_space.unwrap_or(ImageColorSpace::Srgb), o.usage.unwrap_or(DEFAULT_TEXTURE_USAGE)),
        None => (None, ImageColorSpace::Srgb, DEFAULT_TEXTURE_USAGE),
    };
    let format = match color_space {
        ImageColorSpace::Srgb => wgpu::TextureFormat::Rgba8UnormSrgb,
        ImageColorSpace::Linear => wgpu::TextureFormat::Rgba8Unorm,
    };
    ResolvedOptions { label, format, usage }
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

/// Convert an SDL surface to RGBA8, create a wgpu texture, and upload the pixels.
/// Runs on the async worker thread. Does **not** free `surf` — the caller owns
/// it (a single load frees the raw surface afterward; an animation frees the
/// whole `IMG_Animation`).
fn surface_to_texture(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    surf: *mut SDL_Surface,
    format: wgpu::TextureFormat,
    usage: u32,
    label: Option<&str>,
) -> napi::Result<(Arc<wgpu::Texture>, u32, u32)> {
    // Normalise to RGBA-in-memory byte order (endianness-independent), which is
    // exactly what wgpu's rgba8unorm(-srgb) expects. Always converts (even if
    // already RGBA32) so the layout is guaranteed.
    let converted = unsafe { SDL_ConvertSurface(surf, SDL_PIXELFORMAT_RGBA32) };
    if converted.is_null() {
        return Err(generic_err(format!("SDL_ConvertSurface failed: {}", sdl_error())));
    }

    // A converted surface is plain CPU memory (no SDL_LockSurface needed). Copy
    // the rows out into an owned Vec, then free the surface immediately.
    let s = unsafe { &*converted };
    let width = s.w as u32;
    let height = s.h as u32;
    let pitch = s.pitch as usize;
    if width == 0 || height == 0 || s.pixels.is_null() {
        unsafe { SDL_DestroySurface(converted) };
        return Err(generic_err("decoded image has no pixel data".to_string()));
    }
    let data = unsafe { std::slice::from_raw_parts(s.pixels as *const u8, pitch * height as usize) }.to_vec();
    unsafe { SDL_DestroySurface(converted) };

    let desc = wgpu::TextureDescriptor {
        label,
        size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: crate::gpu::convert::texture_usage(usage),
        view_formats: &[],
    };
    let texture = device.create_texture(&desc);
    // Queue::write_texture stages a synchronous copy, so `data` (owned) only has
    // to live across this call — it does, and no 256-byte row alignment is
    // required here (that constraint is only for buffer<->texture GPU copies).
    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture: &texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        &data,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(pitch as u32),
            rows_per_image: Some(height),
        },
        wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
    );
    Ok((Arc::new(texture), width, height))
}

// ── sdlImageLoadTexture (async) ─────────────────────────────────────────────

pub(crate) struct LoadTextureTask {
    device: Arc<wgpu::Device>,
    queue: Arc<wgpu::Queue>,
    path: String,
    format: wgpu::TextureFormat,
    usage: u32,
    label: Option<String>,
}

impl Task for LoadTextureTask {
    type Output = GpuTexture;
    type JsValue = GpuTexture;

    fn compute(&mut self) -> napi::Result<GpuTexture> {
        let c_path = CString::new(self.path.as_str()).map_err(|_| napi::Error::new(napi::Status::InvalidArg, "path contains a NUL byte".to_string()))?;
        let raw = unsafe { IMG_Load(c_path.as_ptr()) };
        if raw.is_null() {
            return Err(generic_err(format!("IMG_Load failed for '{}': {}", self.path, sdl_error())));
        }
        let result = surface_to_texture(&self.device, &self.queue, raw, self.format, self.usage, self.label.as_deref());
        unsafe { SDL_DestroySurface(raw) };
        let (inner, width, height) = result?;
        Ok(make_gpu_texture(inner, width, height, self.format, self.usage))
    }

    fn resolve(&mut self, _env: Env, output: GpuTexture) -> napi::Result<GpuTexture> {
        Ok(output)
    }
}

/// Decode an image file (PNG, JPG, WebP, … — whatever SDL_image was built with)
/// straight into a `GpuTexture` ready to bind, off the JS thread. The pixels
/// never cross into JS.
///
/// `path` is a filesystem path; the `_IO`/stream variants are intentionally not
/// exposed. The returned promise rejects with the SDL error string on failure.
#[allow(private_interfaces)]
#[napi(ts_return_type = "Promise<GpuTexture>")]
pub fn sdl_image_load_texture(device: &GpuDevice, path: String, options: Option<SdlImageLoadOptions>) -> napi::Result<AsyncTask<LoadTextureTask>> {
    let opts = resolve_options(options);
    Ok(AsyncTask::new(LoadTextureTask {
        device: Arc::clone(&device.inner),
        queue: Arc::clone(&device.queue_inner),
        path,
        format: opts.format,
        usage: opts.usage,
        label: opts.label,
    }))
}

// ── sdlImageLoadAnimation (async) ───────────────────────────────────────────

/// An animated image (GIF/WEBP/APNG/…) loaded from a file: every frame is
/// uploaded to its own GPU texture up front, and `frame(i)` hands them out
/// ready to bind. Frame delays are exposed in milliseconds.
#[napi]
pub struct SdlImageAnimation {
    width: u32,
    height: u32,
    frames: Vec<Arc<wgpu::Texture>>,
    delays_ms: Vec<u32>,
    format: wgpu::TextureFormat,
    usage: u32,
}

#[napi]
impl SdlImageAnimation {
    /// Number of frames.
    #[napi(getter)]
    pub fn frame_count(&self) -> u32 {
        self.frames.len() as u32
    }

    /// Frame width in pixels (shared by every frame).
    #[napi(getter)]
    pub fn width(&self) -> u32 {
        self.width
    }

    /// Frame height in pixels (shared by every frame).
    #[napi(getter)]
    pub fn height(&self) -> u32 {
        self.height
    }

    /// This frame's display duration, in milliseconds.
    #[napi]
    pub fn delay_ms(&self, index: u32) -> napi::Result<u32> {
        self.delays_ms
            .get(index as usize)
            .copied()
            .ok_or_else(|| generic_err(format!("frame index {index} out of range (frameCount {})", self.frames.len())))
    }

    /// A `GpuTexture` handle for frame `index`, ready to bind. Cheap: shares the
    /// already-uploaded GPU texture (no re-upload, no copy).
    #[napi]
    pub fn frame(&self, index: u32) -> napi::Result<GpuTexture> {
        let inner = self
            .frames
            .get(index as usize)
            .ok_or_else(|| generic_err(format!("frame index {index} out of range (frameCount {})", self.frames.len())))?;
        Ok(make_gpu_texture(Arc::clone(inner), self.width, self.height, self.format, self.usage))
    }
}

pub(crate) struct LoadAnimationTask {
    device: Arc<wgpu::Device>,
    queue: Arc<wgpu::Queue>,
    path: String,
    format: wgpu::TextureFormat,
    usage: u32,
    label: Option<String>,
}

impl Task for LoadAnimationTask {
    type Output = SdlImageAnimation;
    type JsValue = SdlImageAnimation;

    fn compute(&mut self) -> napi::Result<SdlImageAnimation> {
        let c_path = CString::new(self.path.as_str()).map_err(|_| napi::Error::new(napi::Status::InvalidArg, "path contains a NUL byte".to_string()))?;
        let anim = unsafe { IMG_LoadAnimation(c_path.as_ptr()) };
        if anim.is_null() {
            return Err(generic_err(format!("IMG_LoadAnimation failed for '{}': {}", self.path, sdl_error())));
        }

        let a = unsafe { &*anim };
        let width = a.w.max(0) as u32;
        let height = a.h.max(0) as u32;
        let count = a.count.max(0) as usize;

        let mut frames: Vec<Arc<wgpu::Texture>> = Vec::with_capacity(count);
        let mut delays_ms: Vec<u32> = Vec::with_capacity(count);
        let mut load_err: Option<napi::Error> = None;

        for i in 0..count {
            // SAFETY: `frames`/`delays` are `count`-long arrays owned by `anim`.
            let surf = unsafe { *a.frames.add(i) };
            let delay = unsafe { *a.delays.add(i) };
            delays_ms.push(delay.max(0) as u32);
            if surf.is_null() {
                load_err = Some(generic_err(format!("animation '{}' frame {i} is null", self.path)));
                break;
            }
            match surface_to_texture(&self.device, &self.queue, surf, self.format, self.usage, self.label.as_deref()) {
                Ok((tex, _, _)) => frames.push(tex),
                Err(e) => {
                    load_err = Some(e);
                    break;
                }
            }
        }

        // Frees the IMG_Animation and all its frame surfaces; our textures
        // already own their pixels on the GPU.
        unsafe { IMG_FreeAnimation(anim) };

        if let Some(e) = load_err {
            return Err(e);
        }
        Ok(SdlImageAnimation { width, height, frames, delays_ms, format: self.format, usage: self.usage })
    }

    fn resolve(&mut self, _env: Env, output: SdlImageAnimation) -> napi::Result<SdlImageAnimation> {
        Ok(output)
    }
}

/// Decode an animated image file into per-frame `GpuTexture`s, off the JS
/// thread. Resolves to an `SdlImageAnimation` whose `frame(i)`/`delayMs(i)`
/// expose ready-to-bind handles + timing. File reader only (no `_IO` variant).
#[allow(private_interfaces)]
#[napi(ts_return_type = "Promise<SdlImageAnimation>")]
pub fn sdl_image_load_animation(device: &GpuDevice, path: String, options: Option<SdlImageLoadOptions>) -> napi::Result<AsyncTask<LoadAnimationTask>> {
    let opts = resolve_options(options);
    Ok(AsyncTask::new(LoadAnimationTask {
        device: Arc::clone(&device.inner),
        queue: Arc::clone(&device.queue_inner),
        path,
        format: opts.format,
        usage: opts.usage,
        label: opts.label,
    }))
}
