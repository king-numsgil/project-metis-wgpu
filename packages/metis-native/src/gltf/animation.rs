//! Animations: keyframe times and values, decoded to `f32` and handed to JS as
//! typed arrays.
//!
//! ## This is the one place the importer *does* copy data into JS
//!
//! Everywhere else the rule is that bulk data goes to the GPU and only handles
//! cross the napi boundary. Animation is the deliberate exception: sampling a
//! keyframe track is CPU work that produces node transforms, and node transforms
//! are what the consumer's scene graph is made of. Uploading them to a buffer
//! nothing reads would be theatre.
//!
//! The arrays are `Float32Array` rather than `number[]` for the obvious reason —
//! a 10-second 30 Hz rotation track is 1200 numbers, and a boxed JS array of
//! those costs about eight times what the typed array does.
//!
//! ## `CUBICSPLINE` changes the shape of `output`, and that is reported
//!
//! For `LINEAR` and `STEP` there is one value per keyframe. For `CUBICSPLINE`
//! there are **three** — in-tangent, value, out-tangent, in that order — so
//! `output.length` is `input.length * components * 3`. Callers get
//! `valuesPerKeyframe` rather than being expected to re-derive it from
//! `interpolation`, because getting it wrong reads tangents as values and
//! produces an animation that is wrong in a way that looks like bad authoring.
//!
//! ## Quantised tracks are un-normalised here
//!
//! glTF permits animation output to be `normalized` `BYTE`/`SHORT`, which is how
//! compact rotation tracks are stored. `accessor::to_f32` applies the
//! un-normalisation, so `output` is always real float values — a consumer never
//! has to know the track was quantised.

use super::accessor;
use super::enums::{GltfAnimationPath, GltfInterpolation};
use super::material::extras_json;
use napi::bindgen_prelude::Float32Array;
use napi_derive::napi;

#[napi(object)]
pub struct GltfAnimationSampler {
    pub interpolation: GltfInterpolation,
    /// Keyframe times in seconds, strictly increasing.
    pub input: Float32Array,
    /// Keyframe values, flattened. Length is
    /// `input.length * valuesPerKeyframe`.
    pub output: Float32Array,
    /// Components in one *value*: 3 for translation/scale, 4 for a rotation
    /// quaternion, and the mesh's morph target count for weights.
    pub components: u32,
    /// Components consumed per keyframe — `components`, or `components * 3`
    /// under `CubicSpline`.
    pub values_per_keyframe: u32,
}

#[napi(object)]
pub struct GltfAnimationChannel {
    /// Index into this animation's `samplers`.
    pub sampler: u32,
    /// Index into `GltfAsset.nodes`. `null` is legal — the spec allows a
    /// channel with no target, which must be ignored rather than treated as
    /// node 0.
    pub target_node: Option<u32>,
    pub path: GltfAnimationPath,
}

#[napi(object)]
pub struct GltfAnimation {
    pub name: Option<String>,
    pub samplers: Vec<GltfAnimationSampler>,
    pub channels: Vec<GltfAnimationChannel>,
    /// Largest keyframe time across every sampler, in seconds — the length of
    /// one loop. 0 when the animation has no keyframes.
    pub duration: f64,
    pub extras: Option<String>,
}

pub(crate) fn convert(
    anim: &gltf::Animation<'_>,
    buffers: &[Option<Vec<u8>>],
) -> napi::Result<GltfAnimation> {
    let what = format!("animation {}", anim.index());
    let mut duration = 0.0f32;
    let mut samplers = Vec::new();

    for (i, s) in anim.samplers().enumerate() {
        let interpolation = match s.interpolation() {
            gltf::animation::Interpolation::Linear => GltfInterpolation::Linear,
            gltf::animation::Interpolation::Step => GltfInterpolation::Step,
            gltf::animation::Interpolation::CubicSpline => GltfInterpolation::CubicSpline,
        };

        let input_data = accessor::read_accessor(&s.input(), buffers, &format!("{what} sampler {i} input"))?;
        let output_data = accessor::read_accessor(&s.output(), buffers, &format!("{what} sampler {i} output"))?;

        let times = accessor::to_f32(&input_data);
        if let Some(&last) = times.last() {
            duration = duration.max(last);
        }
        let values = accessor::to_f32(&output_data);

        let keyframes = input_data.count.max(1);
        let per_keyframe = values.len() / keyframes;
        let stride = if matches!(interpolation, GltfInterpolation::CubicSpline) { 3 } else { 1 };
        let components = (per_keyframe / stride).max(1);

        samplers.push(GltfAnimationSampler {
            interpolation,
            input: Float32Array::new(times),
            output: Float32Array::new(values),
            components: components as u32,
            values_per_keyframe: per_keyframe as u32,
        });
    }

    let channels = anim
        .channels()
        .map(|c| GltfAnimationChannel {
            sampler: c.sampler().index() as u32,
            target_node: Some(c.target().node().index() as u32),
            path: match c.target().property() {
                gltf::animation::Property::Translation => GltfAnimationPath::Translation,
                gltf::animation::Property::Rotation => GltfAnimationPath::Rotation,
                gltf::animation::Property::Scale => GltfAnimationPath::Scale,
                gltf::animation::Property::MorphTargetWeights => GltfAnimationPath::MorphTargetWeights,
            },
        })
        .collect();

    Ok(GltfAnimation {
        name: anim.name().map(str::to_owned),
        samplers,
        channels,
        duration: duration as f64,
        extras: extras_json(anim.extras()),
    })
}
