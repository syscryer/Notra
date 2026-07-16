use crate::document::EncodingKind;
use crate::search::{
    ReplaceOutcome, SearchError, SearchMatcher, SearchOptions, TextMatch,
    apply_replace_all_with_matcher,
};
use encoding_rs::{GBK, UTF_8};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;
use walkdir::{DirEntry, WalkDir};

#[derive(Debug, Clone)]
pub struct DecodedText {
    pub text: String,
    pub encoding: EncodingKind,
}

#[derive(Debug, Clone)]
pub struct FileHit {
    pub path: PathBuf,
    pub matches: Vec<TextMatch>,
    pub encoding: EncodingKind,
}

#[derive(Debug, Clone)]
pub struct FileReplacePreview {
    pub path: PathBuf,
    pub outcome: ReplaceOutcome,
    pub encoding: EncodingKind,
}

#[derive(Debug, Default, Clone)]
pub struct DirectorySearchReport {
    pub hits: Vec<FileHit>,
    pub skipped: Vec<String>,
    pub files_scanned: usize,
    pub elapsed_ms: u64,
}

pub fn decode_bytes(bytes: &[u8]) -> DecodedText {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        let (cow, _, _) = UTF_8.decode(&bytes[3..]);
        return DecodedText {
            text: cow.into_owned(),
            encoding: EncodingKind::Utf8Bom,
        };
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return DecodedText {
            text: decode_utf16(&bytes[2..], true),
            encoding: EncodingKind::Utf16Le,
        };
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return DecodedText {
            text: decode_utf16(&bytes[2..], false),
            encoding: EncodingKind::Utf16Be,
        };
    }

    let (utf8, _, had_errors) = UTF_8.decode(bytes);
    if !had_errors {
        DecodedText {
            text: utf8.into_owned(),
            encoding: EncodingKind::Utf8,
        }
    } else {
        let (gbk, _, _) = GBK.decode(bytes);
        DecodedText {
            text: gbk.into_owned(),
            encoding: EncodingKind::Gbk,
        }
    }
}

pub fn decode_bytes_with_encoding(bytes: &[u8], encoding: EncodingKind) -> DecodedText {
    let text = match encoding {
        EncodingKind::Utf8 => {
            let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
            let (cow, _, _) = UTF_8.decode(bytes);
            cow.into_owned()
        }
        EncodingKind::Utf8Bom => {
            let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
            let (cow, _, _) = UTF_8.decode(bytes);
            cow.into_owned()
        }
        EncodingKind::Utf16Le => {
            let bytes = bytes.strip_prefix(&[0xFF, 0xFE]).unwrap_or(bytes);
            decode_utf16(bytes, true)
        }
        EncodingKind::Utf16Be => {
            let bytes = bytes.strip_prefix(&[0xFE, 0xFF]).unwrap_or(bytes);
            decode_utf16(bytes, false)
        }
        EncodingKind::Gbk => {
            let (cow, _, _) = GBK.decode(bytes);
            cow.into_owned()
        }
    };

    DecodedText { text, encoding }
}

pub fn encode_text(text: &str, encoding: EncodingKind) -> Vec<u8> {
    match encoding {
        EncodingKind::Utf8 => text.as_bytes().to_vec(),
        EncodingKind::Utf8Bom => {
            let mut out = vec![0xEF, 0xBB, 0xBF];
            out.extend_from_slice(text.as_bytes());
            out
        }
        EncodingKind::Utf16Le => {
            let mut out = vec![0xFF, 0xFE];
            for unit in text.encode_utf16() {
                out.extend_from_slice(&unit.to_le_bytes());
            }
            out
        }
        EncodingKind::Utf16Be => {
            let mut out = vec![0xFE, 0xFF];
            for unit in text.encode_utf16() {
                out.extend_from_slice(&unit.to_be_bytes());
            }
            out
        }
        EncodingKind::Gbk => {
            let (cow, _, _) = GBK.encode(text);
            cow.into_owned()
        }
    }
}

