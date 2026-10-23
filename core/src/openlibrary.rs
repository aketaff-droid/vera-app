//! « Compléter la fiche »: an explicit ISBN lookup on Open Library (free, no account). Ported from 1.2's
//! `bibliography.py`: the edition must confirm the ISBN, values are bounded, authors are kept only when every
//! one of them is confirmed, and nothing is applied without the owner's choice.
use crate::{metadata::isbn, Result};
use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub title: Option<String>,
    pub authors: Option<String>,
    pub publisher: Option<String>,
    pub published: Option<String>,
    pub description: Option<String>,
    pub subjects: Option<Vec<String>>,
    pub url: String,
    pub warnings: Vec<String>,
}

/// How a path of openlibrary.org is fetched: the network in Vera, a table in the tests.
pub trait Fetch {
    fn get(&self, path: &str) -> Result<Value>;
}

pub struct Web;

impl Fetch for Web {
    fn get(&self, path: &str) -> Result<Value> {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(15)))
            .max_redirects(0)
            .user_agent("Vera/2.0 (bibliothèque personnelle)")
            .build()
            .into();
        let response = agent.get(&format!("https://openlibrary.org{path}")).call().map_err(|e| match e {
            ureq::Error::StatusCode(404) => "Aucune édition trouvée pour cet ISBN.".to_string(),
            ureq::Error::StatusCode(_) => "Open Library est momentanément indisponible. Réessaie plus tard.".to_string(),
            _ => "Open Library ne répond pas. Ta fiche n’a pas changé.".to_string(),
        })?;
        let text = response.into_body().with_config().limit(1024 * 1024).read_to_string().map_err(|_| "Réponse d’Open Library trop volumineuse ou illisible.")?;
        serde_json::from_str(&text).map_err(|_| "Réponse d’Open Library inattendue.".into())
    }
}

fn bounded(value: &Value, limit: usize) -> Option<String> {
    let text = value.as_str()?.trim();
    (!text.is_empty() && text.chars().count() <= limit && !text.contains('\0')).then(|| text.to_string())
}

pub fn lookup(value: &str, fetch: &dyn Fetch, pause: &dyn Fn()) -> Result<Found> {
    let wanted = isbn(value).ok_or("ISBN invalide : vérifie ses chiffres sur la fiche avant la recherche.")?;
    let wanted13 = to13(&wanted);
    let book = fetch.get(&format!("/isbn/{wanted}.json"))?;
    let listed: Vec<String> = ["isbn_10", "isbn_13"]
        .iter()
        .flat_map(|k| book[*k].as_array().cloned().unwrap_or_default())
        .take(100)
        .filter_map(|v| v.as_str().and_then(isbn))
        .map(|i| to13(&i))
        .collect();
    if !listed.contains(&wanted13) {
        return Err("L’édition trouvée ne confirme pas cet ISBN : rien n’est proposé.".into());
    }
    let key = book["key"].as_str().unwrap_or("");
    let edition = key.strip_prefix("/books/OL").and_then(|k| k.strip_suffix('M'));
    if !edition.is_some_and(|k| !k.is_empty() && k.len() < 30 && k.chars().all(|c| c.is_ascii_digit())) {
        return Err("Référence d’édition inattendue.".into());
    }
    let mut found = Found { url: format!("https://openlibrary.org{key}"), ..Found::default() };
    found.title = bounded(&book["title"], 500);
    found.published = bounded(&book["publish_date"], 100);
    if let Some(list) = book["publishers"].as_array() {
        let names: Option<Vec<&str>> = list.iter().map(Value::as_str).collect();
        found.publisher = names.and_then(|n| bounded(&Value::from(n.join(", ")), 500));
    }
    let description = if book["description"].is_object() { &book["description"]["value"] } else { &book["description"] };
    found.description = bounded(description, 20_000);
    if let Some(list) = book["subjects"].as_array().filter(|l| !l.is_empty() && l.len() <= 100) {
        let subjects: Option<Vec<String>> = list.iter().map(|s| bounded(s, 200)).collect();
        found.subjects = subjects;
    }
    if let Some(authors) = book["authors"].as_array().filter(|a| !a.is_empty() && a.len() <= 5) {
        let mut names = Vec::new();
        for author in authors {
            let key = author["key"].as_str().unwrap_or("");
            let valid = key.strip_prefix("/authors/OL").and_then(|k| k.strip_suffix('A')).is_some_and(|k| !k.is_empty() && k.chars().all(|c| c.is_ascii_digit()));
            if !valid {
                break;
            }
            pause();
            match fetch.get(&format!("{key}.json")).ok().and_then(|a| bounded(&a["name"], 300)) {
                Some(name) => names.push(name),
                None => break,
            }
        }
        if names.len() == authors.len() {
            found.authors = Some(names.join(" · "));
        } else {
            found.warnings.push("Auteurs non confirmés : ils ne sont pas proposés.".into());
        }
    }
    if found.title.is_none() && found.authors.is_none() && found.publisher.is_none() && found.published.is_none() && found.description.is_none() && found.subjects.is_none() {
        return Err("Aucune information exploitable pour cet ISBN.".into());
    }
    Ok(found)
}

