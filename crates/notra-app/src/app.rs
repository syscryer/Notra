use notra_core::{
    DirectorySearchReport, Document, EncodingKind, FileReplacePreview, LineEnding, ReplaceOutcome,
    SearchMode, SearchOptions, TextMatch, apply_directory_replace,
    document::EDITABLE_FILE_LIMIT_BYTES, preview_directory_replace, search_directory,
};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

use crate::session_store::SessionStore;
use crate::shell_integration::ShellIntegrationStatus;

const SUPPORTED_LANGUAGES: &[&str] = &[
    "plaintext",
    "abap",
    "apex",
    "azcli",
    "bat",
    "bicep",
    "cameligo",
    "clojure",
    "coffee",
    "cpp",
    "csharp",
    "csp",
    "css",
    "cypher",
    "dart",
    "dockerfile",
    "ecl",
    "elixir",
    "flow9",
    "freemarker2",
    "fsharp",
    "go",
    "graphql",
    "handlebars",
    "hcl",
    "html",
    "ini",
    "java",
    "javascript",
    "json",
    "julia",
    "kotlin",
    "less",
    "lexon",
    "liquid",
    "lua",
    "m3",
    "markdown",
    "mdx",
    "mips",
    "msdax",
    "mysql",
    "objective-c",
    "pascal",
    "pascaligo",
    "perl",
    "pgsql",
    "php",
    "pla",
    "postiats",
    "powerquery",
    "powershell",
    "protobuf",
    "pug",
    "python",
    "qsharp",
    "r",
    "razor",
    "redis",
    "redshift",
    "restructuredtext",
    "ruby",
    "rust",
    "sb",
    "scala",
    "scheme",
    "scss",
    "shell",
    "solidity",
    "sophia",
    "sparql",
    "sql",
    "st",
    "swift",
    "systemverilog",
    "tcl",
    "toml",
    "twig",
    "typescript",
    "typespec",
    "vb",
    "wgsl",
    "xml",
    "yaml",
];

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

#[derive(Default)]
struct OpenRequestQueue(Mutex<VecDeque<StartupArgsDto>>);

impl OpenRequestQueue {
    fn push(&self, request: StartupArgsDto) {
        if let Ok(mut queue) = self.0.lock() {
            queue.push_back(request);
        }
    }

