import {
  CodeBlockLanguageSelector,
  EmojiSelector,
  FootnoteTool,
  ImageEditTool,
  ImagePathPicker,
  ImageResizeBar,
  ImageToolBar,
  InlineFormatToolbar,
  LinkTools,
  Muya,
  ParagraphFrontButton,
  ParagraphFrontMenu,
  ParagraphQuickInsertMenu,
  PreviewToolBar,
  renderToStaticHTML,
  TableChessboard,
  TableColumnToolbar,
  TableDragBar,
  zhCN,
} from "@muyajs/core";
import { Link2, createElement as createLucideElement } from "lucide";
import type Format from "../vendor/marktext-muya/src/block/base/format";
import type TableBodyCell from "../vendor/marktext-muya/src/block/gfm/table/cell";
import { cancelPendingDiagramRenders } from "../vendor/marktext-muya/src/block/extra/diagram/diagramPreview";
import { BLOCK_DOM_PROPERTY } from "../vendor/marktext-muya/src/config";
import { getCursorReference } from "../vendor/marktext-muya/src/selection";
import { encodeImageSrc, getImageInfo, type IImageInfo } from "../vendor/marktext-muya/src/utils/image";
import {
  classifyMermaidDiagramSize,
  createMermaidRenderConfig,
  repairDisconnectedMermaidClusterEdges,
  runMermaidWithCompatibility,
} from "../vendor/marktext-muya/src/utils/diagram/mermaidCompat";

export const MARKDOWN_ENGINE_VERSION = "MarkText v0.20.0-rc.1 / @muyajs/core 0.2.0";

export type MarkdownSearchOptions = {
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
  selectionOnly?: boolean;
  highlightIndex?: number;
};

export type MarkdownSearchState = {
  total: number;
  index: number;
};

export type MarkdownSearchMatch = {
  start: number;
  end: number;
  line: number;
  column: number;
  lineText: string;
  matchedText: string;
};

export type MarkdownOutlineItem = {
  level: number;
  text: string;
};

export type MarkdownPreviewOptions = {
  darkMode: boolean;
};

let mermaidRenderQueue = Promise.resolve();

async function waitForDiagramRenderOpportunity() {
  if (document.readyState !== "complete") {
    await new Promise<void>((resolve) => {
      window.addEventListener("load", () => resolve(), { once: true });
    });
  }
  if (document.fonts) await document.fonts.ready;
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(() => resolve(), { timeout: 80 });
    } else {
      window.requestAnimationFrame(() => resolve());
    }
  });
}

function normalizeMermaidViewBox(target: HTMLElement) {
  const svg = target.querySelector<SVGSVGElement>("svg");
  const root = svg?.querySelector<SVGGElement>("g.root");
  if (!svg || !root) return false;
  let bounds: DOMRect | SVGRect;
  try {
    bounds = root.getBBox();
  } catch {
    return false;
  }
  if (
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
    || bounds.width <= 0
    || bounds.height <= 0
  ) return false;
  const padding = 8;
  svg.setAttribute(
    "viewBox",
    `${bounds.x - padding} ${bounds.y - padding} ${bounds.width + padding * 2} ${bounds.height + padding * 2}`,
  );
  finalizePreviewDiagramSvg(target);
  return true;
}

function normalizeMarkdownForEngine(markdown: string) {
  return markdown.replace(/\r\n?/g, "\n");
}

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

type MarkdownEditorOptions = {
  element: HTMLElement;
  markdown: string;
  darkMode: boolean;
  fontSize: number;
  fontFamily: string;
  readOnly: boolean;
  pickImagePath: () => Promise<string>;
  resolveImageSrc: (src: string) => string;
  openLink: (href: string) => void;
  onHeadingAnchorCopied: (anchor: string) => void;
  onChange: (markdown: string) => void;
};

type MarkdownEngineMatch = {
  start: number;
  end: number;
  match: string;
  subMatches: string[];
};

type MarkdownPlugin = Parameters<typeof Muya.use>[0];
type MarkdownContentBlock = ReturnType<Muya["search"]>["matches"][number]["block"];

type MarkdownSelectionRange = {
  anchorBlock: MarkdownContentBlock;
  anchorOffset: number;
  focusBlock: MarkdownContentBlock;
  focusOffset: number;
};

function registerPlugin(plugin: unknown, options: Record<string, unknown> = {}) {
  const registered = Muya.plugins.some((item) => item.plugin === plugin);
  if (!registered) Muya.use(plugin as MarkdownPlugin, options);
}

function registerPlugins(options: Pick<MarkdownEditorOptions, "pickImagePath" | "openLink">) {
  registerPlugin(EmojiSelector);
  registerPlugin(FootnoteTool);
  registerPlugin(InlineFormatToolbar);
  registerPlugin(ImagePathPicker);
  registerPlugin(ImageEditTool, { imagePathPicker: options.pickImagePath });
  registerPlugin(ImageToolBar);
  registerPlugin(ImageResizeBar);
  registerPlugin(CodeBlockLanguageSelector);
  registerPlugin(LinkTools, {
    jumpClick: (linkInfo: { href?: string | null } | null) => {
      if (linkInfo?.href) options.openLink(linkInfo.href);
    },
  });
  registerPlugin(ParagraphFrontButton);
  registerPlugin(ParagraphFrontMenu);
  registerPlugin(ParagraphQuickInsertMenu);
  registerPlugin(TableChessboard);
  registerPlugin(TableColumnToolbar);
  registerPlugin(TableDragBar);
  registerPlugin(PreviewToolBar);
}

