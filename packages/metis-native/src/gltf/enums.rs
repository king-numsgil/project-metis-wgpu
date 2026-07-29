//! Every closed set of values the importer reports, as a real `#[napi] enum`.
//!
//! **This file exists because of a rule: a closed set is an enum, not a
//! string.** glTF is full of small integer or string enumerations —
//! `componentType`, `alphaMode`, animation `interpolation`, sampler wrap modes,
//! light `type`, primitive `mode` — and the tempting thing in a napi binding is
//! to pass them straight through as `u32` or `String`. Doing that pushes the
//! spec's magic numbers into TypeScript, where nothing checks them and
//! `mode === 4` is a comment away from meaningless.
//!
//! The one deliberate exception is **`GPUVertexFormat` / `GPUIndexFormat`**,
//! which stay as the WebGPU string unions declared in `dts-header.ts`. They are
//! not glTF concepts: they are the exact values the caller hands to
//! `createRenderPipeline`, and translating them into a private enum would mean
//! translating them back at every call site. Those unions are closed and typed,
//! so nothing is lost.

use napi_derive::napi;

/// What a resource listed in a `GltfManifest` actually is. The two kinds live in
/// separate index spaces — a `Buffer` index indexes `buffers`, an `Image` index
/// indexes `images` — which is why an override has to name both.
#[napi]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GltfResourceKind {
    /// A `buffers[i]` entry: raw binary backing accessors and buffer views.
    Buffer,
    /// An `images[i]` entry: the encoded bytes of a texture.
    Image,
}

/// Where a resource's bytes come from, which is what decides whether an
/// override can usefully redirect it.
#[napi]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GltfResourceSource {
    /// A relative or absolute URI resolved against the base directory — the
    /// sidecar case, and the only one with a `resolvedPath`.
    External,
    /// An RFC 2397 `data:` URI embedded in the JSON.
    DataUri,
    /// The GLB binary chunk (a `buffers[0]` with no `uri`, or an image whose
    /// `bufferView` points into it).
    BinaryChunk,
    /// An image stored in a `bufferView` of some other buffer.
    BufferView,
}

/// The container an image's bytes are in. Decides which loader handles it:
/// `Ktx2` goes to the block-compressed path (`KHR_texture_basisu`), everything
/// else to the pixel decoder.
#[napi]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GltfImageEncoding {
    Png,
    Jpeg,
    /// `EXT_texture_webp`, or a plain `image/webp` source.
    WebP,
    /// `KHR_texture_basisu`. Must carry pre-compressed BC blocks — see
    /// `image/compressed.rs` for why there is no Basis transcoder.
    Ktx2,
    /// Radiance HDR. Not a core glTF image type, but this loader decodes it, so
    /// it is reported rather than refused.
    Hdr,
    /// No `mimeType` and no recognised signature. Still attempted — the decoder
    /// sniffs magic bytes of its own.
    Unknown,
}

/// A glTF vertex attribute's meaning. The `_n` suffixed sets are the ones glTF
/// allows more than one of; `Custom` covers application-specific `_UNDERSCORE`
/// attributes, whose exact spelling is on `GltfVertexAttribute.name`.
///
/// Sets above the ones named here (`TEXCOORD_4`, say) are reported as `Custom`
/// with the real name and `set` filled in, so nothing is silently dropped.
#[napi]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GltfAttributeSemantic {
    Position,
    Normal,
    Tangent,
    TexCoord,
    Color,
    Joints,
    Weights,
    /// An application-specific `_FOO` attribute, or a set index beyond the ones
    /// this importer canonicalises.
    Custom,
}

/// glTF `mesh.primitive.mode`, faithfully. Note two of these have **no WebGPU
/// equivalent** (`LineLoop`, `TriangleFan`); see `GltfPrimitive.gpuTopology`.
#[napi]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GltfPrimitiveMode {
    Points,
    Lines,
    LineLoop,
    LineStrip,
    Triangles,
    TriangleStrip,
    TriangleFan,
}

/// Index buffer element width. glTF also permits `UNSIGNED_BYTE`; WebGPU does
/// not, so byte indices are widened to `Uint16` during import.
#[napi]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GltfIndexFormat {
    Uint16,
    Uint32,
}