    fn drain(&self) -> Vec<StartupArgsDto> {
        self.0
            .lock()
            .map(|mut queue| queue.drain(..).collect())
            .unwrap_or_default()
    }
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
pub struct DialogPathRequest {
    pub default_dir: Option<String>,
    pub file_name: Option<String>,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMutationDto {
    pub workspace: WorkspaceDto,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCreateRequest {
    pub root: String,
    pub parent: String,
    pub name: String,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRenameRequest {
    pub root: String,
    pub path: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePathRequest {
    pub root: String,
    pub path: String,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let request = classify_open_args(args.into_iter().skip(1), Some(Path::new(&cwd)));
            if !request.files.is_empty() || !request.directories.is_empty() {
                if let Some(queue) = app.try_state::<OpenRequestQueue>() {
                    queue.push(request);
                }
                let _ = app.emit("open-request", ());
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let database_path = app
                .path()
                .app_data_dir()
                .map_err(|error| std::io::Error::other(error.to_string()))?
                .join("notra.db");
            let store = SessionStore::new(database_path);
            store.initialize().map_err(std::io::Error::other)?;
            app.manage(store);
            app.manage(OpenRequestQueue::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_session,
            save_session,
            open_file_dialog,
            pick_file_path,
            open_path,
            reopen_path_with_encoding,
            pick_save_path,
            save_document,
            pick_workspace_path,
            choose_workspace,
            read_workspace,
            create_workspace_entry,
            rename_workspace_entry,
            delete_workspace_entry,
            reveal_workspace_entry,
            search_workspace,
            preview_workspace_replace,
            apply_workspace_replace,
            startup_args,
            take_open_requests,
            shell_integration_status,
            set_shell_integration,
            default_app_candidate_status,
            set_default_app_candidate,
            supported_languages,
            supported_encodings,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Notra");
}

#[tauri::command]
fn load_session(store: tauri::State<'_, SessionStore>) -> Result<Option<String>, String> {
    store.load()
}

#[tauri::command]
fn save_session(snapshot: String, store: tauri::State<'_, SessionStore>) -> Result<(), String> {
    store.save(&snapshot)
}

#[tauri::command]
async fn open_file_dialog() -> Result<Option<DocumentDto>, String> {
    let Some(path) = pick_file_path(DialogPathRequest {
        default_dir: None,
        file_name: None,
    })?
    else {
        return Ok(None);
    };
    open_path(path).await.map(Some)
}

#[tauri::command]
fn pick_file_path(request: DialogPathRequest) -> Result<Option<String>, String> {
    Ok(configure_dialog(request)
        .pick_file()
        .map(|path| path.display().to_string()))
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
            None => return Err("保存路径不能为空".to_owned()),
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
fn pick_save_path(request: DialogPathRequest) -> Result<Option<String>, String> {
    Ok(configure_dialog(request)
        .save_file()
        .map(|path| path.display().to_string()))
}

#[tauri::command]
async fn choose_workspace() -> Result<Option<WorkspaceDto>, String> {
    let Some(path) = pick_workspace_path(DialogPathRequest {
        default_dir: None,
        file_name: None,
    })?
    else {
        return Ok(None);
    };
    read_workspace(path).await.map(Some)
}

#[tauri::command]
fn pick_workspace_path(request: DialogPathRequest) -> Result<Option<String>, String> {
    Ok(configure_dialog(request)
        .pick_folder()
        .map(|path| path.display().to_string()))
}

fn configure_dialog(request: DialogPathRequest) -> rfd::FileDialog {
    let mut dialog = rfd::FileDialog::new();
    if let Some(default_dir) = request
        .default_dir
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
    {
        dialog = dialog.set_directory(default_dir);
    }
    if let Some(file_name) = request.file_name.filter(|name| !name.trim().is_empty()) {
        dialog = dialog.set_file_name(file_name);
    }
    dialog
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
async fn create_workspace_entry(
    request: WorkspaceCreateRequest,
) -> Result<WorkspaceMutationDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(request.root);
        let parent = workspace_existing_path(&root, &PathBuf::from(request.parent))?;
        if !parent.is_dir() {
            return Err(format!("目标不是目录：{}", parent.display()));
        }
        let name = sanitize_workspace_entry_name(&request.name)?;
        let path = parent.join(name);
        ensure_new_workspace_path(&root, &path)?;
        if request.is_dir {
            fs::create_dir(&path).map_err(|err| format!("新建文件夹失败：{err}"))?;
        } else {
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .map_err(|err| format!("新建文件失败：{err}"))?;
        }
        Ok(WorkspaceMutationDto {
            workspace: workspace_to_dto(&root),
            path: Some(path.display().to_string()),
        })
    })
    .await
    .map_err(|err| format!("新建任务失败：{err}"))?
}

#[tauri::command]
async fn rename_workspace_entry(
    request: WorkspaceRenameRequest,
) -> Result<WorkspaceMutationDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(request.root);
        let path = workspace_existing_path(&root, &PathBuf::from(request.path))?;
        ensure_not_workspace_root(&root, &path, "不能重命名工作区根目录")?;
        let parent = path
            .parent()
            .ok_or_else(|| format!("无法取得父目录：{}", path.display()))?;
        let name = sanitize_workspace_entry_name(&request.name)?;
        let next_path = parent.join(name);
        ensure_new_workspace_path(&root, &next_path)?;
        fs::rename(&path, &next_path).map_err(|err| format!("重命名失败：{err}"))?;
        Ok(WorkspaceMutationDto {
            workspace: workspace_to_dto(&root),
            path: Some(next_path.display().to_string()),
        })
    })
    .await
    .map_err(|err| format!("重命名任务失败：{err}"))?
}

#[tauri::command]
async fn delete_workspace_entry(
    request: WorkspacePathRequest,
) -> Result<WorkspaceMutationDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(request.root);
        let path = workspace_existing_path(&root, &PathBuf::from(request.path))?;
        ensure_not_workspace_root(&root, &path, "不能删除工作区根目录")?;
        let metadata = fs::metadata(&path).map_err(|err| format!("读取文件信息失败：{err}"))?;
        if metadata.is_dir() {
            fs::remove_dir_all(&path).map_err(|err| format!("删除文件夹失败：{err}"))?;
        } else {
            fs::remove_file(&path).map_err(|err| format!("删除文件失败：{err}"))?;
        }
        Ok(WorkspaceMutationDto {
            workspace: workspace_to_dto(&root),
            path: None,
        })
    })
    .await
    .map_err(|err| format!("删除任务失败：{err}"))?
}

#[tauri::command]
async fn reveal_workspace_entry(request: WorkspacePathRequest) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(request.root);
        let path = workspace_existing_path(&root, &PathBuf::from(request.path))?;
        let metadata = fs::metadata(&path).map_err(|err| format!("读取文件信息失败：{err}"))?;
        let mut command = Command::new("explorer.exe");
        if metadata.is_dir() {
            command.arg(&path);
        } else {
            command.arg(format!("/select,{}", path.display()));
        }
        command
            .spawn()
            .map(|_| ())
            .map_err(|err| format!("打开资源管理器失败：{err}"))
    })
    .await
    .map_err(|err| format!("打开资源管理器任务失败：{err}"))?
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
    SUPPORTED_LANGUAGES.to_vec()
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
    let cwd = std::env::current_dir().ok();
    classify_open_args(std::env::args().skip(1), cwd.as_deref())
}

