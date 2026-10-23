//! Covers as the interface shows them: a light thumbnail (a full cover can weigh several megabytes) and the
//! cover's own colours, with which the interface tints the featured book and the book's card. A book without
//! a cover gets one made by Vera: the first page of a PDF, or a typographic cover drawn for an EPUB.
use crate::Result;
use image::{imageops::FilterType, DynamicImage, GenericImageView, ImageFormat};
use lopdf::{dictionary, Document, Object, Stream};
use std::{io::Cursor, panic, path::Path};

/// Width of a thumbnail: sharp at the largest size the library shows, on a 2× screen.
pub const THUMB_WIDTH: u32 = 360;

pub struct Prepared {
    /// JPEG bytes.
    pub thumb: Vec<u8>,
    /// Two colours of the cover, « #rrggbb »: a vivid one, then a deep one.
    pub tint: Vec<String>,
}

pub fn prepare(bytes: &[u8]) -> Result<Prepared> {
    let image = image::load_from_memory(bytes).map_err(|e| format!("Couverture illisible : {e}"))?;
    let (w, h) = image.dimensions();
    if w == 0 || h == 0 {
        return Err("Couverture vide.".into());
    }
    let thumb = if w > THUMB_WIDTH { image.resize(THUMB_WIDTH, u32::MAX, FilterType::Lanczos3) } else { image.clone() };
    let mut out = Cursor::new(Vec::new());
    DynamicImage::ImageRgb8(thumb.to_rgb8()).write_to(&mut out, ImageFormat::Jpeg).map_err(|e| e.to_string())?;
    Ok(Prepared { thumb: out.into_inner(), tint: tint(&image) })
}

/// The vivid colour is the mean of the most saturated quarter of the cover, the deep one the mean of its
/// darkest 40 %: together they make a backdrop that belongs to the book.
fn tint(image: &DynamicImage) -> Vec<String> {
    let small = image.resize_exact(32, 32, FilterType::Triangle).to_rgb8();
    let mut pixels: Vec<[f32; 3]> = small.pixels().map(|p| [p[0] as f32, p[1] as f32, p[2] as f32]).collect();
    let saturation = |p: &[f32; 3]| {
        let max = p.iter().cloned().fold(0.0, f32::max);
        let min = p.iter().cloned().fold(255.0, f32::min);
        if max == 0.0 { 0.0 } else { (max - min) / max * (max / 255.0) }
    };
    let mean = |set: &[[f32; 3]]| {
        let n = set.len().max(1) as f32;
        let sum = set.iter().fold([0.0; 3], |a, p| [a[0] + p[0], a[1] + p[1], a[2] + p[2]]);
        format!("#{:02x}{:02x}{:02x}", (sum[0] / n) as u8, (sum[1] / n) as u8, (sum[2] / n) as u8)
    };
    pixels.sort_by(|a, b| saturation(b).total_cmp(&saturation(a)));
    let vivid = mean(&pixels[..pixels.len() / 4]);
    pixels.sort_by(|a, b| (a[0] + a[1] + a[2]).total_cmp(&(b[0] + b[1] + b[2])));
    let deep = mean(&pixels[..pixels.len() * 2 / 5]);
    vec![vivid, deep]
}

/// Width of a made cover: enough for the Kobo's own screen.
const MADE_WIDTH: f32 = 1000.0;
/// PDFs above this size are not opened for a cover (the whole file is read into memory).
const MAX_PDF: u64 = 400 * 1024 * 1024;

