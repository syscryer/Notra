import { invoke } from "@tauri-apps/api/core";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution";
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution";
import "monaco-editor/esm/vs/basic-languages/powershell/powershell.contribution";
import "monaco-editor/esm/vs/basic-languages/python/python.contribution";
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution";
import "monaco-editor/esm/vs/basic-languages/xml/xml.contribution";
import "monaco-editor/esm/vs/basic-languages/java/java.contribution";
import "monaco-editor/esm/vs/basic-languages/rust/rust.contribution";
import "./styles.css";

type EncodingLabel =
  | "ANSI"
  | "UTF-8"
  | "UTF-8-BOM"
  | "UTF-16 Big Endian"
  | "UTF-16 Little Endian";

interface DocumentDto {
  title: string;
  path?: string | null;
  text: string;
  encoding: EncodingLabel;
  lineEnding: string;
  fileSize: number;
  readOnly: boolean;
  readOnlyReason?: string | null;
  language: string;
  largeFile: boolean;
}

interface TreeItemDto {
  path: string;
  name: string;
  depth: number;
  isDir: boolean;
}

interface WorkspaceDto {
  root: string;
  name: string;
  items: TreeItemDto[];
}

interface StartupArgsDto {
  files: string[];
  directories: string[];
}

interface TextMatchDto {
  line: number;
  column: number;
  lineText: string;
  matchedText: string;
}

interface FileHitDto {
  path: string;
  fileName: string;
  encoding: string;
  matches: TextMatchDto[];
}

interface SearchReportDto {
  hits: FileHitDto[];
  skipped: string[];
  total: number;
}

interface ReplacePreviewDto {
  items: FileReplacePreviewDto[];
  skipped: string[];
  total: number;
}

interface FileReplacePreviewDto {
  path: string;
  fileName: string;
  encoding: string;
  count: number;
  matches: TextMatchDto[];
}

interface OpenDocument extends DocumentDto {
  id: number;
  model: monaco.editor.ITextModel;
  dirty: boolean;
  savedText: string;
  encodingStatus: "编码已识别" | "重新解释" | "转换待保存";
}

interface SessionSnapshot {
  openFiles: string[];
  recentFiles: string[];
  workspaceRoot: string | null;
  collapsedDirs: string[];
  activePath: string | null;
  darkMode: boolean;
  showBottom: boolean;
  showMarkdownPreview: boolean;
  searchHistory: string[];
  replaceHistory: string[];
  searchFavorites: string[];
  searchMode: SearchMode;
  matchCase: boolean;
  wholeWord: boolean;
  recursive: boolean;
  includeHidden: boolean;
  fileGlob: string;
  skipDirs: string;
}

declare global {
  interface Window {
    MonacoEnvironment: monaco.Environment;
  }
}

window.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === "json") return new jsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new cssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};

const languages = [
  ["plaintext", "Plain Text", "txt"],
  ["markdown", "Markdown", "md"],
  ["toml", "TOML", "toml"],
  ["json", "JSON", "json"],
  ["yaml", "YAML", "yaml"],
  ["sql", "SQL", "sql"],
  ["powershell", "PowerShell", "ps1"],
  ["javascript", "JavaScript", "js"],
  ["typescript", "TypeScript", "ts"],
  ["python", "Python", "py"],
  ["xml", "XML", "xml"],
  ["html", "HTML", "html"],
  ["css", "CSS", "css"],
  ["java", "Java", "java"],
  ["rust", "Rust", "rs"],
] as const;

const encodings: EncodingLabel[] = [
  "ANSI",
  "UTF-8",
  "UTF-8-BOM",
  "UTF-16 Big Endian",
  "UTF-16 Little Endian",
];

type SearchMode = "literal" | "extended" | "regex";

const SESSION_KEY = "notra.session.v1";
const DEFAULT_SKIP_DIRS = ".git;target;target-codex-run;node_modules;dist;build";

const state = {
  documents: [] as OpenDocument[],
  activeId: 0,
  workspace: null as WorkspaceDto | null,
  collapsedDirs: new Set<string>(),
  recentFiles: [] as string[],
  searchHistory: [] as string[],
  replaceHistory: [] as string[],
  searchFavorites: [] as string[],
  showDirectory: false,
  showBottom: true,
  showMarkdownPreview: false,
  darkMode: false,
  panel: "results" as "results" | "preview" | "logs",
  logs: [] as string[],
  results: null as SearchReportDto | null,
  replacePreview: null as ReplacePreviewDto | null,
  restoring: false,
};

let nextId = 1;
let editor: monaco.editor.IStandaloneCodeEditor;
let sessionTimer = 0;
let unsavedResolver: ((value: UnsavedChoice) => void) | null = null;

type UnsavedChoice = "save" | "discard" | "cancel";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const setButtonLabel = (id: string, value: string) => {
  const label = $<HTMLButtonElement>(id).querySelector("span");
  if (label) label.textContent = value;
};

bootstrap();

function bootstrap() {
  window.addEventListener("unhandledrejection", (event) => {
    log(`操作失败：${event.reason instanceof Error ? event.reason.message : String(event.reason)}`);
  });
  window.addEventListener("error", (event) => {
    log(`界面错误：${event.message}`);
  });
  window.addEventListener("beforeunload", saveSession);

  registerToml();
  registerCompletionProviders();
  defineThemes();

  const initial = createDocument({
    title: "Untitled-1.txt",
    path: null,
    text: "",
    encoding: "UTF-8",
    lineEnding: "LF",
    fileSize: 0,
    readOnly: false,
    readOnlyReason: null,
    language: "plaintext",
    largeFile: false,
  });
  state.documents.push(initial);
  state.activeId = initial.id;

  editor = monaco.editor.create($("editor"), {
    model: initial.model,
    theme: "notra-light",
    automaticLayout: true,
    fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, 'Microsoft YaHei UI', monospace",
    fontSize: 14,
    lineHeight: 23,
    tabSize: 2,
    insertSpaces: true,
    minimap: { enabled: false },
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
    smoothScrolling: true,
    cursorSmoothCaretAnimation: "on",
    cursorBlinking: "smooth",
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true, indentation: true },
    stickyScroll: { enabled: false },
    folding: true,
    wordWrap: "off",
    largeFileOptimizations: true,
    renderWhitespace: "selection",
    occurrencesHighlight: "singleFile",
    suggest: { preview: true, showWords: false },
    quickSuggestions: { other: true, comments: false, strings: false },
  });

  bindActions();
  renderAll();
  void restoreSession().then(openStartupArgs);
  log("Notra Monaco UI ready");
}

