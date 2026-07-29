//! Where a resource's bytes actually come from — and the hook that lets the
//! caller change the answer.
//!
//! ## Why this is not the `gltf` crate's job
//!
//! The `gltf` crate ships an `import` feature that resolves URIs, decodes
//! `data:` payloads and decodes images, all in one call. This crate deliberately
//! does **not** enable it (see `Cargo.toml`), and this file is the replacement.
//!
//! The reason is the override hook. A glTF file names its external resources by
//! URI, and real pipelines need to intervene between "the file says
//! `textures/hull.png`" and "these bytes get decoded": to substitute a `.ktx2`
//! sidecar for a `.png`, to read out of an archive or a cache, or to skip a
//! resource entirely. `gltf::import` gives no seam for that — by the time it
//! returns, everything has already been read and decoded with its own `image`
//! copy. Resolving URIs here puts the seam exactly where it is useful, and as a
//! side effect keeps texture decoding on this crate's single pure-Rust path
//! rather than a second one bundled inside a dependency.
//!
//! ## The two-call shape
//!
//! You cannot write an override for a URI you have not seen, so the hook needs
//! the file's resource list first. That is what `inspectGltf` is for: it parses
//! the JSON (and the GLB container) and nothing else, so a caller can build
//! overrides from real URIs and hand them to `loadGltf`. `loadGltf` on its own,
//! with no overrides, is the ordinary case and costs one parse.
//!
//! ## No network
//!
//! `http:`/`https:` URIs are rejected rather than fetched. A loader that reaches
//! the network is a different security posture than one that reads files, and
//! this crate is not it — an override pointing at an already-downloaded file is
//! the supported way to consume a remote asset.

use super::enums::{GltfResourceKind, GltfResourceSource};
use crate::image::generic_err;
use base64::Engine as _;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// A caller-supplied substitution for one resource.
///
/// Matched by `index` (within its `kind`) or by the exact `uri` as it appears in
/// the file. Exactly one of `path`, `bytes` or `skip` says what to do.
///
/// `bytes` is the one place in this package where a byte array crosses the napi
/// boundary inbound, and it is a considered exception: the whole point of the
/// hook is to let JS supply data the filesystem does not have (an archive
/// member, a decrypted blob, a procedurally generated buffer). It is opt-in and
/// per-resource, so the default path still reads files only.
#[napi_derive::napi(object)]
pub struct GltfResourceOverride {
    /// Which index space `index` refers to. Required even when matching by URI,
    /// because buffers and images can name the same URI.
    pub kind: GltfResourceKind,
    /// Match `buffers[index]` / `images[index]`. Mutually exclusive with `uri`.
    pub index: Option<u32>,
    /// Match the resource whose `uri` is exactly this string, as written in the
    /// file (not percent-decoded, not resolved). Mutually exclusive with `index`.
    pub uri: Option<String>,
    /// Read this filesystem path instead. Relative paths resolve against the
    /// process working directory, not the glTF base directory — an override is
    /// the caller's own path, not the asset's.
    pub path: Option<String>,
    /// Use these bytes instead. Copied on the JS thread before the load starts.
    pub bytes: Option<napi::bindgen_prelude::Uint8Array>,
    /// Drop the resource. For an image this yields a `GltfTexture` with a `null`
    /// `texture`; for a buffer it is an error, since accessors would dangle.
    pub skip: Option<bool>,
}

/// The override table after it has been taken off the JS thread.
#[derive(Clone)]
pub(crate) enum Substitution {
    Path(PathBuf),
    Bytes(std::sync::Arc<Vec<u8>>),
    Skip,
}

#[derive(Default)]
pub(crate) struct Overrides {
    by_index: HashMap<(u8, u32), Substitution>,
    by_uri: HashMap<(u8, String), Substitution>,
}

fn kind_tag(k: GltfResourceKind) -> u8 {
    match k {
        GltfResourceKind::Buffer => 0,
        GltfResourceKind::Image => 1,
    }
}

impl Overrides {
    /// Validate and copy the JS-side overrides into owned, `Send` data.
    ///
    /// Runs **on the JS thread**, before the `AsyncTask` is created: `Uint8Array`
    /// borrows JS-owned memory, so its contents have to be copied out here
    /// rather than carried onto a worker.
    pub(crate) fn from_js(list: Option<Vec<GltfResourceOverride>>) -> napi::Result<Self> {
        let mut out = Overrides::default();
        for (i, o) in list.unwrap_or_default().into_iter().enumerate() {
            let action_count =
                o.path.is_some() as u8 + o.bytes.is_some() as u8 + o.skip.unwrap_or(false) as u8;
            if action_count != 1 {
                return Err(generic_err(format!(
                    "resourceOverrides[{i}]: set exactly one of `path`, `bytes` or `skip` ({action_count} were set)"
                )));
            }
            let action = if let Some(p) = o.path {
                Substitution::Path(PathBuf::from(p))
            } else if let Some(b) = o.bytes {
                Substitution::Bytes(std::sync::Arc::new(b.to_vec()))
            } else {
                Substitution::Skip
            };

            match (o.index, o.uri) {
                (Some(idx), None) => {
                    out.by_index.insert((kind_tag(o.kind), idx), action);
                }
                (None, Some(uri)) => {
                    out.by_uri.insert((kind_tag(o.kind), uri), action);
                }
                _ => {
                    return Err(generic_err(format!(
                        "resourceOverrides[{i}]: set exactly one of `index` or `uri`"
                    )));
                }
            }
        }
        Ok(out)
    }

