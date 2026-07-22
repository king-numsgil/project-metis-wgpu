use super::error::invalid_enum;
use wgpu;

// ── Texture format ────────────────────────────────────────────────────────────

pub fn texture_format(s: &str) -> napi::Result<wgpu::TextureFormat> {
    Ok(match s {
        "r8unorm" => wgpu::TextureFormat::R8Unorm,
        "r8snorm" => wgpu::TextureFormat::R8Snorm,
        "r8uint" => wgpu::TextureFormat::R8Uint,
        "r8sint" => wgpu::TextureFormat::R8Sint,
        "r16uint" => wgpu::TextureFormat::R16Uint,
        "r16sint" => wgpu::TextureFormat::R16Sint,
        "r16float" => wgpu::TextureFormat::R16Float,
        "rg8unorm" => wgpu::TextureFormat::Rg8Unorm,
        "rg8snorm" => wgpu::TextureFormat::Rg8Snorm,
        "rg8uint" => wgpu::TextureFormat::Rg8Uint,
        "rg8sint" => wgpu::TextureFormat::Rg8Sint,
        "r32uint" => wgpu::TextureFormat::R32Uint,
        "r32sint" => wgpu::TextureFormat::R32Sint,
        "r32float" => wgpu::TextureFormat::R32Float,
        "rg16uint" => wgpu::TextureFormat::Rg16Uint,
        "rg16sint" => wgpu::TextureFormat::Rg16Sint,
        "rg16float" => wgpu::TextureFormat::Rg16Float,
        "rgba8unorm" => wgpu::TextureFormat::Rgba8Unorm,
        "rgba8unorm-srgb" => wgpu::TextureFormat::Rgba8UnormSrgb,
        "rgba8snorm" => wgpu::TextureFormat::Rgba8Snorm,
        "rgba8uint" => wgpu::TextureFormat::Rgba8Uint,
        "rgba8sint" => wgpu::TextureFormat::Rgba8Sint,
        "bgra8unorm" => wgpu::TextureFormat::Bgra8Unorm,
        "bgra8unorm-srgb" => wgpu::TextureFormat::Bgra8UnormSrgb,
        "rgb9e5ufloat" => wgpu::TextureFormat::Rgb9e5Ufloat,
        "rgb10a2uint" => wgpu::TextureFormat::Rgb10a2Uint,
        "rgb10a2unorm" => wgpu::TextureFormat::Rgb10a2Unorm,
        "rg11b10ufloat" => wgpu::TextureFormat::Rg11b10Ufloat,
        "rg32uint" => wgpu::TextureFormat::Rg32Uint,
        "rg32sint" => wgpu::TextureFormat::Rg32Sint,
        "rg32float" => wgpu::TextureFormat::Rg32Float,
        "rgba16uint" => wgpu::TextureFormat::Rgba16Uint,
        "rgba16sint" => wgpu::TextureFormat::Rgba16Sint,
        "rgba16float" => wgpu::TextureFormat::Rgba16Float,
        "rgba32uint" => wgpu::TextureFormat::Rgba32Uint,
        "rgba32sint" => wgpu::TextureFormat::Rgba32Sint,
        "rgba32float" => wgpu::TextureFormat::Rgba32Float,
        "stencil8" => wgpu::TextureFormat::Stencil8,
        "depth16unorm" => wgpu::TextureFormat::Depth16Unorm,
        "depth24plus" => wgpu::TextureFormat::Depth24Plus,
        "depth24plus-stencil8" => wgpu::TextureFormat::Depth24PlusStencil8,
        "depth32float" => wgpu::TextureFormat::Depth32Float,
        "depth32float-stencil8" => wgpu::TextureFormat::Depth32FloatStencil8,
        "bc1-rgba-unorm" => wgpu::TextureFormat::Bc1RgbaUnorm,
        "bc1-rgba-unorm-srgb" => wgpu::TextureFormat::Bc1RgbaUnormSrgb,
        "bc2-rgba-unorm" => wgpu::TextureFormat::Bc2RgbaUnorm,
        "bc2-rgba-unorm-srgb" => wgpu::TextureFormat::Bc2RgbaUnormSrgb,
        "bc3-rgba-unorm" => wgpu::TextureFormat::Bc3RgbaUnorm,
        "bc3-rgba-unorm-srgb" => wgpu::TextureFormat::Bc3RgbaUnormSrgb,
        "bc4-r-unorm" => wgpu::TextureFormat::Bc4RUnorm,
        "bc4-r-snorm" => wgpu::TextureFormat::Bc4RSnorm,
        "bc5-rg-unorm" => wgpu::TextureFormat::Bc5RgUnorm,
        "bc5-rg-snorm" => wgpu::TextureFormat::Bc5RgSnorm,
        "bc6h-rgb-ufloat" => wgpu::TextureFormat::Bc6hRgbUfloat,
        "bc6h-rgb-float" => wgpu::TextureFormat::Bc6hRgbFloat,
        "bc7-rgba-unorm" => wgpu::TextureFormat::Bc7RgbaUnorm,
        "bc7-rgba-unorm-srgb" => wgpu::TextureFormat::Bc7RgbaUnormSrgb,
        "etc2-rgb8unorm" => wgpu::TextureFormat::Etc2Rgb8Unorm,
        "etc2-rgb8unorm-srgb" => wgpu::TextureFormat::Etc2Rgb8UnormSrgb,
        "etc2-rgb8a1unorm" => wgpu::TextureFormat::Etc2Rgb8A1Unorm,
        "etc2-rgb8a1unorm-srgb" => wgpu::TextureFormat::Etc2Rgb8A1UnormSrgb,
        "etc2-rgba8unorm" => wgpu::TextureFormat::Etc2Rgba8Unorm,
        "etc2-rgba8unorm-srgb" => wgpu::TextureFormat::Etc2Rgba8UnormSrgb,
        "eac-r11unorm" => wgpu::TextureFormat::EacR11Unorm,
        "eac-r11snorm" => wgpu::TextureFormat::EacR11Snorm,
        "eac-rg11unorm" => wgpu::TextureFormat::EacRg11Unorm,
        "eac-rg11snorm" => wgpu::TextureFormat::EacRg11Snorm,
        "astc-4x4-unorm" => wgpu::TextureFormat::Astc { block: wgpu::AstcBlock::B4x4, channel: wgpu::AstcChannel::Unorm },
        "astc-4x4-unorm-srgb" => wgpu::TextureFormat::Astc { block: wgpu::AstcBlock::B4x4, channel: wgpu::AstcChannel::UnormSrgb },
        "astc-4x4-hdr" => wgpu::TextureFormat::Astc { block: wgpu::AstcBlock::B4x4, channel: wgpu::AstcChannel::Hdr },
        "astc-5x4-unorm" => wgpu::TextureFormat::Astc { block: wgpu::AstcBlock::B5x4, channel: wgpu::AstcChannel::Unorm },
        "astc-5x4-unorm-srgb" => wgpu::TextureFormat::Astc { block: wgpu::AstcBlock::B5x4, channel: wgpu::AstcChannel::UnormSrgb },
        "astc-5x5-unorm" => wgpu::TextureFormat::Astc { block: wgpu::AstcBlock::B5x5, channel: wgpu::AstcChannel::Unorm },
        "astc-5x5-unorm-srgb" => wgpu::TextureFormat::Astc { block: wgpu::AstcBlock::B5x5, channel: wgpu::AstcChannel::UnormSrgb },
        "astc-6x5-unorm" => wgpu::TextureFormat::Astc { block: wgpu::AstcBlock::B6x5, channel: wgpu::AstcChannel::Unorm },
        "astc-6x5-unorm-srgb" => wgpu::TextureFormat::Astc { block: wgpu::AstcBlock::B6x5, channel: wgpu::AstcChannel::UnormSrgb },
        "astc-6x6-unorm" => wgpu::TextureFormat::Astc { block: wgpu::AstcBlock::B6x6, channel: wgpu::AstcChannel::Unorm },
        "astc-6x6-unorm-srgb" => wgpu::TextureFormat::Astc { block: wgpu::AstcBlock::B6x6, channel: wgpu::AstcChannel::UnormSrgb },
        "astc-8x5-unorm" => wgpu::TextureFormat::Astc { block: wgpu::AstcBlock::B8x5, channel: wgpu::AstcChannel::Unorm },
        "astc-8x5-unorm-srgb" => wgpu::TextureFormat::Astc { block: wgpu::AstcBlock::B8x5, channel: wgpu::AstcChannel::UnormSrgb },
        "astc-8x6-unorm" => wgpu::TextureFormat::Astc { block: wgpu::AstcBlock::B8x6, channel: wgpu::AstcChannel::Unorm },
        "astc-8x6-unorm-srgb" => wgpu::TextureFormat::Astc { block: wgpu::AstcBlock::B8x6, channel: wgpu::AstcChannel::UnormSrgb },
        "astc-8x8-unorm" => wgpu::TextureFormat::Astc { block: wgpu::AstcBlock::B8x8, channel: wgpu::AstcChannel::Unorm },
        "astc-8x8-unorm-srgb" => wgpu::TextureFormat::Astc { block: wgpu::AstcBlock::B8x8, channel: wgpu::AstcChannel::UnormSrgb },
        "astc-10x5-unorm" => wgpu::TextureFormat::Astc { block: wgpu::AstcBlock::B10x5, channel: wgpu::AstcChannel::Unorm },
        "astc-10x5-unorm-srgb" => wgpu::TextureFormat::Astc { block: wgpu::AstcBlock::B10x5, channel: wgpu::AstcChannel::UnormSrgb },
        "astc-10x6-unorm" => wgpu::TextureFormat::Astc { block: wgpu::AstcBlock::B10x6, channel: wgpu::AstcChannel::Unorm },
        "astc-10x6-unorm-srgb" => wgpu::TextureFormat::Astc { block: wgpu::AstcBlock::B10x6, channel: wgpu::AstcChannel::UnormSrgb },
        "astc-10x8-unorm" => wgpu::TextureFormat::Astc { block: wgpu::AstcBlock::B10x8, channel: wgpu::AstcChannel::Unorm },
        "astc-10x8-unorm-srgb" => wgpu::TextureFormat::Astc { block: wgpu::AstcBlock::B10x8, channel: wgpu::AstcChannel::UnormSrgb },
        "astc-10x10-unorm" => wgpu::TextureFormat::Astc { block: wgpu::AstcBlock::B10x10, channel: wgpu::AstcChannel::Unorm },
        "astc-10x10-unorm-srgb" => wgpu::TextureFormat::Astc { block: wgpu::AstcBlock::B10x10, channel: wgpu::AstcChannel::UnormSrgb },
        "astc-12x10-unorm" => wgpu::TextureFormat::Astc { block: wgpu::AstcBlock::B12x10, channel: wgpu::AstcChannel::Unorm },
        "astc-12x10-unorm-srgb" => wgpu::TextureFormat::Astc { block: wgpu::AstcBlock::B12x10, channel: wgpu::AstcChannel::UnormSrgb },
        "astc-12x12-unorm" => wgpu::TextureFormat::Astc { block: wgpu::AstcBlock::B12x12, channel: wgpu::AstcChannel::Unorm },
        "astc-12x12-unorm-srgb" => wgpu::TextureFormat::Astc { block: wgpu::AstcBlock::B12x12, channel: wgpu::AstcChannel::UnormSrgb },
        _ => return Err(invalid_enum("GPUTextureFormat", s)),
    })
}

