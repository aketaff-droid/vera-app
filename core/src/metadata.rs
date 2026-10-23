//! Title, authors and cover read from an EPUB or a PDF. Bounded reads: a damaged or hostile file gives an
//! error, never a crash or an unbounded allocation.
use crate::Result;
use quick_xml::{events::Event, Reader};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs::File,
    io::Read,
    path::{Component, Path, PathBuf},
};
use zip::ZipArchive;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Metadata {
    pub title: String,
    pub authors: String,
    pub language: String,
    pub isbn: Option<String>,
    pub publisher: String,
    pub published: String,
    pub subjects: Vec<String>,
    pub description: String,
}

pub struct Cover {
    pub extension: &'static str,
    pub bytes: Vec<u8>,
}

pub struct Inspected {
    pub metadata: Metadata,
    pub cover: Option<Cover>,
}

/// Reads a book. A missing title falls back to the file name.
pub fn inspect(path: &Path) -> Result<Inspected> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let mut inspected = match ext.as_str() {
        "epub" => epub(path)?,
        "pdf" => pdf(path)?,
        _ => return Err("Seuls les EPUB et les PDF sont pris en charge.".into()),
    };
    if inspected.metadata.title.trim().is_empty() {
        inspected.metadata.title = path.file_stem().unwrap_or_default().to_string_lossy().into_owned();
    }
    Ok(inspected)
}

pub(crate) fn entry(zip: &mut ZipArchive<File>, name: &str, limit: u64) -> Result<Vec<u8>> {
    let file = zip.by_name(name).map_err(|_| format!("EPUB incomplet : {name} absent."))?;
    if file.size() > limit {
        return Err(format!("Ressource EPUB trop volumineuse : {name}."));
    }
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes).map_err(|_| "L’archive s’arrête avant la fin.".to_string())?;
    if bytes.len() as u64 > limit {
        return Err("Ressource EPUB au-delà de la limite de lecture.".into());
    }
    Ok(bytes)
}

fn attrs(start: &quick_xml::events::BytesStart<'_>, reader: &Reader<&[u8]>) -> Result<BTreeMap<String, String>> {
    start
        .attributes()
        .map(|a| {
            let a = a.map_err(|e| e.to_string())?;
            let value = a.decode_and_unescape_value(reader.decoder()).map_err(|e| e.to_string())?;
            Ok((String::from_utf8_lossy(a.key.as_ref()).into_owned(), value.into_owned()))
        })
        .collect()
}

/// A path inside the archive, resolved against `base`; anything leaving the archive is refused.
pub(crate) fn resource(base: &Path, href: &str) -> Result<String> {
    let href = percent_encoding::percent_decode_str(href.split('#').next().unwrap_or(""))
        .decode_utf8()
        .map_err(|_| "Chemin EPUB non UTF-8.")?;
    if href.contains('\\') || href.contains(':') {
        return Err("Chemin EPUB externe refusé.".into());
    }
    let mut path = PathBuf::from(base);
    for part in Path::new(href.as_ref()).components() {
        match part {
            Component::Normal(p) => path.push(p),
            Component::CurDir => {}
            Component::ParentDir => {
                if !path.pop() {
                    return Err("Chemin EPUB hors archive.".into());
                }
            }
            _ => return Err("Chemin EPUB absolu refusé.".into()),
        }
    }
    Ok(path.to_string_lossy().replace('\\', "/"))
}

/// The OPF's path inside an EPUB, from META-INF/container.xml.
pub(crate) fn opf_path(zip: &mut ZipArchive<File>) -> Result<String> {
    if entry(zip, "mimetype", 128)? != b"application/epub+zip" {
        return Err("Le fichier n’est pas un EPUB reconnu.".into());
    }
    let container = entry(zip, "META-INF/container.xml", 128 * 1024)?;
    let mut reader = Reader::from_reader(container.as_slice());
    loop {
        match reader.read_event().map_err(|e| e.to_string())? {
            Event::Start(e) | Event::Empty(e) if e.local_name().as_ref() == b"rootfile" => {
                if let Some(path) = attrs(&e, &reader)?.get("full-path") {
                    return resource(Path::new(""), path);
                }
            }
            Event::Eof => return Err("EPUB sans document OPF.".into()),
            _ => {}
        }
    }
}

const FIELDS: [&str; 8] = ["title", "creator", "language", "identifier", "publisher", "date", "subject", "description"];