pub fn search_directory(
    root: impl AsRef<Path>,
    query: &str,
    options: &SearchOptions,
) -> Result<DirectorySearchReport, SearchError> {
    let started = Instant::now();
    let root = root.as_ref();
    let mut report = DirectorySearchReport::default();
    let matcher = SearchMatcher::new(query, options)?;
    let file_glob = FileGlobMatcher::new(&options.file_glob);
    let skip_dirs = parse_list(&options.skip_dirs);
    let mut walker = WalkDir::new(root);
    if !options.recursive {
        walker = walker.max_depth(1);
    }
    for entry in walker
        .into_iter()
        .filter_entry(|entry| should_visit(entry, options, &skip_dirs))
    {
        let entry = match entry {
            Ok(entry) => entry,
            Err(err) => {
                report.skipped.push(err.to_string());
                continue;
            }
        };
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        if !file_glob.matches(path) {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(err) => {
                report.skipped.push(format!("{}: {err}", path.display()));
                continue;
            }
        };
        if metadata.len() > options.max_file_size {
            report
                .skipped
                .push(format!("{}: file too large", path.display()));
            continue;
        }
        report.files_scanned += 1;
        match read_text(path) {
            Ok(decoded) => {
                let matches = matcher.find_all(&decoded.text);
                if !matches.is_empty() {
                    report.hits.push(FileHit {
                        path: path.to_path_buf(),
                        matches,
                        encoding: decoded.encoding,
                    });
                }
            }
            Err(err) => report.skipped.push(format!("{}: {err}", path.display())),
        }
    }
    report.elapsed_ms = started.elapsed().as_millis().try_into().unwrap_or(u64::MAX);
    Ok(report)
}

pub fn preview_directory_replace(
    root: impl AsRef<Path>,
    query: &str,
    replacement: &str,
    options: &SearchOptions,
) -> Result<(Vec<FileReplacePreview>, Vec<String>), SearchError> {
    let matcher = SearchMatcher::new(query, options)?;
    let report = search_directory(root, query, options)?;
    let mut previews = Vec::new();
    let mut skipped = report.skipped;
    for hit in report.hits {
        match fs::metadata(&hit.path) {
            Ok(metadata) if metadata.permissions().readonly() => {
                skipped.push(format!("{}: read-only file", hit.path.display()));
                continue;
            }
            Ok(_) => {}
            Err(err) => {
                skipped.push(format!("{}: {err}", hit.path.display()));
                continue;
            }
        }
        match read_text(&hit.path) {
            Ok(decoded) => {
                let outcome =
                    apply_replace_all_with_matcher(&decoded.text, replacement, options, &matcher);
                if outcome.count > 0 {
                    previews.push(FileReplacePreview {
                        path: hit.path,
                        outcome,
                        encoding: decoded.encoding,
                    });
                }
            }
            Err(err) => skipped.push(format!("{}: {err}", hit.path.display())),
        }
    }
    Ok((previews, skipped))
}

pub fn apply_directory_replace(previews: &[FileReplacePreview]) -> io::Result<usize> {
    let mut count = 0;
    for preview in previews {
        write_text_atomically(&preview.path, &preview.outcome.text, preview.encoding)?;
        count += preview.outcome.count;
    }
    Ok(count)
}

pub fn write_text_atomically(path: &Path, text: &str, encoding: EncodingKind) -> io::Result<()> {
    let bytes = encode_text(text, encoding);
    replace_file_atomically(path, &bytes)
}

pub fn read_text(path: impl AsRef<Path>) -> io::Result<DecodedText> {
    let bytes = fs::read(path)?;
    if is_probably_binary(&bytes) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "binary file skipped",
        ));
    }
    Ok(decode_bytes(&bytes))
}

fn is_probably_binary(bytes: &[u8]) -> bool {
    if bytes.is_empty() || bytes.starts_with(&[0xFF, 0xFE]) || bytes.starts_with(&[0xFE, 0xFF]) {
        return false;
    }
    let sample = &bytes[..bytes.len().min(8192)];
    if sample.contains(&0) {
        return true;
    }
    let control_count = sample
        .iter()
        .filter(|byte| byte.is_ascii_control() && !matches!(byte, b'\t' | b'\n' | b'\r' | 0x0C))
        .count();
    control_count * 100 > sample.len() * 30
}

