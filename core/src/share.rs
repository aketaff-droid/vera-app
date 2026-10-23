//! Sharing books (docs/DECISIONS.md, section M). Vera prepares the copies to share in its own data — the version
//! it sends to the Kobo (corrected card, cover it made) or the original file — under readable names, one by one
//! or in a .zip. It then sends them by e-mail or to a Discord channel itself; for WhatsApp and private Discord
//! messages the owner sends them, guided by the window. Nothing is written in the watched folder.
use crate::{
    edit,
    store::{Book, Store},
    util::now,
    Result, SEP,
};
use lettre::{
    message::{header::ContentType, Attachment, Mailbox, MultiPart, SinglePart},
    transport::smtp::authentication::Credentials,
    Message, SmtpTransport, Transport,
};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    time::Duration,
};

/// Folder of the copies to share, in Vera's data; each preparation has its own, removed after a day.
pub const FOLDER: &str = "partage";
const KEEP: i64 = 24 * 3600;
/// What most mail services accept in one message (Gmail: 25 Mo, attachments encoded included).
pub const MAIL_LIMIT: u64 = 25 * 1024 * 1024;
/// What Discord accepts per file without a paid subscription, and files per message.
pub const DISCORD_LIMIT: u64 = 10 * 1024 * 1024;
const DISCORD_FILES: usize = 10;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SharedFile {
    pub path: String,
    pub name: String,
    pub size: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Prepared {
    pub dir: String,
    pub files: Vec<SharedFile>,
    /// The books' titles, for the messages (« Les Misérables, Germinal et Le Horla »).
    pub titles: Vec<String>,
}

/// Prepares `hashes` for sharing: the corrected copy or the original, named « Auteur — Titre.epub », or all of them
/// in one « N livres.zip ».
pub fn prepare(store: &Store, hashes: &[String], corrected: bool, zip: bool) -> Result<Prepared> {
    if hashes.is_empty() || hashes.len() > 200 {
        return Err("Choisis entre 1 et 200 livres.".into());
    }
    clean(store, now())?;
    let books = store.books()?;
    let chosen: Vec<&Book> = hashes
        .iter()
        .map(|h| books.iter().find(|b| &b.hash == h).ok_or_else(|| "Un des livres n’est plus dans ta bibliothèque.".to_string()))
        .collect::<Result<_>>()?;
    if let Some(book) = chosen.iter().find(|b| b.problem.is_some()) {
        return Err(format!("« {} » ne peut pas être lu : il n’est pas partagé.", book.title));
    }
    let dir = store.root.join(FOLDER).join(format!("{}-{}", now(), std::process::id() % 1000));
    let work = dir.join(".travail");
    fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let mut names: Vec<String> = Vec::new();
    let mut files = Vec::new();
    for (index, book) in chosen.iter().enumerate() {
        let source = Path::new(&book.path);
        if crate::util::hash_file(source)? != book.hash {
            return Err(format!("« {} » a changé depuis sa lecture ; réessaie dans un instant.", book.title));
        }
        let item = work.join(index.to_string());
        fs::create_dir_all(&item).map_err(|e| e.to_string())?;
        let from = if corrected { edit::corrected_copy(store, book, &item)? } else { source.to_path_buf() };
        let name = unique(file_name(&book.title, &book.authors, &book.format), &mut names);
        let to = dir.join(&name);
        fs::copy(&from, &to).map_err(|e| format!("Copie impossible : {e}"))?;
        files.push(to);
    }
    let _ = fs::remove_dir_all(&work);
    let titles: Vec<String> = chosen.iter().map(|b| b.title.clone()).collect();
    let files = if zip && files.len() > 1 {
        let archive = dir.join(format!("{} livres.zip", files.len()));
        pack(&files, &archive)?;
        for f in &files {
            let _ = fs::remove_file(f);
        }
        vec![archive]
    } else {
        files
    };
    let files = files
        .iter()
        .map(|p| {
            Ok(SharedFile {
                name: p.file_name().unwrap_or_default().to_string_lossy().into_owned(),
                size: p.metadata().map_err(|e| e.to_string())?.len(),
                path: crate::store::plain(p),
            })
        })
        .collect::<Result<_>>()?;
    Ok(Prepared { dir: crate::store::plain(&dir), files, titles })
}

/// « Victor Hugo — Les Misérables.epub »: the first author, the title, nothing Windows refuses in a file name.
pub fn file_name(title: &str, authors: &str, format: &str) -> String {
    let clean = |text: &str| -> String {
        let text: String = text
            .chars()
            .map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { ' ' } else { c })
            .collect();
        text.split_whitespace().collect::<Vec<_>>().join(" ").trim_matches(['.', ' ']).to_string()
    };
    let author = clean(authors.split(" · ").next().unwrap_or(""));
    let title = clean(&title.replace(SEP, " - "));
    let title = if title.is_empty() { "Livre".to_string() } else { title };
    let mut stem = if author.is_empty() { title } else { format!("{author} — {title}") };
    if stem.chars().count() > 150 {
        stem = stem.chars().take(150).collect::<String>().trim_end().to_string();
    }
    let reserved = ["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "LPT1", "LPT2", "LPT3"];
    if reserved.contains(&stem.to_uppercase().as_str()) {
        stem = format!("_{stem}");
    }
    format!("{stem}.{format}")
}

fn unique(name: String, taken: &mut Vec<String>) -> String {
    let (stem, ext) = name.rsplit_once('.').map(|(s, e)| (s.to_string(), e.to_string())).unwrap_or((name.clone(), String::new()));
    let mut candidate = name;
    let mut n = 2;
    while taken.iter().any(|t| t.eq_ignore_ascii_case(&candidate)) {
        candidate = format!("{stem} ({n}).{ext}");
        n += 1;
    }
    taken.push(candidate.clone());
    candidate
}

fn pack(files: &[PathBuf], archive: &Path) -> Result<()> {
    use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};
    let mut writer = ZipWriter::new(File::create(archive).map_err(|e| e.to_string())?);
    // Books are already compressed: stored, the archive is made at once.
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored).large_file(true);
    for file in files {
        let name = file.file_name().unwrap_or_default().to_string_lossy().into_owned();
        writer.start_file(name, options).map_err(|e| e.to_string())?;
        std::io::copy(&mut File::open(file).map_err(|e| e.to_string())?, &mut writer).map_err(|e| e.to_string())?;
    }
    writer.finish().map_err(|e| e.to_string())?.flush().map_err(|e| e.to_string())
}

