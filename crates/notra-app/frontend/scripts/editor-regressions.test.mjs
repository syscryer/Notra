import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const file = new URL("../src/main.ts", import.meta.url);
const source = fs.readFileSync(file, "utf8");
const tree = ts.createSourceFile(file.pathname, source, ts.ScriptTarget.Latest, true);
function load(names, dependencies) {
  const functions = tree.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  assert.equal(functions.length, names.length);
  const javascript = ts.transpileModule(functions.map((node) => node.getText(tree)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const context = vm.createContext(dependencies);
  vm.runInContext(javascript, context);
  return context;
}
function startup(overrides = {}) {
  const events = [];
  const state = { restoring: false, workspace: null };
  const context = load(["initializeAppStartup", "applyOpenRequest", "drainOpenRequests"], {
    state, openRequestsReady: false, SESSION_KEY: "session",
    invoke: async (name) => {
      if (name === "startup_args") return { files: ["missing.txt", "current.txt"], directories: [] };
      if (name === "load_session") return JSON.stringify({ draftDocuments: [{ text: "unsaved" }] });
      if (name === "take_open_requests") return [{ files: ["queued.txt"], directories: [] }];
      throw new Error(`Unexpected command: ${name}`);
    },
    localStorage: { getItem: () => null, removeItem: () => events.push("migrated") },
    log: (message) => events.push(message), applySessionSnapshotSettings() {},
    closeMenus() {}, closeSettingsPage() {}, renderAll() {}, requestEditorLayout() {}, discardCleanPlaceholder() {},
    openWorkspacePath: async () => {},
    openPath: async (path) => {
      if (path === "missing.txt") throw new Error("file not found");
      events.push(`open:${path}`);
    },
    restoreSessionSnapshot: async (snapshot, options) => {
      events.push(`restore:${snapshot.draftDocuments[0].text}:${options.preserveActiveDocument}`);
    },
    markAppReady: () => events.push("shown"), scheduleSessionSave: () => events.push("save-scheduled"),
    saveSession: async () => events.push("saved"), syncSystemIntegrationPreferences: async () => {},
    ...overrides,
  });
  return { context, events, state };
}

test("a failed startup file does not skip the remaining files, drafts or queued requests", async () => {
  const { context, events, state } = startup();
  await context.initializeAppStartup();
  assert.ok(events.some((event) => event.includes("missing.txt") && event.includes("file not found")));
  assert.ok(events.includes("open:current.txt"));
  assert.ok(events.includes("restore:unsaved:true"));
  assert.ok(events.includes("open:queued.txt"));
  assert.equal(context.openRequestsReady, true);
  assert.equal(state.restoring, false);
});

test("when every startup file fails the old active document can still be restored", async () => {
  const { context, events } = startup({ openPath: async () => { throw new Error("permission denied"); } });
  await context.initializeAppStartup();
  assert.ok(events.includes("restore:unsaved:false"));
  assert.equal(context.openRequestsReady, true);
});

test("the primary document is shown before slow session restoration and saves stay suspended", async () => {
  let completeRestore;
  const { context, events, state } = startup({
    restoreSessionSnapshot: () => new Promise((resolve) => { completeRestore = resolve; }),
  });
  const operation = context.initializeAppStartup();
  await new Promise(setImmediate);
  assert.ok(events.includes("shown"));
  assert.equal(state.restoring, true);
  assert.equal(context.openRequestsReady, false);
  assert.ok(!events.includes("open:queued.txt"));
  completeRestore();
  await operation;
  assert.equal(state.restoring, false);
  assert.equal(context.openRequestsReady, true);
  assert.ok(events.includes("open:queued.txt"));
});

function clipboard(overrides = {}) {
  const model = {};
  const calls = [];
  const context = load(["runMonacoClipboard", "runClipboardAction", "pastePlainText"], {
    activeDocument: () => ({ readOnly: false }), editorBusyDepth: 0,
    isMarkdownWysiwygActive: () => false, markdownEditor: null,
    editor: { getModel: () => model, focus() {}, getId: () => "editor", getOption: (option) => option !== 169, trigger: (...args) => calls.push(args) },
    navigator: { clipboard: { readText: async () => "A\nB" } },
    document: { execCommand: (kind) => { calls.push([kind]); return true; } },
    InMemoryClipboardMetadataManager: { INSTANCE: { get: () => ({ multicursorText: ["A", "B"] }) } },
    monaco: { editor: { EditorOption: { emptySelectionClipboard: 45, effectiveEditContext: 169 } } },
    NativeEditContextRegistry: { get: () => ({ onWillCopy() {} }) },
    log: (message) => calls.push(["error", message]),
    ...overrides,
  });
  return { context, calls, model };
}

test("copy and cut use Monaco's native clipboard handlers for all selections", async () => {
  const { context, calls } = clipboard();
  await context.runClipboardAction("copy");
  await context.runClipboardAction("cut");
  assert.deepEqual(calls, [["copy"], ["cut"]]);
});

test("paste retains multicursor metadata and uses Monaco's paste operation", async () => {
  const { context, calls } = clipboard();
  await context.runClipboardAction("paste");
  assert.equal(calls[0][1], "paste");
  assert.deepEqual(Array.from(calls[0][2].multicursorText), ["A", "B"]);
  assert.equal(calls[0][2].text, "A\nB");
});

test("EditContext cut copies successfully before invoking Monaco's delete operation", async () => {
  const { context, calls } = clipboard();
  context.editor.getOption = () => true;
  await context.runClipboardAction("cut");
  assert.equal(calls[0][0], "copy");
  assert.equal(calls[1][1], "cut");
});

test("line copy metadata is retained by regular paste but removed by plain paste", async () => {
  const { context, calls } = clipboard({
    InMemoryClipboardMetadataManager: { INSTANCE: { get: () => ({ isFromEmptySelection: true }) } },
  });
  await context.runClipboardAction("paste");
  await context.pastePlainText();
  assert.equal(calls[0][2].pasteOnNewLine, true);
  assert.equal(calls[1][2].pasteOnNewLine, false);
});

test("clipboard permission delays cannot paste into a different document", async () => {
  let resolveRead;
  const { context, calls } = clipboard({ navigator: { clipboard: { readText: () => new Promise((resolve) => { resolveRead = resolve; }) } } });
  const operation = context.runClipboardAction("paste");
  context.editor.getModel = () => ({});
  resolveRead("secret");
  await operation;
  assert.equal(calls.length, 0);
});

test("read-only and busy documents do not receive clipboard edits", async () => {
  const { context, calls } = clipboard({ activeDocument: () => ({ readOnly: true }) });
  await context.runClipboardAction("cut");
  await context.runClipboardAction("paste");
  await context.pastePlainText();
  assert.equal(calls.length, 0);
  context.activeDocument = () => ({ readOnly: false });
  context.editorBusyDepth = 1;
  await context.runClipboardAction("paste");
  assert.equal(calls.length, 0);
});

test("clipboard rejection is observable instead of silently reported as success", async () => {
  const { context, calls } = clipboard({ document: { execCommand: () => false } });
  await context.runClipboardAction("cut");
  assert.equal(calls[0][0], "error");
  assert.match(calls[0][1], /cut/);
});

function tabDrag() {
  const listeners = new Map(), frames = new Map(), timers = new Map();
  let frameId = 0, timerId = 0;
  const classes = () => {
    const values = new Set();
    return { add: (...names) => names.forEach((n) => values.add(n)), remove: (...names) => names.forEach((n) => values.delete(n)), contains: (n) => values.has(n) };
  };
  const tabs = { scrollLeft: 0, getBoundingClientRect: () => ({ left: 0, right: 200 }), querySelectorAll: () => elements };
  const elements = [0, 1].map((index) => ({
    style: {}, classList: classes(), offsetWidth: 100,
    getBoundingClientRect: () => ({ left: index * 104, right: index * 104 + 100, width: 100 }),
  }));
  const state = { documents: [{ id: 1 }, { id: 2 }] };
  const bodyClasses = classes();
  const raf = (callback) => { frames.set(++frameId, callback); return frameId; };
  const cancel = (id) => frames.delete(id);
  const context = load(["handleTabPointerDown"], {
    state, tabDragCleanup: null, ignoreTabClickUntil: 0, renderedTabsSignature: "",
    $: () => tabs, document: { body: { classList: bodyClasses } },
    requestAnimationFrame: raf, cancelAnimationFrame: cancel,
    clearTimeout: (id) => timers.delete(id),
    window: {
      requestAnimationFrame: raf, cancelAnimationFrame: cancel,
      addEventListener: (name, fn) => listeners.set(name, fn),
      removeEventListener: (name) => listeners.delete(name),
      setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; }, clearTimeout: (id) => timers.delete(id),
    },
    scheduleTabScrollStateUpdate() {}, renderTabs() {}, activateDocument() {}, scheduleSessionSave() {},
  });
  const start = () => context.handleTabPointerDown(1, elements[0], { button: 0, target: { closest: () => null }, clientX: 50, clientY: 10, pointerId: 1 });
  const move = () => listeners.get("pointermove")({ clientX: 195, clientY: 10, pointerId: 1 });
  const tick = () => {
    const entry = frames.entries().next().value;
    if (!entry) return false;
    frames.delete(entry[0]); entry[1](); return true;
  };
  const settle = () => { for (const [id, fn] of timers) { timers.delete(id); fn(); } };
  return { context, listeners, frames, timers, state, tabs, elements, bodyClasses, start, move, tick, settle };
}

test("stationary tab dragging continues scrolling across animation frames and Escape cancels it", () => {
  const drag = tabDrag();
  drag.start(); drag.move();
  for (let i = 0; i < 5; i++) assert.equal(drag.tick(), true);
  assert.ok(drag.tabs.scrollLeft > 14);
  drag.listeners.get("keydown")({ key: "Escape", preventDefault() {} });
  drag.settle();
  assert.deepEqual(drag.state.documents.map((doc) => doc.id), [1, 2]);
  assert.equal(drag.frames.size, 0);
  assert.equal(drag.context.tabDragCleanup, null);
  assert.equal(drag.bodyClasses.contains("tab-reordering"), false);
  assert.ok(drag.elements.every((el) => !el.classList.contains("tab-settling") && !el.style.transform));
});

test("a new drag cancels a previous pending landing without applying its stale reorder", () => {
  const drag = tabDrag();
  drag.start(); drag.move();
  drag.listeners.get("pointerup")({ pointerId: 1 });
  assert.equal(drag.timers.size, 1);
  drag.start();
  assert.equal(drag.timers.size, 0);
  drag.listeners.get("pointercancel")({ pointerId: 1 });
  drag.settle();
  assert.deepEqual(drag.state.documents.map((doc) => doc.id), [1, 2]);
});