fn decode_utf16(bytes: &[u8], little_endian: bool) -> String {
    let units = bytes.chunks_exact(2).map(|chunk| {
        if little_endian {
            u16::from_le_bytes([chunk[0], chunk[1]])
        } else {
            u16::from_be_bytes([chunk[0], chunk[1]])
        }
    });
    String::from_utf16_lossy(&units.collect::<Vec<_>>())
}

fn replace_file_atomically(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let metadata = fs::metadata(path)?;
    if metadata.permissions().readonly() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "read-only file",
        ));
    }

    let tmp_path = unique_sibling_path(path, "notra-tmp");
    let backup_path = unique_sibling_path(path, "notra-bak");
    {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp_path)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    fs::set_permissions(&tmp_path, metadata.permissions())?;

    if let Err(err) = fs::rename(path, &backup_path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(err);
    }

    match fs::rename(&tmp_path, path) {
        Ok(()) => {
            let _ = fs::remove_file(&backup_path);
            Ok(())
        }
        Err(err) => {
            let _ = fs::remove_file(&tmp_path);
            let _ = fs::rename(&backup_path, path);
            Err(err)
        }
    }
}

fn unique_sibling_path(path: &Path, tag: &str) -> PathBuf {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("file");
    for attempt in 0..1000 {
        let candidate = parent.join(format!(
            ".{file_name}.{tag}-{}-{attempt}.tmp",
            std::process::id()
        ));
        if !candidate.exists() {
            return candidate;
        }
    }
    parent.join(format!(".{file_name}.{tag}-{}.tmp", std::process::id()))
}

fn should_visit(entry: &DirEntry, options: &SearchOptions, skip_dirs: &[String]) -> bool {
    let name = entry.file_name().to_string_lossy();
    if !options.include_hidden && name.starts_with('.') {
        return false;
    }
    if entry.file_type().is_dir() {
        !skip_dirs.iter().any(|dir| dir.eq_ignore_ascii_case(&name))
    } else {
        true
    }
}

