use crate::fs::{decode_bytes, encode_text};
use crate::search::{ReplaceOutcome, SearchOptions, apply_replace_all};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub const EDITABLE_FILE_LIMIT_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncodingKind {
    Utf8,
    Utf8Bom,
    Utf16Le,
    Utf16Be,
    Gbk,
}

impl EncodingKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::Utf8 => "UTF-8",
            Self::Utf8Bom => "UTF-8 BOM",
            Self::Utf16Le => "UTF-16 LE",
            Self::Utf16Be => "UTF-16 BE",
            Self::Gbk => "GBK",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineEnding {
    Lf,
    Crlf,
    Cr,
}

impl LineEnding {
    pub fn detect(text: &str) -> Self {
        if text.contains("\r\n") {
            Self::Crlf
        } else if text.contains('\r') {
            Self::Cr
        } else {
            Self::Lf
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Lf => "LF",
            Self::Crlf => "CRLF",
            Self::Cr => "CR",
        }
    }
}

#[derive(Debug, Clone)]
pub struct DocumentMeta {
    pub path: Option<PathBuf>,
    pub encoding: EncodingKind,
    pub line_ending: LineEnding,
    pub file_size: usize,
    pub read_only: bool,
    pub read_only_reason: Option<String>,
}

impl Default for DocumentMeta {
    fn default() -> Self {
        Self {
            path: None,
            encoding: EncodingKind::Utf8,
            line_ending: LineEnding::Lf,
            file_size: 0,
            read_only: false,
            read_only_reason: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Document {
    pub title: String,
    pub text: String,
    pub meta: DocumentMeta,
    dirty: bool,
    saved_text: String,
    undo_stack: Vec<String>,
    redo_stack: Vec<String>,
}

impl Document {
    pub fn untitled(index: usize) -> Self {
        Self {
            title: format!("Untitled-{index}"),
            text: String::new(),
            meta: DocumentMeta::default(),
            dirty: false,
            saved_text: String::new(),
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        }
    }

    pub fn open(path: impl AsRef<Path>) -> io::Result<Self> {
        let path = path.as_ref();
        let metadata = fs::metadata(path)?;
        let bytes = fs::read(path)?;
        let decoded = decode_bytes(&bytes);
        let title = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Untitled")
            .to_owned();
        let line_ending = LineEnding::detect(&decoded.text);
        let text = decoded.text;
        let (read_only, read_only_reason) = read_only_state(
            metadata.permissions().readonly(),
            metadata.len(),
            EDITABLE_FILE_LIMIT_BYTES,
        );
        Ok(Self {
            title,
            saved_text: text.clone(),
            text,
            meta: DocumentMeta {
                path: Some(path.to_path_buf()),
                encoding: decoded.encoding,
                line_ending,
                file_size: bytes.len(),
                read_only,
                read_only_reason,
            },
            dirty: false,
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        })
    }

    pub fn save(&mut self) -> io::Result<()> {
        if self.meta.read_only {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                self.read_only_reason(),
            ));
        }
        let Some(path) = self.meta.path.clone() else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "document has no path",
            ));
        };
        self.save_as(path)
    }

    pub fn save_as(&mut self, path: impl AsRef<Path>) -> io::Result<()> {
        let path = path.as_ref();
        let bytes = encode_text(&self.text, self.meta.encoding);
        if path.exists() {
            crate::fs::write_text_atomically(path, &self.text, self.meta.encoding)?;
        } else {
            fs::write(path, &bytes)?;
        }
        self.meta.path = Some(path.to_path_buf());
        self.meta.file_size = bytes.len();
        self.meta.line_ending = LineEnding::detect(&self.text);
        let file_read_only = fs::metadata(path)
            .map(|metadata| metadata.permissions().readonly())
            .unwrap_or(false);
        let (read_only, read_only_reason) = read_only_state(
            file_read_only,
            bytes.len() as u64,
            EDITABLE_FILE_LIMIT_BYTES,
        );
        self.meta.read_only = read_only;
        self.meta.read_only_reason = read_only_reason;
        self.title = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Untitled")
            .to_owned();
        self.saved_text = self.text.clone();
        self.dirty = false;
        Ok(())
    }

    pub fn mark_changed(&mut self, previous: String) {
        if self.meta.read_only {
            if previous != self.text {
                self.text = previous;
            }
            return;
        }
        if previous != self.text {
            self.undo_stack.push(previous);
            self.redo_stack.clear();
            self.dirty = self.text != self.saved_text;
            self.meta.line_ending = LineEnding::detect(&self.text);
        }
    }

    pub fn set_text(&mut self, text: String) {
        let previous = std::mem::replace(&mut self.text, text);
        self.mark_changed(previous);
    }

    pub fn replace_all(
        &mut self,
        query: &str,
        replacement: &str,
        options: &SearchOptions,
    ) -> Result<ReplaceOutcome, crate::search::SearchError> {
        if self.meta.read_only {
            return Err(crate::search::SearchError::ReadOnlyDocument(
                self.read_only_reason(),
            ));
        }
        let previous = self.text.clone();
        let outcome = apply_replace_all(&self.text, query, replacement, options)?;
        if outcome.count > 0 {
            self.text = outcome.text.clone();
            self.mark_changed(previous);
        }
        Ok(outcome)
    }

    pub fn undo(&mut self) -> bool {
        if self.meta.read_only {
            return false;
        }
        let Some(prev) = self.undo_stack.pop() else {
            return false;
        };
        self.redo_stack
            .push(std::mem::replace(&mut self.text, prev));
        self.dirty = self.text != self.saved_text;
        self.meta.line_ending = LineEnding::detect(&self.text);
        true
    }

    pub fn redo(&mut self) -> bool {
        if self.meta.read_only {
            return false;
        }
        let Some(next) = self.redo_stack.pop() else {
            return false;
        };
        self.undo_stack
            .push(std::mem::replace(&mut self.text, next));
        self.dirty = self.text != self.saved_text;
        self.meta.line_ending = LineEnding::detect(&self.text);
        true
    }

    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    pub fn read_only_reason(&self) -> String {
        self.meta
            .read_only_reason
            .clone()
            .unwrap_or_else(|| "文件处于只读保护".to_owned())
    }

    pub fn line_count(&self) -> usize {
        self.text.lines().count().max(1)
    }

    pub fn char_count(&self) -> usize {
        self.text.chars().count()
    }

    pub fn byte_size(&self) -> usize {
        self.text.len()
    }
}

