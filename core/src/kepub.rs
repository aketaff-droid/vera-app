//! EPUB → KEPUB with kepubify, the Kobo's own flavour of EPUB. A KEPUB is only kept when it is faithful to its
//! source: same chapters, same language, same images, the same visible text in every chapter, and the Kobo
//! markers present. Otherwise the plain EPUB is sent, which the Kobo also reads.
use crate::{
    metadata::{entry, opf_path, resource},
    Result,
};
use quick_xml::{events::Event, Reader};
use std::{
    collections::HashMap,
    fs::File,
    path::Path,
    process::Command,
    time::{Duration, Instant},
};
use zip::ZipArchive;

/// Runs kepubify on `source`, writing `out` (a `.kepub.epub` path), then checks the result.
pub fn convert(tool: &Path, source: &Path, out: &Path) -> Result<()> {
    let mut command = Command::new(tool);
    command.arg("--no-add-dummy-titlepage").arg("--output").arg(out).arg(source);
    command.stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: no console flashes on screen.
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn().map_err(|e| format!("kepubify n’a pas démarré : {e}"))?;
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            if !status.success() {
                return Err("kepubify a échoué.".into());
            }
            break;
        }
        if started.elapsed() > Duration::from_secs(180) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("kepubify a dépassé trois minutes.".into());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    verify(source, out)
}

struct Package {
    spine: Vec<String>,
    language: Vec<String>,
    images: usize,
    text: HashMap<String, String>,
}

fn package(path: &Path) -> Result<Package> {
    let mut zip = ZipArchive::new(File::open(path).map_err(|e| e.to_string())?).map_err(|_| "Archive EPUB invalide.")?;
    let opf = opf_path(&mut zip)?;
    let base = Path::new(&opf).parent().unwrap_or(Path::new("")).to_path_buf();
    let xml = entry(&mut zip, &opf, 2 * 1024 * 1024)?;
    let mut reader = Reader::from_reader(xml.as_slice());
    let (mut manifest, mut refs, mut language, mut images) = (HashMap::new(), Vec::new(), Vec::new(), 0);
    let mut in_language = false;
    loop {
        match reader.read_event().map_err(|e| e.to_string())? {
            Event::Start(e) | Event::Empty(e) => match e.local_name().as_ref() {
                b"item" => {
                    let get = |k: &[u8]| {
                        e.attributes().flatten().find(|a| a.key.as_ref() == k).map(|a| String::from_utf8_lossy(&a.value).into_owned())
                    };
                    if get(b"media-type").is_some_and(|m| m.starts_with("image/")) {
                        images += 1;
                    }
                    if let (Some(id), Some(href)) = (get(b"id"), get(b"href")) {
                        manifest.insert(id, resource(&base, &href)?);
                    }
                }
                b"itemref" => {
                    if let Some(a) = e.attributes().flatten().find(|a| a.key.as_ref() == b"idref") {
                        refs.push(String::from_utf8_lossy(&a.value).into_owned());
                    }
                }
                b"language" => in_language = true,
                _ => {}
            },
            Event::Text(t) if in_language => {
                language.push(t.decode().map_err(|e| e.to_string())?.trim().to_string());
                in_language = false;
            }
            Event::End(e) if e.local_name().as_ref() == b"language" => in_language = false,
            Event::Eof => break,
            _ => {}
        }
    }
    let spine: Vec<String> = refs.iter().filter_map(|id| manifest.get(id).cloned()).collect();
    let mut text = HashMap::new();
    for name in &spine {
        let bytes = entry(&mut zip, name, 32 * 1024 * 1024)?;
        text.insert(name.clone(), visible_text(&String::from_utf8_lossy(&bytes)));
    }
    Ok(Package { spine, language, images, text })
}

