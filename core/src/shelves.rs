//! Vera's collections as shelves of the Kobo, in the liseuse's own catalogue (`.kobo/KoboReader.sqlite`).
//! Ported from 1.2's `kobo_collections.py`, same rules:
//! - nothing missing → nothing written, not even a backup;
//! - otherwise a verified backup on the PC first, one transaction, an integrity check, and the exact previous
//!   catalogue restored on any failure;
//! - only sideloaded entries (`file:///mnt/onboard/…`) are ever removed from a shelf, and only shelves Vera made
//!   are ever removed; shelves made on the Kobo, store books and reading state are never touched.
use crate::{
    util::{hash_file, now},
    Result,
};
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

pub const ONBOARD: &str = "file:///mnt/onboard/";
pub const MAX_NAME: usize = 200;

#[derive(Debug, Default, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShelfReport {
    pub created: usize,
    pub added: usize,
    pub removed: usize,
    pub shelves_removed: usize,
    /// Entries for books the Kobo has not imported yet: they join their shelf at a later plug.
    pub waiting: usize,
    pub backup: Option<String>,
}

pub fn catalogue(device: &Path) -> PathBuf {
    device.join(".kobo").join("KoboReader.sqlite")
}

/// A non-empty journal means the liseuse is still using its catalogue: nothing is read or written then.
pub fn no_journal(db: &Path) -> Result<()> {
    for suffix in ["-wal", "-journal"] {
        let path = PathBuf::from(format!("{}{suffix}", db.display()));
        if path.metadata().is_ok_and(|m| m.len() > 0) {
            return Err("La Kobo utilise encore son catalogue : éjecte-la, rebranche-la, puis réessaie.".into());
        }
    }
    Ok(())
}

struct Plan {
    create: Vec<String>,
    add: Vec<(String, String)>,
    remove: Vec<(String, String)>,
    drop: Vec<String>,
    waiting: usize,
}

fn plan(db: &Path, wanted: &BTreeMap<String, Vec<String>>, managed: &[String]) -> Result<Plan> {
    let c = Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())?;
    let present: HashSet<String> = c
        .prepare("SELECT ContentID FROM content WHERE ContentType=6 AND BookID IS NULL")
        .and_then(|mut s| s.query_map([], |r| r.get(0))?.collect())
        .map_err(|e| format!("Catalogue Kobo inattendu : {e}"))?;
    let existing: HashMap<String, bool> = c
        .prepare("SELECT Name, coalesce(_IsDeleted,'false') FROM Shelf WHERE Name IS NOT NULL")
        .and_then(|mut s| s.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)? == "true")))?.collect())
        .map_err(|e| e.to_string())?;
    let active: HashSet<(String, String)> = c
        .prepare("SELECT ShelfName, ContentId FROM ShelfContent WHERE coalesce(_IsDeleted,'false')<>'true'")
        .and_then(|mut s| s.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect())
        .map_err(|e| e.to_string())?;
    let mut p = Plan { create: vec![], add: vec![], remove: vec![], drop: vec![], waiting: 0 };
    for (name, ids) in wanted {
        if name.is_empty() || name.chars().count() > MAX_NAME {
            return Err("Nom de collection invalide pour la Kobo.".into());
        }
        if existing.get(name).copied().unwrap_or(true) {
            p.create.push(name.clone());
        }
        for id in ids.iter().filter(|id| id.starts_with(ONBOARD)) {
            if !present.contains(id) {
                p.waiting += 1;
            } else if !active.contains(&(name.clone(), id.clone())) {
                p.add.push((name.clone(), id.clone()));
            }
        }
        let keep: HashSet<&String> = ids.iter().collect();
        let mut stale: Vec<(String, String)> =
            active.iter().filter(|(n, id)| n == name && id.starts_with(ONBOARD) && !keep.contains(id)).cloned().collect();
        stale.sort();
        p.remove.extend(stale);
    }
    for name in managed {
        if !wanted.contains_key(name) && existing.get(name) == Some(&false) {
            p.drop.push(name.clone());
        }
    }
    Ok(p)
}

