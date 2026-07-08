use notra_core::{
    DirectorySearchReport, Document, EncodingKind, FileReplacePreview, LineEnding, ReplaceOutcome,
    SearchMode, SearchOptions, TextMatch, apply_directory_replace,
    document::EDITABLE_FILE_LIMIT_BYTES, preview_directory_replace, search_directory,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const TREE_LIMIT: usize = 600;
const TREE_MAX_DEPTH: usize = 4;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentDto {
    pub title: String,
    pub path: Option<String>,
    pub text: String,
    pub encoding: String,
    pub line_ending: String,
    pub file_size: usize,
    pub read_only: bool,
    pub read_only_reason: Option<String>,
    pub language: String,
    pub large_file: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDto {
    pub root: String,
    pub name: String,
    pub items: Vec<TreeItemDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeItemDto {
    pub path: String,
    pub name: String,
    pub depth: usize,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupArgsDto {
    pub files: Vec<String>,
    pub directories: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchReportDto {
    pub hits: Vec<FileHitDto>,
    pub skipped: Vec<String>,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplacePreviewDto {
    pub items: Vec<FileReplacePreviewDto>,
    pub skipped: Vec<String>,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileReplacePreviewDto {
    pub path: String,
    pub file_name: String,
    pub encoding: String,
    pub count: usize,
    pub matches: Vec<TextMatchDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHitDto {
    pub path: String,
    pub file_name: String,
    pub encoding: String,
    pub matches: Vec<TextMatchDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextMatchDto {
    pub start: usize,
    pub end: usize,
    pub line: usize,
    pub column: usize,
    pub matched_text: String,
    pub line_text: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRequest {
    pub path: Option<String>,
    pub text: String,
    pub encoding: String,
    pub line_ending: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub root: String,
    pub query: String,
    pub mode: String,
    pub match_case: bool,
    pub whole_word: bool,
    pub include_hidden: bool,
    pub recursive: bool,
    pub file_glob: String,
    pub skip_dirs: String,
    pub max_file_size: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReopenRequest {
    pub path: String,
    pub encoding: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceRequest {
    pub root: String,
    pub query: String,
    pub replacement: String,
    pub mode: String,
    pub match_case: bool,
    pub whole_word: bool,
    pub include_hidden: bool,
    pub recursive: bool,
    pub file_glob: String,
    pub skip_dirs: String,
    pub max_file_size: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyReplaceRequest {
    pub root: String,
    pub query: String,
    pub replacement: String,
    pub mode: String,
    pub match_case: bool,
    pub whole_word: bool,
    pub include_hidden: bool,
    pub recursive: bool,
    pub file_glob: String,
    pub skip_dirs: String,
    pub max_file_size: u64,
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            open_file_dialog,
            open_path,
            reopen_path_with_encoding,
            save_document,
            choose_workspace,
            read_workspace,
            search_workspace,
            preview_workspace_replace,
            apply_workspace_replace,
            startup_args,
            supported_languages,
            supported_encodings,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Notra");
}

#[tauri::command]
async fn open_file_dialog() -> Result<Option<DocumentDto>, String> {
    let Some(path) = rfd::FileDialog::new().pick_file() else {
        return Ok(None);
    };
    open_path(path.display().to_string()).await.map(Some)
}

#[tauri::command]
async fn open_path(path: String) -> Result<DocumentDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(path);
        let doc =
            Document::open(&path).map_err(|err| format!("打开失败：{}：{err}", path.display()))?;
        Ok(document_to_dto(doc))
    })
    .await
    .map_err(|err| format!("打开任务失败：{err}"))?
}

#[tauri::command]
async fn reopen_path_with_encoding(request: ReopenRequest) -> Result<DocumentDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(request.path);
        let metadata = fs::metadata(&path)
            .map_err(|err| format!("读取文件信息失败：{}：{err}", path.display()))?;
        let bytes =
            fs::read(&path).map_err(|err| format!("读取文件失败：{}：{err}", path.display()))?;
        let encoding = parse_encoding(&request.encoding);
        let decoded = notra_core::fs::decode_bytes_with_encoding(&bytes, encoding);
        let title = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Untitled")
            .to_owned();
        let line_ending = LineEnding::detect(&decoded.text);
        Ok(DocumentDto {
            title,
            path: Some(path.display().to_string()),
            language: language_from_path(Some(&path)),
            large_file: metadata.len() > EDITABLE_FILE_LIMIT_BYTES,
            text: decoded.text,
            encoding: encoding_label(decoded.encoding).to_owned(),
            line_ending: line_ending_label(line_ending).to_owned(),
            file_size: bytes.len(),
            read_only: metadata.permissions().readonly()
                || metadata.len() > EDITABLE_FILE_LIMIT_BYTES,
            read_only_reason: if metadata.permissions().readonly() {
                Some("文件系统只读".to_owned())
            } else if metadata.len() > EDITABLE_FILE_LIMIT_BYTES {
                Some("超过编辑保护阈值".to_owned())
            } else {
                None
            },
        })
    })
    .await
    .map_err(|err| format!("编码重读失败：{err}"))?
}

#[tauri::command]
async fn save_document(request: SaveRequest) -> Result<DocumentDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = match request.path {
            Some(path) => PathBuf::from(path),
            None => rfd::FileDialog::new()
                .save_file()
                .ok_or_else(|| "已取消保存".to_owned())?,
        };

        let mut doc = if path.exists() {
            Document::open(&path).unwrap_or_else(|_| Document::untitled(1))
        } else {
            Document::untitled(1)
        };
        doc.meta.encoding = parse_encoding(&request.encoding);
        doc.meta.line_ending = parse_line_ending(&request.line_ending);
        doc.set_text(normalize_line_endings(&request.text, doc.meta.line_ending));
        doc.save_as(&path)
            .map_err(|err| format!("保存失败：{}：{err}", path.display()))?;

        Ok(document_to_dto(doc))
    })
    .await
    .map_err(|err| format!("保存任务失败：{err}"))?
}

#[tauri::command]
async fn choose_workspace() -> Result<Option<WorkspaceDto>, String> {
    let Some(path) = rfd::FileDialog::new().pick_folder() else {
        return Ok(None);
    };
    read_workspace(path.display().to_string()).await.map(Some)
}

#[tauri::command]
async fn read_workspace(path: String) -> Result<WorkspaceDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(path);
        if !root.is_dir() {
            return Err(format!("不是有效目录：{}", root.display()));
        }
        Ok(workspace_to_dto(&root))
    })
    .await
    .map_err(|err| format!("读取目录失败：{err}"))?
}

#[tauri::command]
async fn search_workspace(request: SearchRequest) -> Result<SearchReportDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if request.query.is_empty() {
            return Err("查询内容不能为空".to_owned());
        }
        let options = search_options_from_request(&request);
        let report = search_directory(&request.root, &request.query, &options)
            .map_err(|err| err.to_string())?;
        Ok(search_report_to_dto(report))
    })
    .await
    .map_err(|err| format!("目录搜索失败：{err}"))?
}

