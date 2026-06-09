//! Load [`crate::Scenario`]s from JSON / YAML on disk or in memory.
//!
//! YAML support is provided through `serde_yml` (the actively-maintained
//! fork of the deprecated `serde_yaml` crate). The loader picks the format
//! based on the file extension; explicit helpers are also available.

use std::path::Path;

use thiserror::Error;

use crate::scenario::Scenario;

#[derive(Debug, Error)]
pub enum LoaderError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("yaml: {0}")]
    Yaml(#[from] serde_yml::Error),
    #[error("unsupported extension: {0}")]
    UnsupportedExtension(String),
}

pub fn load_from_path<P: AsRef<Path>>(path: P) -> Result<Scenario, LoaderError> {
    let path = path.as_ref();
    let bytes = std::fs::read(path)?;
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase());
    match ext.as_deref() {
        Some("yaml") | Some("yml") => from_yaml(&bytes),
        Some("json") => from_json(&bytes),
        Some(other) => Err(LoaderError::UnsupportedExtension(other.into())),
        None => Err(LoaderError::UnsupportedExtension("".into())),
    }
}

pub fn from_json(bytes: &[u8]) -> Result<Scenario, LoaderError> {
    Ok(serde_json::from_slice(bytes)?)
}

pub fn from_yaml(bytes: &[u8]) -> Result<Scenario, LoaderError> {
    Ok(serde_yml::from_slice(bytes)?)
}

pub fn to_json(scenario: &Scenario) -> Result<String, LoaderError> {
    Ok(serde_json::to_string_pretty(scenario)?)
}

pub fn to_yaml(scenario: &Scenario) -> Result<String, LoaderError> {
    Ok(serde_yml::to_string(scenario)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library;
    use tempfile::tempdir;

    #[test]
    fn json_roundtrip() {
        let s = library::yellow_to_safety_car();
        let json = to_json(&s).unwrap();
        let back = from_json(json.as_bytes()).unwrap();
        assert_eq!(s, back);
    }

    #[test]
    fn yaml_roundtrip() {
        let s = library::yellow_to_safety_car();
        let yaml = to_yaml(&s).unwrap();
        let back = from_yaml(yaml.as_bytes()).unwrap();
        assert_eq!(s, back);
    }

    #[test]
    fn load_from_path_picks_format_by_extension() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("s.yaml");
        std::fs::write(&p, to_yaml(&library::yellow_to_safety_car()).unwrap()).unwrap();
        let back = load_from_path(&p).unwrap();
        assert_eq!(back.name, "yellow_to_safety_car");
    }
}