export function renderMarkdownPreviewHtml(markdown: string, options: MarkdownPreviewOptions) {
  const body = renderToStaticHTML(normalizeMarkdownForEngine(markdown), {
    footnote: true,
    math: true,
    superSubScript: true,
    frontMatter: true,
    isGitlabCompatibilityEnabled: true,
  });
  const imageSafeBody = body
    .replace(/<img\b(?![^>]*\bloading=)/gi, '<img loading="lazy"')
    .replace(/<img\b(?![^>]*\bdecoding=)/gi, '<img decoding="async"')
    .replace(/<img\b(?![^>]*\breferrerpolicy=)/gi, '<img referrerpolicy="no-referrer"');
  return `<article class="markdown-body" data-theme="${options.darkMode ? "dark" : "light"}">${imageSafeBody}</article>`;
}

export async function renderMarkdownPreviewDiagrams(root: HTMLElement, options: MarkdownPreviewOptions) {
  assignHeadingIds(root);
  const diagrams = [...root.querySelectorAll<HTMLElement>(
    [
      "pre > code.language-mermaid",
      "pre > code.language-vega-lite",
      "pre > code.language-plantuml",
      "pre > code.language-flowchart",
      "pre > code.language-sequence",
    ].join(", "),
  )];
  await Promise.all(diagrams.map((code) => renderDiagram(code, options)));
}

function assignHeadingIds(root: HTMLElement) {
  const used = new Set<string>();
  root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6").forEach((heading) => {
    const base = githubHeadingSlug(heading.textContent ?? "") || "heading";
    let id = base;
    let suffix = 1;
    while (used.has(id)) id = `${base}-${suffix++}`;
    used.add(id);
    heading.id = id;
  });
}

function githubHeadingSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

async function renderDiagram(code: HTMLElement, options: MarkdownPreviewOptions) {
  const source = code.textContent ?? "";
  const pre = code.closest("pre");
  if (!pre || !source.trim()) return;
  try {
    if (code.classList.contains("language-mermaid")) {
      await renderMermaidDiagram(pre, source, options.darkMode);
    } else if (code.classList.contains("language-vega-lite")) {
      await renderVegaDiagram(pre, source, options.darkMode);
    } else if (code.classList.contains("language-plantuml")) {
      await renderPlantUmlDiagram(pre, source);
    } else {
      await renderLegacyDiagram(
        pre,
        source,
        code.classList.contains("language-flowchart") ? "flowchart" : "sequence",
      );
    }
  } catch (error) {
    pre.classList.add("markdown-diagram-error");
    pre.dataset.diagramError = error instanceof Error ? error.message : String(error);
  }
}

async function renderMermaidDiagram(pre: HTMLPreElement, source: string, darkMode: boolean) {
  const task = mermaidRenderQueue.then(async () => {
    if (!pre.isConnected) return;
    const { default: mermaid } = await import("mermaid");
    const container = diagramContainer("mermaid");
    container.textContent = source;
    pre.replaceWith(container);
    try {
      await waitForDiagramRenderOpportunity();
      if (!container.isConnected) return;
      container.removeAttribute("data-processed");
      await runMermaidWithCompatibility(async () => {
        mermaid.initialize(createMermaidRenderConfig(darkMode ? "dark" : "default", source));
        await mermaid.run({ nodes: [container] });
      });
      repairDisconnectedMermaidClusterEdges(container, source);
      normalizeMermaidViewBox(container);
    } catch (error) {
      container.replaceWith(pre);
      throw error;
    }
  });
  mermaidRenderQueue = task.catch(() => undefined);
  await task;
}

async function renderVegaDiagram(pre: HTMLPreElement, source: string, darkMode: boolean) {
  const { default: embed } = await import("vega-embed");
  const container = diagramContainer("vega-lite");
  await embed(container, JSON.parse(source) as Record<string, unknown>, {
    actions: false,
    renderer: "svg",
    theme: darkMode ? "dark" : "latimes",
    ast: true,
  });
  pre.replaceWith(container);
  finalizePreviewDiagramSvg(container);
}

async function renderPlantUmlDiagram(pre: HTMLPreElement, source: string) {
  const { encode } = await import("plantuml-encoder");
  const container = diagramContainer("plantuml");
  const image = document.createElement("img");
  image.alt = "PlantUML 图表";
  image.loading = "lazy";
  image.referrerPolicy = "no-referrer";
  image.src = `https://www.plantuml.com/plantuml/svg/${encode(source)}`;
  container.appendChild(image);
  pre.replaceWith(container);
}