pub fn texture_format_to_str(f: wgpu::TextureFormat) -> &'static str {
    match f {
        wgpu::TextureFormat::R8Unorm => "r8unorm",
        wgpu::TextureFormat::R8Snorm => "r8snorm",
        wgpu::TextureFormat::R8Uint => "r8uint",
        wgpu::TextureFormat::R8Sint => "r8sint",
        wgpu::TextureFormat::R16Uint => "r16uint",
        wgpu::TextureFormat::R16Sint => "r16sint",
        wgpu::TextureFormat::R16Float => "r16float",
        wgpu::TextureFormat::Rg8Unorm => "rg8unorm",
        wgpu::TextureFormat::Rg8Snorm => "rg8snorm",
        wgpu::TextureFormat::Rg8Uint => "rg8uint",
        wgpu::TextureFormat::Rg8Sint => "rg8sint",
        wgpu::TextureFormat::R32Uint => "r32uint",
        wgpu::TextureFormat::R32Sint => "r32sint",
        wgpu::TextureFormat::R32Float => "r32float",
        wgpu::TextureFormat::Rg16Uint => "rg16uint",
        wgpu::TextureFormat::Rg16Sint => "rg16sint",
        wgpu::TextureFormat::Rg16Float => "rg16float",
        wgpu::TextureFormat::Rgba8Unorm => "rgba8unorm",
        wgpu::TextureFormat::Rgba8UnormSrgb => "rgba8unorm-srgb",
        wgpu::TextureFormat::Rgba8Snorm => "rgba8snorm",
        wgpu::TextureFormat::Rgba8Uint => "rgba8uint",
        wgpu::TextureFormat::Rgba8Sint => "rgba8sint",
        wgpu::TextureFormat::Bgra8Unorm => "bgra8unorm",
        wgpu::TextureFormat::Bgra8UnormSrgb => "bgra8unorm-srgb",
        wgpu::TextureFormat::Rgb9e5Ufloat => "rgb9e5ufloat",
        wgpu::TextureFormat::Rgb10a2Uint => "rgb10a2uint",
        wgpu::TextureFormat::Rgb10a2Unorm => "rgb10a2unorm",
        wgpu::TextureFormat::Rg11b10Ufloat => "rg11b10ufloat",
        wgpu::TextureFormat::Rg32Uint => "rg32uint",
        wgpu::TextureFormat::Rg32Sint => "rg32sint",
        wgpu::TextureFormat::Rg32Float => "rg32float",
        wgpu::TextureFormat::Rgba16Uint => "rgba16uint",
        wgpu::TextureFormat::Rgba16Sint => "rgba16sint",
        wgpu::TextureFormat::Rgba16Float => "rgba16float",
        wgpu::TextureFormat::Rgba32Uint => "rgba32uint",
        wgpu::TextureFormat::Rgba32Sint => "rgba32sint",
        wgpu::TextureFormat::Rgba32Float => "rgba32float",
        wgpu::TextureFormat::Stencil8 => "stencil8",
        wgpu::TextureFormat::Depth16Unorm => "depth16unorm",
        wgpu::TextureFormat::Depth24Plus => "depth24plus",
        wgpu::TextureFormat::Depth24PlusStencil8 => "depth24plus-stencil8",
        wgpu::TextureFormat::Depth32Float => "depth32float",
        wgpu::TextureFormat::Depth32FloatStencil8 => "depth32float-stencil8",
        // ── Compressed formats ──────────────────────────────────────────────
        //
        // These were missing until `loadKtx2Texture` landed, so a BC texture
        // could be *created* (the name parses in `texture_format_from_str`) but
        // not *reported* — `texture.format` came back "unknown". That is the
        // same asymmetry the `FEATURES` table warns about further down this
        // file, in the other direction: if you add a format above, add it here
        // too, or it becomes creatable-but-unreadable.
        wgpu::TextureFormat::Bc1RgbaUnorm => "bc1-rgba-unorm",
        wgpu::TextureFormat::Bc1RgbaUnormSrgb => "bc1-rgba-unorm-srgb",
        wgpu::TextureFormat::Bc2RgbaUnorm => "bc2-rgba-unorm",
        wgpu::TextureFormat::Bc2RgbaUnormSrgb => "bc2-rgba-unorm-srgb",
        wgpu::TextureFormat::Bc3RgbaUnorm => "bc3-rgba-unorm",
        wgpu::TextureFormat::Bc3RgbaUnormSrgb => "bc3-rgba-unorm-srgb",
        wgpu::TextureFormat::Bc4RUnorm => "bc4-r-unorm",
        wgpu::TextureFormat::Bc4RSnorm => "bc4-r-snorm",
        wgpu::TextureFormat::Bc5RgUnorm => "bc5-rg-unorm",
        wgpu::TextureFormat::Bc5RgSnorm => "bc5-rg-snorm",
        wgpu::TextureFormat::Bc6hRgbUfloat => "bc6h-rgb-ufloat",
        wgpu::TextureFormat::Bc6hRgbFloat => "bc6h-rgb-float",
        wgpu::TextureFormat::Bc7RgbaUnorm => "bc7-rgba-unorm",
        wgpu::TextureFormat::Bc7RgbaUnormSrgb => "bc7-rgba-unorm-srgb",
        wgpu::TextureFormat::Etc2Rgb8Unorm => "etc2-rgb8unorm",
        wgpu::TextureFormat::Etc2Rgb8UnormSrgb => "etc2-rgb8unorm-srgb",
        wgpu::TextureFormat::Etc2Rgb8A1Unorm => "etc2-rgb8a1unorm",
        wgpu::TextureFormat::Etc2Rgb8A1UnormSrgb => "etc2-rgb8a1unorm-srgb",
        wgpu::TextureFormat::Etc2Rgba8Unorm => "etc2-rgba8unorm",
        wgpu::TextureFormat::Etc2Rgba8UnormSrgb => "etc2-rgba8unorm-srgb",
        wgpu::TextureFormat::EacR11Unorm => "eac-r11unorm",
        wgpu::TextureFormat::EacR11Snorm => "eac-r11snorm",
        wgpu::TextureFormat::EacRg11Unorm => "eac-rg11unorm",
        wgpu::TextureFormat::EacRg11Snorm => "eac-rg11snorm",
        // ASTC is one wgpu variant with block/channel fields rather than a
        // variant per name, so it round-trips through a nested match instead of
        // 39 arms.
        wgpu::TextureFormat::Astc { block, channel } => {
            use wgpu::{AstcBlock as B, AstcChannel as C};
            match (block, channel) {
                (B::B4x4, C::Unorm) => "astc-4x4-unorm",
                (B::B4x4, C::UnormSrgb) => "astc-4x4-unorm-srgb",
                (B::B4x4, C::Hdr) => "astc-4x4-hdr",
                (B::B5x4, C::Unorm) => "astc-5x4-unorm",
                (B::B5x4, C::UnormSrgb) => "astc-5x4-unorm-srgb",
                (B::B5x5, C::Unorm) => "astc-5x5-unorm",
                (B::B5x5, C::UnormSrgb) => "astc-5x5-unorm-srgb",
                (B::B6x5, C::Unorm) => "astc-6x5-unorm",
                (B::B6x5, C::UnormSrgb) => "astc-6x5-unorm-srgb",
                (B::B6x6, C::Unorm) => "astc-6x6-unorm",
                (B::B6x6, C::UnormSrgb) => "astc-6x6-unorm-srgb",
                (B::B8x5, C::Unorm) => "astc-8x5-unorm",
                (B::B8x5, C::UnormSrgb) => "astc-8x5-unorm-srgb",
                (B::B8x6, C::Unorm) => "astc-8x6-unorm",
                (B::B8x6, C::UnormSrgb) => "astc-8x6-unorm-srgb",
                (B::B8x8, C::Unorm) => "astc-8x8-unorm",
                (B::B8x8, C::UnormSrgb) => "astc-8x8-unorm-srgb",
                (B::B10x5, C::Unorm) => "astc-10x5-unorm",
                (B::B10x5, C::UnormSrgb) => "astc-10x5-unorm-srgb",
                (B::B10x6, C::Unorm) => "astc-10x6-unorm",
                (B::B10x6, C::UnormSrgb) => "astc-10x6-unorm-srgb",
                (B::B10x8, C::Unorm) => "astc-10x8-unorm",
                (B::B10x8, C::UnormSrgb) => "astc-10x8-unorm-srgb",
                (B::B10x10, C::Unorm) => "astc-10x10-unorm",
                (B::B10x10, C::UnormSrgb) => "astc-10x10-unorm-srgb",
                (B::B12x10, C::Unorm) => "astc-12x10-unorm",
                (B::B12x10, C::UnormSrgb) => "astc-12x10-unorm-srgb",
                (B::B12x12, C::Unorm) => "astc-12x12-unorm",
                (B::B12x12, C::UnormSrgb) => "astc-12x12-unorm-srgb",
                _ => "unknown",
            }
        }
        _ => "unknown",
    }
}