/// Makes the liseuse's shelves match `wanted` (shelf name → content IDs), removing the shelves of `managed`
/// (made by Vera earlier) that are no longer wanted. `backups` is a folder on the PC.
pub fn apply(device: &Path, backups: &Path, wanted: &BTreeMap<String, Vec<String>>, managed: &[String]) -> Result<ShelfReport> {
    apply_with(device, backups, wanted, managed, None)
}

fn apply_with(device: &Path, backups: &Path, wanted: &BTreeMap<String, Vec<String>>, managed: &[String], fail_after: Option<usize>) -> Result<ShelfReport> {
    let db = catalogue(device);
    no_journal(&db)?;
    let p = plan(&db, wanted, managed)?;
    let mut report = ShelfReport { waiting: p.waiting, ..ShelfReport::default() };
    if p.create.is_empty() && p.add.is_empty() && p.remove.is_empty() && p.drop.is_empty() {
        return Ok(report);
    }
    let saved = backup(&db, backups)?;
    let stamp = iso(now());
    let result = (|| -> Result<()> {
        let mut c = Connection::open(&db).map_err(|e| e.to_string())?;
        let tx = c.transaction().map_err(|e| e.to_string())?;
        for name in &p.create {
            let revived = tx
                .execute("UPDATE Shelf SET _IsDeleted='false', _IsVisible='true', _IsSynced='false', LastModified=?1 WHERE Name=?2", [&stamp, name])
                .map_err(|e| e.to_string())?;
            if revived == 0 {
                tx.execute(
                    "INSERT INTO Shelf(CreationDate, Id, InternalName, LastModified, Name, Type, _IsDeleted, _IsVisible, _IsSynced, LastAccessed)
                     VALUES(?1, ?2, ?3, ?1, ?3, 'UserTag', 'false', 'true', 'false', ?1)",
                    [&stamp, &uuid(name), name],
                )
                .map_err(|e| e.to_string())?;
            }
            report.created += 1;
        }
        for (name, id) in &p.add {
            tx.execute(
                "INSERT INTO ShelfContent(ShelfName, ContentId, DateModified, _IsDeleted, _IsSynced) VALUES(?1, ?2, ?3, 'false', 'false')
                 ON CONFLICT(ShelfName, ContentId) DO UPDATE SET _IsDeleted='false', _IsSynced='false', DateModified=excluded.DateModified",
                [name, id, &stamp],
            )
            .map_err(|e| e.to_string())?;
            report.added += 1;
            if fail_after.is_some_and(|n| report.added >= n) {
                return Err("Interruption simulée pendant l’écriture.".into());
            }
        }
        for (name, id) in &p.remove {
            tx.execute(
                "UPDATE ShelfContent SET _IsDeleted='true', _IsSynced='false', DateModified=?1 WHERE ShelfName=?2 AND ContentId=?3",
                [&stamp, name, id],
            )
            .map_err(|e| e.to_string())?;
            report.removed += 1;
        }
        for name in &p.drop {
            tx.execute("UPDATE ShelfContent SET _IsDeleted='true', _IsSynced='false', DateModified=?1 WHERE ShelfName=?2", [&stamp, name])
                .map_err(|e| e.to_string())?;
            tx.execute("UPDATE Shelf SET _IsDeleted='true', _IsSynced='false', LastModified=?1 WHERE Name=?2", [&stamp, name])
                .map_err(|e| e.to_string())?;
            report.shelves_removed += 1;
        }
        let check: String = tx.query_row("PRAGMA quick_check", [], |r| r.get(0)).map_err(|e| e.to_string())?;
        if check != "ok" {
            return Err("Catalogue Kobo incohérent après écriture.".into());
        }
        tx.commit().map_err(|e| e.to_string())?;
        drop(c);
        no_journal(&db)
    })();
    if let Err(error) = result {
        restore(&db, &saved)?;
        return Err(format!("Étagères non modifiées ({error}) : le catalogue de la Kobo a été remis à l’identique."));
    }
    report.backup = Some(saved.to_string_lossy().into_owned());
    Ok(report)
}