fn parse_list(input: &str) -> Vec<String> {
    input
        .split([';', ',', ' '])
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

enum FileGlobPattern {
    Extension(String),
    ContainsAll(Vec<String>),
    NameOrExtension(String),
}

struct FileGlobMatcher {
    match_all: bool,
    patterns: Vec<FileGlobPattern>,
}

impl FileGlobMatcher {
    fn new(glob: &str) -> Self {
        let raw_patterns = parse_list(glob);
        let match_all = raw_patterns.is_empty()
            || raw_patterns
                .iter()
                .any(|pattern| pattern == "*.*" || pattern == "*");
        let patterns = if match_all {
            Vec::new()
        } else {
            raw_patterns
                .into_iter()
                .map(|pattern| pattern.to_ascii_lowercase())
                .map(|pattern| {
                    if let Some(extension) = pattern.strip_prefix("*.") {
                        FileGlobPattern::Extension(extension.to_owned())
                    } else if pattern.contains('*') {
                        FileGlobPattern::ContainsAll(
                            pattern
                                .split('*')
                                .filter(|part| !part.is_empty())
                                .map(ToOwned::to_owned)
                                .collect(),
                        )
                    } else {
                        FileGlobPattern::NameOrExtension(pattern)
                    }
                })
                .collect()
        };
        Self {
            match_all,
            patterns,
        }
    }

    fn matches(&self, path: &Path) -> bool {
        if self.match_all {
            return true;
        }
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let extension = path
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();

        self.patterns.iter().any(|pattern| match pattern {
            FileGlobPattern::Extension(expected) => extension == *expected,
            FileGlobPattern::ContainsAll(parts) => {
                parts.iter().all(|part| file_name.contains(part))
            }
            FileGlobPattern::NameOrExtension(expected) => {
                file_name == *expected || extension == expected.trim_start_matches('.')
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_bom_roundtrip_keeps_bom() {
        let decoded = decode_bytes(&[0xEF, 0xBB, 0xBF, b'a']);
        assert_eq!(decoded.encoding, EncodingKind::Utf8Bom);
        assert_eq!(
            encode_text(&decoded.text, decoded.encoding)[..3],
            [0xEF, 0xBB, 0xBF]
        );
    }

    #[test]
    fn non_recursive_directory_search_skips_nested_files() {
        let root =
            std::env::temp_dir().join(format!("notra-non-recursive-test-{}", std::process::id()));
        let nested = root.join("nested");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&nested).unwrap();
        fs::write(root.join("top.txt"), "notra").unwrap();
        fs::write(nested.join("inner.txt"), "notra").unwrap();

        let options = SearchOptions {
            recursive: false,
            file_glob: "*.txt".to_owned(),
            ..Default::default()
        };
        let report = search_directory(&root, "notra", &options).unwrap();
        fs::remove_dir_all(&root).unwrap();

        assert_eq!(report.hits.len(), 1);
        assert!(report.hits[0].path.ends_with("top.txt"));
    }

    #[test]
    fn file_glob_matches_multiple_masks_without_case_sensitivity() {
        let matcher = FileGlobMatcher::new("*.rs; *.MD");

        assert!(matcher.matches(Path::new("main.RS")));
        assert!(matcher.matches(Path::new("README.md")));
        assert!(!matcher.matches(Path::new("package.json")));
    }

    #[test]
    fn directory_search_reports_scanned_files_and_elapsed_time() {
        let root =
            std::env::temp_dir().join(format!("notra-search-report-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("hit.txt"), "notra").unwrap();
        fs::write(root.join("miss.txt"), "another editor").unwrap();
        fs::write(root.join("ignored.md"), "notra").unwrap();

        let options = SearchOptions {
            file_glob: "*.txt".to_owned(),
            ..Default::default()
        };
        let report = search_directory(&root, "notra", &options).unwrap();
        fs::remove_dir_all(&root).unwrap();

        assert_eq!(report.files_scanned, 2);
        assert_eq!(report.hits.len(), 1);
        assert!(report.hits[0].path.ends_with("hit.txt"));
        assert!(report.elapsed_ms < 10_000);
    }

    #[test]
    fn read_text_rejects_probable_binary_files() {
        let path = std::env::temp_dir().join(format!("notra-binary-test-{}", std::process::id()));
        fs::write(&path, [0, 159, 146, 150, b'n', b'o', b't', b'r', b'a']).unwrap();
        let err = read_text(&path).unwrap_err();
        fs::remove_file(&path).unwrap();

        assert_eq!(err.kind(), io::ErrorKind::InvalidData);
    }

    #[test]
    fn replace_preview_skips_readonly_files() {
        let root = std::env::temp_dir().join(format!(
            "notra-readonly-preview-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let path = root.join("readonly.txt");
        fs::write(&path, "notra").unwrap();
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&path, permissions).unwrap();

        let options = SearchOptions {
            file_glob: "*.txt".to_owned(),
            ..Default::default()
        };
        let (preview, skipped) =
            preview_directory_replace(&root, "notra", "NOTRA", &options).unwrap();

        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_readonly(false);
        fs::set_permissions(&path, permissions).unwrap();
        fs::remove_dir_all(&root).unwrap();

        assert!(preview.is_empty());
        assert!(skipped.iter().any(|item| item.contains("read-only")));
    }

    #[test]
    fn directory_replace_writes_via_temp_file() {
        let root =
            std::env::temp_dir().join(format!("notra-atomic-replace-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let path = root.join("sample.txt");
        fs::write(&path, "hello notra").unwrap();

        let options = SearchOptions {
            file_glob: "*.txt".to_owned(),
            ..Default::default()
        };
        let (preview, skipped) =
            preview_directory_replace(&root, "notra", "NOTRA", &options).unwrap();
        assert!(skipped.is_empty());

        let count = apply_directory_replace(&preview).unwrap();

        assert_eq!(count, 1);
        assert_eq!(fs::read_to_string(&path).unwrap(), "hello NOTRA");
        assert!(
            fs::read_dir(&root)
                .unwrap()
                .filter_map(Result::ok)
                .all(
                    |entry| !entry.file_name().to_string_lossy().contains("notra-tmp")
                        && !entry.file_name().to_string_lossy().contains("notra-bak")
                )
        );

        fs::remove_dir_all(&root).unwrap();
    }
}