function bindActions() {
  $("newButton").addEventListener("click", newDocument);
  $("openButton").addEventListener("click", openDocument);
  $("workspaceButton").addEventListener("click", chooseWorkspace);
  $("saveButton").addEventListener("click", saveActive);
  $("saveAsButton").addEventListener("click", saveAsActive);
  $("saveAllButton").addEventListener("click", saveAll);
  $("undoButton").addEventListener("click", () => editor.trigger("toolbar", "undo", null));
  $("redoButton").addEventListener("click", () => editor.trigger("toolbar", "redo", null));
  $("findRailButton").addEventListener("click", toggleFind);
  $("bottomRailButton").addEventListener("click", toggleBottom);
  $("collapseBottomButton").addEventListener("click", toggleBottom);
  $("findWorkspaceButton").addEventListener("click", searchWorkspace);
  $("findCurrentButton").addEventListener("click", findCurrent);
  $("findNextButton").addEventListener("click", findCurrent);
  $("findOpenButton").addEventListener("click", findOpenDocuments);
  $("previewReplaceButton").addEventListener("click", previewWorkspaceReplace);
  $("replaceCurrentButton").addEventListener("click", replaceCurrentFile);
  $("replaceOpenButton").addEventListener("click", replaceOpenDocuments);
  $("closeFindButton").addEventListener("click", toggleFind);
  $("languageButton").addEventListener("click", () => toggleMenu("languageMenu"));
  $("encodingButton").addEventListener("click", () => toggleMenu("encodingMenu"));
  $("lineEndingButton").addEventListener("click", () => toggleMenu("lineEndingMenu"));
  $("recentButton").addEventListener("click", () => toggleMenu("recentMenu"));
  $("clearRecentButton").addEventListener("click", clearRecentFiles);
  $("favoriteSearchButton").addEventListener("click", favoriteCurrentSearch);
  $("clearFavoritesButton").addEventListener("click", clearSearchFavorites);
  $("clearHistoryButton").addEventListener("click", clearSearchReplaceHistory);
  $("unsavedSaveButton").addEventListener("click", () => resolveUnsavedDialog("save"));
  $("unsavedDiscardButton").addEventListener("click", () => resolveUnsavedDialog("discard"));
  $("unsavedCancelButton").addEventListener("click", () => resolveUnsavedDialog("cancel"));
  $("commandBox").addEventListener("click", openCommandPalette);
  $("directoryToggle").addEventListener("click", () => {
    state.showDirectory = !state.showDirectory && state.workspace !== null;
    renderWorkspace();
    scheduleSessionSave();
  });
  $("closeDirectoryButton").addEventListener("click", () => {
    state.showDirectory = false;
    renderWorkspace();
    scheduleSessionSave();
  });
  $("refreshDirectoryButton").addEventListener("click", () => void refreshWorkspace());
  $("themeButton").addEventListener("click", toggleTheme);
  $("themeRailButton").addEventListener("click", toggleTheme);
  $("markdownPreviewButton").addEventListener("click", () => {
    state.showMarkdownPreview = !state.showMarkdownPreview;
    renderMarkdownPreview();
    scheduleSessionSave();
  });

  ["findInput", "replaceInput", "directoryInput", "fileGlobInput", "skipDirsInput", "searchModeInput"].forEach((id) => {
    $(id).addEventListener("change", scheduleSessionSave);
  });
  ["matchCaseInput", "wholeWordInput", "recursiveInput", "includeHiddenInput"].forEach((id) => {
    $(id).addEventListener("change", scheduleSessionSave);
  });

  document.querySelectorAll<HTMLButtonElement>(".panel-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.panel = button.dataset.panel as typeof state.panel;
      renderBottom();
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenus();
      $("findPopover").classList.add("hidden");
      $("commandPalette").classList.add("hidden");
    }
    if (event.ctrlKey && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (event.shiftKey) {
        void saveAsActive();
      } else {
        void saveActive();
      }
    }
    if (event.ctrlKey && event.key.toLowerCase() === "o") {
      event.preventDefault();
      void openDocument();
    }
    if (event.ctrlKey && event.key.toLowerCase() === "p") {
      event.preventDefault();
      openCommandPalette();
    }
    if (event.ctrlKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      toggleFind();
    }
    if (event.ctrlKey && event.key.toLowerCase() === "h") {
      event.preventDefault();
      toggleFind();
    }
  });

  editor.onDidChangeCursorPosition(renderChrome);
}

function askUnsavedChoice(title: string, subtitle: string, body: string): Promise<UnsavedChoice> {
  $("unsavedTitle").textContent = title;
  $("unsavedSubtitle").textContent = subtitle;
  $("unsavedBody").textContent = body;
  $("unsavedDialog").classList.remove("hidden");
  $("unsavedSaveButton").focus();
  return new Promise((resolve) => {
    unsavedResolver = resolve;
  });
}

function resolveUnsavedDialog(choice: UnsavedChoice) {
  $("unsavedDialog").classList.add("hidden");
  unsavedResolver?.(choice);
  unsavedResolver = null;
}

function createDocument(dto: DocumentDto): OpenDocument {
  const uri = monaco.Uri.parse(`notra://model/${nextId}/${encodeURIComponent(dto.title)}`);
  const model = monaco.editor.createModel(dto.text, dto.language || "plaintext", uri);
  const doc: OpenDocument = {
    ...dto,
    id: nextId++,
    model,
    dirty: false,
    savedText: dto.text,
    encodingStatus: "编码已识别",
  };
  model.onDidChangeContent(() => {
    doc.dirty = model.getValue() !== doc.savedText;
    doc.text = model.getValue();
    doc.fileSize = new Blob([doc.text]).size;
    renderChrome();
    renderMarkdownPreview();
    scheduleSessionSave();
  });
  return doc;
}

function activeDocument() {
  return state.documents.find((doc) => doc.id === state.activeId) ?? state.documents[0];
}

function activateDocument(id: number) {
  const doc = state.documents.find((item) => item.id === id);
  if (!doc) return;
  state.activeId = id;
  editor.setModel(doc.model);
  applyEditorPerformanceProfile(doc);
  renderAll();
  scheduleSessionSave();
}

function newDocument() {
  const doc = createDocument({
    title: `Untitled-${state.documents.length + 1}.txt`,
    path: null,
    text: "",
    encoding: "UTF-8",
    lineEnding: "LF",
    fileSize: 0,
    readOnly: false,
    readOnlyReason: null,
    language: "plaintext",
    largeFile: false,
  });
  state.documents.push(doc);
  activateDocument(doc.id);
  log(`新建 ${doc.title}`);
  scheduleSessionSave();
}

async function openDocument() {
  const dto = await invoke<DocumentDto | null>("open_file_dialog");
  if (!dto) return;
  addOrReplaceDocument(dto);
}

async function openPath(path: string) {
  const dto = await invoke<DocumentDto>("open_path", { path });
  addOrReplaceDocument(dto);
  rememberRecentPath(path);
}

function addOrReplaceDocument(dto: DocumentDto) {
  const existing = state.documents.find((doc) => doc.path && doc.path === dto.path);
  if (existing) {
    existing.model.setValue(dto.text);
    Object.assign(existing, dto, { dirty: false, savedText: dto.text, encodingStatus: "编码已识别" });
    activateDocument(existing.id);
    if (dto.path) rememberRecentPath(dto.path);
    return;
  }
  const doc = createDocument(dto);
  state.documents.push(doc);
  activateDocument(doc.id);
  log(`打开 ${doc.title}`);
  if (doc.path) rememberRecentPath(doc.path);
}

async function saveActive() {
  const doc = activeDocument();
  await saveDocument(doc, false);
}

async function saveAsActive() {
  const doc = activeDocument();
  await saveDocument(doc, true);
}