#[tauri::command]
async fn preview_workspace_replace(request: ReplaceRequest) -> Result<ReplacePreviewDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if request.query.is_empty() {
            return Err("查询内容不能为空".to_owned());
        }
        let options = replace_options_from_request(&request);
        let (items, skipped) = preview_directory_replace(
            &request.root,
            &request.query,
            &request.replacement,
            &options,
        )
        .map_err(|err| err.to_string())?;
        Ok(replace_preview_to_dto(items, skipped))
    })
    .await
    .map_err(|err| format!("替换预览失败：{err}"))?
}

#[tauri::command]
async fn apply_workspace_replace(
    request: ApplyReplaceRequest,
) -> Result<ReplacePreviewDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if request.query.is_empty() {
            return Err("查询内容不能为空".to_owned());
        }
        let options = apply_replace_options_from_request(&request);
        let (items, skipped) = preview_directory_replace(
            &request.root,
            &request.query,
            &request.replacement,
            &options,
        )
        .map_err(|err| err.to_string())?;
        let dto = replace_preview_to_dto(items.clone(), skipped);
        apply_directory_replace(&items).map_err(|err| format!("写入替换失败：{err}"))?;
        Ok(dto)
    })
    .await
    .map_err(|err| format!("执行替换失败：{err}"))?
}

#[tauri::command]
fn supported_languages() -> Vec<&'static str> {
    vec![
        "plaintext",
        "markdown",
        "toml",
        "json",
        "yaml",
        "sql",
        "powershell",
        "javascript",
        "typescript",
        "python",
        "xml",
        "html",
        "css",
        "java",
        "rust",
    ]
}

#[tauri::command]
fn supported_encodings() -> Vec<&'static str> {
    vec![
        "ANSI",
        "UTF-8",
        "UTF-8-BOM",
        "UTF-16 Big Endian",
        "UTF-16 Little Endian",
    ]
}