/// glTF `material.alphaMode`.
#[napi]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GltfAlphaMode {
    Opaque,
    Mask,
    Blend,
}

/// glTF `animation.sampler.interpolation`.
///
/// `CubicSpline` is the one that changes the *shape* of the output data: each
/// keyframe carries three values (in-tangent, value, out-tangent) rather than
/// one, so `GltfAnimationSampler.output` is three times as long. That is
/// reported explicitly on the sampler rather than left to be inferred.
#[napi]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GltfInterpolation {
    Linear,
    Step,
    CubicSpline,
}

/// What an animation channel drives on its target node.
#[napi]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GltfAnimationPath {
    Translation,
    Rotation,
    Scale,
    /// Morph target weights.
    MorphTargetWeights,
}

/// glTF `camera.type`.
#[napi]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GltfCameraKind {
    Perspective,
    Orthographic,
}

/// `KHR_lights_punctual` light type.
#[napi]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GltfLightKind {
    Directional,
    Point,
    Spot,
}

/// glTF sampler `wrapS`/`wrapT`. Maps 1:1 onto `GPUAddressMode`, which is what
/// the created `GpuSampler` is configured with.
#[napi]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GltfWrapMode {
    ClampToEdge,
    MirroredRepeat,
    Repeat,
}

/// glTF sampler `magFilter`.
#[napi]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GltfMagFilter {
    Nearest,
    Linear,
}

/// glTF sampler `minFilter`. The four mipmap modes collapse to a
/// (`minFilter`, `mipmapFilter`) pair on the created `GpuSampler`.
#[napi]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GltfMinFilter {
    Nearest,
    Linear,
    NearestMipmapNearest,
    LinearMipmapNearest,
    NearestMipmapLinear,
    LinearMipmapLinear,
}

/// glTF `accessor.componentType`, reported so a caller can tell what the source
/// asset actually stored before this importer canonicalised it.
#[napi]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GltfComponentType {
    I8,
    U8,
    I16,
    U16,
    U32,
    F32,
}

impl GltfComponentType {
    /// Size of one component in bytes.
    pub(crate) fn size(self) -> usize {
        match self {
            GltfComponentType::I8 | GltfComponentType::U8 => 1,
            GltfComponentType::I16 | GltfComponentType::U16 => 2,
            GltfComponentType::U32 | GltfComponentType::F32 => 4,
        }
    }

    pub(crate) fn from_gltf(t: gltf::accessor::DataType) -> Self {
        use gltf::accessor::DataType;
        match t {
            DataType::I8 => GltfComponentType::I8,
            DataType::U8 => GltfComponentType::U8,
            DataType::I16 => GltfComponentType::I16,
            DataType::U16 => GltfComponentType::U16,
            DataType::U32 => GltfComponentType::U32,
            DataType::F32 => GltfComponentType::F32,
        }
    }
}

/// glTF `accessor.type` — how many components make one element.
#[napi]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GltfAccessorType {
    Scalar,
    Vec2,
    Vec3,
    Vec4,
    Mat2,
    Mat3,
    Mat4,
}

impl GltfAccessorType {
    /// Number of components in one element.
    pub(crate) fn components(self) -> usize {
        match self {
            GltfAccessorType::Scalar => 1,
            GltfAccessorType::Vec2 => 2,
            GltfAccessorType::Vec3 => 3,
            GltfAccessorType::Vec4 => 4,
            GltfAccessorType::Mat2 => 4,
            GltfAccessorType::Mat3 => 9,
            GltfAccessorType::Mat4 => 16,
        }
    }

    pub(crate) fn from_gltf(d: gltf::accessor::Dimensions) -> Self {
        use gltf::accessor::Dimensions;
        match d {
            Dimensions::Scalar => GltfAccessorType::Scalar,
            Dimensions::Vec2 => GltfAccessorType::Vec2,
            Dimensions::Vec3 => GltfAccessorType::Vec3,
            Dimensions::Vec4 => GltfAccessorType::Vec4,
            Dimensions::Mat2 => GltfAccessorType::Mat2,
            Dimensions::Mat3 => GltfAccessorType::Mat3,
            Dimensions::Mat4 => GltfAccessorType::Mat4,
        }
    }
}