async function saveDocument(doc: OpenDocument, forceSaveAs: boolean) {
  if (!doc) return;
  if (doc.readOnly) {
    log(`只读文档未保存：${doc.readOnlyReason ?? doc.title}`);
    return;
  }
  const saved = await invoke<DocumentDto>("save_document", {
    request: {
      path: forceSaveAs ? null : doc.path,
      text: doc.model.getValue(),
      encoding: doc.encoding,
      lineEnding: doc.lineEnding || "LF",
    },
  });
  Object.assign(doc, saved, { dirty: false, savedText: saved.text, encodingStatus: "编码已识别" });
  monaco.editor.setModelLanguage(doc.model, saved.language || "plaintext");
  renderAll();
  if (doc.path) rememberRecentPath(doc.path);
  scheduleSessionSave();
  log(`保存 ${doc.title}`);
}

async function saveAll() {
  const activeId = state.activeId;
  for (const doc of state.documents) {
    if (!doc.dirty || doc.readOnly) continue;
    await saveDocument(doc, false);
  }
  activateDocument(activeId);
}

async function chooseWorkspace() {
  const workspace = await invoke<WorkspaceDto | null>("choose_workspace");
  if (!workspace) return;
  state.workspace = workspace;
  state.showDirectory = true;
  state.collapsedDirs.clear();
  ($("directoryInput") as HTMLInputElement).value = workspace.root;
  renderWorkspace();
  scheduleSessionSave();
  log(`工作目录 ${workspace.name}`);
}

async function refreshWorkspace() {
  if (!state.workspace) return;
  const workspace = await invoke<WorkspaceDto>("read_workspace", { path: state.workspace.root });
  state.workspace = workspace;
  state.showDirectory = true;
  renderWorkspace();
  scheduleSessionSave();
  log(`目录已刷新 ${workspace.name}`);
}

async function closeDocument(id: number) {
  if (state.documents.length === 1) return;
  const index = state.documents.findIndex((doc) => doc.id === id);
  if (index < 0) return;
  const doc = state.documents[index];
  if (doc.dirty && !doc.readOnly) {
    const choice = await askUnsavedChoice("关闭文档", `"${doc.title}" 有未保存修改。`, doc.path || doc.title);
    if (choice === "cancel") return;
    if (choice === "save") {
      try {
        await saveDocument(doc, false);
      } catch (error) {
        log(`保存取消或失败：${String(error)}`);
        return;
      }
      if (doc.dirty) return;
    }
  }
  state.documents.splice(index, 1);
  doc.model.dispose();
  activateDocument(state.documents[Math.max(0, index - 1)].id);
  scheduleSessionSave();
}

function setLanguage(language: string) {
  const doc = activeDocument();
  doc.language = language;
  monaco.editor.setModelLanguage(doc.model, language);
  closeMenus();
  renderAll();
  scheduleSessionSave();
  log(`语言切换 ${languageLabel(language)}`);
}

async function useEncoding(encoding: EncodingLabel) {
  const doc = activeDocument();
  if (doc.path) {
    if (doc.dirty && !confirm("当前文档有未保存修改，重新解释编码会重新读取文件。继续吗？")) {
      return;
    }
    const reopened = await invoke<DocumentDto>("reopen_path_with_encoding", {
      request: { path: doc.path, encoding },
    });
    doc.model.setValue(reopened.text);
    Object.assign(doc, reopened, { dirty: false, savedText: reopened.text, encodingStatus: "重新解释" });
    monaco.editor.setModelLanguage(doc.model, reopened.language || "plaintext");
  } else {
    doc.encoding = encoding;
    doc.encodingStatus = "重新解释";
  }
  closeMenus();
  renderAll();
  scheduleSessionSave();
  log(`使用 ${encoding} 编码解释当前文档`);
}

function convertEncoding(encoding: EncodingLabel) {
  const doc = activeDocument();
  doc.encoding = encoding;
  doc.encodingStatus = "转换待保存";
  doc.dirty = true;
  closeMenus();
  renderAll();
  scheduleSessionSave();
  log(`转为 ${encoding}，保存时写入`);
}

function findCurrent() {
  const query = ($("findInput") as HTMLInputElement).value;
  if (!query) return;
  commitSearchHistory();
  const doc = activeDocument();
  const matches = modelMatches(doc);
  state.results = {
    total: matches.length,
    skipped: [],
    hits: [
      {
        path: doc.path || doc.title,
        fileName: doc.title,
        encoding: doc.encoding,
        matches,
      },
    ],
  };
  state.panel = "results";
  state.showBottom = true;
  renderBottom();
  focusMonacoFind(query);
  log(`当前文件查找 ${matches.length} 个命中`);
}

function findOpenDocuments() {
  const query = ($("findInput") as HTMLInputElement).value;
  if (!query) return;
  commitSearchHistory();
  const hits = state.documents
    .map((doc) => ({
      path: doc.path || doc.title,
      fileName: doc.title,
      encoding: doc.encoding,
      matches: modelMatches(doc),
    }))
    .filter((hit) => hit.matches.length > 0);
  state.results = {
    hits,
    skipped: [],
    total: hits.reduce((sum, hit) => sum + hit.matches.length, 0),
  };
  state.panel = "results";
  state.showBottom = true;
  renderBottom();
  log(`打开文档查找 ${state.results.total} 个命中`);
}

function replaceCurrentFile() {
  const query = ($("findInput") as HTMLInputElement).value;
  const replacement = ($("replaceInput") as HTMLInputElement).value;
  if (!query) return;
  if (activeDocument().readOnly) {
    log(`当前文件只读，已跳过替换：${activeDocument().readOnlyReason ?? "只读"}`);
    return;
  }
  const model = activeDocument().model;
  const mode = getSearchMode();
  const matches = model.findMatches(
    editorSearchQuery(query),
    false,
    mode === "regex",
    ($("matchCaseInput") as HTMLInputElement).checked,
    null,
    true,
  ).filter((match) => matchAllowed(activeDocument(), match));
  const edits = matches
    .map((match) => ({
      range: match.range,
      text: replacementForMatch(match.matches?.[0] ?? model.getValueInRange(match.range), query, replacement),
    }))
    .reverse();
  model.pushEditOperations([], edits, () => null);
  log(`当前文件替换 ${edits.length} 处`);
  findCurrent();
}

function replaceOpenDocuments() {
  const query = ($("findInput") as HTMLInputElement).value;
  const replacement = ($("replaceInput") as HTMLInputElement).value;
  if (!query) return;
  commitSearchHistory();
  commitReplaceHistory();

  let total = 0;
  let skipped = 0;
  for (const doc of state.documents) {
    if (doc.readOnly) {
      skipped += 1;
      continue;
    }
    const mode = getSearchMode();
    const matches = doc.model.findMatches(
      editorSearchQuery(query),
      false,
      mode === "regex",
      ($("matchCaseInput") as HTMLInputElement).checked,
      null,
      true,
    ).filter((match) => matchAllowed(doc, match));
    const edits = matches
      .map((match) => ({
        range: match.range,
        text: replacementForMatch(match.matches?.[0] ?? doc.model.getValueInRange(match.range), query, replacement),
      }))
      .reverse();
    if (edits.length > 0) {
      doc.model.pushEditOperations([], edits, () => null);
      doc.dirty = true;
      total += edits.length;
    }
  }
  findOpenDocuments();
  log(`打开文档替换 ${total} 处${skipped ? `，跳过 ${skipped} 个只读文档` : ""}`);
}