#[tauri::command]
fn startup_args() -> StartupArgsDto {
    let mut files = Vec::new();
    let mut directories = Vec::new();
    for arg in std::env::args().skip(1) {
        let path = PathBuf::from(arg);
        if path.is_file() {
            files.push(path.display().to_string());
        } else if path.is_dir() {
            directories.push(path.display().to_string());
        }
    }
    StartupArgsDto { files, directories }
}

fn document_to_dto(doc: Document) -> DocumentDto {
    let path = doc.meta.path.as_deref();
    DocumentDto {
        title: doc.title,
        path: path.map(|path| path.display().to_string()),
        language: language_from_path(path),
        large_file: doc.meta.read_only && doc.meta.file_size > EDITABLE_FILE_LIMIT_BYTES as usize,
        text: doc.text,
        encoding: encoding_label(doc.meta.encoding).to_owned(),
        line_ending: line_ending_label(doc.meta.line_ending).to_owned(),
        file_size: doc.meta.file_size,
        read_only: doc.meta.read_only,
        read_only_reason: doc.meta.read_only_reason,
    }
}

fn workspace_to_dto(root: &Path) -> WorkspaceDto {
    let mut items = Vec::new();
    collect_tree_items(root, 0, &mut items);
    WorkspaceDto {
        root: root.display().to_string(),
        name: root
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("工作目录")
            .to_owned(),
        items,
    }
}

fn collect_tree_items(root: &Path, depth: usize, out: &mut Vec<TreeItemDto>) {
    if depth > TREE_MAX_DEPTH || out.len() >= TREE_LIMIT {
        return;
    }

    let Ok(entries) = fs::read_dir(root) else {
        return;
    };

    let mut entries = entries.filter_map(Result::ok).collect::<Vec<_>>();
    entries.sort_by_key(|entry| {
        let is_file = entry.file_type().map(|ty| ty.is_file()).unwrap_or(false);
        (
            is_file,
            entry.file_name().to_string_lossy().to_ascii_lowercase(),
        )
    });

    for entry in entries {
        if out.len() >= TREE_LIMIT {
            break;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if should_skip_tree_entry(&name) {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let is_dir = file_type.is_dir();
        if file_type.is_file() && !is_text_like(&path) {
            continue;
        }
        out.push(TreeItemDto {
            path: path.display().to_string(),
            name,
            depth,
            is_dir,
        });
        if is_dir {
            collect_tree_items(&path, depth + 1, out);
        }
    }
}

fn search_report_to_dto(report: DirectorySearchReport) -> SearchReportDto {
    let total = report.hits.iter().map(|hit| hit.matches.len()).sum();
    SearchReportDto {
        hits: report
            .hits
            .into_iter()
            .map(|hit| FileHitDto {
                file_name: hit
                    .path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("文件")
                    .to_owned(),
                path: hit.path.display().to_string(),
                encoding: encoding_label(hit.encoding).to_owned(),
                matches: hit.matches.into_iter().map(match_to_dto).collect(),
            })
            .collect(),
        skipped: report.skipped,
        total,
    }
}

fn replace_preview_to_dto(
    items: Vec<FileReplacePreview>,
    skipped: Vec<String>,
) -> ReplacePreviewDto {
    let total = items.iter().map(|item| item.outcome.count).sum();
    ReplacePreviewDto {
        items: items
            .into_iter()
            .map(|item| replace_item_to_dto(item.path, item.encoding, item.outcome))
            .collect(),
        skipped,
        total,
    }
}

fn replace_item_to_dto(
    path: PathBuf,
    encoding: EncodingKind,
    outcome: ReplaceOutcome,
) -> FileReplacePreviewDto {
    FileReplacePreviewDto {
        file_name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("文件")
            .to_owned(),
        path: path.display().to_string(),
        encoding: encoding_label(encoding).to_owned(),
        count: outcome.count,
        matches: outcome.matches.into_iter().map(match_to_dto).collect(),
    }
}

fn match_to_dto(value: TextMatch) -> TextMatchDto {
    TextMatchDto {
        start: value.range.start,
        end: value.range.end,
        line: value.line,
        column: value.column,
        matched_text: value.matched_text,
        line_text: value.line_text,
    }
}

fn search_options_from_request(request: &SearchRequest) -> SearchOptions {
    SearchOptions {
        mode: parse_search_mode(&request.mode),
        match_case: request.match_case,
        whole_word: request.whole_word,
        wrap: true,
        include_hidden: request.include_hidden,
        recursive: request.recursive,
        file_glob: request.file_glob.clone(),
        skip_dirs: request.skip_dirs.clone(),
        max_file_size: request.max_file_size,
    }
}

fn replace_options_from_request(request: &ReplaceRequest) -> SearchOptions {
    SearchOptions {
        mode: parse_search_mode(&request.mode),
        match_case: request.match_case,
        whole_word: request.whole_word,
        wrap: true,
        include_hidden: request.include_hidden,
        recursive: request.recursive,
        file_glob: request.file_glob.clone(),
        skip_dirs: request.skip_dirs.clone(),
        max_file_size: request.max_file_size,
    }
}

fn apply_replace_options_from_request(request: &ApplyReplaceRequest) -> SearchOptions {
    SearchOptions {
        mode: parse_search_mode(&request.mode),
        match_case: request.match_case,
        whole_word: request.whole_word,
        wrap: true,
        include_hidden: request.include_hidden,
        recursive: request.recursive,
        file_glob: request.file_glob.clone(),
        skip_dirs: request.skip_dirs.clone(),
        max_file_size: request.max_file_size,
    }
}

fn parse_search_mode(value: &str) -> SearchMode {
    match value {
        "regex" => SearchMode::Regex,
        "extended" => SearchMode::Extended,
        _ => SearchMode::Literal,
    }
}

fn should_skip_tree_entry(name: &str) -> bool {
    name.starts_with('.')
        || matches!(
            name,
            "target" | "target-codex-run" | "node_modules" | "dist" | "build"
        )
}

fn is_text_like(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "txt"
                    | "md"
                    | "markdown"
                    | "rs"
                    | "toml"
                    | "json"
                    | "yaml"
                    | "yml"
                    | "sql"
                    | "xml"
                    | "html"
                    | "css"
                    | "js"
                    | "ts"
                    | "tsx"
                    | "jsx"
                    | "py"
                    | "java"
                    | "kt"
                    | "ps1"
                    | "log"
                    | "csv"
                    | "ini"
                    | "properties"
            )
        })
        .unwrap_or(true)
}