fn epub(path: &Path) -> Result<Inspected> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut zip = ZipArchive::new(file).map_err(|_| "L’archive EPUB est invalide ou incomplète.")?;
    let opf = opf_path(&mut zip)?;
    let xml = String::from_utf8(entry(&mut zip, &opf, 2 * 1024 * 1024)?).map_err(|_| "Métadonnées EPUB non UTF-8.")?;
    // No per-event trimming: it would drop the spaces around an entity (« A &amp; B » read as « A&B »);
    // whitespace is collapsed once the whole value is read.
    let mut reader = Reader::from_str(&xml);
    let mut values: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let (mut field, mut inside, mut buffer) = (None::<String>, false, String::new());
    let (mut manifest, mut cover_id, mut cover_href) = (BTreeMap::new(), None, None);
    loop {
        match reader.read_event().map_err(|e| e.to_string())? {
            Event::Start(e) | Event::Empty(e) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).into_owned();
                if name == "metadata" {
                    inside = true;
                }
                if inside && FIELDS.contains(&name.as_str()) {
                    field = Some(name.clone());
                    buffer.clear();
                }
                if name == "meta" {
                    let a = attrs(&e, &reader)?;
                    if a.get("name").map(String::as_str) == Some("cover") {
                        cover_id = a.get("content").cloned();
                    }
                }
                if name == "item" {
                    let a = attrs(&e, &reader)?;
                    if let (Some(id), Some(href)) = (a.get("id"), a.get("href")) {
                        manifest.insert(id.clone(), href.clone());
                        if a.get("properties").is_some_and(|p| p.split_whitespace().any(|p| p == "cover-image")) {
                            cover_href = Some(href.clone());
                        }
                    }
                }
            }
            Event::Text(e) if field.is_some() => {
                let text = e.decode().map_err(|e| e.to_string())?;
                buffer.push_str(&quick_xml::escape::unescape(&text).map_err(|e| e.to_string())?);
            }
            Event::CData(e) if field.is_some() => buffer.push_str(&e.decode().map_err(|e| e.to_string())?),
            Event::GeneralRef(e) if field.is_some() => {
                let text = format!("&{};", e.decode().map_err(|e| e.to_string())?);
                buffer.push_str(&quick_xml::escape::unescape(&text).map_err(|e| e.to_string())?);
            }
            Event::End(e) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).into_owned();
                if field.as_deref() == Some(name.as_str()) {
                    values.entry(name.clone()).or_default().push(buffer.split_whitespace().collect::<Vec<_>>().join(" "));
                    field = None;
                }
                if name == "metadata" {
                    inside = false;
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    let first = |key: &str| values.get(key).and_then(|v| v.first()).cloned().unwrap_or_default();
    let metadata = Metadata {
        title: first("title"),
        authors: values.get("creator").cloned().unwrap_or_default().join(" · "),
        language: first("language"),
        isbn: values.get("identifier").and_then(|v| v.iter().find_map(|v| isbn(v))),
        publisher: first("publisher"),
        published: first("date"),
        subjects: values.get("subject").cloned().unwrap_or_default(),
        description: first("description"),
    };
    let mut cover = None;
    if let Some(href) = cover_href.or_else(|| cover_id.and_then(|id| manifest.get(&id).cloned())) {
        let name = resource(Path::new(&opf).parent().unwrap_or(Path::new("")), &href)?;
        if let Ok(bytes) = entry(&mut zip, &name, 8 * 1024 * 1024) {
            cover = image_kind(&bytes).map(|extension| Cover { extension, bytes });
        }
    }
    Ok(Inspected { metadata, cover })
}

fn image_kind(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("jpg")
    } else if bytes.len() > 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
}

fn pdf(path: &Path) -> Result<Inspected> {
    let mut header = [0; 5];
    File::open(path).map_err(|e| e.to_string())?.read_exact(&mut header).map_err(|_| "PDF incomplet.")?;
    if &header != b"%PDF-" {
        return Err("En-tête PDF invalide.".into());
    }
    let mut metadata = Metadata::default();
    if path.metadata().map_err(|e| e.to_string())?.len() > 256 * 1024 * 1024 {
        return Ok(Inspected { metadata, cover: None });
    }
    let doc = lopdf::Document::load(path).map_err(|e| format!("PDF illisible : {e}"))?;
    let mut values = BTreeMap::new();
    if let Ok(info) = doc.trailer.get(b"Info") {
        let object = match info.as_reference() {
            Ok(id) => doc.get_object(id).unwrap_or(info),
            Err(_) => info,
        };
        if let Ok(dict) = object.as_dict() {
            for (key, value) in dict.iter() {
                if value.as_str().is_ok() {
                    if let Ok(text) = lopdf::decode_text_string(value) {
                        values.insert(String::from_utf8_lossy(key).into_owned(), text.trim_start_matches('\u{feff}').to_owned());
                    }
                }
            }
        }
    }
    let get = |k: &str| values.get(k).cloned().unwrap_or_default();
    metadata.title = get("Title");
    metadata.authors = get("Author");
    metadata.description = get("Subject");
    Ok(Inspected { metadata, cover: None })
}

/// A valid ISBN-10 or ISBN-13, without separators.
pub fn isbn(value: &str) -> Option<String> {
    let value = value.trim();
    let value = value.strip_prefix("urn:isbn:").unwrap_or(value);
    let clean = value.replace(['-', ' '], "").to_uppercase();
    let digits: Vec<u32> = clean
        .chars()
        .enumerate()
        .map(|(i, c)| if c == 'X' && i == 9 { Some(10) } else { c.to_digit(10) })
        .collect::<Option<_>>()?;
    let valid = match digits.len() {
        10 => digits.iter().enumerate().map(|(i, d)| (10 - i as u32) * d).sum::<u32>() % 11 == 0,
        13 => digits.iter().enumerate().map(|(i, d)| if i % 2 == 0 { *d } else { 3 * d }).sum::<u32>() % 10 == 0,
        _ => false,
    };
    valid.then_some(clean)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures").join(name)
    }

    #[test]
    fn identifiers_and_paths() {
        assert_eq!(isbn("urn:isbn:978-0-306-40615-7"), Some("9780306406157".into()));
        assert!(isbn("9780306406158").is_none());
        assert_eq!(isbn("0-8044-2957-X"), Some("080442957X".into()));
        assert!(resource(Path::new("OEBPS"), "../../outside").is_err());
        assert!(resource(Path::new(""), "https://example.com/a").is_err());
        assert_eq!(resource(Path::new("OEBPS"), "images/cover%20a.png").unwrap(), "OEBPS/images/cover a.png");
    }

    #[test]
    fn reads_epub_pdf_and_refuses_the_rest() {
        let book = inspect(&fixture("first.epub")).unwrap();
        assert!(!book.metadata.title.is_empty());
        assert!(inspect(&fixture("sample.pdf")).is_ok());
        assert!(inspect(&fixture("broken.epub")).is_err());
        assert!(inspect(&fixture("representative.json")).is_err());
    }
}