async function searchWorkspace() {
  const root = ($("directoryInput") as HTMLInputElement).value || state.workspace?.root;
  const query = ($("findInput") as HTMLInputElement).value;
  if (!root || !query) return;
  commitSearchHistory();

  const report = await invoke<SearchReportDto>("search_workspace", {
    request: {
      root,
      query,
      mode: getSearchMode(),
      matchCase: ($("matchCaseInput") as HTMLInputElement).checked,
      wholeWord: ($("wholeWordInput") as HTMLInputElement).checked,
      includeHidden: ($("includeHiddenInput") as HTMLInputElement).checked,
      recursive: ($("recursiveInput") as HTMLInputElement).checked,
      fileGlob: ($("fileGlobInput") as HTMLInputElement).value || "*.*",
      skipDirs: ($("skipDirsInput") as HTMLInputElement).value || DEFAULT_SKIP_DIRS,
      maxFileSize: 20 * 1024 * 1024,
    },
  });
  state.results = report;
  state.panel = "results";
  state.showBottom = true;
  renderBottom();
  log(`目录查找 ${report.total} 个命中`);
}

async function previewWorkspaceReplace() {
  const root = ($("directoryInput") as HTMLInputElement).value || state.workspace?.root;
  const query = ($("findInput") as HTMLInputElement).value;
  const replacement = ($("replaceInput") as HTMLInputElement).value;
  if (!root || !query) return;

  const preview = await invoke<ReplacePreviewDto>("preview_workspace_replace", {
    request: searchReplaceRequest(root, query, replacement),
  });
  state.replacePreview = preview;
  state.panel = "preview";
  state.showBottom = true;
  renderBottom();
  log(`替换预览 ${preview.total} 处修改`);
}

async function applyWorkspaceReplace() {
  if (!state.replacePreview || state.replacePreview.total === 0) return;
  const root = ($("directoryInput") as HTMLInputElement).value || state.workspace?.root;
  const query = ($("findInput") as HTMLInputElement).value;
  const replacement = ($("replaceInput") as HTMLInputElement).value;
  if (!root || !query) return;
  if (!confirm(`确认写入 ${state.replacePreview.total} 处目录替换吗？`)) return;

  const applied = await invoke<ReplacePreviewDto>("apply_workspace_replace", {
    request: searchReplaceRequest(root, query, replacement),
  });
  state.replacePreview = applied;
  await refreshOpenDocumentsAfterReplace(applied);
  state.panel = "preview";
  renderBottom();
  log(`目录替换已写入 ${applied.total} 处`);
}

async function refreshOpenDocumentsAfterReplace(applied: ReplacePreviewDto) {
  const touched = new Set(applied.items.map((item) => item.path));
  for (const doc of state.documents) {
    if (!doc.path || !touched.has(doc.path)) continue;
    if (doc.dirty && !confirm(`"${doc.title}" 已被目录替换影响，但本地有未保存修改。重新载入吗？`)) {
      continue;
    }
    const reopened = await invoke<DocumentDto>("open_path", { path: doc.path });
    doc.model.setValue(reopened.text);
    Object.assign(doc, reopened, { dirty: false, savedText: reopened.text, encodingStatus: "编码已识别" });
    monaco.editor.setModelLanguage(doc.model, reopened.language || "plaintext");
  }
  renderAll();
}

function searchReplaceRequest(root: string, query: string, replacement: string) {
  commitSearchHistory();
  commitReplaceHistory();
  return {
    root,
    query,
    replacement,
    mode: getSearchMode(),
    matchCase: ($("matchCaseInput") as HTMLInputElement).checked,
    wholeWord: ($("wholeWordInput") as HTMLInputElement).checked,
    includeHidden: ($("includeHiddenInput") as HTMLInputElement).checked,
    recursive: ($("recursiveInput") as HTMLInputElement).checked,
    fileGlob: ($("fileGlobInput") as HTMLInputElement).value || "*.*",
    skipDirs: ($("skipDirsInput") as HTMLInputElement).value || DEFAULT_SKIP_DIRS,
    maxFileSize: 20 * 1024 * 1024,
  };
}

function modelMatches(doc: OpenDocument): TextMatchDto[] {
  const query = ($("findInput") as HTMLInputElement).value;
  const mode = getSearchMode();
  const matches = doc.model.findMatches(
    editorSearchQuery(query),
    false,
    mode === "regex",
    ($("matchCaseInput") as HTMLInputElement).checked,
    null,
    true,
  ).filter((match) => matchAllowed(doc, match));
  return matches.map((match) => {
    const line = doc.model.getLineContent(match.range.startLineNumber);
    return {
      line: match.range.startLineNumber,
      column: match.range.startColumn,
      lineText: line,
      matchedText: doc.model.getValueInRange(match.range),
    };
  });
}

function matchAllowed(doc: OpenDocument, match: monaco.editor.FindMatch) {
  if (!($("wholeWordInput") as HTMLInputElement).checked) return true;
  const model = doc.model;
  const line = model.getLineContent(match.range.startLineNumber);
  const start = match.range.startColumn - 1;
  const end = match.range.endColumn - 1;
  const before = start > 0 ? line[start - 1] : "";
  const after = end < line.length ? line[end] : "";
  return !isWordChar(before) && !isWordChar(after);
}

function isWordChar(value: string) {
  return /^[\p{L}\p{N}_]$/u.test(value);
}

function focusMonacoFind(query: string) {
  const controller = editor.getContribution("editor.contrib.findController") as unknown as {
    getState?: () => { change: (value: Record<string, unknown>, moveCursor: boolean) => void };
    start?: (options: Record<string, unknown>) => void;
  };
  controller?.getState?.().change(
    {
      searchString: editorSearchQuery(query),
      isRegex: getSearchMode() === "regex",
      matchCase: ($("matchCaseInput") as HTMLInputElement).checked,
      wholeWord: ($("wholeWordInput") as HTMLInputElement).checked,
    },
    false,
  );
  editor.trigger("find", "actions.find", null);
}

function replacementForMatch(matched: string, query: string, replacement: string) {
  const mode = getSearchMode();
  if (mode === "extended") return translateExtended(replacement);
  if (mode !== "regex") return replacement;
  const flags = ($("matchCaseInput") as HTMLInputElement).checked ? "g" : "gi";
  try {
    return matched.replace(new RegExp(query, flags), replacement);
  } catch {
    return replacement;
  }
}

function getSearchMode(): SearchMode {
  const value = ($("searchModeInput") as HTMLSelectElement).value;
  if (value === "extended" || value === "regex") return value;
  return "literal";
}

function editorSearchQuery(query: string) {
  return getSearchMode() === "extended" ? translateExtended(query) : query;
}

function translateExtended(input: string) {
  let out = "";
  for (let index = 0; index < input.length; index += 1) {
    const ch = input[index];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = input[index + 1];
    if (next === undefined) {
      out += "\\";
    } else if (next === "n") {
      out += "\n";
      index += 1;
    } else if (next === "r") {
      out += "\r";
      index += 1;
    } else if (next === "t") {
      out += "\t";
      index += 1;
    } else if (next === "0") {
      out += "\0";
      index += 1;
    } else if (next === "\\") {
      out += "\\";
      index += 1;
    } else {
      out += `\\${next}`;
      index += 1;
    }
  }
  return out;
}

