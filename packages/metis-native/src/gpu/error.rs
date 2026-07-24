use napi::bindgen_prelude::*;

/// Prefer this over formatting an error with `{:?}`. wgpu's errors carry a
/// readable `Display` and a raw struct dump under `Debug` — the Debug form of a
/// validation error is the `Validation { source: ContextError { fn_ident: … } }`
/// wall, which is not something to hand to a JS caller. A `Debug`-based twin of
/// this function existed for a while and had no call sites left; don't reinstate
/// it without a case where `Display` genuinely loses information.
pub fn map_err_display<E: std::fmt::Display>(e: E) -> Error {
    Error::new(Status::GenericFailure, e.to_string())
}

/// Runs GPU work inside its own validation error scope **on the calling
/// thread**, turning anything wgpu complains about into a rejected promise.
///
/// This exists because wgpu 30 made error scopes thread-local. Everything the
/// `#[napi]` surface does synchronously runs on the JS thread, so a caller's
/// `pushErrorScope()` covers it — but work inside an `AsyncTask::compute` runs
/// on a libuv worker, where the caller's scope does not exist. Before wgpu 30
/// scopes were device-global and did cover it, so this is a regression the
/// upgrade would otherwise have introduced silently: the operation still
/// returns a plausible-looking handle, and the error only reaches stderr via
/// `onuncapturederror`.
///
/// Wrapping the work here is *better* than the behaviour it restores. A caller
/// no longer has to remember to bracket an async load in an error scope to find
/// out it failed — a texture that wgpu rejected now rejects the promise, in
/// keeping with this module's "mismatches are errors, never guesses" rule.
///
/// The pop is blocking, which is free: on native backends wgpu returns an
/// already-resolved future, and this only ever runs on a worker thread anyway.
pub(crate) fn with_validation_scope<T>(
    device: &wgpu::Device,
    label: &str,
    work: impl FnOnce() -> Result<T>,
) -> Result<T> {
    let guard = device.push_error_scope(wgpu::ErrorFilter::Validation);
    let produced = work();
    // Pop before the `?` below: the guard must close even when `work` bailed
    // out on its own, or the scope leaks and the next pop on this thread pairs
    // with the wrong push.
    let captured = napi::bindgen_prelude::block_on(guard.pop());

    let value = produced?;
    match captured {
        None => Ok(value),
        Some(e) => Err(Error::new(
            Status::GenericFailure,
            format!("{label}: {e}"),
        )),
    }
}

pub fn invalid_enum(field: &str, value: &str) -> Error {
    Error::new(
        Status::InvalidArg,
        format!("invalid value '{value}' for {field}"),
    )
}
