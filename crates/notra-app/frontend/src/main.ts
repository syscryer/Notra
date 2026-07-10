import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowDown,
  ArrowUp,
  Binary,
  Braces,
  Check,
  ChevronDown,
  CircleX,
  Command,
  Copy,
  Edit3,
  Eraser,
  ExternalLink,
  File,
  FilePlus2,
  FileSearch,
  FileText,
  Files,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Highlighter,
  History,
  Info,
  ListRestart,
  LoaderCircle,
  Map,
  Maximize2,
  Minus,
  Moon,
  PanelBottom,
  PanelBottomClose,
  PanelLeftClose,
  Pilcrow,
  Redo2,
  RefreshCw,
  Replace,
  ReplaceAll,
  Save,
  SaveAll,
  SavePlus,
  Search,
  Settings,
  Sun,
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
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import "monaco-editor/esm/vs/basic-languages/monaco.contribution";
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
  model: monaco.editor.ITextModel;
  dirty: boolean;
  savedText: string;
  encodingStatus: "编码已识别" | "重新解释" | "转换待保存";
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
  openFiles: string[];
  draftDocuments: DraftDocumentSnapshot[];
  recentFiles: string[];
  workspaceRoot: string | null;
  workMode: WorkMode;
  showDirectory: boolean;
  collapsedDirs: string[];
  activePath: string | null;
  activeDraftId: string | null;
  darkMode: boolean;
  showBottom: boolean;
  showMarkdownPreview: boolean;
  markdownPreviewPreferenceSet: boolean;
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
type FindView = "find" | "replace" | "mark";
type SearchScope = "current" | "open" | "workspace" | "mark";
type RenderWhitespaceMode = "none" | "selection" | "all";
type SettingsSection = "appearance" | "editor" | "workspace" | "search" | "about";
type FontMode = "preset" | "custom";
type ShellFontPreset = "system" | "segoe" | "yahei" | "dengxian" | "sourceHanSans" | "misans";
type EditorFontPreset = "cascadia" | "jetbrains" | "consolas" | "firaCode" | "sourceCodePro";
type MarkdownListType = "ul" | "ol";
type MarkdownTableAlign = "" | "left" | "center" | "right";
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
  searchHistory: [] as string[],
  replaceHistory: [] as string[],
  searchFavorites: [] as string[],
  showDirectory: false,
  showBottom: true,
  showMarkdownPreview: true,
  markdownPreviewPreferenceSet: false,
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
  settingsSection: "appearance" as SettingsSection,
  busyMessage: "",
  restoring: false,
};

let nextId = 1;
let editor: monaco.editor.IStandaloneCodeEditor;
let sessionTimer = 0;
let unsavedResolver: ((value: UnsavedChoice) => void) | null = null;
let confirmResolver: ((value: boolean) => void) | null = null;
let textInputResolver: ((value: string | null) => void) | null = null;
let searchDecorations: monaco.editor.IEditorDecorationsCollection | null = null;
let activeSearchDecoration: monaco.editor.IEditorDecorationsCollection | null = null;
let windowCloseConfirmed = false;
let commandActions: Array<() => void> = [];
let commandActiveIndex = 0;
let tabMenuDocumentId = 0;
let treeMenuTarget: TreeContextTarget | null = null;
let busyDepth = 0;
let titlebarMaximizeToggleAt = 0;
let titlebarDragState: { pointerId: number; startX: number; startY: number } | null = null;
let findDragState: { pointerId: number; offsetX: number; offsetY: number } | null = null;
let markdownPreviewTimer = 0;

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
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const appWindow = getCurrentWindow();
const lucideIcons: Record<string, IconNode> = {
  ArrowDown,
  ArrowUp,
  Binary,
  Braces,
  Check,
  ChevronDown,
  CircleX,
  Command,
  Copy,
  Edit3,
  Eraser,
  ExternalLink,
  File,
  FilePlus2,
  FileSearch,
  FileText,
  Files,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Highlighter,
  History,
  Info,
  ListRestart,
  LoaderCircle,
  Map,
  Maximize2,
  Minus,
  Moon,
  PanelBottom,
  PanelBottomClose,
  PanelLeftClose,
  Pilcrow,
  Redo2,
  RefreshCw,
  Replace,
  ReplaceAll,
  Save,
  SaveAll,
  SavePlus,
  Search,
  Settings,
  Sun,
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
  window.addEventListener("unhandledrejection", (event) => {
    log(`操作失败：${event.reason instanceof Error ? event.reason.message : String(event.reason)}`);
  });
  window.addEventListener("error", (event) => {
    log(`界面错误：${event.message}`);
  });
  window.addEventListener("beforeunload", saveSession);

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
    guides: { bracketPairs: true, indentation: true },
    stickyScroll: { enabled: false },
    folding: true,
    wordWrap: state.wordWrap ? "on" : "off",
    largeFileOptimizations: true,
    renderWhitespace: state.renderWhitespace,
    occurrencesHighlight: "singleFile",
    suggest: { preview: true, showWords: true },
    wordBasedSuggestions: "currentDocument",
    quickSuggestions: { other: true, comments: false, strings: false },
  });

  searchDecorations = editor.createDecorationsCollection();
  activeSearchDecoration = editor.createDecorationsCollection();
  editor.onDidScrollChange(syncMarkdownPreviewScroll);

  bindActions();
  bindWindowControls();
  bindWindowCloseGuard();
  bindFindPopoverDrag();
  bindOutsideDismissal();
  setFindView("find", false);
  renderAll();
  void restoreSession().then(openStartupArgs);
  log("Notra Monaco UI ready");
}