// ── Sampler ───────────────────────────────────────────────────────────────────

pub fn address_mode(s: &str) -> napi::Result<wgpu::AddressMode> {
    Ok(match s {
        "clamp-to-edge" => wgpu::AddressMode::ClampToEdge,
        "repeat" => wgpu::AddressMode::Repeat,
        "mirror-repeat" => wgpu::AddressMode::MirrorRepeat,
        _ => return Err(invalid_enum("GPUAddressMode", s)),
    })
}

pub fn filter_mode(s: &str) -> napi::Result<wgpu::FilterMode> {
    Ok(match s {
        "nearest" => wgpu::FilterMode::Nearest,
        "linear" => wgpu::FilterMode::Linear,
        _ => return Err(invalid_enum("GPUFilterMode", s)),
    })
}

pub fn compare_function(s: &str) -> napi::Result<wgpu::CompareFunction> {
    Ok(match s {
        "never" => wgpu::CompareFunction::Never,
        "less" => wgpu::CompareFunction::Less,
        "equal" => wgpu::CompareFunction::Equal,
        "less-equal" => wgpu::CompareFunction::LessEqual,
        "greater" => wgpu::CompareFunction::Greater,
        "not-equal" => wgpu::CompareFunction::NotEqual,
        "greater-equal" => wgpu::CompareFunction::GreaterEqual,
        "always" => wgpu::CompareFunction::Always,
        _ => return Err(invalid_enum("GPUCompareFunction", s)),
    })
}

