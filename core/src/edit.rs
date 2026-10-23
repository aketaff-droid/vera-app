//! A corrected card written into the copy sent to the Kobo. The book in the watched folder is never modified:
//! the corrected copy is made on the PC, in Vera's staging folder.
use crate::{
    metadata::{entry, opf_path, Metadata},
    Result,
};
use quick_xml::{
    events::{BytesEnd, BytesStart, BytesText, Event},
    Reader, Writer,
};
use std::{
    fs::File,
    io::{Cursor, Write},
    path::Path,
};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

/// The book as Vera sends or shares it: its corrected card written in, and for an EPUB without a cover the one
/// Vera made. The copy is made in `work`; the book itself is returned when there is nothing to change, or when the
/// change cannot be written (an encrypted PDF…). The watched folder is only read.
pub fn corrected_copy(store: &crate::store::Store, book: &crate::store::Book, work: &Path) -> Result<std::path::PathBuf> {
    let source = Path::new(&book.path);
    let mut base = source.to_path_buf();
    if let Some((card, _)) = store.edit(&book.hash)? {
        let corrected = work.join(format!("corrige.{}", book.format));
        if apply(source, &card, &corrected).is_ok() {
            base = corrected;
        }
    }
    // An EPUB without a cover takes the one Vera made; without it, the Kobo shows a blank one.
    if book.format == "epub" && book.made_cover {
        if let Some(png) = book.cover.as_ref().and_then(|c| std::fs::read(c).ok()) {
            let covered = work.join("couverture.epub");
            if add_cover(&base, &png, &covered).is_ok() {
                base = covered;
            }
        }
    }
    Ok(base)
}

/// Writes `source` with `edit` applied to `out`.
pub fn apply(source: &Path, edit: &Metadata, out: &Path) -> Result<()> {
    match source.extension().and_then(|e| e.to_str()).map(str::to_lowercase).as_deref() {
        Some("epub") => epub(source, edit, out),
        Some("pdf") => pdf(source, edit, out),
        _ => Err("Seuls les EPUB et les PDF peuvent être corrigés.".into()),
    }
}

fn epub(source: &Path, edit: &Metadata, out: &Path) -> Result<()> {
    let mut zip = ZipArchive::new(File::open(source).map_err(|e| e.to_string())?).map_err(|_| "L’archive EPUB est invalide.")?;
    let opf = opf_path(&mut zip)?;
    let xml = entry(&mut zip, &opf, 2 * 1024 * 1024)?;
    let rewritten = rewrite_opf(&xml, edit)?;
    let mut writer = ZipWriter::new(File::create(out).map_err(|e| e.to_string())?);
    for index in 0..zip.len() {
        let file = zip.by_index_raw(index).map_err(|e| e.to_string())?;
        if file.name() == opf {
            let name = file.name().to_string();
            drop(file);
            writer
                .start_file(name, SimpleFileOptions::default().compression_method(CompressionMethod::Deflated))
                .map_err(|e| e.to_string())?;
            writer.write_all(&rewritten).map_err(|e| e.to_string())?;
        } else {
            // Every other entry, mimetype first and stored, is copied byte for byte.
            writer.raw_copy_file(file).map_err(|e| e.to_string())?;
        }
    }
    writer.finish().map_err(|e| e.to_string())?.sync_all().map_err(|e| e.to_string())
}

/// The values a corrected card gives each Dublin Core element; an empty list removes the element.
fn values(edit: &Metadata, field: &str) -> Option<Vec<String>> {
    let one = |v: &str| if v.trim().is_empty() { vec![] } else { vec![v.trim().to_string()] };
    Some(match field {
        "title" => one(&edit.title),
        "creator" => edit.authors.split(" · ").map(str::trim).filter(|a| !a.is_empty()).map(String::from).collect(),
        "language" => one(&edit.language),
        "publisher" => one(&edit.publisher),
        "date" => one(&edit.published),
        "description" => one(&edit.description),
        "subject" => edit.subjects.iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect(),
        _ => return None,
    })
}

