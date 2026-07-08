use notra_core::{SearchMode, SearchOptions};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::PathBuf;

const SESSION_VERSION: u32 = 1;

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchOptionsSnapshot {
    pub mode: String,
    pub match_case: bool,
    pub whole_word: bool,
    pub wrap: bool,
    pub include_hidden: bool,
    #[serde(default = "default_true")]
    pub recursive: bool,
    pub file_glob: String,
    pub skip_dirs: String,
    pub max_file_size: u64,
}

impl From<&SearchOptions> for SearchOptionsSnapshot {
    fn from(options: &SearchOptions) -> Self {
        Self {
            mode: match options.mode {
                SearchMode::Literal => "literal",
                SearchMode::Extended => "extended",
                SearchMode::Regex => "regex",
            }
            .to_owned(),
            match_case: options.match_case,
            whole_word: options.whole_word,
            wrap: options.wrap,
            include_hidden: options.include_hidden,
            recursive: options.recursive,
            file_glob: options.file_glob.clone(),
            skip_dirs: options.skip_dirs.clone(),
            max_file_size: options.max_file_size,
        }
    }
}

impl SearchOptionsSnapshot {
    pub fn apply_to(&self, options: &mut SearchOptions) {
        options.mode = match self.mode.as_str() {
            "extended" => SearchMode::Extended,
            "regex" => SearchMode::Regex,
            _ => SearchMode::Literal,
        };
        options.match_case = self.match_case;
        options.whole_word = self.whole_word;
        options.wrap = self.wrap;
        options.include_hidden = self.include_hidden;
        options.recursive = self.recursive;
        options.file_glob = self.file_glob.clone();
        options.skip_dirs = self.skip_dirs.clone();
        options.max_file_size = self.max_file_size;
    }
}

impl Default for SearchOptionsSnapshot {
    fn default() -> Self {
        Self::from(&SearchOptions::default())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionState {
    pub version: u32,
    pub open_files: Vec<PathBuf>,
    pub recent_files: Vec<PathBuf>,
    pub workspace: Option<PathBuf>,
    #[serde(default)]
    pub workspace_filter: String,
    pub search_history: Vec<String>,
    pub replace_history: Vec<String>,
    pub dark_mode: bool,
    pub show_bottom: bool,
    pub search_options: SearchOptionsSnapshot,
}

impl Default for SessionState {
    fn default() -> Self {
        Self {
            version: SESSION_VERSION,
            open_files: Vec::new(),
            recent_files: Vec::new(),
            workspace: None,
            workspace_filter: String::new(),
            search_history: Vec::new(),
            replace_history: Vec::new(),
            dark_mode: false,
            show_bottom: false,
            search_options: SearchOptionsSnapshot::default(),
        }
    }
}

impl SessionState {
    pub fn load() -> io::Result<Self> {
        let path = session_file_path();
        let text = fs::read_to_string(path)?;
        let mut state: Self = serde_json::from_str(&text)
            .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))?;
        state.version = SESSION_VERSION;
        Ok(state)
    }

    pub fn save(&self) -> io::Result<()> {
        let path = session_file_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let text = serde_json::to_string_pretty(self)
            .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))?;
        fs::write(path, text)
    }
}

pub fn session_file_path() -> PathBuf {
    if let Some(appdata) = std::env::var_os("APPDATA") {
        return PathBuf::from(appdata).join("Notra").join("session.json");
    }
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".notra-session.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_options_snapshot_restores_core_options() {
        let source = SearchOptions {
            mode: SearchMode::Regex,
            match_case: true,
            whole_word: true,
            wrap: false,
            include_hidden: true,
            recursive: false,
            file_glob: "*.rs".to_owned(),
            skip_dirs: "target".to_owned(),
            max_file_size: 1024,
        };

        let snapshot = SearchOptionsSnapshot::from(&source);
        let mut restored = SearchOptions::default();
        snapshot.apply_to(&mut restored);

        assert_eq!(restored, source);
    }
}
