use napi::bindgen_prelude::{FnArgs, Function};
use napi_derive::napi;

use super::convert;

/// Spec-compliant setlike<DOMString> shape for `GPUSupportedFeatures`.
/// Exposes `.has()`, `.size`, `.keys()`, `.values()`, `.entries()`, `.forEach()`.
#[napi]
pub struct GpuSupportedFeatures {
    features: Vec<String>,
}

impl GpuSupportedFeatures {
    pub(crate) fn from_wgpu(f: wgpu::Features) -> Self {
        Self {
            features: convert::features_to_vec(f)
                .into_iter()
                .map(|s| s.to_string())
                .collect(),
        }
    }
}

#[napi]
impl GpuSupportedFeatures {
    #[napi(getter)]
    pub fn size(&self) -> u32 {
        self.features.len() as u32
    }

    #[napi]
    pub fn has(
        &self,
        #[napi(ts_arg_type = "GPUFeatureName | GPUNativeFeatureName")] key: String,
    ) -> bool {
        self.features.iter().any(|f| f == &key)
    }

    /// Returns an iterator-compatible array of feature name strings (keys == values for a set).
    #[napi(ts_return_type = "Array<GPUFeatureName | GPUNativeFeatureName>")]
    pub fn keys(&self) -> Vec<String> {
        self.features.clone()
    }

    #[napi(ts_return_type = "Array<GPUFeatureName | GPUNativeFeatureName>")]
    pub fn values(&self) -> Vec<String> {
        self.features.clone()
    }

    /// Returns `[[name, name], ...]` pairs (set entries: key === value).
    #[napi]
    pub fn entries(&self) -> Vec<Vec<String>> {
        self.features
            .iter()
            .map(|f| vec![f.clone(), f.clone()])
            .collect()
    }

    /// Calls `callback(value, key)` for each feature name.
    /// The third `set` argument from the spec is omitted for simplicity.
    #[napi]
    pub fn for_each(
        &self,
        #[napi(ts_arg_type = "(value: string, key: string) => void")] callback: Function<
            '_,
            FnArgs<(String, String)>,
            (),
        >,
    ) -> napi::Result<()> {
        for feature in &self.features {
            callback.call(FnArgs { data: (feature.clone(), feature.clone()) })?;
        }
        Ok(())
    }
}