const ORDER: [&str; 7] = ["title", "creator", "language", "publisher", "date", "description", "subject"];

/// The OPF with the corrected elements: the first element of each kind keeps its place and attributes (an `id`
/// may be referred to), the others of that kind are dropped, and missing ones are added at the end.
pub(crate) fn rewrite_opf(xml: &[u8], edit: &Metadata) -> Result<Vec<u8>> {
    let mut reader = Reader::from_reader(xml);
    let mut writer = Writer::new(Cursor::new(Vec::new()));
    let mut in_metadata = false;
    let mut skipping = 0usize;
    let mut written: Vec<&str> = Vec::new();
    let mut prefix = String::from("dc");
    let write = |w: &mut Writer<Cursor<Vec<u8>>>, e: Event| w.write_event(e).map_err(|e| e.to_string());
    loop {
        let event = reader.read_event().map_err(|e| format!("OPF illisible : {e}"))?;
        if skipping > 0 {
            match event {
                Event::Start(_) => skipping += 1,
                Event::End(_) => skipping -= 1,
                Event::Eof => return Err("OPF tronqué.".into()),
                _ => {}
            }
            continue;
        }
        match event {
            Event::Start(ref e) | Event::Empty(ref e) if in_metadata && dc_field(e).is_some() => {
                let field = dc_field(e).unwrap();
                let empty = matches!(event, Event::Empty(_));
                if !empty {
                    skipping = 1;
                }
                if written.contains(&field) {
                    continue;
                }
                written.push(field);
                if let Some((p, _)) = std::str::from_utf8(e.name().as_ref()).unwrap_or("").split_once(':') {
                    prefix = p.to_string();
                }
                let name = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                for (i, value) in values(edit, field).unwrap_or_default().iter().enumerate() {
                    let start = if i == 0 { e.to_owned() } else { BytesStart::new(name.clone()) };
                    write(&mut writer, Event::Start(start))?;
                    write(&mut writer, Event::Text(BytesText::new(value)))?;
                    write(&mut writer, Event::End(BytesEnd::new(name.clone())))?;
                }
            }
            Event::Start(ref e) if e.local_name().as_ref() == b"metadata" => {
                in_metadata = true;
                write(&mut writer, event)?;
            }
            Event::End(ref e) if e.local_name().as_ref() == b"metadata" => {
                for field in ORDER.iter().filter(|f| !written.contains(f)) {
                    let name = format!("{prefix}:{field}");
                    for value in values(edit, field).unwrap_or_default() {
                        write(&mut writer, Event::Start(BytesStart::new(name.clone())))?;
                        write(&mut writer, Event::Text(BytesText::new(&value)))?;
                        write(&mut writer, Event::End(BytesEnd::new(name.clone())))?;
                    }
                }
                in_metadata = false;
                write(&mut writer, event)?;
            }
            Event::Eof => break,
            other => write(&mut writer, other)?,
        }
    }
    Ok(writer.into_inner().into_inner())
}

/// Name of the cover Vera adds, beside the OPF.
const COVER: &str = "vera-cover.png";