async function renderLegacyDiagram(
  pre: HTMLPreElement,
  source: string,
  type: "flowchart" | "sequence",
) {
  const { default: loadRenderer } = await import(
    "../vendor/marktext-muya/src/utils/diagram"
  );
  const renderer = await loadRenderer(type);
  const diagram = renderer.parse(source);
  const container = diagramContainer(type);
  pre.replaceWith(container);
  try {
    diagram.drawSVG(container, type === "sequence" ? { theme: "hand" } : {});
    ensureDiagramViewBox(container);
  } catch (error) {
    container.replaceWith(pre);
    throw error;
  }
}

function ensureDiagramViewBox(container: HTMLElement) {
  if (finalizePreviewDiagramSvg(container)) return;
  const observer = new MutationObserver(() => {
    if (finalizePreviewDiagramSvg(container)) observer.disconnect();
  });
  observer.observe(container, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["width", "height"],
  });
  window.setTimeout(() => observer.disconnect(), 5000);
}

function finalizePreviewDiagramSvg(container: HTMLElement) {
  const svg = container.querySelector("svg");
  if (!svg) return false;
  const viewBox = svg.viewBox.baseVal;
  const width = viewBox.width || Number.parseFloat(svg.getAttribute("width") ?? "");
  const height = viewBox.height || Number.parseFloat(svg.getAttribute("height") ?? "");
  if (width <= 0 || height <= 0) return false;
  if (!svg.hasAttribute("viewBox")) svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.classList.remove(
    "markdown-diagram-wide",
    "markdown-diagram-balanced",
    "markdown-diagram-portrait",
    "markdown-diagram-class",
  );
  svg.classList.add(`markdown-diagram-${classifyMermaidDiagramSize(svg, width, height)}`);
  return true;
}

function diagramContainer(type: string) {
  const container = document.createElement("div");
  container.className = `markdown-diagram ${type}`;
  return container;
}

export class MarkdownEditorBridge {
  private readonly muya: Muya;
  private readonly changeListener: () => void;
  private readonly headingCopyLinkObserver: MutationObserver;
  private readonly headingCopyListener: (payload: { key?: string }) => void;
  private readonly onChange: (markdown: string) => void;
  private readonly onHeadingAnchorCopied: (anchor: string) => void;
  private markdown: string;
  private applyingMarkdown = false;
  private changeRevision = 0;
  private synchronizedRevision = 0;
  private lastSearch: { value: string; options: MarkdownSearchOptions } | null = null;
  private searchSelection: MarkdownSelectionRange | null = null;
  private tableContextCell: TableBodyCell | null = null;
  private imageContext: {
    wrapper: HTMLElement;
    block: Format;
    imageInfo: IImageInfo;
  } | null = null;
  private appearanceSignature: string;