/// Removes the preparations older than a day (Vera's own folder only).
pub fn clean(store: &Store, at: i64) -> Result<()> {
    let root = store.root.join(FOLDER);
    let Ok(entries) = fs::read_dir(&root) else { return Ok(()) };
    for entry in entries.flatten() {
        let stamp: Option<i64> = entry.file_name().to_string_lossy().split('-').next().and_then(|s| s.parse().ok());
        if stamp.is_some_and(|s| at - s > KEEP) && entry.path().starts_with(&root) {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
    Ok(())
}

/* ——— E-mail, sent by Vera ——— */

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MailAccount {
    pub address: String,
    pub server: String,
    pub port: u16,
}

/// The sending server of the usual French and international services, from the address.
pub fn provider(address: &str) -> Option<MailAccount> {
    let domain = address.rsplit_once('@')?.1.to_lowercase();
    let (server, port) = match domain.as_str() {
        "gmail.com" | "googlemail.com" => ("smtp.gmail.com", 465),
        "outlook.com" | "outlook.fr" | "hotmail.com" | "hotmail.fr" | "live.com" | "live.fr" | "msn.com" => ("smtp-mail.outlook.com", 587),
        "yahoo.com" | "yahoo.fr" => ("smtp.mail.yahoo.com", 465),
        "icloud.com" | "me.com" | "mac.com" => ("smtp.mail.me.com", 587),
        "orange.fr" | "wanadoo.fr" => ("smtp.orange.fr", 465),
        "free.fr" => ("smtp.free.fr", 465),
        "sfr.fr" | "neuf.fr" => ("smtp.sfr.fr", 465),
        "laposte.net" => ("smtp.laposte.net", 465),
        "gmx.fr" | "gmx.com" | "gmx.net" => ("mail.gmx.net", 587),
        _ => return None,
    };
    Some(MailAccount { address: address.trim().to_string(), server: server.into(), port })
}

pub fn check_account(account: &MailAccount) -> Result<()> {
    mailbox(&account.address)?;
    let host_ok = !account.server.is_empty()
        && account.server.len() <= 253
        && account.server.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
    if !host_ok || ![465, 587].contains(&account.port) {
        return Err("Serveur d’envoi invalide (port 465 ou 587).".into());
    }
    Ok(())
}

fn mailbox(address: &str) -> Result<Mailbox> {
    address.trim().parse::<Mailbox>().map_err(|_| format!("Adresse invalide : {address}"))
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Mail {
    pub to: Vec<String>,
    pub subject: String,
    pub body: String,
}

/// The message, books attached.
pub fn build_mail(account: &MailAccount, mail: &Mail, files: &[SharedFile]) -> Result<Message> {
    if mail.to.is_empty() || mail.to.len() > 20 {
        return Err("Indique entre 1 et 20 destinataires.".into());
    }
    let total: u64 = files.iter().map(|f| f.size).sum();
    // Attachments grow by a third once encoded; the limit is checked on what the server receives.
    if total * 4 / 3 > MAIL_LIMIT {
        return Err(format!("Trop lourd pour un e-mail ({} Mo, 18 Mo au plus une fois encodé) : envoie-les en plusieurs fois.", total / (1024 * 1024)));
    }
    let mut builder = Message::builder().from(mailbox(&account.address)?).subject(mail.subject.trim());
    for to in &mail.to {
        builder = builder.to(mailbox(to)?);
    }
    let mut parts = MultiPart::mixed().singlepart(SinglePart::plain(mail.body.clone()));
    for file in files {
        let bytes = fs::read(&file.path).map_err(|e| format!("{} : {e}", file.name))?;
        let kind = match file.name.rsplit('.').next().unwrap_or("").to_lowercase().as_str() {
            "epub" => "application/epub+zip",
            "pdf" => "application/pdf",
            "zip" => "application/zip",
            _ => "application/octet-stream",
        };
        parts = parts.singlepart(Attachment::new(file.name.clone()).body(bytes, ContentType::parse(kind).map_err(|e| e.to_string())?));
    }
    builder.multipart(parts).map_err(|e| e.to_string())
}

fn transport(account: &MailAccount, password: &str) -> Result<SmtpTransport> {
    check_account(account)?;
    let credentials = Credentials::new(account.address.trim().to_string(), password.replace(' ', ""));
    let builder = if account.port == 465 { SmtpTransport::relay(&account.server) } else { SmtpTransport::starttls_relay(&account.server) }
        .map_err(|e| e.to_string())?;
    Ok(builder.port(account.port).credentials(credentials).timeout(Some(Duration::from_secs(60))).build())
}

/// Checks the address and its application password with the server, without sending anything.
pub fn test_account(account: &MailAccount, password: &str) -> Result<()> {
    match transport(account, password)?.test_connection() {
        Ok(true) => Ok(()),
        Ok(false) => Err("Le serveur d’envoi ne répond pas.".into()),
        Err(e) => Err(mail_error(&e.to_string())),
    }
}

pub fn send_mail(account: &MailAccount, password: &str, mail: &Mail, files: &[SharedFile]) -> Result<()> {
    let message = build_mail(account, mail, files)?;
    transport(account, password)?.send(&message).map(|_| ()).map_err(|e| mail_error(&e.to_string()))
}

fn mail_error(detail: &str) -> String {
    if detail.contains("535") || detail.to_lowercase().contains("authentication") || detail.contains("534") {
        "Le serveur refuse le mot de passe : crée un nouveau mot de passe d’application et colle-le dans Vera.".into()
    } else if detail.to_lowercase().contains("timed out") || detail.to_lowercase().contains("connection") {
        "Pas de connexion au serveur d’envoi : vérifie Internet, puis réessaie.".into()
    } else {
        format!("L’e-mail n’est pas parti : {detail}")
    }
}

/* ——— Discord channel, through its webhook ——— */

/// A webhook address of Discord: https://discord.com/api/webhooks/<id>/<token>.
pub fn check_webhook(url: &str) -> Result<()> {
    let rest = ["https://discord.com/api/webhooks/", "https://discordapp.com/api/webhooks/", "https://ptb.discord.com/api/webhooks/", "https://canary.discord.com/api/webhooks/"]
        .iter()
        .find_map(|p| url.trim().strip_prefix(p))
        .ok_or("Ce n’est pas une adresse de webhook Discord (elle commence par https://discord.com/api/webhooks/).")?;
    let parts: Vec<&str> = rest.split(['?', '#']).next().unwrap_or("").split('/').collect();
    let valid = parts.len() == 2
        && parts[0].len() >= 15
        && parts[0].chars().all(|c| c.is_ascii_digit())
        && parts[1].len() >= 30
        && parts[1].chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !valid {
        return Err("Adresse de webhook incomplète : recopie-la en entier depuis Discord.".into());
    }
    Ok(())
}

/// Sends the files to the channel, ten per message, the text with the first.
pub fn send_discord(url: &str, message: &str, files: &[SharedFile]) -> Result<()> {
    check_webhook(url)?;
    post_discord(url, message, files)
}

fn post_discord(url: &str, message: &str, files: &[SharedFile]) -> Result<()> {
    if let Some(big) = files.iter().find(|f| f.size > DISCORD_LIMIT) {
        return Err(format!("« {} » dépasse 10 Mo, la limite de Discord : choisis WhatsApp ou l’e-mail pour celui-ci.", big.name));
    }
    if message.chars().count() > 2000 {
        return Err("Message trop long pour Discord (2 000 caractères).".into());
    }
    let groups: Vec<&[SharedFile]> = if files.is_empty() { vec![&[]] } else { files.chunks(DISCORD_FILES).collect() };
    for (index, group) in groups.into_iter().enumerate() {
        let boundary = format!("vera{}", crate::util::hash_bytes(format!("{url}{index}{}", now()).as_bytes()).get(..24).unwrap_or("boundary"));
        let content = if index == 0 { message } else { "" };
        let mut body = Vec::new();
        let payload = serde_json::json!({ "content": content, "allowed_mentions": { "parse": [] } });
        write!(body, "--{boundary}\r\nContent-Disposition: form-data; name=\"payload_json\"\r\nContent-Type: application/json\r\n\r\n{payload}\r\n").map_err(|e| e.to_string())?;
        for (n, file) in group.iter().enumerate() {
            let name = file.name.replace(['"', '\r', '\n'], "_");
            write!(body, "--{boundary}\r\nContent-Disposition: form-data; name=\"files[{n}]\"; filename=\"{name}\"\r\nContent-Type: application/octet-stream\r\n\r\n").map_err(|e| e.to_string())?;
            body.extend(fs::read(&file.path).map_err(|e| format!("{} : {e}", file.name))?);
            body.extend(b"\r\n");
        }
        write!(body, "--{boundary}--\r\n").map_err(|e| e.to_string())?;
        let agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(120))).http_status_as_error(false).build().new_agent();
        let response = agent
            .post(url.trim())
            .header("Content-Type", &format!("multipart/form-data; boundary={boundary}"))
            .header("User-Agent", "Vera (https://github.com/aketaff-droid/vera-app)")
            .send(&body[..])
            .map_err(|e| format!("Discord ne répond pas : {e}"))?;
        match response.status().as_u16() {
            200..=299 => {}
            401 | 403 | 404 => return Err("Ce salon n’accepte plus Vera : le webhook a été supprimé. Ajoute-le de nouveau.".into()),
            413 => return Err("Discord refuse : fichiers trop lourds pour ce salon.".into()),
            429 => return Err("Discord demande d’attendre un peu : réessaie dans une minute.".into()),
            status => return Err(format!("Discord a refusé l’envoi (erreur {status}).")),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        metadata::inspect,
        store::{plain, tests::{fixture, Sandbox}, Settings},
    };
    use std::io::Read;

    fn library() -> (Sandbox, Store, Vec<String>) {
        let sandbox = Sandbox::new();
        let store = sandbox.store();
        let folder = sandbox.0.join("Livres");
        fs::create_dir_all(folder.join("Classiques")).unwrap();
        let folder = PathBuf::from(plain(&fs::canonicalize(&folder).unwrap()));
        store.save_settings(Settings { watch_dir: Some(plain(&folder)), ..Settings::default() }).unwrap();
        let mut hashes = Vec::new();
        for (name, fixture_name) in [("Classiques/a.epub", "first.epub"), ("b.pdf", "sample.pdf")] {
            let path = folder.join(name);
            fs::copy(fixture(fixture_name), &path).unwrap();
            let hash = crate::util::hash_file(&path).unwrap();
            store.add_book(&hash, &path, crate::util::stamp(&path).unwrap(), inspect(&path)).unwrap();
            hashes.push(hash);
        }
        (sandbox, store, hashes)
    }

    #[test]
    fn names_are_readable_and_accepted_by_windows() {
        assert_eq!(file_name("Les Misérables", "Victor Hugo · Autre", "epub"), "Victor Hugo — Les Misérables.epub");
        assert_eq!(file_name("Quoi ? Où : « ici » / là", "", "pdf"), "Quoi Où « ici » là.pdf");
        assert_eq!(file_name("  ...  ", "", "epub"), "Livre.epub");
        assert_eq!(file_name("con", "", "epub"), "_con.epub");
        assert!(file_name(&"x".repeat(400), "A", "epub").chars().count() <= 160);
        let mut taken = Vec::new();
        assert_eq!(unique("A.epub".into(), &mut taken), "A.epub");
        assert_eq!(unique("a.epub".into(), &mut taken), "a (2).epub");
    }

    #[test]
    fn corrected_copies_or_originals_are_prepared_without_touching_the_folder() {
        let (_sandbox, store, hashes) = library();
        let mut card = store.detail(&hashes[0]).unwrap().metadata;
        card.title = "Titre corrigé".into();
        store.save_edit(&hashes[0], card, 0).unwrap();
        let before: Vec<String> = store.books().unwrap().iter().map(|b| crate::util::hash_file(Path::new(&b.path)).unwrap()).collect();

        let corrected = prepare(&store, &hashes, true, false).unwrap();
        assert_eq!(corrected.files.len(), 2);
        let epub = corrected.files.iter().find(|f| f.name.ends_with(".epub")).unwrap();
        assert!(epub.name.contains("Titre corrigé"), "{}", epub.name);
        assert_eq!(inspect(Path::new(&epub.path)).unwrap().metadata.title, "Titre corrigé");
        assert!(Path::new(&corrected.dir).starts_with(store.root.join(FOLDER)));
        assert!(!Path::new(&corrected.dir).join(".travail").exists());

        let original = prepare(&store, &hashes[..1], false, false).unwrap();
        assert_eq!(crate::util::hash_file(Path::new(&original.files[0].path)).unwrap(), hashes[0], "the original, byte for byte");

        let after: Vec<String> = store.books().unwrap().iter().map(|b| crate::util::hash_file(Path::new(&b.path)).unwrap()).collect();
        assert_eq!(before, after, "the watched folder is never written");
        assert!(prepare(&store, &[], true, false).is_err());
        assert!(prepare(&store, &["inconnu".into()], true, false).is_err());
    }

    #[test]
    fn several_books_can_travel_in_one_zip_and_old_preparations_go() {
        let (_sandbox, store, hashes) = library();
        let packed = prepare(&store, &hashes, false, true).unwrap();
        assert_eq!(packed.files.len(), 1);
        assert_eq!(packed.files[0].name, "2 livres.zip");
        let mut archive = zip::ZipArchive::new(File::open(&packed.files[0].path).unwrap()).unwrap();
        assert_eq!(archive.len(), 2);
        let mut bytes = Vec::new();
        archive.by_index(0).unwrap().read_to_end(&mut bytes).unwrap();
        assert!(!bytes.is_empty());
        assert_eq!(packed.titles.len(), 2);
        clean(&store, now() + KEEP + 10).unwrap();
        assert!(!Path::new(&packed.dir).exists(), "removed after a day");
    }

    #[test]
    fn a_mail_carries_the_books_and_refuses_what_servers_would() {
        let (_sandbox, store, hashes) = library();
        let prepared = prepare(&store, &hashes, true, false).unwrap();
        let account = provider("toi@gmail.com").unwrap();
        assert_eq!((account.server.as_str(), account.port), ("smtp.gmail.com", 465));
        assert_eq!(provider("moi@orange.fr").unwrap().server, "smtp.orange.fr");
        assert!(provider("moi@exemple.org").is_none());
        let mail = Mail { to: vec!["Paul <paul@exemple.fr>".into()], subject: "2 livres pour toi".into(), body: "Bonne lecture !".into() };
        let message = String::from_utf8(build_mail(&account, &mail, &prepared.files).unwrap().formatted()).unwrap();
        assert!(message.contains("To: Paul <paul@exemple.fr>"));
        assert!(message.contains("application/epub+zip") && message.contains("application/pdf"));
        assert!(message.contains("Content-Disposition: attachment"));
        assert!(build_mail(&account, &Mail { to: vec!["pas une adresse".into()], ..mail.clone() }, &prepared.files).is_err());
        assert!(build_mail(&account, &Mail { to: vec![], ..mail.clone() }, &prepared.files).is_err());
        let heavy = vec![SharedFile { path: prepared.files[0].path.clone(), name: "x.pdf".into(), size: 30 * 1024 * 1024 }];
        assert!(build_mail(&account, &mail, &heavy).unwrap_err().contains("Trop lourd"));
        assert!(check_account(&MailAccount { port: 25, ..account.clone() }).is_err());
        assert!(check_account(&MailAccount { server: "smtp.gmail.com; rm".into(), ..account }).is_err());
    }

    #[test]
    fn discord_webhooks_are_recognised_and_receive_the_files() {
        let id = "123456789012345678";
        let token = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcdef";
        assert!(check_webhook(&format!("https://discord.com/api/webhooks/{id}/{token}")).is_ok());
        assert!(check_webhook(&format!("https://discord.com/api/webhooks/{id}")).is_err());
        assert!(check_webhook(&format!("https://exemple.fr/api/webhooks/{id}/{token}")).is_err());
        assert!(check_webhook(&format!("http://discord.com/api/webhooks/{id}/{token}")).is_err());

        let (_sandbox, store, hashes) = library();
        let prepared = prepare(&store, &hashes, false, false).unwrap();
        // A stand-in for Discord on this machine: it records the request and answers 204.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut received = Vec::new();
            let mut buffer = [0u8; 65536];
            loop {
                match stream.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        received.extend_from_slice(&buffer[..n]);
                        let text = String::from_utf8_lossy(&received);
                        if text.contains("--\r\n") && text.trim_end().ends_with("--") {
                            break;
                        }
                    }
                }
            }
            stream.write_all(b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
            String::from_utf8_lossy(&received).into_owned()
        });
        post_discord(&format!("http://127.0.0.1:{port}/api/webhooks/{id}/{token}"), "2 livres pour le club", &prepared.files).unwrap();
        let request = server.join().unwrap();
        assert!(request.starts_with("POST /api/webhooks/"));
        assert!(request.contains("name=\"payload_json\"") && request.contains("2 livres pour le club"));
        assert!(request.contains("\"parse\":[]"), "no one is pinged");
        assert!(request.contains("name=\"files[0]\"") && request.contains("name=\"files[1]\""));
        assert!(request.contains(&prepared.files[0].name));

        let heavy = vec![SharedFile { path: prepared.files[0].path.clone(), name: "gros.pdf".into(), size: 11 * 1024 * 1024 }];
        assert!(post_discord("http://127.0.0.1:9/x", "", &heavy).unwrap_err().contains("10 Mo"));
    }
}
