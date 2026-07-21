import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import {
  ArrowDown,
  ArrowUp,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Binary,
  Bold,
  Braces,
  CaseLower,
  CaseUpper,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleX,
  ClipboardCopy,
  ClipboardPaste,
  Columns2,
  Command,
  Code2,
  Copy,
  Edit3,
  Eraser,
  ExternalLink,
  File,
  FileCode2,
  FilePlus2,
  FileSearch,
  FileText,
  Files,
  FolderOpen,
  FolderPlus,
  FolderTree,
  FolderX,
  Highlighter,
  History,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Image,
  Info,
  Italic,
  Link2,
  List,
  ListChecks,
  ListFilter,
  ListPlus,
  ListOrdered,
  ListRestart,
  ListTree,
  LoaderCircle,
  Map,
  Maximize2,
  Minus,
  Moon,
  MonitorCog,
  MousePointerClick,
  NotebookPen,
  PanelLeftClose,
  PanelRightClose,
  PanelRightOpen,
  Pilcrow,
  Redo2,
  RefreshCw,
  Replace,
  ReplaceAll,
  Quote,
  Save,
  SaveAll,
  SavePlus,
  Search,
  Scissors,
  SeparatorHorizontal,
  Settings,
  ShieldCheck,
  Sigma,
  Sun,
  Table2,
  Type,
  Undo2,
  Trash2,
  WrapText,
  X,
  ZoomIn,
  ZoomOut,
  createElement as createLucideElement,
  type IconNode,
} from "lucide";
import type {
  MarkdownEditorBridge,
  MarkdownSearchMatch,
  MarkdownSearchOptions,
} from "./markdownEditor";
import {
  KEYMAP_PROFILE_LABELS,
  ariaKeyShortcut,
  bindingLabel,
  bindingStartsWith,
  commandBindings,
  isKeymapProfile,
  keyboardEventStroke,
  normalizeBinding,
  resolveKeymapProfile,
  type KeybindingOverrides,
  type KeymapProfile,
} from "./keybindings";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import "monaco-editor/esm/vs/basic-languages/monaco.contribution";
import "monaco-editor/esm/vs/editor/contrib/linesOperations/browser/linesOperations";
import "monaco-editor/esm/vs/language/json/monaco.contribution";
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

interface WorkspaceMutationDto {
  workspace: WorkspaceDto;
  path?: string | null;
}

interface StartupArgsDto {
  files: string[];
  directories: string[];
}

interface ShellIntegrationStatusDto {
  supported: boolean;
  enabled: boolean;
  label: string;
  detail: string;
}

interface TextMatchDto {
  start: number;
  end: number;
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
  filesScanned?: number;
  elapsedMs?: number;
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
  draftId?: string;
  skipSessionRestore?: boolean;
  origin: DocumentOrigin;
  model: monaco.editor.ITextModel;
  dirty: boolean;
  savedText: string;
  viewState?: monaco.editor.ICodeEditorViewState;
  encodingStatus: "编码已识别" | "重新解释" | "转换待保存";
}

interface ClosedDocumentSnapshot extends DocumentDto {
  draftId?: string;
  dirty: boolean;
  savedText: string;
  origin: DocumentOrigin;
  viewState?: monaco.editor.ICodeEditorViewState;
}

type CommandCategory = "文件" | "标签" | "编辑" | "选择" | "查找" | "导航" | "视图" | "书签" | "Markdown";

const KEYBINDING_CATEGORY_ORDER: CommandCategory[] = ["文件", "标签", "编辑", "选择", "查找", "导航", "视图", "书签", "Markdown"];
const KEYBINDING_CATEGORY_ICONS: Record<CommandCategory, string> = {
  "文件": "FileText",
  "标签": "Files",
  "编辑": "Edit3",
  "选择": "MousePointerClick",
  "查找": "Search",
  "导航": "Map",
  "视图": "MonitorCog",
  "书签": "NotebookPen",
  "Markdown": "FileCode2",
};

interface AppCommand {
  id: string;
  title: string;
  category: CommandCategory;
  run: () => void | Promise<void>;
  enabled?: () => boolean;
  when?: () => boolean;
  allowInInput?: boolean;
  priority?: number;
}

interface DraftDocumentSnapshot {
  id: string;
  title: string;
  text: string;
  encoding: EncodingLabel;
  lineEnding: string;
  language: string;
  savedText: string;
  dirty: boolean;
}

interface SessionSnapshot {
  version: number;
  openFiles: string[];
  draftDocuments: DraftDocumentSnapshot[];
  documentOrigins: Record<string, DocumentOrigin>;
  documentViews: Record<string, monaco.editor.ICodeEditorViewState>;
  recentFiles: string[];
  recentWorkspaces: string[];
  workspaceRoot: string | null;
  workMode: WorkMode;
  showDirectory: boolean;
  collapsedDirs: string[];
  activePath: string | null;
  activeDraftId: string | null;
  darkMode: boolean;
  contextMenuEnabled?: boolean;
  defaultAppCandidateEnabled?: boolean;
  rightSidebarOpen: boolean;
  rightTool: RightTool;
  rightSidebarWidth: number;
  explorerWidth?: number;
  markdownPreviewWidth?: number;
  treeScrollTop: number;
  markdownEditMode: MarkdownEditMode;
  markdownContentWidth: MarkdownContentWidth;
  showMarkdownPreview?: boolean;
  markdownPreviewPreferenceSet?: boolean;
  searchHistory: string[];
  replaceHistory: string[];
  searchFavorites: string[];
  findView: FindView;
  searchMode: SearchMode;
  wordWrap: boolean;
  minimap: boolean;
  renderWhitespace: RenderWhitespaceMode;
  fontSize: number;
  shellFontMode: FontMode;
  shellFontPreset: ShellFontPreset;
  shellFontCustom: string;
  shellFontSize: number;
  editorFontMode: FontMode;
  editorFontPreset: EditorFontPreset;
  editorFontCustom: string;
  keymapProfile: KeymapProfile;
  keybindingOverrides: KeybindingOverrides;
  bookmarks: Record<string, number[]>;
  matchCase: boolean;
  wholeWord: boolean;
  reverseSearch: boolean;
  wrapSearch: boolean;
  searchSelection: boolean;
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

type LanguageEntry = readonly [string, string, string];
type MonacoLanguage = ReturnType<typeof monaco.languages.getLanguages>[number];

const pinnedLanguages: LanguageEntry[] = [
  ["plaintext", "Plain Text", "txt"],
  ["markdown", "Markdown", "md"],
  ["mdx", "MDX", "mdx"],
  ["json", "JSON", "json"],
  ["toml", "TOML", "toml"],
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
];

let cachedLanguageOptions: LanguageEntry[] | null = null;

function languageOptions(): LanguageEntry[] {
  if (cachedLanguageOptions) return cachedLanguageOptions;
  const pinnedIds = new Set(pinnedLanguages.map(([id]) => id));
  const discovered = monaco.languages
    .getLanguages()
    .filter((language) => !pinnedIds.has(language.id))
    .map((language) => [language.id, languageLabelFromRegistry(language), languageHintFromRegistry(language)] as const)
    .sort((a, b) => a[1].localeCompare(b[1], "en"));
  cachedLanguageOptions = [...pinnedLanguages, ...discovered];
  return cachedLanguageOptions;
}

function languageLabelFromRegistry(language: MonacoLanguage) {
  return language.aliases?.[0] ?? humanizeLanguageId(language.id);
}

function languageHintFromRegistry(language: MonacoLanguage) {
  const extensions = language.extensions?.map((extension) => extension.replace(/^\./, "")).filter(Boolean) ?? [];
  if (extensions.length > 0) return extensions.slice(0, 4).join(", ");
  return language.id;
}

function humanizeLanguageId(id: string) {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

const encodings: EncodingLabel[] = [
  "ANSI",
  "UTF-8",
  "UTF-8-BOM",
  "UTF-16 Big Endian",
  "UTF-16 Little Endian",
];

type SearchMode = "literal" | "extended" | "regex";
type WorkMode = "single" | "workspace";
type MarkdownEditMode = "wysiwyg" | "split" | "source";
type MarkdownContentWidth = "typora" | "compact" | "wide" | "full";
type DocumentOrigin = "standalone" | "workspace";
type FindView = "find" | "replace" | "workspace-find" | "workspace-replace";
type RightTool = "search" | "outline";
type SearchScope = "current" | "open" | "workspace";
type WorkspaceSearchStatus = "idle" | "searching" | "previewing" | "applying" | "error";
type WorkspaceSearchAction = "search" | "preview" | "apply";
type RenderWhitespaceMode = "none" | "selection" | "all";
type SettingsSection = "appearance" | "editor" | "keybindings" | "workspace" | "system" | "search" | "about";
type AppUpdateStatus = "idle" | "checking" | "latest" | "available" | "installing" | "failed" | "unsupported";
type HorizontalResizeState = {
  pointerId: number;
  frameId: number;
  latestClientX: number;
  anchorX: number;
  maxWidth: number;
};
type FontMode = "preset" | "custom";
type ShellFontPreset = "system" | "segoe" | "yahei" | "dengxian" | "sourceHanSans" | "misans";
type EditorFontPreset = "cascadia" | "jetbrains" | "consolas" | "firaCode" | "sourceCodePro";
type TreeIconShape =
  | "archive"
  | "code"
  | "config"
  | "database"
  | "document"
  | "folder"
  | "image"
  | "key"
  | "log"
  | "markdown"
  | "package"
  | "script"
  | "style";

interface TreeIconDescriptor {
  accent: string;
  label?: string;
  shape: TreeIconShape;
  tone: string;
}

const defaultTreeFolderIcon: TreeIconDescriptor = {
  accent: "#f4b940",
  shape: "folder",
  tone: "#f8d56f",
};

const defaultTreeFileIcon: TreeIconDescriptor = {
  accent: "#94a3b8",
  shape: "document",
  tone: "#f8fafc",
};

const treeFolderIcons: Record<string, TreeIconDescriptor> = {
  ".config": treeFolder("#38bdf8", "#93c5fd"),
  ".github": treeFolder("#475569", "#cbd5e1"),
  ".git": treeFolder("#f05032", "#fca5a5"),
  ".idea": treeFolder("#a855f7", "#e9d5ff"),
  ".ssh": treeFolder("#64748b", "#cbd5e1"),
  ".vscode": treeFolder("#0ea5e9", "#bae6fd"),
  "api": treeFolder("#0f766e", "#99f6e4"),
  "assets": treeFolder("#ec4899", "#fbcfe8"),
  "backend": treeFolder("#0f766e", "#99f6e4"),
  "bin": treeFolder("#475569", "#cbd5e1"),
  "boot": treeFolder("#f59e0b", "#fde68a"),
  "build": treeFolder("#8b5cf6", "#ddd6fe"),
  "client": treeFolder("#2563eb", "#bfdbfe"),
  "config": treeFolder("#38bdf8", "#93c5fd"),
  "coverage": treeFolder("#16a34a", "#bbf7d0"),
  "dev": treeFolder("#64748b", "#cbd5e1"),
  "dist": treeFolder("#8b5cf6", "#ddd6fe"),
  "docs": treeFolder("#3b82f6", "#bfdbfe"),
  "etc": treeFolder("#64748b", "#cbd5e1"),
  "frontend": treeFolder("#2563eb", "#bfdbfe"),
  "home": treeFolder("#22c55e", "#bbf7d0"),
  "images": treeFolder("#ec4899", "#fbcfe8"),
  "lib": treeFolder("#7c3aed", "#ddd6fe"),
  "logs": treeFolder("#475569", "#cbd5e1"),
  "media": treeFolder("#ec4899", "#fbcfe8"),
  "mnt": treeFolder("#14b8a6", "#99f6e4"),
  "node_modules": treeFolder("#539e43", "#c7f0c2"),
  "opt": treeFolder("#f59e0b", "#fde68a"),
  "public": treeFolder("#14b8a6", "#99f6e4"),
  "root": treeFolder("#f97316", "#fed7aa"),
  "scripts": treeFolder("#0284c7", "#bae6fd"),
  "server": treeFolder("#0f766e", "#99f6e4"),
  "src": treeFolder("#2563eb", "#bfdbfe"),
  "target": treeFolder("#b45309", "#fed7aa"),
  "test": treeFolder("#16a34a", "#bbf7d0"),
  "tests": treeFolder("#16a34a", "#bbf7d0"),
  "tmp": treeFolder("#fbbf24", "#fde68a"),
  "var": treeFolder("#a855f7", "#e9d5ff"),
  "vendor": treeFolder("#7c3aed", "#ddd6fe"),
};

const treeFileNameIcons: Record<string, TreeIconDescriptor> = {
  ".env": { accent: "#16a34a", label: "ENV", shape: "config", tone: "#dcfce7" },
  ".dockerignore": { accent: "#2496ed", label: "D", shape: "config", tone: "#dbeafe" },
  ".editorconfig": { accent: "#475569", label: "EC", shape: "config", tone: "#e2e8f0" },
  ".eslintignore": { accent: "#4b32c3", label: "E", shape: "config", tone: "#ede9fe" },
  ".eslintrc": { accent: "#4b32c3", label: "E", shape: "config", tone: "#ede9fe" },
  ".eslintrc.json": { accent: "#4b32c3", label: "E", shape: "config", tone: "#ede9fe" },
  ".gitignore": { accent: "#f05032", label: "G", shape: "config", tone: "#fee2e2" },
  ".gitmodules": { accent: "#f05032", label: "G", shape: "config", tone: "#fee2e2" },
  ".npmrc": { accent: "#cb3837", label: "N", shape: "config", tone: "#fee2e2" },
  ".prettierignore": { accent: "#0f766e", label: "P", shape: "config", tone: "#ccfbf1" },
  ".prettierrc": { accent: "#0f766e", label: "P", shape: "config", tone: "#ccfbf1" },
  "cargo.lock": { accent: "#b45309", label: "RS", shape: "package", tone: "#fed7aa" },
  "cargo.toml": { accent: "#b45309", label: "RS", shape: "package", tone: "#fed7aa" },
  "changelog.md": { accent: "#2563eb", label: "LOG", shape: "markdown", tone: "#dbeafe" },
  "compose.yaml": { accent: "#2496ed", label: "D", shape: "config", tone: "#dbeafe" },
  "compose.yml": { accent: "#2496ed", label: "D", shape: "config", tone: "#dbeafe" },
  "docker-compose.yaml": { accent: "#2496ed", label: "D", shape: "config", tone: "#dbeafe" },
  "docker-compose.yml": { accent: "#2496ed", label: "D", shape: "config", tone: "#dbeafe" },
  "dockerfile": { accent: "#2496ed", label: "D", shape: "code", tone: "#dbeafe" },
  "go.mod": { accent: "#0891b2", label: "GO", shape: "package", tone: "#cffafe" },
  "go.sum": { accent: "#0891b2", label: "GO", shape: "package", tone: "#cffafe" },
  "license": { accent: "#64748b", label: "LIC", shape: "document", tone: "#f1f5f9" },
  "license.md": { accent: "#64748b", label: "LIC", shape: "document", tone: "#f1f5f9" },
  "makefile": { accent: "#475569", label: "MK", shape: "script", tone: "#e2e8f0" },
  "package-lock.json": { accent: "#cb3837", label: "N", shape: "package", tone: "#fee2e2" },
  "package.json": { accent: "#cb3837", label: "N", shape: "package", tone: "#fee2e2" },
  "pnpm-lock.yaml": { accent: "#f59e0b", label: "PN", shape: "package", tone: "#fef3c7" },
  "readme": { accent: "#2563eb", label: "R", shape: "markdown", tone: "#dbeafe" },
  "readme.md": { accent: "#2563eb", label: "R", shape: "markdown", tone: "#dbeafe" },
  "tsconfig.json": { accent: "#3178c6", label: "TS", shape: "config", tone: "#dbeafe" },
  "vite.config.js": { accent: "#7c3aed", label: "V", shape: "config", tone: "#ede9fe" },
  "vite.config.mjs": { accent: "#7c3aed", label: "V", shape: "config", tone: "#ede9fe" },
  "vite.config.ts": { accent: "#7c3aed", label: "V", shape: "config", tone: "#ede9fe" },
  "yarn.lock": { accent: "#2563eb", label: "Y", shape: "package", tone: "#dbeafe" },
};

const treeExtensionIcons: Record<string, TreeIconDescriptor> = {
  "7z": treeArchiveIcon(),
  "aac": { accent: "#db2777", label: "AUD", shape: "document", tone: "#fce7f3" },
  "adoc": { accent: "#2563eb", label: "AD", shape: "document", tone: "#dbeafe" },
  "ai": { accent: "#f97316", label: "AI", shape: "image", tone: "#ffedd5" },
  "asm": { accent: "#64748b", label: "ASM", shape: "code", tone: "#e2e8f0" },
  "astro": { accent: "#f97316", label: "A", shape: "code", tone: "#ffedd5" },
  "avi": { accent: "#7c3aed", label: "VID", shape: "document", tone: "#ede9fe" },
  "bash": { accent: "#0284c7", label: "SH", shape: "script", tone: "#e0f2fe" },
  "bat": { accent: "#475569", label: "BAT", shape: "script", tone: "#e2e8f0" },
  "bin": { accent: "#64748b", label: "BIN", shape: "document", tone: "#e2e8f0" },
  "bmp": treeImageIcon(),
  "bz2": treeArchiveIcon(),
  "c": { accent: "#2563eb", label: "C", shape: "code", tone: "#dbeafe" },
  "cer": { accent: "#0f766e", label: "CRT", shape: "key", tone: "#ccfbf1" },
  "cfg": treeConfigIcon("CFG"),
  "class": { accent: "#dc2626", label: "J", shape: "document", tone: "#fee2e2" },
  "clj": { accent: "#16a34a", label: "CLJ", shape: "code", tone: "#dcfce7" },
  "cljs": { accent: "#16a34a", label: "CLJ", shape: "code", tone: "#dcfce7" },
  "cmd": { accent: "#475569", label: "CMD", shape: "script", tone: "#e2e8f0" },
  "cpp": { accent: "#2563eb", label: "C++", shape: "code", tone: "#dbeafe" },
  "crt": { accent: "#0f766e", label: "CRT", shape: "key", tone: "#ccfbf1" },
  "cs": { accent: "#7c3aed", label: "C#", shape: "code", tone: "#ede9fe" },
  "conf": treeConfigIcon("C"),
  "css": { accent: "#2563eb", label: "CSS", shape: "style", tone: "#dbeafe" },
  "csv": { accent: "#16a34a", label: "CSV", shape: "document", tone: "#dcfce7" },
  "cts": { accent: "#3178c6", label: "TS", shape: "code", tone: "#dbeafe" },
  "cxx": { accent: "#2563eb", label: "C++", shape: "code", tone: "#dbeafe" },
  "dart": { accent: "#0284c7", label: "DT", shape: "code", tone: "#e0f2fe" },
  "db": { accent: "#0f766e", label: "DB", shape: "database", tone: "#ccfbf1" },
  "dll": { accent: "#64748b", label: "DLL", shape: "document", tone: "#e2e8f0" },
  "doc": { accent: "#2563eb", label: "DOC", shape: "document", tone: "#dbeafe" },
  "docx": { accent: "#2563eb", label: "DOC", shape: "document", tone: "#dbeafe" },
  "dylib": { accent: "#64748b", label: "LIB", shape: "document", tone: "#e2e8f0" },
  "eot": { accent: "#7c3aed", label: "FNT", shape: "document", tone: "#ede9fe" },
  "erl": { accent: "#a21caf", label: "ERL", shape: "code", tone: "#fae8ff" },
  "ex": { accent: "#7c3aed", label: "EX", shape: "code", tone: "#ede9fe" },
  "exe": { accent: "#64748b", label: "EXE", shape: "document", tone: "#e2e8f0" },
  "exs": { accent: "#7c3aed", label: "EX", shape: "code", tone: "#ede9fe" },
  "fish": { accent: "#0284c7", label: "SH", shape: "script", tone: "#e0f2fe" },
  "flac": { accent: "#db2777", label: "AUD", shape: "document", tone: "#fce7f3" },
  "fs": { accent: "#0891b2", label: "F#", shape: "code", tone: "#cffafe" },
  "fsx": { accent: "#0891b2", label: "F#", shape: "code", tone: "#cffafe" },
  "gif": treeImageIcon(),
  "go": { accent: "#0891b2", label: "GO", shape: "code", tone: "#cffafe" },
  "gql": { accent: "#db2777", label: "GQL", shape: "code", tone: "#fce7f3" },
  "graphql": { accent: "#db2777", label: "GQL", shape: "code", tone: "#fce7f3" },
  "groovy": { accent: "#2563eb", label: "GRV", shape: "code", tone: "#dbeafe" },
  "gz": treeArchiveIcon(),
  "h": { accent: "#7c3aed", label: "H", shape: "code", tone: "#ede9fe" },
  "hpp": { accent: "#7c3aed", label: "H++", shape: "code", tone: "#ede9fe" },
  "hs": { accent: "#7c3aed", label: "HS", shape: "code", tone: "#ede9fe" },
  "htm": { accent: "#ea580c", label: "H", shape: "code", tone: "#ffedd5" },
  "html": { accent: "#ea580c", label: "H", shape: "code", tone: "#ffedd5" },
  "ico": treeImageIcon(),
  "ini": treeConfigIcon("INI"),
  "java": { accent: "#dc2626", label: "J", shape: "code", tone: "#fee2e2" },
  "jpg": treeImageIcon(),
  "jpeg": treeImageIcon(),
  "js": { accent: "#ca8a04", label: "JS", shape: "code", tone: "#fef9c3" },
  "json5": { accent: "#d97706", label: "{}", shape: "config", tone: "#fff7ed" },
  "jsonc": { accent: "#d97706", label: "{}", shape: "config", tone: "#fff7ed" },
  "json": { accent: "#d97706", label: "{}", shape: "config", tone: "#fff7ed" },
  "jsx": { accent: "#0891b2", label: "JSX", shape: "code", tone: "#cffafe" },
  "kt": { accent: "#7c3aed", label: "KT", shape: "code", tone: "#ede9fe" },
  "kts": { accent: "#7c3aed", label: "KT", shape: "code", tone: "#ede9fe" },
  "key": { accent: "#64748b", label: "KEY", shape: "key", tone: "#e2e8f0" },
  "less": { accent: "#2563eb", label: "LESS", shape: "style", tone: "#dbeafe" },
  "lock": { accent: "#64748b", label: "LCK", shape: "package", tone: "#e2e8f0" },
  "log": { accent: "#475569", label: "LOG", shape: "log", tone: "#f1f5f9" },
  "lua": { accent: "#1d4ed8", label: "LUA", shape: "code", tone: "#dbeafe" },
  "m4a": { accent: "#db2777", label: "AUD", shape: "document", tone: "#fce7f3" },
  "md": { accent: "#2563eb", label: "MD", shape: "markdown", tone: "#dbeafe" },
  "mdx": { accent: "#2563eb", label: "MDX", shape: "markdown", tone: "#dbeafe" },
  "mjs": { accent: "#ca8a04", label: "JS", shape: "code", tone: "#fef9c3" },
  "mkv": { accent: "#7c3aed", label: "VID", shape: "document", tone: "#ede9fe" },
  "mov": { accent: "#7c3aed", label: "VID", shape: "document", tone: "#ede9fe" },
  "mp3": { accent: "#db2777", label: "AUD", shape: "document", tone: "#fce7f3" },
  "mp4": { accent: "#7c3aed", label: "VID", shape: "document", tone: "#ede9fe" },
  "mts": { accent: "#3178c6", label: "TS", shape: "code", tone: "#dbeafe" },
  "ogg": { accent: "#db2777", label: "AUD", shape: "document", tone: "#fce7f3" },
  "otf": { accent: "#7c3aed", label: "FNT", shape: "document", tone: "#ede9fe" },
  "p12": { accent: "#0f766e", label: "KEY", shape: "key", tone: "#ccfbf1" },
  "pem": { accent: "#0f766e", label: "KEY", shape: "key", tone: "#ccfbf1" },
  "pdf": { accent: "#dc2626", label: "PDF", shape: "document", tone: "#fee2e2" },
  "php": { accent: "#7c3aed", label: "PHP", shape: "code", tone: "#ede9fe" },
  "pl": { accent: "#2563eb", label: "PL", shape: "code", tone: "#dbeafe" },
  "png": treeImageIcon(),
  "ppt": { accent: "#ea580c", label: "PPT", shape: "document", tone: "#ffedd5" },
  "pptx": { accent: "#ea580c", label: "PPT", shape: "document", tone: "#ffedd5" },
  "properties": treeConfigIcon("PROP"),
  "proto": { accent: "#0f766e", label: "PB", shape: "code", tone: "#ccfbf1" },
  "ps1": { accent: "#2563eb", label: "PS", shape: "script", tone: "#dbeafe" },
  "psd": treeImageIcon(),
  "psm1": { accent: "#2563eb", label: "PS", shape: "script", tone: "#dbeafe" },
  "py": { accent: "#2563eb", label: "PY", shape: "code", tone: "#dbeafe" },
  "pyi": { accent: "#2563eb", label: "PY", shape: "code", tone: "#dbeafe" },
  "pyw": { accent: "#2563eb", label: "PY", shape: "code", tone: "#dbeafe" },
  "r": { accent: "#2563eb", label: "R", shape: "code", tone: "#dbeafe" },
  "rar": treeArchiveIcon(),
  "rb": { accent: "#dc2626", label: "RB", shape: "code", tone: "#fee2e2" },
  "rst": { accent: "#2563eb", label: "RST", shape: "document", tone: "#dbeafe" },
  "rs": { accent: "#b45309", label: "RS", shape: "code", tone: "#fed7aa" },
  "sass": { accent: "#db2777", label: "SASS", shape: "style", tone: "#fce7f3" },
  "scala": { accent: "#dc2626", label: "SC", shape: "code", tone: "#fee2e2" },
  "scss": { accent: "#db2777", label: "SCSS", shape: "style", tone: "#fce7f3" },
  "sh": { accent: "#0284c7", label: "SH", shape: "script", tone: "#e0f2fe" },
  "so": { accent: "#64748b", label: "LIB", shape: "document", tone: "#e2e8f0" },
  "sol": { accent: "#475569", label: "SOL", shape: "code", tone: "#e2e8f0" },
  "sqlite": { accent: "#0f766e", label: "DB", shape: "database", tone: "#ccfbf1" },
  "sqlite3": { accent: "#0f766e", label: "DB", shape: "database", tone: "#ccfbf1" },
  "sql": { accent: "#0f766e", label: "SQL", shape: "database", tone: "#ccfbf1" },
  "svelte": { accent: "#ea580c", label: "S", shape: "code", tone: "#ffedd5" },
  "svg": treeImageIcon(),
  "swift": { accent: "#f97316", label: "SW", shape: "code", tone: "#ffedd5" },
  "tar": treeArchiveIcon(),
  "tex": { accent: "#0f766e", label: "TEX", shape: "document", tone: "#ccfbf1" },
  "tif": treeImageIcon(),
  "tiff": treeImageIcon(),
  "toml": treeConfigIcon("T"),
  "ts": { accent: "#3178c6", label: "TS", shape: "code", tone: "#dbeafe" },
  "tsx": { accent: "#0891b2", label: "R", shape: "code", tone: "#cffafe" },
  "tsv": { accent: "#16a34a", label: "TSV", shape: "document", tone: "#dcfce7" },
  "ttf": { accent: "#7c3aed", label: "FNT", shape: "document", tone: "#ede9fe" },
  "txt": { accent: "#64748b", label: "TXT", shape: "document", tone: "#f8fafc" },
  "vue": { accent: "#16a34a", label: "VUE", shape: "code", tone: "#dcfce7" },
  "wasm": { accent: "#7c3aed", label: "WASM", shape: "document", tone: "#ede9fe" },
  "wav": { accent: "#db2777", label: "AUD", shape: "document", tone: "#fce7f3" },
  "webm": { accent: "#7c3aed", label: "VID", shape: "document", tone: "#ede9fe" },
  "webp": treeImageIcon(),
  "woff": { accent: "#7c3aed", label: "FNT", shape: "document", tone: "#ede9fe" },
  "woff2": { accent: "#7c3aed", label: "FNT", shape: "document", tone: "#ede9fe" },
  "xls": { accent: "#16a34a", label: "XLS", shape: "document", tone: "#dcfce7" },
  "xlsx": { accent: "#16a34a", label: "XLS", shape: "document", tone: "#dcfce7" },
  "xml": { accent: "#ea580c", label: "XML", shape: "config", tone: "#ffedd5" },
  "xz": treeArchiveIcon(),
  "yaml": treeConfigIcon("Y"),
  "yml": treeConfigIcon("Y"),
  "zsh": { accent: "#0284c7", label: "SH", shape: "script", tone: "#e0f2fe" },
  "zip": treeArchiveIcon(),
};

const SESSION_KEY = "notra.session.v1";
const DEFAULT_SKIP_DIRS = ".git;target;target-codex-run;node_modules;dist;build";
const DRAFT_ID_PREFIX = "draft";
const DEFAULT_SHELL_FONT_PRESET: ShellFontPreset = "system";
const DEFAULT_EDITOR_FONT_PRESET: EditorFontPreset = "cascadia";
const DEFAULT_SHELL_FONT_SIZE = 14;
const DEFAULT_EDITOR_FONT_SIZE = 14;
const DEFAULT_EXPLORER_WIDTH = 272;
const MIN_EXPLORER_WIDTH = 180;
const MAX_EXPLORER_WIDTH = 640;
const MIN_WORKSPACE_EDITOR_WIDTH = 320;
const EXPLORER_RESIZE_WIDTH = 6;

const SHELL_FONT_STACKS: Record<ShellFontPreset, string> = {
  system: '"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", Arial, sans-serif',
  segoe: '"Segoe UI Variable Text", "Segoe UI Variable Display", "Segoe UI", Arial, sans-serif',
  yahei: '"Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", sans-serif',
  dengxian: '"DengXian", "Microsoft YaHei UI", "Segoe UI", sans-serif',
  sourceHanSans: '"Source Han Sans SC", "Noto Sans CJK SC", "Microsoft YaHei UI", sans-serif',
  misans: '"MiSans", "Microsoft YaHei UI", "Segoe UI", sans-serif',
};

const EDITOR_FONT_STACKS: Record<EditorFontPreset, string> = {
  cascadia: '"Cascadia Code", "Cascadia Mono", Consolas, "Microsoft YaHei UI", monospace',
  jetbrains: '"JetBrains Mono", "Cascadia Code", Consolas, "Microsoft YaHei UI", monospace',
  consolas: 'Consolas, "Cascadia Code", "Microsoft YaHei UI", monospace',
  firaCode: '"Fira Code", "Cascadia Code", Consolas, "Microsoft YaHei UI", monospace',
  sourceCodePro: '"Source Code Pro", "Cascadia Code", Consolas, "Microsoft YaHei UI", monospace',
};

const FONT_MODE_LABELS: Record<FontMode, string> = {
  preset: "预设字体",
  custom: "手动输入",
};

const SHELL_FONT_LABELS: Record<ShellFontPreset, string> = {
  system: "系统默认",
  segoe: "Segoe UI Variable",
  yahei: "微软雅黑",
  dengxian: "等线",
  sourceHanSans: "思源黑体",
  misans: "MiSans",
};

const EDITOR_FONT_LABELS: Record<EditorFontPreset, string> = {
  cascadia: "Cascadia",
  jetbrains: "JetBrains",
  consolas: "Consolas",
  firaCode: "Fira Code",
  sourceCodePro: "Source Code Pro",
};

const state = {
  documents: [] as OpenDocument[],
  activeId: 0,
  workspace: null as WorkspaceDto | null,
  mode: "single" as WorkMode,
  collapsedDirs: new Set<string>(),
  recentFiles: [] as string[],
  recentWorkspaces: [] as string[],
  searchHistory: [] as string[],
  replaceHistory: [] as string[],
  searchFavorites: [] as string[],
  showDirectory: false,
  markdownEditMode: "wysiwyg" as MarkdownEditMode,
  markdownContentWidth: "typora" as MarkdownContentWidth,
  darkMode: false,
  panel: "results" as "results" | "preview" | "logs",
  logs: [] as string[],
  results: null as SearchReportDto | null,
  replacePreview: null as ReplacePreviewDto | null,
  replacePreviewApplied: false,
  activeResultIndex: -1,
  searchScope: null as SearchScope | null,
  searchQuery: "",
  searchSignature: "",
  searchRevision: 0,
  workspaceSearchStatus: "idle" as WorkspaceSearchStatus,
  workspaceSearchAction: "search" as WorkspaceSearchAction,
  workspaceSearchError: "",
  workspaceSearchRequestId: 0,
  workspaceSearchVisibleResults: 400,
  workspaceReplaceVisibleResults: 400,
  findView: "find" as FindView,
  wordWrap: false,
  minimap: false,
  renderWhitespace: "selection" as RenderWhitespaceMode,
  fontSize: DEFAULT_EDITOR_FONT_SIZE,
  shellFontMode: "preset" as FontMode,
  shellFontPreset: DEFAULT_SHELL_FONT_PRESET as ShellFontPreset,
  shellFontCustom: SHELL_FONT_STACKS[DEFAULT_SHELL_FONT_PRESET],
  shellFontSize: DEFAULT_SHELL_FONT_SIZE,
  editorFontMode: "preset" as FontMode,
  editorFontPreset: DEFAULT_EDITOR_FONT_PRESET as EditorFontPreset,
  editorFontCustom: EDITOR_FONT_STACKS[DEFAULT_EDITOR_FONT_PRESET],
  keymapProfile: "vscode" as KeymapProfile,
  keybindingOverrides: {} as KeybindingOverrides,
  bookmarks: {} as Record<string, number[]>,
  settingsSection: "appearance" as SettingsSection,
  shellIntegration: {
    supported: false,
    enabled: false,
    label: "以 Notra 打开",
    detail: "正在检测 Windows 右键菜单状态",
  } as ShellIntegrationStatusDto,
  contextMenuEnabled: true,
  shellIntegrationLoaded: false,
  shellIntegrationBusy: false,
  defaultAppCandidate: {
    supported: false,
    enabled: false,
    label: "Windows 默认应用候选",
    detail: "正在检测 Windows 默认应用候选状态",
  } as ShellIntegrationStatusDto,
  defaultAppCandidateEnabled: true,
  defaultAppCandidateLoaded: false,
  defaultAppCandidateBusy: false,
  rightTool: "search" as RightTool,
  rightSidebarWidth: 420,
  explorerWidth: DEFAULT_EXPLORER_WIDTH,
  markdownPreviewWidth: 0,
  busyMessage: "",
  keybindingHint: "",
  restoring: false,
};

let nextId = 1;
let editor: monaco.editor.IStandaloneCodeEditor;
let sessionTimer = 0;
let sessionWriteQueue: Promise<void> = Promise.resolve();
let unsavedResolver: ((value: UnsavedChoice) => void) | null = null;
let confirmResolver: ((value: boolean) => void) | null = null;
let textInputResolver: ((value: string | null) => void) | null = null;
let searchDecorations: monaco.editor.IEditorDecorationsCollection | null = null;
let activeSearchDecoration: monaco.editor.IEditorDecorationsCollection | null = null;
let windowCloseConfirmed = false;
let commandActions: Array<() => void> = [];
let commandActiveIndex = 0;
let commandPaletteMode: "commands" | "files" = "commands";
const appCommands = new globalThis.Map<string, AppCommand>();
const closedDocuments: ClosedDocumentSnapshot[] = [];
let pendingKeybindingChord = "";
let pendingKeybindingChordTimer = 0;
let recordingKeybindingCommandId = "";
let recordingKeybindingStrokes: string[] = [];
let recordingKeybindingTimer = 0;
const collapsedKeybindingCategories = new Set<CommandCategory>(KEYBINDING_CATEGORY_ORDER.slice(1));
let bookmarkDecorations: monaco.editor.IEditorDecorationsCollection | null = null;
let tabMenuDocumentId = 0;
let treeMenuTarget: TreeContextTarget | null = null;
let busyDepth = 0;
let editorBusyDepth = 0;
let openRequestTask: Promise<void> = Promise.resolve();
let fileDropTask: Promise<void> = Promise.resolve();
let openRequestsReady = false;
let titlebarMaximizeToggleAt = 0;
let rightSidebarResizeState: HorizontalResizeState | null = null;
let explorerResizeState: HorizontalResizeState | null = null;
let markdownPreviewResizeState: HorizontalResizeState | null = null;
let editorLayoutFrame = 0;
let editorLayoutSettleFrame = 0;
let editorLayoutForceRender = false;
let editorLayoutWidth = -1;
let editorLayoutHeight = -1;
let editorLayoutFrozen = false;
let markdownPreviewTimer = 0;
let markdownPreviewRenderVersion = 0;
let markdownModelSyncTimer = 0;
let currentFindTimer = 0;
let currentFindHistoryActiveIndex = -1;
let searchHistoryField: "find" | "replace" | null = null;
let searchHistoryActiveIndex = -1;
let searchResultRenderVersion = 0;
let markdownEditor: MarkdownEditorBridge | null = null;
let markdownModulePromise: Promise<typeof import("./markdownEditor")> | null = null;
let markdownEditorDocumentId = 0;
let markdownSyncingFromEditor = false;
let markdownImageObserver: MutationObserver | null = null;
let markdownImageRefreshFrame = 0;
let appVersion = "—";
let appUpdateStatus: AppUpdateStatus = "idle";
let appUpdateDetail = "尚未检查更新";
let pendingAppUpdate: Update | null = null;

type MarkdownEditorCacheEntry = {
  documentId: number;
  bridge: MarkdownEditorBridge;
  pane: HTMLElement;
  lastUsed: number;
};

// A Muya instance owns the complete document DOM plus decoded images, rendered
// diagrams, history and plugin state. Keeping several hidden instances made a
// handful of image-heavy Markdown tabs consume more than 1 GB in WebView2.
// Retain only the active rich editor; Monaco models remain cached per tab.
const MAX_MARKDOWN_EDITOR_CACHE = 1;
const markdownEditorCache = new globalThis.Map<number, MarkdownEditorCacheEntry>();
const markdownEditorPromises = new globalThis.Map<number, Promise<MarkdownEditorCacheEntry | null>>();

type UnsavedChoice = "save" | "discard" | "cancel";
type TreeContextTarget = {
  path: string;
  name: string;
  isDir: boolean;
  isRoot: boolean;
};
type ConfirmOptions = {
  title: string;
  subtitle: string;
  body: string;
  okLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};
type TextInputOptions = {
  title: string;
  subtitle: string;
  label: string;
  value?: string;
  inputMode?: "text" | "numeric";
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const appWindow = getCurrentWindow();
const lucideIcons: Record<string, IconNode> = {
  ArrowDown,
  ArrowUp,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Binary,
  Bold,
  Braces,
  CaseLower,
  CaseUpper,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleX,
  ClipboardCopy,
  ClipboardPaste,
  Columns2,
  Command,
  Code2,
  Copy,
  Edit3,
  Eraser,
  ExternalLink,
  File,
  FileCode2,
  FilePlus2,
  FileSearch,
  FileText,
  Files,
  FolderOpen,
  FolderPlus,
  FolderTree,
  FolderX,
  Highlighter,
  History,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Image,
  Info,
  Italic,
  Link2,
  List,
  ListChecks,
  ListFilter,
  ListPlus,
  ListOrdered,
  ListRestart,
  ListTree,
  LoaderCircle,
  Map,
  Maximize2,
  Minus,
  Moon,
  MonitorCog,
  MousePointerClick,
  NotebookPen,
  PanelLeftClose,
  PanelRightClose,
  PanelRightOpen,
  Pilcrow,
  Redo2,
  RefreshCw,
  Replace,
  ReplaceAll,
  Quote,
  Save,
  SaveAll,
  SavePlus,
  Search,
  Scissors,
  SeparatorHorizontal,
  Settings,
  ShieldCheck,
  Sigma,
  Sun,
  Table2,
  Type,
  Undo2,
  Trash2,
  WrapText,
  X,
  ZoomIn,
  ZoomOut,
};
const setButtonLabel = (id: string, value: string, accessible = value) => {
  const button = $<HTMLButtonElement>(id);
  const label = button.querySelector<HTMLElement>("[data-label]");
  if (label) label.textContent = value;
  button.title = accessible;
  button.setAttribute("aria-label", accessible);
};

function iconSvg(name: string) {
  const iconNode = lucideIcons[name];
  if (!iconNode) return "";
  const svg = createLucideElement(iconNode, {
    class: "lucide-icon",
    "aria-hidden": "true",
    focusable: "false",
    width: "18",
    height: "18",
    "stroke-width": "1.9",
  });
  return svg.outerHTML;
}

function treeFolder(accent: string, tone: string): TreeIconDescriptor {
  return { accent, shape: "folder", tone };
}

function treeArchiveIcon(): TreeIconDescriptor {
  return { accent: "#d97706", label: "ZIP", shape: "archive", tone: "#fef3c7" };
}

function treeConfigIcon(label: string): TreeIconDescriptor {
  return { accent: "#d97706", label, shape: "config", tone: "#fff7ed" };
}

function treeImageIcon(): TreeIconDescriptor {
  return { accent: "#16a34a", label: "IMG", shape: "image", tone: "#dcfce7" };
}

function treeIconDescriptor(item: TreeItemDto): TreeIconDescriptor {
  if (item.isDir) return treeFolderIcons[item.name.toLowerCase()] ?? defaultTreeFolderIcon;
  const normalizedName = item.name.toLowerCase();
  if (normalizedName.startsWith(".env.")) return treeFileNameIcons[".env"];
  if (normalizedName.startsWith("readme.")) return treeFileNameIcons["readme.md"];
  if (normalizedName.startsWith("license.")) return treeFileNameIcons["license"];
  if (normalizedName.startsWith("dockerfile.")) return treeFileNameIcons["dockerfile"];
  return treeFileNameIcons[normalizedName] ?? treeExtensionIcons[fileExtension(normalizedName)] ?? defaultTreeFileIcon;
}

function fileExtension(name: string) {
  const index = name.lastIndexOf(".");
  if (index <= 0 || index === name.length - 1) return "";
  return name.slice(index + 1);
}

function treeEntryIcon(item: TreeItemDto, expanded: boolean, extraClassName = "") {
  const icon = treeIconDescriptor(item);
  const style = `--tree-icon-accent:${icon.accent};--tree-icon-tone:${icon.tone};`;
  const extraClass = extraClassName ? ` ${extraClassName}` : "";
  if (icon.shape === "folder") {
    return `<span class="tree-file-icon-svg folder${expanded ? " is-open" : ""}${extraClass}" style="${style}" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <path d="M2.75 7.8c0-1.1.9-2 2-2h5.15l1.72 1.9h7.63c1.1 0 2 .9 2 2v7.9c0 1.1-.9 2-2 2H4.75c-1.1 0-2-.9-2-2V7.8Z" fill="var(--tree-icon-tone)" />
        <path d="M2.75 9.7c0-1.1.9-2 2-2h14.5c1.1 0 2 .9 2 2v1.05H2.75V9.7Z" fill="var(--tree-icon-accent)" opacity="0.86" />
        <path d="M2.75 10.45h18.5l-1.45 7.45a2 2 0 0 1-1.96 1.62H4.28a2 2 0 0 1-1.97-2.35l.44-6.72Z" fill="var(--tree-icon-tone)" />
        <path d="M2.75 10.45h18.5l-1.45 7.45a2 2 0 0 1-1.96 1.62H4.28a2 2 0 0 1-1.97-2.35l.44-6.72Z" fill="var(--tree-icon-accent)" opacity="${expanded ? "0.42" : "0.22"}" />
      </svg>
    </span>`;
  }
  return `<span class="tree-file-icon-svg file ${icon.shape}${extraClass}" style="${style}" aria-hidden="true">
    <svg viewBox="0 0 24 24" focusable="false">
      <path d="M6 2.75h8.4L19 7.35V19.25a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4.75a2 2 0 0 1 2-2Z" fill="var(--tree-icon-tone)" stroke="var(--tree-icon-accent)" stroke-width="1.15" />
      <path d="M14.2 2.95v4.7h4.55" fill="none" stroke="var(--tree-icon-accent)" stroke-width="1.15" />
      ${treeFileIconMark(icon)}
    </svg>
    ${icon.label ? `<span class="tree-file-icon-label">${escapeHtml(icon.label)}</span>` : ""}
  </span>`;
}

function treeChevron(expanded: boolean) {
  const d = expanded ? "m6 9 6 6 6-6" : "m9 6 6 6-6 6";
  return `<span class="tree-chevron" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="${d}" /></svg></span>`;
}

function treeFileIconMark(icon: TreeIconDescriptor) {
  if (icon.shape === "archive") {
    return `<path d="M9 6.5h2.4v2.1H9V6.5Zm2.4 2.1h2.4v2.1h-2.4V8.6ZM9 10.7h2.4v2.1H9v-2.1Zm2.4 2.1h2.4v2.1h-2.4v-2.1Z" fill="var(--tree-icon-accent)" /><path d="M9.4 16.3h4.2" stroke="var(--tree-icon-accent)" stroke-width="1.3" stroke-linecap="round" />`;
  }
  if (icon.shape === "key") {
    return `<circle cx="9" cy="13.5" r="2.1" fill="none" stroke="var(--tree-icon-accent)" stroke-width="1.4" /><path d="M11.1 13.5h5.1m-1.5 0v2m-2-2v1.35" stroke="var(--tree-icon-accent)" stroke-width="1.4" stroke-linecap="round" />`;
  }
  if (icon.shape === "image") {
    return `<circle cx="14.8" cy="9.1" r="1.25" fill="var(--tree-icon-accent)" /><path d="m7.3 16.5 3.1-3.55 2.15 2.2 1.45-1.55 2.8 2.9H7.3Z" fill="var(--tree-icon-accent)" />`;
  }
  if (icon.shape === "script" || icon.shape === "code") {
    return `<path d="m9.8 10.2-2.3 2.45 2.3 2.45m4.4-4.9 2.3 2.45-2.3 2.45" fill="none" stroke="var(--tree-icon-accent)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />`;
  }
  if (icon.shape === "database") {
    return `<ellipse cx="12" cy="9" rx="4.4" ry="1.8" fill="none" stroke="var(--tree-icon-accent)" stroke-width="1.25" /><path d="M7.6 9v5.5c0 1 2 1.8 4.4 1.8s4.4-.8 4.4-1.8V9" fill="none" stroke="var(--tree-icon-accent)" stroke-width="1.25" /><path d="M7.6 11.75c0 1 2 1.8 4.4 1.8s4.4-.8 4.4-1.8" fill="none" stroke="var(--tree-icon-accent)" stroke-width="1.25" />`;
  }
  return "";
}

function documentTabIcon(doc: OpenDocument) {
  const name = fileNameFromPath(doc.path || doc.title);
  return treeEntryIcon({ path: doc.path || doc.title, name, depth: 0, isDir: false }, false, "tab-file-icon");
}

function renderIconSlots(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>("[data-icon]").forEach((slot) => {
    const name = slot.dataset.icon;
    if (name) slot.innerHTML = iconSvg(name);
  });
}

function setIconSlot(slot: HTMLElement | null, name: string) {
  if (!slot) return;
  slot.dataset.icon = name;
  slot.innerHTML = iconSvg(name);
}

bootstrap();

function bootstrap() {
  bindOpenRequestListener();
  window.addEventListener("unhandledrejection", (event) => {
    log(`操作失败：${event.reason instanceof Error ? event.reason.message : String(event.reason)}`);
  });
  window.addEventListener("error", (event) => {
    log(`界面错误：${event.message}`);
  });
  registerMdx();
  registerToml();
  registerCompletionProviders();
  defineThemes();
  renderIconSlots();

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
  applyShellFontSettings();
  applyMarkdownContentWidth();

  editor = monaco.editor.create($("editor"), {
    model: initial.model,
    theme: "notra-light",
    automaticLayout: true,
    fontFamily: resolveEditorFontStack(),
    fontSize: state.fontSize,
    lineHeight: editorLineHeight(),
    tabSize: 2,
    insertSpaces: true,
    minimap: { enabled: state.minimap },
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
    smoothScrolling: true,
    cursorSmoothCaretAnimation: "on",
    cursorBlinking: "smooth",
    bracketPairColorization: { enabled: true },
    guides: {
      bracketPairs: false,
      indentation: true,
      highlightActiveIndentation: true,
    },
    matchBrackets: "always",
    stickyScroll: { enabled: false },
    folding: true,
    foldingHighlight: true,
    showFoldingControls: "mouseover",
    wordWrap: state.wordWrap ? "on" : "off",
    largeFileOptimizations: true,
    renderWhitespace: state.renderWhitespace,
    occurrencesHighlight: "singleFile",
    selectionHighlight: true,
    autoIndent: "full",
    autoClosingBrackets: "languageDefined",
    autoClosingQuotes: "languageDefined",
    autoSurround: "languageDefined",
    dragAndDrop: true,
    links: true,
    hover: { enabled: true, delay: 300 },
    parameterHints: { enabled: true, cycle: true },
    suggest: { preview: true, showWords: true, selectionMode: "always" },
    tabCompletion: "on",
    wordBasedSuggestions: "currentDocument",
    quickSuggestions: { other: true, comments: false, strings: false },
    multiCursorModifier: "alt",
    multiCursorPaste: "spread",
    copyWithSyntaxHighlighting: true,
    unicodeHighlight: {
      ambiguousCharacters: true,
      invisibleCharacters: true,
      nonBasicASCII: false,
    },
  });

  searchDecorations = editor.createDecorationsCollection();
  activeSearchDecoration = editor.createDecorationsCollection();
  bookmarkDecorations = editor.createDecorationsCollection();
  editor.onDidScrollChange(syncMarkdownPreviewScroll);
  const editorResizeObserver = new ResizeObserver(() => requestEditorLayout(!paneResizeActive()));
  editorResizeObserver.observe($("editor"));
  registerAppCommands();
  bindKeybindings();

  bindActions();
  bindFileDrop();
  bindWindowControls();
  bindWindowCloseGuard();
  bindExplorerResize();
  bindRightSidebarResize();
  bindMarkdownPreviewResize();
  bindOutsideDismissal();
  setFindView("find", false);
  renderAll();
  void initializeAppUpdate();
  // First paint can run before grid tracks resolve; force layout so Monaco is not 0×0.
  requestEditorLayout();
  void restoreSession()
    .then(async () => {
      await syncSystemIntegrationPreferences();
      await openStartupArgs();
      openRequestsReady = true;
      await drainOpenRequests();
    })
    .finally(markAppReady);
  log("Notra Monaco UI ready");
}

function markAppReady() {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      requestEditorLayout();
      document.body.classList.remove("booting");
      $("bootSplash")?.remove();
    });
  });
}

function bindFileDrop() {
  void appWindow.onDragDropEvent(({ payload }) => {
    if (payload.type === "leave") {
      setFileDropActive(false);
      return;
    }

    const insideEditor = isDropPositionInsideEditor(payload.position);
    if (payload.type === "enter" || payload.type === "over") {
      setFileDropActive(insideEditor);
      return;
    }

    setFileDropActive(false);
    if (!insideEditor || payload.paths.length === 0) return;
    fileDropTask = fileDropTask
      .then(() => openDroppedFiles(payload.paths))
      .catch((error) => log(`拖放打开失败：${String(error)}`));
  }).catch((error) => log(`初始化文件拖放失败：${String(error)}`));
}

function isDropPositionInsideEditor(position: { x: number; y: number }) {
  const rect = $<HTMLElement>("editorArea").getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  const x = position.x / scale;
  const y = position.y / scale;
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function setFileDropActive(active: boolean) {
  $("editorArea").classList.toggle("file-drop-active", active);
}

async function openDroppedFiles(paths: string[]) {
  const seen = new Set<string>();
  const uniquePaths = paths.filter((path) => {
    const key = normalizePathForCompare(path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  let opened = 0;
  let failed = 0;
  for (const path of uniquePaths) {
    try {
      await openPath(path, true);
      opened += 1;
    } catch (error) {
      failed += 1;
      log(`拖放打开失败：${fileNameFromPath(path)}：${String(error)}`);
    }
  }
  if (opened > 0) focusActiveEditor();
  log(`拖放打开 ${opened} 个文件${failed > 0 ? `，${failed} 个失败` : ""}`);
}

function registerAppCommands() {
  appCommands.clear();
  const editorOnly = () => isEditorSurfaceFocused() && !isMarkdownWysiwygActive();
  const markdownOnly = () => isEditorSurfaceFocused() && isMarkdownLikeDocument();
  const commands: AppCommand[] = [
    command("file.new", "新建文件", "文件", newDocument, { allowInInput: true }),
    command("file.open", "打开文件", "文件", () => openDocument(), { allowInInput: true }),
    command("file.openFolder", "打开工作区", "文件", () => chooseWorkspace(), { allowInInput: true }),
    command("file.openRecent", "最近打开", "文件", () => toggleMenu("recentMenu"), { allowInInput: true }),
    command("workspace.close", "关闭工作区", "文件", closeWorkspace, { enabled: () => Boolean(state.workspace) }),
    command("workspace.singleMode", "切换到单文件模式", "视图", () => setWorkMode("single")),
    command("workspace.folderMode", "切换到工作区模式", "视图", enterWorkspaceMode),
    command("file.save", "保存", "文件", () => saveActive(), { allowInInput: true }),
    command("file.saveAs", "另存为", "文件", () => saveAsActive(), { allowInInput: true }),
    command("file.saveAll", "保存全部", "文件", () => saveAll(), { allowInInput: true }),
    command("file.close", "关闭当前标签", "文件", async () => { await closeDocument(activeDocument().id); }, { allowInInput: true }),
    command("file.reopenClosed", "重新打开已关闭标签", "文件", reopenClosedDocument, {
      allowInInput: true,
      enabled: () => closedDocuments.length > 0,
    }),
    command("tabs.next", "切换到下一个标签", "标签", () => activateAdjacentDocument(1), { allowInInput: true }),
    command("tabs.previous", "切换到上一个标签", "标签", () => activateAdjacentDocument(-1), { allowInInput: true }),
    command("tabs.closeOthers", "关闭其他标签", "标签", () => closeOtherTabsFor(state.activeId)),
    command("tabs.closeRight", "关闭右侧标签", "标签", () => closeTabsToRightFor(state.activeId)),
    command("tabs.closeSaved", "关闭已保存标签", "标签", closeSavedTabs),
    command("edit.undo", "撤销", "编辑", undoEditor, { when: () => isEditorSurfaceFocused() }),
    command("edit.redo", "重做", "编辑", redoEditor, { when: () => isEditorSurfaceFocused() }),
    command("edit.cut", "剪切", "编辑", () => runEditorAction("editor.action.clipboardCutAction"), { when: () => isEditorSurfaceFocused() }),
    command("edit.copy", "复制", "编辑", () => runEditorAction("editor.action.clipboardCopyAction"), { when: () => isEditorSurfaceFocused() }),
    command("edit.paste", "粘贴", "编辑", () => runEditorAction("editor.action.clipboardPasteAction"), { when: () => isEditorSurfaceFocused() }),
    command("edit.pastePlain", "粘贴为纯文本", "编辑", pastePlainText, { when: () => isEditorSurfaceFocused() }),
    command("edit.selectAll", "全选", "选择", selectAllEditor, { when: () => isEditorSurfaceFocused() }),
    command("edit.uppercase", "转为大写", "编辑", transformToUppercase, { when: editorOnly }),
    command("edit.lowercase", "转为小写", "编辑", transformToLowercase, { when: editorOnly }),
    editorCommand("editor.duplicateLineDown", "向下复制行", "editor.action.copyLinesDownAction", editorOnly),
    editorCommand("editor.insertLineAfter", "在下方插入行", "editor.action.insertLineAfter", editorOnly),
    editorCommand("editor.insertLineBefore", "在上方插入行", "editor.action.insertLineBefore", editorOnly),
    editorCommand("editor.indentLines", "增加行缩进", "editor.action.indentLines", editorOnly),
    editorCommand("editor.outdentLines", "减少行缩进", "editor.action.outdentLines", editorOnly),
    editorCommand("editor.deleteLine", "删除当前行", "editor.action.deleteLines", editorOnly),
    editorCommand("editor.moveLineUp", "向上移动行", "editor.action.moveLinesUpAction", editorOnly),
    editorCommand("editor.moveLineDown", "向下移动行", "editor.action.moveLinesDownAction", editorOnly),
    editorCommand("editor.toggleLineComment", "切换行注释", "editor.action.commentLine", editorOnly),
    editorCommand("editor.toggleBlockComment", "切换块注释", "editor.action.blockComment", editorOnly),
    editorCommand("editor.formatDocument", "格式化文档", "editor.action.formatDocument", editorOnly),
    editorCommand("editor.selectNextOccurrence", "选中下一个同词", "editor.action.addSelectionToNextFindMatch", editorOnly),
    editorCommand("editor.selectAllOccurrences", "选中所有同词", "editor.action.selectHighlights", editorOnly),
    editorCommand("editor.addCursorAbove", "在上方添加光标", "editor.action.insertCursorAbove", editorOnly),
    editorCommand("editor.addCursorBelow", "在下方添加光标", "editor.action.insertCursorBelow", editorOnly),
    editorCommand("editor.triggerSuggest", "触发建议", "editor.action.triggerSuggest", editorOnly),
    editorCommand("editor.triggerParameterHints", "触发参数提示", "editor.action.triggerParameterHints", editorOnly),
    editorCommand("editor.quickOutline", "转到文件中的符号", "editor.action.quickOutline", editorOnly),
    editorCommand("editor.goToBracket", "跳转到匹配括号", "editor.action.jumpToBracket", editorOnly),
    editorCommand("editor.renameSymbol", "重命名符号", "editor.action.rename", editorOnly),
    editorCommand("editor.fold", "折叠当前区域", "editor.fold", editorOnly),
    editorCommand("editor.unfold", "展开当前区域", "editor.unfold", editorOnly),
    editorCommand("editor.foldAll", "全部折叠", "editor.foldAll", editorOnly),
    editorCommand("editor.unfoldAll", "全部展开", "editor.unfoldAll", editorOnly),
    editorCommand("editor.trimTrailingWhitespace", "删除行尾空白", "editor.action.trimTrailingWhitespace", editorOnly),
    editorCommand("editor.sortLinesAscending", "按升序排列行", "editor.action.sortLinesAscending", editorOnly),
    editorCommand("editor.sortLinesDescending", "按降序排列行", "editor.action.sortLinesDescending", editorOnly),
    command("search.find", "查找", "查找", () => openCurrentFind("find"), { allowInInput: true, when: () => isEditorSurfaceFocused() }),
    command("search.replace", "替换", "查找", () => openCurrentFind("replace"), { allowInInput: true, when: () => isEditorSurfaceFocused() }),
    command("search.next", "查找下一个", "查找", () => findNextResult(), { allowInInput: true, when: () => isEditorSurfaceFocused() }),
    command("search.previous", "查找上一个", "查找", () => findPreviousResult(), { allowInInput: true, when: () => isEditorSurfaceFocused() }),
    command("search.workspaceFind", "在文件中查找", "查找", () => openWorkspaceFind("workspace-find"), { allowInInput: true, enabled: () => Boolean(state.workspace) }),
    command("search.workspaceReplace", "在文件中替换", "查找", () => openWorkspaceFind("workspace-replace"), { allowInInput: true, enabled: () => Boolean(state.workspace) }),
    command("search.findAllCurrent", "查找当前文件全部结果", "查找", () => findCurrent(true), { allowInInput: true, when: () => isEditorSurfaceFocused() }),
    command("search.clearResults", "清除查找结果", "查找", clearSearchResults),
    command("navigation.goToLine", "跳转到行", "导航", goToLine, { when: () => isEditorSurfaceFocused() }),
    command("navigation.quickOpen", "快速打开文件", "导航", openQuickOpen, { allowInInput: true }),
    command("navigation.commandPalette", "命令面板", "导航", () => openCommandPalette("commands"), { allowInInput: true }),
    command("navigation.focusExplorer", "聚焦文件资源管理器", "导航", focusExplorer, { enabled: () => Boolean(state.workspace) }),
    command("view.toggleExplorer", "切换文件资源管理器", "视图", toggleExplorer, { allowInInput: true }),
    command("view.openSettings", "打开设置", "视图", openSettingsPage, { allowInInput: true }),
    command("view.toggleRightSidebar", "切换右侧栏", "视图", toggleRightSidebar, { allowInInput: true }),
    command("view.toggleWordWrap", "切换自动换行", "视图", toggleWordWrap),
    command("view.toggleMinimap", "切换缩略图", "视图", toggleMinimap),
    command("view.toggleWhitespace", "切换空白符", "视图", cycleWhitespace),
    command("view.zoomIn", "增大编辑器字号", "视图", () => setFontSize(state.fontSize + 1), { allowInInput: true }),
    command("view.zoomOut", "减小编辑器字号", "视图", () => setFontSize(state.fontSize - 1), { allowInInput: true }),
    command("view.zoomReset", "重置编辑器字号", "视图", () => setFontSize(DEFAULT_EDITOR_FONT_SIZE), { allowInInput: true }),
    command("view.toggleTheme", "切换主题", "视图", toggleTheme, { allowInInput: true }),
    command("bookmark.toggle", "切换书签", "书签", toggleBookmark, { when: editorOnly }),
    command("bookmark.next", "下一个书签", "书签", () => navigateBookmark(1), { when: editorOnly }),
    command("bookmark.previous", "上一个书签", "书签", () => navigateBookmark(-1), { when: editorOnly }),
    command("markdown.outline", "Markdown 大纲", "Markdown", openMarkdownOutline, { when: markdownOnly, priority: 20 }),
    markdownCommand("markdown.bold", "粗体", "format:strong", markdownOnly),
    markdownCommand("markdown.italic", "斜体", "format:em", markdownOnly),
    markdownCommand("markdown.inlineCode", "行内代码", "format:inline_code", markdownOnly),
    markdownCommand("markdown.link", "插入链接", "format:link", markdownOnly),
    markdownCommand("markdown.heading1", "一级标题", "paragraph:heading 1", markdownOnly),
    markdownCommand("markdown.heading2", "二级标题", "paragraph:heading 2", markdownOnly),
    markdownCommand("markdown.heading3", "三级标题", "paragraph:heading 3", markdownOnly),
    markdownCommand("markdown.heading4", "四级标题", "paragraph:heading 4", markdownOnly),
    markdownCommand("markdown.heading5", "五级标题", "paragraph:heading 5", markdownOnly),
    markdownCommand("markdown.heading6", "六级标题", "paragraph:heading 6", markdownOnly),
    markdownCommand("markdown.paragraph", "正文", "paragraph:paragraph", markdownOnly),
    markdownCommand("markdown.insertImage", "插入图片", "insert:image", markdownOnly),
    markdownCommand("markdown.insertTable", "插入表格", "insert:table", markdownOnly),
    markdownCommand("markdown.codeBlock", "插入代码块", "paragraph:pre", markdownOnly),
    markdownCommand("markdown.mathBlock", "插入公式块", "paragraph:mathblock", markdownOnly),
    command("markdown.modeWysiwyg", "Markdown 即时编辑", "Markdown", () => setMarkdownEditMode("wysiwyg"), { when: markdownOnly }),
    command("markdown.modeSplit", "Markdown 分屏预览", "Markdown", () => setMarkdownEditMode("split"), { when: markdownOnly }),
    command("markdown.modeSource", "Markdown 源码", "Markdown", () => setMarkdownEditMode("source"), { when: markdownOnly }),
  ];
  commands.forEach((item) => appCommands.set(item.id, item));
}

function command(
  id: string,
  title: string,
  category: CommandCategory,
  run: () => void | Promise<void>,
  options: Omit<AppCommand, "id" | "title" | "category" | "run"> = {},
): AppCommand {
  return { id, title, category, run, ...options };
}

function editorCommand(id: string, title: string, actionId: string, when: () => boolean): AppCommand {
  return command(id, title, "编辑", () => runEditorAction(actionId), { when });
}

function markdownCommand(id: string, title: string, action: string, when: () => boolean): AppCommand {
  return command(id, title, "Markdown", () => runMarkdownShortcutAction(action), { when, priority: 20 });
}

function bindKeybindings() {
  $("editor").addEventListener("keydown", handleEditorKeybinding, true);
  $("markdownWysiwyg").addEventListener("keydown", handleEditorKeybinding, true);
}

const NATIVE_CLIPBOARD_SHORTCUTS = new globalThis.Map([
  ["Ctrl+C", "edit.copy"],
  ["Ctrl+X", "edit.cut"],
  ["Ctrl+V", "edit.paste"],
]);

function handleEditorKeybinding(event: KeyboardEvent) {
  const stroke = keyboardEventStroke(event);
  if (!stroke) return;
  const chord = pendingKeybindingChord ? `${pendingKeybindingChord} ${stroke}` : stroke;
  const exact = matchingCommands(chord, false);
  const prefix = hasMatchingChordPrefix(chord, false);
  if (usesNativeClipboardShortcut(stroke, exact[0])) {
    clearPendingKeybindingChord();
    return;
  }
  if (exact.length > 0 && !prefix) {
    event.preventDefault();
    event.stopPropagation();
    clearPendingKeybindingChord();
    void executeAppCommand(exact[0]);
    return;
  }
  if (prefix) {
    event.preventDefault();
    event.stopPropagation();
    setPendingKeybindingChord(chord);
    return;
  }
  if (pendingKeybindingChord) {
    clearPendingKeybindingChord();
    const standalone = matchingCommands(stroke, false);
    if (usesNativeClipboardShortcut(stroke, standalone[0])) return;
    if (standalone.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      void executeAppCommand(standalone[0]);
    }
  }
}

function usesNativeClipboardShortcut(stroke: string, command: AppCommand | undefined) {
  return NATIVE_CLIPBOARD_SHORTCUTS.get(stroke) === command?.id;
}

function matchingCommands(binding: string, targetIsInput: boolean) {
  return [...appCommands.values()]
    .filter((item) => commandIsAvailable(item, targetIsInput))
    .filter((item) => activeCommandBindings(item.id).includes(binding))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

function hasMatchingChordPrefix(binding: string, targetIsInput: boolean) {
  return [...appCommands.values()]
    .filter((item) => commandIsAvailable(item, targetIsInput))
    .some((item) => activeCommandBindings(item.id).some((candidate) => bindingStartsWith(candidate, binding)));
}

function commandIsAvailable(item: AppCommand, targetIsInput = false) {
  if (targetIsInput && !item.allowInInput) return false;
  return (item.when?.() ?? true) && (item.enabled?.() ?? true);
}

async function executeAppCommand(item: AppCommand) {
  closeMenus();
  await item.run();
}

function activeCommandBindings(commandId: string) {
  return commandBindings(commandId, state.keymapProfile, state.mode, state.keybindingOverrides);
}

function setPendingKeybindingChord(value: string) {
  pendingKeybindingChord = value;
  window.clearTimeout(pendingKeybindingChordTimer);
  pendingKeybindingChordTimer = window.setTimeout(clearPendingKeybindingChord, 1600);
  state.keybindingHint = `${value} 等待下一按键`;
  renderChrome();
}

function clearPendingKeybindingChord() {
  window.clearTimeout(pendingKeybindingChordTimer);
  pendingKeybindingChord = "";
  state.keybindingHint = "";
  if (editor) renderChrome();
}

function isEditorSurfaceFocused() {
  const active = document.activeElement;
  return active instanceof HTMLElement && Boolean(active.closest("#editor, #markdownWysiwyg"));
}

function bindActions() {
  bindAppMenus();
  bindMarkdownContextMenu();
  $("markdownPreview").addEventListener("click", handleMarkdownPreviewClick);
  $("tree").addEventListener("scroll", scheduleSessionSave, { passive: true });
  $("tree").addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".tree-item");
    if (!button) return;
    const path = button.dataset.path ?? "";
    if (button.classList.contains("dir")) toggleDirectoryCollapse(path);
    else if (button.classList.contains("file")) void openPath(path);
  });
  $("tree").addEventListener("keydown", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".tree-item");
    if (button) void handleTreeItemKeydown(button, event as KeyboardEvent);
  });
  $("newButton").addEventListener("click", newDocument);
  $("openButton").addEventListener("click", openDocument);
  $("workspaceButton").addEventListener("click", () => void enterWorkspaceMode());
  $("saveButton").addEventListener("click", saveActive);
  $("saveAsButton").addEventListener("click", saveAsActive);
  $("saveAllButton").addEventListener("click", saveAll);
  $("undoButton").addEventListener("click", undoEditor);
  $("redoButton").addEventListener("click", redoEditor);
  $("uppercaseButton").addEventListener("click", transformToUppercase);
  $("lowercaseButton").addEventListener("click", transformToLowercase);
  $("tabs").addEventListener("mousedown", (event) => {
    if (event.button === 0 && event.target === event.currentTarget) event.preventDefault();
  });
  $("tabs").addEventListener("dblclick", (event) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    newDocument();
  });
  $("findButton").addEventListener("click", () => {
    setFindView("find");
    toggleFindOpen({ prefillFromSelection: true });
  });
  $("replaceButton").addEventListener("click", () => {
    setFindView("replace");
    toggleFindOpen({ prefillFromSelection: true });
  });
  $("commandButton").addEventListener("click", () => openCommandPalette("commands"));
  $("goToLineButton").addEventListener("click", goToLine);
  $("wordWrapButton").addEventListener("click", toggleWordWrap);
  $("findRailButton").addEventListener("click", () => {
    void openWorkspaceFind("workspace-find");
  });
  $("rightSidebarToggleButton").addEventListener("click", toggleRightSidebar);
  $("findCurrentButton").addEventListener("click", () => findCurrent(true));
  $("findNextButton").addEventListener("click", () => void findNextResult());
  $("findPreviousButton").addEventListener("click", () => void findPreviousResult());
  $("replaceCurrentButton").addEventListener("click", replaceCurrentFile);
  $("replaceAllCurrentButton").addEventListener("click", replaceAllCurrentFile);
  $("findWorkspaceButton").addEventListener("click", () => void searchWorkspace());
  $("previewWorkspaceReplaceButton").addEventListener("click", () => void previewWorkspaceReplace());
  $("closeCurrentFindButton").addEventListener("click", closeFind);
  $("currentFindHistoryButton").addEventListener("click", () => {
    toggleCurrentFindHistory();
    ($("currentFindInput") as HTMLInputElement).focus();
  });
  $("findHistoryButton").addEventListener("click", () => toggleSearchHistory("find"));
  $("replaceHistoryButton").addEventListener("click", () => toggleSearchHistory("replace"));
  $("currentFindPreviousButton").addEventListener("click", () => {
    syncCurrentFindControls();
    commitSearchHistory();
    void findPreviousResult();
  });
  $("currentFindNextButton").addEventListener("click", () => {
    syncCurrentFindControls();
    commitSearchHistory();
    void findNextResult();
  });
  $("currentFindAllButton").addEventListener("click", () => {
    syncCurrentFindControls();
    findCurrent(true);
  });
  $("currentReplaceButton").addEventListener("click", () => {
    syncCurrentFindControls();
    replaceCurrentFile();
  });
  $("currentReplaceAllButton").addEventListener("click", () => {
    syncCurrentFindControls();
    replaceAllCurrentFile();
  });
  $("currentFindInput").addEventListener("input", scheduleCurrentFind);
  $("currentReplaceInput").addEventListener("input", syncCurrentFindControls);
  ["currentMatchCaseInput", "currentWholeWordInput", "currentRegexInput"].forEach((id) => {
    $(id).addEventListener("change", scheduleCurrentFind);
  });
  $("currentFindInput").addEventListener("keydown", (event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.altKey && keyboardEvent.key === "ArrowDown") {
      event.preventDefault();
      openCurrentFindHistory();
      moveCurrentFindHistorySelection(1);
      return;
    }
    if (!$("currentFindHistoryMenu").classList.contains("hidden")) {
      if (keyboardEvent.key === "ArrowDown" || keyboardEvent.key === "ArrowUp") {
        event.preventDefault();
        moveCurrentFindHistorySelection(keyboardEvent.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (keyboardEvent.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeCurrentFindHistory();
        return;
      }
      if (keyboardEvent.key === "Enter" && selectActiveCurrentFindHistory()) {
        event.preventDefault();
        return;
      }
    }
    if (keyboardEvent.key !== "Enter") return;
    event.preventDefault();
    syncCurrentFindControls();
    commitSearchHistory();
    if (keyboardEvent.shiftKey) void findPreviousResult();
    else void findNextResult();
  });
  $("rightSearchToolButton").addEventListener("click", () => {
    const workspace = state.mode === "workspace" && Boolean(state.workspace);
    if (!workspace && !hasCurrentSearchResults()) return;
    if (workspace && state.findView !== "workspace-find" && state.findView !== "workspace-replace") {
      setFindView("workspace-find");
    }
    setRightTool("search");
  });
  $("rightOutlineToolButton").addEventListener("click", () => setRightTool("outline"));
  $("languageButton").addEventListener("click", () => toggleMenu("languageMenu"));
  $("encodingButton").addEventListener("click", () => toggleMenu("encodingMenu"));
  $("lineEndingButton").addEventListener("click", () => toggleMenu("lineEndingMenu"));
  $("recentButton").addEventListener("click", () => toggleMenu("recentMenu"));
  $("settingsButton").addEventListener("click", openSettingsPage);
  $("settingsCloseButton").addEventListener("click", closeSettingsPage);
  document.querySelectorAll<HTMLButtonElement>("[data-settings-section]").forEach((button) => {
    button.addEventListener("click", () => selectSettingsSection(button.dataset.settingsSection as SettingsSection));
  });
  $("settingsThemeLight").addEventListener("click", () => setThemeMode(false));
  $("settingsThemeDark").addEventListener("click", () => setThemeMode(true));
  $("settingsShellFontMinus").addEventListener("click", () => setShellFontSize(state.shellFontSize - 1));
  $("settingsShellFontPlus").addEventListener("click", () => setShellFontSize(state.shellFontSize + 1));
  $("settingsFontMinus").addEventListener("click", () => setFontSize(state.fontSize - 1));
  $("settingsFontPlus").addEventListener("click", () => setFontSize(state.fontSize + 1));
  bindFontDropdown("settingsShellFontModeButton", "settingsShellFontModeMenu", (value) => setFontMode("shell", value));
  bindFontDropdown("settingsShellFontPresetButton", "settingsShellFontPresetMenu", (value) => setFontPreset("shell", value));
  bindFontDropdown("settingsEditorFontModeButton", "settingsEditorFontModeMenu", (value) => setFontMode("editor", value));
  bindFontDropdown("settingsEditorFontPresetButton", "settingsEditorFontPresetMenu", (value) => setFontPreset("editor", value));
  bindCustomFontInput("settingsShellFontCustom", "shell");
  bindCustomFontInput("settingsEditorFontCustom", "editor");
  bindSegmentedSetting("settingsWordWrapControl", (value) => setWordWrap(value === "on"));
  bindSegmentedSetting("settingsMinimapControl", (value) => setMinimap(value === "on"));
  bindSegmentedSetting("settingsWhitespaceControl", (value) => setWhitespace(value as RenderWhitespaceMode));
  bindSegmentedSetting("settingsKeymapProfileControl", (value) => setKeymapProfile(value));
  bindSegmentedSetting("settingsMarkdownWidthControl", (value) => setMarkdownContentWidth(value));
  bindSegmentedSetting("settingsMarkdownControl", (value) => setMarkdownEditMode(value as MarkdownEditMode));
  bindSegmentedSetting("settingsModeControl", (value) => {
    if (value === "workspace") {
      void enterWorkspaceMode();
    } else {
      setWorkMode("single");
    }
    renderSettingsMenu();
  });
  $("settingsCommandButton").addEventListener("click", () => {
    closeSettingsPage();
    openCommandPalette();
  });
  $("settingsResetViewButton").addEventListener("click", resetEditorView);
  $("keybindingSearchInput").addEventListener("input", renderKeybindingSettings);
  $("toggleKeybindingGroupsButton").addEventListener("click", toggleAllKeybindingGroups);
  $("importKeybindingsButton").addEventListener("click", () => void importKeybindings());
  $("exportKeybindingsButton").addEventListener("click", () => void exportKeybindings());
  $("resetAllKeybindingsButton").addEventListener("click", () => void resetAllKeybindings());
  $("settingsShellIntegrationButton").addEventListener("click", () => void toggleShellIntegration());
  $("settingsDefaultAppButton").addEventListener("click", () => void toggleDefaultAppCandidate());
  $("settingsOpenFindButton").addEventListener("click", () => {
    closeSettingsPage();
    setFindView("find");
    toggleFindOpen();
  });
  $("tabSaveButton").addEventListener("click", () => void saveTabFromMenu(false));
  $("tabSaveAsButton").addEventListener("click", () => void saveTabFromMenu(true));
  $("tabCopyPathButton").addEventListener("click", () => void copyTabPath());
  $("tabRevealButton").addEventListener("click", () => void revealTabPath());
  $("tabCloseButton").addEventListener("click", () => void closeTabFromMenu());
  $("tabCloseOthersButton").addEventListener("click", () => void closeOtherTabsFromMenu());
  $("tabCloseRightButton").addEventListener("click", () => void closeTabsToRightFromMenu());
  $("tabCloseSavedButton").addEventListener("click", () => void closeSavedTabs());
  $("languageSearchInput").addEventListener("input", () =>
    renderLanguageList(($("languageSearchInput") as HTMLInputElement).value),
  );
  $("clearRecentButton").addEventListener("click", clearRecentFiles);
  $("unsavedSaveButton").addEventListener("click", () => resolveUnsavedDialog("save"));
  $("unsavedDiscardButton").addEventListener("click", () => resolveUnsavedDialog("discard"));
  $("unsavedCancelButton").addEventListener("click", () => resolveUnsavedDialog("cancel"));
  $("confirmOkButton").addEventListener("click", () => resolveConfirmDialog(true));
  $("confirmCancelButton").addEventListener("click", () => resolveConfirmDialog(false));
  $("inputOkButton").addEventListener("click", () => resolveTextInputDialog());
  $("inputCancelButton").addEventListener("click", () => resolveTextInputDialog(null));
  $("inputDialogInput").addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Enter") {
      event.preventDefault();
      resolveTextInputDialog();
    }
  });
  $("tree").addEventListener("contextmenu", openTreeMenu);
  $("treeOpenButton").addEventListener("click", () => void openTreeTarget());
  $("treeNewFileButton").addEventListener("click", () => void createTreeEntry(false));
  $("treeNewFolderButton").addEventListener("click", () => void createTreeEntry(true));
  $("treeRenameButton").addEventListener("click", () => void renameTreeEntry());
  $("treeDeleteButton").addEventListener("click", () => void deleteTreeEntry());
  $("treeCopyPathButton").addEventListener("click", () => void copyTreePath());
  $("treeRevealButton").addEventListener("click", () => void revealTreeEntry());
  $("treeRefreshButton").addEventListener("click", () => void refreshWorkspaceFromTreeMenu());
  $("directoryToggle").addEventListener("click", () => {
    if (!state.workspace) {
      void enterWorkspaceMode();
      return;
    }
    state.mode = "workspace";
    state.showDirectory = !state.showDirectory;
    renderWorkspace();
    renderChrome();
    scheduleSessionSave();
  });
  $("closeDirectoryButton").addEventListener("click", () => {
    state.showDirectory = false;
    renderWorkspace();
    renderChrome();
    scheduleSessionSave();
  });
  $("refreshDirectoryButton").addEventListener("click", () => void refreshWorkspace());
  $("themeButton").addEventListener("click", toggleTheme);
  document.querySelectorAll<HTMLButtonElement>("[data-markdown-mode]").forEach((button) => {
    button.addEventListener("click", () => setMarkdownEditMode(button.dataset.markdownMode as MarkdownEditMode));
  });

  ["findInput", "replaceInput", "directoryInput", "fileGlobInput", "skipDirsInput", "searchModeInput"].forEach((id) => {
    $(id).addEventListener("change", scheduleSessionSave);
  });
  $("findInput").addEventListener("keydown", (event) => {
    if (handleSearchHistoryKeydown(event as KeyboardEvent, "find")) return;
    if ((event as KeyboardEvent).key !== "Enter") return;
    event.preventDefault();
    if (state.findView === "workspace-find") {
      void searchWorkspace();
      return;
    }
    if (state.findView === "workspace-replace") {
      void previewWorkspaceReplace();
      return;
    }
    if ((event as KeyboardEvent).shiftKey) {
      void findPreviousResult();
    } else {
      void findNextResult();
    }
  });
  $("closeWorkspaceButton").addEventListener("click", () => void closeWorkspace());
  $("replaceInput").addEventListener("keydown", (event) => {
    if (handleSearchHistoryKeydown(event as KeyboardEvent, "replace")) return;
    if ((event as KeyboardEvent).key !== "Enter" || state.findView !== "workspace-replace") return;
    event.preventDefault();
    void previewWorkspaceReplace();
  });
  [
    "matchCaseInput",
    "wholeWordInput",
    "reverseSearchInput",
    "wrapSearchInput",
    "searchSelectionInput",
    "recursiveInput",
    "includeHiddenInput",
  ].forEach((id) => {
    $(id).addEventListener("change", scheduleSessionSave);
  });

  document.querySelectorAll<HTMLButtonElement>("[data-find-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const view = (button.dataset.findView as FindView) || "find";
      if (view === "workspace-find" || view === "workspace-replace") {
        void openWorkspaceFind(view);
      } else {
        setFindView(view);
      }
    });
  });
  document.addEventListener("keydown", (event) => {
    if (handleContextMenuKeydown(event)) return;
    if (event.key === "F2" && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
      const focusedTreeItem = document.activeElement?.closest<HTMLButtonElement>(".tree-item");
      const activeTreeItem = $("tree").querySelector<HTMLButtonElement>(".tree-item.active");
      const target = focusedTreeItem ?? activeTreeItem;
      if (state.mode === "workspace" && state.showDirectory && target) {
        event.preventDefault();
        treeMenuTarget = treeContextTargetFromRow(target);
        void renameTreeEntry();
        return;
      }
    }
    if (event.key === "Escape") {
      if (!$("confirmDialog").classList.contains("hidden")) {
        resolveConfirmDialog(false);
        return;
      }
      if (!$("inputDialog").classList.contains("hidden")) {
        resolveTextInputDialog(null);
        return;
      }
      if (!$("unsavedDialog").classList.contains("hidden")) {
        resolveUnsavedDialog("cancel");
        return;
      }
      if (hasOpenFontDropdown()) {
        closeFontDropdowns();
        return;
      }
      if (!$("settingsPage").classList.contains("hidden")) {
        closeSettingsPage();
        return;
      }
      if (!$("findPopover").classList.contains("hidden")) {
        closeFind();
        return;
      }
      closeMenus();
      $("commandPalette").classList.add("hidden");
    }
  });
  $("settingsCheckUpdateButton").addEventListener("click", () => void checkForAppUpdate(true));
  $("settingsInstallUpdateButton").addEventListener("click", () => void installAppUpdate());

  editor.onDidChangeCursorPosition(renderChrome);
}

function bindAppMenus() {
  const menus = [
    ["fileMenuButton", "fileMenu"],
    ["editMenuButton", "editMenu"],
    ["searchMenuButton", "searchMenu"],
    ["viewMenuButton", "viewMenu"],
  ] as const;

  for (const [triggerId, menuId] of menus) {
    const trigger = $<HTMLButtonElement>(triggerId);
    trigger.addEventListener("click", () => toggleAppMenu(menuId, trigger));
    trigger.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown" && event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openAppMenu(menuId, trigger);
    });
    trigger.addEventListener("pointerenter", () => {
      if (!activeAppMenu()) return;
      openAppMenu(menuId, trigger);
    });
  }

  bindMenuAction("menuNewButton", newDocument);
  bindMenuAction("menuOpenButton", () => void openDocument());
  bindMenuAction("menuRecentButton", () => toggleMenu("recentMenu"));
  bindMenuAction("menuWorkspaceButton", () => void enterWorkspaceMode());
  bindMenuAction("menuCloseWorkspaceButton", () => void closeWorkspace());
  bindMenuAction("menuSaveButton", () => void saveActive());
  bindMenuAction("menuSaveAllButton", () => void saveAll());
  bindMenuAction("menuSaveAsButton", () => void saveAsActive());
  bindMenuAction("menuCloseButton", () => void closeDocument(activeDocument().id));
  bindMenuAction("menuUndoButton", undoEditor);
  bindMenuAction("menuRedoButton", redoEditor);
  bindMenuAction("menuUppercaseButton", transformToUppercase);
  bindMenuAction("menuLowercaseButton", transformToLowercase);
  bindMenuAction("menuSelectAllButton", selectAllEditor);
  bindMenuAction("menuFindButton", () => {
    setFindView("find");
    toggleFindOpen({ prefillFromSelection: true });
  });
  bindMenuAction("menuReplaceButton", () => {
    setFindView("replace");
    toggleFindOpen({ prefillFromSelection: true });
  });
  bindMenuAction("menuFindWorkspaceButton", () => void openWorkspaceFind("workspace-find"));
  bindMenuAction("menuReplaceWorkspaceButton", () => void openWorkspaceFind("workspace-replace"));
  bindMenuAction("menuGoToLineButton", goToLine);
  bindMenuAction("menuCommandButton", openCommandPalette);
  bindMenuAction("menuWordWrapButton", toggleWordWrap);
  bindMenuAction("menuMarkdownWysiwygButton", () => setMarkdownEditMode("wysiwyg"));
  bindMenuAction("menuMarkdownSplitButton", () => setMarkdownEditMode("split"));
  bindMenuAction("menuMarkdownSourceButton", () => setMarkdownEditMode("source"));
  bindMenuAction("menuOutlineButton", openMarkdownOutline);
  bindMenuAction("menuThemeButton", toggleTheme);
}

function bindMenuAction(id: string, action: () => void) {
  $(id).addEventListener("click", () => {
    closeMenus();
    action();
  });
}

function bindMarkdownContextMenu() {
  $("editor").parentElement?.addEventListener("contextmenu", openMarkdownContextMenu);
  [$("markdownContextMenu"), $("markdownTableContextMenu")].forEach((menu) => {
    menu.querySelectorAll<HTMLButtonElement>("[data-markdown-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.markdownAction;
        if (!action) return;
        void runMarkdownContextAction(action).catch((error) => {
          log(`Markdown 编辑操作失败：${error instanceof Error ? error.message : String(error)}`);
        });
      });
    });
  });
  $("markdownContextMenu").querySelectorAll<HTMLElement>(".markdown-context-submenu-host").forEach((host) => {
    const trigger = host.querySelector<HTMLButtonElement>("[data-markdown-submenu]");
    if (!trigger) return;
    host.addEventListener("pointerenter", () => {
      if (!$("markdownContextMenu").classList.contains("hidden") && !trigger.disabled) {
        openMarkdownSubmenu(trigger, false);
      }
    });
    host.addEventListener("pointerleave", () => closeMarkdownSubmenus());
    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      const submenu = $(trigger.dataset.markdownSubmenu ?? "");
      if (submenu.classList.contains("hidden")) openMarkdownSubmenu(trigger, true);
      else closeMarkdownSubmenus();
    });
  });
}

function openMarkdownContextMenu(event: Event) {
  const pointerEvent = event as MouseEvent;
  const target = pointerEvent.target instanceof Element ? pointerEvent.target : null;
  if (!markdownEditor || !isMarkdownWysiwygActive() || !target || !markdownEditor.root.contains(target)) return;
  if (target.closest("input, textarea, select, .mu-float")) return;
  pointerEvent.preventDefault();
  pointerEvent.stopPropagation();
  closeMenus();
  closeFontDropdowns();
  const isTableContext = markdownEditor.captureTableContext(target);
  markdownEditor.hideFloatTools();
  const menu = $(isTableContext ? "markdownTableContextMenu" : "markdownContextMenu");
  if (isTableContext) updateMarkdownTableContextMenuState();
  else updateMarkdownContextMenuState();
  menu.classList.toggle("submenu-left", !isTableContext && pointerEvent.clientX + 258 + 242 + 16 > window.innerWidth);
  showContextMenu(menu, pointerEvent, isTableContext ? 248 : 258, isTableContext ? 510 : 280);
}

function updateMarkdownContextMenuState() {
  const menu = $("markdownContextMenu");
  const hasSelection = Boolean(markdownEditor?.selectedText());
  const readOnly = editorBusyDepth > 0 || activeDocument().readOnly;
  menu.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
    const needsSelection = button.hasAttribute("data-needs-selection");
    const needsEdit = button.hasAttribute("data-needs-edit");
    button.disabled = (needsSelection && !hasSelection) || (needsEdit && readOnly);
  });
  $<HTMLButtonElement>("markdownCopyPasteMenuButton").disabled = !hasSelection && readOnly;
}

function updateMarkdownTableContextMenuState() {
  const menu = $("markdownTableContextMenu");
  const state = markdownEditor?.tableContextState();
  const readOnly = editorBusyDepth > 0 || activeDocument().readOnly;
  menu.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
    const action = button.dataset.markdownAction ?? "";
    const unavailable = !state
      || (action === "table:move-row-up" && state.row === 0)
      || (action === "table:move-row-down" && state.row === state.rows - 1)
      || (action === "table:move-column-left" && state.column === 0)
      || (action === "table:move-column-right" && state.column === state.columns - 1);
    button.disabled = unavailable || (readOnly && action !== "table:copy");
    if (action.startsWith("table:align-")) {
      const checked = state?.align === action.slice("table:align-".length);
      button.setAttribute("aria-checked", String(checked));
      const indicator = button.querySelector("small");
      if (indicator) indicator.textContent = checked ? "✓" : "";
    }
  });
}

function openMarkdownSubmenu(trigger: HTMLButtonElement, focusFirst: boolean) {
  if (trigger.disabled) return;
  const submenuId = trigger.dataset.markdownSubmenu;
  if (!submenuId) return;
  closeMarkdownSubmenus(submenuId);
  const submenu = $(submenuId);
  submenu.classList.remove("hidden");
  trigger.setAttribute("aria-expanded", "true");
  submenu.style.top = "-6px";
  const hostRect = trigger.parentElement?.getBoundingClientRect();
  const submenuRect = submenu.getBoundingClientRect();
  if (hostRect && submenuRect.bottom > window.innerHeight - 8) {
    const top = Math.max(8 - hostRect.top, window.innerHeight - 8 - hostRect.top - submenuRect.height);
    submenu.style.top = `${top}px`;
  }
  if (focusFirst) contextMenuButtons(submenu)[0]?.focus();
}

function closeMarkdownSubmenus(exceptId = "") {
  $("markdownContextMenu").querySelectorAll<HTMLElement>(".markdown-context-submenu").forEach((submenu) => {
    if (submenu.id === exceptId) return;
    submenu.classList.add("hidden");
    submenu.style.top = "-6px";
  });
  $("markdownContextMenu").querySelectorAll<HTMLButtonElement>("[data-markdown-submenu]").forEach((trigger) => {
    trigger.setAttribute("aria-expanded", String(trigger.dataset.markdownSubmenu === exceptId));
  });
}

async function runMarkdownContextAction(action: string) {
  const bridge = markdownEditor;
  if (!bridge || !isMarkdownWysiwygActive()) return;
  if (action === "cut" || action === "copy" || action === "delete") {
    document.execCommand(action);
    closeMenus();
    bridge.focus();
    return;
  }
  closeMenus();
  if (action.startsWith("table:")) {
    await bridge.runTableContextAction(action.slice("table:".length));
    return;
  }
  if (action === "paste" || action === "paste-plain") {
    await bridge.pasteAsPlainText();
    return;
  }
  if (action === "copy-markdown") {
    bridge.copyAsMarkdown();
    return;
  }
  if (action === "copy-html") {
    bridge.copyAsHtml();
    return;
  }
  if (action === "copy-rich") {
    bridge.copyAsRich();
    return;
  }
  if (action.startsWith("format:")) {
    bridge.format(action.slice("format:".length));
    return;
  }
  if (action.startsWith("paragraph:")) {
    bridge.updateParagraph(action.slice("paragraph:".length));
    return;
  }
  if (action === "insert:image") {
    const src = await pickMarkdownImagePath();
    if (src && bridge === markdownEditor && isMarkdownWysiwygActive()) bridge.insertImage(src);
    return;
  }
  if (action === "insert:table") {
    bridge.showTablePicker();
    return;
  }
  if (action === "insert:before" || action === "insert:after") {
    bridge.insertParagraph(action.endsWith("before") ? "before" : "after");
  }
}

function bindSegmentedSetting(id: string, handler: (value: string) => void) {
  $(id).querySelectorAll<HTMLButtonElement>("button[data-value]").forEach((button) => {
    button.addEventListener("click", () => handler(button.dataset.value ?? ""));
  });
}

function bindFontDropdown(triggerId: string, menuId: string, handler: (value: string) => void) {
  const trigger = $<HTMLButtonElement>(triggerId);
  const menu = $(menuId);
  trigger.addEventListener("click", () => {
    const open = menu.classList.contains("hidden");
    closeFontDropdowns();
    menu.classList.toggle("hidden", !open);
    trigger.setAttribute("aria-expanded", String(open));
  });
  menu.querySelectorAll<HTMLButtonElement>("button[data-value]").forEach((button) => {
    button.addEventListener("click", () => {
      handler(button.dataset.value ?? "");
      closeFontDropdowns();
    });
  });
}

function bindCustomFontInput(id: string, target: "shell" | "editor") {
  const input = $<HTMLInputElement>(id);
  input.addEventListener("focus", () => setCustomFont(target, input.value, false));
  input.addEventListener("input", () => setCustomFont(target, input.value, false));
  input.addEventListener("blur", () => setCustomFont(target, input.value, true));
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    input.blur();
  });
}

function openSettingsPage() {
  closeMenus();
  $("commandPalette").classList.add("hidden");
  $("settingsPage").classList.remove("hidden");
  $("app").classList.add("settings-open");
  $("settingsButton").classList.add("active");
  renderSettingsMenu();
  void refreshSystemIntegrationStatus();
}

function closeSettingsPage() {
  $("settingsPage").classList.add("hidden");
  $("app").classList.remove("settings-open");
  $("settingsButton").classList.remove("active");
}

function selectSettingsSection(section: SettingsSection) {
  if (!["appearance", "editor", "keybindings", "workspace", "system", "search", "about"].includes(section)) return;
  state.settingsSection = section;
  renderSettingsMenu();
  $("settingsPage").querySelector<HTMLElement>(".settings-content")?.scrollTo({ top: 0 });
  if (section === "keybindings") renderKeybindingSettings();
  if (section === "system") void refreshSystemIntegrationStatus();
}

async function initializeAppUpdate() {
  try {
    appVersion = await getVersion();
    appUpdateDetail = `当前版本 ${appVersion}`;
  } catch (error) {
    appUpdateStatus = "unsupported";
    appUpdateDetail = "当前环境无法读取应用版本";
    log(`读取应用版本失败：${error instanceof Error ? error.message : String(error)}`);
    renderAppUpdateStatus();
    return;
  }

  renderAppUpdateStatus();
  if (import.meta.env.DEV) {
    appUpdateStatus = "unsupported";
    appUpdateDetail = `当前版本 ${appVersion} · 开发模式不检查更新`;
    renderAppUpdateStatus();
    return;
  }

  window.setTimeout(() => void checkForAppUpdate(false), 1800);
}

async function checkForAppUpdate(manual: boolean) {
  if (appUpdateStatus === "checking" || appUpdateStatus === "installing") return;
  appUpdateStatus = "checking";
  appUpdateDetail = manual ? "正在连接 GitHub 检查更新" : `当前版本 ${appVersion} · 正在检查更新`;
  renderAppUpdateStatus();

  try {
    const update = await check({ timeout: 30_000 });
    if (!update) {
      pendingAppUpdate = null;
      appUpdateStatus = "latest";
      appUpdateDetail = `当前版本 ${appVersion} 已是最新版`;
      renderAppUpdateStatus();
      return;
    }

    pendingAppUpdate = update;
    appUpdateStatus = "available";
    appUpdateDetail = `发现新版本 ${update.version}，当前版本 ${update.currentVersion}`;
    renderAppUpdateStatus();

    if (!manual) {
      const confirmed = await askConfirm({
        title: "发现新版本",
        subtitle: `Notra ${update.version} 已发布`,
        body: `当前版本 ${update.currentVersion}，是否现在下载并安装新版本？`,
        okLabel: "下载并安装",
        cancelLabel: "稍后",
      });
      if (confirmed) await installAppUpdate();
    }
  } catch (error) {
    appUpdateStatus = "failed";
    appUpdateDetail = manual ? "检查更新失败，请稍后重试" : `当前版本 ${appVersion} · 自动检查失败`;
    log(`检查更新失败：${error instanceof Error ? error.message : String(error)}`);
    renderAppUpdateStatus();
  }
}

async function installAppUpdate() {
  if (!pendingAppUpdate || appUpdateStatus === "installing") return;
  appUpdateStatus = "installing";
  appUpdateDetail = `正在准备下载 Notra ${pendingAppUpdate.version}`;
  renderAppUpdateStatus();

  let downloadedBytes = 0;
  let totalBytes = 0;
  try {
    await pendingAppUpdate.downloadAndInstall((event) => {
      if (event.event === "Started") {
        totalBytes = event.data.contentLength ?? 0;
        appUpdateDetail = `正在下载 Notra ${pendingAppUpdate?.version ?? "新版本"}`;
      } else if (event.event === "Progress") {
        downloadedBytes += event.data.chunkLength;
        appUpdateDetail = totalBytes > 0
          ? `正在下载 Notra ${pendingAppUpdate?.version ?? "新版本"} · ${Math.min(100, Math.round(downloadedBytes / totalBytes * 100))}%`
          : `正在下载 Notra ${pendingAppUpdate?.version ?? "新版本"}`;
      } else {
        appUpdateDetail = "安装完成，正在重新启动";
      }
      renderAppUpdateStatus();
    });
    await relaunch();
  } catch (error) {
    appUpdateStatus = "failed";
    appUpdateDetail = "下载安装失败，请稍后重试";
    log(`下载安装更新失败：${error instanceof Error ? error.message : String(error)}`);
    renderAppUpdateStatus();
  }
}

function renderAppUpdateStatus() {
  const statusLabels: Record<AppUpdateStatus, string> = {
    idle: "未检查",
    checking: "检查中",
    latest: "已是最新",
    available: "有新版本",
    installing: "安装中",
    failed: "检查失败",
    unsupported: "不可用",
  };
  const statusElement = $("settingsUpdateStatus");
  const checkButton = $<HTMLButtonElement>("settingsCheckUpdateButton");
  const installButton = $<HTMLButtonElement>("settingsInstallUpdateButton");
  $("settingsAppVersion").textContent = appVersion;
  $("settingsProductVersion").textContent = `v${appVersion}`;
  $("settingsUpdateDetail").textContent = appUpdateDetail;
  statusElement.textContent = statusLabels[appUpdateStatus];
  statusElement.classList.toggle("enabled", appUpdateStatus === "latest" || appUpdateStatus === "available");
  statusElement.classList.toggle("unsupported", appUpdateStatus === "unsupported" || appUpdateStatus === "failed");
  checkButton.disabled = appUpdateStatus === "checking" || appUpdateStatus === "installing" || appUpdateStatus === "unsupported";
  checkButton.textContent = appUpdateStatus === "checking" ? "检查中" : "检查更新";
  installButton.classList.toggle("hidden", appUpdateStatus !== "available");
  installButton.disabled = appUpdateStatus !== "available";
}

async function refreshSystemIntegrationStatus() {
  await Promise.all([refreshShellIntegrationStatus(), refreshDefaultAppCandidateStatus()]);
}

async function refreshShellIntegrationStatus() {
  try {
    state.shellIntegration = await invoke<ShellIntegrationStatusDto>("shell_integration_status");
  } catch (error) {
    state.shellIntegration = integrationErrorStatus("以 Notra 打开", "读取右键菜单状态", error);
  } finally {
    state.shellIntegrationLoaded = true;
    renderSettingsMenu();
  }
}

async function refreshDefaultAppCandidateStatus() {
  try {
    state.defaultAppCandidate = await invoke<ShellIntegrationStatusDto>("default_app_candidate_status");
  } catch (error) {
    state.defaultAppCandidate = integrationErrorStatus("Windows 默认应用候选", "读取默认应用候选状态", error);
  } finally {
    state.defaultAppCandidateLoaded = true;
    renderSettingsMenu();
  }
}

async function syncSystemIntegrationPreferences() {
  const [contextMenu, defaultApp] = await Promise.allSettled([
    invoke<ShellIntegrationStatusDto>("set_shell_integration", { enabled: state.contextMenuEnabled }),
    invoke<ShellIntegrationStatusDto>("set_default_app_candidate", { enabled: state.defaultAppCandidateEnabled }),
  ]);
  state.shellIntegration = contextMenu.status === "fulfilled"
    ? contextMenu.value
    : integrationErrorStatus("以 Notra 打开", "同步右键菜单", contextMenu.reason);
  state.defaultAppCandidate = defaultApp.status === "fulfilled"
    ? defaultApp.value
    : integrationErrorStatus("Windows 默认应用候选", "同步默认应用候选", defaultApp.reason);
  state.shellIntegrationLoaded = true;
  state.defaultAppCandidateLoaded = true;
  renderSettingsMenu();
}

async function toggleShellIntegration() {
  if (state.shellIntegrationBusy || !state.shellIntegrationLoaded || !state.shellIntegration.supported) return;
  const enabled = !state.shellIntegration.enabled;
  state.shellIntegrationBusy = true;
  renderSettingsMenu();
  try {
    state.shellIntegration = await invoke<ShellIntegrationStatusDto>("set_shell_integration", { enabled });
    state.contextMenuEnabled = enabled;
    scheduleSessionSave();
    log(enabled ? "已添加“以 Notra 打开”右键菜单" : "已移除“以 Notra 打开”右键菜单");
  } catch (error) {
    state.shellIntegration.detail = integrationErrorMessage(`${enabled ? "添加" : "移除"}右键菜单`, error);
    log(state.shellIntegration.detail);
  } finally {
    state.shellIntegrationBusy = false;
    state.shellIntegrationLoaded = true;
    renderSettingsMenu();
  }
}

async function toggleDefaultAppCandidate() {
  if (
    state.defaultAppCandidateBusy
    || !state.defaultAppCandidateLoaded
    || !state.defaultAppCandidate.supported
  ) return;
  const enabled = !state.defaultAppCandidate.enabled;
  state.defaultAppCandidateBusy = true;
  renderSettingsMenu();
  try {
    state.defaultAppCandidate = await invoke<ShellIntegrationStatusDto>("set_default_app_candidate", { enabled });
    state.defaultAppCandidateEnabled = enabled;
    scheduleSessionSave();
    log(enabled ? "已注册 Notra 默认应用候选" : "已移除 Notra 默认应用候选");
  } catch (error) {
    state.defaultAppCandidate.detail = integrationErrorMessage(
      `${enabled ? "注册" : "移除"}默认应用候选`,
      error,
    );
    log(state.defaultAppCandidate.detail);
  } finally {
    state.defaultAppCandidateBusy = false;
    state.defaultAppCandidateLoaded = true;
    renderSettingsMenu();
  }
}

function integrationErrorStatus(label: string, action: string, error: unknown): ShellIntegrationStatusDto {
  return {
    supported: false,
    enabled: false,
    label,
    detail: integrationErrorMessage(action, error),
  };
}

function integrationErrorMessage(action: string, error: unknown) {
  return `${action}失败：${error instanceof Error ? error.message : String(error)}`;
}

function bindOpenRequestListener() {
  void listen("open-request", () => {
    if (!openRequestsReady) return;
    openRequestTask = openRequestTask
      .then(drainOpenRequests)
      .catch((error) => log(`接收系统打开请求失败：${String(error)}`));
  }).catch((error) => log(`监听系统打开请求失败：${String(error)}`));
}

function setThemeMode(darkMode: boolean) {
  state.darkMode = darkMode;
  document.body.classList.toggle("dark", state.darkMode);
  monaco.editor.setTheme(state.darkMode ? "notra-dark" : "notra-light");
  markdownEditor?.updateAppearance(state.darkMode, state.fontSize, resolveEditorFontStack());
  if (isMarkdownPreviewEnabled()) void renderMarkdownPreview();
  setThemeButton();
  renderSettingsMenu();
  scheduleSessionSave();
}

function setShellFontSize(size: number) {
  state.shellFontSize = Math.min(18, Math.max(12, size));
  applyShellFontSettings();
  renderSettingsMenu();
  scheduleSessionSave();
}

function setFontMode(target: "shell" | "editor", mode: string) {
  if (mode !== "preset" && mode !== "custom") return;
  if (target === "shell") {
    state.shellFontMode = mode;
    applyShellFontSettings();
  } else {
    state.editorFontMode = mode;
    applyEditorSettings();
  }
  renderSettingsMenu();
  scheduleSessionSave();
}

function setFontPreset(target: "shell" | "editor", preset: string) {
  if (target === "shell") {
    if (!isShellFontPreset(preset)) return;
    state.shellFontMode = "preset";
    state.shellFontPreset = preset;
    applyShellFontSettings();
  } else {
    if (!isEditorFontPreset(preset)) return;
    state.editorFontMode = "preset";
    state.editorFontPreset = preset;
    applyEditorSettings();
  }
  renderSettingsMenu();
  scheduleSessionSave();
}

function setCustomFont(target: "shell" | "editor", value: string, commit: boolean) {
  if (target === "shell") {
    state.shellFontMode = "custom";
    state.shellFontCustom = commit ? normalizeFontStack(value, SHELL_FONT_STACKS[DEFAULT_SHELL_FONT_PRESET]) : value;
    applyShellFontSettings();
  } else {
    state.editorFontMode = "custom";
    state.editorFontCustom = commit ? normalizeFontStack(value, EDITOR_FONT_STACKS[DEFAULT_EDITOR_FONT_PRESET]) : value;
    applyEditorSettings();
  }
  renderSettingsMenu();
  scheduleSessionSave();
}

function setWordWrap(enabled: boolean) {
  if (state.wordWrap === enabled) return;
  state.wordWrap = enabled;
  applyEditorSettings();
  renderChrome();
  renderSettingsMenu();
  scheduleSessionSave();
  log(`自动换行 ${state.wordWrap ? "已开启" : "已关闭"}`);
}

function setMinimap(enabled: boolean) {
  if (state.minimap === enabled) return;
  state.minimap = enabled;
  applyEditorSettings();
  renderSettingsMenu();
  scheduleSessionSave();
  log(`缩略图 ${state.minimap ? "已开启" : "已关闭"}`);
}

function setWhitespace(value: RenderWhitespaceMode) {
  if (!["none", "selection", "all"].includes(value) || state.renderWhitespace === value) return;
  state.renderWhitespace = value;
  applyEditorSettings();
  renderSettingsMenu();
  scheduleSessionSave();
  log(`空白符显示：${whitespaceLabel(state.renderWhitespace)}`);
}

function setMarkdownContentWidth(value: string) {
  if (!isMarkdownContentWidth(value) || state.markdownContentWidth === value) return;
  state.markdownContentWidth = value;
  applyMarkdownContentWidth();
  renderSettingsMenu();
  scheduleSessionSave();
}

function setMarkdownEditMode(mode: MarkdownEditMode) {
  if (!isMarkdownEditMode(mode)) return;
  if (state.markdownEditMode === "wysiwyg") {
    syncMarkdownModelFromEditor();
    markdownEditor?.hideFloatTools();
  }
  state.markdownEditMode = mode;
  if (mode !== "wysiwyg") attachEditorModel(activeDocument());
  closeMenus();
  renderMarkdownSurface();
  renderChrome();
  renderSettingsMenu();
  scheduleSessionSave();
  log(`Markdown 模式：${markdownEditModeLabel(mode)}`);
}

function bindWindowControls() {
  const titlebar = $("windowTitlebar");
  titlebar.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || isInteractiveTarget(event.target)) return;
    event.preventDefault();
    if (event.detail >= 2) {
      toggleTitlebarMaximize();
      return;
    }
    void appWindow.startDragging();
  });
  titlebar.addEventListener("dblclick", (event) => {
    if (isInteractiveTarget(event.target)) return;
    event.preventDefault();
    toggleTitlebarMaximize();
  });
  $("windowMinimize").addEventListener("click", () => void appWindow.minimize());
  $("windowMaximize").addEventListener("click", () => void appWindow.toggleMaximize());
  $("windowClose").addEventListener("click", () => void requestWindowClose());
}

function toggleTitlebarMaximize() {
  const now = window.performance.now();
  if (now - titlebarMaximizeToggleAt < 260) return;
  titlebarMaximizeToggleAt = now;
  void appWindow.toggleMaximize();
}

function bindExplorerResize() {
  const handle = $("explorerResize");
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const workspace = $("workspace");
    const workspaceRect = workspace.getBoundingClientRect();
    const railWidth = $("activityRail").getBoundingClientRect().width;
    const resize: HorizontalResizeState = {
      pointerId: event.pointerId,
      frameId: 0,
      latestClientX: event.clientX,
      anchorX: workspaceRect.left + railWidth,
      maxWidth: maxExplorerWidth(workspace.clientWidth, railWidth),
    };
    explorerResizeState = resize;
    freezeEditorLayoutForPaneResize();
    document.body.classList.add("resizing-explorer");
    event.preventDefault();

    const applyResize = (clientX: number) => {
      setExplorerWidth(clientX - resize.anchorX, resize.maxWidth, true);
    };
    const moveResize = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== resize.pointerId) return;
      scheduleHorizontalResize(resize, pointerEvent.clientX, applyResize);
    };
    const stopResize = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== resize.pointerId) return;
      flushHorizontalResize(
        resize,
        pointerEvent.type === "pointerup" ? pointerEvent.clientX : resize.latestClientX,
        applyResize,
      );
      explorerResizeState = null;
      document.body.classList.remove("resizing-explorer");
      window.removeEventListener("pointermove", moveResize);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      applyExplorerWidth(true, resize.maxWidth);
      releaseEditorLayoutAfterPaneResize();
      scheduleSessionSave();
    };
    window.addEventListener("pointermove", moveResize);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  });
  handle.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setExplorerWidth(state.explorerWidth + (event.key === "ArrowLeft" ? -20 : 20));
    scheduleSessionSave();
  });
  handle.addEventListener("dblclick", () => {
    setExplorerWidth(DEFAULT_EXPLORER_WIDTH);
    scheduleSessionSave();
  });
  window.addEventListener("resize", () => applyExplorerWidth());
}

function setExplorerWidth(width: number, maxWidth = maxExplorerWidth(), fast = false) {
  state.explorerWidth = clampExplorerWidth(width, maxWidth);
  applyExplorerWidth(fast, maxWidth);
}

function applyExplorerWidth(fast = false, maxWidth = maxExplorerWidth()) {
  state.explorerWidth = clampExplorerWidth(state.explorerWidth, maxWidth);
  const workspace = $("workspace");
  const handle = $("explorerResize");
  workspace.style.setProperty("--explorer-width", `${state.explorerWidth}px`);
  handle.setAttribute("aria-valuenow", String(state.explorerWidth));
  handle.setAttribute("aria-valuemax", String(maxWidth));
  if (!editorLayoutFrozen) requestEditorLayout(!fast);
}

function clampExplorerWidth(width: number, maxWidth = maxExplorerWidth()) {
  return Math.min(maxWidth, Math.max(MIN_EXPLORER_WIDTH, Math.round(width)));
}

function maxExplorerWidth(workspaceWidth = $("workspace").clientWidth, railWidth = $("activityRail").getBoundingClientRect().width) {
  const available = workspaceWidth - railWidth - MIN_WORKSPACE_EDITOR_WIDTH - EXPLORER_RESIZE_WIDTH;
  return Math.min(MAX_EXPLORER_WIDTH, Math.max(MIN_EXPLORER_WIDTH, Math.floor(available)));
}

function scheduleHorizontalResize(resize: HorizontalResizeState, clientX: number, apply: (clientX: number) => void) {
  resize.latestClientX = clientX;
  if (resize.frameId !== 0) return;
  resize.frameId = window.requestAnimationFrame(() => {
    resize.frameId = 0;
    apply(resize.latestClientX);
  });
}

function flushHorizontalResize(resize: HorizontalResizeState, clientX: number, apply: (clientX: number) => void) {
  if (resize.frameId !== 0) {
    window.cancelAnimationFrame(resize.frameId);
    resize.frameId = 0;
  }
  resize.latestClientX = clientX;
  apply(clientX);
}

function paneResizeActive() {
  return Boolean(explorerResizeState || rightSidebarResizeState || markdownPreviewResizeState);
}

function freezeEditorLayoutForPaneResize() {
  if (editorLayoutFrozen) return;
  const area = $<HTMLElement>("editorArea");
  const editorWrap = area.querySelector<HTMLElement>(".editor-wrap");
  if (!editorWrap) return;
  cancelPendingEditorLayout();
  editorLayoutFrozen = true;
  if (area.classList.contains("preview-open") && !$("markdownPreview").classList.contains("hidden")) {
    const editorWidth = editorWrap.getBoundingClientRect().width;
    const resizeWidth = $("markdownPreviewResize").getBoundingClientRect().width;
    const previewWidth = $("markdownPreview").getBoundingClientRect().width;
    area.style.gridTemplateColumns = `${editorWidth}px ${resizeWidth}px ${previewWidth}px`;
    return;
  }
  area.style.gridTemplateColumns = `${area.getBoundingClientRect().width}px`;
}

function releaseEditorLayoutAfterPaneResize() {
  if (!editorLayoutFrozen) {
    requestEditorLayout();
    return;
  }
  $("editorArea").style.removeProperty("grid-template-columns");
  editorLayoutFrozen = false;
  editorLayoutWidth = -1;
  editorLayoutHeight = -1;
  requestEditorLayout();
}

function cancelPendingEditorLayout() {
  if (editorLayoutFrame !== 0) window.cancelAnimationFrame(editorLayoutFrame);
  if (editorLayoutSettleFrame !== 0) window.cancelAnimationFrame(editorLayoutSettleFrame);
  editorLayoutFrame = 0;
  editorLayoutSettleFrame = 0;
  editorLayoutForceRender = false;
}

function bindRightSidebarResize() {
  const handle = $("rightSidebarResize");
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const resize: HorizontalResizeState = {
      pointerId: event.pointerId,
      frameId: 0,
      latestClientX: event.clientX,
      anchorX: window.innerWidth,
      maxWidth: Math.max(320, Math.floor(window.innerWidth * 0.55)),
    };
    rightSidebarResizeState = resize;
    freezeEditorLayoutForPaneResize();
    document.body.classList.add("resizing-sidebar");
    event.preventDefault();

    const applyResize = (clientX: number) => {
      setRightSidebarWidth(resize.anchorX - clientX, resize.maxWidth, true);
    };
    const moveResize = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== resize.pointerId) return;
      scheduleHorizontalResize(resize, pointerEvent.clientX, applyResize);
    };
    const stopResize = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== resize.pointerId) return;
      flushHorizontalResize(
        resize,
        pointerEvent.type === "pointerup" ? pointerEvent.clientX : resize.latestClientX,
        applyResize,
      );
      rightSidebarResizeState = null;
      document.body.classList.remove("resizing-sidebar");
      window.removeEventListener("pointermove", moveResize);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      positionOpenSearchHistoryMenu();
      releaseEditorLayoutAfterPaneResize();
      scheduleSessionSave();
    };
    window.addEventListener("pointermove", moveResize);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  });
  handle.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setRightSidebarWidth(state.rightSidebarWidth + (event.key === "ArrowLeft" ? 20 : -20));
    scheduleSessionSave();
  });
  $("searchToolPane").addEventListener("scroll", positionOpenSearchHistoryMenu, true);
  window.addEventListener("resize", positionOpenSearchHistoryMenu);
}

function setRightSidebarWidth(
  width: number,
  maxWidth = Math.max(320, Math.floor(window.innerWidth * 0.55)),
  fast = false,
) {
  state.rightSidebarWidth = Math.min(maxWidth, Math.max(320, Math.round(width)));
  $("app").style.setProperty("--right-sidebar-width", `${state.rightSidebarWidth}px`);
  if (!fast) positionOpenSearchHistoryMenu();
  if (!editorLayoutFrozen) requestEditorLayout(!fast);
}

function bindWindowCloseGuard() {
  void appWindow.onCloseRequested(async (event) => {
    if (windowCloseConfirmed) return;
    event.preventDefault();
    const canClose = await confirmCloseAll();
    if (!canClose) return;
    windowCloseConfirmed = true;
    await flushSessionBeforeClose();
    await appWindow.close();
  });
}

async function requestWindowClose() {
  const canClose = await confirmCloseAll();
  if (!canClose) return;
  windowCloseConfirmed = true;
  await flushSessionBeforeClose();
  await appWindow.close();
}

async function flushSessionBeforeClose() {
  window.clearTimeout(sessionTimer);
  try {
    await saveSession();
  } catch (error) {
    log(`保存会话失败：${String(error)}`);
  }
}

async function confirmCloseAll() {
  for (const doc of state.documents) {
    if (!doc.dirty || doc.readOnly) continue;
    const choice = await askUnsavedChoice("退出 Notra", `"${doc.title}" 有未保存修改。`, doc.path || doc.title);
    if (choice === "cancel") return false;
    if (choice === "save") {
      try {
        await saveDocument(doc, false);
      } catch (error) {
        log(`保存取消或失败：${String(error)}`);
        return false;
      }
      if (doc.dirty) return false;
    }
    if (choice === "discard" && !doc.path) {
      doc.skipSessionRestore = true;
    }
  }
  return true;
}

function bindOutsideDismissal() {
  document.addEventListener("pointerdown", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (!target.closest(".current-find-query, .current-find-history-menu")) {
      closeCurrentFindHistory();
    }
    if (!target.closest(".search-history-field, .search-history-menu")) closeSearchHistory();
    if (
      target.closest(".popover, .command-popover, .find-popover, .modal, .font-dropdown") ||
      target.closest("[data-menu-trigger]")
    ) {
      return;
    }
    closeMenus();
    closeFontDropdowns();
    $("commandPalette").classList.add("hidden");
  });
}

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("button, input, select, textarea, a, [role='button']"));
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

function askConfirm(options: ConfirmOptions): Promise<boolean> {
  $("confirmTitle").textContent = options.title;
  $("confirmSubtitle").textContent = options.subtitle;
  $("confirmBody").textContent = options.body;
  $("confirmCancelButton").textContent = options.cancelLabel ?? "取消";
  $("confirmOkButton").textContent = options.okLabel ?? "确认";
  $("confirmOkButton").classList.toggle("danger", !!options.danger);
  $("confirmDialog").classList.remove("hidden");
  $("confirmOkButton").focus();
  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
}

function resolveConfirmDialog(value: boolean) {
  $("confirmDialog").classList.add("hidden");
  confirmResolver?.(value);
  confirmResolver = null;
}

function askTextInput(options: TextInputOptions): Promise<string | null> {
  $("inputTitle").textContent = options.title;
  $("inputSubtitle").textContent = options.subtitle;
  $("inputLabel").textContent = options.label;
  const input = $("inputDialogInput") as HTMLInputElement;
  input.value = options.value ?? "";
  input.inputMode = options.inputMode ?? "text";
  $("inputDialog").classList.remove("hidden");
  input.focus();
  input.select();
  return new Promise((resolve) => {
    textInputResolver = resolve;
  });
}

function resolveTextInputDialog(value?: string | null) {
  const input = $("inputDialogInput") as HTMLInputElement;
  $("inputDialog").classList.add("hidden");
  textInputResolver?.(value === undefined ? input.value.trim() : value);
  textInputResolver = null;
}

async function withBusy<T>(
  message: string,
  task: () => Promise<T>,
  options: { lockEditor?: boolean } = {},
): Promise<T> {
  const lockEditor = options.lockEditor !== false;
  busyDepth += 1;
  if (lockEditor) editorBusyDepth += 1;
  setBusy(message);
  try {
    return await task();
  } finally {
    busyDepth -= 1;
    if (lockEditor) editorBusyDepth -= 1;
    if (busyDepth <= 0) {
      busyDepth = 0;
      editorBusyDepth = 0;
      setBusy("");
    } else {
      setBusy(state.busyMessage);
    }
  }
}

function setBusy(message: string) {
  state.busyMessage = message;
  $("app").classList.toggle("is-busy", Boolean(message));
  if (editor) {
    editor.updateOptions({ readOnly: editorBusyDepth > 0 || activeDocument().readOnly });
  }
  markdownEditor?.setReadOnly(editorBusyDepth > 0 || activeDocument().readOnly);
  renderChrome();
}

function createDocument(
  dto: DocumentDto,
  options: {
    draftId?: string;
    dirty?: boolean;
    savedText?: string;
    origin?: DocumentOrigin;
  } = {},
): OpenDocument {
  const uri = monaco.Uri.parse(`notra://model/${nextId}/${encodeURIComponent(dto.title)}`);
  const model = monaco.editor.createModel(dto.text, dto.language || "plaintext", uri);
  const savedText = options.savedText ?? dto.text;
  const doc: OpenDocument = {
    ...dto,
    id: nextId++,
    draftId: dto.path ? undefined : options.draftId ?? createDraftId(),
    origin: options.origin ?? "standalone",
    model,
    dirty: options.dirty ?? dto.text !== savedText,
    savedText,
    encodingStatus: "编码已识别",
  };
  model.onDidChangeContent(() => {
    doc.dirty = model.getValue() !== doc.savedText;
    doc.text = model.getValue();
    doc.fileSize = new Blob([doc.text]).size;
    state.searchRevision += 1;
    renderChrome();
    renderMarkdownOutline();
    scheduleMarkdownPreviewRender();
    if (doc.id === state.activeId) scheduleMarkdownEditorSync(doc);
    scheduleSessionSave();
  });
  return doc;
}

function activeDocument() {
  return state.documents.find((doc) => doc.id === state.activeId) ?? state.documents[0];
}

function createDraftId() {
  return `${DRAFT_ID_PREFIX}-${Date.now().toString(36)}-${nextId.toString(36)}`;
}

function nextUntitledTitle() {
  const used = new Set(state.documents.map((doc) => doc.title));
  let max = 0;
  for (const title of used) {
    const match = title.match(/^Untitled-(\d+)\.txt$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  let index = max + 1;
  while (used.has(`Untitled-${index}.txt`)) index += 1;
  return `Untitled-${index}.txt`;
}

function activateDocument(id: number) {
  const doc = state.documents.find((item) => item.id === id);
  if (!doc) return;
  const previous = activeDocument();
  if (previous && previous.id !== id) syncActiveBookmarkLines(previous);
  if (previous && previous.id !== id) syncMarkdownModelFromEditor(previous);
  if (previous && previous.id !== id && editor.getModel() === previous.model) {
    previous.viewState = editor.saveViewState() ?? undefined;
  }
  state.activeId = id;
  if (!isMarkdownLikeDocument(doc) || state.markdownEditMode !== "wysiwyg") attachEditorModel(doc);
  renderAll();
  scheduleSessionSave();
}

function activateAdjacentDocument(delta: number) {
  if (state.documents.length <= 1) return;
  const index = Math.max(0, state.documents.findIndex((doc) => doc.id === state.activeId));
  const next = ((index + delta) % state.documents.length + state.documents.length) % state.documents.length;
  activateDocument(state.documents[next].id);
}

function newDocument() {
  const doc = createUntitledDocument();
  state.documents.push(doc);
  activateDocument(doc.id);
  log(`新建 ${doc.title}`);
  scheduleSessionSave();
}

function createUntitledDocument() {
  return createDocument({
    title: nextUntitledTitle(),
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
}

async function openDocument() {
  const path = await invoke<string | null>("pick_file_path", {
    request: { defaultDir: preferredDialogDirectory() },
  });
  if (!path) return;
  await openPath(path, true);
}

async function openPath(path: string, remember = false) {
  const existing = state.documents.find((doc) => doc.path === path);
  if (existing) {
    if (remember) existing.origin = "standalone";
    activateDocument(existing.id);
    if (remember) rememberRecentPath(path);
    return;
  }
  const dto = await withBusy(`打开 ${fileNameFromPath(path)}`, () => invoke<DocumentDto>("open_path", { path }));
  addOrReplaceDocument(dto, remember ? "standalone" : "workspace");
  if (remember) rememberRecentPath(path);
}

function addOrReplaceDocument(dto: DocumentDto, origin: DocumentOrigin) {
  const existing = state.documents.find((doc) => doc.path && doc.path === dto.path);
  if (existing) {
    if (!existing.dirty) {
      existing.model.setValue(dto.text);
      Object.assign(existing, dto, { dirty: false, savedText: dto.text, encodingStatus: "编码已识别" });
    }
    if (origin === "standalone") existing.origin = "standalone";
    activateDocument(existing.id);
    return;
  }
  const doc = createDocument(dto, { origin });
  state.documents.push(doc);
  activateDocument(doc.id);
  log(`打开 ${doc.title}`);
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
  syncMarkdownModelFromEditor(doc);
  if (doc.readOnly) {
    log(`只读文档未保存：${doc.readOnlyReason ?? doc.title}`);
    return false;
  }
  const path = forceSaveAs || !doc.path ? await pickSavePath(doc) : doc.path;
  if (!path) {
    log("已取消保存");
    return false;
  }
  const textToSave = doc.model.getValue();
  const saved = await withBusy(`保存 ${doc.title}`, () =>
    invoke<DocumentDto>("save_document", {
      request: {
        path,
        text: textToSave,
        encoding: doc.encoding,
        lineEnding: doc.lineEnding || "LF",
      },
    }),
    { lockEditor: false },
  );
  const currentText = doc.model.getValue();
  Object.assign(doc, saved, {
    dirty: currentText !== textToSave,
    savedText: textToSave,
    text: currentText,
    fileSize: new Blob([currentText]).size,
    encodingStatus: "编码已识别",
  });
  doc.draftId = undefined;
  monaco.editor.setModelLanguage(doc.model, saved.language || "plaintext");
  renderAll();
  scheduleSessionSave();
  log(`保存 ${doc.title}`);
  return true;
}

async function saveAll() {
  const activeId = state.activeId;
  for (const doc of state.documents) {
    if (!doc.dirty || doc.readOnly) continue;
    const saved = await saveDocument(doc, false);
    if (!saved) break;
  }
  activateDocument(activeId);
}

function setWorkMode(mode: WorkMode) {
  state.mode = mode;
  if (mode === "single") {
    state.showDirectory = false;
  } else if (state.workspace) {
    state.showDirectory = true;
  }
  renderWorkspace();
  renderChrome();
  renderRightSidebar();
  renderSettingsMenu();
  scheduleSessionSave();
}

async function enterWorkspaceMode() {
  if (!state.workspace) {
    await chooseWorkspace();
    return;
  }
  setWorkMode("workspace");
}

async function toggleExplorer() {
  if (!state.workspace) {
    await chooseWorkspace();
    return;
  }
  state.mode = "workspace";
  state.showDirectory = !state.showDirectory;
  renderWorkspace();
  renderChrome();
  renderRightSidebar();
  scheduleSessionSave();
  if (state.showDirectory) focusExplorer();
}

function focusExplorer() {
  if (!state.workspace) return;
  state.mode = "workspace";
  state.showDirectory = true;
  renderWorkspace();
  renderChrome();
  const target = $("tree").querySelector<HTMLButtonElement>(".tree-item.active, .tree-item");
  (target ?? $<HTMLButtonElement>("directoryToggle")).focus();
  scheduleSessionSave();
}

async function chooseWorkspace() {
  const path = await invoke<string | null>("pick_workspace_path", {
    request: { defaultDir: preferredWorkspaceDialogDirectory() },
  });
  if (!path) return;
  await openWorkspacePath(path);
}

async function openWorkspacePath(path: string) {
  const workspace = await withBusy(`读取目录 ${fileNameFromPath(path)}`, () =>
    invoke<WorkspaceDto>("read_workspace", { path }),
  );
  state.workspace = workspace;
  state.mode = "workspace";
  state.showDirectory = true;
  state.collapsedDirs = new Set(
    workspace.items.filter((item) => item.isDir).map((item) => item.path),
  );
  ($("directoryInput") as HTMLInputElement).value = workspace.root;
  renderWorkspace();
  renderChrome();
  renderRightSidebar();
  renderSettingsMenu();
  rememberRecentWorkspace(workspace.root);
  scheduleSessionSave();
  log(`工作目录 ${workspace.name}`);
}

async function closeWorkspace() {
  if (!state.workspace) return;
  const workspaceDocuments = state.documents.filter((doc) => doc.origin === "workspace");
  for (const doc of workspaceDocuments) {
    if (!(await confirmDocumentCanClose(doc, "关闭工作区"))) return;
  }

  const name = state.workspace.name;
  const active = activeDocument();
  if (active) active.viewState = editor.saveViewState() ?? undefined;
  const workspaceDocumentIds = new Set(workspaceDocuments.map((doc) => doc.id));
  workspaceDocuments.forEach((doc) => disposeMarkdownEditor(doc.id));
  state.documents = state.documents.filter((doc) => !workspaceDocumentIds.has(doc.id));
  workspaceDocuments.forEach((doc) => doc.model.dispose());
  if (state.documents.length === 0) state.documents.push(createUntitledDocument());
  if (!state.documents.some((doc) => doc.id === state.activeId)) {
    state.activeId = state.documents[0].id;
  }

  state.workspace = null;
  state.mode = "single";
  state.showDirectory = false;
  state.collapsedDirs.clear();
  ($("directoryInput") as HTMLInputElement).value = "";
  state.replacePreview = null;
  state.replacePreviewApplied = false;
  resetSearchResults();
  if (isWorkspaceFindView()) setFindView("find", false);
  if (state.rightTool === "search" && !$("findPopover").classList.contains("hidden")) closeRightSidebar();
  attachEditorModel(activeDocument());
  renderAll();
  renderSettingsMenu();
  scheduleSessionSave();
  log(`已关闭工作区 ${name}`);
}

async function refreshWorkspace() {
  if (!state.workspace) return;
  const workspace = await withBusy("刷新目录中", () =>
    invoke<WorkspaceDto>("read_workspace", { path: state.workspace!.root }),
  );
  state.workspace = workspace;
  state.mode = "workspace";
  state.showDirectory = true;
  renderWorkspace();
  renderChrome();
  scheduleSessionSave();
  log(`目录已刷新 ${workspace.name}`);
}

async function closeDocument(id: number): Promise<boolean> {
  const index = state.documents.findIndex((doc) => doc.id === id);
  if (index < 0) return false;
  const doc = state.documents[index];
  if (!(await confirmDocumentCanClose(doc, "关闭文档"))) return false;
  rememberClosedDocument(doc);
  disposeMarkdownEditor(doc.id);
  state.documents.splice(index, 1);
  doc.model.dispose();
  if (state.documents.length === 0) state.documents.push(createUntitledDocument());
  activateDocument(state.documents[Math.max(0, index - 1)].id);
  scheduleSessionSave();
  return true;
}

function rememberClosedDocument(doc: OpenDocument) {
  closedDocuments.unshift({
    title: doc.title,
    path: doc.path,
    text: doc.model.getValue(),
    encoding: doc.encoding,
    lineEnding: doc.lineEnding,
    fileSize: doc.fileSize,
    readOnly: doc.readOnly,
    readOnlyReason: doc.readOnlyReason,
    language: doc.language,
    largeFile: doc.largeFile,
    draftId: doc.draftId,
    dirty: doc.dirty,
    savedText: doc.savedText,
    origin: doc.origin,
    viewState: doc.viewState,
  });
  if (closedDocuments.length > 20) closedDocuments.length = 20;
}

async function reopenClosedDocument() {
  const snapshot = closedDocuments.shift();
  if (!snapshot) {
    log("没有可重新打开的标签");
    return;
  }
  if (snapshot.path) {
    const existing = state.documents.find((doc) => doc.path === snapshot.path);
    if (existing) {
      activateDocument(existing.id);
      return;
    }
  }
  const doc = createDocument(snapshot, {
    draftId: snapshot.draftId,
    dirty: snapshot.dirty,
    savedText: snapshot.savedText,
    origin: snapshot.origin,
  });
  doc.viewState = snapshot.viewState;
  state.documents.push(doc);
  activateDocument(doc.id);
  log(`重新打开 ${doc.title}`);
}

async function confirmDocumentCanClose(doc: OpenDocument, title: string) {
  if (!doc.dirty || doc.readOnly) return true;
  const choice = await askUnsavedChoice(title, `"${doc.title}" 有未保存修改。`, doc.path || doc.title);
  if (choice === "cancel") return false;
  if (choice !== "save") return true;
  try {
    await saveDocument(doc, false);
  } catch (error) {
    log(`保存取消或失败：${String(error)}`);
    return false;
  }
  return !doc.dirty;
}

function openTabMenu(id: number, event: MouseEvent) {
  event.preventDefault();
  tabMenuDocumentId = id;
  closeMenus();
  const menu = $("tabMenu");
  updateTabMenuState();
  showContextMenu(menu, event, 264, 330);
}

function tabMenuDocument() {
  return state.documents.find((doc) => doc.id === tabMenuDocumentId) ?? null;
}

function updateTabMenuState() {
  const doc = tabMenuDocument();
  const index = doc ? state.documents.findIndex((item) => item.id === doc.id) : -1;
  const savedClosableCount = state.documents.filter((item) => !item.dirty).length;
  $<HTMLButtonElement>("tabSaveButton").disabled = !doc || doc.readOnly || (!doc.dirty && Boolean(doc.path));
  $<HTMLButtonElement>("tabSaveAsButton").disabled = !doc || doc.readOnly;
  $<HTMLButtonElement>("tabCopyPathButton").disabled = !doc?.path;
  $<HTMLButtonElement>("tabRevealButton").disabled = !doc?.path;
  $<HTMLButtonElement>("tabCloseButton").disabled = !doc || state.documents.length <= 1;
  $<HTMLButtonElement>("tabCloseOthersButton").disabled = !doc || state.documents.length <= 1;
  $<HTMLButtonElement>("tabCloseRightButton").disabled = !doc || index < 0 || index >= state.documents.length - 1;
  $<HTMLButtonElement>("tabCloseSavedButton").disabled = savedClosableCount === 0 || state.documents.length <= 1;
}

function showContextMenu(menu: HTMLElement, event: MouseEvent, fallbackWidth: number, fallbackHeight: number) {
  menu.style.right = "auto";
  menu.style.left = "0px";
  menu.style.top = "0px";
  menu.classList.remove("hidden");
  const width = menu.offsetWidth || fallbackWidth;
  const height = menu.offsetHeight || fallbackHeight;
  const maxLeft = Math.max(8, window.innerWidth - width - 8);
  const maxTop = Math.max(48, window.innerHeight - height - 8);
  menu.style.left = `${Math.min(Math.max(8, event.clientX), maxLeft)}px`;
  menu.style.top = `${Math.min(Math.max(48, event.clientY), maxTop)}px`;
  contextMenuButtons(menu)[0]?.focus();
}

function activeContextMenu() {
  return [
    $("tabMenu"),
    $("treeMenu"),
    $("markdownContextMenu"),
    $("markdownTableContextMenu"),
    $("fileMenu"),
    $("editMenu"),
    $("searchMenu"),
    $("viewMenu"),
  ].find(
    (menu) => !menu.classList.contains("hidden"),
  ) ?? null;
}

function contextMenuButtons(menu: HTMLElement) {
  const focusedSubmenu = document.activeElement instanceof Element
    ? document.activeElement.closest<HTMLElement>(".markdown-context-submenu")
    : null;
  const scopeSubmenu = menu.classList.contains("markdown-context-submenu")
    ? menu
    : focusedSubmenu && menu.contains(focusedSubmenu)
      ? focusedSubmenu
      : null;
  return Array.from(menu.querySelectorAll<HTMLButtonElement>(
    ".menu-row:not(:disabled), .markdown-context-control:not(:disabled)",
  )).filter((button) => {
    if (button.offsetParent === null) return false;
    const ownerSubmenu = button.closest<HTMLElement>(".markdown-context-submenu");
    return scopeSubmenu ? ownerSubmenu === scopeSubmenu : !ownerSubmenu;
  });
}

function moveContextMenuFocus(menu: HTMLElement, delta: number) {
  const buttons = contextMenuButtons(menu);
  if (buttons.length === 0) return;
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = current < 0 ? 0 : (current + delta + buttons.length) % buttons.length;
  buttons[next].focus();
}

function handleContextMenuKeydown(event: KeyboardEvent) {
  const menu = activeContextMenu();
  if (!menu) return false;
  if (event.key === "Escape") {
    event.preventDefault();
    const submenu = document.activeElement instanceof Element
      ? document.activeElement.closest<HTMLElement>(".markdown-context-submenu")
      : null;
    if (menu.id === "markdownContextMenu" && submenu) {
      closeMarkdownSubmenus();
      menu.querySelectorAll<HTMLButtonElement>("[data-markdown-submenu]").forEach((trigger) => {
        if (trigger.dataset.markdownSubmenu === submenu.id) trigger.focus();
      });
      return true;
    }
    const trigger = menu.classList.contains("app-menu")
      ? $<HTMLButtonElement>(`${menu.id.replace("Menu", "MenuButton")}`)
      : null;
    closeMenus();
    trigger?.focus();
    return true;
  }
  if (menu.id === "markdownContextMenu" && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
    const button = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
    const submenu = button?.closest<HTMLElement>(".markdown-context-submenu");
    if (event.key === "ArrowRight" && button?.dataset.markdownSubmenu) {
      event.preventDefault();
      openMarkdownSubmenu(button, true);
      return true;
    }
    if (event.key === "ArrowLeft" && submenu) {
      event.preventDefault();
      closeMarkdownSubmenus();
      menu.querySelectorAll<HTMLButtonElement>("[data-markdown-submenu]").forEach((trigger) => {
        if (trigger.dataset.markdownSubmenu === submenu.id) trigger.focus();
      });
      return true;
    }
  }
  if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && menu.classList.contains("app-menu")) {
    event.preventDefault();
    const menuIds = ["fileMenu", "editMenu", "searchMenu", "viewMenu"] as const;
    const current = menuIds.indexOf(menu.id as (typeof menuIds)[number]);
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const next = (current + delta + menuIds.length) % menuIds.length;
    const trigger = $<HTMLButtonElement>(`${menuIds[next]}Button`);
    openAppMenu(menuIds[next], trigger);
    return true;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    moveContextMenuFocus(menu, event.key === "ArrowDown" ? 1 : -1);
    return true;
  }
  if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    const buttons = contextMenuButtons(menu);
    buttons[event.key === "Home" ? 0 : buttons.length - 1]?.focus();
    return true;
  }
  if (event.key === "Enter" || event.key === " ") {
    const button = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
    if (button?.closest(".tab-menu, .tree-menu, .app-menu, .markdown-context-menu")) {
      event.preventDefault();
      button.click();
      return true;
    }
  }
  return false;
}

async function saveTabFromMenu(forceSaveAs: boolean) {
  const doc = tabMenuDocument();
  closeMenus();
  if (!doc) return;
  await saveDocument(doc, forceSaveAs);
}

async function copyTabPath() {
  const doc = tabMenuDocument();
  closeMenus();
  if (!doc?.path) return;
  try {
    await navigator.clipboard.writeText(doc.path);
    log(`已复制路径 ${doc.path}`);
  } catch (error) {
    log(`复制路径失败：${String(error)}`);
  }
}

async function revealTabPath() {
  const doc = tabMenuDocument();
  closeMenus();
  if (!doc?.path) return;
  await revealPathInExplorer(doc.path);
}

async function closeTabFromMenu() {
  const id = tabMenuDocumentId;
  closeMenus();
  await closeDocument(id);
}

async function closeOtherTabsFromMenu() {
  const targetId = tabMenuDocumentId || state.activeId;
  closeMenus();
  await closeOtherTabsFor(targetId);
}

async function closeOtherTabsFor(targetId: number) {
  if (state.documents.some((doc) => doc.id === targetId)) activateDocument(targetId);
  const ids = state.documents.filter((doc) => doc.id !== targetId).map((doc) => doc.id);
  for (const id of ids) {
    if (!(await closeDocument(id))) break;
  }
  if (state.documents.some((doc) => doc.id === targetId)) activateDocument(targetId);
}

async function closeTabsToRightFromMenu() {
  const targetId = tabMenuDocumentId || state.activeId;
  closeMenus();
  await closeTabsToRightFor(targetId);
}

async function closeTabsToRightFor(targetId: number) {
  const targetIndex = state.documents.findIndex((doc) => doc.id === targetId);
  if (targetIndex < 0) return;
  const ids = state.documents.slice(targetIndex + 1).map((doc) => doc.id);
  for (const id of ids) {
    if (!(await closeDocument(id))) break;
  }
  if (state.documents.some((doc) => doc.id === targetId)) activateDocument(targetId);
}

async function closeSavedTabs() {
  closeMenus();
  const ids = state.documents.filter((doc) => !doc.dirty).map((doc) => doc.id);
  let closed = 0;
  for (const id of ids) {
    if (state.documents.length === 1) break;
    if (await closeDocument(id)) closed += 1;
  }
  log(closed > 0 ? `已关闭 ${closed} 个已保存标签` : "没有可关闭的已保存标签");
}

function openTreeMenu(event: Event) {
  const pointerEvent = event as MouseEvent;
  if (!state.workspace) return;
  pointerEvent.preventDefault();
  const target = pointerEvent.target instanceof Element ? pointerEvent.target : null;
  const row = target?.closest<HTMLButtonElement>(".tree-item");
  if (row?.dataset.path) {
    treeMenuTarget = treeContextTargetFromRow(row);
  } else {
    treeMenuTarget = {
      path: state.workspace.root,
      name: state.workspace.name,
      isDir: true,
      isRoot: true,
    };
  }
  closeMenus();
  closeFontDropdowns();
  const menu = $("treeMenu");
  updateTreeMenuState();
  showContextMenu(menu, pointerEvent, 268, 300);
}

function treeContextTargetFromRow(row: HTMLButtonElement): TreeContextTarget {
  const path = row.dataset.path ?? "";
  return {
    path,
    name: row.querySelector<HTMLElement>(".tree-name")?.textContent || fileNameFromPath(path),
    isDir: row.classList.contains("dir"),
    isRoot: false,
  };
}

async function handleTreeItemKeydown(button: HTMLButtonElement, event: KeyboardEvent) {
  if (event.key !== "F2" && event.key !== "Delete") return;
  event.preventDefault();
  event.stopPropagation();
  treeMenuTarget = treeContextTargetFromRow(button);
  if (event.key === "F2") {
    await renameTreeEntry();
  } else {
    await deleteTreeEntry();
  }
}

function updateTreeMenuState() {
  const target = treeMenuTarget;
  const open = $<HTMLButtonElement>("treeOpenButton");
  const rename = $<HTMLButtonElement>("treeRenameButton");
  const remove = $<HTMLButtonElement>("treeDeleteButton");
  const openLabel = open.querySelector("strong");
  if (openLabel) openLabel.textContent = target?.isDir ? "展开/收起" : "打开";
  open.disabled = !target || target.isRoot;
  rename.disabled = !target || target.isRoot;
  remove.disabled = !target || target.isRoot;
}

async function openTreeTarget() {
  const target = treeMenuTarget;
  closeMenus();
  if (!target || target.isRoot) return;
  if (target.isDir) {
    toggleDirectoryCollapse(target.path);
    return;
  }
  await openPath(target.path);
}

async function createTreeEntry(isDir: boolean) {
  const target = treeMenuTarget;
  closeMenus();
  if (!state.workspace || !target) return;
  const parent = target.isDir ? target.path : pathDirectory(target.path);
  const name = await askTextInput({
    title: isDir ? "新建文件夹" : "新建文件",
    subtitle: fileNameFromPath(parent),
    label: isDir ? "文件夹名称" : "文件名称",
    value: isDir ? "新建文件夹" : "新建文件.txt",
  });
  if (!name) return;
  const result = await withBusy(isDir ? "新建文件夹" : "新建文件", () =>
    invoke<WorkspaceMutationDto>("create_workspace_entry", {
      request: {
        root: state.workspace!.root,
        parent,
        name,
        isDir,
      },
    }),
  );
  state.collapsedDirs.delete(parent);
  applyWorkspaceMutation(result);
  if (!isDir && result.path) {
    await openPath(result.path);
  }
  log(`${isDir ? "新建文件夹" : "新建文件"} ${name}`);
}

async function renameTreeEntry() {
  const target = treeMenuTarget;
  closeMenus();
  if (!state.workspace || !target || target.isRoot) return;
  beginInlineTreeRename(target);
}

function beginInlineTreeRename(target: TreeContextTarget) {
  const row = Array.from($("tree").querySelectorAll<HTMLButtonElement>(".tree-item")).find(
    (item) => item.dataset.path === target.path,
  );
  if (!row) return;

  const renameRow = document.createElement("div");
  renameRow.className = `${row.className} renaming`;
  renameRow.style.cssText = row.style.cssText;
  renameRow.dataset.path = target.path;
  renameRow.innerHTML = row.innerHTML;

  const name = renameRow.querySelector<HTMLElement>(".tree-name");
  const input = document.createElement("input");
  input.className = "tree-rename-input";
  input.value = target.name;
  input.size = Math.max(8, Math.min(40, target.name.length + 2));
  input.setAttribute("aria-label", `重命名 ${target.name}`);
  input.spellcheck = false;
  name?.replaceWith(input);
  row.replaceWith(renameRow);

  let settled = false;
  const finish = (commit: boolean) => {
    if (settled) return;
    settled = true;
    if (!commit) {
      renderWorkspace();
      return;
    }
    void commitInlineTreeRename(target, input.value.trim());
  };

  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
  input.focus();
  const extensionIndex = target.isDir ? -1 : target.name.lastIndexOf(".");
  input.setSelectionRange(0, extensionIndex > 0 ? extensionIndex : target.name.length);
}

async function commitInlineTreeRename(target: TreeContextTarget, name: string) {
  if (!state.workspace || !name || name === target.name) {
    renderWorkspace();
    return;
  }
  try {
    const result = await withBusy("重命名", () =>
      invoke<WorkspaceMutationDto>("rename_workspace_entry", {
        request: {
          root: state.workspace!.root,
          path: target.path,
          name,
        },
      }),
    );
    if (result.path) {
      updateOpenDocumentsForRename(target.path, result.path, target.isDir);
      updateCollapsedDirsForRename(target.path, result.path);
    }
    applyWorkspaceMutation(result);
    log(`重命名为 ${name}`);
  } catch (error) {
    renderWorkspace();
    log(`重命名失败：${String(error)}`);
  }
}

async function deleteTreeEntry() {
  const target = treeMenuTarget;
  closeMenus();
  if (!state.workspace || !target || target.isRoot) return;
  if (!(await confirmDirtyDocumentsForTreeDelete(target))) return;
  const confirmed = await askConfirm({
    title: target.isDir ? "删除文件夹" : "删除文件",
    subtitle: "此操作不可撤销",
    body: target.isDir
      ? `将删除文件夹及其中所有内容：\n${target.path}`
      : `将删除文件：\n${target.path}`,
    okLabel: "删除",
    danger: true,
  });
  if (!confirmed) return;
  const result = await withBusy("删除中", () =>
    invoke<WorkspaceMutationDto>("delete_workspace_entry", {
      request: {
        root: state.workspace!.root,
        path: target.path,
      },
    }),
  );
  removeOpenDocumentsForDeletedPath(target.path, target.isDir);
  removeCollapsedDirsForDeletedPath(target.path);
  applyWorkspaceMutation(result);
  log(`已删除 ${target.name}`);
}

async function copyTreePath() {
  const target = treeMenuTarget;
  closeMenus();
  if (!target) return;
  try {
    await navigator.clipboard.writeText(target.path);
    log(`已复制路径 ${target.path}`);
  } catch (error) {
    log(`复制路径失败：${String(error)}`);
  }
}

async function revealTreeEntry() {
  const target = treeMenuTarget;
  closeMenus();
  if (!state.workspace || !target) return;
  await revealPathInExplorer(target.path, state.workspace.root);
}

async function revealPathInExplorer(path: string, root = pathDirectory(path)) {
  await invoke("reveal_workspace_entry", {
    request: {
      root,
      path,
    },
  });
}

async function refreshWorkspaceFromTreeMenu() {
  closeMenus();
  await refreshWorkspace();
}

function applyWorkspaceMutation(result: WorkspaceMutationDto) {
  state.workspace = result.workspace;
  state.mode = "workspace";
  state.showDirectory = true;
  renderAll();
  scheduleSessionSave();
}

async function confirmDirtyDocumentsForTreeDelete(target: TreeContextTarget) {
  const affected = state.documents.filter((doc) => doc.path && pathMatchesTarget(doc.path, target.path, target.isDir));
  for (const doc of affected.filter((item) => item.dirty && !item.readOnly)) {
    const choice = await askUnsavedChoice("删除前保存", `"${doc.title}" 有未保存修改。`, doc.path || doc.title);
    if (choice === "cancel") return false;
    if (choice === "save") {
      const saved = await saveDocument(doc, false);
      if (!saved || doc.dirty) return false;
    }
  }
  return true;
}

function updateOpenDocumentsForRename(oldPath: string, newPath: string, isDir: boolean) {
  for (const doc of state.documents) {
    if (!doc.path || !pathMatchesTarget(doc.path, oldPath, isDir)) continue;
    const nextPath = isDir ? replacePathPrefix(doc.path, oldPath, newPath) : newPath;
    doc.path = nextPath;
    if (!isDir) {
      doc.title = fileNameFromPath(nextPath);
      const language = languageFromFilePath(nextPath);
      doc.language = language;
      monaco.editor.setModelLanguage(doc.model, language);
    }
  }
}

function removeOpenDocumentsForDeletedPath(path: string, isDir: boolean) {
  const removedActive = state.documents.some((doc) => doc.id === state.activeId && doc.path && pathMatchesTarget(doc.path, path, isDir));
  const remaining = state.documents.filter((doc) => {
    const remove = doc.path && pathMatchesTarget(doc.path, path, isDir);
    if (remove) {
      disposeMarkdownEditor(doc.id);
      doc.model.dispose();
    }
    return !remove;
  });
  state.documents = remaining;
  if (state.documents.length === 0) {
    const doc = createDocument({
      title: nextUntitledTitle(),
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
    state.activeId = doc.id;
  } else if (removedActive || !state.documents.some((doc) => doc.id === state.activeId)) {
    state.activeId = state.documents[0].id;
  }
  editor.setModel(activeDocument().model);
}

function updateCollapsedDirsForRename(oldPath: string, newPath: string) {
  state.collapsedDirs = new Set(
    [...state.collapsedDirs].map((path) =>
      pathMatchesTarget(path, oldPath, true) ? replacePathPrefix(path, oldPath, newPath) : path,
    ),
  );
}

function removeCollapsedDirsForDeletedPath(path: string) {
  state.collapsedDirs = new Set([...state.collapsedDirs].filter((item) => !pathMatchesTarget(item, path, true)));
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
    if (doc.dirty && !(await askConfirm({
      title: "重新解释编码",
      subtitle: "当前文档有未保存修改",
      body: "重新解释编码会从磁盘重新读取文件，当前未保存内容可能被覆盖。",
      okLabel: "重新读取",
      cancelLabel: "取消",
      danger: true,
    }))) {
      return;
    }
    const reopened = await withBusy(`使用 ${encoding} 重新读取`, () =>
      invoke<DocumentDto>("reopen_path_with_encoding", {
        request: { path: doc.path, encoding },
      }),
    );
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

function findCurrent(showPanel = false, recordHistory = true) {
  const query = ($("findInput") as HTMLInputElement).value;
  if (!query) {
    log("查找内容不能为空");
    return;
  }
  const patternError = currentSearchPatternError(query);
  setCurrentFindError(patternError);
  if (patternError) {
    resetSearchResults(true);
    setCurrentFindError(patternError);
    log(patternError);
    return;
  }
  if (recordHistory) commitSearchHistory();
  const doc = activeDocument();
  const activeMarkdownEditor = isMarkdownWysiwygActive(doc) ? markdownEditor : null;
  let matches: TextMatchDto[] = [];
  let total = 0;
  let activeIndex = -1;
  if (activeMarkdownEditor) {
    let result = activeMarkdownEditor.search(editorSearchQuery(query), markdownSearchOptions());
    total = result.total;
    activeIndex = initialSearchResultIndex(total);
    if (activeIndex >= 0 && activeIndex !== result.index) {
      result = activeMarkdownEditor.search(editorSearchQuery(query), {
        ...markdownSearchOptions(),
        highlightIndex: activeIndex,
      });
      activeIndex = result.index;
    }
    matches = showPanel ? markdownMatchesToDto(activeMarkdownEditor.searchMatches()) : [];
  } else {
    matches = modelMatches(doc);
    total = matches.length;
    activeIndex = initialSearchResultIndex(total);
  }
  setSearchResults({
    total,
    skipped: [],
    hits: [
      {
        path: doc.path || doc.title,
        fileName: doc.title,
        encoding: doc.encoding,
        matches,
      },
    ],
  }, "current", activeIndex, showPanel);
  if (!activeMarkdownEditor && matches.length > 0) {
    void openSearchResult(activeIndex);
  }
  log(`当前文件查找 ${total} 个命中`);
}

function findOpenDocuments() {
  const query = ($("findInput") as HTMLInputElement).value;
  if (!query) {
    log("查找内容不能为空");
    return;
  }
  commitSearchHistory();
  const hits = state.documents
    .map((doc) => ({
      path: doc.path || doc.title,
      fileName: doc.title,
      encoding: doc.encoding,
      matches: modelMatches(doc),
    }))
    .filter((hit) => hit.matches.length > 0);
  const report = {
    hits,
    skipped: [],
    total: hits.reduce((sum, hit) => sum + hit.matches.length, 0),
  };
  setSearchResults(report, "open");
  if (report.total > 0) void openSearchResult(0);
  log(`打开文档查找 ${report.total} 个命中`);
}

function setSearchResults(
  report: SearchReportDto,
  scope: SearchScope,
  activeIndex = report.total > 0 ? 0 : -1,
  showPanel = false,
) {
  state.results = report;
  state.searchScope = scope;
  state.searchQuery = ($("findInput") as HTMLInputElement).value;
  state.searchSignature = currentSearchSignature(scope);
  state.activeResultIndex = activeIndex;
  state.panel = "results";
  if (scope === "workspace" || showPanel) {
    state.workspaceSearchVisibleResults = 400;
    state.rightTool = "search";
    $("findPopover").classList.remove("hidden");
    $("app").classList.add("right-sidebar-open");
    setRightSidebarWidth(state.rightSidebarWidth);
    renderRightSidebar();
    renderRightSidebarToggle();
    scheduleSessionSave();
  }
  renderSearchSidebarResults();
  renderCurrentFindCount();
  renderSearchDecorations();
}

function flattenSearchResults() {
  const items: Array<{ path: string; fileName: string; match: TextMatchDto }> = [];
  if (!state.results) return items;
  for (const hit of state.results.hits) {
    for (const match of hit.matches) {
      items.push({ path: hit.path, fileName: hit.fileName, match });
    }
  }
  return items;
}

function currentSearchSignature(scope = state.searchScope ?? "current") {
  const bits = [
    scope,
    ($("findInput") as HTMLInputElement).value,
    getSearchMode(),
    String(($("matchCaseInput") as HTMLInputElement).checked),
    String(($("wholeWordInput") as HTMLInputElement).checked),
    String(($("reverseSearchInput") as HTMLInputElement).checked),
    String(($("wrapSearchInput") as HTMLInputElement).checked),
    String(($("searchSelectionInput") as HTMLInputElement).checked),
    selectionSignature(),
    String(state.searchRevision),
  ];
  if (scope === "current") {
    const doc = activeDocument();
    bits.push(doc.path || doc.title);
  }
  if (scope === "open") {
    bits.push(state.documents.map((doc) => `${doc.id}:${doc.path || doc.title}:${doc.model.getVersionId()}`).join("|"));
  }
  if (scope === "workspace") {
    bits.push(
      ($("directoryInput") as HTMLInputElement).value || state.workspace?.root || "",
      ($("fileGlobInput") as HTMLInputElement).value || "*.*",
      ($("skipDirsInput") as HTMLInputElement).value || DEFAULT_SKIP_DIRS,
      String(($("recursiveInput") as HTMLInputElement).checked),
      String(($("includeHiddenInput") as HTMLInputElement).checked),
    );
  }
  return bits.join("|::|");
}

async function findNextResult() {
  const query = ($("findInput") as HTMLInputElement).value;
  if (!query) {
    log("查找内容不能为空");
    return;
  }
  if (
    !state.results ||
    state.results.total === 0 ||
    state.searchQuery !== query ||
    state.searchSignature !== currentSearchSignature(state.searchScope ?? "current")
  ) {
    await rerunSearchForNavigation();
    return;
  }
  if (isMarkdownWysiwygActive() && markdownEditor && state.searchScope === "current") {
    navigateMarkdownSearch(searchDirection());
  } else {
    await navigateSearchResult(searchDirection());
  }
}

async function findPreviousResult() {
  const query = ($("findInput") as HTMLInputElement).value;
  if (!query) {
    log("查找内容不能为空");
    return;
  }
  if (
    !state.results ||
    state.results.total === 0 ||
    state.searchQuery !== query ||
    state.searchSignature !== currentSearchSignature(state.searchScope ?? "current")
  ) {
    await rerunSearchForNavigation();
    return;
  }
  if (isMarkdownWysiwygActive() && markdownEditor && state.searchScope === "current") {
    navigateMarkdownSearch(-searchDirection());
  } else {
    await navigateSearchResult(-searchDirection());
  }
}

function navigateMarkdownSearch(delta: number) {
  if (!markdownEditor) return;
  const total = state.results?.total ?? 0;
  const nextIndex = state.activeResultIndex + delta;
  if (!$("wrapSearchInput").matches(":checked") && (nextIndex < 0 || nextIndex >= total)) {
    log(delta > 0 ? "已经到最后一个命中" : "已经到第一个命中");
    return;
  }
  const result = markdownEditor.find(delta > 0 ? "next" : "previous");
  state.activeResultIndex = result.index;
  renderCurrentFindCount();
  renderSearchSidebarResults();
}

async function rerunSearchForNavigation() {
  if (state.searchScope === "open") {
    findOpenDocuments();
    return;
  }
  findCurrent(false);
}

async function navigateSearchResult(delta: number) {
  const items = flattenSearchResults();
  if (items.length === 0) return;
  const nextIndex = state.activeResultIndex + delta;
  if (!($("wrapSearchInput") as HTMLInputElement).checked && (nextIndex < 0 || nextIndex >= items.length)) {
    log(delta > 0 ? "已经到最后一个命中" : "已经到第一个命中");
    return;
  }
  await openSearchResult(nextIndex);
}

async function openSearchResult(index: number) {
  const items = flattenSearchResults();
  if (items.length === 0) return;
  const normalized = ($("wrapSearchInput") as HTMLInputElement).checked
    ? ((index % items.length) + items.length) % items.length
    : Math.min(items.length - 1, Math.max(0, index));
  const item = items[normalized];
  state.activeResultIndex = normalized;
  renderSearchSidebarResults();
  renderCurrentFindCount();
  if (state.searchScope === "current" && isMarkdownWysiwygActive() && markdownEditor) {
    markdownEditor.search(editorSearchQuery(state.searchQuery), {
      ...markdownSearchOptions(),
      highlightIndex: normalized,
    });
    scrollActiveResultIntoView();
    return;
  }
  await openResult(item.path, item.match.line, item.match.column);
  renderSearchDecorations();
  scrollActiveResultIntoView();
}

function initialSearchResultIndex(total: number) {
  if (total <= 0) return -1;
  return ($("reverseSearchInput") as HTMLInputElement).checked ? total - 1 : 0;
}

function searchDirection() {
  return ($("reverseSearchInput") as HTMLInputElement).checked ? -1 : 1;
}

function scrollActiveResultIntoView() {
  $("findResultsBody")
    .querySelector<HTMLElement>(`[data-result-index="${state.activeResultIndex}"]`)
    ?.scrollIntoView({ block: "nearest" });
}

function clearSearchResults() {
  resetSearchResults();
  log("已清除查找结果");
}

function resetSearchResults(preserveMarkdownSelection = false) {
  state.results = null;
  state.searchScope = null;
  state.searchQuery = "";
  state.searchSignature = "";
  state.activeResultIndex = -1;
  searchDecorations?.clear();
  activeSearchDecoration?.clear();
  markdownEditor?.clearSearch(preserveMarkdownSelection);
  setCurrentFindError("");
  renderSearchSidebarResults();
  renderCurrentFindCount();
}

function clearReplacePreview() {
  state.replacePreview = null;
  state.replacePreviewApplied = false;
  renderSearchSidebarResults();
  log("已清除替换预览");
}

function replaceCurrentFile() {
  const context = currentReplaceContext();
  if (!context) return;
  const { doc, model, query, replacement } = context;
  const matches = modelMatches(doc);
  if (isMarkdownWysiwygActive(doc) && markdownEditor) {
    const result = markdownEditor.search(editorSearchQuery(query), markdownSearchOptions());
    if (result.total === 0) {
      log("当前文件没有可替换内容");
      return;
    }
    const activeIndex = state.activeResultIndex >= 0
      ? Math.min(state.activeResultIndex, result.total - 1)
      : initialSearchResultIndex(result.total);
    markdownEditor.search(editorSearchQuery(query), { ...markdownSearchOptions(), highlightIndex: activeIndex });
    markdownEditor.replace(
      getSearchMode() === "extended" ? translateExtended(replacement) : replacement,
      false,
      getSearchMode() === "regex",
    );
    window.requestAnimationFrame(() => {
      syncMarkdownModelFromEditor(doc);
      findCurrent(false);
    });
    log("当前文件替换 1 处");
    return;
  }
  if (matches.length === 0) {
    log("当前文件没有可替换内容");
    return;
  }
  const match = matches[currentReplaceMatchIndex(matches)];
  model.pushEditOperations(
    [],
    [{
      range: rangeFromMatch(match),
      text: replacementForMatch(match.matchedText, query, replacement),
    }],
    () => null,
  );
  log("当前文件替换 1 处");
  findCurrent(false);
}

function replaceAllCurrentFile() {
  const context = currentReplaceContext();
  if (!context) return;
  const { doc, model, query, replacement } = context;
  const matches = modelMatches(doc);
  if (isMarkdownWysiwygActive(doc) && markdownEditor) {
    const result = markdownEditor.search(editorSearchQuery(query), { ...markdownSearchOptions(), highlightIndex: 0 });
    if (result.total === 0) {
      log("当前文件没有可替换内容");
      return;
    }
    markdownEditor.replace(
      getSearchMode() === "extended" ? translateExtended(replacement) : replacement,
      true,
      getSearchMode() === "regex",
    );
    window.requestAnimationFrame(() => {
      syncMarkdownModelFromEditor(doc);
      findCurrent(false);
    });
    log(`当前文件全部替换 ${result.total} 处`);
    return;
  }
  if (matches.length === 0) {
    log("当前文件没有可替换内容");
    return;
  }
  const edits = matches
    .map((match) => ({
      range: rangeFromMatch(match),
      text: replacementForMatch(match.matchedText, query, replacement),
    }))
    .reverse();
  model.pushEditOperations([], edits, () => null);
  log(`当前文件全部替换 ${edits.length} 处`);
  findCurrent(false);
}

function currentReplaceContext() {
  const query = ($("findInput") as HTMLInputElement).value;
  const replacement = ($("replaceInput") as HTMLInputElement).value;
  if (!query) {
    log("替换需要查找内容");
    return null;
  }
  const doc = activeDocument();
  if (doc.readOnly) {
    log(`当前文件只读，已跳过替换：${doc.readOnlyReason ?? "只读"}`);
    return null;
  }
  commitSearchHistory();
  commitReplaceHistory();
  return { doc, model: doc.model, query, replacement };
}

function currentReplaceMatchIndex(matches: TextMatchDto[]) {
  const active = flattenSearchResults()[state.activeResultIndex];
  if (active && (active.path === activeDocument().path || active.path === activeDocument().title)) {
    const activeIndex = matches.findIndex((match) =>
      match.line === active.match.line &&
      match.column === active.match.column &&
      match.matchedText === active.match.matchedText
    );
    if (activeIndex >= 0) return activeIndex;
  }
  const position = editor.getPosition();
  if (!position) return initialSearchResultIndex(matches.length);
  if (($("reverseSearchInput") as HTMLInputElement).checked) {
    const preferred = [...matches]
      .map((match, index) => ({ match, index }))
      .reverse()
      .find(({ match }) => comparePosition(match.line, match.column, position.lineNumber, position.column) <= 0);
    if (preferred) return preferred.index;
    return ($("wrapSearchInput") as HTMLInputElement).checked ? matches.length - 1 : 0;
  }
  const preferred = matches.findIndex((match) =>
    comparePosition(match.line, match.column, position.lineNumber, position.column) >= 0
  );
  if (preferred >= 0) return preferred;
  return ($("wrapSearchInput") as HTMLInputElement).checked ? 0 : matches.length - 1;
}

function replaceOpenDocuments() {
  const query = ($("findInput") as HTMLInputElement).value;
  const replacement = ($("replaceInput") as HTMLInputElement).value;
  if (!query) {
    log("替换需要查找内容");
    return;
  }
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
  if (!query) {
    log("查找内容不能为空");
    return;
  }
  if (!root) {
    log("目录查找需要先进入文件夹模式并选择目录");
    return;
  }
  commitSearchHistory();
  const requestId = beginWorkspaceSearch("search", "searching");
  try {
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
    if (!finishWorkspaceSearch(requestId)) return;
    setSearchResults(report, "workspace", -1, true);
    log(`目录查找 ${report.total} 个命中，扫描 ${report.filesScanned ?? 0} 个文件`);
  } catch (error) {
    failWorkspaceSearch(requestId, error);
  }
}

async function previewWorkspaceReplace() {
  const root = ($("directoryInput") as HTMLInputElement).value || state.workspace?.root;
  const query = ($("findInput") as HTMLInputElement).value;
  const replacement = ($("replaceInput") as HTMLInputElement).value;
  if (!query) {
    log("替换预览需要查找内容");
    return;
  }
  if (!root) {
    log("替换预览需要先进入文件夹模式并选择目录");
    return;
  }

  const requestId = beginWorkspaceSearch("preview", "previewing");
  try {
    const preview = await invoke<ReplacePreviewDto>("preview_workspace_replace", {
      request: searchReplaceRequest(root, query, replacement),
    });
    if (!finishWorkspaceSearch(requestId)) return;
    state.replacePreview = preview;
    state.replacePreviewApplied = false;
    state.workspaceReplaceVisibleResults = 400;
    state.panel = "preview";
    setRightTool("search");
    $("findPopover").classList.remove("hidden");
    $("app").classList.add("right-sidebar-open");
    renderRightSidebarToggle();
    renderSearchSidebarResults();
    log(`替换预览 ${preview.total} 处修改`);
  } catch (error) {
    failWorkspaceSearch(requestId, error);
  }
}

async function applyWorkspaceReplace() {
  if (!state.replacePreview || state.replacePreview.total === 0) return;
  const root = ($("directoryInput") as HTMLInputElement).value || state.workspace?.root;
  const query = ($("findInput") as HTMLInputElement).value;
  const replacement = ($("replaceInput") as HTMLInputElement).value;
  if (!root || !query) {
    log("目录替换需要目录和查找内容");
    return;
  }
  const confirmed = await askConfirm({
    title: "写入目录替换",
    subtitle: `${state.replacePreview.items.length} 个文件将被修改`,
    body: `确认写入 ${state.replacePreview.total} 处替换吗？此操作会直接修改磁盘文件。`,
    okLabel: "写入文件",
    cancelLabel: "取消",
    danger: true,
  });
  if (!confirmed) return;

  const requestId = beginWorkspaceSearch("apply", "applying");
  try {
    const applied = await invoke<ReplacePreviewDto>("apply_workspace_replace", {
      request: searchReplaceRequest(root, query, replacement),
    });
    if (!finishWorkspaceSearch(requestId)) return;
    state.replacePreview = applied;
    state.replacePreviewApplied = true;
    await refreshOpenDocumentsAfterReplace(applied);
    state.panel = "preview";
    renderSearchSidebarResults();
    log(`目录替换已写入 ${applied.total} 处`);
  } catch (error) {
    failWorkspaceSearch(requestId, error);
  }
}

function beginWorkspaceSearch(action: WorkspaceSearchAction, status: WorkspaceSearchStatus) {
  state.workspaceSearchRequestId += 1;
  state.workspaceSearchAction = action;
  state.workspaceSearchStatus = status;
  state.workspaceSearchError = "";
  renderSearchSidebarResults();
  return state.workspaceSearchRequestId;
}

function finishWorkspaceSearch(requestId: number) {
  if (requestId !== state.workspaceSearchRequestId) return false;
  state.workspaceSearchStatus = "idle";
  state.workspaceSearchError = "";
  return true;
}

function failWorkspaceSearch(requestId: number, error: unknown) {
  if (requestId !== state.workspaceSearchRequestId) return;
  const message = error instanceof Error ? error.message : String(error);
  state.workspaceSearchStatus = "error";
  state.workspaceSearchError = message;
  renderSearchSidebarResults();
  log(`文件搜索失败：${message}`);
}

async function refreshOpenDocumentsAfterReplace(applied: ReplacePreviewDto) {
  const touched = new Set(applied.items.map((item) => item.path));
  for (const doc of state.documents) {
    if (!doc.path || !touched.has(doc.path)) continue;
    if (doc.dirty && !(await askConfirm({
      title: "重新载入文档",
      subtitle: doc.title,
      body: "目录替换已经修改了磁盘文件，但当前打开的文档还有未保存内容。重新载入会丢弃当前编辑器中的未保存修改。",
      okLabel: "重新载入",
      cancelLabel: "保留当前",
      danger: true,
    }))) {
      continue;
    }
    const reopened = await withBusy(`重新载入 ${doc.title}`, () => invoke<DocumentDto>("open_path", { path: doc.path }));
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
      start: doc.model.getOffsetAt({ lineNumber: match.range.startLineNumber, column: match.range.startColumn }),
      end: doc.model.getOffsetAt({ lineNumber: match.range.endLineNumber, column: match.range.endColumn }),
      line: match.range.startLineNumber,
      column: match.range.startColumn,
      lineText: line,
      matchedText: doc.model.getValueInRange(match.range),
    };
  });
}

function matchAllowed(doc: OpenDocument, match: monaco.editor.FindMatch) {
  const selectedRange = activeSearchSelectionRange(doc);
  if (($("searchSelectionInput") as HTMLInputElement).checked && !isMarkdownWysiwygActive(doc)) {
    if (!selectedRange || !rangeContainsRange(selectedRange, match.range)) return false;
  }
  if (!($("wholeWordInput") as HTMLInputElement).checked) return true;
  const model = doc.model;
  const line = model.getLineContent(match.range.startLineNumber);
  const start = match.range.startColumn - 1;
  const end = match.range.endColumn - 1;
  const before = start > 0 ? line[start - 1] : "";
  const after = end < line.length ? line[end] : "";
  return !isWordChar(before) && !isWordChar(after);
}

function activeSearchSelectionRange(doc: OpenDocument) {
  if (doc.id !== activeDocument().id) return null;
  const selection = editor.getSelection();
  if (!selection || selection.isEmpty()) return null;
  return selection;
}

function rangeContainsRange(outer: monaco.IRange, inner: monaco.IRange) {
  return (
    comparePosition(inner.startLineNumber, inner.startColumn, outer.startLineNumber, outer.startColumn) >= 0 &&
    comparePosition(inner.endLineNumber, inner.endColumn, outer.endLineNumber, outer.endColumn) <= 0
  );
}

function comparePosition(lineA: number, columnA: number, lineB: number, columnB: number) {
  if (lineA !== lineB) return lineA - lineB;
  return columnA - columnB;
}

function selectionSignature() {
  if (!($("searchSelectionInput") as HTMLInputElement).checked) return "all";
  if (isMarkdownWysiwygActive() && markdownEditor) return markdownEditor.searchSelectionSignature();
  const selection = editor.getSelection();
  if (!selection || selection.isEmpty()) return "empty-selection";
  return [
    selection.startLineNumber,
    selection.startColumn,
    selection.endLineNumber,
    selection.endColumn,
  ].join(":");
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
  const value = document.querySelector<HTMLInputElement>('input[name="searchMode"]:checked')?.value;
  if (value === "extended" || value === "regex") return value;
  return "literal";
}

function setSearchMode(mode: SearchMode) {
  const target = document.querySelector<HTMLInputElement>(`input[name="searchMode"][value="${mode}"]`);
  if (target) target.checked = true;
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

function applyShellFontSettings() {
  const shellFont = resolveShellFontStack();
  const shellFontSize = `${state.shellFontSize}px`;
  document.documentElement.style.setProperty("--font", shellFont);
  document.documentElement.style.setProperty("--ui-font-size", shellFontSize);
  document.body.style.setProperty("--font", shellFont);
  document.body.style.setProperty("--ui-font-size", shellFontSize);
}

function resolveShellFontStack() {
  if (state.shellFontMode === "custom") {
    return normalizeFontStack(state.shellFontCustom, SHELL_FONT_STACKS[DEFAULT_SHELL_FONT_PRESET]);
  }
  return SHELL_FONT_STACKS[state.shellFontPreset] ?? SHELL_FONT_STACKS[DEFAULT_SHELL_FONT_PRESET];
}

function resolveEditorFontStack() {
  if (state.editorFontMode === "custom") {
    return normalizeFontStack(state.editorFontCustom, EDITOR_FONT_STACKS[DEFAULT_EDITOR_FONT_PRESET]);
  }
  return EDITOR_FONT_STACKS[state.editorFontPreset] ?? EDITOR_FONT_STACKS[DEFAULT_EDITOR_FONT_PRESET];
}

function editorLineHeight() {
  return Math.round(state.fontSize * 1.64);
}

function normalizeFontStack(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function normalizeKeybindingOverrides(value: unknown): KeybindingOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized: KeybindingOverrides = {};
  for (const [commandId, binding] of Object.entries(value)) {
    if (binding === null) normalized[commandId] = null;
    else if (typeof binding === "string" && binding.trim()) normalized[commandId] = normalizeBinding(binding);
  }
  return normalized;
}

function normalizeBookmarkSnapshot(value: unknown): Record<string, number[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, lines]) => {
    if (!Array.isArray(lines)) return [];
    const normalized = [...new Set(lines.filter((line): line is number => Number.isInteger(line) && line > 0))]
      .sort((a, b) => a - b);
    return normalized.length > 0 ? [[key, normalized]] : [];
  }));
}

function isShellFontPreset(value: unknown): value is ShellFontPreset {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SHELL_FONT_STACKS, value);
}

function isEditorFontPreset(value: unknown): value is EditorFontPreset {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(EDITOR_FONT_STACKS, value);
}

function normalizeFontMode(value: unknown, fallback: FontMode): FontMode {
  return value === "preset" || value === "custom" ? value : fallback;
}

function applyEditorPerformanceProfile(doc: OpenDocument) {
  const large = doc.largeFile || doc.fileSize > 2 * 1024 * 1024;
  const editorFont = resolveEditorFontStack();
  document.documentElement.style.setProperty("--editor-font", editorFont);
  document.documentElement.style.setProperty("--editor-font-size", `${state.fontSize}px`);
  editor.updateOptions({
    readOnly: doc.readOnly,
    readOnlyMessage: { value: doc.readOnlyReason || "当前文档只读" },
    minimap: { enabled: !large && state.minimap },
    wordWrap: !large && state.wordWrap ? "on" : "off",
    renderWhitespace: large ? "none" : state.renderWhitespace,
    fontFamily: editorFont,
    fontSize: state.fontSize,
    lineHeight: editorLineHeight(),
    folding: !large,
    links: !large,
    occurrencesHighlight: large ? "off" : "singleFile",
    selectionHighlight: !large,
    renderLineHighlight: large ? "none" : "line",
    quickSuggestions: large ? false : { other: true, comments: false, strings: false },
    wordBasedSuggestions: large ? "off" : "currentDocument",
    suggestOnTriggerCharacters: !large,
  });
  markdownEditor?.updateAppearance(state.darkMode, state.fontSize, editorFont);
  markdownEditor?.setReadOnly(editorBusyDepth > 0 || doc.readOnly);
}

function markdownSearchOptions(): MarkdownSearchOptions {
  return {
    matchCase: ($("matchCaseInput") as HTMLInputElement).checked,
    wholeWord: ($("wholeWordInput") as HTMLInputElement).checked,
    regex: getSearchMode() === "regex",
    selectionOnly: ($("searchSelectionInput") as HTMLInputElement).checked,
  };
}

function renderAll() {
  renderMenus();
  renderWorkspace();
  renderChrome();
  renderMarkdownSurface();
  renderSearchDecorations();
  renderHistoryLists();
  renderRecentFiles();
  renderRightSidebar();
  renderBookmarkDecorations();
  requestEditorLayout();
}

function bindMarkdownPreviewResize() {
  const handle = $("markdownPreviewResize");
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const area = $<HTMLElement>("editorArea");
    const areaRect = area.getBoundingClientRect();
    const resize: HorizontalResizeState = {
      pointerId: event.pointerId,
      frameId: 0,
      latestClientX: event.clientX,
      anchorX: areaRect.right,
      maxWidth: Math.max(280, area.clientWidth - 288),
    };
    markdownPreviewResizeState = resize;
    document.body.classList.add("resizing-markdown-preview");
    event.preventDefault();

    const applyResize = (clientX: number) => {
      setMarkdownPreviewWidth(resize.anchorX - clientX, resize.maxWidth, true);
    };
    const moveResize = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== resize.pointerId) return;
      scheduleHorizontalResize(resize, pointerEvent.clientX, applyResize);
    };
    const stopResize = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== resize.pointerId) return;
      flushHorizontalResize(
        resize,
        pointerEvent.type === "pointerup" ? pointerEvent.clientX : resize.latestClientX,
        applyResize,
      );
      markdownPreviewResizeState = null;
      document.body.classList.remove("resizing-markdown-preview");
      window.removeEventListener("pointermove", moveResize);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      applyMarkdownPreviewWidth(false, resize.maxWidth);
      scheduleSessionSave();
    };
    window.addEventListener("pointermove", moveResize);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  });
  handle.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const current = currentMarkdownPreviewWidth();
    setMarkdownPreviewWidth(current + (event.key === "ArrowLeft" ? 20 : -20));
    scheduleSessionSave();
  });
  handle.addEventListener("dblclick", () => {
    state.markdownPreviewWidth = 0;
    applyMarkdownPreviewWidth();
    scheduleSessionSave();
  });
  window.addEventListener("resize", () => applyMarkdownPreviewWidth());
}

function setMarkdownPreviewWidth(width: number, maxWidth?: number, fast = false) {
  const minWidth = 280;
  const resolvedMaxWidth = maxWidth ?? Math.max(minWidth, $<HTMLElement>("editorArea").clientWidth - minWidth - 8);
  state.markdownPreviewWidth = Math.min(resolvedMaxWidth, Math.max(minWidth, Math.round(width)));
  applyMarkdownPreviewWidth(fast, resolvedMaxWidth);
}

function applyMarkdownPreviewWidth(fast = false, maxWidth?: number) {
  const area = $<HTMLElement>("editorArea");
  const resolvedMaxWidth = maxWidth ?? Math.max(280, area.clientWidth - 288);
  if (state.markdownPreviewWidth > 0) {
    const minWidth = 280;
    state.markdownPreviewWidth = Math.min(resolvedMaxWidth, Math.max(minWidth, state.markdownPreviewWidth));
    area.style.setProperty("--markdown-preview-width", `${state.markdownPreviewWidth}px`);
  } else {
    area.style.removeProperty("--markdown-preview-width");
  }
  const handle = $("markdownPreviewResize");
  handle.setAttribute("aria-valuemax", String(resolvedMaxWidth));
  handle.setAttribute("aria-valuenow", String(Math.round(state.markdownPreviewWidth || currentMarkdownPreviewWidth())));
  requestEditorLayout(!fast);
}

function currentMarkdownPreviewWidth() {
  if (state.markdownPreviewWidth > 0) return state.markdownPreviewWidth;
  return $("markdownPreview").getBoundingClientRect().width || $<HTMLElement>("editorArea").clientWidth * 0.42;
}

function renderChrome() {
  const doc = activeDocument();
  setButtonLabel("wordWrapButton", "自动换行", `自动换行 ${state.wordWrap ? "已开启" : "已关闭"}`);
  $("wordWrapButton").classList.toggle("state-on", state.wordWrap);
  $("wordWrapButton").setAttribute("aria-pressed", String(state.wordWrap));
  setButtonLabel("languageButton", languageLabel(doc.language), `语言 ${languageLabel(doc.language)}`);
  setButtonLabel("encodingButton", doc.encoding, `编码 ${doc.encoding}`);
  $("encodingNotice").textContent = `${doc.encodingStatus} ${doc.encoding}`;
  setButtonLabel("lineEndingButton", doc.lineEnding || "LF", `行尾 ${doc.lineEnding || "LF"}`);
  const markdownDocument = isMarkdownLikeDocument(doc);
  $("markdownModeControl").classList.toggle("hidden", !markdownDocument);
  document.querySelectorAll<HTMLButtonElement>("[data-markdown-mode]").forEach((button) => {
    const active = markdownDocument && button.dataset.markdownMode === state.markdownEditMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $<HTMLButtonElement>("saveButton").disabled = doc.readOnly || (Boolean(doc.path) && !doc.dirty);
  $<HTMLButtonElement>("saveAsButton").disabled = doc.readOnly;
  $<HTMLButtonElement>("saveAllButton").disabled = !state.documents.some((item) => item.dirty && !item.readOnly);
  $<HTMLButtonElement>("uppercaseButton").disabled = doc.readOnly;
  $<HTMLButtonElement>("lowercaseButton").disabled = doc.readOnly;
  $<HTMLButtonElement>("menuSaveButton").disabled = $<HTMLButtonElement>("saveButton").disabled;
  $<HTMLButtonElement>("menuSaveAsButton").disabled = $<HTMLButtonElement>("saveAsButton").disabled;
  $<HTMLButtonElement>("menuSaveAllButton").disabled = $<HTMLButtonElement>("saveAllButton").disabled;
  $<HTMLButtonElement>("menuUppercaseButton").disabled = doc.readOnly;
  $<HTMLButtonElement>("menuLowercaseButton").disabled = doc.readOnly;
  ["menuMarkdownWysiwygButton", "menuMarkdownSplitButton", "menuMarkdownSourceButton"].forEach((id) => {
    $<HTMLButtonElement>(id).disabled = !markdownDocument;
  });
  $<HTMLButtonElement>("menuCloseWorkspaceButton").disabled = !state.workspace;
  $("menuOutlineButton").classList.toggle("hidden", !isMarkdownLikeDocument(doc));
  $("menuWordWrapButton").classList.toggle("active", state.wordWrap);
  ["wysiwyg", "split", "source"].forEach((mode) => {
    const button = $<HTMLButtonElement>(`menuMarkdown${mode[0].toUpperCase()}${mode.slice(1)}Button`);
    const active = markdownDocument && state.markdownEditMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  });
  setThemeButton();

  const tabs = $("tabs");
  tabs.innerHTML = "";
  for (const item of state.documents) {
    const tab = document.createElement("div");
    tab.className = `tab ${item.id === state.activeId ? "active" : ""}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(item.id === state.activeId));
    tab.tabIndex = 0;
    tab.title = item.path || item.title;
    const icon = document.createElement("span");
    icon.className = "tab-icon-wrap";
    icon.innerHTML = documentTabIcon(item);
    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = item.title;
    const close = document.createElement("button");
    close.className = "tab-close";
    close.type = "button";
    close.title = `关闭 ${item.title}`;
    close.setAttribute("aria-label", `关闭 ${item.title}`);
    close.innerHTML = iconSvg("X");
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      void closeDocument(item.id);
    });
    tab.addEventListener("click", () => activateDocument(item.id));
    tab.addEventListener("mousedown", (event) => {
      if (event.button === 1) event.preventDefault();
    });
    tab.addEventListener("auxclick", (event) => {
      if (event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();
      void closeDocument(item.id);
    });
    tab.addEventListener("contextmenu", (event) => openTabMenu(item.id, event));
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      activateDocument(item.id);
    });
    tab.append(icon, title);
    if (item.dirty) {
      const dirty = document.createElement("span");
      dirty.className = "tab-dirty-dot";
      dirty.title = "未保存";
      tab.appendChild(dirty);
    }
    tab.appendChild(close);
    tabs.appendChild(tab);
  }

  $("statusBusy").innerHTML = state.busyMessage
    ? `<span class="busy-pill">${iconSvg("LoaderCircle")}${escapeHtml(state.busyMessage)}</span>`
    : state.keybindingHint
      ? `<span class="keybinding-hint">${escapeHtml(state.keybindingHint)}</span>`
      : "";
  $("statusDocumentState").textContent = [doc.readOnly ? "只读" : "", doc.encodingStatus]
    .filter(Boolean)
    .join(" · ");
  $("statusRight").innerHTML = [
    `第 ${editor.getPosition()?.lineNumber ?? 1} 行，第 ${editor.getPosition()?.column ?? 1} 列`,
    `${doc.model.getLineCount()} 行`,
    `${doc.model.getValueLength()} 字符`,
    `${formatBytes(doc.fileSize)}`,
  ].map((item) => `<span>${item}</span>`).join(`<span class="dot"></span>`);
  renderShortcutHints();
}

function commandElementIds(): Record<string, string> {
  return {
  newButton: "file.new",
  openButton: "file.open",
  workspaceButton: "file.openFolder",
  settingsButton: "view.openSettings",
  saveButton: "file.save",
  saveAsButton: "file.saveAs",
  saveAllButton: "file.saveAll",
  undoButton: "edit.undo",
  redoButton: "edit.redo",
  uppercaseButton: "edit.uppercase",
  lowercaseButton: "edit.lowercase",
  findButton: "search.find",
  replaceButton: "search.replace",
  goToLineButton: "navigation.goToLine",
  commandButton: "navigation.commandPalette",
  findRailButton: "search.workspaceFind",
  menuNewButton: "file.new",
  menuOpenButton: "file.open",
  menuRecentButton: "file.openRecent",
  menuWorkspaceButton: "file.openFolder",
  menuCloseWorkspaceButton: "workspace.close",
  menuSaveButton: "file.save",
  menuSaveAsButton: "file.saveAs",
  menuSaveAllButton: "file.saveAll",
  menuCloseButton: "file.close",
  menuUndoButton: "edit.undo",
  menuRedoButton: "edit.redo",
  menuUppercaseButton: "edit.uppercase",
  menuLowercaseButton: "edit.lowercase",
  menuSelectAllButton: "edit.selectAll",
  menuFindButton: "search.find",
  menuReplaceButton: "search.replace",
  menuFindWorkspaceButton: "search.workspaceFind",
  menuReplaceWorkspaceButton: "search.workspaceReplace",
  menuGoToLineButton: "navigation.goToLine",
  menuCommandButton: "navigation.commandPalette",
  menuWordWrapButton: "view.toggleWordWrap",
  menuOutlineButton: "markdown.outline",
  tabSaveButton: "file.save",
  tabSaveAsButton: "file.saveAs",
  tabCloseButton: "file.close",
  tabCloseOthersButton: "tabs.closeOthers",
  tabCloseRightButton: "tabs.closeRight",
  tabCloseSavedButton: "tabs.closeSaved",
  };
}

function renderShortcutHints() {
  for (const [elementId, commandId] of Object.entries(commandElementIds())) {
    const element = document.getElementById(elementId) as HTMLButtonElement | null;
    const item = appCommands.get(commandId);
    if (!element || !item) continue;
    const binding = activeCommandBindings(commandId)[0] ?? "";
    const label = binding ? bindingLabel(binding) : "";
    const small = element.querySelector("small");
    if (small) small.textContent = label;
    element.title = label ? `${item.title} ${label}` : item.title;
    element.setAttribute("aria-label", element.title);
    if (binding && !binding.includes(" ")) element.setAttribute("aria-keyshortcuts", ariaKeyShortcut(binding));
    else element.removeAttribute("aria-keyshortcuts");
  }
  const markdownActions: Record<string, string> = {
    "format:strong": "markdown.bold",
    "format:em": "markdown.italic",
    "format:inline_code": "markdown.inlineCode",
    "format:link": "markdown.link",
    "paragraph:heading 1": "markdown.heading1",
    "paragraph:heading 2": "markdown.heading2",
    "paragraph:heading 3": "markdown.heading3",
    "paragraph:heading 4": "markdown.heading4",
    "paragraph:heading 5": "markdown.heading5",
    "paragraph:heading 6": "markdown.heading6",
    "paragraph:paragraph": "markdown.paragraph",
    "insert:image": "markdown.insertImage",
    "insert:table": "markdown.insertTable",
    "paragraph:pre": "markdown.codeBlock",
    "paragraph:mathblock": "markdown.mathBlock",
  };
  document.querySelectorAll<HTMLButtonElement>("[data-markdown-action]").forEach((button) => {
    const commandId = markdownActions[button.dataset.markdownAction ?? ""];
    if (!commandId) return;
    const binding = activeCommandBindings(commandId)[0] ?? "";
    const label = binding ? bindingLabel(binding) : "";
    const small = button.querySelector("small");
    if (small) small.textContent = label;
    const item = appCommands.get(commandId);
    if (item) button.title = label ? `${item.title} ${label}` : item.title;
  });
}

function renderWorkspace() {
  const workspace = $("workspace");
  const inWorkspaceMode = state.mode === "workspace" && !!state.workspace;
  workspace.classList.toggle("single-mode", !inWorkspaceMode);
  workspace.classList.toggle("workspace-mode", inWorkspaceMode);
  workspace.classList.toggle("panel-collapsed", inWorkspaceMode && !state.showDirectory);
  $("directoryToggle").classList.toggle("active", inWorkspaceMode && state.showDirectory);
  if (!state.workspace) {
    $("tree").innerHTML = `<div class="empty">未打开目录</div>`;
    return;
  }
  $("workspaceTitle").textContent = state.workspace.name.toUpperCase();
  renderWorkspaceTree();
}

function renderWorkspaceTree() {
  if (!state.workspace) {
    $("tree").innerHTML = `<div class="empty">鏈墦寮€鐩綍</div>`;
    return;
  }
  const activePath = activeDocument().path;
  $("tree").innerHTML = renderTreeRows(visibleTreeItems(state.workspace.items), activePath);
}

function renderTreeRows(items: TreeItemDto[], activePath: string | null | undefined) {
  if (items.length === 0) return `<div class="empty compact">空文件夹</div>`;
  const rows: string[] = [];
  items.forEach((item, index) => {
    const kind = item.isDir ? "dir" : "file";
    const collapsed = item.isDir && state.collapsedDirs.has(item.path);
    const expanded = item.isDir && !collapsed;
    const active = !item.isDir && item.path === activePath ? " active" : "";
    rows.push(
      `<button class="tree-item ${kind}${active}" data-path="${escapeAttr(item.path)}" style="--tree-depth:${item.depth}">
        ${item.isDir ? treeChevron(expanded) : `<span class="tree-chevron spacer" aria-hidden="true"></span>`}
        ${treeEntryIcon(item, expanded)}
        <span class="tree-name">${escapeHtml(item.name)}</span>
      </button>`,
    );
    const next = items[index + 1];
    if (expanded && (!next || next.depth <= item.depth)) {
      rows.push(
        `<div class="tree-empty-row" style="--tree-depth:${item.depth + 1}">空文件夹</div>`,
      );
    }
  });
  return rows.join("");
}

function visibleTreeItems(items: TreeItemDto[]) {
  const visible: TreeItemDto[] = [];
  let collapsedDepth: number | null = null;
  for (const item of items) {
    if (collapsedDepth !== null && item.depth <= collapsedDepth) collapsedDepth = null;
    if (collapsedDepth !== null) continue;
    visible.push(item);
    if (item.isDir && state.collapsedDirs.has(item.path)) collapsedDepth = item.depth;
  }
  return visible;
}

function toggleDirectoryCollapse(path: string) {
  if (!path) return;
  if (state.collapsedDirs.has(path)) {
    state.workspace?.items.forEach((item) => {
      if (item.isDir && item.path !== path && pathMatchesTarget(item.path, path, true)) {
        state.collapsedDirs.add(item.path);
      }
    });
    state.collapsedDirs.delete(path);
  } else {
    state.collapsedDirs.add(path);
  }
  renderWorkspaceTree();
  scheduleSessionSave();
}

function renderMenus() {
  renderLanguageList(($("languageSearchInput") as HTMLInputElement).value);
  renderEncodingList("useEncodingList", useEncoding);
  renderEncodingList("convertEncodingList", convertEncoding);
  renderLineEndingList();
  renderSettingsMenu();
  renderRecentFiles();
}

function renderLanguageList(filter = "") {
  const languageList = $("languageList");
  const query = filter.trim().toLowerCase();
  const current = activeDocument().language;
  const options = languageOptions().filter(([id, label, hint]) => {
    if (!query) return true;
    return `${id} ${label} ${hint}`.toLowerCase().includes(query);
  });
  if (options.length === 0) {
    languageList.innerHTML = `<div class="empty compact">没有匹配语言</div>`;
    return;
  }
  languageList.innerHTML = "";
  for (const [id, label, hint] of options) {
    const row = document.createElement("button");
    row.className = `menu-row ${id === current ? "active" : ""}`;
    row.innerHTML = `<span>${id === current ? "●" : ""}</span><strong>${label}</strong><small>${hint}</small>`;
    row.addEventListener("click", () => setLanguage(id));
    languageList.appendChild(row);
  }
}

function renderSettingsMenu() {
  const settingsOpen = !$("settingsPage").classList.contains("hidden");
  $("settingsButton").classList.toggle("active", settingsOpen);
  document.querySelectorAll<HTMLButtonElement>("[data-settings-section]").forEach((button) => {
    button.classList.toggle("active", button.dataset.settingsSection === state.settingsSection);
  });
  document.querySelectorAll<HTMLElement>("[data-settings-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.settingsPanel === state.settingsSection);
  });
  $("settingsThemeLight").classList.toggle("active", !state.darkMode);
  $("settingsThemeDark").classList.toggle("active", state.darkMode);
  $("settingsShellFontValue").textContent = `${state.shellFontSize} px`;
  $("settingsFontValue").textContent = `${state.fontSize} px`;
  setFontDropdownLabel("settingsShellFontModeLabel", FONT_MODE_LABELS[state.shellFontMode]);
  setFontDropdownLabel("settingsShellFontPresetLabel", SHELL_FONT_LABELS[state.shellFontPreset]);
  setFontDropdownLabel("settingsEditorFontModeLabel", FONT_MODE_LABELS[state.editorFontMode]);
  setFontDropdownLabel("settingsEditorFontPresetLabel", EDITOR_FONT_LABELS[state.editorFontPreset]);
  setFontMenuValue("settingsShellFontModeMenu", state.shellFontMode);
  setFontMenuValue("settingsShellFontPresetMenu", state.shellFontPreset);
  setFontMenuValue("settingsEditorFontModeMenu", state.editorFontMode);
  setFontMenuValue("settingsEditorFontPresetMenu", state.editorFontPreset);
  $("settingsShellFontPresetWrap").classList.toggle("hidden", state.shellFontMode !== "preset");
  $("settingsEditorFontPresetWrap").classList.toggle("hidden", state.editorFontMode !== "preset");
  setFontInputValue("settingsShellFontCustom", state.shellFontCustom, state.shellFontMode === "custom");
  setFontInputValue("settingsEditorFontCustom", state.editorFontCustom, state.editorFontMode === "custom");
  setSegmentedValue("settingsWordWrapControl", state.wordWrap ? "on" : "off");
  setSegmentedValue("settingsMinimapControl", state.minimap ? "on" : "off");
  setSegmentedValue("settingsWhitespaceControl", state.renderWhitespace);
  setSegmentedValue("settingsKeymapProfileControl", state.keymapProfile);
  setSegmentedValue("settingsMarkdownWidthControl", state.markdownContentWidth);
  setSegmentedValue("settingsMarkdownControl", state.markdownEditMode);
  setSegmentedValue("settingsModeControl", state.mode === "workspace" && state.workspace ? "workspace" : "single");
  renderAppUpdateStatus();
  $("keymapProfileDetail").textContent = keymapProfileDetail();
  const integrationStatus = $("settingsShellIntegrationStatus");
  const integrationButton = $<HTMLButtonElement>("settingsShellIntegrationButton");
  $("settingsShellIntegrationDetail").textContent = state.shellIntegration.detail;
  integrationStatus.textContent = !state.shellIntegrationLoaded
    ? "检测中"
    : state.shellIntegrationBusy
      ? "处理中"
      : state.shellIntegration.supported
        ? state.shellIntegration.enabled ? "已开启" : "未开启"
        : "不支持";
  integrationStatus.classList.toggle("enabled", state.shellIntegration.enabled && !state.shellIntegrationBusy);
  integrationStatus.classList.toggle("unsupported", state.shellIntegrationLoaded && !state.shellIntegration.supported);
  integrationButton.textContent = state.shellIntegrationBusy
    ? "处理中"
    : state.shellIntegration.enabled ? "关闭" : "开启";
  integrationButton.disabled =
    !state.shellIntegrationLoaded || state.shellIntegrationBusy || !state.shellIntegration.supported;
  integrationButton.setAttribute("aria-pressed", String(state.shellIntegration.enabled));
  renderSystemIntegrationControl(
    "settingsDefaultAppDetail",
    "settingsDefaultAppStatus",
    "settingsDefaultAppButton",
    state.defaultAppCandidate,
    state.defaultAppCandidateLoaded,
    state.defaultAppCandidateBusy,
  );
  if (state.settingsSection === "keybindings") renderKeybindingSettings();
}

function renderSystemIntegrationControl(
  detailId: string,
  statusId: string,
  buttonId: string,
  status: ShellIntegrationStatusDto,
  loaded: boolean,
  busy: boolean,
) {
  const statusElement = $(statusId);
  const button = $<HTMLButtonElement>(buttonId);
  $(detailId).textContent = status.detail;
  statusElement.textContent = !loaded
    ? "检测中"
    : busy
      ? "处理中"
      : status.supported
        ? status.enabled ? "已开启" : "未开启"
        : "不支持";
  statusElement.classList.toggle("enabled", status.enabled && !busy);
  statusElement.classList.toggle("unsupported", loaded && !status.supported);
  button.textContent = busy ? "处理中" : status.enabled ? "关闭" : "开启";
  button.disabled = !loaded || busy || !status.supported;
  button.setAttribute("aria-pressed", String(status.enabled));
}

function setSegmentedValue(id: string, value: string) {
  $(id).querySelectorAll<HTMLButtonElement>("button[data-value]").forEach((button) => {
    button.classList.toggle("active", button.dataset.value === value);
  });
}

function setFontDropdownLabel(id: string, value: string) {
  $(id).textContent = value;
}

function setFontMenuValue(id: string, value: string) {
  $(id).querySelectorAll<HTMLButtonElement>("button[data-value]").forEach((button) => {
    const current = button.dataset.value === value;
    button.classList.toggle("current", current);
    button.setAttribute("aria-checked", String(current));
  });
}

function setFontInputValue(id: string, value: string, active: boolean) {
  const input = $<HTMLInputElement>(id);
  input.classList.toggle("hidden", !active);
  if (document.activeElement !== input) {
    input.value = value;
  }
  input.classList.toggle("custom-active", active);
}

function renderRecentFiles() {
  const list = $("recentList");
  if (state.recentWorkspaces.length === 0 && state.recentFiles.length === 0) {
    list.innerHTML = `<div class="empty">暂无最近打开记录</div>`;
    return;
  }
  list.innerHTML = "";
  if (state.recentWorkspaces.length > 0) {
    const title = document.createElement("div");
    title.className = "menu-section-title";
    title.textContent = "最近工作区";
    list.appendChild(title);
    for (const path of state.recentWorkspaces) {
      const row = document.createElement("button");
      row.className = "menu-row recent-workspace-row";
      row.innerHTML = `<span>${iconSvg("FolderTree")}</span><strong>${escapeHtml(fileNameFromPath(path))}</strong><small>${escapeHtml(path)}</small>`;
      row.addEventListener("click", () => {
        closeMenus();
        void openWorkspacePath(path);
      });
      list.appendChild(row);
    }
  }
  if (state.recentFiles.length > 0) {
    const title = document.createElement("div");
    title.className = "menu-section-title";
    title.textContent = "最近文件";
    list.appendChild(title);
  }
  for (const path of state.recentFiles) {
    const row = document.createElement("button");
    row.className = "menu-row";
    row.innerHTML = `<span>${iconSvg("FileText")}</span><strong>${escapeHtml(fileNameFromPath(path))}</strong><small>${escapeHtml(path)}</small>`;
    row.addEventListener("click", () => {
      closeMenus();
      void openPath(path, true);
    });
    list.appendChild(row);
  }
}

function renderHistoryLists() {
  renderSearchHistory("find");
  renderSearchHistory("replace");
  renderCurrentFindHistory();
}

function searchHistoryConfig(field: "find" | "replace") {
  return field === "find"
    ? {
        input: $<HTMLInputElement>("findInput"),
        button: $<HTMLButtonElement>("findHistoryButton"),
        menu: $("findHistoryMenu"),
        history: state.searchHistory,
        empty: "暂无搜索历史",
      }
    : {
        input: $<HTMLInputElement>("replaceInput"),
        button: $<HTMLButtonElement>("replaceHistoryButton"),
        menu: $("replaceHistoryMenu"),
        history: state.replaceHistory,
        empty: "暂无替换历史",
      };
}

function renderSearchHistory(field: "find" | "replace") {
  const { menu, history, empty } = searchHistoryConfig(field);
  menu.innerHTML = "";
  const items = history.slice(0, 12);
  if (items.length === 0) {
    const placeholder = document.createElement("div");
    placeholder.className = "search-history-empty";
    placeholder.textContent = empty;
    menu.appendChild(placeholder);
    if (searchHistoryField === field) searchHistoryActiveIndex = -1;
    return;
  }
  if (searchHistoryField === field && searchHistoryActiveIndex >= items.length) {
    searchHistoryActiveIndex = items.length - 1;
  }
  items.forEach((value, index) => {
    const button = document.createElement("button");
    const active = searchHistoryField === field && index === searchHistoryActiveIndex;
    button.type = "button";
    button.className = "search-history-item";
    button.dataset.historyIndex = String(index);
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(active));
    button.classList.toggle("active", active);
    button.textContent = value;
    button.title = value;
    button.addEventListener("click", () => applySearchHistory(field, value));
    menu.appendChild(button);
  });
}

function openSearchHistory(field: "find" | "replace") {
  closeSearchHistory();
  searchHistoryField = field;
  searchHistoryActiveIndex = -1;
  renderSearchHistory(field);
  const { input, button, menu } = searchHistoryConfig(field);
  $("findPopover").appendChild(menu);
  menu.classList.remove("hidden");
  positionSearchHistoryMenu(field);
  button.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-expanded", "true");
  input.focus();
}

function positionOpenSearchHistoryMenu() {
  if (searchHistoryField) positionSearchHistoryMenu(searchHistoryField);
}

function positionSearchHistoryMenu(field: "find" | "replace") {
  const { input, menu } = searchHistoryConfig(field);
  if (menu.classList.contains("hidden")) return;
  const sidebar = $("findPopover");
  const control = input.closest<HTMLElement>(".search-history-control");
  if (!control) return;

  const sidebarRect = sidebar.getBoundingClientRect();
  const controlRect = control.getBoundingClientRect();
  const gap = 5;
  const edge = 8;
  const maxMenuHeight = 220;
  const desiredHeight = Math.min(maxMenuHeight, menu.scrollHeight);
  const availableBelow = Math.max(0, sidebarRect.bottom - controlRect.bottom - gap - edge);
  const availableAbove = Math.max(0, controlRect.top - sidebarRect.top - gap - edge);
  const openAbove = availableBelow < desiredHeight && availableAbove > availableBelow;
  const availableHeight = Math.max(48, openAbove ? availableAbove : availableBelow);
  const menuHeight = Math.min(desiredHeight, availableHeight);

  menu.classList.toggle("open-above", openAbove);
  menu.style.left = `${Math.round(controlRect.left - sidebarRect.left)}px`;
  menu.style.width = `${Math.round(controlRect.width)}px`;
  menu.style.maxHeight = `${Math.floor(Math.min(maxMenuHeight, availableHeight))}px`;
  menu.style.top = openAbove
    ? `${Math.round(controlRect.top - sidebarRect.top - gap - menuHeight)}px`
    : `${Math.round(controlRect.bottom - sidebarRect.top + gap)}px`;
}

function closeSearchHistory() {
  (["find", "replace"] as const).forEach((field) => {
    const { input, button, menu } = searchHistoryConfig(field);
    menu.classList.add("hidden");
    button.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-expanded", "false");
  });
  searchHistoryField = null;
  searchHistoryActiveIndex = -1;
}

function toggleSearchHistory(field: "find" | "replace") {
  const { menu } = searchHistoryConfig(field);
  if (searchHistoryField === field && !menu.classList.contains("hidden")) closeSearchHistory();
  else openSearchHistory(field);
}

function moveSearchHistorySelection(field: "find" | "replace", delta: number) {
  const { menu } = searchHistoryConfig(field);
  const items = Array.from(menu.querySelectorAll<HTMLButtonElement>(".search-history-item"));
  if (items.length === 0) return;
  searchHistoryActiveIndex = searchHistoryActiveIndex < 0
    ? (delta > 0 ? 0 : items.length - 1)
    : (searchHistoryActiveIndex + delta + items.length) % items.length;
  items.forEach((item, index) => {
    const active = index === searchHistoryActiveIndex;
    item.classList.toggle("active", active);
    item.setAttribute("aria-selected", String(active));
  });
  items[searchHistoryActiveIndex]?.scrollIntoView({ block: "nearest" });
}

function handleSearchHistoryKeydown(event: KeyboardEvent, field: "find" | "replace") {
  const { menu, history } = searchHistoryConfig(field);
  if (event.altKey && event.key === "ArrowDown") {
    event.preventDefault();
    openSearchHistory(field);
    moveSearchHistorySelection(field, 1);
    return true;
  }
  if (searchHistoryField !== field || menu.classList.contains("hidden")) return false;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    moveSearchHistorySelection(field, event.key === "ArrowDown" ? 1 : -1);
    return true;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeSearchHistory();
    return true;
  }
  if (event.key === "Enter" && searchHistoryActiveIndex >= 0) {
    const value = history[searchHistoryActiveIndex];
    if (value !== undefined) {
      event.preventDefault();
      applySearchHistory(field, value);
      return true;
    }
  }
  return false;
}

function applySearchHistory(field: "find" | "replace", value: string) {
  const { input } = searchHistoryConfig(field);
  input.value = value;
  closeSearchHistory();
  input.focus();
  input.setSelectionRange(value.length, value.length);
  scheduleSessionSave();
}

function renderCurrentFindHistory() {
  const menu = $("currentFindHistoryMenu");
  menu.innerHTML = "";
  const history = state.searchHistory.slice(0, 12);
  if (history.length === 0) {
    const empty = document.createElement("div");
    empty.className = "current-find-history-empty";
    empty.textContent = "暂无搜索历史";
    menu.appendChild(empty);
    currentFindHistoryActiveIndex = -1;
    return;
  }
  if (currentFindHistoryActiveIndex >= history.length) currentFindHistoryActiveIndex = history.length - 1;
  history.forEach((value, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "current-find-history-item";
    button.dataset.historyIndex = String(index);
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(index === currentFindHistoryActiveIndex));
    button.classList.toggle("active", index === currentFindHistoryActiveIndex);
    button.textContent = value;
    button.title = value;
    button.addEventListener("click", () => applyCurrentFindHistory(value));
    menu.appendChild(button);
  });
}

function openCurrentFindHistory() {
  renderCurrentFindHistory();
  $("currentFindHistoryMenu").classList.remove("hidden");
  $<HTMLButtonElement>("currentFindHistoryButton").setAttribute("aria-expanded", "true");
  $<HTMLInputElement>("currentFindInput").setAttribute("aria-expanded", "true");
}

function closeCurrentFindHistory() {
  $("currentFindHistoryMenu").classList.add("hidden");
  $<HTMLButtonElement>("currentFindHistoryButton").setAttribute("aria-expanded", "false");
  $<HTMLInputElement>("currentFindInput").setAttribute("aria-expanded", "false");
  currentFindHistoryActiveIndex = -1;
}

function toggleCurrentFindHistory() {
  if ($("currentFindHistoryMenu").classList.contains("hidden")) openCurrentFindHistory();
  else closeCurrentFindHistory();
}

function moveCurrentFindHistorySelection(delta: number) {
  const items = Array.from($("currentFindHistoryMenu").querySelectorAll<HTMLButtonElement>(".current-find-history-item"));
  if (items.length === 0) return;
  currentFindHistoryActiveIndex = currentFindHistoryActiveIndex < 0
    ? (delta > 0 ? 0 : items.length - 1)
    : (currentFindHistoryActiveIndex + delta + items.length) % items.length;
  items.forEach((item, index) => {
    const active = index === currentFindHistoryActiveIndex;
    item.classList.toggle("active", active);
    item.setAttribute("aria-selected", String(active));
  });
  items[currentFindHistoryActiveIndex]?.scrollIntoView({ block: "nearest" });
}

function selectActiveCurrentFindHistory() {
  const value = state.searchHistory[currentFindHistoryActiveIndex];
  if (currentFindHistoryActiveIndex < 0 || value === undefined) return false;
  applyCurrentFindHistory(value);
  return true;
}

function applyCurrentFindHistory(value: string) {
  const input = $<HTMLInputElement>("currentFindInput");
  input.value = value;
  syncCurrentFindControls();
  commitSearchHistory();
  closeCurrentFindHistory();
  scheduleCurrentFind();
  input.focus();
  input.setSelectionRange(value.length, value.length);
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

function toggleWordWrap() {
  setWordWrap(!state.wordWrap);
}

function toggleMinimap() {
  setMinimap(!state.minimap);
}

function cycleWhitespace() {
  setWhitespace(state.renderWhitespace === "none" ? "selection" : state.renderWhitespace === "selection" ? "all" : "none");
}

function setFontSize(size: number) {
  state.fontSize = Math.min(24, Math.max(11, size));
  applyEditorSettings();
  renderChrome();
  renderSettingsMenu();
  scheduleSessionSave();
}

function resetEditorView() {
  state.wordWrap = false;
  state.minimap = false;
  state.renderWhitespace = "selection";
  state.fontSize = DEFAULT_EDITOR_FONT_SIZE;
  state.shellFontMode = "preset";
  state.shellFontPreset = DEFAULT_SHELL_FONT_PRESET;
  state.shellFontCustom = SHELL_FONT_STACKS[DEFAULT_SHELL_FONT_PRESET];
  state.shellFontSize = DEFAULT_SHELL_FONT_SIZE;
  state.editorFontMode = "preset";
  state.editorFontPreset = DEFAULT_EDITOR_FONT_PRESET;
  state.editorFontCustom = EDITOR_FONT_STACKS[DEFAULT_EDITOR_FONT_PRESET];
  state.markdownContentWidth = "typora";
  state.explorerWidth = DEFAULT_EXPLORER_WIDTH;
  state.markdownPreviewWidth = 0;
  applyShellFontSettings();
  applyEditorSettings();
  applyMarkdownContentWidth();
  applyExplorerWidth();
  applyMarkdownPreviewWidth();
  renderAll();
  scheduleSessionSave();
  log("视图和字体设置已重置");
}

function applyEditorSettings() {
  applyEditorPerformanceProfile(activeDocument());
}

function applyMarkdownContentWidth() {
  document.documentElement.dataset.markdownWidth = state.markdownContentWidth;
}

function isMarkdownContentWidth(value: unknown): value is MarkdownContentWidth {
  return value === "typora" || value === "compact" || value === "wide" || value === "full";
}

function whitespaceLabel(value: RenderWhitespaceMode) {
  if (value === "all") return "全部";
  if (value === "selection") return "选区";
  return "关";
}

function normalizeLineEndings(text: string, lineEnding: string) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (lineEnding === "CRLF") return normalized.replace(/\n/g, "\r\n");
  if (lineEnding === "CR") return normalized.replace(/\n/g, "\r");
  return normalized;
}

function renderSearchSidebarResults() {
  const body = $("findResultsBody");
  const title = $("findResultsTitle");
  const summary = $("findResultsSummary");
  const renderVersion = ++searchResultRenderVersion;
  renderWorkspaceSearchControls();

  const busy = workspaceSearchIsBusy();
  body.closest(".find-results-pane")?.setAttribute("aria-busy", String(busy));
  if (busy) {
    const label = state.workspaceSearchStatus === "applying"
      ? "正在写入替换"
      : state.workspaceSearchStatus === "previewing"
        ? "正在生成替换预览"
        : "正在搜索文件";
    title.textContent = state.workspaceSearchStatus === "searching" ? "搜索结果" : "替换预览";
    summary.textContent = label;
    body.innerHTML = `<div class="workspace-search-progress" role="status">${iconSvg("LoaderCircle")}<strong>${label}</strong><span>正在扫描目录，请稍候…</span></div><div class="search-skeleton" aria-hidden="true">${Array.from({ length: 5 }, () => `<span></span>`).join("")}</div>`;
    return;
  }
  if (state.workspaceSearchStatus === "error") {
    title.textContent = state.workspaceSearchAction === "search" ? "搜索结果" : "替换预览";
    summary.textContent = "操作失败";
    body.innerHTML = `<div class="workspace-search-error" role="alert">${iconSvg("CircleAlert")}<strong>未能完成操作</strong><span>${escapeHtml(state.workspaceSearchError)}</span><button class="tool-button primary" id="retryWorkspaceSearchButton">${iconSvg("RefreshCw")}<span>重试</span></button></div>`;
    $("retryWorkspaceSearchButton").addEventListener("click", retryWorkspaceSearch);
    return;
  }

  if (state.panel === "preview") {
    title.textContent = "替换预览";
    if (!state.replacePreview || state.replacePreview.total === 0) {
      if (state.replacePreview) {
        summary.textContent = state.replacePreviewApplied ? "替换已完成" : "没有可替换内容";
        body.innerHTML = `<div class="find-result-empty"><button class="tool-button" id="clearReplacePreviewButton">${iconSvg("X")}<span>清除预览</span></button></div>`;
        $("clearReplacePreviewButton").addEventListener("click", clearReplacePreview);
      } else {
        summary.textContent = "暂无结果";
        body.innerHTML = `<div class="empty">暂无替换预览</div>`;
      }
      return;
    }
    const replaceStatus = state.replacePreviewApplied ? "已写入" : "待确认";
    summary.textContent = `${state.replacePreview.total} 处 · ${state.replacePreview.items.length} 个文件`;
    const applyButton = state.replacePreviewApplied
      ? ""
      : `<button class="tool-button primary" id="applyReplaceButton">${iconSvg("Save")}<span>写入文件</span></button>`;
    body.innerHTML = `<div class="find-result-actions">${applyButton}<button class="tool-button" id="clearReplacePreviewButton">${iconSvg("X")}<span>清除</span></button></div><div class="find-result-list" id="replacePreviewResultList"></div>`;
    $("applyReplaceButton")?.addEventListener("click", () => void applyWorkspaceReplace());
    $("clearReplacePreviewButton").addEventListener("click", clearReplacePreview);
    const list = $("replacePreviewResultList");
    list.addEventListener("click", (event) => {
      const row = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-path]");
      if (row) void openResult(row.dataset.path ?? "", Number(row.dataset.line ?? "1"), Number(row.dataset.column ?? "1"));
    });
    renderProgressiveReplaceResults(state.replacePreview, list, replaceStatus, renderVersion);
    return;
  }
  title.textContent = "搜索结果";
  if (!state.results) {
    summary.textContent = "暂无结果";
    body.innerHTML = `<div class="empty">暂无查找结果</div>`;
    return;
  }
  if (state.results.total === 0) {
    summary.textContent = searchReportSummary(state.results);
    body.innerHTML = `<div class="find-result-empty"><span>没有命中，可检查大小写、全词或文件过滤。</span><button class="tool-button" id="clearResultsButton">${iconSvg("X")}<span>清除</span></button></div>`;
    $("clearResultsButton").addEventListener("click", clearSearchResults);
    return;
  }
  summary.textContent = searchReportSummary(state.results);
  body.innerHTML = `<div class="find-result-actions"><button class="tool-button" id="clearResultsButton">${iconSvg("X")}<span>清除</span></button></div><div class="find-result-list" id="workspaceSearchResultList"></div>`;
  $("clearResultsButton").addEventListener("click", clearSearchResults);
  const list = $("workspaceSearchResultList");
  list.addEventListener("click", (event) => {
    const row = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-result-index]");
    if (row) void openSearchResult(Number(row.dataset.resultIndex ?? "0"));
  });
  renderProgressiveSearchResults(state.results, list, renderVersion);
}

function workspaceSearchIsBusy() {
  return state.workspaceSearchStatus === "searching"
    || state.workspaceSearchStatus === "previewing"
    || state.workspaceSearchStatus === "applying";
}

function renderWorkspaceSearchControls() {
  const busy = workspaceSearchIsBusy();
  const searchButton = $<HTMLButtonElement>("findWorkspaceButton");
  const previewButton = $<HTMLButtonElement>("previewWorkspaceReplaceButton");
  searchButton.disabled = busy;
  previewButton.disabled = busy;
  searchButton.classList.toggle("is-searching", state.workspaceSearchStatus === "searching");
  previewButton.classList.toggle("is-searching", state.workspaceSearchStatus === "previewing" || state.workspaceSearchStatus === "applying");
  setIconSlot(searchButton.querySelector(".workspace-action-icon"), state.workspaceSearchStatus === "searching" ? "LoaderCircle" : "Search");
  setIconSlot(previewButton.querySelector(".workspace-action-icon"), state.workspaceSearchStatus === "previewing" || state.workspaceSearchStatus === "applying" ? "LoaderCircle" : "ReplaceAll");
  const searchLabel = searchButton.querySelector<HTMLElement>(".workspace-action-label");
  const previewLabel = previewButton.querySelector<HTMLElement>(".workspace-action-label");
  if (searchLabel) searchLabel.textContent = state.workspaceSearchStatus === "searching" ? "正在搜索" : "在文件中查找";
  if (previewLabel) previewLabel.textContent = state.workspaceSearchStatus === "applying"
    ? "正在写入"
    : state.workspaceSearchStatus === "previewing"
      ? "正在生成预览"
      : "预览全部替换";
}

function retryWorkspaceSearch() {
  if (state.workspaceSearchAction === "search") void searchWorkspace();
  else if (state.workspaceSearchAction === "preview") void previewWorkspaceReplace();
  else void applyWorkspaceReplace();
}

function searchReportSummary(report: SearchReportDto) {
  const parts = [`${report.total} 处`, `${report.hits.length} 个文件`];
  if (report.filesScanned !== undefined) parts.push(`扫描 ${report.filesScanned}`);
  if (report.elapsedMs !== undefined) parts.push(formatSearchDuration(report.elapsedMs));
  return parts.join(" · ");
}

function formatSearchDuration(milliseconds: number) {
  return milliseconds < 1000 ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(1)} s`;
}

function renderProgressiveSearchResults(report: SearchReportDto, list: HTMLElement, renderVersion: number) {
  let hitIndex = 0;
  let matchIndex = 0;
  let resultIndex = 0;
  let rows: HTMLElement | null = null;
  const limit = Math.min(report.total, state.workspaceSearchVisibleResults);

  const appendBatch = () => {
    if (renderVersion !== searchResultRenderVersion || !list.isConnected) return;
    const started = performance.now();
    let appended = 0;
    while (hitIndex < report.hits.length && resultIndex < limit && appended < 120 && performance.now() - started < 8) {
      const hit = report.hits[hitIndex];
      if (matchIndex === 0) {
        const group = document.createElement("section");
        group.className = "find-result-group";
        group.innerHTML = `<header>${iconSvg("FileText")}<strong title="${escapeAttr(hit.path)}">${escapeHtml(hit.fileName)}</strong><span>${hit.matches.length} 处</span></header><div></div>`;
        list.appendChild(group);
        rows = group.lastElementChild as HTMLElement;
      }
      const match = hit.matches[matchIndex];
      const row = document.createElement("button");
      row.className = `find-result-row ${resultIndex === state.activeResultIndex ? "result-active" : ""}`;
      row.dataset.resultIndex = String(resultIndex);
      row.innerHTML = `<span class="find-result-line">${match.line}:${match.column}</span><span class="find-result-preview">${highlightMatchLine(match)}</span>`;
      rows?.appendChild(row);
      matchIndex += 1;
      resultIndex += 1;
      appended += 1;
      if (matchIndex >= hit.matches.length) {
        hitIndex += 1;
        matchIndex = 0;
        rows = null;
      }
    }
    if (resultIndex < limit && hitIndex < report.hits.length) {
      window.requestAnimationFrame(appendBatch);
      return;
    }
    if (limit < report.total) appendMoreResultsButton(list, report.total - limit, "search");
  };
  appendBatch();
}

function renderProgressiveReplaceResults(
  report: ReplacePreviewDto,
  list: HTMLElement,
  replaceStatus: string,
  renderVersion: number,
) {
  let itemIndex = 0;
  let matchIndex = 0;
  let rendered = 0;
  let rows: HTMLElement | null = null;
  const limit = Math.min(report.total, state.workspaceReplaceVisibleResults);
  const replacement = ($("replaceInput") as HTMLInputElement).value;

  const appendBatch = () => {
    if (renderVersion !== searchResultRenderVersion || !list.isConnected) return;
    const started = performance.now();
    let appended = 0;
    while (itemIndex < report.items.length && rendered < limit && appended < 120 && performance.now() - started < 8) {
      const item = report.items[itemIndex];
      if (matchIndex === 0) {
        const group = document.createElement("section");
        group.className = "find-result-group";
        group.innerHTML = `<header>${iconSvg("FileText")}<strong title="${escapeAttr(item.path)}">${escapeHtml(item.fileName)}</strong><span>${item.matches.length} 处 · ${replaceStatus}</span></header><div></div>`;
        list.appendChild(group);
        rows = group.lastElementChild as HTMLElement;
      }
      const match = item.matches[matchIndex];
      const row = document.createElement("button");
      row.className = "find-result-row";
      row.dataset.path = item.path;
      row.dataset.line = String(match.line);
      row.dataset.column = String(match.column);
      row.innerHTML = `<span class="find-result-line">${match.line}:${match.column}</span><span class="find-result-preview">${escapeHtml(match.matchedText)} <span class="replace-arrow">→</span> ${escapeHtml(replacement)}</span>`;
      rows?.appendChild(row);
      matchIndex += 1;
      rendered += 1;
      appended += 1;
      if (matchIndex >= item.matches.length) {
        itemIndex += 1;
        matchIndex = 0;
        rows = null;
      }
    }
    if (rendered < limit && itemIndex < report.items.length) {
      window.requestAnimationFrame(appendBatch);
      return;
    }
    if (limit < report.total) appendMoreResultsButton(list, report.total - limit, "replace");
  };
  appendBatch();
}

function appendMoreResultsButton(list: HTMLElement, remaining: number, kind: "search" | "replace") {
  const footer = document.createElement("div");
  footer.className = "find-results-more";
  footer.innerHTML = `<span>还有 ${remaining} 处结果</span><button class="tool-button">${iconSvg("ListPlus")}<span>继续显示</span></button>`;
  footer.querySelector("button")?.addEventListener("click", () => {
    if (kind === "search") state.workspaceSearchVisibleResults += 600;
    else state.workspaceReplaceVisibleResults += 600;
    renderSearchSidebarResults();
  });
  list.appendChild(footer);
}

function renderMarkdownOutline() {
  const list = $("outlineList");
  const summary = $("outlineSummary");
  if (!isMarkdownLikeDocument()) {
    summary.textContent = "";
    list.innerHTML = "";
    return;
  }
  const locations = markdownHeadingLocations(activeDocument().model.getValue());
  const muyaOutline = isMarkdownWysiwygActive() ? markdownEditor?.getOutline() : null;
  const headings = muyaOutline
    ? muyaOutline.map((heading, index) => ({
      ...heading,
      line: locations[index]?.line ?? 1,
    }))
    : locations;
  summary.textContent = headings.length > 0 ? `${headings.length} 个标题` : "暂无标题";
  list.innerHTML = headings.length > 0
    ? headings.map((heading, index) => {
      const indent = (heading.level - 1) * 14;
      return `<button class="outline-row" role="treeitem" aria-level="${heading.level}" data-outline-line="${heading.line}" data-outline-index="${index}" data-outline-level="${heading.level}" style="--outline-indent:${indent}px"><span>${escapeHtml(heading.text)}</span><small>${heading.line}</small></button>`;
    }).join("")
    : `<div class="empty">当前 Markdown 文档没有标题</div>`;
  list.querySelectorAll<HTMLButtonElement>("[data-outline-line]").forEach((button) => {
    button.addEventListener("click", () => {
      if (isMarkdownWysiwygActive() && markdownEditor) {
        markdownEditor.revealHeading(Number(button.dataset.outlineIndex ?? "0"));
        markdownEditor.focus();
        return;
      }
      const lineNumber = Number(button.dataset.outlineLine ?? "1");
      editor.setPosition({ lineNumber, column: 1 });
      editor.revealLineInCenterIfOutsideViewport(lineNumber);
      editor.focus();
    });
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

function renderSearchDecorations() {
  if (!searchDecorations || !activeSearchDecoration) return;
  if (!state.results || state.results.total === 0) {
    searchDecorations.clear();
    activeSearchDecoration.clear();
    return;
  }
  const doc = activeDocument();
  const activePath = doc.path || doc.title;
  const decorations: monaco.editor.IModelDeltaDecoration[] = [];
  const activeDecorations: monaco.editor.IModelDeltaDecoration[] = [];
  let index = 0;
  for (const hit of state.results.hits) {
    for (const match of hit.matches) {
      if (hit.path === activePath) {
        const range = rangeFromMatch(match);
        const decoration = {
          range,
          options: {
            className: "search-highlight",
            overviewRuler: {
              color: "#f59e0b",
              position: monaco.editor.OverviewRulerLane.Center,
            },
            minimap: {
              color: "#f59e0b",
              position: monaco.editor.MinimapPosition.Inline,
            },
          },
        };
        if (index === state.activeResultIndex) {
          activeDecorations.push({
            range,
            options: {
              className: "search-highlight active-search-highlight",
              stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
            },
          });
        } else {
          decorations.push(decoration);
        }
      }
      index += 1;
    }
  }
  searchDecorations.set(decorations);
  activeSearchDecoration.set(activeDecorations);
}

function rangeFromMatch(match: TextMatchDto) {
  const parts = match.matchedText.split(/\r\n|\n|\r/);
  if (parts.length === 1) {
    return new monaco.Range(match.line, match.column, match.line, match.column + Math.max(1, match.matchedText.length));
  }
  return new monaco.Range(
    match.line,
    match.column,
    match.line + parts.length - 1,
    parts[parts.length - 1].length + 1,
  );
}

function renderMarkdownSurface() {
  const doc = activeDocument();
  const markdownDocument = isMarkdownLikeDocument(doc);
  const wantsWysiwyg = markdownDocument && state.markdownEditMode === "wysiwyg";
  disposeInactiveMarkdownEditors(wantsWysiwyg ? doc.id : 0);
  const cachedEntry = wantsWysiwyg ? markdownEditorCache.get(doc.id) : null;
  if (cachedEntry) activateMarkdownEditor(cachedEntry, doc);
  else if (wantsWysiwyg && !state.restoring) void ensureMarkdownEditor(doc);

  const showWysiwyg = wantsWysiwyg && markdownEditorDocumentId === doc.id && Boolean(markdownEditor);
  $("editor").style.zIndex = showWysiwyg ? "0" : "2";
  $("editor").setAttribute("aria-hidden", String(showWysiwyg));
  $("markdownWysiwyg").style.zIndex = showWysiwyg ? "2" : "0";
  $("markdownWysiwyg").setAttribute("aria-hidden", String(!showWysiwyg));
  $("editor").parentElement?.classList.toggle("wysiwyg-open", showWysiwyg);

  if (showWysiwyg) {
    markdownEditor?.setReadOnly(editorBusyDepth > 0 || doc.readOnly);
    scheduleMarkdownImageRefresh();
  } else {
    markdownEditorCache.forEach((item) => item.bridge.hideFloatTools());
  }
  void renderMarkdownPreview();
  requestEditorLayout();
}

async function ensureMarkdownEditor(doc: OpenDocument) {
  const cached = markdownEditorCache.get(doc.id);
  if (cached) {
    activateMarkdownEditor(cached, doc);
    return cached.bridge;
  }

  let promise = markdownEditorPromises.get(doc.id);
  if (!promise) {
    promise = createMarkdownEditor(doc).finally(() => {
      markdownEditorPromises.delete(doc.id);
    });
    markdownEditorPromises.set(doc.id, promise);
  }

  const entry = await promise;
  if (!entry) return null;
  const active = activeDocument();
  if (active.id === doc.id && isMarkdownLikeDocument(active) && state.markdownEditMode === "wysiwyg") {
    activateMarkdownEditor(entry, active, true);
    renderMarkdownSurface();
  }
  return entry.bridge;
}

async function createMarkdownEditor(doc: OpenDocument): Promise<MarkdownEditorCacheEntry | null> {
  try {
    const { MarkdownEditorBridge } = await loadMarkdownModule();
    if (
      !state.documents.some((item) => item.id === doc.id)
      || state.activeId !== doc.id
      || state.markdownEditMode !== "wysiwyg"
      || !isMarkdownLikeDocument(doc)
    ) return null;

    const pane = document.createElement("div");
    pane.className = "markdown-editor-pane";
    pane.dataset.documentId = String(doc.id);
    pane.style.zIndex = "0";
    pane.setAttribute("aria-hidden", "true");
    $("markdownWysiwyg").append(pane);

    let bridge: MarkdownEditorBridge | null = null;
    bridge = new MarkdownEditorBridge({
      element: pane,
      markdown: doc.model.getValue(),
      darkMode: state.darkMode,
      fontSize: state.fontSize,
      fontFamily: resolveEditorFontStack(),
      readOnly: editorBusyDepth > 0 || doc.readOnly,
      pickImagePath: pickMarkdownImagePath,
      resolveImageSrc: (source) => resolveMarkdownImageSource(source, doc),
      openLink: openMarkdownLink,
      onHeadingAnchorCopied: (anchor) => log(`已复制标题锚点 ${anchor}`),
      onChange: (markdown) => {
        if (bridge) handleMarkdownEditorChange(doc.id, bridge, markdown);
      },
    });
    const entry = { documentId: doc.id, bridge, pane: bridge.root, lastUsed: performance.now() };
    markdownEditorCache.set(doc.id, entry);
    evictMarkdownEditorCache(doc.id);
    return entry;
  } catch (error) {
    log(`Markdown 即时编辑器加载失败：${String(error)}`);
    throw error;
  }
}

function activateMarkdownEditor(entry: MarkdownEditorCacheEntry, doc: OpenDocument, focus = false) {
  const alreadyActive = markdownEditor === entry.bridge && markdownEditorDocumentId === doc.id;
  markdownEditorCache.forEach((item) => {
    const inactive = item.documentId !== doc.id;
    item.pane.style.zIndex = inactive ? "0" : "1";
    item.pane.setAttribute("aria-hidden", String(inactive));
    if (inactive) item.bridge.hideFloatTools();
  });
  if (!alreadyActive) {
    markdownEditor = entry.bridge;
    markdownEditorDocumentId = doc.id;
    entry.bridge.updateAppearance(state.darkMode, state.fontSize, resolveEditorFontStack());
    observeMarkdownImages(entry.bridge.root);
  }
  entry.lastUsed = performance.now();
  syncMarkdownEditorFromModel(doc, focus);
}

function evictMarkdownEditorCache(keepDocumentId: number) {
  while (markdownEditorCache.size > MAX_MARKDOWN_EDITOR_CACHE) {
    const candidate = Array.from(markdownEditorCache.values())
      .filter((entry) => entry.documentId !== keepDocumentId)
      .sort((left, right) => left.lastUsed - right.lastUsed)[0];
    if (!candidate) return;
    disposeMarkdownEditor(candidate.documentId);
  }
}

function disposeInactiveMarkdownEditors(keepDocumentId: number) {
  Array.from(markdownEditorCache.keys()).forEach((documentId) => {
    if (documentId !== keepDocumentId) disposeMarkdownEditor(documentId);
  });
}

function disposeMarkdownEditor(documentId: number) {
  const entry = markdownEditorCache.get(documentId);
  if (!entry) return;
  if (markdownEditorDocumentId === documentId) {
    markdownImageObserver?.disconnect();
    markdownImageObserver = null;
    window.cancelAnimationFrame(markdownImageRefreshFrame);
    markdownEditor = null;
    markdownEditorDocumentId = 0;
  }
  entry.bridge.destroy();
  entry.pane.remove();
  markdownEditorCache.delete(documentId);
}

function loadMarkdownModule() {
  if (!markdownModulePromise) {
    markdownModulePromise = import("./markdownEditor").catch((error) => {
      markdownModulePromise = null;
      throw error;
    });
  }
  return markdownModulePromise;
}

function handleMarkdownEditorChange(documentId: number, bridge: MarkdownEditorBridge, markdown: string) {
  const doc = state.documents.find((item) => item.id === documentId);
  const modelMarkdown = doc ? markdownForDocumentModel(doc, markdown) : markdown;
  if (
    !doc ||
    doc.id !== state.activeId ||
    state.markdownEditMode !== "wysiwyg" ||
    bridge !== markdownEditor ||
    doc.readOnly ||
    modelMarkdown === doc.model.getValue()
  ) {
    if (doc && modelMarkdown === doc.model.getValue()) bridge.markSynchronized(markdown);
    return;
  }
  markdownSyncingFromEditor = true;
  try {
    replaceModelText(doc.model, modelMarkdown);
  } finally {
    markdownSyncingFromEditor = false;
  }
  bridge.markSynchronized(markdown);
  scheduleMarkdownImageRefresh();
}

function replaceModelText(model: monaco.editor.ITextModel, nextText: string) {
  const currentText = model.getValue();
  if (currentText === nextText) return;

  let prefix = 0;
  const prefixLimit = Math.min(currentText.length, nextText.length);
  while (prefix < prefixLimit && currentText.charCodeAt(prefix) === nextText.charCodeAt(prefix)) prefix += 1;

  let suffix = 0;
  const suffixLimit = Math.min(currentText.length - prefix, nextText.length - prefix);
  while (
    suffix < suffixLimit &&
    currentText.charCodeAt(currentText.length - suffix - 1) === nextText.charCodeAt(nextText.length - suffix - 1)
  ) {
    suffix += 1;
  }

  const start = model.getPositionAt(prefix);
  const end = model.getPositionAt(currentText.length - suffix);
  model.pushEditOperations(
    [],
    [{
      range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
      text: nextText.slice(prefix, nextText.length - suffix),
    }],
    () => null,
  );
}

function markdownForDocumentModel(doc: OpenDocument, markdown: string) {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  return doc.model.getEOL() === "\r\n" ? normalized.replace(/\n/g, "\r\n") : normalized;
}

function syncMarkdownModelFromEditor(doc = activeDocument()) {
  if (
    !markdownEditor ||
    state.markdownEditMode !== "wysiwyg" ||
    state.activeId !== doc.id ||
    markdownEditorDocumentId !== doc.id ||
    doc.readOnly
  ) {
    return;
  }
  if (!markdownEditor.hasUnsynchronizedChanges()) return;
  const editorMarkdown = markdownEditor.getMarkdown();
  const markdown = markdownForDocumentModel(doc, editorMarkdown);
  if (markdown === doc.model.getValue()) {
    markdownEditor.markSynchronized(editorMarkdown);
    return;
  }
  markdownSyncingFromEditor = true;
  try {
    replaceModelText(doc.model, markdown);
  } finally {
    markdownSyncingFromEditor = false;
  }
  markdownEditor.markSynchronized(editorMarkdown);
}

function syncMarkdownEditorFromModel(doc = activeDocument(), focus = false) {
  if (!markdownEditor || !isMarkdownLikeDocument(doc)) return;
  const preserveHistory = markdownEditorDocumentId === doc.id;
  markdownEditorDocumentId = doc.id;
  markdownEditor.setMarkdown(doc.model.getValue(), focus, preserveHistory);
  markdownEditor.setReadOnly(editorBusyDepth > 0 || doc.readOnly);
}

function scheduleMarkdownEditorSync(doc = activeDocument()) {
  if (
    markdownSyncingFromEditor ||
    doc.id !== state.activeId ||
    !isMarkdownLikeDocument(doc) ||
    state.markdownEditMode !== "wysiwyg"
  ) {
    return;
  }
  window.clearTimeout(markdownModelSyncTimer);
  markdownModelSyncTimer = window.setTimeout(() => {
    if (doc.id === state.activeId && state.markdownEditMode === "wysiwyg") {
      syncMarkdownEditorFromModel(doc);
    }
  }, 60);
}

function observeMarkdownImages(root: HTMLElement) {
  markdownImageObserver?.disconnect();
  markdownImageObserver = new MutationObserver(scheduleMarkdownImageRefresh);
  markdownImageObserver.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
  scheduleMarkdownImageRefresh();
}

function scheduleMarkdownImageRefresh() {
  window.cancelAnimationFrame(markdownImageRefreshFrame);
  markdownImageRefreshFrame = window.requestAnimationFrame(refreshMarkdownImages);
}

function refreshMarkdownImages() {
  if (!markdownEditor || markdownEditorDocumentId !== activeDocument().id) return;
  refreshMarkdownResources(markdownEditor.root, activeDocument());
}

function resolveMarkdownImageSource(source: string, doc: OpenDocument) {
  const value = source.trim();
  if (!value || /^(?:https?:|data:|blob:|asset:)/i.test(value)) return "";
  const suffixIndex = value.search(/[?#]/);
  const path = suffixIndex >= 0 ? value.slice(0, suffixIndex) : value;
  const suffix = suffixIndex >= 0 ? value.slice(suffixIndex) : "";
  const absolute = absoluteMarkdownResourcePath(path, doc);
  return absolute ? `${convertFileSrc(absolute)}${suffix}` : "";
}

function refreshMarkdownResources(root: ParentNode, doc: OpenDocument) {
  root.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
    image.loading = "lazy";
    image.decoding = "async";
    const current = image.getAttribute("src") ?? "";
    const stored = image.dataset.notraSource;
    if (/^(?:https?:|data:|blob:|asset:)/i.test(current) && !stored) return;
    if (/^https?:\/\/asset\.localhost\//i.test(current) && stored) return;
    const source = stored && /^https?:\/\/asset\.localhost\//i.test(current) ? stored : current;
    if (!source || /^(?:https?:|data:|blob:|asset:)/i.test(source)) return;
    const converted = resolveMarkdownImageSource(source, doc);
    if (!converted) return;
    image.dataset.notraSource = source;
    if (current !== converted) image.setAttribute("src", converted);
  });
}

function markdownHeadingLocations(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const headings: Array<{ level: number; text: string; line: number }> = [];
  let fence: { marker: "`" | "~"; length: number } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (
        fenceMatch &&
        fenceMatch[1][0] === fence.marker &&
        fenceMatch[1].length >= fence.length &&
        fenceMatch[2].trim() === ""
      ) {
        fence = null;
      }
      continue;
    }
    if (fenceMatch) {
      fence = {
        marker: fenceMatch[1][0] as "`" | "~",
        length: fenceMatch[1].length,
      };
      continue;
    }
    if (/^(?: {4}|\t)/.test(line)) continue;

    const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*?)|[ \t]*)$/.exec(line);
    if (atx) {
      const text = (atx[2] ?? "").replace(/[ \t]+#+[ \t]*$/, "").trim();
      if (text) headings.push({ level: atx[1].length, text, line: index + 1 });
      continue;
    }

    const underline = /^ {0,3}(=+|-+)[ \t]*$/.exec(lines[index + 1] ?? "");
    const text = line.trim();
    if (text && underline) {
      headings.push({ level: underline[1][0] === "=" ? 1 : 2, text, line: index + 1 });
      index += 1;
    }
  }

  return headings;
}

async function renderMarkdownPreview() {
  const doc = activeDocument();
  const preview = $("markdownPreview");
  const editorArea = preview.parentElement;
  const enabled = isMarkdownPreviewEnabled(doc);
  const resize = $("markdownPreviewResize");
  const renderVersion = ++markdownPreviewRenderVersion;
  editorArea?.classList.toggle("preview-open", enabled);
  resize.classList.toggle("hidden", !enabled);
  preview.classList.toggle("hidden", !enabled);
  if (!enabled) {
    markdownPreviewResizeState = null;
    document.body.classList.remove("resizing-markdown-preview");
    preview.innerHTML = "";
    requestEditorLayout();
    return;
  }
  applyMarkdownPreviewWidth();
  const source = doc.model.getValue();
  if (!source.trim()) {
    preview.innerHTML = markdownPreviewShell(doc, source, `<div class="markdown-preview-empty">空白 Markdown</div>`);
    requestEditorLayout();
    return;
  }

  const previousDocumentId = preview.dataset.documentId;
  preview.dataset.documentId = String(doc.id);
  if (!preview.querySelector(".markdown-preview-body") || previousDocumentId !== String(doc.id)) {
    preview.innerHTML = markdownPreviewShell(doc, source, `<div class="markdown-preview-empty">正在生成预览</div>`);
  }
  requestEditorLayout();

  try {
    const { renderMarkdownPreviewDiagrams, renderMarkdownPreviewHtml } = await loadMarkdownModule();
    const body = renderMarkdownPreviewHtml(source, { darkMode: state.darkMode });
    if (!isCurrentMarkdownPreview(renderVersion, doc, source)) return;
    preview.innerHTML = markdownPreviewShell(doc, source, body);
    const previewBody = preview.querySelector<HTMLElement>(".markdown-preview-body");
    if (previewBody) {
      refreshMarkdownResources(previewBody, doc);
      void renderMarkdownPreviewDiagrams(previewBody, { darkMode: state.darkMode })
        .then(() => {
          if (!isCurrentMarkdownPreview(renderVersion, doc, source)) return;
          refreshMarkdownResources(previewBody, doc);
          requestEditorLayout();
        })
        .catch((error) => {
          if (isCurrentMarkdownPreview(renderVersion, doc, source)) {
            log(`Markdown 图表预览失败：${error instanceof Error ? error.message : String(error)}`);
          }
        });
    }
    requestEditorLayout();
    window.requestAnimationFrame(syncMarkdownPreviewScroll);
  } catch (error) {
    if (!isCurrentMarkdownPreview(renderVersion, doc, source)) return;
    preview.innerHTML = markdownPreviewShell(doc, source, `<div class="markdown-preview-empty">预览生成失败</div>`);
    log(`Markdown 预览失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

function markdownPreviewShell(doc: OpenDocument, source: string, body: string) {
  return `
    <header class="markdown-preview-head">
      <div>
        <strong>预览</strong>
        <span>${escapeHtml(doc.title)}</span>
      </div>
      <small>${formatBytes(new Blob([source]).size)}</small>
    </header>
    <div class="markdown-preview-body">${body}</div>
  `;
}

function isCurrentMarkdownPreview(renderVersion: number, doc: OpenDocument, source: string) {
  const active = activeDocument();
  return (
    renderVersion === markdownPreviewRenderVersion &&
    active.id === doc.id &&
    active.model.getValue() === source &&
    isMarkdownPreviewEnabled(active)
  );
}

function handleMarkdownPreviewClick(event: Event) {
  const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
  if (!anchor || !$("markdownPreview").contains(anchor)) return;
  event.preventDefault();
  const href = anchor.getAttribute("href") ?? "";
  if (href.startsWith("#")) {
    let id = href.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      return;
    }
    $("markdownPreview").querySelector<HTMLElement>(`#${CSS.escape(id)}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  openMarkdownLink(href);
}

function scheduleMarkdownPreviewRender() {
  window.clearTimeout(markdownPreviewTimer);
  markdownPreviewTimer = window.setTimeout(() => void renderMarkdownPreview(), 100);
}

function requestEditorLayout(forceRender = true) {
  editorLayoutForceRender ||= forceRender;
  if (editorLayoutFrame !== 0 || editorLayoutSettleFrame !== 0) return;
  editorLayoutFrame = window.requestAnimationFrame(() => {
    editorLayoutFrame = 0;
    if (editorLayoutForceRender) {
      editorLayoutSettleFrame = window.requestAnimationFrame(runEditorLayout);
      return;
    }
    runEditorLayout();
  });
}

function runEditorLayout() {
  editorLayoutSettleFrame = 0;
  const forceRender = editorLayoutForceRender;
  editorLayoutForceRender = false;
  const container = $("editor");
  const rect = container.getBoundingClientRect();
  const width = Math.floor(rect.width);
  const height = Math.floor(rect.height);
  if (width > 0 && height > 0) {
    if (forceRender || width !== editorLayoutWidth || height !== editorLayoutHeight) {
      editor?.layout({ width, height });
      editorLayoutWidth = width;
      editorLayoutHeight = height;
    }
  } else if (forceRender) {
    editor?.layout();
    editorLayoutWidth = -1;
    editorLayoutHeight = -1;
  }
  if (forceRender) editor?.render(true);
}

function restoreEditorSurface() {
  const doc = activeDocument();
  if (!doc || !editor) return;
  const model = doc.model;
  if (editor.getModel() !== model) {
    editor.setModel(model);
  } else {
    // Re-bind the same model to force Monaco to remeasure after a 0-height first layout.
    editor.setModel(null);
    editor.setModel(model);
  }
  applyEditorPerformanceProfile(doc);
  if (doc.viewState) editor.restoreViewState(doc.viewState);
  requestEditorLayout();
}

function attachEditorModel(doc: OpenDocument) {
  // Setting a different model on an already-created editor can leave the view
  // blank (no gutter, no text) until a later resize forces a fresh layout
  // (e.g. opening Find with Ctrl+F). The follow-up requestEditorLayout runs in
  // a rAF that can race Monaco's internal model-swap view setup, so the layout
  // lands on a not-yet-ready view. Rebonding the model recreates the view
  // synchronously within the same tick, guaranteeing the new model paints.
  const changed = editor.getModel() !== doc.model;
  editor.setModel(doc.model);
  if (changed) {
    editor.setModel(null);
    editor.setModel(doc.model);
  }
  applyEditorPerformanceProfile(doc);
  if (doc.viewState) editor.restoreViewState(doc.viewState);
  renderBookmarkDecorations();
  requestEditorLayout();
}

function toggleBookmark() {
  const doc = activeDocument();
  const line = editor.getPosition()?.lineNumber;
  if (!doc || !line) return;
  const key = documentSessionKey(doc);
  const lines = new Set(state.bookmarks[key] ?? []);
  if (lines.has(line)) lines.delete(line);
  else lines.add(line);
  state.bookmarks[key] = [...lines].sort((a, b) => a - b);
  if (state.bookmarks[key].length === 0) delete state.bookmarks[key];
  renderBookmarkDecorations();
  scheduleSessionSave();
  log(lines.has(line) ? `已添加第 ${line} 行书签` : `已移除第 ${line} 行书签`);
}

function navigateBookmark(delta: number) {
  const doc = activeDocument();
  const lines = state.bookmarks[documentSessionKey(doc)] ?? [];
  if (lines.length === 0) {
    log("当前文档没有书签");
    return;
  }
  const current = editor.getPosition()?.lineNumber ?? 1;
  const ordered = delta > 0 ? lines : [...lines].reverse();
  const target = ordered.find((line) => delta > 0 ? line > current : line < current) ?? ordered[0];
  editor.setPosition({ lineNumber: target, column: 1 });
  editor.revealLineInCenterIfOutsideViewport(target);
  editor.focus();
}

function renderBookmarkDecorations() {
  if (!bookmarkDecorations || !editor?.getModel()) return;
  const doc = activeDocument();
  const lineCount = doc.model.getLineCount();
  const lines = (state.bookmarks[documentSessionKey(doc)] ?? []).filter((line) => line >= 1 && line <= lineCount);
  bookmarkDecorations.set(lines.map((line) => ({
    range: new monaco.Range(line, 1, line, 1),
    options: {
      isWholeLine: true,
      linesDecorationsClassName: "notra-bookmark-glyph",
      overviewRuler: {
        color: state.darkMode ? "#858bff" : "#4f46e5",
        position: monaco.editor.OverviewRulerLane.Left,
      },
    },
  })));
}

function syncActiveBookmarkLines(doc = activeDocument()) {
  if (!bookmarkDecorations || editor.getModel() !== doc.model) return;
  const lines: number[] = [];
  for (let index = 0; index < bookmarkDecorations.length; index += 1) {
    const range = bookmarkDecorations.getRange(index);
    if (range) lines.push(range.startLineNumber);
  }
  const key = documentSessionKey(doc);
  if (lines.length > 0) state.bookmarks[key] = [...new Set(lines)].sort((a, b) => a - b);
  else delete state.bookmarks[key];
}

function syncMarkdownPreviewScroll() {
  const doc = activeDocument();
  if (!isMarkdownPreviewEnabled(doc)) return;
  const preview = $("markdownPreview");
  const editorLayout = editor.getLayoutInfo();
  const editorScrollable = Math.max(1, editor.getScrollHeight() - editorLayout.height);
  const previewScrollable = Math.max(0, preview.scrollHeight - preview.clientHeight);
  if (previewScrollable <= 0) return;
  preview.scrollTop = (editor.getScrollTop() / editorScrollable) * previewScrollable;
}

function isMarkdownPreviewEnabled(doc = activeDocument()) {
  return state.markdownEditMode === "split" && isMarkdownLikeDocument(doc);
}

function isMarkdownWysiwygActive(doc = activeDocument()) {
  return state.markdownEditMode === "wysiwyg" && isMarkdownLikeDocument(doc) && markdownEditorDocumentId === doc.id;
}

function isMarkdownEditMode(value: unknown): value is MarkdownEditMode {
  return value === "wysiwyg" || value === "split" || value === "source";
}

function markdownEditModeLabel(mode: MarkdownEditMode) {
  if (mode === "wysiwyg") return "即时编辑";
  if (mode === "split") return "分屏预览";
  return "源码";
}

function isMarkdownLikeDocument(doc = activeDocument()) {
  if (isMarkdownLikeLanguage(doc.language)) return true;
  const name = (doc.path || doc.title).toLowerCase();
  return /\.(md|markdown|mdx|rmd)$/.test(name);
}

function isMarkdownLikeLanguage(language: string) {
  return language.toLowerCase() === "markdown" || language.toLowerCase() === "mdx";
}

function setFindView(view: FindView, persist = true) {
  if (!["find", "replace", "workspace-find", "workspace-replace"].includes(view)) view = "find";
  if ((view === "workspace-find" || view === "workspace-replace") && state.mode !== "workspace") view = "find";
  state.findView = view;
  $("findPopover").dataset.view = view;
  document.querySelectorAll<HTMLButtonElement>("[data-find-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.findView === view);
  });

  const workspaceVisible = view === "workspace-find" || view === "workspace-replace";
  const replaceVisible = view === "replace" || view === "workspace-replace";
  toggleInputRow("replaceInput", replaceVisible);
  $("workspaceSearchFields").classList.toggle("hidden", !workspaceVisible);
  toggleCheckRow("reverseSearchInput", !workspaceVisible);
  toggleCheckRow("wrapSearchInput", !workspaceVisible);
  toggleCheckRow("searchSelectionInput", !workspaceVisible);

  toggleAction("findNextButton", view === "find");
  toggleAction("findPreviousButton", view === "find");
  toggleAction("findCurrentButton", view === "find");
  toggleAction("replaceCurrentButton", view === "replace");
  toggleAction("replaceAllCurrentButton", view === "replace");
  toggleAction("findWorkspaceButton", view === "workspace-find");
  toggleAction("previewWorkspaceReplaceButton", view === "workspace-replace");
  renderCurrentFindMode();
  renderSearchSidebarResults();
  if (persist) scheduleSessionSave();
}

function toggleInputRow(id: string, visible: boolean) {
  $(id).closest(".search-history-field, label")?.classList.toggle("hidden", !visible);
}

function toggleCheckRow(id: string, visible: boolean) {
  $(id).closest("label")?.classList.toggle("hidden", !visible);
}

function toggleAction(id: string, visible: boolean) {
  $(id).classList.toggle("hidden", !visible);
}

function isWorkspaceFindView(view = state.findView) {
  return view === "workspace-find" || view === "workspace-replace";
}

function toggleFindOpen(options: { prefillFromSelection?: boolean } = {}) {
  const workspace = isWorkspaceFindView();
  const input = $(workspace ? "findInput" : "currentFindInput") as HTMLInputElement;
  const currentFindAlreadyOpen = !$("currentFindDock").classList.contains("hidden");
  if (!workspace && !currentFindAlreadyOpen && isMarkdownWysiwygActive() && markdownEditor) {
    markdownEditor.captureSearchSelection();
  }
  if (!workspace) syncSearchControlsToCurrent();
  if (options.prefillFromSelection) {
    const selectedText = selectedEditorTextForFind();
    if (selectedText) {
      input.value = selectedText;
      if (!workspace) syncCurrentFindControls();
      scheduleSessionSave();
    }
  }
  if (isWorkspaceFindView()) {
    setCurrentFindDockOpen(false);
    setRightTool("search");
    $("findPopover").classList.remove("hidden");
    $("app").classList.add("right-sidebar-open");
    setRightSidebarWidth(state.rightSidebarWidth);
    renderRightSidebar();
    renderRightSidebarToggle();
  } else {
    setCurrentFindDockOpen(true);
    closeCurrentFindHistory();
    renderCurrentFindMode();
    requestEditorLayout();
  }
  input.focus();
  input.select();
  if (!workspace) scheduleCurrentFind();
}

function scheduleCurrentFind() {
  syncCurrentFindControls();
  window.clearTimeout(currentFindTimer);
  currentFindTimer = window.setTimeout(() => {
    if ($("currentFindDock").classList.contains("hidden")) return;
    if (!(($("currentFindInput") as HTMLInputElement).value)) {
      resetSearchResults(true);
      return;
    }
    const input = $("currentFindInput") as HTMLInputElement;
    const keepInputFocus = document.activeElement === input;
    findCurrent(false, false);
    if (keepInputFocus) input.focus();
  }, 90);
}

function syncSearchControlsToCurrent() {
  ($("currentFindInput") as HTMLInputElement).value = ($("findInput") as HTMLInputElement).value;
  ($("currentReplaceInput") as HTMLInputElement).value = ($("replaceInput") as HTMLInputElement).value;
  ($("currentMatchCaseInput") as HTMLInputElement).checked = ($("matchCaseInput") as HTMLInputElement).checked;
  ($("currentWholeWordInput") as HTMLInputElement).checked = ($("wholeWordInput") as HTMLInputElement).checked;
  ($("currentRegexInput") as HTMLInputElement).checked = getSearchMode() === "regex";
  renderCurrentFindMode();
  renderCurrentFindCount();
}

function syncCurrentFindControls() {
  ($("findInput") as HTMLInputElement).value = ($("currentFindInput") as HTMLInputElement).value;
  ($("replaceInput") as HTMLInputElement).value = ($("currentReplaceInput") as HTMLInputElement).value;
  ($("matchCaseInput") as HTMLInputElement).checked = ($("currentMatchCaseInput") as HTMLInputElement).checked;
  ($("wholeWordInput") as HTMLInputElement).checked = ($("currentWholeWordInput") as HTMLInputElement).checked;
  setSearchMode(($("currentRegexInput") as HTMLInputElement).checked ? "regex" : "literal");
  scheduleSessionSave();
}

function renderCurrentFindMode() {
  const replace = state.findView === "replace";
  $("currentReplaceInput").classList.toggle("hidden", !replace);
  $("currentReplaceButton").classList.toggle("hidden", !replace);
  $("currentReplaceAllButton").classList.toggle("hidden", !replace);
}

function renderCurrentFindCount() {
  const currentResults = state.searchScope === "current" ? state.results : null;
  if (!currentResults || currentResults.total === 0) {
    $("currentFindCount").textContent = "0 个结果";
    return;
  }
  const active = state.activeResultIndex >= 0 ? state.activeResultIndex + 1 : 0;
  $("currentFindCount").textContent = active > 0 ? `${active}/${currentResults.total}` : `${currentResults.total} 个结果`;
}

function currentSearchPatternError(query: string) {
  if (!(($("currentRegexInput") as HTMLInputElement).checked) || !query) return "";
  try {
    const expression = new RegExp(query);
    return expression.test("") ? "正则表达式不能匹配空字符串" : "";
  } catch {
    return "正则表达式无效";
  }
}

function setCurrentFindError(message: string) {
  const input = $<HTMLInputElement>("currentFindInput");
  input.classList.toggle("error", Boolean(message));
  input.setAttribute("aria-invalid", String(Boolean(message)));
  if (message) input.title = message;
  else input.removeAttribute("title");
}

function setCurrentFindDockOpen(open: boolean) {
  $("currentFindDock").classList.toggle("hidden", !open);
  document.body.classList.toggle("current-find-open", open);
  if (open) markdownEditor?.hideFloatTools();
}

function closeFind() {
  if (!$("currentFindDock").classList.contains("hidden")) {
    syncCurrentFindControls();
    commitSearchHistory();
    closeCurrentFindHistory();
    setCurrentFindDockOpen(false);
    resetSearchResults();
    requestEditorLayout();
    focusActiveEditor();
    return;
  }
  closeRightSidebar();
}

function closeRightSidebar() {
  if (workspaceSearchIsBusy()) {
    state.workspaceSearchRequestId += 1;
    state.workspaceSearchStatus = "idle";
    state.workspaceSearchError = "";
  }
  $("findPopover").classList.add("hidden");
  closeSearchHistory();
  $("app").classList.remove("right-sidebar-open");
  renderRightSidebarToggle();
  requestEditorLayout();
  focusActiveEditor();
  scheduleSessionSave();
}

function focusActiveEditor() {
  if (isMarkdownWysiwygActive() && markdownEditor) markdownEditor.focus();
  else editor.focus();
}

function toggleRightSidebar() {
  if (!$("findPopover").classList.contains("hidden")) {
    closeRightSidebar();
    return;
  }
  const workspace = state.mode === "workspace" && Boolean(state.workspace);
  const markdown = isMarkdownLikeDocument();
  const currentResults = hasCurrentSearchResults();
  if (!workspace && !markdown && !currentResults) return;
  if (currentResults) {
    state.rightTool = "search";
  } else if (workspace) {
    setFindView(isWorkspaceFindView() ? state.findView : "workspace-find");
    state.rightTool = "search";
    setCurrentFindDockOpen(false);
  } else {
    state.rightTool = "outline";
  }
  $("findPopover").classList.remove("hidden");
  $("app").classList.add("right-sidebar-open");
  setRightSidebarWidth(state.rightSidebarWidth);
  renderRightSidebar();
  renderRightSidebarToggle();
  if (state.rightTool === "search") ($("findInput") as HTMLInputElement).focus();
  scheduleSessionSave();
}

function renderRightSidebarToggle() {
  const available = (state.mode === "workspace" && Boolean(state.workspace))
    || isMarkdownLikeDocument()
    || hasCurrentSearchResults();
  const open = !$("findPopover").classList.contains("hidden");
  const button = $<HTMLButtonElement>("rightSidebarToggleButton");
  $("rightToolTabs").classList.toggle("hidden", !available);
  button.classList.toggle("hidden", !available);
  const label = open ? "收起右侧栏" : "打开右侧工具栏";
  button.classList.toggle("active", open);
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = iconSvg(open ? "PanelRightClose" : "PanelRightOpen");
}

function setRightTool(tool: RightTool) {
  if (tool === "outline" && !isMarkdownLikeDocument()) tool = "search";
  state.rightTool = tool;
  renderRightSidebar();
  scheduleSessionSave();
}

function openMarkdownOutline() {
  if (!isMarkdownLikeDocument()) return;
  state.rightTool = "outline";
  $("findPopover").classList.remove("hidden");
  $("app").classList.add("right-sidebar-open");
  setRightSidebarWidth(state.rightSidebarWidth);
  renderRightSidebar();
  renderRightSidebarToggle();
  scheduleSessionSave();
}

function renderRightSidebar() {
  const markdown = isMarkdownLikeDocument();
  const workspace = state.mode === "workspace" && Boolean(state.workspace);
  const searchAvailable = workspace || hasCurrentSearchResults();
  $("rightSearchToolButton").classList.toggle("hidden", !searchAvailable);
  $("rightOutlineToolButton").classList.toggle("hidden", !markdown);
  document.querySelectorAll<HTMLElement>(".workspace-find-view").forEach((button) => {
    button.classList.toggle("hidden", !workspace);
  });
  if (!searchAvailable && state.rightTool === "search") state.rightTool = markdown ? "outline" : "search";
  if (!markdown && state.rightTool === "outline") state.rightTool = searchAvailable ? "search" : "outline";
  $("rightSearchToolButton").classList.toggle("active", state.rightTool === "search");
  $("rightOutlineToolButton").classList.toggle("active", state.rightTool === "outline");
  $("searchToolPane").classList.toggle("hidden", state.rightTool !== "search");
  $("outlineToolPane").classList.toggle("hidden", state.rightTool !== "outline");
  renderSearchSidebarResults();
  renderMarkdownOutline();
  renderRightSidebarToggle();
}

function hasCurrentSearchResults() {
  return state.searchScope === "current" && state.results !== null;
}

function selectedEditorTextForFind() {
  if (isMarkdownWysiwygActive() && markdownEditor) {
    const normalized = markdownEditor.selectedText().replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (!normalized || normalized.includes("\n") || normalized.trim().length === 0) return "";
    return normalized.slice(0, 300);
  }
  const selection = editor.getSelection();
  const model = editor.getModel();
  if (!selection || selection.isEmpty() || !model) return "";
  const normalized = model.getValueInRange(selection).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized || normalized.includes("\n") || normalized.trim().length === 0) return "";
  return normalized.slice(0, 300);
}

function toggleMenu(id: "languageMenu" | "encodingMenu" | "lineEndingMenu" | "recentMenu") {
  const menu = $(id);
  const open = menu.classList.contains("hidden");
  closeMenus();
  closeFontDropdowns();
  menu.classList.toggle("hidden", !open);
  if (open) {
    const triggerId = id === "recentMenu"
      ? "recentButton"
      : id === "languageMenu"
        ? "languageButton"
        : id === "encodingMenu"
          ? "encodingButton"
          : "lineEndingButton";
    const trigger = $<HTMLButtonElement>(triggerId);
    const rect = trigger.getBoundingClientRect();
    menu.style.right = "auto";
    const menuWidth = menu.offsetWidth || (id === "recentMenu" ? 480 : id === "languageMenu" ? 430 : 360);
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8))}px`;
    if (id === "recentMenu") {
      const menuHeight = menu.offsetHeight || Math.min(560, window.innerHeight - 120);
      menu.style.bottom = "auto";
      menu.style.top = `${Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - menuHeight - 8))}px`;
    } else {
      menu.style.top = "auto";
      menu.style.bottom = `${Math.max(34, window.innerHeight - rect.top + 4)}px`;
    }
    trigger.setAttribute("aria-expanded", "true");
  }
  if (open && id === "languageMenu") {
    const input = $("languageSearchInput") as HTMLInputElement;
    input.focus();
    input.select();
  }
}

async function openWorkspaceFind(view: "workspace-find" | "workspace-replace") {
  if (!state.workspace) {
    await enterWorkspaceMode();
    if (!state.workspace) return;
  } else if (state.mode !== "workspace") {
    setWorkMode("workspace");
  }
  ($("directoryInput") as HTMLInputElement).value ||= state.workspace.root;
  setFindView(view);
  toggleFindOpen({ prefillFromSelection: true });
}

function toggleAppMenu(id: "fileMenu" | "editMenu" | "searchMenu" | "viewMenu", trigger: HTMLButtonElement) {
  if ($(id).classList.contains("hidden")) {
    openAppMenu(id, trigger);
  } else {
    closeMenus();
    trigger.focus();
  }
}

function openAppMenu(id: "fileMenu" | "editMenu" | "searchMenu" | "viewMenu", trigger: HTMLButtonElement) {
  closeMenus();
  const menu = $(id);
  const triggerRect = trigger.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(triggerRect.left, window.innerWidth - 280))}px`;
  menu.style.top = "38px";
  menu.classList.remove("hidden");
  trigger.setAttribute("aria-expanded", "true");
  menu.querySelector<HTMLButtonElement>(".menu-row:not(:disabled)")?.focus();
}

function activeAppMenu() {
  return [$("fileMenu"), $("editMenu"), $("searchMenu"), $("viewMenu")].find(
    (menu) => !menu.classList.contains("hidden"),
  ) ?? null;
}

function closeMenus() {
  $("languageMenu").classList.add("hidden");
  $("encodingMenu").classList.add("hidden");
  $("lineEndingMenu").classList.add("hidden");
  $("recentMenu").classList.add("hidden");
  $("tabMenu").classList.add("hidden");
  $("treeMenu").classList.add("hidden");
  $("markdownContextMenu").classList.add("hidden");
  $("markdownTableContextMenu").classList.add("hidden");
  closeMarkdownSubmenus();
  $("fileMenu").classList.add("hidden");
  $("editMenu").classList.add("hidden");
  $("searchMenu").classList.add("hidden");
  $("viewMenu").classList.add("hidden");
  document.querySelectorAll<HTMLButtonElement>(".app-menu-trigger").forEach((trigger) => {
    trigger.setAttribute("aria-expanded", "false");
  });
  ["languageButton", "encodingButton", "lineEndingButton", "recentButton"].forEach((id) => {
    $<HTMLButtonElement>(id).setAttribute("aria-expanded", "false");
  });
}

function hasOpenFontDropdown() {
  return Boolean(document.querySelector(".font-dropdown-menu:not(.hidden)"));
}

function closeFontDropdowns() {
  document.querySelectorAll<HTMLElement>(".font-dropdown-menu").forEach((menu) => menu.classList.add("hidden"));
  document.querySelectorAll<HTMLButtonElement>("[data-font-dropdown-trigger]").forEach((trigger) => {
    trigger.setAttribute("aria-expanded", "false");
  });
}

function openCommandPalette(mode: "commands" | "files" = "commands") {
  commandPaletteMode = mode;
  const palette = $("commandPalette");
  palette.classList.remove("hidden");
  const input = $("commandInput") as HTMLInputElement;
  input.value = "";
  input.placeholder = mode === "files" ? "输入文件名或路径" : "输入命令";
  input.setAttribute("aria-label", mode === "files" ? "快速打开文件" : "命令面板");
  commandActiveIndex = 0;
  renderCommandList("");
  input.focus();
  input.oninput = () => {
    commandActiveIndex = 0;
    renderCommandList(input.value);
  };
  input.onkeydown = (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveCommandSelection(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const active = $("commandList").querySelector<HTMLButtonElement>(".command-row.active");
    active?.click();
  };
}

function openQuickOpen() {
  openCommandPalette("files");
}

function openCurrentFind(view: "find" | "replace") {
  setFindView(view);
  toggleFindOpen({ prefillFromSelection: true });
}

function runEditorAction(actionId: string, successMessage?: string) {
  if (isMarkdownWysiwygActive() && markdownEditor) {
    if (actionId === "editor.action.selectAll") {
      markdownEditor.selectAll();
      return;
    }
    const clipboardCommands: Record<string, string> = {
      "editor.action.clipboardCopyAction": "copy",
      "editor.action.clipboardCutAction": "cut",
      "editor.action.clipboardPasteAction": "paste",
    };
    const clipboardCommand = clipboardCommands[actionId];
    if (clipboardCommand) {
      markdownEditor.focus();
      document.execCommand(clipboardCommand);
      return;
    }
  }
  editor.trigger("command", actionId, null);
  editor.focus();
  if (successMessage) log(successMessage);
}

function undoEditor() {
  if (isMarkdownWysiwygActive() && markdownEditor) {
    markdownEditor.undo();
    markdownEditor.focus();
    return;
  }
  editor.trigger("command", "undo", null);
  editor.focus();
}

function redoEditor() {
  if (isMarkdownWysiwygActive() && markdownEditor) {
    markdownEditor.redo();
    markdownEditor.focus();
    return;
  }
  editor.trigger("command", "redo", null);
  editor.focus();
}

function selectAllEditor() {
  if (isMarkdownWysiwygActive() && markdownEditor) {
    markdownEditor.selectAll();
    return;
  }
  runEditorAction("editor.action.selectAll");
}

function transformToUppercase() {
  runEditorAction("editor.action.transformToUppercase", "已转为大写");
}

function transformToLowercase() {
  runEditorAction("editor.action.transformToLowercase", "已转为小写");
}

async function goToLine() {
  const model = editor.getModel();
  if (!model) return;
  const lineCount = model.getLineCount();
  let value = String(editor.getPosition()?.lineNumber ?? 1);
  let subtitle = `当前文档共 ${lineCount} 行`;

  while (true) {
    const input = await askTextInput({
      title: "跳转到行",
      subtitle,
      label: `行号（1 - ${lineCount}）`,
      value,
      inputMode: "numeric",
    });
    if (input === null) {
      editor.focus();
      return;
    }
    const lineNumber = Number(input);
    if (Number.isInteger(lineNumber) && lineNumber >= 1 && lineNumber <= lineCount) {
      editor.setPosition({ lineNumber, column: 1 });
      editor.revealLineInCenterIfOutsideViewport(lineNumber);
      editor.focus();
      log(`跳转到第 ${lineNumber} 行`);
      return;
    }
    value = input;
    subtitle = `请输入 1 到 ${lineCount} 之间的整数`;
  }
}

function renderCommandList(query: string) {
  type PaletteEntry = { title: string; detail: string; shortcut: string; action: () => void };
  const normalizedQuery = query.trim().toLowerCase();
  const all: PaletteEntry[] = commandPaletteMode === "files"
    ? quickOpenEntries().filter((item) => `${item.title} ${item.detail}`.toLowerCase().includes(normalizedQuery))
    : [...appCommands.values()]
      .filter(commandVisibleInPalette)
      .filter((item) => `${item.title} ${item.category} ${item.id}`.toLowerCase().includes(normalizedQuery))
      .map((item) => ({
        title: item.title,
        detail: item.category,
        shortcut: activeCommandBindings(item.id)[0] ?? "",
        action: () => void executeAppCommand(item),
      }));
  const visible = all.slice(0, 160);
  commandActions = visible.map((item) => item.action);
  commandActiveIndex = Math.min(commandActiveIndex, Math.max(0, commandActions.length - 1));
  $("commandList").innerHTML = "";
  if (all.length === 0) {
    $("commandList").innerHTML = `<div class="empty compact">${commandPaletteMode === "files" ? "没有匹配文件" : "没有匹配命令"}</div>`;
    return;
  }
  visible.forEach((item, index) => {
    const button = document.createElement("button");
    button.className = `command-row ${index === commandActiveIndex ? "active" : ""}`;
    button.dataset.commandIndex = String(index);
    button.innerHTML = `<strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.detail)}</span>${item.shortcut ? `<kbd>${escapeHtml(bindingLabel(item.shortcut))}</kbd>` : ""}`;
    button.onpointerenter = () => {
      commandActiveIndex = index;
      renderCommandSelection();
    };
    button.onclick = () => {
      $("commandPalette").classList.add("hidden");
      item.action();
    };
    $("commandList").appendChild(button);
  });
}

function setKeymapProfile(value: string) {
  if (!isKeymapProfile(value) || value === state.keymapProfile) return;
  state.keymapProfile = value;
  clearPendingKeybindingChord();
  renderSettingsMenu();
  renderShortcutHints();
  scheduleSessionSave();
  log(`键位方案已切换为 ${KEYMAP_PROFILE_LABELS[value]}`);
}

function keymapProfileDetail() {
  if (state.keymapProfile === "adaptive") {
    const resolved = resolveKeymapProfile(state.keymapProfile, state.mode);
    return `当前${state.mode === "workspace" ? "工作区" : "单文件"}模式使用 ${KEYMAP_PROFILE_LABELS[resolved]} 键位`;
  }
  return `工作区和单文件统一使用 ${KEYMAP_PROFILE_LABELS[state.keymapProfile]} 键位`;
}

function renderKeybindingSettings() {
  const list = $("keybindingList");
  const query = ($<HTMLInputElement>("keybindingSearchInput").value ?? "").trim().toLowerCase();
  const commands = [...appCommands.values()]
    .filter((item) => {
      const bindings = activeCommandBindings(item.id).join(" ");
      return !query || `${item.title} ${item.category} ${item.id} ${bindings}`.toLowerCase().includes(query);
    })
    .sort((a, b) => KEYBINDING_CATEGORY_ORDER.indexOf(a.category) - KEYBINDING_CATEGORY_ORDER.indexOf(b.category)
      || a.title.localeCompare(b.title, "zh-CN"));
  if (commands.length === 0) {
    list.innerHTML = `<div class="empty compact">没有匹配的快捷键</div>`;
    updateKeybindingGroupToggle([], query);
    return;
  }
  const conflicts = keybindingConflictMap();
  const groups = KEYBINDING_CATEGORY_ORDER
    .map((category) => ({ category, commands: commands.filter((item) => item.category === category) }))
    .filter((group) => group.commands.length > 0);
  list.innerHTML = "";
  for (const { category, commands: categoryCommands } of groups) {
    const collapsed = !query && collapsedKeybindingCategories.has(category);
    const customCount = categoryCommands.filter((item) => Object.prototype.hasOwnProperty.call(state.keybindingOverrides, item.id)).length;
    const group = document.createElement("section");
    const groupId = `keybinding-group-${KEYBINDING_CATEGORY_ORDER.indexOf(category)}`;
    group.className = `keybinding-group ${collapsed ? "collapsed" : ""}`;
    group.setAttribute("role", "group");
    group.setAttribute("aria-labelledby", `${groupId}-label`);
    group.innerHTML = `
      <button class="keybinding-group-toggle" type="button" data-keybinding-category="${escapeAttr(category)}" aria-expanded="${String(!collapsed)}" ${query ? "disabled" : ""}>
        <span class="keybinding-group-icon">${iconSvg(KEYBINDING_CATEGORY_ICONS[category])}</span>
        <strong id="${groupId}-label">${escapeHtml(category)}</strong>
        <span class="keybinding-group-meta">${categoryCommands.length} 个命令${customCount > 0 ? ` · ${customCount} 个自定义` : ""}</span>
        <span class="keybinding-group-chevron">${iconSvg("ChevronDown")}</span>
      </button>
      <div class="keybinding-group-body"></div>
    `;
    const body = group.querySelector<HTMLElement>(".keybinding-group-body")!;
    categoryCommands.forEach((item) => body.appendChild(createKeybindingRow(item, conflicts)));
    list.appendChild(group);
  }
  updateKeybindingGroupToggle(groups.map((group) => group.category), query);
  list.querySelectorAll<HTMLButtonElement>("[data-keybinding-category]").forEach((button) => {
    button.addEventListener("click", () => toggleKeybindingGroup(button.dataset.keybindingCategory as CommandCategory));
  });
  list.querySelectorAll<HTMLButtonElement>("[data-record-command]").forEach((button) => {
    button.addEventListener("click", () => startKeybindingRecording(button.dataset.recordCommand ?? ""));
    button.addEventListener("keydown", (event) => {
      if (recordingKeybindingCommandId === button.dataset.recordCommand) handleKeybindingRecorder(event);
    });
  });
  list.querySelectorAll<HTMLButtonElement>("[data-reset-command]").forEach((button) => {
    button.addEventListener("click", () => resetKeybinding(button.dataset.resetCommand ?? ""));
  });
}

function createKeybindingRow(item: AppCommand, conflicts: ReadonlyMap<string, string[]>) {
  const row = document.createElement("div");
  row.className = "keybinding-row";
  row.setAttribute("role", "listitem");
  const bindings = activeCommandBindings(item.id);
  const recording = recordingKeybindingCommandId === item.id;
  const displayBindings = recording && recordingKeybindingStrokes.length > 0
    ? [recordingKeybindingStrokes.join(" ")]
    : bindings;
  const conflict = bindings.some((binding) => (conflicts.get(binding)?.length ?? 0) > 1);
  const custom = Object.prototype.hasOwnProperty.call(state.keybindingOverrides, item.id);
  row.innerHTML = `
    <div class="keybinding-command"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.id)}</span></div>
    <button class="keybinding-value ${recording ? "recording" : ""} ${conflict ? "conflict" : ""}" type="button" data-record-command="${escapeAttr(item.id)}" title="${conflict ? "存在快捷键冲突" : "点击重新录入"}">
      ${recording && displayBindings.length === 0 ? `<span class="keybinding-empty">请按快捷键...</span>` : renderBindingKeys(displayBindings)}
    </button>
    <div class="keybinding-actions"><span class="keybinding-source">${custom ? "自定义" : KEYMAP_PROFILE_LABELS[resolveKeymapProfile(state.keymapProfile, state.mode)]}</span><button class="keybinding-reset" type="button" data-reset-command="${escapeAttr(item.id)}" aria-label="恢复 ${escapeAttr(item.title)} 默认快捷键" title="恢复默认" ${custom ? "" : "disabled"}>${iconSvg("Undo2")}</button></div>
  `;
  return row;
}

function toggleKeybindingGroup(category: CommandCategory) {
  if (!KEYBINDING_CATEGORY_ORDER.includes(category)) return;
  if (collapsedKeybindingCategories.has(category)) collapsedKeybindingCategories.delete(category);
  else collapsedKeybindingCategories.add(category);
  renderKeybindingSettings();
}

function toggleAllKeybindingGroups() {
  if (($<HTMLInputElement>("keybindingSearchInput").value ?? "").trim()) return;
  const categories = KEYBINDING_CATEGORY_ORDER.filter((category) =>
    [...appCommands.values()].some((item) => item.category === category));
  const collapse = !categories.every((category) => collapsedKeybindingCategories.has(category));
  categories.forEach((category) => {
    if (collapse) collapsedKeybindingCategories.add(category);
    else collapsedKeybindingCategories.delete(category);
  });
  renderKeybindingSettings();
}

function updateKeybindingGroupToggle(categories: CommandCategory[], query: string) {
  const button = $<HTMLButtonElement>("toggleKeybindingGroupsButton");
  const allCollapsed = categories.length > 0 && categories.every((category) => collapsedKeybindingCategories.has(category));
  const label = button.querySelector<HTMLElement>("[data-label]");
  const text = allCollapsed ? "全部展开" : "全部收起";
  if (label) label.textContent = text;
  button.disabled = Boolean(query) || categories.length === 0;
  button.title = query ? "清除搜索后可折叠分组" : text;
}

function renderBindingKeys(bindings: string[]) {
  if (bindings.length === 0) return `<span class="keybinding-empty">未绑定</span>`;
  return bindings.map((binding) => binding
    .split(" ")
    .map((stroke) => `<kbd>${escapeHtml(bindingLabel(stroke))}</kbd>`)
    .join(`<span class="keybinding-empty">然后</span>`))
    .join(`<span class="keybinding-empty">或</span>`);
}

function keybindingConflictMap() {
  const map = new globalThis.Map<string, string[]>();
  for (const item of appCommands.values()) {
    for (const binding of activeCommandBindings(item.id)) {
      const ids = map.get(binding) ?? [];
      const overlaps = ids.some((id) => (appCommands.get(id)?.priority ?? 0) === (item.priority ?? 0));
      if (ids.length === 0 || overlaps) map.set(binding, [...ids, item.id]);
      else map.set(binding, ids);
    }
  }
  return map;
}

function startKeybindingRecording(commandId: string) {
  const item = appCommands.get(commandId);
  if (!item) return;
  window.clearTimeout(recordingKeybindingTimer);
  recordingKeybindingCommandId = commandId;
  recordingKeybindingStrokes = [];
  collapsedKeybindingCategories.delete(item.category);
  renderKeybindingSettings();
  listRecordingButton(commandId)?.focus();
}

function handleKeybindingRecorder(event: KeyboardEvent) {
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "Escape") {
    cancelKeybindingRecording();
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    state.keybindingOverrides[recordingKeybindingCommandId] = null;
    finishKeybindingRecordingState();
    renderSettingsMenu();
    renderShortcutHints();
    scheduleSessionSave();
    return;
  }
  const stroke = keyboardEventStroke(event);
  if (!stroke || stroke === "Enter") return;
  recordingKeybindingStrokes.push(stroke);
  renderKeybindingSettings();
  listRecordingButton(recordingKeybindingCommandId)?.focus();
  window.clearTimeout(recordingKeybindingTimer);
  if (recordingKeybindingStrokes.length >= 2) {
    void commitRecordedKeybinding();
  } else {
    recordingKeybindingTimer = window.setTimeout(() => void commitRecordedKeybinding(), 900);
  }
}

async function commitRecordedKeybinding() {
  const commandId = recordingKeybindingCommandId;
  const binding = normalizeBinding(recordingKeybindingStrokes.join(" "));
  if (!commandId || !binding) return;
  const conflicts = [...appCommands.values()].filter((item) =>
    item.id !== commandId && activeCommandBindings(item.id).includes(binding),
  );
  if (conflicts.length > 0) {
    const confirmed = await askConfirm({
      title: "快捷键冲突",
      subtitle: bindingLabel(binding),
      body: `该按键已用于：${conflicts.map((item) => item.title).join("、")}。继续后将移除这些命令的同键绑定。`,
      okLabel: "继续绑定",
      cancelLabel: "取消",
    });
    if (!confirmed) {
      cancelKeybindingRecording();
      return;
    }
    conflicts.forEach((item) => { state.keybindingOverrides[item.id] = null; });
  }
  state.keybindingOverrides[commandId] = binding;
  finishKeybindingRecordingState();
  renderSettingsMenu();
  renderShortcutHints();
  scheduleSessionSave();
}

function cancelKeybindingRecording() {
  finishKeybindingRecordingState();
  renderKeybindingSettings();
}

function finishKeybindingRecordingState() {
  window.clearTimeout(recordingKeybindingTimer);
  recordingKeybindingCommandId = "";
  recordingKeybindingStrokes = [];
}

function listRecordingButton(commandId: string) {
  return $("keybindingList").querySelector<HTMLButtonElement>(`[data-record-command="${CSS.escape(commandId)}"]`);
}

function resetKeybinding(commandId: string) {
  if (!Object.prototype.hasOwnProperty.call(state.keybindingOverrides, commandId)) return;
  delete state.keybindingOverrides[commandId];
  renderSettingsMenu();
  renderShortcutHints();
  scheduleSessionSave();
}

async function resetAllKeybindings() {
  if (Object.keys(state.keybindingOverrides).length === 0) return;
  const confirmed = await askConfirm({
    title: "恢复默认快捷键",
    subtitle: KEYMAP_PROFILE_LABELS[state.keymapProfile],
    body: "所有自定义快捷键将恢复为当前键位方案的默认值。",
    okLabel: "恢复默认",
    cancelLabel: "取消",
  });
  if (!confirmed) return;
  state.keybindingOverrides = {};
  renderSettingsMenu();
  renderShortcutHints();
  scheduleSessionSave();
}

async function exportKeybindings() {
  const path = await invoke<string | null>("pick_save_path", {
    request: { defaultDir: preferredDialogDirectory(), fileName: "notra-keybindings.json" },
  });
  if (!path) return;
  const text = JSON.stringify({
    version: 1,
    profile: state.keymapProfile,
    overrides: state.keybindingOverrides,
  }, null, 2);
  await invoke("save_document", {
    request: { path, text, encoding: "UTF-8", lineEnding: "LF" },
  });
  log(`快捷键已导出 ${path}`);
}

async function importKeybindings() {
  const path = await invoke<string | null>("pick_file_path", {
    request: { defaultDir: preferredDialogDirectory() },
  });
  if (!path) return;
  try {
    const dto = await invoke<DocumentDto>("open_path", { path });
    const parsed = JSON.parse(dto.text) as { profile?: unknown; overrides?: unknown };
    const profile = isKeymapProfile(parsed.profile) ? parsed.profile : state.keymapProfile;
    const overrides = normalizeKeybindingOverrides(parsed.overrides);
    const unknown = Object.keys(overrides).filter((commandId) => !appCommands.has(commandId));
    if (unknown.length > 0) throw new Error(`包含未知命令：${unknown.slice(0, 4).join("、")}`);
    state.keymapProfile = profile;
    state.keybindingOverrides = overrides;
    renderSettingsMenu();
    renderShortcutHints();
    scheduleSessionSave();
    log(`快捷键已导入 ${path}`);
  } catch (error) {
    log(`快捷键导入失败：${String(error)}`);
  }
}

async function pastePlainText() {
  if (isMarkdownWysiwygActive() && markdownEditor) {
    await markdownEditor.pasteAsPlainText();
    return;
  }
  try {
    const text = await navigator.clipboard.readText();
    const selections = editor.getSelections() ?? [];
    editor.executeEdits("paste-plain", selections.map((range) => ({ range, text, forceMoveMarkers: true })));
    editor.focus();
  } catch (error) {
    log(`粘贴纯文本失败：${String(error)}`);
  }
}

async function runMarkdownShortcutAction(action: string) {
  if (isMarkdownWysiwygActive() && markdownEditor) {
    await runMarkdownContextAction(action);
    return;
  }
  if (!isMarkdownLikeDocument()) return;
  if (action.startsWith("format:")) {
    applyMarkdownInlineFormat(action.slice("format:".length));
    return;
  }
  if (action.startsWith("paragraph:")) {
    applyMarkdownParagraphFormat(action.slice("paragraph:".length));
    return;
  }
  if (action === "insert:image") {
    const path = await pickMarkdownImagePath();
    if (path) insertMarkdownSnippet(`![图片](${path})`);
    return;
  }
  if (action === "insert:table") {
    insertMarkdownSnippet("| 列 1 | 列 2 |\n| --- | --- |\n|     |     |");
  }
}

function applyMarkdownInlineFormat(format: string) {
  const markers: Record<string, readonly [string, string]> = {
    strong: ["**", "**"],
    em: ["*", "*"],
    inline_code: ["`", "`"],
    link: ["[", "](url)"],
  };
  const marker = markers[format];
  if (!marker) return;
  const model = editor.getModel();
  const selections = editor.getSelections() ?? [];
  if (!model || selections.length === 0) return;
  editor.executeEdits("markdown-format", selections.map((range) => ({
    range,
    text: `${marker[0]}${model.getValueInRange(range)}${marker[1]}`,
    forceMoveMarkers: true,
  })));
  editor.focus();
}

function applyMarkdownParagraphFormat(format: string) {
  const model = editor.getModel();
  const selections = editor.getSelections() ?? [];
  if (!model || selections.length === 0) return;
  if (format === "pre" || format === "mathblock") {
    const fence = format === "pre" ? "```" : "$$";
    editor.executeEdits("markdown-block", selections.map((range) => ({
      range,
      text: `${fence}\n${model.getValueInRange(range)}\n${fence}`,
      forceMoveMarkers: true,
    })));
    editor.focus();
    return;
  }
  const heading = format.match(/^heading ([1-6])$/)?.[1];
  const lines = new Set<number>();
  selections.forEach((range) => {
    for (let line = range.startLineNumber; line <= range.endLineNumber; line += 1) lines.add(line);
  });
  editor.executeEdits("markdown-paragraph", [...lines].map((lineNumber) => {
    const range = new monaco.Range(lineNumber, 1, lineNumber, model.getLineMaxColumn(lineNumber));
    const content = model.getLineContent(lineNumber).replace(/^\s{0,3}#{1,6}\s+/, "");
    return { range, text: heading ? `${"#".repeat(Number(heading))} ${content}` : content };
  }));
  editor.focus();
}

function insertMarkdownSnippet(text: string) {
  const selections = editor.getSelections() ?? [];
  editor.executeEdits("markdown-insert", selections.map((range) => ({ range, text, forceMoveMarkers: true })));
  editor.focus();
}

function commandVisibleInPalette(item: AppCommand) {
  if (!(item.enabled?.() ?? true)) return false;
  if (item.id.startsWith("markdown.")) return isMarkdownLikeDocument();
  return true;
}

function quickOpenEntries() {
  const entries: Array<{ title: string; detail: string; shortcut: string; action: () => void }> = [];
  const seen = new Set<string>();
  for (const doc of state.documents) {
    const key = doc.path ?? `document:${doc.id}`;
    seen.add(key.toLowerCase());
    entries.push({
      title: doc.title,
      detail: doc.path ?? "已打开的临时文件",
      shortcut: "",
      action: () => activateDocument(doc.id),
    });
  }
  for (const item of state.workspace?.items ?? []) {
    if (item.isDir || seen.has(item.path.toLowerCase())) continue;
    seen.add(item.path.toLowerCase());
    entries.push({ title: item.name, detail: item.path, shortcut: "", action: () => void openPath(item.path) });
  }
  for (const path of state.recentFiles) {
    if (seen.has(path.toLowerCase())) continue;
    seen.add(path.toLowerCase());
    entries.push({ title: fileNameFromPath(path), detail: path, shortcut: "", action: () => void openPath(path, true) });
  }
  return entries;
}

function moveCommandSelection(delta: number) {
  if (commandActions.length === 0) return;
  commandActiveIndex = ((commandActiveIndex + delta) % commandActions.length + commandActions.length) % commandActions.length;
  renderCommandSelection();
}

function renderCommandSelection() {
  $("commandList").querySelectorAll<HTMLButtonElement>(".command-row").forEach((button) => {
    const active = Number(button.dataset.commandIndex ?? "0") === commandActiveIndex;
    button.classList.toggle("active", active);
    if (active) button.scrollIntoView({ block: "nearest" });
  });
}

async function restoreSession() {
  let raw: string | null = null;
  let migratedLegacySession = false;
  try {
    raw = await invoke<string | null>("load_session");
  } catch (error) {
    log(`读取会话数据库失败：${String(error)}`);
  }
  if (!raw) {
    raw = localStorage.getItem(SESSION_KEY);
    migratedLegacySession = Boolean(raw);
  }
  if (!raw) return;
  state.restoring = true;
  try {
    const snapshot = JSON.parse(raw) as Partial<SessionSnapshot>;
    state.recentFiles = uniquePaths(snapshot.recentFiles ?? []).slice(0, 40);
    if ((snapshot.version ?? 1) < 3 && snapshot.workspaceRoot) {
      state.recentFiles = state.recentFiles.filter(
        (path) => !pathMatchesTarget(path, snapshot.workspaceRoot!, true),
      );
    }
    state.recentWorkspaces = uniquePaths(snapshot.recentWorkspaces ?? []).slice(0, 20);
    state.collapsedDirs = new Set(snapshot.collapsedDirs ?? []);
    state.searchHistory = (snapshot.searchHistory ?? []).slice(0, 30);
    state.replaceHistory = (snapshot.replaceHistory ?? []).slice(0, 30);
    state.searchFavorites = (snapshot.searchFavorites ?? []).slice(0, 30);
    state.findView = snapshot.findView ?? "find";
    state.mode = snapshot.workMode ?? (snapshot.workspaceRoot ? "workspace" : "single");
    state.rightTool = snapshot.rightTool === "outline" ? "outline" : "search";
    state.rightSidebarWidth = snapshot.rightSidebarWidth ?? state.rightSidebarWidth;
    state.explorerWidth = Number.isFinite(snapshot.explorerWidth)
      ? snapshot.explorerWidth ?? DEFAULT_EXPLORER_WIDTH
      : DEFAULT_EXPLORER_WIDTH;
    state.markdownPreviewWidth = Number.isFinite(snapshot.markdownPreviewWidth)
      ? Math.max(0, snapshot.markdownPreviewWidth ?? 0)
      : 0;
    state.contextMenuEnabled = snapshot.contextMenuEnabled ?? true;
    state.defaultAppCandidateEnabled = snapshot.defaultAppCandidateEnabled ?? true;
    setRightSidebarWidth(state.rightSidebarWidth);
    applyExplorerWidth();
    applyMarkdownPreviewWidth();
    state.markdownEditMode = isMarkdownEditMode(snapshot.markdownEditMode)
      ? snapshot.markdownEditMode
      : snapshot.markdownPreviewPreferenceSet
        ? snapshot.showMarkdownPreview ? "split" : "source"
        : "wysiwyg";
    state.markdownContentWidth = isMarkdownContentWidth(snapshot.markdownContentWidth)
      ? snapshot.markdownContentWidth
      : "typora";
    state.wordWrap = snapshot.wordWrap ?? state.wordWrap;
    state.minimap = snapshot.minimap ?? state.minimap;
    state.renderWhitespace = snapshot.renderWhitespace ?? state.renderWhitespace;
    state.fontSize = snapshot.fontSize ?? state.fontSize;
    state.shellFontMode = normalizeFontMode(snapshot.shellFontMode, state.shellFontMode);
    state.shellFontPreset = isShellFontPreset(snapshot.shellFontPreset) ? snapshot.shellFontPreset : state.shellFontPreset;
    state.shellFontCustom = normalizeFontStack(snapshot.shellFontCustom, state.shellFontCustom);
    state.shellFontSize = Math.min(18, Math.max(12, snapshot.shellFontSize ?? state.shellFontSize));
    state.editorFontMode = normalizeFontMode(snapshot.editorFontMode, state.editorFontMode);
    state.editorFontPreset = isEditorFontPreset(snapshot.editorFontPreset) ? snapshot.editorFontPreset : state.editorFontPreset;
    state.editorFontCustom = normalizeFontStack(snapshot.editorFontCustom, state.editorFontCustom);
    state.keymapProfile = isKeymapProfile(snapshot.keymapProfile) ? snapshot.keymapProfile : "vscode";
    state.keybindingOverrides = normalizeKeybindingOverrides(snapshot.keybindingOverrides);
    state.bookmarks = normalizeBookmarkSnapshot(snapshot.bookmarks);
    applyShellFontSettings();
    applyEditorSettings();
    applyMarkdownContentWidth();

    applySearchSnapshot(snapshot);
    setFindView(state.findView, false);

    if (snapshot.darkMode) {
      state.darkMode = true;
      document.body.classList.add("dark");
      monaco.editor.setTheme("notra-dark");
      setThemeButton();
    }

    if (snapshot.workspaceRoot) {
      try {
        const workspace = await invoke<WorkspaceDto>("read_workspace", { path: snapshot.workspaceRoot });
        state.workspace = workspace;
        state.showDirectory = state.mode === "workspace" ? snapshot.showDirectory ?? true : false;
        if (!state.recentWorkspaces.includes(workspace.root)) {
          state.recentWorkspaces.unshift(workspace.root);
          state.recentWorkspaces = state.recentWorkspaces.slice(0, 20);
        }
        ($("directoryInput") as HTMLInputElement).value = workspace.root;
      } catch (error) {
        log(`恢复工作目录失败：${String(error)}`);
        state.mode = "single";
        state.showDirectory = false;
      }
    }

    const restoredFiles = uniquePaths(snapshot.openFiles ?? []);
    let restoredCount = 0;
    for (const path of restoredFiles) {
      try {
        const dto = await invoke<DocumentDto>("open_path", { path });
        addOrReplaceDocument(dto, restoredDocumentOrigin(path, snapshot));
        const restored = state.documents.find((doc) => doc.path === path);
        if (restored) restored.viewState = snapshot.documentViews?.[documentSessionKey(restored)];
        restoredCount += 1;
      } catch (error) {
        log(`恢复文件失败：${path}：${String(error)}`);
      }
    }
    let restoredDraftCount = 0;
    for (const draft of snapshot.draftDocuments ?? []) {
      const doc = createDraftDocument(draft);
      doc.origin = snapshot.documentOrigins?.[documentSessionKey(doc)] ?? "standalone";
      doc.viewState = snapshot.documentViews?.[documentSessionKey(doc)];
      state.documents.push(doc);
      restoredDraftCount += 1;
    }

  const placeholder = state.documents.find((doc) => !doc.path && doc.title === "Untitled-1.txt" && !doc.dirty);
    if (restoredCount + restoredDraftCount > 0 && placeholder && state.documents.length > 1) {
      state.documents = state.documents.filter((doc) => doc !== placeholder);
    }
    const active = snapshot.activePath
      ? state.documents.find((doc) => doc.path === snapshot.activePath)
      : snapshot.activeDraftId
        ? state.documents.find((doc) => doc.draftId === snapshot.activeDraftId)
        : null;
    if (active) state.activeId = active.id;
    if (!state.documents.some((doc) => doc.id === state.activeId)) {
      state.activeId = state.documents[0].id;
    }
    // Switch model first so the disposed placeholder is never left attached to the editor.
    const restoredActive = activeDocument();
    editor.setModel(restoredActive.model);
    applyEditorPerformanceProfile(restoredActive);
    if (restoredActive.viewState) editor.restoreViewState(restoredActive.viewState);
    if (placeholder && !state.documents.includes(placeholder)) {
      placeholder.model.dispose();
    }

    const rightSidebarAvailable =
      (state.mode === "workspace" && Boolean(state.workspace)) || isMarkdownLikeDocument();
    const rightSidebarOpen = Boolean(snapshot.rightSidebarOpen) && rightSidebarAvailable;
    $("findPopover").classList.toggle("hidden", !rightSidebarOpen);
    $("app").classList.toggle("right-sidebar-open", rightSidebarOpen);
    renderAll();
    window.requestAnimationFrame(() => {
      $("tree").scrollTop = Math.max(0, snapshot.treeScrollTop ?? 0);
    });
    log(`会话已恢复：${restoredCount} 个文件，${restoredDraftCount} 个临时文件`);
  } catch (error) {
    log(`会话恢复失败：${String(error)}`);
  } finally {
    state.restoring = false;
    renderMarkdownSurface();
    // Force a layout after shell chrome settles; Monaco can paint blank if height was 0 at create.
    window.requestAnimationFrame(() => {
      restoreEditorSurface();
      requestEditorLayout();
    });
    window.setTimeout(requestEditorLayout, 120);
    window.setTimeout(requestEditorLayout, 360);
    if (migratedLegacySession) {
      try {
        await saveSession();
        localStorage.removeItem(SESSION_KEY);
        log("旧版会话已迁移到 SQLite");
      } catch (error) {
        log(`迁移旧版会话失败：${String(error)}`);
      }
    } else {
      scheduleSessionSave();
    }
  }
}

async function openStartupArgs() {
  try {
    const args = await invoke<StartupArgsDto>("startup_args");
    await applyOpenRequest(args);
  } catch (error) {
    log(`启动参数处理失败：${String(error)}`);
  }
}

async function drainOpenRequests() {
  const requests = await invoke<StartupArgsDto[]>("take_open_requests");
  for (const request of requests) {
    await applyOpenRequest(request);
  }
}

async function applyOpenRequest(args: StartupArgsDto) {
  if (args.files.length === 0 && args.directories.length === 0) return;
  closeMenus();
  closeSettingsPage();
  if (args.directories[0]) {
    await openWorkspacePath(args.directories[0]);
  }
  for (const path of args.files) {
    await openPath(path, args.directories.length === 0);
  }
  renderAll();
  scheduleSessionSave();
}

function applySearchSnapshot(snapshot: Partial<SessionSnapshot>) {
  ($("findInput") as HTMLInputElement).value = snapshot.searchHistory?.[0] ?? "";
  ($("replaceInput") as HTMLInputElement).value = snapshot.replaceHistory?.[0] ?? "";
  setSearchMode(snapshot.searchMode ?? "literal");
  ($("matchCaseInput") as HTMLInputElement).checked = snapshot.matchCase ?? false;
  ($("wholeWordInput") as HTMLInputElement).checked = snapshot.wholeWord ?? false;
  ($("reverseSearchInput") as HTMLInputElement).checked = snapshot.reverseSearch ?? false;
  ($("wrapSearchInput") as HTMLInputElement).checked = snapshot.wrapSearch ?? true;
  ($("searchSelectionInput") as HTMLInputElement).checked = snapshot.searchSelection ?? false;
  ($("recursiveInput") as HTMLInputElement).checked = snapshot.recursive ?? true;
  ($("includeHiddenInput") as HTMLInputElement).checked = snapshot.includeHidden ?? false;
  ($("fileGlobInput") as HTMLInputElement).value = snapshot.fileGlob || "*.*";
  ($("skipDirsInput") as HTMLInputElement).value = snapshot.skipDirs || DEFAULT_SKIP_DIRS;
}

function createDraftDocument(snapshot: Partial<DraftDocumentSnapshot>) {
  const text = snapshot.text ?? "";
  const encoding = encodings.includes(snapshot.encoding as EncodingLabel) ? snapshot.encoding as EncodingLabel : "UTF-8";
  return createDocument(
    {
      title: snapshot.title || nextUntitledTitle(),
      path: null,
      text,
      encoding,
      lineEnding: snapshot.lineEnding || "LF",
      fileSize: new Blob([text]).size,
      readOnly: false,
      readOnlyReason: null,
      language: snapshot.language || "plaintext",
      largeFile: false,
    },
    {
      draftId: snapshot.id || createDraftId(),
      dirty: snapshot.dirty ?? text !== (snapshot.savedText ?? ""),
      savedText: snapshot.savedText ?? "",
    },
  );
}

function ensureDraftId(doc: OpenDocument) {
  if (!doc.draftId) doc.draftId = createDraftId();
  return doc.draftId;
}

function documentSessionKey(doc: OpenDocument) {
  return doc.path ? `file:${doc.path}` : `draft:${ensureDraftId(doc)}`;
}

function restoredDocumentOrigin(path: string, snapshot: Partial<SessionSnapshot>): DocumentOrigin {
  const stored = snapshot.documentOrigins?.[`file:${path}`];
  if (stored === "standalone" || stored === "workspace") return stored;
  if (
    snapshot.workspaceRoot
    && pathMatchesTarget(path, snapshot.workspaceRoot, true)
    && !state.recentFiles.includes(path)
  ) {
    return "workspace";
  }
  return "standalone";
}

function draftDocumentSnapshots() {
  return state.documents
    .filter((doc) => !doc.path && !doc.skipSessionRestore)
    .map((doc): DraftDocumentSnapshot => ({
      id: ensureDraftId(doc),
      title: doc.title,
      text: doc.model.getValue(),
      encoding: doc.encoding,
      lineEnding: doc.lineEnding || "LF",
      language: doc.language || "plaintext",
      savedText: doc.savedText,
      dirty: doc.dirty,
    }));
}

function scheduleSessionSave() {
  if (state.restoring) return;
  window.clearTimeout(sessionTimer);
  sessionTimer = window.setTimeout(() => {
    void saveSession().catch((error) => log(`保存会话失败：${String(error)}`));
  }, 250);
}

async function saveSession() {
  if (state.restoring) return;
  const activeBeforeSave = activeDocument();
  if (activeBeforeSave) syncMarkdownModelFromEditor(activeBeforeSave);
  if (activeBeforeSave) syncActiveBookmarkLines(activeBeforeSave);
  if (activeBeforeSave) activeBeforeSave.viewState = editor.saveViewState() ?? undefined;
  const active = activeDocument();
  const snapshot: SessionSnapshot = {
    version: 7,
    openFiles: uniquePaths(state.documents.flatMap((doc) => (doc.path ? [doc.path] : []))),
    draftDocuments: draftDocumentSnapshots(),
    documentOrigins: Object.fromEntries(
      state.documents.map((doc) => [documentSessionKey(doc), doc.origin]),
    ),
    documentViews: Object.fromEntries(
      state.documents.flatMap((doc) => doc.viewState ? [[documentSessionKey(doc), doc.viewState]] : []),
    ),
    recentFiles: uniquePaths(state.recentFiles).slice(0, 40),
    recentWorkspaces: uniquePaths(state.recentWorkspaces).slice(0, 20),
    workspaceRoot: state.workspace?.root ?? null,
    workMode: state.mode,
    showDirectory: state.showDirectory,
    collapsedDirs: [...state.collapsedDirs],
    activePath: active?.path ?? null,
    activeDraftId: active && !active.path ? ensureDraftId(active) : null,
    darkMode: state.darkMode,
    contextMenuEnabled: state.contextMenuEnabled,
    defaultAppCandidateEnabled: state.defaultAppCandidateEnabled,
    rightSidebarOpen: !$("findPopover").classList.contains("hidden"),
    rightTool: state.rightTool,
    rightSidebarWidth: state.rightSidebarWidth,
    explorerWidth: state.explorerWidth,
    markdownPreviewWidth: state.markdownPreviewWidth,
    treeScrollTop: $("tree").scrollTop,
    markdownEditMode: state.markdownEditMode,
    markdownContentWidth: state.markdownContentWidth,
    searchHistory: state.searchHistory.slice(0, 30),
    replaceHistory: state.replaceHistory.slice(0, 30),
    searchFavorites: state.searchFavorites.slice(0, 30),
    findView: state.findView,
    searchMode: getSearchMode(),
    wordWrap: state.wordWrap,
    minimap: state.minimap,
    renderWhitespace: state.renderWhitespace,
    fontSize: state.fontSize,
    shellFontMode: state.shellFontMode,
    shellFontPreset: state.shellFontPreset,
    shellFontCustom: state.shellFontCustom,
    shellFontSize: state.shellFontSize,
    editorFontMode: state.editorFontMode,
    editorFontPreset: state.editorFontPreset,
    editorFontCustom: state.editorFontCustom,
    keymapProfile: state.keymapProfile,
    keybindingOverrides: state.keybindingOverrides,
    bookmarks: state.bookmarks,
    matchCase: ($("matchCaseInput") as HTMLInputElement).checked,
    wholeWord: ($("wholeWordInput") as HTMLInputElement).checked,
    reverseSearch: ($("reverseSearchInput") as HTMLInputElement).checked,
    wrapSearch: ($("wrapSearchInput") as HTMLInputElement).checked,
    searchSelection: ($("searchSelectionInput") as HTMLInputElement).checked,
    recursive: ($("recursiveInput") as HTMLInputElement).checked,
    includeHidden: ($("includeHiddenInput") as HTMLInputElement).checked,
    fileGlob: ($("fileGlobInput") as HTMLInputElement).value || "*.*",
    skipDirs: ($("skipDirsInput") as HTMLInputElement).value || DEFAULT_SKIP_DIRS,
  };
  const serialized = JSON.stringify(snapshot);
  const write = sessionWriteQueue.then(() => invoke<void>("save_session", { snapshot: serialized }));
  sessionWriteQueue = write.catch(() => undefined);
  await write;
}

function rememberRecentPath(path: string) {
  state.recentFiles = [path, ...state.recentFiles.filter((item) => item !== path)].slice(0, 40);
  renderRecentFiles();
  scheduleSessionSave();
}

function rememberRecentWorkspace(path: string) {
  state.recentWorkspaces = [path, ...state.recentWorkspaces.filter((item) => item !== path)].slice(0, 20);
  renderRecentFiles();
  scheduleSessionSave();
}

function clearRecentFiles() {
  state.recentFiles = [];
  state.recentWorkspaces = [];
  renderRecentFiles();
  scheduleSessionSave();
}

function uniquePaths(paths: string[]) {
  return [...new Set(paths.filter(Boolean))];
}

function toggleTheme() {
  setThemeMode(!state.darkMode);
}

function setThemeButton() {
  setButtonLabel("themeButton", state.darkMode ? "亮色" : "深色", state.darkMode ? "切换到亮色" : "切换到深色");
  setIconSlot($("themeButton").querySelector<HTMLElement>(".icon-slot"), state.darkMode ? "Sun" : "Moon");
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

function registerMdx() {
  if (!monaco.languages.getLanguages().some((language) => language.id === "mdx")) {
    monaco.languages.register({
      id: "mdx",
      aliases: ["MDX"],
      extensions: [".mdx"],
    });
  }
}

function registerCompletionProviders() {
  const genericKeywords = ["TODO", "NOTE", "true", "false", "null", "import", "export", "function", "class"];
  const keywords: Record<string, string[]> = {
    markdown: ["# ", "## ", "### ", "- ", "```", "[label](url)", "![alt](path)"],
    mdx: ["# ", "## ", "### ", "- ", "```", "[label](url)", "![alt](path)", "<Component />"],
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

  const languages = new Set([...languageOptions().map(([id]) => id), ...Object.keys(keywords)]);
  for (const language of languages) {
    const words = keywords[language] ?? genericKeywords;
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
      { token: "identifier", foreground: "111827" },
      { token: "string", foreground: "0f8a5f" },
      { token: "string.key.json", foreground: "1d4ed8" },
      { token: "string.value.json", foreground: "0f8a5f" },
      { token: "number", foreground: "b45309" },
      { token: "type.identifier", foreground: "0f766e" },
      { token: "function", foreground: "7c3aed" },
      { token: "variable", foreground: "0f172a" },
      { token: "tag", foreground: "1d4ed8" },
      { token: "attribute.name", foreground: "7c3aed" },
      { token: "delimiter", foreground: "64748b" },
      { token: "delimiter.bracket.json", foreground: "3238d8" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#111827",
      "editorGutter.background": "#f5f8fc",
      "editorLineNumber.foreground": "#8b97a8",
      "editorLineNumber.activeForeground": "#3238d8",
      "editorCursor.foreground": "#3238d8",
      "editor.selectionBackground": "#dfe4ff",
      "editor.inactiveSelectionBackground": "#e8edf5",
      "editor.selectionHighlightBackground": "#add6ff66",
      "editor.wordHighlightBackground": "#d9e4f280",
      "editor.wordHighlightStrongBackground": "#c8dcf099",
      "editor.wordHighlightTextBackground": "#d9e4f280",
      "editor.wordHighlightBorder": "#00000000",
      "editor.wordHighlightStrongBorder": "#00000000",
      "editor.lineHighlightBackground": "#f5f7fa",
      "editor.lineHighlightBorder": "#00000000",
      "editorIndentGuide.background1": "#dfe4ec",
      "editorIndentGuide.activeBackground1": "#aeb8c7",
    },
  });
  monaco.editor.defineTheme("notra-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "93a0b4" },
      { token: "keyword", foreground: "858bff", fontStyle: "bold" },
      { token: "identifier", foreground: "e5e7eb" },
      { token: "string", foreground: "6ee7b7" },
      { token: "string.key.json", foreground: "93c5fd" },
      { token: "string.value.json", foreground: "6ee7b7" },
      { token: "number", foreground: "fbbf24" },
      { token: "type.identifier", foreground: "5eead4" },
      { token: "function", foreground: "c4b5fd" },
      { token: "variable", foreground: "e5e7eb" },
      { token: "tag", foreground: "93c5fd" },
      { token: "attribute.name", foreground: "c4b5fd" },
      { token: "delimiter", foreground: "94a3b8" },
      { token: "delimiter.bracket.json", foreground: "858bff" },
    ],
    colors: {
      "editor.background": "#151b26",
      "editor.foreground": "#edf2fb",
      "editorGutter.background": "#1d2431",
      "editorLineNumber.foreground": "#667085",
      "editorLineNumber.activeForeground": "#858bff",
      "editorCursor.foreground": "#858bff",
      "editor.selectionBackground": "#313766",
      "editor.inactiveSelectionBackground": "#2a3140",
      "editor.selectionHighlightBackground": "#264f7866",
      "editor.wordHighlightBackground": "#3a425580",
      "editor.wordHighlightStrongBackground": "#46546b99",
      "editor.wordHighlightTextBackground": "#3a425580",
      "editor.wordHighlightBorder": "#00000000",
      "editor.wordHighlightStrongBorder": "#00000000",
      "editor.lineHighlightBackground": "#1c2330",
      "editor.lineHighlightBorder": "#00000000",
      "editorIndentGuide.background1": "#2c3442",
      "editorIndentGuide.activeBackground1": "#596579",
    },
  });
}

function languageLabel(language: string) {
  return languageOptions().find(([id]) => id === language)?.[1] ?? humanizeLanguageId(language);
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} bytes`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

async function pickSavePath(doc: OpenDocument) {
  return invoke<string | null>("pick_save_path", {
    request: {
      defaultDir: preferredDialogDirectory(doc),
      fileName: doc.title || "Untitled.txt",
    },
  });
}

function preferredWorkspaceDialogDirectory() {
  const inputValue = ($("directoryInput") as HTMLInputElement).value.trim();
  return inputValue || state.workspace?.root || state.recentWorkspaces[0] || preferredDialogDirectory();
}

function preferredDialogDirectory(doc = activeDocument()) {
  if (doc?.path) return pathDirectory(doc.path);
  if (state.workspace?.root) return state.workspace.root;
  const inputValue = ($("directoryInput") as HTMLInputElement).value.trim();
  if (inputValue) return inputValue;
  const recent = state.recentFiles.find(Boolean);
  return recent ? pathDirectory(recent) : null;
}

function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

function pathDirectory(path: string) {
  const index = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  if (index === 2 && path[1] === ":") return path.slice(0, 3);
  return index > 0 ? path.slice(0, index) : path;
}

async function pickMarkdownImagePath() {
  const path = await invoke<string | null>("pick_file_path", {
    request: { defaultDir: preferredDialogDirectory() },
  });
  if (!path) return "";
  const doc = activeDocument();
  return doc.path ? relativeMarkdownPath(pathDirectory(doc.path), path) : path.replace(/\\/g, "/");
}

function openMarkdownLink(href: string) {
  const target = href.trim();
  if (!target || target.startsWith("#")) return;
  if (/^(?:https?|mailto):/i.test(target)) {
    window.open(target, "_blank", "noopener,noreferrer");
    return;
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(target) && !/^file:/i.test(target)) return;
  const path = absoluteMarkdownResourcePath(target.split(/[?#]/, 1)[0], activeDocument());
  if (path) void openPath(path, true);
}

function absoluteMarkdownResourcePath(source: string, doc: OpenDocument) {
  let value = source.trim().replace(/^<|>$/g, "");
  if (!value) return "";
  try {
    value = decodeURIComponent(value);
  } catch {
    // 原路径可能包含不完整的百分号，按原值处理。
  }
  value = value.replace(/^file:\/\/\/?/i, "");
  if (/^\/[a-z]:/i.test(value)) value = value.slice(1);
  if (/^(?:[a-z]:[\\/]|\\\\)/i.test(value)) return value.replace(/\//g, "\\");
  const base = doc.path ? pathDirectory(doc.path) : state.workspace?.root;
  if (!base) return "";
  return `${base.replace(/[\\/]+$/g, "")}\\${value.replace(/\//g, "\\").replace(/^[\\]+/, "")}`;
}

function relativeMarkdownPath(fromDirectory: string, targetPath: string) {
  const from = fromDirectory.replace(/\//g, "\\").replace(/\\+$/g, "");
  const target = targetPath.replace(/\//g, "\\");
  const fromDrive = /^[a-z]:/i.exec(from)?.[0]?.toLowerCase();
  const targetDrive = /^[a-z]:/i.exec(target)?.[0]?.toLowerCase();
  if (fromDrive !== targetDrive) return target.replace(/\\/g, "/");

  const fromParts = from.split(/\\+/).filter(Boolean);
  const targetParts = target.split(/\\+/).filter(Boolean);
  let common = 0;
  while (
    common < fromParts.length &&
    common < targetParts.length &&
    fromParts[common].toLowerCase() === targetParts[common].toLowerCase()
  ) {
    common += 1;
  }
  return [
    ...Array.from({ length: fromParts.length - common }, () => ".."),
    ...targetParts.slice(common),
  ].join("/") || fileNameFromPath(target);
}

function normalizePathForCompare(path: string) {
  return path.replace(/\//g, "\\").replace(/\\+$/g, "").toLowerCase();
}

function pathSeparatorFor(path: string) {
  return path.includes("\\") ? "\\" : "/";
}

function pathMatchesTarget(path: string, target: string, isDir: boolean) {
  const value = normalizePathForCompare(path);
  const base = normalizePathForCompare(target);
  if (value === base) return true;
  return isDir && value.startsWith(`${base}\\`);
}

function replacePathPrefix(path: string, oldPrefix: string, newPrefix: string) {
  const base = normalizePathForCompare(oldPrefix);
  const value = normalizePathForCompare(path);
  if (value === base) return newPrefix;
  const separator = pathSeparatorFor(newPrefix);
  const rest = path.slice(oldPrefix.length).replace(/^[\\/]+/, "");
  return `${newPrefix.replace(/[\\/]+$/g, "")}${separator}${rest}`;
}

function languageFromFilePath(path: string) {
  const name = fileNameFromPath(path).toLowerCase();
  const extension = fileExtension(name);
  const matched = languageOptions().find(([id, label, hint]) => {
    const haystack = `${id} ${label} ${hint}`.toLowerCase();
    return haystack.includes(extension) && (
      hint.split(",").map((item) => item.trim().toLowerCase()).includes(extension) ||
      id === extension
    );
  });
  if (matched) return matched[0];
  if (extension === "md") return "markdown";
  if (extension === "js" || extension === "mjs" || extension === "cjs") return "javascript";
  if (extension === "ts") return "typescript";
  if (extension === "yml") return "yaml";
  return "plaintext";
}

function markdownMatchesToDto(matches: MarkdownSearchMatch[]): TextMatchDto[] {
  return matches.map((match) => ({ ...match }));
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