  constructor(options: MarkdownEditorOptions) {
    registerPlugins(options);
    this.onChange = options.onChange;
    this.onHeadingAnchorCopied = options.onHeadingAnchorCopied;
    this.appearanceSignature = markdownAppearanceSignature(
      options.darkMode,
      options.fontSize,
      options.fontFamily,
    );
    const initialMarkdown = normalizeMarkdownForEngine(options.markdown);
    this.markdown = initialMarkdown;
    this.muya = new Muya(options.element, {
      markdown: initialMarkdown,
      locale: zhCN,
      frontMatter: true,
      footnote: true,
      math: true,
      superSubScript: true,
      isGitlabCompatibilityEnabled: true,
      codeBlockLineNumbers: true,
      autoPairBracket: true,
      autoPairMarkdownSyntax: true,
      autoPairQuote: true,
      preferLooseListItem: true,
      hideQuickInsertHint: false,
      hideLinkPopup: false,
      disableHtml: false,
      autoCheck: true,
      spellcheckEnabled: true,
      autoMoveCheckedToEnd: false,
      trimUnnecessaryCodeBlockEmptyLines: false,
      bulletListMarker: "-",
      orderListDelimiter: ".",
      frontmatterType: "-",
      mermaidTheme: options.darkMode ? "dark" : "default",
      vegaTheme: options.darkMode ? "dark" : "latimes",
      fontSize: options.fontSize,
      editorFontFamily: options.fontFamily,
      lineHeight: 1.7,
      tabSize: 4,
      listIndentation: 1,
      wrapCodeBlocks: true,
      resolveImageSrc: options.resolveImageSrc,
    });
    this.changeListener = () => {
      const markdown = normalizeMarkdownForEngine(this.muya.getMarkdown());
      this.markdown = markdown;
      if (this.applyingMarkdown) return;
      this.changeRevision += 1;
      this.onChange(markdown);
    };
    this.headingCopyListener = ({ key }) => {
      if (key) {
        void this.copyHeadingAnchor(key).catch((error) => {
          console.error("复制标题锚点失败", error);
        });
      }
    };
    this.muya.on("json-change", this.changeListener);
    this.muya.on("heading-copy-link", this.headingCopyListener);
    this.muya.locale(zhCN);
    this.applyingMarkdown = true;
    try {
      this.muya.init();
    } finally {
      this.applyingMarkdown = false;
      this.synchronizedRevision = this.changeRevision;
    }
    this.decorateHeadingCopyLinks(this.root);
    this.headingCopyLinkObserver = new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach((node) => this.decorateHeadingCopyLinks(node));
      });
    });
    this.headingCopyLinkObserver.observe(this.root, { childList: true, subtree: true });
    this.updateAppearance(options.darkMode, options.fontSize, options.fontFamily);
    this.setReadOnly(options.readOnly);
  }

  get root() {
    return this.muya.domNode;
  }

  getMarkdown() {
    this.muya.flush();
    const markdown = normalizeMarkdownForEngine(this.muya.getMarkdown());
    this.markdown = markdown;
    return markdown;
  }

  hasUnsynchronizedChanges() {
    return this.changeRevision !== this.synchronizedRevision;
  }

  markSynchronized(markdown: string) {
    if (normalizeMarkdownForEngine(markdown) === this.markdown) {
      this.synchronizedRevision = this.changeRevision;
    }
  }

  getOutline(): MarkdownOutlineItem[] {
    this.muya.flush();
    return this.muya.getTOC().map((item) => ({
      level: item.lvl,
      text: item.content,
    }));
  }

  setMarkdown(markdown: string, focus = false, preserveHistory = false) {
    const normalizedMarkdown = normalizeMarkdownForEngine(markdown);
    if (normalizedMarkdown === this.markdown) {
      if (focus) this.focus();
      return;
    }
    this.markdown = normalizedMarkdown;
    this.applyingMarkdown = true;
    try {
      cancelPendingDiagramRenders(this.root);
      if (preserveHistory) {
        this.muya.replaceContent(normalizedMarkdown);
        if (focus) this.focus();
      } else {
        this.muya.setContent(normalizedMarkdown, focus);
        this.muya.clearHistory();
      }
    } finally {
      this.applyingMarkdown = false;
      this.synchronizedRevision = this.changeRevision;
    }
  }

  updateAppearance(darkMode: boolean, fontSize: number, fontFamily: string) {
    const signature = markdownAppearanceSignature(darkMode, fontSize, fontFamily);
    if (signature === this.appearanceSignature) return;
    this.appearanceSignature = signature;
    this.muya.setOptions({
      fontSize,
      editorFontFamily: fontFamily,
      mermaidTheme: darkMode ? "dark" : "default",
      vegaTheme: darkMode ? "dark" : "latimes",
    });
  }

  setReadOnly(readOnly: boolean) {
    const contentEditable = readOnly ? "false" : "true";
    if (this.root.contentEditable !== contentEditable) this.root.contentEditable = contentEditable;
    if (this.root.getAttribute("aria-readonly") !== String(readOnly)) {
      this.root.setAttribute("aria-readonly", String(readOnly));
    }
  }

  focus() {
    this.muya.focus();
  }

  undo() {
    this.muya.undo();
  }

  redo() {
    this.muya.redo();
  }

  selectAll() {
    this.muya.selectAll();
  }

  format(type: string) {
    this.muya.format(type);
    this.focus();
  }

  updateParagraph(type: string) {
    this.muya.updateParagraph(type);
    this.focus();
  }

  insertParagraph(location: "before" | "after") {
    this.muya.insertParagraph(location);
    this.focus();
  }

  showTablePicker() {
    this.focus();
    window.requestAnimationFrame(() => {
      const activeBlock = this.muya.editor.activeContentBlock ?? this.muya.editor.selection.anchorBlock;
      const reference = getCursorReference() ?? activeBlock?.domNode ?? this.root;
      this.muya.eventCenter.emit(
        "muya-table-picker",
        { row: -1, column: -1 },
        reference,
        (row: number, column: number) => {
          this.muya.createTable({ rows: row + 1, columns: column + 1 });
          this.focus();
        },
      );
    });
  }

  captureTableContext(target: Element) {
    const cellElement = target.closest<HTMLElement>(".mu-table-cell");
    const block = cellElement
      ? (cellElement as unknown as Record<string, unknown>)[BLOCK_DOM_PROPERTY]
      : null;
    this.tableContextCell = block && typeof block === "object" && "blockName" in block
      && block.blockName === "table.cell"
      ? block as TableBodyCell
      : null;
    return this.tableContextCell !== null;
  }

  captureImageContext(target: Element) {
    const wrapper = target.closest<HTMLElement>(".mu-inline-image");
    const content = wrapper?.closest<HTMLElement>(".mu-content");
    const block = content
      ? (content as unknown as Record<string, unknown>)[BLOCK_DOM_PROPERTY]
      : null;
    if (
      !wrapper
      || !wrapper.hasAttribute("data-raw")
      || !block
      || typeof block !== "object"
      || !("updateImage" in block)
      || !("replaceImage" in block)
      || !("deleteImage" in block)
    ) {
      this.imageContext = null;
      return false;
    }
    try {
      this.imageContext = {
        wrapper,
        block: block as Format,
        imageInfo: getImageInfo(wrapper),
      };
      return true;
    } catch {
      this.imageContext = null;
      return false;
    }
  }

  imageContextState() {
    const context = this.imageContext;
    if (!context) return null;
    const { attrs } = context.imageInfo.token;
    const image = context.wrapper.querySelector<HTMLImageElement>("img");
    const src = attrs.src ?? "";
    const width = Number.parseInt(attrs.width ?? "", 10);
    return {
      src,
      alt: attrs.alt ?? "",
      title: attrs.title ?? "",
      align: attrs["data-align"] || "inline",
      width: Number.isFinite(width) ? width : null,
      naturalWidth: image?.naturalWidth || 0,
      renderedWidth: Math.round(image?.getBoundingClientRect().width || 0),
      isRemote: /^https?:\/\//i.test(src),
      isLocal: Boolean(src) && !/^(?:https?:|data:|blob:)/i.test(src),
      syntax: String(context.imageInfo.token.type) === "html_tag" ? "html" : "markdown",
      markdown: context.imageInfo.token.raw,
    };
  }

  replaceContextImage(src: string) {
    const context = this.imageContext;
    if (!context || !src) return;
    const { attrs } = context.imageInfo.token;
    context.block.replaceImage(context.imageInfo, {
      alt: attrs.alt ?? "",
      src,
      title: attrs.title ?? "",
    });
    this.imageContext = null;
    this.focus();
  }

  async runImageContextAction(action: string) {
    const context = this.imageContext;
    if (!context) return;
    const state = this.imageContextState();
    if (!state) return;
    const { block, imageInfo, wrapper } = context;

    if (action === "edit") {
      const rect = wrapper.getBoundingClientRect();
      this.muya.eventCenter.emit("muya-image-selector", {
        block,
        imageInfo,
        reference: {
          getBoundingClientRect: () => new DOMRect(rect.x, rect.y, rect.width, 0),
        },
      });
      this.imageContext = null;
      return;
    }

    if (action.startsWith("align-")) {
      block.updateImage(imageInfo, "data-align", action.slice("align-".length));
    } else if (action.startsWith("scale-")) {
      const scale = action.slice("scale-".length);
      const availableWidth = Math.max(80, this.root.clientWidth - 48);
      const naturalWidth = state.naturalWidth || state.renderedWidth || availableWidth;
      const width = scale === "fit"
        ? Math.min(naturalWidth, availableWidth)
        : scale === "original"
          ? naturalWidth
          : Math.max(1, Math.round(naturalWidth * Number.parseInt(scale, 10) / 100));
      block.updateImage(imageInfo, "width", String(width));
    } else if (action === "copy-markdown") {
      await navigator.clipboard.writeText(state.markdown);
    } else if (action === "delete") {
      block.deleteImage(imageInfo);
    } else if (action === "syntax-markdown" || action === "syntax-html") {
      this.replaceImageSyntax(action.endsWith("markdown") ? "markdown" : "html");
    } else {
      return;
    }

    this.imageContext = null;
    this.focus();
  }

  private replaceImageSyntax(syntax: "markdown" | "html") {
    const context = this.imageContext;
    if (!context) return;
    const { block, imageInfo } = context;
    const { token } = imageInfo;
    const attrs = token.attrs;
    let replacement: string;
    if (syntax === "markdown") {
      const alt = (attrs.alt ?? "").replace(/]/g, "\\]");
      const title = (attrs.title ?? "").replace(/"/g, "\\\"");
      replacement = `![${alt}](${encodeImageSrc(attrs.src ?? "")}${title ? ` "${title}"` : ""})`;
    } else {
      const htmlAttrs = Object.entries(attrs)
        .filter(([name, value]) => value !== "" || name === "alt")
        .map(([name, value]) => `${name}="${escapeHtmlAttribute(value)}"`)
        .join(" ");
      replacement = `<img ${htmlAttrs} />`;
    }
    block.text = `${block.text.slice(0, token.range.start)}${replacement}${block.text.slice(token.range.end)}`;
    block.update();
  }

  tableContextState() {
    const cell = this.tableContextCell;
    if (!cell?.parent || !cell.table.parent) return null;
    return {
      row: cell.rowOffset,
      column: cell.columnOffset,
      rows: cell.table.rowCount,
      columns: cell.table.columnCount,
      align: cell.align,
    };
  }

  async runTableContextAction(action: string) {
    const cell = this.tableContextCell;
    if (!cell?.parent || !cell.table.parent) return;
    const table = cell.table;
    const row = cell.rowOffset;
    const column = cell.columnOffset;
    let cursorBlock = null;

    switch (action) {
      case "insert-row-above":
        cursorBlock = table.insertRow(row);
        break;
      case "insert-row-below":
        cursorBlock = table.insertRow(row + 1);
        break;
      case "insert-column-left":
        cursorBlock = table.insertColumn(column);
        break;
      case "insert-column-right":
        cursorBlock = table.insertColumn(column + 1);
        break;
      case "move-row-up":
        cursorBlock = table.moveRow(row, row - 1, column);
        break;
      case "move-row-down":
        cursorBlock = table.moveRow(row, row + 1, column);
        break;
      case "move-column-left":
        cursorBlock = table.moveColumn(column, column - 1, row);
        break;
      case "move-column-right":
        cursorBlock = table.moveColumn(column, column + 1, row);
        break;
      case "align-left":
      case "align-center":
      case "align-right":
        table.alignColumn(column, action.slice("align-".length));
        cursorBlock = cell.firstContentInDescendant();
        break;
      case "remove-row":
        cursorBlock = table.removeRow(row);
        break;
      case "remove-column":
        cursorBlock = table.removeColumn(column);
        break;
      case "copy": {
        const markdown = this.muya.editor.jsonState.getMarkdownFromState([table.getState()]).trimEnd();
        await navigator.clipboard.writeText(markdown);
        cursorBlock = cell.firstContentInDescendant();
        break;
      }
      case "remove-table":
        cursorBlock = table.removeTable();
        break;
      default:
        return;
    }

    this.tableContextCell = null;
    cursorBlock?.setCursor(0, 0, true);
    this.focus();
  }

  insertImage(src: string) {
    this.muya.insertImage({ src });
    this.focus();
  }

  copyAsMarkdown() {
    this.focus();
    this.muya.copyAsMarkdown();
  }

  copyAsHtml() {
    this.focus();
    this.muya.copyAsHtml();
  }

  copyAsRich() {
    this.focus();
    this.muya.copyAsRich();
  }

  async pasteAsPlainText() {
    this.focus();
    await this.muya.pasteAsPlainText();
  }

  selectedText() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return "";
    const range = selection.getRangeAt(0);
    if (!this.root.contains(range.commonAncestorContainer)) return "";
    return selection.toString();
  }

  captureSearchSelection() {
    const selection = this.muya.editor.selection;
    const live = selection.getSelection();
    const anchorBlock = live?.anchor.block ?? selection.anchorBlock;
    const focusBlock = live?.focus.block ?? selection.focusBlock;
    const anchorOffset = live?.anchor.offset ?? selection.anchor?.offset;
    const focusOffset = live?.focus.offset ?? selection.focus?.offset;
    if (
      !anchorBlock ||
      !focusBlock ||
      anchorOffset === undefined ||
      focusOffset === undefined ||
      (anchorBlock === focusBlock && anchorOffset === focusOffset)
    ) {
      this.searchSelection = null;
      return false;
    }
    this.searchSelection = { anchorBlock, anchorOffset, focusBlock, focusOffset };
    return true;
  }

  searchSelectionSignature() {
    if (!this.searchSelection) return "empty-selection";
    const { anchorBlock, anchorOffset, focusBlock, focusOffset } = this.searchSelection;
    return `${anchorBlock.path.join(".")}:${anchorOffset}-${focusBlock.path.join(".")}:${focusOffset}`;
  }

  search(value: string, options: MarkdownSearchOptions): MarkdownSearchState {
    this.lastSearch = { value, options: { ...options } };
    const searchOptions: Record<string, boolean | number> = {
      isCaseSensitive: options.matchCase,
      isWholeWord: options.wholeWord,
      isRegexp: options.regex,
    };
    if (typeof options.highlightIndex === "number") searchOptions.highlightIndex = options.highlightIndex;
    const result = this.muya.search(value, searchOptions);
    if (options.selectionOnly) this.filterSearchToSelection(result, options.highlightIndex);
    this.revealActiveSearchMatch();
    return { total: result.matches.length, index: result.index };
  }

  private filterSearchToSelection(result: ReturnType<Muya["search"]>, highlightIndex?: number) {
    const updateMatches = (result as unknown as {
      _updateMatches: (clear?: boolean) => void;
    })._updateMatches.bind(result);
    updateMatches(true);
    const range = this.searchSelection;
    if (!range) {
      result.matches = [];
      result.index = -1;
      return;
    }

    const order = new Map<MarkdownContentBlock, number>();
    let block = this.muya.editor.scrollPage?.firstContentInDescendant() ?? null;
    while (block) {
      order.set(block, order.size);
      block = block.nextContentInContext() ?? null;
    }
    const anchorIndex = order.get(range.anchorBlock);
    const focusIndex = order.get(range.focusBlock);
    if (anchorIndex === undefined || focusIndex === undefined) {
      result.matches = [];
      result.index = -1;
      return;
    }

    const forward = anchorIndex < focusIndex || (anchorIndex === focusIndex && range.anchorOffset <= range.focusOffset);
    const firstBlock = forward ? range.anchorBlock : range.focusBlock;
    const lastBlock = forward ? range.focusBlock : range.anchorBlock;
    const firstOffset = forward ? range.anchorOffset : range.focusOffset;
    const lastOffset = forward ? range.focusOffset : range.anchorOffset;
    const firstIndex = order.get(firstBlock)!;
    const lastIndex = order.get(lastBlock)!;
    result.matches = result.matches.filter((match) => {
      const index = order.get(match.block);
      if (index === undefined || index < firstIndex || index > lastIndex) return false;
      if (firstBlock === lastBlock) return match.start >= firstOffset && match.end <= lastOffset;
      if (match.block === firstBlock) return match.start >= firstOffset;
      if (match.block === lastBlock) return match.end <= lastOffset;
      return true;
    });
    const requestedIndex = highlightIndex === undefined || highlightIndex === -1 ? 0 : highlightIndex;
    result.index = result.matches.length > 0
      ? Math.min(result.matches.length - 1, Math.max(0, requestedIndex))
      : -1;
    updateMatches();
  }

  find(direction: "previous" | "next"): MarkdownSearchState {
    const result = this.muya.find(direction);
    this.revealActiveSearchMatch();
    return { total: result.matches.length, index: result.index };
  }

  searchMatches(): MarkdownSearchMatch[] {
    const matches = this.muya.editor.searchModule.matches;
    if (matches.length === 0) return [];

    this.muya.flush();
    const cleanMarkdown = normalizeMarkdownForEngine(this.muya.getMarkdown());
    let markerPrefix = "nOtRaSeArChMaTcH";
    while (cleanMarkdown.includes(markerPrefix)) markerPrefix += "X";

    const state = structuredClone(this.muya.editor.jsonState.getState());
    const markers = matches.map((match, index) => ({
      marker: `${markerPrefix}${index.toString(36).padStart(7, "0")}Qx`,
      match,
      rawIndex: -1,
      cleanIndex: -1,
    }));

    const descending = [...markers].sort((left, right) => {
      const leftPath = left.match.block.path.join(".");
      const rightPath = right.match.block.path.join(".");
      return leftPath === rightPath ? right.match.start - left.match.start : leftPath.localeCompare(rightPath);
    });
    for (const item of descending) {
      if (!injectSearchMarker(state, item.match.block.path, item.match.start, item.marker)) {
        throw new Error("无法映射 Markdown 搜索结果位置");
      }
    }

    const markedMarkdown = this.muya.editor.jsonState.getMarkdownFromState(state);
    for (const item of markers) {
      item.rawIndex = markedMarkdown.indexOf(item.marker);
      if (item.rawIndex < 0) throw new Error("无法定位 Markdown 搜索结果标记");
    }

    let removedLength = 0;
    for (const item of [...markers].sort((left, right) => left.rawIndex - right.rawIndex)) {
      item.cleanIndex = item.rawIndex - removedLength;
      removedLength += item.marker.length;
    }
    const source = markers.reduce((markdown, item) => markdown.replace(item.marker, ""), markedMarkdown);
    const sourceLines = source.split("\n");
    const lineStarts = markdownLineStarts(source);

    return markers.map((item) => {
      const position = markdownPositionAt(lineStarts, item.cleanIndex);
      return {
        start: item.cleanIndex,
        end: item.cleanIndex + item.match.match.length,
        line: position.line + 1,
        column: position.column + 1,
        lineText: sourceLines[position.line] ?? "",
        matchedText: item.match.match.split("\n", 1)[0] ?? item.match.match,
      };
    });
  }

  private revealActiveSearchMatch() {
    window.requestAnimationFrame(() => {
      this.root.querySelector<HTMLElement>(".mu-highlight")?.scrollIntoView({
        block: "center",
        inline: "nearest",
      });
    });
  }

  replace(replacement: string, replaceAll: boolean, regex: boolean): MarkdownSearchState {
    if (regex && this.lastSearch) return this.replaceRegex(replacement, replaceAll);
    const result = this.muya.replace(replacement, { isSingle: !replaceAll, isRegexp: regex });
    return { total: result.matches.length, index: result.index };
  }

  private replaceRegex(replacement: string, replaceAll: boolean): MarkdownSearchState {
    const search = this.muya.editor.searchModule;
    const active = search.matches[search.index];
    const targets = replaceAll ? [...search.matches] : active ? [active] : [];
    if (targets.length === 0 || !this.lastSearch) {
      return { total: search.matches.length, index: search.index };
    }

    const matchesByBlock = new Map<(typeof targets)[number]["block"], typeof targets>();
    for (const match of targets) {
      const matches = matchesByBlock.get(match.block) ?? [];
      matches.push(match);
      matchesByBlock.set(match.block, matches);
    }

    for (const [block, matches] of matchesByBlock) {
      const source = block.text;
      let cursor = 0;
      let next = "";
      for (const match of matches) {
        next += source.slice(cursor, match.start);
        next += expandRegexReplacement(replacement, match, source, this.lastSearch);
        cursor = match.end;
      }
      block.text = next + source.slice(cursor);
    }

    const previousIndex = search.index;
    const refreshed = this.muya.search(this.lastSearch.value, {
      isCaseSensitive: this.lastSearch.options.matchCase,
      isWholeWord: this.lastSearch.options.wholeWord,
      isRegexp: true,
      highlightIndex: replaceAll ? -1 : Math.max(0, Math.min(previousIndex, search.matches.length - 1)),
    });
    return { total: refreshed.matches.length, index: refreshed.index };
  }

  clearSearch(preserveSelection = false) {
    this.muya.search("", { selectHighlight: true });
    this.lastSearch = null;
    if (!preserveSelection) this.searchSelection = null;
  }

  hideFloatTools() {
    this.muya.hideAllFloatTools();
  }

  revealHeading(index: number) {
    const heading = this.root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")[index];
    heading?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  private decorateHeadingCopyLinks(node: Node) {
    const links: HTMLElement[] = [];
    if (node instanceof HTMLElement && node.matches(".mu-copy-header-link")) links.push(node);
    if (node instanceof Element || node instanceof DocumentFragment) {
      links.push(...node.querySelectorAll<HTMLElement>(".mu-copy-header-link"));
    }
    links.forEach((link) => {
      if (link.dataset.notraIcon === "link-2") return;
      const icon = createLucideElement(Link2, {
        class: "mu-icon-inner markdown-heading-link-icon",
        "aria-hidden": "true",
        focusable: "false",
        width: "14",
        height: "14",
        "stroke-width": "1.9",
      });
      link.dataset.notraIcon = "link-2";
      link.replaceChildren(icon);
    });
  }

  private async copyHeadingAnchor(key: string) {
    const heading = this.muya.getTOC().find((item) => item.slug === key);
    if (!heading) return;
    const anchor = `#${heading.githubSlug}`;
    await navigator.clipboard.writeText(anchor);
    this.onHeadingAnchorCopied(anchor);
  }

  destroy() {
    this.headingCopyLinkObserver.disconnect();
    cancelPendingDiagramRenders(this.root);
    this.muya.off("json-change", this.changeListener);
    this.muya.off("heading-copy-link", this.headingCopyListener);
    this.root.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
      image.removeAttribute("src");
      image.removeAttribute("srcset");
    });
    this.muya.clearHistory();
    const renderer = this.muya.editor.inlineRenderer.renderer;
    renderer.loadImageMap.clear();
    renderer.urlMap.clear();
    renderer.loadMathMap.clear();
    this.muya.destroy();
  }
}