// ── Render pipeline ───────────────────────────────────────────────────────────

pub fn blend_factor(s: &str) -> napi::Result<wgpu::BlendFactor> {
    Ok(match s {
        "zero" => wgpu::BlendFactor::Zero,
        "one" => wgpu::BlendFactor::One,
        "src" => wgpu::BlendFactor::Src,
        "one-minus-src" => wgpu::BlendFactor::OneMinusSrc,
        "src-alpha" => wgpu::BlendFactor::SrcAlpha,
        "one-minus-src-alpha" => wgpu::BlendFactor::OneMinusSrcAlpha,
        "dst" => wgpu::BlendFactor::Dst,
        "one-minus-dst" => wgpu::BlendFactor::OneMinusDst,
        "dst-alpha" => wgpu::BlendFactor::DstAlpha,
        "one-minus-dst-alpha" => wgpu::BlendFactor::OneMinusDstAlpha,
        "src-alpha-saturated" => wgpu::BlendFactor::SrcAlphaSaturated,
        "constant" => wgpu::BlendFactor::Constant,
        "one-minus-constant" => wgpu::BlendFactor::OneMinusConstant,
        "src1" => wgpu::BlendFactor::Src1,
        "one-minus-src1" => wgpu::BlendFactor::OneMinusSrc1,
        "src1-alpha" => wgpu::BlendFactor::Src1Alpha,
        "one-minus-src1-alpha" => wgpu::BlendFactor::OneMinusSrc1Alpha,
        _ => return Err(invalid_enum("GPUBlendFactor", s)),
    })
}