/// A copy of the liseuse's catalogue on the PC, checked byte for byte; the ten latest are kept.
fn backup(db: &Path, folder: &Path) -> Result<PathBuf> {
    fs::create_dir_all(folder).map_err(|e| e.to_string())?;
    let name = format!("KoboReader-{}-{}.sqlite", iso(now()).replace([':', '-'], ""), &uuid("backup")[..8]);
    let saved = folder.join(name);
    fs::copy(db, &saved).map_err(|e| format!("Sauvegarde du catalogue Kobo impossible : {e}"))?;
    if hash_file(&saved)? != hash_file(db)? {
        return Err("Sauvegarde Kobo non conforme ; rien n’a été écrit.".into());
    }
    let mut old: Vec<PathBuf> = fs::read_dir(folder)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("KoboReader-")))
        .collect();
    old.sort();
    while old.len() > 10 {
        let _ = fs::remove_file(old.remove(0));
    }
    Ok(saved)
}

fn restore(db: &Path, saved: &Path) -> Result<()> {
    let expected = hash_file(saved)?;
    let temp = PathBuf::from(format!("{}.vera-restore", db.display()));
    fs::copy(saved, &temp).map_err(|e| e.to_string())?;
    if hash_file(&temp)? != expected {
        let _ = fs::remove_file(&temp);
        return Err("Copie de restauration altérée ; catalogue Kobo laissé en l’état.".into());
    }
    for suffix in ["-journal", "-wal"] {
        let _ = fs::remove_file(format!("{}{suffix}", db.display()));
    }
    fs::rename(&temp, db).map_err(|e| e.to_string())?;
    if hash_file(db)? != expected {
        return Err("Restauration du catalogue Kobo non vérifiée.".into());
    }
    Ok(())
}