function commitSearchHistory() {
  const query = ($("findInput") as HTMLInputElement).value.trim();
  if (!query) return;
  state.searchHistory = [query, ...state.searchHistory.filter((item) => item !== query)].slice(0, 30);
  renderHistoryLists();
  scheduleSessionSave();
}

function commitReplaceHistory() {
  const replacement = ($("replaceInput") as HTMLInputElement).value;
  if (!replacement) return;
  state.replaceHistory = [replacement, ...state.replaceHistory.filter((item) => item !== replacement)].slice(0, 30);
  renderHistoryLists();
  scheduleSessionSave();
}

function favoriteCurrentSearch() {
  const query = ($("findInput") as HTMLInputElement).value.trim();
  if (!query) return;
  state.searchFavorites = [query, ...state.searchFavorites.filter((item) => item !== query)].slice(0, 30);
  renderHistoryLists();
  scheduleSessionSave();
  log(`已收藏搜索：${query}`);
}

function clearSearchFavorites() {
  state.searchFavorites = [];
  renderHistoryLists();
  scheduleSessionSave();
}

function clearSearchReplaceHistory() {
  state.searchHistory = [];
  state.replaceHistory = [];
  renderHistoryLists();
  scheduleSessionSave();
}

function applyEditorPerformanceProfile(doc: OpenDocument) {
  const large = doc.largeFile || doc.fileSize > 2 * 1024 * 1024;
  editor.updateOptions({
    readOnly: doc.readOnly,
    readOnlyMessage: { value: doc.readOnlyReason || "当前文档只读" },
    minimap: { enabled: false },
    wordWrap: large ? "off" : "off",
    folding: !large,
    links: !large,
    occurrencesHighlight: large ? "off" : "singleFile",
    renderLineHighlight: large ? "none" : "line",
    quickSuggestions: large ? false : { other: true, comments: false, strings: false },
    suggestOnTriggerCharacters: !large,
  });
}

function renderAll() {
  renderMenus();
  renderWorkspace();
  renderChrome();
  renderBottom();
  renderMarkdownPreview();
  renderHistoryLists();
  renderRecentFiles();
}

function renderChrome() {
  const doc = activeDocument();
  $("activePath").textContent = doc.path || "未保存";
  $("dirtyCount").textContent = `${state.documents.filter((item) => item.dirty).length} 未保存`;
  $("workspaceState").textContent = state.workspace ? `工作目录：${state.workspace.name}` : "未打开目录";
  setButtonLabel("workspaceButton", state.workspace ? (state.showDirectory ? "目录树" : "显示目录") : "打开目录");
  $("languageButton").textContent = `语言: ${languageLabel(doc.language)}`;
  $("encodingButton").textContent = doc.encoding;
  $("encodingNotice").textContent = `${doc.encodingStatus} ${doc.encoding}`;
  $("lineEndingButton").textContent = doc.lineEnding || "LF";
  $("readonlyState").textContent = doc.readOnly ? "只读" : "可编辑";
  $("readonlyState").classList.toggle("readonly", doc.readOnly);
  $("markdownPreviewButton").classList.toggle("active", state.showMarkdownPreview);

  const tabs = $("tabs");
  tabs.innerHTML = "";
  for (const item of state.documents) {
    const tab = document.createElement("button");
    tab.className = `tab ${item.id === state.activeId ? "active" : ""}`;
    tab.innerHTML = `<span>${escapeHtml(item.title)}${item.dirty ? " •" : ""}</span><b data-close="${item.id}">×</b>`;
    tab.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (target.dataset.close) {
        void closeDocument(Number(target.dataset.close));
      } else {
        activateDocument(item.id);
      }
    });
    tabs.appendChild(tab);
  }

  $("statusLeft").innerHTML = [
    escapeHtml(doc.path || "未保存"),
    languageLabel(doc.language),
    doc.encoding,
    doc.lineEnding,
    doc.readOnly ? "只读" : "可编辑",
    doc.encodingStatus,
  ].map((item) => `<span>${item}</span>`).join(`<span class="dot"></span>`);
  $("statusRight").innerHTML = [
    `第 ${editor.getPosition()?.lineNumber ?? 1} 行，第 ${editor.getPosition()?.column ?? 1} 列`,
    `${doc.model.getLineCount()} 行`,
    `${doc.model.getValueLength()} 字符`,
    `${formatBytes(doc.fileSize)}`,
  ].map((item) => `<span>${item}</span>`).join(`<span class="dot"></span>`);
}

function renderWorkspace() {
  const workspace = $("workspace");
  workspace.classList.toggle("no-directory", !state.showDirectory || !state.workspace);
  $("directoryToggle").classList.toggle("active", state.showDirectory && !!state.workspace);
  if (!state.workspace) {
    $("tree").innerHTML = `<div class="empty">未打开目录</div>`;
    return;
  }
  $("workspaceTitle").textContent = state.workspace.name.toUpperCase();
  $("tree").innerHTML = visibleTreeItems(state.workspace.items)
    .map((item) => {
      const kind = item.isDir ? "dir" : "file";
      const marker = item.isDir ? (state.collapsedDirs.has(item.path) ? "▸" : "▾") : "·";
      return `<button class="tree-item ${kind}" data-path="${escapeAttr(item.path)}" style="padding-left:${8 + item.depth * 16}px"><span>${marker}</span>${escapeHtml(item.name)}</button>`;
    })
    .join("");
  $("tree").querySelectorAll<HTMLButtonElement>(".tree-item.file").forEach((button) => {
    button.addEventListener("click", () => void openPath(button.dataset.path ?? ""));
  });
  $("tree").querySelectorAll<HTMLButtonElement>(".tree-item.dir").forEach((button) => {
    button.addEventListener("click", () => toggleDirectoryCollapse(button.dataset.path ?? ""));
  });
}

function visibleTreeItems(items: TreeItemDto[]) {
  const collapsedByDepth: boolean[] = [];
  return items.filter((item) => {
    collapsedByDepth.length = item.depth;
    const hidden = collapsedByDepth.some(Boolean);
    collapsedByDepth[item.depth] = item.isDir && state.collapsedDirs.has(item.path);
    return !hidden;
  });
}

function toggleDirectoryCollapse(path: string) {
  if (!path) return;
  if (state.collapsedDirs.has(path)) {
    state.collapsedDirs.delete(path);
  } else {
    state.collapsedDirs.add(path);
  }
  renderWorkspace();
  scheduleSessionSave();
}

function renderMenus() {
  const languageList = $("languageList");
  languageList.innerHTML = "";
  for (const [id, label, hint] of languages) {
    const row = document.createElement("button");
    row.className = "menu-row";
    row.innerHTML = `<span></span><strong>${label}</strong><small>${hint}</small>`;
    row.addEventListener("click", () => setLanguage(id));
    languageList.appendChild(row);
  }

  renderEncodingList("useEncodingList", useEncoding);
  renderEncodingList("convertEncodingList", convertEncoding);
  renderLineEndingList();
  renderRecentFiles();
}

function renderRecentFiles() {
  const list = $("recentList");
  if (state.recentFiles.length === 0) {
    list.innerHTML = `<div class="empty">暂无最近文件</div>`;
    return;
  }
  list.innerHTML = "";
  for (const path of state.recentFiles) {
    const row = document.createElement("button");
    row.className = "menu-row";
    row.innerHTML = `<span></span><strong>${escapeHtml(fileNameFromPath(path))}</strong><small>${escapeHtml(path)}</small>`;
    row.addEventListener("click", () => {
      closeMenus();
      void openPath(path);
    });
    list.appendChild(row);
  }
}