pub fn blend_operation(s: &str) -> napi::Result<wgpu::BlendOperation> {
    Ok(match s {
        "add" => wgpu::BlendOperation::Add,
        "subtract" => wgpu::BlendOperation::Subtract,
        "reverse-subtract" => wgpu::BlendOperation::ReverseSubtract,
        "min" => wgpu::BlendOperation::Min,
        "max" => wgpu::BlendOperation::Max,
        _ => return Err(invalid_enum("GPUBlendOperation", s)),
    })
}

pub fn stencil_operation(s: &str) -> napi::Result<wgpu::StencilOperation> {
    Ok(match s {
        "keep" => wgpu::StencilOperation::Keep,
        "zero" => wgpu::StencilOperation::Zero,
        "replace" => wgpu::StencilOperation::Replace,
        "invert" => wgpu::StencilOperation::Invert,
        "increment-clamp" => wgpu::StencilOperation::IncrementClamp,
        "decrement-clamp" => wgpu::StencilOperation::DecrementClamp,
        "increment-wrap" => wgpu::StencilOperation::IncrementWrap,
        "decrement-wrap" => wgpu::StencilOperation::DecrementWrap,
        _ => return Err(invalid_enum("GPUStencilOperation", s)),
    })
}

pub fn primitive_topology(s: &str) -> napi::Result<wgpu::PrimitiveTopology> {
    Ok(match s {
        "point-list" => wgpu::PrimitiveTopology::PointList,
        "line-list" => wgpu::PrimitiveTopology::LineList,
        "line-strip" => wgpu::PrimitiveTopology::LineStrip,
        "triangle-list" => wgpu::PrimitiveTopology::TriangleList,
        "triangle-strip" => wgpu::PrimitiveTopology::TriangleStrip,
        _ => return Err(invalid_enum("GPUPrimitiveTopology", s)),
    })
}

pub fn index_format(s: &str) -> napi::Result<wgpu::IndexFormat> {
    Ok(match s {
        "uint16" => wgpu::IndexFormat::Uint16,
        "uint32" => wgpu::IndexFormat::Uint32,
        _ => return Err(invalid_enum("GPUIndexFormat", s)),
    })
}

pub fn front_face(s: &str) -> napi::Result<wgpu::FrontFace> {
    Ok(match s {
        "ccw" => wgpu::FrontFace::Ccw,
        "cw" => wgpu::FrontFace::Cw,
        _ => return Err(invalid_enum("GPUFrontFace", s)),
    })
}

pub fn cull_mode(s: &str) -> napi::Result<Option<wgpu::Face>> {
    Ok(match s {
        "none" => None,
        "front" => Some(wgpu::Face::Front),
        "back" => Some(wgpu::Face::Back),
        _ => return Err(invalid_enum("GPUCullMode", s)),
    })
}