#[tauri::command]
fn take_open_requests(queue: tauri::State<'_, OpenRequestQueue>) -> Vec<StartupArgsDto> {
    queue.drain()
}

#[tauri::command]
fn shell_integration_status() -> Result<ShellIntegrationStatus, String> {
    crate::shell_integration::status()
}

#[tauri::command]
fn set_shell_integration(enabled: bool) -> Result<ShellIntegrationStatus, String> {
    crate::shell_integration::set_enabled(enabled)
}

#[tauri::command]
fn default_app_candidate_status() -> Result<ShellIntegrationStatus, String> {
    crate::shell_integration::default_app_status()
}

#[tauri::command]
fn set_default_app_candidate(enabled: bool) -> Result<ShellIntegrationStatus, String> {
    crate::shell_integration::set_default_app_enabled(enabled)
}

fn classify_open_args<I>(args: I, cwd: Option<&Path>) -> StartupArgsDto
where
    I: IntoIterator<Item = String>,
{
    let mut files = Vec::new();
    let mut directories = Vec::new();
    for arg in args {
        let path = PathBuf::from(arg);
        let path = if path.is_relative() {
            cwd.map(|cwd| cwd.join(&path)).unwrap_or(path)
        } else {
            path
        };
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
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };

    let mut entries = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let file_type = entry.file_type().ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            let path = entry.path();
            let is_dir = file_type.is_dir();
            if should_skip_tree_entry(&name, is_dir)
                || (file_type.is_file() && !is_text_like(&path))
            {
                return None;
            }
            Some((entry, file_type, name, path))
        })
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| {
        let is_file = entry.1.is_file();
        (is_file, entry.2.to_ascii_lowercase())
    });

    for (_entry, file_type, name, path) in entries {
        let is_dir = file_type.is_dir();
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

fn workspace_existing_path(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let root_canonical = root
        .canonicalize()
        .map_err(|err| format!("读取工作区失败：{}：{err}", root.display()))?;
    let path_canonical = path
        .canonicalize()
        .map_err(|err| format!("读取目标失败：{}：{err}", path.display()))?;
    if !path_canonical.starts_with(&root_canonical) {
        return Err(format!("目标不在工作区内：{}", path.display()));
    }
    Ok(path_canonical)
}

fn ensure_new_workspace_path(root: &Path, path: &Path) -> Result<(), String> {
    let root_canonical = root
        .canonicalize()
        .map_err(|err| format!("读取工作区失败：{}：{err}", root.display()))?;
    let parent = path
        .parent()
        .ok_or_else(|| format!("无法取得父目录：{}", path.display()))?;
    let parent_canonical = parent
        .canonicalize()
        .map_err(|err| format!("读取父目录失败：{}：{err}", parent.display()))?;
    if !parent_canonical.starts_with(&root_canonical) {
        return Err(format!("目标不在工作区内：{}", path.display()));
    }
    if path.exists() {
        return Err(format!("目标已存在：{}", path.display()));
    }
    Ok(())
}

fn ensure_not_workspace_root(root: &Path, path: &Path, message: &str) -> Result<(), String> {
    let root_canonical = root
        .canonicalize()
        .map_err(|err| format!("读取工作区失败：{}：{err}", root.display()))?;
    let path_canonical = path
        .canonicalize()
        .map_err(|err| format!("读取目标失败：{}：{err}", path.display()))?;
    if root_canonical == path_canonical {
        return Err(message.to_owned());
    }
    Ok(())
}

fn sanitize_workspace_entry_name(value: &str) -> Result<String, String> {
    let name = value.trim();
    if name.is_empty() {
        return Err("名称不能为空".to_owned());
    }
    if name == "." || name == ".." {
        return Err("名称不能是 . 或 ..".to_owned());
    }
    if name.ends_with([' ', '.']) {
        return Err("名称不能以空格或点结尾".to_owned());
    }
    if name.chars().any(|ch| {
        matches!(
            ch,
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0'
        )
    }) {
        return Err("名称包含 Windows 不支持的字符".to_owned());
    }
    Ok(name.to_owned())
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

fn should_skip_tree_entry(name: &str, is_dir: bool) -> bool {
    (is_dir && matches!(name, ".git" | ".idea" | ".vscode"))
        || (is_dir
            && matches!(
                name,
                "target" | "target-codex-run" | "node_modules" | "dist" | "build"
            ))
}

fn is_text_like(path: &Path) -> bool {
    if language_from_file_name(path).is_some() {
        return true;
    }

    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| language_from_extension(&ext.to_ascii_lowercase()).is_some())
        .unwrap_or(true)
}

fn language_from_path(path: Option<&Path>) -> String {
    let Some(path) = path else {
        return "plaintext".to_owned();
    };

    if let Some(language) = language_from_file_name(path) {
        return language.to_owned();
    }

    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .and_then(|ext| language_from_extension(&ext))
        .unwrap_or("plaintext")
        .to_owned()
}

fn language_from_file_name(path: &Path) -> Option<&'static str> {
    let name = path.file_name()?.to_string_lossy().to_ascii_lowercase();
    match name.as_str() {
        "dockerfile" | "containerfile" => Some("dockerfile"),
        "makefile" | "gnumakefile" => Some("shell"),
        ".babelrc" | ".bowerrc" | ".eslintrc" | ".jscsrc" | ".jshintrc" | ".prettierrc" => {
            Some("json")
        }
        ".env" | ".env.local" | ".gitignore" | ".dockerignore" | ".npmrc" => Some("plaintext"),
        _ => None,
    }
}