/// UTC time as the firmware writes it.
fn iso(secs: i64) -> String {
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

fn uuid(seed: &str) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or_default();
    let h = crate::util::hash_bytes(format!("{seed}{nanos}{}{}", std::process::id(), COUNTER.fetch_add(1, Ordering::Relaxed)).as_bytes());
    format!("{}-{}-4{}-a{}-{}", &h[0..8], &h[8..12], &h[13..16], &h[17..20], &h[20..32])
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::store::tests::Sandbox;

    /// A simulated liseuse: the real firmware schema (no personal data) and a version file.
    pub fn device(sandbox: &Sandbox) -> PathBuf {
        let root = sandbox.0.join("KOBO");
        fs::create_dir_all(root.join(".kobo")).unwrap();
        let schema = fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/kobo-schema.sql")).unwrap();
        Connection::open(catalogue(&root)).unwrap().execute_batch(&schema).unwrap();
        fs::write(root.join(".kobo/version"), "SIMULATED-ONLY,0,4.45.23792,00000000-0000-0000-0000-000000000393").unwrap();
        root
    }

    /// What the firmware does at ejection: a sideloaded file gets its row in `content`.
    pub fn import(device: &Path, content: &str) {
        let c = Connection::open(catalogue(device)).unwrap();
        c.execute_batch("CREATE TEMP TABLE t AS SELECT * FROM content WHERE ContentType=6 AND BookID IS NULL LIMIT 1").unwrap();
        c.execute("UPDATE t SET ContentID=?1", [content]).unwrap();
        c.execute_batch("INSERT INTO content SELECT * FROM t; DROP TABLE t;").unwrap();
    }

    fn rows(device: &Path, sql: &str) -> Vec<String> {
        let c = Connection::open(catalogue(device)).unwrap();
        let mut stmt = c.prepare(sql).unwrap();
        let mut rows: Vec<String> = stmt.query_map([], |r| r.get::<_, String>(0)).unwrap().map(|r| r.unwrap()).collect();
        rows.sort();
        rows
    }

    fn wanted(pairs: &[(&str, &[&str])]) -> BTreeMap<String, Vec<String>> {
        pairs.iter().map(|(n, ids)| (n.to_string(), ids.iter().map(|i| i.to_string()).collect())).collect()
    }

    #[test]
    fn dates_are_written_like_the_firmware() {
        assert_eq!(iso(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso(1_792_694_165), "2026-10-22T18:36:05Z");
        assert_ne!(uuid("a"), uuid("a"));
    }

    #[test]
    fn shelves_follow_collections_and_never_touch_the_rest() {
        let sandbox = Sandbox::new();
        let kobo = device(&sandbox);
        let backups = sandbox.0.join("backups");
        let a = format!("{ONBOARD}Vera/a.kepub.epub");
        let b = format!("{ONBOARD}Vera/b.kepub.epub");
        let own = format!("{ONBOARD}Livres/recit-fictif.epub");
        import(&kobo, &a);
        // A shelf made on the Kobo by its owner, holding one of its books.
        let c = Connection::open(catalogue(&kobo)).unwrap();
        c.execute("INSERT INTO Shelf(Id, Name, InternalName, Type, _IsDeleted, _IsVisible, _IsSynced) VALUES('u', 'À moi', 'À moi', 'UserTag', 'false', 'true', 'true')", []).unwrap();
        c.execute("INSERT INTO ShelfContent VALUES('À moi', ?1, '', 'false', 'true')", [&own]).unwrap();
        drop(c);

        let before = hash_file(&catalogue(&kobo)).unwrap();
        let first = apply(&kobo, &backups, &wanted(&[("Classiques", &[&a, &b]), ("Classiques › Dumas", &[])]), &[]).unwrap();
        assert_eq!((first.created, first.added, first.waiting), (2, 1, 1));
        assert_eq!(hash_file(Path::new(first.backup.as_ref().unwrap())).unwrap(), before, "backup taken before writing");

        let unchanged = hash_file(&catalogue(&kobo)).unwrap();
        let again = apply(&kobo, &backups, &wanted(&[("Classiques", &[&a, &b]), ("Classiques › Dumas", &[])]), &[]).unwrap();
        assert!(again.backup.is_none(), "nothing to do, nothing written");
        assert_eq!(hash_file(&catalogue(&kobo)).unwrap(), unchanged);

        // b imported, a moved to Dumas, the Classiques folder emptied: the shelves follow exactly.
        import(&kobo, &b);
        let managed = vec!["Classiques".to_string(), "Classiques › Dumas".to_string()];
        let moved = apply(&kobo, &backups, &wanted(&[("Classiques", &[&b]), ("Classiques › Dumas", &[&a])]), &managed).unwrap();
        assert_eq!((moved.added, moved.removed), (2, 1));
        let gone = apply(&kobo, &backups, &wanted(&[("Classiques › Dumas", &[&a, &b])]), &managed).unwrap();
        assert_eq!(gone.shelves_removed, 1);
        assert_eq!(rows(&kobo, "SELECT Name FROM Shelf WHERE _IsDeleted='false'"), vec!["Classiques › Dumas", "À moi"]);
        assert_eq!(rows(&kobo, "SELECT ContentId FROM ShelfContent WHERE ShelfName='À moi' AND _IsDeleted='false'"), vec![own.clone()]);
        // Never a journal left behind.
        assert!(no_journal(&catalogue(&kobo)).is_ok());
    }

    #[test]
    fn an_interruption_restores_the_exact_catalogue() {
        let sandbox = Sandbox::new();
        let kobo = device(&sandbox);
        let a = format!("{ONBOARD}Vera/a.kepub.epub");
        import(&kobo, &a);
        let before = hash_file(&catalogue(&kobo)).unwrap();
        let error = apply_with(&kobo, &sandbox.0.join("backups"), &wanted(&[("Essai", &[&a])]), &[], Some(1)).unwrap_err();
        assert!(error.contains("remis à l’identique"));
        assert_eq!(hash_file(&catalogue(&kobo)).unwrap(), before);
    }

    #[test]
    fn a_busy_catalogue_is_left_alone() {
        let sandbox = Sandbox::new();
        let kobo = device(&sandbox);
        fs::write(format!("{}-wal", catalogue(&kobo).display()), b"busy").unwrap();
        assert!(apply(&kobo, &sandbox.0.join("b"), &wanted(&[("Essai", &[])]), &[]).is_err());
    }
}