function renderHistoryLists() {
  $("findHistoryList").innerHTML = state.searchHistory
    .map((value) => `<option value="${escapeAttr(value)}"></option>`)
    .join("");
  $("replaceHistoryDataList").innerHTML = state.replaceHistory
    .map((value) => `<option value="${escapeAttr(value)}"></option>`)
    .join("");
  renderHistoryButtons("searchHistoryList", state.searchHistory, (value) => {
    ($("findInput") as HTMLInputElement).value = value;
    toggleFindOpen();
  });
  renderHistoryButtons("replaceHistoryList", state.replaceHistory, (value) => {
    ($("replaceInput") as HTMLInputElement).value = value;
    toggleFindOpen();
  });
  renderHistoryButtons("searchFavoritesList", state.searchFavorites, (value) => {
    ($("findInput") as HTMLInputElement).value = value;
    toggleFindOpen();
  });
}

function renderHistoryButtons(id: string, items: string[], handler: (value: string) => void) {
  const list = $(id);
  if (items.length === 0) {
    list.innerHTML = `<div class="empty compact">暂无</div>`;
    return;
  }
  list.innerHTML = "";
  for (const item of items.slice(0, 12)) {
    const button = document.createElement("button");
    button.textContent = item;
    button.title = item;
    button.addEventListener("click", () => handler(item));
    list.appendChild(button);
  }
}

function renderEncodingList(id: string, handler: (encoding: EncodingLabel) => void | Promise<void>) {
  const list = $(id);
  list.innerHTML = "";
  for (const encoding of encodings) {
    const row = document.createElement("button");
    row.className = "menu-row";
    row.innerHTML = `<span>${activeDocument().encoding === encoding ? "●" : ""}</span><strong>${encoding}</strong><small>${id === "useEncodingList" ? "解释" : "改写"}</small>`;
    row.addEventListener("click", () => void handler(encoding));
    list.appendChild(row);
  }
}

function renderLineEndingList() {
  const list = $("lineEndingList");
  list.innerHTML = "";
  for (const lineEnding of ["LF", "CRLF", "CR"]) {
    const row = document.createElement("button");
    row.className = "menu-row";
    row.innerHTML = `<span>${activeDocument().lineEnding === lineEnding ? "●" : ""}</span><strong>${lineEnding}</strong><small>转换</small>`;
    row.addEventListener("click", () => setLineEnding(lineEnding));
    list.appendChild(row);
  }
}

function setLineEnding(lineEnding: string) {
  const doc = activeDocument();
  const text = normalizeLineEndings(doc.model.getValue(), lineEnding);
  doc.model.setValue(text);
  doc.lineEnding = lineEnding;
  doc.dirty = doc.model.getValue() !== doc.savedText;
  closeMenus();
  renderAll();
  scheduleSessionSave();
  log(`行尾已转换为 ${lineEnding}`);
}

function normalizeLineEndings(text: string, lineEnding: string) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (lineEnding === "CRLF") return normalized.replace(/\n/g, "\r\n");
  if (lineEnding === "CR") return normalized.replace(/\n/g, "\r");
  return normalized;
}