function bindActions() {
  $("singleModeButton").addEventListener("click", () => setWorkMode("single"));
  $("newButton").addEventListener("click", newDocument);
  $("openButton").addEventListener("click", openDocument);
  $("workspaceButton").addEventListener("click", () => void enterWorkspaceMode());
  $("saveButton").addEventListener("click", saveActive);
  $("saveAsButton").addEventListener("click", saveAsActive);
  $("saveAllButton").addEventListener("click", saveAll);
  $("undoButton").addEventListener("click", () => editor.trigger("toolbar", "undo", null));
  $("redoButton").addEventListener("click", () => editor.trigger("toolbar", "redo", null));
  $("findRailButton").addEventListener("click", () => {
    setFindView("find");
    toggleFindOpen();
  });
  $("bottomRailButton").addEventListener("click", toggleBottom);
  $("collapseBottomButton").addEventListener("click", toggleBottom);
  $("findCurrentButton").addEventListener("click", () => findCurrent(true));
  $("findNextButton").addEventListener("click", () => void findNextResult());
  $("findPreviousButton").addEventListener("click", () => void findPreviousResult());
  $("replaceCurrentButton").addEventListener("click", replaceCurrentFile);
  $("replaceAllCurrentButton").addEventListener("click", replaceAllCurrentFile);
  $("markCurrentButton").addEventListener("click", markCurrentFile);
  $("clearMarksButton").addEventListener("click", clearSearchMarks);
  $("closeFindButton").addEventListener("click", closeFind);
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
  bindSegmentedSetting("settingsBottomControl", (value) => setBottomVisible(value === "on"));
  bindSegmentedSetting("settingsMarkdownControl", (value) => setMarkdownPreviewVisible(value === "on"));
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
  $("markdownPreviewButton").addEventListener("click", toggleMarkdownPreviewPreference);

  ["findInput", "replaceInput", "directoryInput", "fileGlobInput", "skipDirsInput", "searchModeInput"].forEach((id) => {
    $(id).addEventListener("change", scheduleSessionSave);
  });
  $("findInput").addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key !== "Enter") return;
    event.preventDefault();
    if ((event as KeyboardEvent).shiftKey) {
      void findPreviousResult();
    } else {
      void findNextResult();
    }
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
    button.addEventListener("click", () => setFindView((button.dataset.findView as FindView) || "find"));
  });

  document.querySelectorAll<HTMLButtonElement>(".panel-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.panel = button.dataset.panel as typeof state.panel;
      renderBottom();
    });
  });

  document.addEventListener("keydown", (event) => {
    if (handleContextMenuKeydown(event)) return;
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
      closeMenus();
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
    if (event.ctrlKey && event.key.toLowerCase() === "n") {
      event.preventDefault();
      newDocument();
    }
    if (event.ctrlKey && event.key.toLowerCase() === "w") {
      event.preventDefault();
      void closeDocument(activeDocument().id);
    }
    if (event.ctrlKey && event.key.toLowerCase() === "p") {
      event.preventDefault();
      openCommandPalette();
    }
    if (event.ctrlKey && event.key === "Tab") {
      event.preventDefault();
      activateAdjacentDocument(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.ctrlKey && event.key === "PageDown") {
      event.preventDefault();
      activateAdjacentDocument(1);
      return;
    }
    if (event.ctrlKey && event.key === "PageUp") {
      event.preventDefault();
      activateAdjacentDocument(-1);
      return;
    }
    if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      setFindView("find");
      toggleFindOpen({ prefillFromSelection: true });
    }
    if (event.ctrlKey && event.key.toLowerCase() === "h") {
      event.preventDefault();
      setFindView("replace");
      toggleFindOpen({ prefillFromSelection: true });
    }
    if (event.key === "F3") {
      event.preventDefault();
      if (event.shiftKey) {
        void findPreviousResult();
      } else {
        void findNextResult();
      }
    }
  });

  editor.onDidChangeCursorPosition(renderChrome);
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
}

function closeSettingsPage() {
  $("settingsPage").classList.add("hidden");
  $("app").classList.remove("settings-open");
  $("settingsButton").classList.remove("active");
}

function selectSettingsSection(section: SettingsSection) {
  if (!["appearance", "editor", "workspace", "search", "about"].includes(section)) return;
  state.settingsSection = section;
  renderSettingsMenu();
}

function setThemeMode(darkMode: boolean) {
  state.darkMode = darkMode;
  document.body.classList.toggle("dark", state.darkMode);
  monaco.editor.setTheme(state.darkMode ? "notra-dark" : "notra-light");
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

function setBottomVisible(visible: boolean) {
  if (state.showBottom === visible) return;
  state.showBottom = visible;
  renderBottom();
  renderSettingsMenu();
  scheduleSessionSave();
}

function setMarkdownPreviewVisible(visible: boolean) {
  const changed = state.showMarkdownPreview !== visible;
  state.showMarkdownPreview = visible;
  state.markdownPreviewPreferenceSet = true;
  if (!changed) {
    renderSettingsMenu();
    scheduleSessionSave();
    return;
  }
  renderMarkdownPreview();
  renderChrome();
  renderSettingsMenu();
  scheduleSessionSave();
}

function toggleMarkdownPreviewPreference() {
  setMarkdownPreviewVisible(!state.showMarkdownPreview);
  log(`Markdown 分屏预览${state.showMarkdownPreview ? "已开启" : "已关闭"}`);
}

function bindWindowControls() {
  const titlebar = $("windowTitlebar");
  titlebar.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || isInteractiveTarget(event.target)) return;
    if (event.detail >= 2) {
      event.preventDefault();
      clearTitlebarDragState(titlebar, event.pointerId);
      toggleTitlebarMaximize();
      return;
    }
    titlebarDragState = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY };
    titlebar.setPointerCapture(event.pointerId);
  });
  titlebar.addEventListener("pointermove", (event) => {
    if (!titlebarDragState || titlebarDragState.pointerId !== event.pointerId) return;
    const deltaX = Math.abs(event.clientX - titlebarDragState.startX);
    const deltaY = Math.abs(event.clientY - titlebarDragState.startY);
    if (deltaX < 4 && deltaY < 4) return;
    clearTitlebarDragState(titlebar, event.pointerId);
    void appWindow.startDragging();
  });
  titlebar.addEventListener("dblclick", (event) => {
    if (isInteractiveTarget(event.target)) return;
    event.preventDefault();
    clearTitlebarDragState(titlebar);
    toggleTitlebarMaximize();
  });
  titlebar.addEventListener("pointerup", (event) => clearTitlebarDragState(titlebar, event.pointerId));
  titlebar.addEventListener("pointercancel", (event) => clearTitlebarDragState(titlebar, event.pointerId));
  $("windowMinimize").addEventListener("click", () => void appWindow.minimize());
  $("windowMaximize").addEventListener("click", () => void appWindow.toggleMaximize());
  $("windowClose").addEventListener("click", () => void requestWindowClose());
}