function markdownAppearanceSignature(darkMode: boolean, fontSize: number, fontFamily: string) {
  return JSON.stringify([darkMode, fontSize, fontFamily]);
}

function injectSearchMarker(
  state: unknown,
  path: Array<string | number>,
  offset: number,
  marker: string,
) {
  if (path.length === 0) return false;
  let node = state;
  for (let index = 0; index < path.length - 1; index += 1) {
    if (node === null || typeof node !== "object") return false;
    node = (node as Record<string | number, unknown>)[path[index]];
  }
  if (node === null || typeof node !== "object") return false;
  const key = path[path.length - 1];
  const holder = node as Record<string | number, unknown>;
  const text = holder[key];
  if (typeof text !== "string") return false;
  const at = Math.min(text.length, Math.max(0, offset));
  holder[key] = `${text.slice(0, at)}${marker}${text.slice(at)}`;
  return true;
}

function markdownLineStarts(markdown: string) {
  const starts = [0];
  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

function markdownPositionAt(lineStarts: number[], offset: number) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (lineStarts[middle] <= offset) low = middle + 1;
    else high = middle - 1;
  }
  const line = Math.max(0, high);
  return { line, column: offset - lineStarts[line] };
}

function expandRegexReplacement(
  replacement: string,
  match: MarkdownEngineMatch,
  source: string,
  search: { value: string; options: MarkdownSearchOptions },
) {
  const namedGroups = replacement.includes("$<")
    ? regexNamedGroupsAt(source, search.value, search.options, match.start)
    : undefined;
  return replacement.replace(/\$(\$|&|0|`|'|<([^>]+)>|(\d{1,2}))/g, (token, marker: string, name?: string, digits?: string) => {
    if (marker === "$") return "$";
    if (marker === "&" || marker === "0") return match.match;
    if (marker === "`") return source.slice(0, match.start);
    if (marker === "'") return source.slice(match.end);
    if (marker.startsWith("<")) {
      return namedGroups && name && Object.prototype.hasOwnProperty.call(namedGroups, name)
        ? namedGroups[name] ?? ""
        : token;
    }
    if (!digits) return token;
    const index = Number(digits);
    if (index > 0 && index <= match.subMatches.length) return match.subMatches[index - 1] ?? "";
    if (digits.length === 2) {
      const first = Number(digits[0]);
      if (first > 0 && first <= match.subMatches.length) return `${match.subMatches[first - 1] ?? ""}${digits[1]}`;
    }
    return token;
  });
}

function regexNamedGroupsAt(
  source: string,
  pattern: string,
  options: MarkdownSearchOptions,
  expectedIndex: number,
) {
  try {
    const expression = new RegExp(options.wholeWord ? `\\b${pattern}\\b` : pattern, options.matchCase ? "g" : "gi");
    let match: RegExpExecArray | null;
    while ((match = expression.exec(source))) {
      if (match.index === expectedIndex) return match.groups;
      if (match.index > expectedIndex) break;
      if (match[0] === "") expression.lastIndex += 1;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
