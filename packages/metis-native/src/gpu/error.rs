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

pub fn invalid_enum(field: &str, value: &str) -> Error {
    Error::new(
        Status::InvalidArg,
        format!("invalid value '{value}' for {field}"),
    )
}