function clearTitlebarDragState(titlebar: HTMLElement, pointerId?: number) {
  const activePointer = pointerId ?? titlebarDragState?.pointerId;
  if (activePointer !== undefined && titlebar.hasPointerCapture(activePointer)) {
    titlebar.releasePointerCapture(activePointer);
  }
  titlebarDragState = null;
}

function toggleTitlebarMaximize() {
  const now = window.performance.now();
  if (now - titlebarMaximizeToggleAt < 260) return;
  titlebarMaximizeToggleAt = now;
  void appWindow.toggleMaximize();
}

function bindFindPopoverDrag() {
  const popover = $("findPopover");
  const handle = $("findDragHandle");
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || isInteractiveTarget(event.target)) return;
    const rect = popover.getBoundingClientRect();
    findDragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    popover.style.left = `${rect.left}px`;
    popover.style.top = `${rect.top}px`;
    popover.style.right = "auto";
    popover.classList.add("dragging");
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  handle.addEventListener("pointermove", (event) => {
    if (!findDragState || event.pointerId !== findDragState.pointerId) return;
    const maxLeft = Math.max(8, window.innerWidth - popover.offsetWidth - 8);
    const maxTop = Math.max(48, window.innerHeight - popover.offsetHeight - 8);
    const left = Math.min(maxLeft, Math.max(8, event.clientX - findDragState.offsetX));
    const top = Math.min(maxTop, Math.max(48, event.clientY - findDragState.offsetY));
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  });
  const stopDrag = (event: PointerEvent) => {
    if (findDragState?.pointerId !== event.pointerId) return;
    findDragState = null;
    popover.classList.remove("dragging");
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
  };
  handle.addEventListener("pointerup", stopDrag);
  handle.addEventListener("pointercancel", stopDrag);
}

function bindWindowCloseGuard() {
  void appWindow.onCloseRequested(async (event) => {
    if (windowCloseConfirmed) {
      saveSession();
      return;
    }
    const canClose = await confirmCloseAll();
    if (!canClose) {
      event.preventDefault();
      return;
    }
    saveSession();
  });
}