/// Writes `source` with `png` as its cover to `out`: the image beside the OPF, declared both ways readers look
/// for it (EPUB 2's `<meta name="cover">`, EPUB 3's `cover-image`). Refused when the book already declares one.
pub fn add_cover(source: &Path, png: &[u8], out: &Path) -> Result<()> {
    let mut zip = ZipArchive::new(File::open(source).map_err(|e| e.to_string())?).map_err(|_| "L’archive EPUB est invalide.")?;
    let opf = opf_path(&mut zip)?;
    let xml = entry(&mut zip, &opf, 2 * 1024 * 1024)?;
    let image = match opf.rsplit_once('/') {
        Some((dir, _)) => format!("{dir}/{COVER}"),
        None => COVER.to_string(),
    };
    if zip.file_names().any(|n| n == image) {
        return Err("Couverture déjà ajoutée.".into());
    }
    let rewritten = declare_cover(&xml)?;
    let mut writer = ZipWriter::new(File::create(out).map_err(|e| e.to_string())?);
    for index in 0..zip.len() {
        let file = zip.by_index_raw(index).map_err(|e| e.to_string())?;
        if file.name() == opf {
            let name = file.name().to_string();
            drop(file);
            writer
                .start_file(name, SimpleFileOptions::default().compression_method(CompressionMethod::Deflated))
                .map_err(|e| e.to_string())?;
            writer.write_all(&rewritten).map_err(|e| e.to_string())?;
        } else {
            writer.raw_copy_file(file).map_err(|e| e.to_string())?;
        }
    }
    // A PNG is already compressed.
    writer.start_file(image, SimpleFileOptions::default().compression_method(CompressionMethod::Stored)).map_err(|e| e.to_string())?;
    writer.write_all(png).map_err(|e| e.to_string())?;
    writer.finish().map_err(|e| e.to_string())?.sync_all().map_err(|e| e.to_string())
}

/// The OPF with the cover item at the end of the manifest and its `<meta>` at the end of the metadata.
pub(crate) fn declare_cover(xml: &[u8]) -> Result<Vec<u8>> {
    let mut reader = Reader::from_reader(xml);
    let mut writer = Writer::new(Cursor::new(Vec::new()));
    let mut epub3 = false;
    let (mut manifest, mut metadata) = (false, false);
    let write = |w: &mut Writer<Cursor<Vec<u8>>>, e: Event| w.write_event(e).map_err(|e| e.to_string());
    let attr = |e: &BytesStart, key: &[u8]| -> Option<String> {
        e.attributes().flatten().find(|a| a.key.local_name().as_ref() == key).and_then(|a| a.unescape_value().ok()).map(|v| v.into_owned())
    };
    loop {
        let event = reader.read_event().map_err(|e| format!("OPF illisible : {e}"))?;
        match &event {
            Event::Start(e) if e.local_name().as_ref() == b"package" => {
                epub3 = attr(e, b"version").is_some_and(|v| v.starts_with('3'));
            }
            Event::Start(e) | Event::Empty(e) if e.local_name().as_ref() == b"meta" && attr(e, b"name").as_deref() == Some("cover") => {
                return Err("Ce livre déclare déjà une couverture.".into());
            }
            Event::Start(e) | Event::Empty(e)
                if e.local_name().as_ref() == b"item" && attr(e, b"properties").is_some_and(|p| p.split_whitespace().any(|p| p == "cover-image")) =>
            {
                return Err("Ce livre déclare déjà une couverture.".into());
            }
            Event::End(e) if e.local_name().as_ref() == b"manifest" => {
                let name = String::from_utf8_lossy(e.name().as_ref()).replace("manifest", "item");
                let mut item = BytesStart::new(name);
                item.push_attribute(("id", "vera-cover"));
                item.push_attribute(("href", COVER));
                item.push_attribute(("media-type", "image/png"));
                if epub3 {
                    item.push_attribute(("properties", "cover-image"));
                }
                write(&mut writer, Event::Empty(item))?;
                manifest = true;
            }
            Event::End(e) if e.local_name().as_ref() == b"metadata" => {
                let qualified = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                let mut meta = BytesStart::new(qualified.replace("metadata", "meta"));
                meta.push_attribute(("name", "cover"));
                meta.push_attribute(("content", "vera-cover"));
                write(&mut writer, Event::Empty(meta))?;
                metadata = true;
            }
            Event::Eof => break,
            _ => {}
        }
        write(&mut writer, event)?;
    }
    if !(manifest && metadata) {
        return Err("OPF sans manifeste ni métadonnées.".into());
    }
    Ok(writer.into_inner().into_inner())
}

