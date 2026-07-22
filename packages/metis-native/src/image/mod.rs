//! Image file loaders that decode straight into wgpu textures, plus the
//! readback/encode half in [`save`].
//!
//! ## Two loaders, deliberately not one
//!
//! There are two entry points and they are kept in separate modules on purpose:
//!
//! | module | entry point | source | output |
//! |---|---|---|---|
//! | [`uncompressed`] | `loadImageTexture` | PNG/JPEG/TGA/HDR | `rgba8unorm(-srgb)` / `rgba16float`, 1 mip |
//! | [`compressed`] | `loadKtx2Texture` | KTX2 | BC1–BC7 blocks, full mip chain |
//!
//! They look similar from JS and are almost entirely different underneath. The
//! uncompressed path *decodes* (CPU work, the `image` crate) into a linear
//! array of pixels and uploads one mip. The compressed path *parses a
//! container* (no decode at all — the blocks go to the GPU as-is), uploads a
//! whole mip pyramid, and computes row strides in **blocks** rather than
//! pixels. Merging them would mean one function where every line is guarded by
//! "is this the block case or the pixel case", which is exactly the confusion
//! this split avoids.
//!
//! What they genuinely share lives here in the parent module: the napi handle
//! construction ([`make_gpu_texture`]), the error helper, and the default usage
//! flags. Nothing else — in particular, **the block-alignment and
//! `bytes_per_row`-in-blocks rules are confined to [`compressed`]** and cannot
//! affect the uncompressed path.
//!
//! ## Shared design goals (both loaders)
//!
//! - **Pure Rust, no C in the decode path.** The `image` crate for pixels,
//!   `ktx2` + `ruzstd` for containers. This is a hard rule: SDL3_image was
//!   dropped after it overflowed its own surface on a 16-bit grayscale PNG and
//!   corrupted the heap (see this package's `CLAUDE.md`). A bug in safe Rust is
//!   a panic or an `Err`, not a smashed allocator. It is also why the KTX2 path
//!   takes *pre-compressed blocks only* and has no Basis Universal transcoder:
//!   the mature transcoder is C++ bindings.
//! - **File readers only.** A filesystem path in, a `GpuTexture` out.
//!   Byte-slice and stream entry points are deliberately not exposed.
//! - **No pixel bytes across the napi boundary.** JS only ever sees the
//!   ready-to-bind handle.
//! - **Async (libuv threadpool).** Parse/decode + upload run off the JS thread
//!   via `AsyncTask`, so a large texture doesn't block the frame loop.
//! - **Errors reject the promise; they never panic.** A panic across the napi
//!   boundary aborts the process rather than throwing something JS can catch,
//!   so every fallible step returns `napi::Result`.

mod compressed;
mod save;
mod uncompressed;

pub use compressed::{Ktx2LoadOptions, load_ktx2_texture};
pub use save::{read_texture_pixels, save_pixels_to_file, save_texture_to_file};
pub use uncompressed::{ImageColorSpace, ImageLoadOptions, load_image_texture};

use crate::gpu::GpuTexture;
use std::sync::Arc;

/// `GpuTextureUsage.TEXTURE_BINDING | GpuTextureUsage.COPY_DST` — a sampleable
/// texture you can also re-upload to. The default for a loaded image.
pub(crate) const DEFAULT_TEXTURE_USAGE: u32 = 4 | 2;

pub(crate) fn generic_err(msg: String) -> napi::Error {
    napi::Error::new(napi::Status::GenericFailure, msg)
}

/// Build the napi `GpuTexture` handle from an already-uploaded wgpu texture.
///
/// `GpuTexture`'s fields are `pub(crate)`, so this constructs one directly.
/// Both loaders produce 2D, single-sample, single-layer textures; they differ
/// only in `mip_level_count` (always 1 for [`uncompressed`], the file's mip
/// count for [`compressed`]), which is why that one is a parameter.
pub(crate) fn make_gpu_texture(
    inner: Arc<wgpu::Texture>,
    width: u32,
    height: u32,
    mip_level_count: u32,
    format: wgpu::TextureFormat,
    usage: u32,
) -> GpuTexture {
    GpuTexture {
        inner,
        width,
        height,
        depth_or_array_layers: 1,
        mip_level_count,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage,
    }
}