async function requestWindowClose() {
  const canClose = await confirmCloseAll();
  if (!canClose) return;
  windowCloseConfirmed = true;
  saveSession();
  await appWindow.close();
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

async function withBusy<T>(message: string, task: () => Promise<T>): Promise<T> {
  busyDepth += 1;
  setBusy(message);
  try {
    return await task();
  } finally {
    busyDepth -= 1;
    if (busyDepth <= 0) {
      busyDepth = 0;
      setBusy("");
    }
  }
}

function setBusy(message: string) {
  state.busyMessage = message;
  $("app").classList.toggle("is-busy", Boolean(message));
  if (editor) {
    editor.updateOptions({ readOnly: Boolean(message) || activeDocument().readOnly });
  }
  renderChrome();
}

function createDocument(
  dto: DocumentDto,
  options: {
    draftId?: string;
    dirty?: boolean;
    savedText?: string;
  } = {},
): OpenDocument {
  const uri = monaco.Uri.parse(`notra://model/${nextId}/${encodeURIComponent(dto.title)}`);
  const model = monaco.editor.createModel(dto.text, dto.language || "plaintext", uri);
  const savedText = options.savedText ?? dto.text;
  const doc: OpenDocument = {
    ...dto,
    id: nextId++,
    draftId: dto.path ? undefined : options.draftId ?? createDraftId(),
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
    scheduleMarkdownPreviewRender();
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
  state.activeId = id;
  editor.setModel(doc.model);
  applyEditorPerformanceProfile(doc);
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
  activateDocument(doc.id);
  log(`新建 ${doc.title}`);
  scheduleSessionSave();
}

async function openDocument() {
  const path = await invoke<string | null>("pick_file_path", {
    request: { defaultDir: preferredDialogDirectory() },
  });
  if (!path) return;
  await openPath(path);
}

async function openPath(path: string) {
  const dto = await withBusy(`打开 ${fileNameFromPath(path)}`, () => invoke<DocumentDto>("open_path", { path }));
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
    return false;
  }
  const path = forceSaveAs || !doc.path ? await pickSavePath(doc) : doc.path;
  if (!path) {
    log("已取消保存");
    return false;
  }
  const saved = await withBusy(`保存 ${doc.title}`, () =>
    invoke<DocumentDto>("save_document", {
      request: {
        path,
        text: doc.model.getValue(),
        encoding: doc.encoding,
        lineEnding: doc.lineEnding || "LF",
      },
    }),
  );
  Object.assign(doc, saved, { dirty: false, savedText: saved.text, encodingStatus: "编码已识别" });
  doc.draftId = undefined;
  monaco.editor.setModelLanguage(doc.model, saved.language || "plaintext");
  renderAll();
  if (doc.path) rememberRecentPath(doc.path);
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

async function chooseWorkspace() {
  const path = await invoke<string | null>("pick_workspace_path", {
    request: { defaultDir: preferredWorkspaceDialogDirectory() },
  });
  if (!path) return;
  const workspace = await withBusy(`读取目录 ${fileNameFromPath(path)}`, () =>
    invoke<WorkspaceDto>("read_workspace", { path }),
  );
  state.workspace = workspace;
  state.mode = "workspace";
  state.showDirectory = true;
  state.collapsedDirs.clear();
  ($("directoryInput") as HTMLInputElement).value = workspace.root;
  renderWorkspace();
  renderChrome();
  renderSettingsMenu();
  scheduleSessionSave();
  log(`工作目录 ${workspace.name}`);
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
  if (state.documents.length === 1) return false;
  const index = state.documents.findIndex((doc) => doc.id === id);
  if (index < 0) return false;
  const doc = state.documents[index];
  if (doc.dirty && !doc.readOnly) {
    const choice = await askUnsavedChoice("关闭文档", `"${doc.title}" 有未保存修改。`, doc.path || doc.title);
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
  }
  state.documents.splice(index, 1);
  doc.model.dispose();
  activateDocument(state.documents[Math.max(0, index - 1)].id);
  scheduleSessionSave();
  return true;
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
  menu.querySelector<HTMLButtonElement>(".menu-row:not(:disabled)")?.focus();
}

function activeContextMenu() {
  return [$("tabMenu"), $("treeMenu")].find((menu) => !menu.classList.contains("hidden")) ?? null;
}

function contextMenuButtons(menu: HTMLElement) {
  return Array.from(menu.querySelectorAll<HTMLButtonElement>(".menu-row:not(:disabled)"));
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
    closeMenus();
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
    if (button?.closest(".tab-menu, .tree-menu")) {
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
  const name = await askTextInput({
    title: "重命名",
    subtitle: target.name,
    label: "新名称",
    value: target.name,
  });
  if (!name || name === target.name) return;
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
    if (remove) doc.model.dispose();
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

function findCurrent(showPanel = false) {
  const query = ($("findInput") as HTMLInputElement).value;
  if (!query) {
    log("查找内容不能为空");
    return;
  }
  commitSearchHistory();
  const doc = activeDocument();
  const matches = modelMatches(doc);
  const activeIndex = initialSearchResultIndex(matches.length);
  setSearchResults({
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
  }, "current", activeIndex, showPanel);
  if (matches.length > 0) void openSearchResult(activeIndex);
  log(`当前文件查找 ${matches.length} 个命中`);
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
  state.showBottom = showPanel;
  renderBottom();
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
  if (scope === "open" || scope === "mark") {
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
  await navigateSearchResult(searchDirection());
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
  await navigateSearchResult(-searchDirection());
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
  renderBottom();
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
  $("panelBody")
    .querySelector<HTMLElement>(`tr[data-result-index="${state.activeResultIndex}"]`)
    ?.scrollIntoView({ block: "nearest" });
}

function markCurrentFile() {
  const query = ($("findInput") as HTMLInputElement).value;
  if (!query) {
    log("标记内容不能为空");
    return;
  }
  commitSearchHistory();
  const doc = activeDocument();
  const matches = modelMatches(doc);
  setSearchResults({
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
  }, "mark", -1);
  log(`当前文件标记 ${matches.length} 处`);
}

function markOpenDocuments() {
  const query = ($("findInput") as HTMLInputElement).value;
  if (!query) {
    log("标记内容不能为空");
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
  setSearchResults(report, "mark", -1);
  log(`打开文档标记 ${report.total} 处`);
}

function clearSearchMarks() {
  state.results = null;
  state.replacePreview = null;
  state.replacePreviewApplied = false;
  state.searchScope = null;
  state.searchQuery = "";
  state.searchSignature = "";
  state.activeResultIndex = -1;
  searchDecorations?.clear();
  activeSearchDecoration?.clear();
  renderBottom();
  log("已清除搜索标记");
}

function clearSearchResults() {
  resetSearchResults();
  log("已清除查找结果");
}

function resetSearchResults() {
  state.results = null;
  state.searchScope = null;
  state.searchQuery = "";
  state.searchSignature = "";
  state.activeResultIndex = -1;
  searchDecorations?.clear();
  activeSearchDecoration?.clear();
  renderBottom();
}

function clearReplacePreview() {
  state.replacePreview = null;
  state.replacePreviewApplied = false;
  renderBottom();
  log("已清除替换预览");
}

function replaceCurrentFile() {
  const context = currentReplaceContext();
  if (!context) return;
  const { doc, model, query, replacement } = context;
  const matches = modelMatches(doc);
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

  const report = await withBusy("目录查找中", () =>
    invoke<SearchReportDto>("search_workspace", {
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
    }),
  );
  setSearchResults(report, "workspace", -1);
  log(`目录查找 ${report.total} 个命中`);
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

  const preview = await withBusy("生成替换预览", () =>
    invoke<ReplacePreviewDto>("preview_workspace_replace", {
      request: searchReplaceRequest(root, query, replacement),
    }),
  );
  state.replacePreview = preview;
  state.replacePreviewApplied = false;
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

  const applied = await withBusy("写入目录替换", () =>
    invoke<ReplacePreviewDto>("apply_workspace_replace", {
      request: searchReplaceRequest(root, query, replacement),
    }),
  );
  state.replacePreview = applied;
  state.replacePreviewApplied = true;
  await refreshOpenDocumentsAfterReplace(applied);
  state.panel = "preview";
  renderBottom();
  log(`目录替换已写入 ${applied.total} 处`);
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
  if (($("searchSelectionInput") as HTMLInputElement).checked) {
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
    renderLineHighlight: large ? "none" : "line",
    quickSuggestions: large ? false : { other: true, comments: false, strings: false },
    wordBasedSuggestions: large ? "off" : "currentDocument",
    suggestOnTriggerCharacters: !large,
  });
}

function renderAll() {
  renderMenus();
  renderWorkspace();
  renderChrome();
  renderBottom();
  renderMarkdownPreview();
  renderSearchDecorations();
  renderHistoryLists();
  renderRecentFiles();
}

function renderChrome() {
  const doc = activeDocument();
  setButtonLabel("singleModeButton", "单文件模式", "单文件模式");
  setButtonLabel(
    "workspaceButton",
    "文件夹模式",
    state.workspace ? `文件夹模式：${state.workspace.name}` : "文件夹模式：选择目录",
  );
  $("singleModeButton").classList.toggle("active", state.mode === "single");
  $("workspaceButton").classList.toggle("active", state.mode === "workspace");
  setButtonLabel("languageButton", languageLabel(doc.language), `语言 ${languageLabel(doc.language)}`);
  setButtonLabel("encodingButton", doc.encoding, `编码 ${doc.encoding}`);
  $("encodingNotice").textContent = `${doc.encodingStatus} ${doc.encoding}`;
  setButtonLabel("lineEndingButton", doc.lineEnding || "LF", `行尾 ${doc.lineEnding || "LF"}`);
  setButtonLabel(
    "markdownPreviewButton",
    "Markdown 分屏预览",
    isMarkdownLikeDocument(doc)
      ? `Markdown 分屏预览 ${state.showMarkdownPreview ? "已开启" : "已关闭"}`
      : "Markdown 分屏预览：仅 Markdown 文档显示",
  );
  $("markdownPreviewButton").classList.toggle("active", isMarkdownPreviewEnabled(doc));
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

  const statusLeftItems = [
    escapeHtml(doc.path || "未保存"),
    languageLabel(doc.language),
    doc.encoding,
    doc.lineEnding,
    doc.readOnly ? "只读" : "",
    doc.encodingStatus,
  ].filter(Boolean).map((item) => `<span>${item}</span>`).join(`<span class="dot"></span>`);
  $("statusLeft").innerHTML = state.busyMessage
    ? `<span class="busy-pill">${iconSvg("LoaderCircle")}${escapeHtml(state.busyMessage)}</span><span class="dot"></span>${statusLeftItems}`
    : statusLeftItems;
  $("statusRight").innerHTML = [
    `第 ${editor.getPosition()?.lineNumber ?? 1} 行，第 ${editor.getPosition()?.column ?? 1} 列`,
    `${doc.model.getLineCount()} 行`,
    `${doc.model.getValueLength()} 字符`,
    `${formatBytes(doc.fileSize)}`,
  ].map((item) => `<span>${item}</span>`).join(`<span class="dot"></span>`);
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
  const activePath = activeDocument().path;
  $("tree").innerHTML = renderTreeRows(visibleTreeItems(state.workspace.items), activePath);
  $("tree").querySelectorAll<HTMLButtonElement>(".tree-item.file").forEach((button) => {
    button.addEventListener("click", () => void openPath(button.dataset.path ?? ""));
    button.addEventListener("keydown", (event) => void handleTreeItemKeydown(button, event));
  });
  $("tree").querySelectorAll<HTMLButtonElement>(".tree-item.dir").forEach((button) => {
    button.addEventListener("click", () => toggleDirectoryCollapse(button.dataset.path ?? ""));
    button.addEventListener("keydown", (event) => void handleTreeItemKeydown(button, event));
  });
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
  setSegmentedValue("settingsBottomControl", state.showBottom ? "on" : "off");
  setSegmentedValue("settingsMarkdownControl", state.showMarkdownPreview ? "on" : "off");
  setSegmentedValue("settingsModeControl", state.mode === "workspace" && state.workspace ? "workspace" : "single");
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
  applyShellFontSettings();
  applyEditorSettings();
  renderAll();
  scheduleSessionSave();
  log("视图和字体设置已重置");
}

function applyEditorSettings() {
  applyEditorPerformanceProfile(activeDocument());
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
      if (state.replacePreview) {
        body.innerHTML = `<div class="panel-actions"><button class="tool-button" id="clearReplacePreviewButton">${iconSvg("X")}<span>清除预览</span></button><span>${state.replacePreviewApplied ? "替换已完成，没有剩余预览项" : "没有可替换内容"}</span></div>`;
        $("clearReplacePreviewButton").addEventListener("click", clearReplacePreview);
      } else {
        body.innerHTML = `<div class="empty">暂无替换预览</div>`;
      }
      return;
    }
    const replaceStatus = state.replacePreviewApplied ? "已写入" : "待确认";
    const rows = state.replacePreview.items.flatMap((item) =>
      item.matches.map(
        (match) =>
          `<tr data-path="${escapeAttr(item.path)}" data-line="${match.line}" data-column="${match.column}"><td><span class="tag">${replaceStatus}</span></td><td>${escapeHtml(item.fileName)}</td><td>${match.line}:${match.column}</td><td>${escapeHtml(match.matchedText)} → ${escapeHtml(($("replaceInput") as HTMLInputElement).value)}</td></tr>`,
      ),
    );
    const applyButton = state.replacePreviewApplied
      ? ""
      : `<button class="tool-button primary" id="applyReplaceButton">${iconSvg("Save")}<span>写入文件</span></button>`;
    body.innerHTML = `<div class="panel-actions">${applyButton}<button class="tool-button" id="clearReplacePreviewButton">${iconSvg("X")}<span>清除预览</span></button><span>${state.replacePreviewApplied ? "已写入" : "待写入"} ${state.replacePreview.total} 处修改，${state.replacePreview.items.length} 个文件</span></div><table><thead><tr><th>动作</th><th>文件</th><th>位置</th><th>替换预览</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
    $("applyReplaceButton")?.addEventListener("click", () => void applyWorkspaceReplace());
    $("clearReplacePreviewButton").addEventListener("click", clearReplacePreview);
    body.querySelectorAll<HTMLTableRowElement>("tr[data-path]").forEach((row) => {
      row.addEventListener("click", () =>
        void openResult(row.dataset.path ?? "", Number(row.dataset.line ?? "1"), Number(row.dataset.column ?? "1")),
      );
    });
    return;
  }
  if (!state.results) {
    body.innerHTML = `<div class="empty">暂无查找结果</div>`;
    return;
  }
  if (state.results.total === 0) {
    body.innerHTML = `<div class="panel-actions"><button class="tool-button" id="clearResultsButton">${iconSvg("X")}<span>清除结果</span></button><span>没有命中，可检查大小写、全词或文件过滤。</span></div>`;
    $("clearResultsButton").addEventListener("click", clearSearchResults);
    return;
  }
  let resultIndex = 0;
  const rows = state.results.hits.flatMap((hit) =>
    hit.matches.map((match) => {
      const index = resultIndex;
      resultIndex += 1;
      return `<tr class="${index === state.activeResultIndex ? "result-active" : ""}" data-result-index="${index}" data-path="${escapeAttr(hit.path)}" data-line="${match.line}" data-column="${match.column}"><td><span class="tag">${hit.path === activeDocument().path || hit.path === activeDocument().title ? "当前文件" : "目录"}</span></td><td>${escapeHtml(hit.fileName)}</td><td>${match.line}:${match.column}</td><td>${highlightMatchLine(match)}</td></tr>`;
    }),
  );
  body.innerHTML = `<div class="panel-actions"><button class="tool-button" id="clearResultsButton">${iconSvg("X")}<span>清除结果</span></button><span>${state.results.total} 处命中，${state.results.hits.length} 个文件</span></div><table><thead><tr><th>范围</th><th>文件</th><th>位置</th><th>预览</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
  $("clearResultsButton").addEventListener("click", clearSearchResults);
  body.querySelectorAll<HTMLTableRowElement>("tr[data-path]").forEach((row) => {
    row.addEventListener("click", () => void openSearchResult(Number(row.dataset.resultIndex ?? "0")));
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

function renderMarkdownPreview() {
  const doc = activeDocument();
  const preview = $("markdownPreview");
  const editorArea = preview.parentElement;
  const enabled = isMarkdownPreviewEnabled(doc);
  editorArea?.classList.toggle("preview-open", enabled);
  preview.classList.toggle("hidden", !enabled);
  if (!enabled) {
    preview.innerHTML = "";
    requestEditorLayout();
    return;
  }
  const source = doc.model.getValue();
  const body = source.trim()
    ? renderMarkdown(source)
    : `<div class="markdown-preview-empty">空白 Markdown</div>`;
  preview.innerHTML = `
    <header class="markdown-preview-head">
      <div>
        <strong>预览</strong>
        <span>${escapeHtml(doc.title)}</span>
      </div>
      <small>${formatBytes(new Blob([source]).size)}</small>
    </header>
    <div class="markdown-preview-body">${body}</div>
  `;
  requestEditorLayout();
  window.requestAnimationFrame(syncMarkdownPreviewScroll);
}

function scheduleMarkdownPreviewRender() {
  window.clearTimeout(markdownPreviewTimer);
  markdownPreviewTimer = window.setTimeout(renderMarkdownPreview, 80);
}

function requestEditorLayout() {
  window.requestAnimationFrame(() => editor?.layout());
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
  return state.showMarkdownPreview && isMarkdownLikeDocument(doc);
}

function isMarkdownLikeDocument(doc: OpenDocument) {
  if (isMarkdownLikeLanguage(doc.language)) return true;
  const name = (doc.path || doc.title).toLowerCase();
  return /\.(md|markdown|mdx|rmd)$/.test(name);
}

function isMarkdownLikeLanguage(language: string) {
  return language.toLowerCase() === "markdown" || language.toLowerCase() === "mdx";
}

function setFindView(view: FindView, persist = true) {
  if (!["find", "replace", "mark"].includes(view)) view = "find";
  state.findView = view;
  $("findPopover").dataset.view = view;
  document.querySelectorAll<HTMLButtonElement>("[data-find-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.findView === view);
  });

  const replaceVisible = view === "replace";
  toggleInputRow("replaceInput", replaceVisible);

  toggleAction("findNextButton", view === "find");
  toggleAction("findPreviousButton", view === "find");
  toggleAction("findCurrentButton", view === "find");
  toggleAction("replaceCurrentButton", replaceVisible);
  toggleAction("replaceAllCurrentButton", replaceVisible);
  toggleAction("markCurrentButton", view === "mark");
  toggleAction("clearMarksButton", view === "mark");
  if (persist) scheduleSessionSave();
}

function toggleInputRow(id: string, visible: boolean) {
  $(id).closest("label")?.classList.toggle("hidden", !visible);
}

function toggleCheckRow(id: string, visible: boolean) {
  $(id).closest("label")?.classList.toggle("hidden", !visible);
}

function toggleAction(id: string, visible: boolean) {
  $(id).classList.toggle("hidden", !visible);
}

function toggleFindOpen(options: { prefillFromSelection?: boolean } = {}) {
  const input = $("findInput") as HTMLInputElement;
  if (options.prefillFromSelection) {
    const selectedText = selectedEditorTextForFind();
    if (selectedText) {
      input.value = selectedText;
      scheduleSessionSave();
    }
  }
  $("findPopover").classList.remove("hidden");
  input.focus();
  input.select();
}

function closeFind() {
  $("findPopover").classList.add("hidden");
  resetSearchResults();
  editor.focus();
}

function selectedEditorTextForFind() {
  const selection = editor.getSelection();
  const model = editor.getModel();
  if (!selection || selection.isEmpty() || !model) return "";
  const normalized = model.getValueInRange(selection).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized || normalized.includes("\n") || normalized.trim().length === 0) return "";
  return normalized.slice(0, 300);
}

function toggleBottom() {
  state.showBottom = !state.showBottom;
  renderBottom();
  renderSettingsMenu();
  scheduleSessionSave();
}

function toggleMenu(id: "languageMenu" | "encodingMenu" | "lineEndingMenu" | "recentMenu") {
  const menu = $(id);
  const open = menu.classList.contains("hidden");
  closeMenus();
  closeFontDropdowns();
  menu.classList.toggle("hidden", !open);
  if (open && id === "languageMenu") {
    const input = $("languageSearchInput") as HTMLInputElement;
    input.focus();
    input.select();
  }
}

function closeMenus() {
  $("languageMenu").classList.add("hidden");
  $("encodingMenu").classList.add("hidden");
  $("lineEndingMenu").classList.add("hidden");
  $("recentMenu").classList.add("hidden");
  $("tabMenu").classList.add("hidden");
  $("treeMenu").classList.add("hidden");
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

function openCommandPalette() {
  const palette = $("commandPalette");
  palette.classList.remove("hidden");
  const input = $("commandInput") as HTMLInputElement;
  input.value = "";
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

function runEditorAction(actionId: string, successMessage?: string) {
  editor.trigger("command", actionId, null);
  editor.focus();
  if (successMessage) log(successMessage);
}

function renderCommandList(query: string) {
  const commands = [
    ["新建文件", newDocument],
    ["打开文件", () => void openDocument()],
    ["打开最近文件", () => toggleMenu("recentMenu")],
    ["打开目录", () => void chooseWorkspace()],
    ["单文件模式", () => setWorkMode("single")],
    ["文件夹模式", () => void enterWorkspaceMode()],
    ["保存", () => void saveActive()],
    ["另存为", () => void saveAsActive()],
    ["保存全部", () => void saveAll()],
    ["切换到下一个标签", () => activateAdjacentDocument(1)],
    ["切换到上一个标签", () => activateAdjacentDocument(-1)],
    ["关闭当前标签", () => void closeDocument(activeDocument().id)],
    ["关闭其他标签", () => {
      tabMenuDocumentId = state.activeId;
      void closeOtherTabsFromMenu();
    }],
    ["关闭右侧标签", () => {
      tabMenuDocumentId = state.activeId;
      void closeTabsToRightFromMenu();
    }],
    ["关闭已保存标签", () => void closeSavedTabs()],
    ["查找", () => {
      setFindView("find");
      toggleFindOpen();
    }],
    ["查找下一个", () => void findNextResult()],
    ["查找上一个", () => void findPreviousResult()],
    ["当前文件中查找", () => findCurrent(true)],
    ["清除查找结果", clearSearchResults],
    ["Markdown 分屏预览", toggleMarkdownPreviewPreference],
    ["全选", () => runEditorAction("editor.action.selectAll")],
    ["复制", () => runEditorAction("editor.action.clipboardCopyAction")],
    ["剪切", () => runEditorAction("editor.action.clipboardCutAction")],
    ["粘贴", () => runEditorAction("editor.action.clipboardPasteAction")],
    ["格式化文档", () => runEditorAction("editor.action.formatDocument", "已执行格式化命令")],
    ["转到行", () => runEditorAction("editor.action.gotoLine")],
    ["自动换行", toggleWordWrap],
    ["显示缩略图", toggleMinimap],
    ["显示空白符", cycleWhitespace],
    ["切换主题", toggleTheme],
  ] as const;
  const fileCommands = state.workspace?.items
    .filter((item) => !item.isDir)
    .slice(0, 80)
    .map((item) => [`打开 ${item.name}`, () => void openPath(item.path)] as const) ?? [];
  const languageCommands = languageOptions().map(([id, label]) => [`语言 ${label}`, () => setLanguage(id)] as const);
  const all = [...commands, ...languageCommands, ...fileCommands].filter(([name]) =>
    name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  commandActions = all.slice(0, 80).map(([, action]) => action);
  commandActiveIndex = Math.min(commandActiveIndex, Math.max(0, commandActions.length - 1));
  $("commandList").innerHTML = "";
  if (all.length === 0) {
    $("commandList").innerHTML = `<div class="empty compact">没有匹配命令</div>`;
    return;
  }
  all.slice(0, 80).forEach(([name, action], index) => {
    const button = document.createElement("button");
    button.className = `command-row ${index === commandActiveIndex ? "active" : ""}`;
    button.dataset.commandIndex = String(index);
    button.textContent = name;
    button.onpointerenter = () => {
      commandActiveIndex = index;
      renderCommandSelection();
    };
    button.onclick = () => {
      $("commandPalette").classList.add("hidden");
      action();
    };
    $("commandList").appendChild(button);
  });
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
    state.findView = snapshot.findView ?? "find";
    state.mode = snapshot.workMode ?? (snapshot.workspaceRoot ? "workspace" : "single");
    state.showBottom = snapshot.showBottom ?? state.showBottom;
    state.markdownPreviewPreferenceSet = snapshot.markdownPreviewPreferenceSet ?? false;
    state.showMarkdownPreview = state.markdownPreviewPreferenceSet
      ? snapshot.showMarkdownPreview ?? state.showMarkdownPreview
      : true;
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
    applyShellFontSettings();
    applyEditorSettings();

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
        addOrReplaceDocument(dto);
        restoredCount += 1;
      } catch (error) {
        log(`恢复文件失败：${path}：${String(error)}`);
      }
    }
    let restoredDraftCount = 0;
    for (const draft of snapshot.draftDocuments ?? []) {
      const doc = createDraftDocument(draft);
      state.documents.push(doc);
      restoredDraftCount += 1;
    }

    const initial = state.documents.find((doc) => !doc.path && doc.title === "Untitled-1.txt" && !doc.dirty);
    if (restoredCount + restoredDraftCount > 0 && initial && state.documents.length > 1) {
      state.documents = state.documents.filter((doc) => doc !== initial);
      initial.model.dispose();
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
    editor.setModel(activeDocument().model);

    renderAll();
    log(`会话已恢复：${restoredCount} 个文件，${restoredDraftCount} 个临时文件`);
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
      state.mode = "workspace";
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
  sessionTimer = window.setTimeout(saveSession, 250);
}

function saveSession() {
  const active = activeDocument();
  const snapshot: SessionSnapshot = {
    openFiles: uniquePaths(state.documents.flatMap((doc) => (doc.path ? [doc.path] : []))),
    draftDocuments: draftDocumentSnapshots(),
    recentFiles: uniquePaths(state.recentFiles).slice(0, 40),
    workspaceRoot: state.workspace?.root ?? null,
    workMode: state.mode,
    showDirectory: state.showDirectory,
    collapsedDirs: [...state.collapsedDirs],
    activePath: active?.path ?? null,
    activeDraftId: active && !active.path ? ensureDraftId(active) : null,
    darkMode: state.darkMode,
    showBottom: state.showBottom,
    showMarkdownPreview: state.showMarkdownPreview,
    markdownPreviewPreferenceSet: state.markdownPreviewPreferenceSet,
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
      "editorLineNumber.foreground": "#667085",
      "editorLineNumber.activeForeground": "#858bff",
      "editorCursor.foreground": "#858bff",
      "editor.selectionBackground": "#313766",
      "editor.lineHighlightBackground": "#252b5480",
    },
  });
}

function renderMarkdown(source: string) {
  const lines = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const html: string[] = [];
  let paragraph: string[] = [];
  let blockquote: string[] = [];
  let listType: MarkdownListType | null = null;
  let inCode = false;
  let codeLanguage = "";
  let codeLines: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    html.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const closeList = () => {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = null;
  };

  const flushBlockquote = () => {
    if (blockquote.length === 0) return;
    const content = blockquote
      .map((line) => (line.trim() ? `<p>${renderInlineMarkdown(line.trim())}</p>` : "<br>"))
      .join("");
    html.push(`<blockquote>${content}</blockquote>`);
    blockquote = [];
  };

  const closeCode = () => {
    const language = codeLanguage ? ` data-language="${escapeAttr(codeLanguage)}"` : "";
    html.push(`<pre><code${language}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    inCode = false;
    codeLanguage = "";
    codeLines = [];
  };

  const openList = (type: MarkdownListType) => {
    if (listType === type) return;
    closeList();
    html.push(`<${type}>`);
    listType = type;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (inCode) {
      if (trimmed.startsWith("```")) {
        closeCode();
      } else {
        codeLines.push(line);
      }
      continue;
    }

    const fence = trimmed.match(/^```(\S*)\s*$/);
    if (fence) {
      flushParagraph();
      closeList();
      flushBlockquote();
      inCode = true;
      codeLanguage = fence[1] ?? "";
      codeLines = [];
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      closeList();
      flushBlockquote();
      continue;
    }

    if (isMarkdownTable(lines, index)) {
      flushParagraph();
      closeList();
      flushBlockquote();
      const table = renderMarkdownTable(lines, index);
      html.push(table.html);
      index = table.nextIndex - 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      flushBlockquote();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      closeList();
      flushBlockquote();
      html.push("<hr>");
      continue;
    }

    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      closeList();
      blockquote.push(quote[1]);
      continue;
    }

    const unordered = line.match(/^\s*[-*+]\s+(?:\[([ xX])\]\s+)?(.+)$/);
    if (unordered) {
      flushParagraph();
      flushBlockquote();
      openList("ul");
      const isTask = typeof unordered[1] === "string";
      const checked = isTask && unordered[1].toLowerCase() === "x";
      const checkbox = isTask ? `<input type="checkbox" disabled${checked ? " checked" : ""}>` : "";
      html.push(`<li${isTask ? ' class="task-item"' : ""}>${checkbox}<span>${renderInlineMarkdown(unordered[2])}</span></li>`);
      continue;
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      flushBlockquote();
      openList("ol");
      html.push(`<li><span>${renderInlineMarkdown(ordered[1])}</span></li>`);
      continue;
    }

    closeList();
    flushBlockquote();
    paragraph.push(trimmed);
  }

  if (inCode) closeCode();
  flushParagraph();
  closeList();
  flushBlockquote();
  return html.join("");
}

function renderInlineMarkdown(source: string) {
  const tokens: string[] = [];
  const stash = (html: string) => {
    const token = `@@NOTRA_INLINE_${tokens.length}@@`;
    tokens.push(html);
    return token;
  };

  let text = source
    .replace(/`([^`]+)`/g, (_match, code: string) => stash(`<code>${escapeHtml(code)}</code>`))
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g, (_match, alt: string, url: string, title: string | undefined) => {
      const safeUrl = safeMarkdownUrl(url, true);
      if (!safeUrl) return alt;
      const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
      return stash(`<img src="${escapeAttr(safeUrl)}" alt="${escapeAttr(alt)}"${titleAttr} loading="lazy">`);
    })
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g, (_match, label: string, url: string, title: string | undefined) => {
      const safeUrl = safeMarkdownUrl(url);
      if (!safeUrl) return label;
      const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
      return stash(`<a href="${escapeAttr(safeUrl)}"${titleAttr} target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`);
    });

  text = escapeHtml(text)
    .replace(/~~(.+?)~~/g, "<del>$1</del>")
    .replace(/(\*\*|__)(.+?)\1/g, "<strong>$2</strong>")
    .replace(/(\*|_)([^*_]+?)\1/g, "<em>$2</em>");

  tokens.forEach((html, index) => {
    text = text.replaceAll(`@@NOTRA_INLINE_${index}@@`, html);
  });
  return text;
}

function isMarkdownTable(lines: string[], index: number) {
  return Boolean(lines[index + 1]) && hasTableCells(lines[index]) && isMarkdownTableDivider(lines[index + 1]);
}

function renderMarkdownTable(lines: string[], index: number) {
  const headers = splitTableRow(lines[index]);
  const alignments = splitTableRow(lines[index + 1]).map(parseTableAlignment);
  const rows: string[][] = [];
  let nextIndex = index + 2;

  while (nextIndex < lines.length && hasTableCells(lines[nextIndex]) && !isMarkdownTableDivider(lines[nextIndex])) {
    rows.push(splitTableRow(lines[nextIndex]));
    nextIndex += 1;
  }

  const head = headers
    .map((cell, cellIndex) => `<th${alignmentClass(alignments[cellIndex])}>${renderInlineMarkdown(cell)}</th>`)
    .join("");
  const body = rows
    .map((row) => {
      const cells = headers
        .map((_, cellIndex) => `<td${alignmentClass(alignments[cellIndex])}>${renderInlineMarkdown(row[cellIndex] ?? "")}</td>`)
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return {
    html: `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`,
    nextIndex,
  };
}

function hasTableCells(line: string) {
  return line.includes("|") && splitTableRow(line).length > 1;
}

function splitTableRow(line: string) {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split("|").map((cell) => cell.trim());
}

function isMarkdownTableDivider(line: string) {
  const cells = splitTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function parseTableAlignment(cell: string): MarkdownTableAlign {
  const trimmed = cell.trim();
  const left = trimmed.startsWith(":");
  const right = trimmed.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return "";
}

function alignmentClass(align: MarkdownTableAlign) {
  return align ? ` class="align-${align}"` : "";
}

function safeMarkdownUrl(value: string, image = false) {
  const url = value.trim().replace(/^<(.+)>$/, "$1");
  if (!url) return null;
  if (/^https?:/i.test(url)) return url;
  if (!image && /^mailto:/i.test(url)) return url;
  if (url.startsWith("#") || url.startsWith("/") || url.startsWith("./") || url.startsWith("../")) return url;
  if (image && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(url)) return url;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  return null;
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
  return inputValue || state.workspace?.root || preferredDialogDirectory();
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