function renderBottom() {
  $("app").classList.toggle("bottom-collapsed", !state.showBottom);
  $("bottomPanel").classList.toggle("hidden", !state.showBottom);
  document.querySelectorAll(".panel-tab").forEach((tab) => {
    tab.classList.toggle("active", (tab as HTMLElement).dataset.panel === state.panel);
  });
  const body = $("panelBody");
  if (state.panel === "logs") {
    body.innerHTML = `<table><tbody>${state.logs.map((log) => `<tr><td>INFO</td><td>${escapeHtml(log)}</td></tr>`).join("")}</tbody></table>`;
    return;
  }
  if (state.panel === "preview") {
    if (!state.replacePreview || state.replacePreview.total === 0) {
      body.innerHTML = `<div class="empty">暂无替换预览</div>`;
      return;
    }
    const rows = state.replacePreview.items.flatMap((item) =>
      item.matches.map(
        (match) =>
          `<tr data-path="${escapeAttr(item.path)}" data-line="${match.line}" data-column="${match.column}"><td><span class="tag">待确认</span></td><td>${escapeHtml(item.fileName)}</td><td>${match.line}:${match.column}</td><td>${escapeHtml(match.matchedText)} → ${escapeHtml(($("replaceInput") as HTMLInputElement).value)}</td></tr>`,
      ),
    );
    body.innerHTML = `<div class="panel-actions"><button class="tool-button primary" id="applyReplaceButton">确认写入文件</button><span>${state.replacePreview.total} 处修改，${state.replacePreview.items.length} 个文件</span></div><table><thead><tr><th>动作</th><th>文件</th><th>位置</th><th>替换预览</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
    $("applyReplaceButton").addEventListener("click", () => void applyWorkspaceReplace());
    body.querySelectorAll<HTMLTableRowElement>("tr[data-path]").forEach((row) => {
      row.addEventListener("click", () =>
        void openResult(row.dataset.path ?? "", Number(row.dataset.line ?? "1"), Number(row.dataset.column ?? "1")),
      );
    });
    return;
  }
  if (!state.results || state.results.total === 0) {
    body.innerHTML = `<div class="empty">暂无查找结果</div>`;
    return;
  }
  const rows = state.results.hits.flatMap((hit) =>
    hit.matches.map(
      (match) =>
          `<tr data-path="${escapeAttr(hit.path)}" data-line="${match.line}" data-column="${match.column}"><td><span class="tag">${hit.path === activeDocument().path || hit.path === activeDocument().title ? "当前文件" : "目录"}</span></td><td>${escapeHtml(hit.fileName)}</td><td>${match.line}:${match.column}</td><td>${highlightMatchLine(match)}</td></tr>`,
    ),
  );
  body.innerHTML = `<table><thead><tr><th>范围</th><th>文件</th><th>位置</th><th>预览</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
  body.querySelectorAll<HTMLTableRowElement>("tr[data-path]").forEach((row) => {
    row.addEventListener("click", () =>
      void openResult(row.dataset.path ?? "", Number(row.dataset.line ?? "1"), Number(row.dataset.column ?? "1")),
    );
  });
}

async function openResult(path: string, line: number, column: number) {
  const current = activeDocument();
  if (current.path !== path && current.title !== path) {
    await openPath(path);
  }
  editor.revealPositionInCenter({ lineNumber: line, column });
  editor.setPosition({ lineNumber: line, column });
  editor.focus();
}

function renderMarkdownPreview() {
  const doc = activeDocument();
  const preview = $("markdownPreview");
  const enabled = state.showMarkdownPreview && doc.language === "markdown";
  preview.classList.toggle("hidden", !enabled);
  if (!enabled) return;
  preview.innerHTML = renderMarkdown(doc.model.getValue());
}

function toggleFind() {
  $("findPopover").classList.toggle("hidden");
  if (!$("findPopover").classList.contains("hidden")) {
    ($("findInput") as HTMLInputElement).focus();
  }
}

function toggleFindOpen() {
  $("findPopover").classList.remove("hidden");
  ($("findInput") as HTMLInputElement).focus();
}

function toggleBottom() {
  state.showBottom = !state.showBottom;
  renderBottom();
  scheduleSessionSave();
}

function toggleMenu(id: "languageMenu" | "encodingMenu" | "lineEndingMenu" | "recentMenu") {
  const menu = $(id);
  const open = menu.classList.contains("hidden");
  closeMenus();
  menu.classList.toggle("hidden", !open);
}

function closeMenus() {
  $("languageMenu").classList.add("hidden");
  $("encodingMenu").classList.add("hidden");
  $("lineEndingMenu").classList.add("hidden");
  $("recentMenu").classList.add("hidden");
}

function openCommandPalette() {
  const palette = $("commandPalette");
  palette.classList.remove("hidden");
  const input = $("commandInput") as HTMLInputElement;
  input.value = "";
  renderCommandList("");
  input.focus();
  input.oninput = () => renderCommandList(input.value);
  input.onkeydown = (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const first = $("commandList").querySelector<HTMLButtonElement>(".command-row");
    first?.click();
  };
}

function renderCommandList(query: string) {
  const commands = [
    ["新建文件", newDocument],
    ["打开文件", () => void openDocument()],
    ["打开最近文件", () => toggleMenu("recentMenu")],
    ["打开目录", () => void chooseWorkspace()],
    ["保存", () => void saveActive()],
    ["另存为", () => void saveAsActive()],
    ["保存全部", () => void saveAll()],
    ["查找", toggleFind],
    ["打开文档查找", findOpenDocuments],
    ["目录查找", () => void searchWorkspace()],
    ["替换预览", () => void previewWorkspaceReplace()],
    ["替换打开文档", replaceOpenDocuments],
    ["Markdown 预览", () => {
      state.showMarkdownPreview = !state.showMarkdownPreview;
      renderMarkdownPreview();
    }],
    ["切换主题", toggleTheme],
  ] as const;
  const fileCommands = state.workspace?.items
    .filter((item) => !item.isDir)
    .slice(0, 80)
    .map((item) => [`打开 ${item.name}`, () => void openPath(item.path)] as const) ?? [];
  const languageCommands = languages.map(([id, label]) => [`语言 ${label}`, () => setLanguage(id)] as const);
  const all = [...commands, ...languageCommands, ...fileCommands].filter(([name]) =>
    name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  $("commandList").innerHTML = "";
  for (const [name, action] of all.slice(0, 80)) {
    const button = document.createElement("button");
    button.className = "command-row";
    button.textContent = name;
    button.onclick = () => {
      $("commandPalette").classList.add("hidden");
      action();
    };
    $("commandList").appendChild(button);
  }
}

async function restoreSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return;
  state.restoring = true;
  try {
    const snapshot = JSON.parse(raw) as Partial<SessionSnapshot>;
    state.recentFiles = uniquePaths(snapshot.recentFiles ?? []).slice(0, 40);
    state.collapsedDirs = new Set(snapshot.collapsedDirs ?? []);
    state.searchHistory = (snapshot.searchHistory ?? []).slice(0, 30);
    state.replaceHistory = (snapshot.replaceHistory ?? []).slice(0, 30);
    state.searchFavorites = (snapshot.searchFavorites ?? []).slice(0, 30);
    state.showBottom = snapshot.showBottom ?? state.showBottom;
    state.showMarkdownPreview = snapshot.showMarkdownPreview ?? state.showMarkdownPreview;

    applySearchSnapshot(snapshot);

    if (snapshot.darkMode) {
      state.darkMode = true;
      document.body.classList.add("dark");
      monaco.editor.setTheme("notra-dark");
      $("themeButton").textContent = "浅色";
    }

    if (snapshot.workspaceRoot) {
      try {
        const workspace = await invoke<WorkspaceDto>("read_workspace", { path: snapshot.workspaceRoot });
        state.workspace = workspace;
        state.showDirectory = true;
        ($("directoryInput") as HTMLInputElement).value = workspace.root;
      } catch (error) {
        log(`恢复工作目录失败：${String(error)}`);
      }
    }

    const restoredFiles = uniquePaths(snapshot.openFiles ?? []);
    let restoredCount = 0;
    for (const path of restoredFiles) {
      try {
        const dto = await invoke<DocumentDto>("open_path", { path });
        addOrReplaceDocument(dto);
        restoredCount += 1;
      } catch (error) {
        log(`恢复文件失败：${path}：${String(error)}`);
      }
    }

    const active = snapshot.activePath
      ? state.documents.find((doc) => doc.path === snapshot.activePath)
      : null;
    if (active) state.activeId = active.id;
    const initial = state.documents.find((doc) => !doc.path && doc.title === "Untitled-1.txt" && !doc.dirty);
    if (restoredCount > 0 && initial && state.documents.length > 1) {
      state.documents = state.documents.filter((doc) => doc !== initial);
      initial.model.dispose();
      if (!state.documents.some((doc) => doc.id === state.activeId)) {
        state.activeId = state.documents[0].id;
      }
      editor.setModel(activeDocument().model);
    }

    renderAll();
    log(`会话已恢复：${restoredCount} 个文件`);
  } catch (error) {
    log(`会话恢复失败：${String(error)}`);
  } finally {
    state.restoring = false;
    scheduleSessionSave();
  }
}

async function openStartupArgs() {
  try {
    const args = await invoke<StartupArgsDto>("startup_args");
    if (args.directories[0]) {
      const workspace = await invoke<WorkspaceDto>("read_workspace", { path: args.directories[0] });
      state.workspace = workspace;
      state.showDirectory = true;
      ($("directoryInput") as HTMLInputElement).value = workspace.root;
      log(`启动目录 ${workspace.name}`);
    }
    for (const path of args.files) {
      await openPath(path);
    }
    if (args.files.length > 0 || args.directories.length > 0) {
      renderAll();
      scheduleSessionSave();
    }
  } catch (error) {
    log(`启动参数处理失败：${String(error)}`);
  }
}

function applySearchSnapshot(snapshot: Partial<SessionSnapshot>) {
  ($("findInput") as HTMLInputElement).value = snapshot.searchHistory?.[0] ?? "";
  ($("replaceInput") as HTMLInputElement).value = snapshot.replaceHistory?.[0] ?? "";
  ($("searchModeInput") as HTMLSelectElement).value = snapshot.searchMode ?? "literal";
  ($("matchCaseInput") as HTMLInputElement).checked = snapshot.matchCase ?? false;
  ($("wholeWordInput") as HTMLInputElement).checked = snapshot.wholeWord ?? false;
  ($("recursiveInput") as HTMLInputElement).checked = snapshot.recursive ?? true;
  ($("includeHiddenInput") as HTMLInputElement).checked = snapshot.includeHidden ?? false;
  ($("fileGlobInput") as HTMLInputElement).value = snapshot.fileGlob || "*.*";
  ($("skipDirsInput") as HTMLInputElement).value = snapshot.skipDirs || DEFAULT_SKIP_DIRS;
}

function scheduleSessionSave() {
  if (state.restoring) return;
  window.clearTimeout(sessionTimer);
  sessionTimer = window.setTimeout(saveSession, 250);
}

function saveSession() {
  const snapshot: SessionSnapshot = {
    openFiles: uniquePaths(state.documents.flatMap((doc) => (doc.path ? [doc.path] : []))),
    recentFiles: uniquePaths(state.recentFiles).slice(0, 40),
    workspaceRoot: state.workspace?.root ?? null,
    collapsedDirs: [...state.collapsedDirs],
    activePath: activeDocument()?.path ?? null,
    darkMode: state.darkMode,
    showBottom: state.showBottom,
    showMarkdownPreview: state.showMarkdownPreview,
    searchHistory: state.searchHistory.slice(0, 30),
    replaceHistory: state.replaceHistory.slice(0, 30),
    searchFavorites: state.searchFavorites.slice(0, 30),
    searchMode: getSearchMode(),
    matchCase: ($("matchCaseInput") as HTMLInputElement).checked,
    wholeWord: ($("wholeWordInput") as HTMLInputElement).checked,
    recursive: ($("recursiveInput") as HTMLInputElement).checked,
    includeHidden: ($("includeHiddenInput") as HTMLInputElement).checked,
    fileGlob: ($("fileGlobInput") as HTMLInputElement).value || "*.*",
    skipDirs: ($("skipDirsInput") as HTMLInputElement).value || DEFAULT_SKIP_DIRS,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(snapshot));
}

function rememberRecentPath(path: string) {
  state.recentFiles = [path, ...state.recentFiles.filter((item) => item !== path)].slice(0, 40);
  renderRecentFiles();
  scheduleSessionSave();
}

function clearRecentFiles() {
  state.recentFiles = [];
  renderRecentFiles();
  scheduleSessionSave();
}

function uniquePaths(paths: string[]) {
  return [...new Set(paths.filter(Boolean))];
}

function toggleTheme() {
  state.darkMode = !state.darkMode;
  document.body.classList.toggle("dark", state.darkMode);
  monaco.editor.setTheme(state.darkMode ? "notra-dark" : "notra-light");
  $("themeButton").textContent = state.darkMode ? "浅色" : "深色";
  scheduleSessionSave();
}

function registerToml() {
  monaco.languages.register({ id: "toml" });
  monaco.languages.setMonarchTokensProvider("toml", {
    tokenizer: {
      root: [
        [/#.*$/, "comment"],
        [/\[[^\]]+\]/, "keyword"],
        [/".*?"/, "string"],
        [/\b(true|false)\b/, "keyword"],
        [/\b\d+(\.\d+)?\b/, "number"],
        [/^[\w.-]+(?=\s*=)/, "type.identifier"],
      ],
    },
  });
}

function registerCompletionProviders() {
  const keywords: Record<string, string[]> = {
    markdown: ["# ", "## ", "### ", "- ", "```", "[label](url)", "![alt](path)"],
    toml: ["[server]", "[database]", "name", "port", "enabled", "timeout_ms"],
    sql: ["select", "from", "where", "join", "group by", "order by", "limit"],
    json: ['"name"', '"version"', '"enabled"', '"items"'],
    yaml: ["name:", "version:", "enabled:", "items:"],
    powershell: ["Write-Host", "Get-ChildItem", "Where-Object", "Select-Object"],
    javascript: ["const", "function", "async", "await", "import"],
    typescript: ["interface", "type", "const", "async", "await"],
    python: ["def", "class", "import", "with", "async def"],
    rust: ["fn", "let", "struct", "enum", "impl", "Result"],
  };

  for (const [language, words] of Object.entries(keywords)) {
    monaco.languages.registerCompletionItemProvider(language, {
      provideCompletionItems(model, position) {
        const range = model.getWordUntilPosition(position);
        const editRange = new monaco.Range(
          position.lineNumber,
          range.startColumn,
          position.lineNumber,
          range.endColumn,
        );
        return {
          suggestions: words.map((word) => ({
            label: word,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: word,
            range: editRange,
          })),
        };
      },
    });
  }
}

function defineThemes() {
  monaco.editor.defineTheme("notra-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: "8390a3" },
      { token: "keyword", foreground: "3238d8", fontStyle: "bold" },
      { token: "string", foreground: "0f8a5f" },
      { token: "number", foreground: "b45309" },
      { token: "type.identifier", foreground: "0f766e" },
    ],
    colors: {
      "editor.background": "#fbfcff",
      "editor.foreground": "#111827",
      "editorLineNumber.foreground": "#8b97a8",
      "editorLineNumber.activeForeground": "#3238d8",
      "editorCursor.foreground": "#3238d8",
      "editor.selectionBackground": "#dfe4ff",
      "editor.lineHighlightBackground": "#eef1ff80",
      "editorIndentGuide.background1": "#e4ebf4",
    },
  });
  monaco.editor.defineTheme("notra-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "93a0b4" },
      { token: "keyword", foreground: "858bff", fontStyle: "bold" },
      { token: "string", foreground: "6ee7b7" },
      { token: "number", foreground: "fbbf24" },
      { token: "type.identifier", foreground: "5eead4" },
    ],
    colors: {
      "editor.background": "#151b26",
      "editor.foreground": "#edf2fb",
      "editorLineNumber.foreground": "#667085",
      "editorLineNumber.activeForeground": "#858bff",
      "editorCursor.foreground": "#858bff",
      "editor.selectionBackground": "#313766",
      "editor.lineHighlightBackground": "#252b5480",
    },
  });
}