pub fn vertex_format(s: &str) -> napi::Result<wgpu::VertexFormat> {
    Ok(match s {
        "uint8" => wgpu::VertexFormat::Uint8,
        "uint8x2" => wgpu::VertexFormat::Uint8x2,
        "uint8x4" => wgpu::VertexFormat::Uint8x4,
        "sint8" => wgpu::VertexFormat::Sint8,
        "sint8x2" => wgpu::VertexFormat::Sint8x2,
        "sint8x4" => wgpu::VertexFormat::Sint8x4,
        "unorm8" => wgpu::VertexFormat::Unorm8,
        "unorm8x2" => wgpu::VertexFormat::Unorm8x2,
        "unorm8x4" => wgpu::VertexFormat::Unorm8x4,
        "snorm8" => wgpu::VertexFormat::Snorm8,
        "snorm8x2" => wgpu::VertexFormat::Snorm8x2,
        "snorm8x4" => wgpu::VertexFormat::Snorm8x4,
        "uint16" => wgpu::VertexFormat::Uint16,
        "uint16x2" => wgpu::VertexFormat::Uint16x2,
        "uint16x4" => wgpu::VertexFormat::Uint16x4,
        "sint16" => wgpu::VertexFormat::Sint16,
        "sint16x2" => wgpu::VertexFormat::Sint16x2,
        "sint16x4" => wgpu::VertexFormat::Sint16x4,
        "unorm16" => wgpu::VertexFormat::Unorm16,
        "unorm16x2" => wgpu::VertexFormat::Unorm16x2,
        "unorm16x4" => wgpu::VertexFormat::Unorm16x4,
        "snorm16" => wgpu::VertexFormat::Snorm16,
        "snorm16x2" => wgpu::VertexFormat::Snorm16x2,
        "snorm16x4" => wgpu::VertexFormat::Snorm16x4,
        "float16" => wgpu::VertexFormat::Float16,
        "float16x2" => wgpu::VertexFormat::Float16x2,
        "float16x4" => wgpu::VertexFormat::Float16x4,
        "float32" => wgpu::VertexFormat::Float32,
        "float32x2" => wgpu::VertexFormat::Float32x2,
        "float32x3" => wgpu::VertexFormat::Float32x3,
        "float32x4" => wgpu::VertexFormat::Float32x4,
        "uint32" => wgpu::VertexFormat::Uint32,
        "uint32x2" => wgpu::VertexFormat::Uint32x2,
        "uint32x3" => wgpu::VertexFormat::Uint32x3,
        "uint32x4" => wgpu::VertexFormat::Uint32x4,
        "sint32" => wgpu::VertexFormat::Sint32,
        "sint32x2" => wgpu::VertexFormat::Sint32x2,
        "sint32x3" => wgpu::VertexFormat::Sint32x3,
        "sint32x4" => wgpu::VertexFormat::Sint32x4,
        "unorm10-10-10-2" => wgpu::VertexFormat::Unorm10_10_10_2,
        "unorm8x4-bgra" => wgpu::VertexFormat::Unorm8x4Bgra,
        _ => return Err(invalid_enum("GPUVertexFormat", s)),
    })
}

pub fn vertex_step_mode(s: &str) -> napi::Result<wgpu::VertexStepMode> {
    Ok(match s {
        "vertex" => wgpu::VertexStepMode::Vertex,
        "instance" => wgpu::VertexStepMode::Instance,
        _ => return Err(invalid_enum("GPUVertexStepMode", s)),
    })
}

// ── Texture / resource ────────────────────────────────────────────────────────

pub fn texture_dimension(s: &str) -> napi::Result<wgpu::TextureDimension> {
    Ok(match s {
        "1d" => wgpu::TextureDimension::D1,
        "2d" => wgpu::TextureDimension::D2,
        "3d" => wgpu::TextureDimension::D3,
        _ => return Err(invalid_enum("GPUTextureDimension", s)),
    })
}

pub fn texture_dimension_to_str(d: wgpu::TextureDimension) -> &'static str {
    match d {
        wgpu::TextureDimension::D1 => "1d",
        wgpu::TextureDimension::D2 => "2d",
        wgpu::TextureDimension::D3 => "3d",
    }
}

pub fn texture_view_dimension(s: &str) -> napi::Result<wgpu::TextureViewDimension> {
    Ok(match s {
        "1d" => wgpu::TextureViewDimension::D1,
        "2d" => wgpu::TextureViewDimension::D2,
        "2d-array" => wgpu::TextureViewDimension::D2Array,
        "cube" => wgpu::TextureViewDimension::Cube,
        "cube-array" => wgpu::TextureViewDimension::CubeArray,
        "3d" => wgpu::TextureViewDimension::D3,
        _ => return Err(invalid_enum("GPUTextureViewDimension", s)),
    })
}

pub fn texture_view_dimension_to_str(d: wgpu::TextureViewDimension) -> &'static str {
    match d {
        wgpu::TextureViewDimension::D1 => "1d",
        wgpu::TextureViewDimension::D2 => "2d",
        wgpu::TextureViewDimension::D2Array => "2d-array",
        wgpu::TextureViewDimension::Cube => "cube",
        wgpu::TextureViewDimension::CubeArray => "cube-array",
        wgpu::TextureViewDimension::D3 => "3d",
    }
}

pub fn texture_aspect(s: &str) -> napi::Result<wgpu::TextureAspect> {
    Ok(match s {
        "all" => wgpu::TextureAspect::All,
        "stencil-only" => wgpu::TextureAspect::StencilOnly,
        "depth-only" => wgpu::TextureAspect::DepthOnly,
        _ => return Err(invalid_enum("GPUTextureAspect", s)),
    })
}

// ── Bind group layout ─────────────────────────────────────────────────────────

