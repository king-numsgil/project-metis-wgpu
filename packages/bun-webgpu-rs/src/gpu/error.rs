use napi::bindgen_prelude::*;

pub fn map_err<E: std::fmt::Debug>(e: E) -> Error {
    Error::new(Status::GenericFailure, format!("{e:?}"))
}

pub fn map_err_display<E: std::fmt::Display>(e: E) -> Error {
    Error::new(Status::GenericFailure, e.to_string())
}

pub fn invalid_enum(field: &str, value: &str) -> Error {
    Error::new(
        Status::InvalidArg,
        format!("invalid value '{value}' for {field}"),
    )
}