/// The first page of a PDF as a PNG, as the Kobo itself shows a PDF. An encrypted or unreadable PDF gives Err.
pub fn first_page(path: &Path) -> Result<Vec<u8>> {
    let size = path.metadata().map_err(|e| e.to_string())?.len();
    if size > MAX_PDF {
        return Err("PDF trop lourd pour en tirer une couverture.".into());
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    render_first_page(bytes)
}

fn render_first_page(bytes: Vec<u8>) -> Result<Vec<u8>> {
    // The renderer is young: a page it cannot handle must never bring Vera down.
    panic::catch_unwind(move || -> Result<Vec<u8>> {
        let pdf = hayro::hayro_syntax::Pdf::new(bytes).map_err(|_| "PDF illisible ou chiffré.")?;
        let page = pdf.pages().first().ok_or("PDF sans page.")?;
        let (width, height) = page.render_dimensions();
        if width < 1.0 || height < 1.0 {
            return Err("Page vide.".into());
        }
        // Wide pages (a landscape slide) are drawn smaller: a cover is portrait.
        let scale = (MADE_WIDTH / width).min(MADE_WIDTH * 1.6 / height);
        let pixmap = hayro::render(
            page,
            &hayro::RenderCache::new(),
            &hayro::hayro_interpret::InterpreterSettings::default(),
            &hayro::RenderSettings::default(),
            &hayro::PixmapSettings { x_scale: scale, y_scale: scale, bg_color: hayro::vello_cpu::color::palette::css::WHITE },
        );
        pixmap.into_png().map_err(|e| e.to_string())
    })
    .unwrap_or_else(|_| Err("Page impossible à dessiner.".into()))
}

/// Deep, quiet grounds for drawn covers; a book always gets the same one.
const GROUNDS: [[f32; 3]; 8] = [
    [0.11, 0.17, 0.31], // nuit
    [0.36, 0.09, 0.13], // bordeaux
    [0.09, 0.27, 0.22], // forêt
    [0.20, 0.13, 0.30], // prune
    [0.42, 0.25, 0.10], // ocre brûlé
    [0.13, 0.13, 0.15], // encre
    [0.08, 0.28, 0.36], // canard
    [0.33, 0.16, 0.25], // mûre
];

/// A typographic cover for an EPUB without one: title and author on a ground chosen by the book's hash.
pub fn drawn(title: &str, authors: &str, hash: &str) -> Result<Vec<u8>> {
    let pdf = drawn_pdf(title, authors, hash)?;
    render_first_page(pdf)
}

/// The cover laid out as a one-page PDF (400 × 600 pt, standard Times fonts), drawn by the same renderer.
fn drawn_pdf(title: &str, authors: &str, hash: &str) -> Result<Vec<u8>> {
    const W: f32 = 400.0;
    const H: f32 = 600.0;
    const TEXT: f32 = 300.0;
    let seed = hash.bytes().take(8).fold(0usize, |a, b| a.wrapping_mul(31).wrapping_add(b as usize));
    let [r, g, b] = GROUNDS[seed % GROUNDS.len()];
    let title = title.trim();
    let title = if title.is_empty() { "Sans titre" } else { title };
    // The largest size at which the title holds in five lines.
    let (size, lines) = [44.0, 38.0, 32.0, 28.0, 24.0, 21.0]
        .iter()
        .map(|&size| (size, wrap(title, size, TEXT, 0.52)))
        .find(|(_, lines)| lines.len() <= 5)
        .unwrap_or_else(|| {
            let mut lines = wrap(title, 21.0, TEXT, 0.52);
            lines.truncate(6);
            if let Some(last) = lines.last_mut() {
                last.push('…');
            }
            (21.0, lines)
        });
    let author = authors.split(" · ").next().unwrap_or("").trim();
    let author_lines = wrap(author, 17.0, TEXT, 0.45);
    let leading = size * 1.12;
    let block = leading * lines.len() as f32 + 46.0 + 20.0 * author_lines.len().min(2) as f32;
    let mut y = H * 0.56 + block / 2.0 - size;
    let mut ops = format!(
        "{r} {g} {b} rg 0 0 {W} {H} re f\n1 1 1 RG 0.6 w 0.35 CA 22 22 {} {} re S\n",
        W - 44.0,
        H - 44.0
    );
    let text = |line: &str, font: &str, size: f32, y: f32, alpha: f32, ops: &mut String| {
        let width = measure(line, size, if font == "F1" { 0.52 } else { 0.45 });
        let x = (W - width) / 2.0;
        let hex: String = winansi(line).iter().map(|c| format!("{c:02X}")).collect();
        ops.push_str(&format!("{a} {a} {a} rg BT /{font} {size} Tf {x:.1} {y:.1} Td <{hex}> Tj ET\n", a = alpha));
    };
    for line in &lines {
        text(line, "F1", size, y, 1.0, &mut ops);
        y -= leading;
    }
    y -= 8.0;
    ops.push_str(&format!("1 1 1 RG 0.8 w {} {y:.1} m {} {y:.1} l S\n", W / 2.0 - 18.0, W / 2.0 + 18.0));
    y -= 30.0;
    for line in author_lines.iter().take(2) {
        text(line, "F2", 17.0, y, 0.86, &mut ops);
        y -= 20.0;
    }

    let mut doc = Document::with_version("1.4");
    let pages = doc.new_object_id();
    let font = |name: &str| dictionary! { "Type" => "Font", "Subtype" => "Type1", "BaseFont" => name.to_string(), "Encoding" => "WinAnsiEncoding" };
    let f1 = doc.add_object(font("Times-Bold"));
    let f2 = doc.add_object(font("Times-Italic"));
    let content = doc.add_object(Stream::new(dictionary! {}, ops.into_bytes()));
    let page = doc.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages,
        "MediaBox" => vec![0.into(), 0.into(), Object::Real(W), Object::Real(H)],
        "Contents" => content,
        "Resources" => dictionary! { "Font" => dictionary! { "F1" => f1, "F2" => f2 } },
    });
    doc.objects.insert(pages, Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => vec![page.into()], "Count" => 1 }));
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages });
    doc.trailer.set("Root", catalog);
    let mut out = Vec::new();
    doc.save_to(&mut out).map_err(|e| e.to_string())?;
    Ok(out)
}

/// An estimate of the width of a line in Times (no metrics at hand): capitals and wide letters count more.
fn measure(line: &str, size: f32, average: f32) -> f32 {
    line.chars()
        .map(|c| match c {
            ' ' | '\u{A0}' => 0.25,
            'i' | 'l' | 'j' | 't' | 'f' | 'r' | '.' | ',' | '\'' | '’' | ':' | ';' | '!' => 0.32,
            'm' | 'w' | 'M' | 'W' | 'Œ' | 'œ' => 0.95,
            c if c.is_uppercase() => 0.7,
            _ => average,
        })
        .sum::<f32>()
        * size
}