fn dc_field(e: &BytesStart) -> Option<&'static str> {
    let name = e.name();
    let qualified = std::str::from_utf8(name.as_ref()).ok()?;
    // Only Dublin Core elements (dc:title…); the OPF's own <meta> elements stay as they are.
    if !qualified.contains(':') {
        return None;
    }
    let local = qualified.rsplit(':').next()?;
    ORDER.iter().copied().find(|f| *f == local)
}

fn pdf(source: &Path, edit: &Metadata, out: &Path) -> Result<()> {
    use lopdf::{Dictionary, Object, StringFormat};
    let mut doc = lopdf::Document::load(source).map_err(|e| format!("PDF illisible : {e}"))?;
    if doc.is_encrypted() {
        return Err("PDF chiffré : la fiche ne peut pas y être écrite.".into());
    }
    let text = |value: &str| {
        let mut bytes = vec![0xFE, 0xFF];
        bytes.extend(value.encode_utf16().flat_map(|u| u.to_be_bytes()));
        Object::String(bytes, StringFormat::Hexadecimal)
    };
    let info_id = match doc.trailer.get(b"Info").and_then(Object::as_reference) {
        Ok(id) => id,
        Err(_) => {
            let id = doc.add_object(Dictionary::new());
            doc.trailer.set("Info", Object::Reference(id));
            id
        }
    };
    let info = doc.get_object_mut(info_id).and_then(Object::as_dict_mut).map_err(|e| e.to_string())?;
    info.set("Title", text(&edit.title));
    info.set("Author", text(&edit.authors.replace(" · ", ", ")));
    doc.save(out).map_err(|e| format!("PDF non enregistré : {e}"))?;
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::{metadata::inspect, store::tests::{fixture, Sandbox}};

    #[test]
    fn a_corrected_epub_carries_the_card_and_everything_else_untouched() {
        let sandbox = Sandbox::new();
        let source = fixture("first.epub");
        let before = crate::util::hash_file(&source).unwrap();
        let mut card = inspect(&source).unwrap().metadata;
        card.title = "Titre & corrigé".into();
        card.authors = "Alexandre Dumas · Auguste Maquet".into();
        card.subjects = vec![];
        card.publisher = "Le Livre de Poche".into();
        let out = sandbox.0.join("copie.epub");
        apply(&source, &card, &out).unwrap();
        let read = inspect(&out).unwrap();
        assert_eq!(read.metadata.title, "Titre & corrigé");
        assert_eq!(read.metadata.authors, "Alexandre Dumas · Auguste Maquet");
        assert!(read.metadata.subjects.is_empty());
        assert_eq!(read.metadata.publisher, "Le Livre de Poche");
        assert!(read.cover.is_some(), "the cover survives");
        assert_eq!(crate::util::hash_file(&source).unwrap(), before, "the original is untouched");
        let mut zip = ZipArchive::new(File::open(&out).unwrap()).unwrap();
        let first = zip.by_index(0).unwrap();
        assert_eq!((first.name(), first.compression()), ("mimetype", CompressionMethod::Stored));
    }

    #[test]
    fn missing_elements_are_added_and_the_identifier_kept() {
        let opf = br##"<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">x</dc:identifier><dc:title id="t">Old</dc:title><dc:title>Sub</dc:title><meta refines="#t" property="title-type">main</meta></metadata><manifest/></package>"##;
        let card = Metadata { title: "Nouveau".into(), authors: "A".into(), language: "fr".into(), ..Metadata::default() };
        let out = String::from_utf8(rewrite_opf(opf, &card).unwrap()).unwrap();
        assert!(out.contains(r#"<dc:title id="t">Nouveau</dc:title>"#));
        assert!(!out.contains("Sub") && !out.contains("Old"));
        assert!(out.contains(r#"<dc:identifier id="id">x</dc:identifier>"#));
        assert!(out.contains(r##"<meta refines="#t" property="title-type">main</meta>"##));
        assert!(out.contains("<dc:creator>A</dc:creator>") && out.contains("<dc:language>fr</dc:language>"));
    }

    #[test]
    fn a_made_cover_is_added_to_a_copy_of_a_book_without_one() {
        let sandbox = Sandbox::new();
        let source = sandbox.0.join("sans.epub");
        epub_without_cover(&fixture("second.epub"), &source);
        assert!(inspect(&source).unwrap().cover.is_none(), "fixture without a cover");
        let png = crate::cover::drawn("Titre", "Autrice", "abc").unwrap();
        let out = sandbox.0.join("avec.epub");
        let before = crate::util::hash_file(&source).unwrap();
        add_cover(&source, &png, &out).unwrap();
        let read = inspect(&out).unwrap();
        assert_eq!(read.cover.map(|c| c.bytes), Some(png.clone()), "the reader finds the cover");
        assert_eq!(read.metadata.title, inspect(&source).unwrap().metadata.title);
        assert_eq!(crate::util::hash_file(&source).unwrap(), before, "the original is untouched");
        assert!(add_cover(&out, &png, &sandbox.0.join("deux.epub")).is_err(), "never twice");
        assert!(add_cover(&fixture("first.epub"), &png, &sandbox.0.join("x.epub")).is_err(), "a real cover is kept");
    }

    #[test]
    fn an_epub_2_gets_the_cover_declared_its_own_way() {
        let opf = br#"<opf:package xmlns:opf="http://www.idpf.org/2007/opf" version="2.0"><opf:metadata><dc:title xmlns:dc="x">T</dc:title></opf:metadata><opf:manifest><opf:item id="a" href="a.html" media-type="application/xhtml+xml"/></opf:manifest></opf:package>"#;
        let out = String::from_utf8(declare_cover(opf).unwrap()).unwrap();
        assert!(out.contains(r#"<opf:item id="vera-cover" href="vera-cover.png" media-type="image/png"/></opf:manifest>"#), "{out}");
        assert!(out.contains(r#"<opf:meta name="cover" content="vera-cover"/></opf:metadata>"#), "{out}");
    }

    /// A copy of an EPUB whose OPF declares no cover.
    pub(crate) fn epub_without_cover(from: &Path, to: &Path) {
        let mut zip = ZipArchive::new(File::open(from).unwrap()).unwrap();
        let opf = opf_path(&mut zip).unwrap();
        let xml = String::from_utf8(entry(&mut zip, &opf, 1 << 20).unwrap()).unwrap();
        let mut w = ZipWriter::new(File::create(to).unwrap());
        for i in 0..zip.len() {
            let f = zip.by_index_raw(i).unwrap();
            if f.name() == opf {
                drop(f);
                w.start_file(opf.clone(), SimpleFileOptions::default()).unwrap();
                w.write_all(without_cover(&xml).as_bytes()).unwrap();
            } else {
                w.raw_copy_file(f).unwrap();
            }
        }
        w.finish().unwrap();
    }

    /// The OPF without any cover declaration.
    fn without_cover(xml: &str) -> String {
        let mut out = String::new();
        for part in xml.split_inclusive('>') {
            let tag = part.trim_start();
            let lower = tag.to_lowercase();
            let is_cover = (lower.contains("<meta") && lower.contains("name=\"cover\""))
                || (lower.contains("<item") && lower.contains("cover-image"));
            if !is_cover {
                out.push_str(part);
            } else if let Some(text) = part.split('<').next() {
                out.push_str(text);
            }
        }
        out
    }

    #[test]
    fn a_corrected_pdf_carries_title_and_author() {
        let sandbox = Sandbox::new();
        let card = Metadata { title: "Les Misérables".into(), authors: "Victor Hugo".into(), ..Metadata::default() };
        let out = sandbox.0.join("copie.pdf");
        apply(&fixture("sample.pdf"), &card, &out).unwrap();
        let read = inspect(&out).unwrap();
        assert_eq!((read.metadata.title.as_str(), read.metadata.authors.as_str()), ("Les Misérables", "Victor Hugo"));
    }
}