fn read_only_state(
    file_read_only: bool,
    file_size: u64,
    editable_limit: u64,
) -> (bool, Option<String>) {
    let mut reasons = Vec::new();
    if file_read_only {
        reasons.push("文件系统只读".to_owned());
    }
    if file_size > editable_limit {
        reasons.push(format!(
            "超过 {} MB 编辑保护阈值",
            editable_limit / 1024 / 1024
        ));
    }
    if reasons.is_empty() {
        (false, None)
    } else {
        (true, Some(reasons.join("；")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn undo_back_to_saved_text_clears_dirty_flag() {
        let mut doc = Document::untitled(1);
        doc.set_text("abc".to_owned());
        assert!(doc.is_dirty());
        assert!(doc.undo());
        assert!(!doc.is_dirty());
    }

    #[test]
    fn redo_after_clean_undo_marks_dirty_again() {
        let mut doc = Document::untitled(1);
        doc.set_text("abc".to_owned());
        assert!(doc.undo());
        assert!(!doc.is_dirty());
        assert!(doc.redo());
        assert!(doc.is_dirty());
    }

    #[test]
    fn read_only_document_rejects_replace() {
        let mut doc = Document::untitled(1);
        doc.meta.read_only = true;
        doc.meta.read_only_reason = Some("测试只读".to_owned());
        doc.text = "notra".to_owned();

        let err = doc
            .replace_all("notra", "NOTRA", &SearchOptions::default())
            .unwrap_err();

        assert_eq!(err.to_string(), "文档只读：测试只读");
        assert_eq!(doc.text, "notra");
    }
}
