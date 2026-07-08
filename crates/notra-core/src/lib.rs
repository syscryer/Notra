pub mod document;
pub mod fs;
pub mod search;

pub use document::{Document, DocumentMeta, EncodingKind, LineEnding};
pub use fs::{
    DirectorySearchReport, FileHit, FileReplacePreview, apply_directory_replace,
    preview_directory_replace, search_directory,
};
pub use search::{
    MatchRange, ReplaceOutcome, SearchError, SearchMode, SearchOptions, TextMatch,
    apply_replace_all, find_all, preview_replace, replacement_for_match,
};
