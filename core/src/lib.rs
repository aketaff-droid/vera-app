//! Vera 2.0: a list of the EPUB and PDF books of one watched folder, sent to a Kobo without duplicates and
//! shelved by sub-folder. Nothing here ever deletes or modifies a file of the watched folder, and nothing is
//! ever deleted from a Kobo except Vera's own copies, replaced in place (docs/CAHIER-DES-CHARGES-2.0.md).

pub mod cover;
pub mod edit;
pub mod kepub;
pub mod kobo;
pub mod metadata;
pub mod openlibrary;
pub mod scan;
pub mod share;
pub mod shelves;
pub mod store;
pub mod util;

pub type Result<T> = std::result::Result<T, String>;

/// Book formats Vera handles; anything else in the folder is ignored.
pub const FORMATS: [&str; 2] = ["epub", "pdf"];
/// A sub-collection's name is its folder path: the Kobo only knows flat shelves.
pub const SEP: &str = " › ";