pub fn buffer_binding_type(s: &str) -> napi::Result<wgpu::BufferBindingType> {
    Ok(match s {
        "uniform" => wgpu::BufferBindingType::Uniform,
        "storage" => wgpu::BufferBindingType::Storage { read_only: false },
        "read-only-storage" => wgpu::BufferBindingType::Storage { read_only: true },
        _ => return Err(invalid_enum("GPUBufferBindingType", s)),
    })
}

pub fn sampler_binding_type(s: &str) -> napi::Result<wgpu::SamplerBindingType> {
    Ok(match s {
        "filtering" => wgpu::SamplerBindingType::Filtering,
        "non-filtering" => wgpu::SamplerBindingType::NonFiltering,
        "comparison" => wgpu::SamplerBindingType::Comparison,
        _ => return Err(invalid_enum("GPUSamplerBindingType", s)),
    })
}

pub fn texture_sample_type(s: &str) -> napi::Result<wgpu::TextureSampleType> {
    Ok(match s {
        "float" => wgpu::TextureSampleType::Float { filterable: true },
        "unfilterable-float" => wgpu::TextureSampleType::Float { filterable: false },
        "depth" => wgpu::TextureSampleType::Depth,
        "sint" => wgpu::TextureSampleType::Sint,
        "uint" => wgpu::TextureSampleType::Uint,
        _ => return Err(invalid_enum("GPUTextureSampleType", s)),
    })
}

pub fn storage_texture_access(s: &str) -> napi::Result<wgpu::StorageTextureAccess> {
    Ok(match s {
        "write-only" => wgpu::StorageTextureAccess::WriteOnly,
        "read-only" => wgpu::StorageTextureAccess::ReadOnly,
        "read-write" => wgpu::StorageTextureAccess::ReadWrite,
        _ => return Err(invalid_enum("GPUStorageTextureAccess", s)),
    })
}

// ── Query ─────────────────────────────────────────────────────────────────────

pub fn query_type(s: &str) -> napi::Result<wgpu::QueryType> {
    Ok(match s {
        "occlusion" => wgpu::QueryType::Occlusion,
        "timestamp" => wgpu::QueryType::Timestamp,
        _ => return Err(invalid_enum("GPUQueryType", s)),
    })
}

pub fn query_type_to_str(q: wgpu::QueryType) -> &'static str {
    match q {
        wgpu::QueryType::Occlusion => "occlusion",
        wgpu::QueryType::Timestamp => "timestamp",
        _ => "unknown",
    }
}

// ── Flags (u32) ───────────────────────────────────────────────────────────────

pub fn buffer_usage(u: u32) -> wgpu::BufferUsages {
    wgpu::BufferUsages::from_bits_truncate(u)
}

pub fn texture_usage(u: u32) -> wgpu::TextureUsages {
    wgpu::TextureUsages::from_bits_truncate(u)
}

pub fn shader_stage(u: u32) -> wgpu::ShaderStages {
    wgpu::ShaderStages::from_bits_truncate(u)
}

pub fn color_write(u: u32) -> wgpu::ColorWrites {
    wgpu::ColorWrites::from_bits_truncate(u)
}

// ── Adapter ───────────────────────────────────────────────────────────────────

pub fn backend(s: &str) -> napi::Result<wgpu::Backends> {
    Ok(match s {
        "vulkan"  => wgpu::Backends::VULKAN,
        "dx12"    => wgpu::Backends::DX12,
        "metal"   => wgpu::Backends::METAL,
        "gl"      => wgpu::Backends::GL,
        _ => return Err(invalid_enum("GPUBackend", s)),
    })
}

pub fn power_preference(s: &str) -> napi::Result<wgpu::PowerPreference> {
    Ok(match s {
        "low-power" => wgpu::PowerPreference::LowPower,
        "high-performance" => wgpu::PowerPreference::HighPerformance,
        _ => return Err(invalid_enum("GPUPowerPreference", s)),
    })
}

/// Every feature name `requiredFeatures` accepts and `features` reports.
///
/// Both directions of the mapping read this one table, so a name can't be
/// requestable but unreportable (or vice versa).
///
/// The second block is **not** in the WebGPU spec — those are wgpu native
/// extensions, and anything depending on them will not run in a browser. Keep
/// them behind an adapter `features.has(...)` check; unlike the spec features,
/// there is no guarantee a given backend exposes them.
const FEATURES: &[(&str, wgpu::Features)] = &[
    // ── WebGPU spec — https://www.w3.org/TR/webgpu/#gpufeaturename ────────────
    ("depth-clip-control", wgpu::Features::DEPTH_CLIP_CONTROL),
    ("depth32float-stencil8", wgpu::Features::DEPTH32FLOAT_STENCIL8),
    ("texture-compression-bc", wgpu::Features::TEXTURE_COMPRESSION_BC),
    ("texture-compression-bc-sliced-3d", wgpu::Features::TEXTURE_COMPRESSION_BC_SLICED_3D),
    ("texture-compression-etc2", wgpu::Features::TEXTURE_COMPRESSION_ETC2),
    ("texture-compression-astc", wgpu::Features::TEXTURE_COMPRESSION_ASTC),
    ("timestamp-query", wgpu::Features::TIMESTAMP_QUERY),
    ("indirect-first-instance", wgpu::Features::INDIRECT_FIRST_INSTANCE),
    ("shader-f16", wgpu::Features::SHADER_F16),
    ("rg11b10ufloat-renderable", wgpu::Features::RG11B10UFLOAT_RENDERABLE),
    ("bgra8unorm-storage", wgpu::Features::BGRA8UNORM_STORAGE),
    ("float32-filterable", wgpu::Features::FLOAT32_FILTERABLE),
    ("dual-source-blending", wgpu::Features::DUAL_SOURCE_BLENDING),
    // ── wgpu native-only extensions ───────────────────────────────────────────
    ("timestamp-query-inside-encoders", wgpu::Features::TIMESTAMP_QUERY_INSIDE_ENCODERS),
    ("timestamp-query-inside-passes", wgpu::Features::TIMESTAMP_QUERY_INSIDE_PASSES),
    ("multi-draw-indirect", wgpu::Features::MULTI_DRAW_INDIRECT),
    ("push-constants", wgpu::Features::PUSH_CONSTANTS),
];