function renderMarkdown(source: string) {
  const lines = source.split(/\r?\n/);
  let inCode = false;
  const html = lines.map((line) => {
    if (line.trim().startsWith("```")) {
      inCode = !inCode;
      return inCode ? "<pre><code>" : "</code></pre>";
    }
    if (inCode) return `${escapeHtml(line)}\n`;
    if (line.startsWith("# ")) return `<h1>${renderInlineMarkdown(line.slice(2))}</h1>`;
    if (line.startsWith("## ")) return `<h2>${renderInlineMarkdown(line.slice(3))}</h2>`;
    if (line.startsWith("### ")) return `<h3>${renderInlineMarkdown(line.slice(4))}</h3>`;
    if (line.startsWith("- ")) return `<p class="li">${renderInlineMarkdown(line.slice(2))}</p>`;
    if (!line.trim()) return "<br>";
    return `<p>${renderInlineMarkdown(line)}</p>`;
  });
  return html.join("");
}

function renderInlineMarkdown(source: string) {
  return escapeHtml(source)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, url: string) => {
      if (!/^(https?:|mailto:|#|\/|\.)/.test(url)) return label;
      return `<a href="${escapeAttr(url)}">${label}</a>`;
    });
}

function languageLabel(language: string) {
  return languages.find(([id]) => id === language)?.[1] ?? "Plain Text";
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} bytes`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

function highlightMatchLine(match: TextMatchDto) {
  const start = Math.max(0, match.column - 1);
  const before = match.lineText.slice(0, start);
  const matched = match.lineText.slice(start, start + match.matchedText.length);
  const after = match.lineText.slice(start + match.matchedText.length);
  return `${escapeHtml(before)}<span class="match-mark">${escapeHtml(matched || match.matchedText)}</span>${escapeHtml(after)}`;
}

function log(message: string) {
  state.logs.unshift(`${new Date().toLocaleTimeString()}  ${message}`);
  state.logs = state.logs.slice(0, 200);
  renderBottom();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value: string) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