fn to13(isbn: &str) -> String {
    if isbn.len() == 13 {
        return isbn.to_string();
    }
    let body = format!("978{}", &isbn[..9]);
    let sum: u32 = body.chars().enumerate().map(|(i, c)| c.to_digit(10).unwrap_or(0) * if i % 2 == 0 { 1 } else { 3 }).sum();
    format!("{body}{}", (10 - sum % 10) % 10)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashMap;

    struct Table(HashMap<String, Value>);
    impl Fetch for Table {
        fn get(&self, path: &str) -> Result<Value> {
            self.0.get(path).cloned().ok_or_else(|| "Aucune édition trouvée pour cet ISBN.".into())
        }
    }

    fn table(book: Value) -> Table {
        let mut t = HashMap::new();
        t.insert("/isbn/9782253096337.json".into(), book);
        t.insert("/authors/OL1A.json".into(), json!({"name": "Victor Hugo"}));
        Table(t)
    }

    #[test]
    fn a_confirmed_edition_gives_its_fields() {
        let book = json!({"key": "/books/OL42M", "title": "Les Misérables", "isbn_10": ["2253096334"], "publishers": ["Le Livre de Poche"],
            "publish_date": "1998", "authors": [{"key": "/authors/OL1A"}], "description": {"value": "Roman."}, "subjects": ["Roman"]});
        let found = lookup("978-2-253-09633-7", &table(book), &|| {}).unwrap();
        assert_eq!(found.title.as_deref(), Some("Les Misérables"));
        assert_eq!(found.authors.as_deref(), Some("Victor Hugo"));
        assert_eq!(found.publisher.as_deref(), Some("Le Livre de Poche"));
        assert_eq!(found.description.as_deref(), Some("Roman."));
        assert_eq!(found.url, "https://openlibrary.org/books/OL42M");
        assert_eq!(to13("2253096334"), "9782253096337");
    }

    #[test]
    fn doubtful_answers_propose_nothing() {
        assert!(lookup("123", &table(json!({})), &|| {}).is_err());
        let other = json!({"key": "/books/OL42M", "title": "Autre", "isbn_13": ["9780306406157"]});
        assert!(lookup("9782253096337", &table(other), &|| {}).unwrap_err().contains("ne confirme pas"));
        let strange = json!({"key": "/works/x", "title": "T", "isbn_13": ["9782253096337"]});
        assert!(lookup("9782253096337", &table(strange), &|| {}).is_err());
        let unknown_author = json!({"key": "/books/OL42M", "title": "T", "isbn_13": ["9782253096337"], "authors": [{"key": "/authors/OL9A"}]});
        let found = lookup("9782253096337", &table(unknown_author), &|| {}).unwrap();
        assert!(found.authors.is_none() && !found.warnings.is_empty());
    }
}