fn language_from_extension(ext: &str) -> Option<&'static str> {
    match ext {
        "txt" | "text" | "log" | "csv" | "tsv" => Some("plaintext"),
        "md" | "markdown" | "rmd" => Some("markdown"),
        "mdx" => Some("mdx"),
        "json" | "jsonc" | "har" => Some("json"),
        "toml" => Some("toml"),
        "yaml" | "yml" => Some("yaml"),
        "sql" => Some("sql"),
        "mysql" => Some("mysql"),
        "pgsql" => Some("pgsql"),
        "ps1" | "psm1" | "psd1" => Some("powershell"),
        "js" | "jsx" | "mjs" | "cjs" => Some("javascript"),
        "ts" | "tsx" | "mts" | "cts" => Some("typescript"),
        "py" | "pyw" | "pyi" => Some("python"),
        "xml" | "xsd" | "xsl" | "svg" => Some("xml"),
        "html" | "htm" | "xhtml" => Some("html"),
        "css" => Some("css"),
        "scss" => Some("scss"),
        "less" => Some("less"),
        "java" => Some("java"),
        "rs" => Some("rust"),
        "go" => Some("go"),
        "c" | "h" | "cc" | "cpp" | "cxx" | "hh" | "hpp" | "hxx" => Some("cpp"),
        "cs" | "csx" => Some("csharp"),
        "php" | "phtml" => Some("php"),
        "rb" | "rake" | "gemspec" => Some("ruby"),
        "sh" | "bash" | "zsh" | "fish" | "ksh" => Some("shell"),
        "bat" | "cmd" => Some("bat"),
        "ini" | "cfg" | "conf" | "editorconfig" | "properties" => Some("ini"),
        "kt" | "kts" => Some("kotlin"),
        "swift" => Some("swift"),
        "scala" | "sc" => Some("scala"),
        "dart" => Some("dart"),
        "lua" => Some("lua"),
        "pl" | "pm" => Some("perl"),
        "r" => Some("r"),
        "ex" | "exs" => Some("elixir"),
        "fs" | "fsi" | "fsx" => Some("fsharp"),
        "clj" | "cljs" | "cljc" | "edn" => Some("clojure"),
        "coffee" => Some("coffee"),
        "graphql" | "gql" => Some("graphql"),
        "tf" | "tfvars" | "hcl" => Some("hcl"),
        "proto" => Some("protobuf"),
        "sol" => Some("solidity"),
        "sv" | "svh" => Some("systemverilog"),
        "vb" | "vbs" => Some("vb"),
        "m" | "mm" => Some("objective-c"),
        "pas" | "pp" => Some("pascal"),
        "pug" | "jade" => Some("pug"),
        "hbs" | "handlebars" => Some("handlebars"),
        "twig" => Some("twig"),
        "liquid" => Some("liquid"),
        "ftl" => Some("freemarker2"),
        "cshtml" | "razor" => Some("razor"),
        "redis" => Some("redis"),
        "rst" => Some("restructuredtext"),
        "rq" | "sparql" => Some("sparql"),
        "tcl" => Some("tcl"),
        "wgsl" => Some("wgsl"),
        "bicep" => Some("bicep"),
        "apex" | "cls" | "trigger" => Some("apex"),
        "abap" => Some("abap"),
        "azcli" => Some("azcli"),
        "cypher" | "cql" => Some("cypher"),
        "qs" => Some("qsharp"),
        "pq" => Some("powerquery"),
        "tsp" => Some("typespec"),
        "ecl" => Some("ecl"),
        "jl" => Some("julia"),
        "asm" | "s" | "mips" => Some("mips"),
        "mligo" | "ligo" => Some("cameligo"),
        _ => None,
    }
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