fn language_from_path(path: Option<&Path>) -> String {
    let Some(ext) = path
        .and_then(Path::extension)
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
    else {
        return "plaintext".to_owned();
    };

    match ext.as_str() {
        "md" | "markdown" => "markdown",
        "toml" => "toml",
        "json" => "json",
        "yaml" | "yml" => "yaml",
        "sql" => "sql",
        "ps1" | "psm1" => "powershell",
        "js" | "jsx" => "javascript",
        "ts" | "tsx" => "typescript",
        "py" => "python",
        "xml" => "xml",
        "html" | "xhtml" => "html",
        "css" => "css",
        "java" => "java",
        "rs" => "rust",
        _ => "plaintext",
    }
    .to_owned()
}

fn parse_encoding(label: &str) -> EncodingKind {
    match label {
        "ANSI" | "GBK" => EncodingKind::Gbk,
        "UTF-8-BOM" | "UTF-8 BOM" => EncodingKind::Utf8Bom,
        "UTF-16 Big Endian" | "UTF-16 BE" => EncodingKind::Utf16Be,
        "UTF-16 Little Endian" | "UTF-16 LE" => EncodingKind::Utf16Le,
        _ => EncodingKind::Utf8,
    }
}

fn parse_line_ending(label: &str) -> LineEnding {
    match label {
        "CRLF" => LineEnding::Crlf,
        "CR" => LineEnding::Cr,
        _ => LineEnding::Lf,
    }
}

fn normalize_line_endings(text: &str, line_ending: LineEnding) -> String {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    match line_ending {
        LineEnding::Lf => normalized,
        LineEnding::Crlf => normalized.replace('\n', "\r\n"),
        LineEnding::Cr => normalized.replace('\n', "\r"),
    }
}

fn encoding_label(encoding: EncodingKind) -> &'static str {
    match encoding {
        EncodingKind::Utf8 => "UTF-8",
        EncodingKind::Utf8Bom => "UTF-8-BOM",
        EncodingKind::Utf16Le => "UTF-16 Little Endian",
        EncodingKind::Utf16Be => "UTF-16 Big Endian",
        EncodingKind::Gbk => "ANSI",
    }
}

fn line_ending_label(line_ending: LineEnding) -> &'static str {
    match line_ending {
        LineEnding::Lf => "LF",
        LineEnding::Crlf => "CRLF",
        LineEnding::Cr => "CR",
    }
}
