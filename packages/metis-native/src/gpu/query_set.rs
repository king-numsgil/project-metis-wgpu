use super::convert;
use napi_derive::napi;
use std::sync::{Arc, Mutex};

#[napi(object)]
pub struct GpuQuerySetDescriptor {
    pub label: Option<String>,
    #[napi(ts_type = "GPUQueryType")]
    pub r#type: String,
    pub count: u32,
}

/// A pool of `count` query slots (occlusion or timestamp), created by
/// `device.createQuerySet`. Passes write into its slots
/// (`beginOcclusionQuery`, `writeTimestamp`, `timestampWrites`); read the
/// results back by `encoder.resolveQuerySet` into a buffer.
#[napi]
pub struct GpuQuerySet {
    pub(crate) inner: Arc<wgpu::QuerySet>,
    pub(crate) query_type: wgpu::QueryType,
    pub(crate) count: u32,
    label: Mutex<Option<String>>,
}

impl GpuQuerySet {
    pub(crate) fn new(inner: wgpu::QuerySet, query_type: wgpu::QueryType, count: u32, label: Option<String>) -> Self {
        Self { inner: Arc::new(inner), query_type, count, label: Mutex::new(label) }
    }
}

#[napi]
impl GpuQuerySet {
    /// Debug label (read-write).
    #[napi(getter)]
    pub fn label(&self) -> Option<String> { self.label.lock().unwrap().clone() }
    #[napi(setter)]
    pub fn set_label(&self, label: String) { *self.label.lock().unwrap() = Some(label); }

    /// The kind of queries this set holds: `"occlusion"` or `"timestamp"`.
    #[napi(getter, js_name = "type", ts_return_type = "GPUQueryType")]
    pub fn query_type(&self) -> String {
        convert::query_type_to_str(self.query_type).to_string()
    }

    /// The number of query slots in the set.
    #[napi(getter)]
    pub fn count(&self) -> u32 {
        self.count
    }

    /// Release the query set. (It is also freed automatically once no handle
    /// references it.)
    #[napi]
    pub fn destroy(&self) {
        // Arc<wgpu::QuerySet> has no explicit destroy(); dropped when refcount reaches zero.
    }
}
