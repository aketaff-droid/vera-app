use crate::Result;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

pub fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or_default()
}

/// Size and modification time: a file whose stamp did not change is not read again.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Stamp {
    pub size: u64,
    pub modified: i64,
}

pub fn stamp(path: &Path) -> Result<Stamp> {
    let meta = path.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("Ce chemin n’est pas un fichier.".into());
    }
    let modified = meta.modified().map_err(|e| e.to_string())?;
    let modified = modified.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or_default();
    Ok(Stamp { size: meta.len(), modified })
}

pub fn hash_file(path: &Path) -> Result<String> {
    let mut file = File::open(path).map_err(|e| format!("{} : {e}", path.display()))?;
    let mut sha = Sha256::new();
    let mut buffer = vec![0; 1024 * 1024];
    loop {
        let n = file.read(&mut buffer).map_err(|e| format!("{} : {e}", path.display()))?;
        if n == 0 {
            break;
        }
        sha.update(&buffer[..n]);
    }
    Ok(format!("{:x}", sha.finalize()))
}

pub fn hash_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// A path compared the Windows way: no extended-length prefix, either slash, case ignored.
pub fn path_key(path: &Path) -> String {
    path.to_string_lossy().trim_start_matches(r"\\?\").replace('/', "\\").to_lowercase()
}

/// Writes a small file beside its target, then renames it, so a reader never sees it half written.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let temp = path.with_extension("part");
    let mut file = File::create(&temp).map_err(|e| e.to_string())?;
    file.write_all(bytes).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);
    fs::rename(&temp, path).map_err(|e| e.to_string())
}

/// Free bytes on the volume holding `path`.
pub fn free_space(path: &Path) -> Result<u64> {
    fs4::available_space(path).map_err(|e| format!("Espace libre illisible : {e}"))
}