/// Rejects unknown names rather than dropping them. The spec has `requestDevice`
/// throw a `TypeError` for an unrecognised feature; silently ignoring a typo
/// hands back a device that's missing the feature and fails much later, far from
/// the cause.
pub fn feature_to_wgpu(name: &str) -> napi::Result<wgpu::Features> {
    FEATURES
        .iter()
        .find(|(n, _)| *n == name)
        .map(|(_, bits)| *bits)
        .ok_or_else(|| invalid_enum("GPUFeatureName", name))
}

pub fn features_to_vec(f: wgpu::Features) -> Vec<&'static str> {
    FEATURES
        .iter()
        .filter(|(_, bits)| f.contains(*bits))
        .map(|(name, _)| *name)
        .collect()
}

#[allow(unreachable_patterns)] // Backend is #[non_exhaustive]; wildcard needed for future variants
pub fn backend_to_str(b: wgpu::Backend) -> &'static str {
    match b {
        wgpu::Backend::Empty => "Empty",
        wgpu::Backend::Vulkan => "Vulkan",
        wgpu::Backend::Metal => "Metal",
        wgpu::Backend::Dx12 => "Dx12",
        wgpu::Backend::Gl => "Gl",
        wgpu::Backend::BrowserWebGpu => "BrowserWebGpu",
        _ => "Unknown",
    }
}

#[allow(
    unreachable_patterns
)] // DeviceType is #[non_exhaustive]; wildcard needed for future variants
pub fn device_type_to_str(d: wgpu::DeviceType) -> &'static str {
    match d {
        wgpu::DeviceType::Other => "Other",
        wgpu::DeviceType::IntegratedGpu => "IntegratedGpu",
        wgpu::DeviceType::DiscreteGpu => "DiscreteGpu",
        wgpu::DeviceType::VirtualGpu => "VirtualGpu",
        wgpu::DeviceType::Cpu => "Cpu",
        _ => "Unknown",
    }
}

// ── Load / store ops ──────────────────────────────────────────────────────────

pub fn color_load_op(op: &str, clear: Option<[f64; 4]>) -> napi::Result<wgpu::Operations<wgpu::Color>> {
    Ok(wgpu::Operations {
        load: match op {
            "load" => wgpu::LoadOp::Load,
            "clear" => {
                let c = clear.unwrap_or([0.0, 0.0, 0.0, 1.0]);
                wgpu::LoadOp::Clear(wgpu::Color { r: c[0], g: c[1], b: c[2], a: c[3] })
            }
            _ => return Err(invalid_enum("GPULoadOp", op)),
        },
        store: wgpu::StoreOp::Store,
    })
}

pub fn depth_ops(
    load_op: Option<&str>,
    store_op: Option<&str>,
    clear: Option<f64>,
) -> napi::Result<Option<wgpu::Operations<f32>>> {
    match (load_op, store_op) {
        (None, None) => Ok(None),
        (load, store) => Ok(Some(wgpu::Operations {
            load: match load.unwrap_or("load") {
                "load" => wgpu::LoadOp::Load,
                "clear" => wgpu::LoadOp::Clear(clear.unwrap_or(0.0) as f32),
                s => return Err(invalid_enum("GPULoadOp", s)),
            },
            store: match store.unwrap_or("store") {
                "store" => wgpu::StoreOp::Store,
                "discard" => wgpu::StoreOp::Discard,
                s => return Err(invalid_enum("GPUStoreOp", s)),
            },
        })),
    }
}

pub fn stencil_ops(
    load_op: Option<&str>,
    store_op: Option<&str>,
    clear: Option<u32>,
) -> napi::Result<Option<wgpu::Operations<u32>>> {
    match (load_op, store_op) {
        (None, None) => Ok(None),
        (load, store) => Ok(Some(wgpu::Operations {
            load: match load.unwrap_or("load") {
                "load" => wgpu::LoadOp::Load,
                "clear" => wgpu::LoadOp::Clear(clear.unwrap_or(0)),
                s => return Err(invalid_enum("GPULoadOp", s)),
            },
            store: match store.unwrap_or("store") {
                "store" => wgpu::StoreOp::Store,
                "discard" => wgpu::StoreOp::Discard,
                s => return Err(invalid_enum("GPUStoreOp", s)),
            },
        })),
    }
}

pub fn store_op(s: &str) -> napi::Result<wgpu::StoreOp> {
    Ok(match s {
        "store" => wgpu::StoreOp::Store,
        "discard" => wgpu::StoreOp::Discard,
        _ => return Err(invalid_enum("GPUStoreOp", s)),
    })
}