    /// An index match wins over a URI match — it is the more specific of the two
    /// (several resources can share a URI; only one can have a given index).
    pub(crate) fn lookup(&self, kind: GltfResourceKind, index: u32, uri: Option<&str>) -> Option<&Substitution> {
        let tag = kind_tag(kind);
        self.by_index
            .get(&(tag, index))
            .or_else(|| uri.and_then(|u| self.by_uri.get(&(tag, u.to_owned()))))
    }

}

/// The bytes of a `data:` URI, plus the media type it declared.
pub(crate) struct DataUri {
    pub(crate) bytes: Vec<u8>,
    pub(crate) media_type: Option<String>,
}

/// Decode an RFC 2397 `data:` URI.
///
/// Both forms are handled: `;base64,` and plain percent-encoded text. glTF in
/// the wild is essentially always base64, but the non-base64 form is legal and
/// costs four lines to support.
pub(crate) fn decode_data_uri(uri: &str) -> napi::Result<DataUri> {
    let rest = uri
        .strip_prefix("data:")
        .ok_or_else(|| generic_err(format!("'{}' is not a data: URI", truncate(uri))))?;
    let (meta, payload) = rest
        .split_once(',')
        .ok_or_else(|| generic_err(format!("malformed data: URI (no comma): '{}'", truncate(uri))))?;

    let base64 = meta.ends_with(";base64");
    let media_type = {
        let m = meta.strip_suffix(";base64").unwrap_or(meta);
        let m = m.split(';').next().unwrap_or("");
        if m.is_empty() { None } else { Some(m.to_owned()) }
    };

    let bytes = if base64 {
        // glTF exporters emit standard base64; some emit it URL-safe. Accept
        // both, and tolerate missing padding — being strict here only ever
        // rejects files that every other viewer opens.
        let cleaned: String = payload.chars().filter(|c| !c.is_whitespace()).collect();
        base64::engine::general_purpose::STANDARD_NO_PAD
            .decode(cleaned.trim_end_matches('='))
            .or_else(|_| {
                base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(cleaned.trim_end_matches('='))
            })
            .map_err(|e| generic_err(format!("malformed base64 in data: URI: {e}")))?
    } else {
        percent_encoding::percent_decode_str(payload).collect()
    };

    Ok(DataUri { bytes, media_type })
}

/// Resolve a relative glTF URI against the asset's base directory.
///
/// glTF URIs are percent-encoded, so a file called `hull (final).png` appears as
/// `hull%20(final).png` and must be decoded before it names a real path. This is
/// the step that is easy to skip and that fails only on assets with spaces or
/// non-ASCII in their filenames — i.e. not on the sample models, and then on a
/// real one.
pub(crate) fn resolve_uri(base_dir: &Path, uri: &str) -> napi::Result<PathBuf> {
    if uri.starts_with("http://") || uri.starts_with("https://") {
        return Err(generic_err(format!(
            "'{}' is a network URI. This importer reads files only — download the asset first and \
             point a resourceOverride at the local copy.",
            truncate(uri)
        )));
    }
    let decoded = percent_encoding::percent_decode_str(uri)
        .decode_utf8()
        .map_err(|e| generic_err(format!("URI '{}' is not valid UTF-8 after percent-decoding: {e}", truncate(uri))))?;
    let path = Path::new(decoded.as_ref());
    Ok(if path.is_absolute() { path.to_path_buf() } else { base_dir.join(path) })
}

/// Classify a URI without decoding it — what `inspectGltf` reports.
pub(crate) fn classify(uri: Option<&str>) -> GltfResourceSource {
    match uri {
        None => GltfResourceSource::BinaryChunk,
        Some(u) if u.starts_with("data:") => GltfResourceSource::DataUri,
        Some(_) => GltfResourceSource::External,
    }
}

/// Data URIs run to megabytes; never put a whole one in an error message.
pub(crate) fn truncate(uri: &str) -> String {
    const MAX: usize = 96;
    if uri.len() <= MAX {
        uri.to_owned()
    } else {
        let cut = uri.char_indices().nth(MAX).map(|(i, _)| i).unwrap_or(MAX);
        format!("{}… ({} bytes)", &uri[..cut], uri.len())
    }
}