fn verify(source: &Path, result: &Path) -> Result<()> {
    let (before, after) = (package(source)?, package(result)?);
    if before.spine != after.spine || before.language != after.language {
        return Err("Chapitres ou langue modifiés par la conversion Kobo.".into());
    }
    if before.images != after.images {
        return Err("Images modifiées par la conversion Kobo.".into());
    }
    for name in &before.spine {
        if before.text.get(name) != after.text.get(name) {
            return Err(format!("Texte modifié par la conversion Kobo dans {name}."));
        }
    }
    let mut zip = ZipArchive::new(File::open(result).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let marked = after.spine.iter().any(|name| entry(&mut zip, name, 32 * 1024 * 1024).is_ok_and(|b| String::from_utf8_lossy(&b).contains("koboSpan")));
    if !marked {
        return Err("Marqueurs KEPUB absents.".into());
    }
    Ok(())
}

/// The text a reader sees in an XHTML chapter: the body only, tags dropped, entities decoded, whitespace collapsed.
pub(crate) fn visible_text(html: &str) -> String {
    let body = match html.find("<body") {
        Some(i) => &html[i..],
        None => html,
    };
    let mut out = String::with_capacity(body.len() / 2);
    let mut rest = body;
    let mut skip: Option<&str> = None;
    while let Some(open) = rest.find('<') {
        if skip.is_none() {
            out.push_str(&rest[..open]);
        }
        let Some(close) = rest[open..].find('>') else { break };
        let tag = &rest[open + 1..open + close];
        rest = &rest[open + close + 1..];
        let name = tag.trim_start_matches('/').split(|c: char| c.is_whitespace() || c == '/').next().unwrap_or("").to_ascii_lowercase();
        match (skip, tag.starts_with('/')) {
            (None, false) if (name == "script" || name == "style") && !tag.ends_with('/') => {
                skip = Some(if name == "script" { "script" } else { "style" })
            }
            (Some(s), true) if name == s => skip = None,
            _ => {}
        }
    }
    if skip.is_none() {
        out.push_str(rest);
    }
    decode(&out).split_whitespace().collect::<Vec<_>>().join(" ")
}

fn decode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        let tail = &rest[amp..];
        let Some(end) = tail.find(';').filter(|e| *e <= 12) else {
            out.push('&');
            rest = &tail[1..];
            continue;
        };
        let entity = &tail[1..end];
        let ch = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some('\u{a0}'),
            _ if entity.starts_with("#x") || entity.starts_with("#X") => u32::from_str_radix(&entity[2..], 16).ok().and_then(char::from_u32),
            _ if entity.starts_with('#') => entity[1..].parse().ok().and_then(char::from_u32),
            _ => None,
        };
        match ch {
            Some(c) => {
                out.push(c);
                rest = &tail[end + 1..];
            }
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::store::tests::{fixture, Sandbox};
    use std::io::{Read, Write};
    use zip::{write::SimpleFileOptions, ZipWriter};

    /// A copy of `source` whose chapters wrap their text in Kobo spans, as kepubify does; `alter` changes the text.
    pub fn fake_kepub(source: &Path, out: &Path, alter: bool) {
        let mut zip = ZipArchive::new(File::open(source).unwrap()).unwrap();
        let mut writer = ZipWriter::new(File::create(out).unwrap());
        for i in 0..zip.len() {
            let mut file = zip.by_index(i).unwrap();
            let name = file.name().to_string();
            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes).unwrap();
            let options = SimpleFileOptions::default().compression_method(file.compression());
            if name.ends_with(".xhtml") && !name.contains("nav") {
                let text = String::from_utf8(bytes).unwrap();
                let mut changed = text.replacen("<p>", "<p><span class=\"koboSpan\" id=\"kobo.1.1\">", 1).replacen("</p>", "</span></p>", 1);
                if alter {
                    changed = changed.replacen("<p><span class=\"koboSpan\" id=\"kobo.1.1\">", "<p><span class=\"koboSpan\" id=\"kobo.1.1\">X", 1);
                }
                bytes = changed.into_bytes();
            }
            writer.start_file(name, options).unwrap();
            writer.write_all(&bytes).unwrap();
        }
        writer.finish().unwrap();
    }

    #[test]
    fn text_survives_markup() {
        assert_eq!(visible_text("<html><head><title>T</title></head><body><p>A&amp;B <b>c</b>&#233;</p><style>x</style></body></html>"), "A&B cé");
    }

    #[test]
    fn a_faithful_kepub_passes_and_an_altered_one_is_refused() {
        let sandbox = Sandbox::new();
        let source = fixture("representative.epub");
        let good = sandbox.0.join("good.kepub.epub");
        fake_kepub(&source, &good, false);
        verify(&source, &good).unwrap();
        let bad = sandbox.0.join("bad.kepub.epub");
        fake_kepub(&source, &bad, true);
        assert!(verify(&source, &bad).unwrap_err().contains("Texte modifié"));
        assert!(verify(&source, &source).unwrap_err().contains("Marqueurs"));
    }

    #[cfg(unix)]
    #[test]
    fn convert_runs_the_tool_and_checks_its_output() {
        use std::os::unix::fs::PermissionsExt;
        let sandbox = Sandbox::new();
        let source = fixture("representative.epub");
        let prepared = sandbox.0.join("prepared.kepub.epub");
        fake_kepub(&source, &prepared, false);
        let tool = sandbox.0.join("kepubify");
        std::fs::write(&tool, format!("#!/bin/sh\ncp '{}' \"$3\"\n", prepared.display())).unwrap();
        std::fs::set_permissions(&tool, std::fs::Permissions::from_mode(0o755)).unwrap();
        let out = sandbox.0.join("out.kepub.epub");
        convert(&tool, &source, &out).unwrap();
        assert!(out.exists());
        assert!(convert(&sandbox.0.join("absent"), &source, &out).is_err());
    }
}