/// Greedy line breaking at spaces; a word too long for a line is cut.
fn wrap(text: &str, size: f32, width: f32, average: f32) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    let mut line = String::new();
    // French punctuation (« : », « — », « ? ») stays with the word before it.
    let mut words: Vec<String> = Vec::new();
    for word in text.split_whitespace() {
        match words.last_mut() {
            Some(last) if word.chars().all(|c| ":;!?»—–".contains(c)) => *last = format!("{last}\u{A0}{word}"),
            _ => words.push(word.to_string()),
        }
    }
    for word in &words {
        let candidate = if line.is_empty() { word.clone() } else { format!("{line} {word}") };
        if measure(&candidate, size, average) <= width || line.is_empty() {
            line = candidate;
        } else {
            lines.push(std::mem::replace(&mut line, word.clone()));
        }
        while measure(&line, size, average) > width && line.chars().count() > 1 {
            let mut head: String = line.clone();
            let mut tail = String::new();
            while measure(&head, size, average) > width && head.chars().count() > 1 {
                tail.insert(0, head.pop().unwrap());
            }
            lines.push(head);
            line = tail;
        }
    }
    if !line.is_empty() {
        lines.push(line);
    }
    lines
}

/// Text in the standard fonts' WinAnsi encoding; a character it lacks becomes « ? ».
fn winansi(text: &str) -> Vec<u8> {
    text.chars()
        .map(|c| match c {
            ' '..='~' => c as u8,
            '\u{A0}'..='\u{FF}' => c as u32 as u8,
            '€' => 0x80,
            '…' => 0x85,
            'Œ' => 0x8C,
            '‘' => 0x91,
            '’' => 0x92,
            '“' => 0x93,
            '”' => 0x94,
            '–' => 0x96,
            '—' => 0x97,
            'œ' => 0x9C,
            'Ÿ' => 0x9F,
            _ => b'?',
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage};

    #[test]
    fn a_cover_gives_a_small_thumbnail_and_its_colours() {
        // Left half bright red, right half dark blue.
        let mut img = RgbImage::new(800, 1200);
        for (x, _, p) in img.enumerate_pixels_mut() {
            *p = if x < 400 { Rgb([230, 30, 30]) } else { Rgb([10, 20, 60]) };
        }
        let mut png = Cursor::new(Vec::new());
        DynamicImage::ImageRgb8(img).write_to(&mut png, ImageFormat::Png).unwrap();
        let prepared = prepare(png.get_ref()).unwrap();
        let thumb = image::load_from_memory(&prepared.thumb).unwrap();
        assert_eq!(thumb.dimensions().0, THUMB_WIDTH);
        assert!(prepared.thumb.len() < png.get_ref().len());
        let red = u8::from_str_radix(&prepared.tint[0][1..3], 16).unwrap();
        assert!(red > 200, "vivid colour is the red half: {}", prepared.tint[0]);
        let deep_sum: u32 = (0..3).map(|i| u32::from(u8::from_str_radix(&prepared.tint[1][1 + 2 * i..3 + 2 * i], 16).unwrap())).sum();
        assert!(deep_sum < 150, "deep colour is the dark half: {}", prepared.tint[1]);
        assert!(prepare(b"pas une image").is_err());
    }

    #[test]
    fn a_pdf_gives_its_first_page_and_a_broken_one_an_error() {
        let png = first_page(&crate::store::tests::fixture("sample.pdf")).unwrap();
        let page = image::load_from_memory(&png).unwrap();
        assert!(page.dimensions().0 >= 600, "sharp enough: {:?}", page.dimensions());
        assert!(first_page(&crate::store::tests::fixture("broken.epub")).is_err());
        assert!(render_first_page(b"%PDF-1.4 rien".to_vec()).is_err());
    }

    #[test]
    fn a_drawn_cover_is_portrait_coloured_and_carries_the_title() {
        let png = drawn("Les Misérables — Tome premier : Fantine", "Victor Hugo · Autre", "abcdef").unwrap();
        let cover = image::load_from_memory(&png).unwrap().to_rgb8();
        assert_eq!(cover.dimensions(), (1000, 1500));
        // Ground of the corner, and light text in the middle band.
        let corner = cover.get_pixel(5, 5);
        assert!(corner.0.iter().all(|&v| v < 140), "deep ground: {corner:?}");
        let bright = (300..1100).flat_map(|y| (100..900).map(move |x| (x, y))).filter(|&(x, y)| cover.get_pixel(x, y).0.iter().all(|&v| v > 220)).count();
        assert!(bright > 2000, "title drawn: {bright} light pixels");
        assert!(!drawn("A", "", "abcdef").unwrap().is_empty());
        assert_eq!(winansi("Œuvre « été » – ‘x’ 字"), b"\x8Cuvre \xAB \xE9t\xE9 \xBB \x96 \x91x\x92 ?".to_vec());
        assert!(wrap("Anticonstitutionnellementissimementextraordinaire", 44.0, 300.0, 0.53).len() > 1);
    }
}
