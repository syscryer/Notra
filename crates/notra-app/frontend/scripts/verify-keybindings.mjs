import fs from "node:fs";
import process from "node:process";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/keybindings.ts", import.meta.url), "utf8");
const mainSource = fs.readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const htmlSource = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const keybindings = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);

const profiles = [
  ["VS Code", keybindings.VSCODE_KEYMAP],
  ["Notepad++", keybindings.NOTEPAD_PLUS_PLUS_KEYMAP],
];
const implementedCommands = new Set(
  [...mainSource.matchAll(/(?:command|editorCommand|markdownCommand)\("([^"]+)"/g)].map((match) => match[1]),
);
const failures = [];
const ids = [...htmlSource.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
for (const id of new Set(ids)) {
  if (ids.filter((value) => value === id).length > 1) failures.push(`重复 DOM id：${id}`);
}
let testedStrokes = 0;
const SHIFTED_GLYPHS = new Map([
  [";", ":"], ["'", '"'], [",", "<"], [".", ">"], ["/", "?"], ["`", "~"],
  ["[", "{"], ["]", "}"], ["\\", "|"], ["-", "_"],
  ["0", ")"], ["1", "!"], ["2", "@"], ["3", "#"], ["4", "$"], ["5", "%"],
  ["6", "^"], ["7", "&"], ["8", "*"], ["9", "("],
]);
const PHYSICAL_CODES = new Map([
  [";", "Semicolon"], ["'", "Quote"], [",", "Comma"], [".", "Period"], ["/", "Slash"],
  ["`", "Backquote"], ["[", "BracketLeft"], ["]", "BracketRight"], ["\\", "Backslash"],
  ["-", "Minus"], ["=", "Equal"], [" ", "Space"],
]);

if (!mainSource.includes('$("editor").addEventListener("keydown", handleEditorKeybinding, true)')) {
  failures.push("Monaco 编辑器没有注册局部快捷键监听");
}
if (!mainSource.includes('$("markdownWysiwyg").addEventListener("keydown", handleEditorKeybinding, true)')) {
  failures.push("Markdown 即时编辑器没有注册局部快捷键监听");
}
if (/document\.addEventListener\("keydown",\s*handleEditorKeybinding/.test(mainSource)) {
  failures.push("编辑器快捷键不得注册到 document");
}
const editorKeybindingHandler = mainSource.slice(
  mainSource.indexOf("function handleEditorKeybinding"),
  mainSource.indexOf("function matchingCommands"),
);
const nativeClipboardGuardIndexes = [...editorKeybindingHandler.matchAll(/usesNativeClipboardShortcut\(stroke, (?:exact|standalone)\[0\]\)/g)]
  .map((match) => match.index);
const shortcutPreventDefaultIndex = editorKeybindingHandler.indexOf("event.preventDefault()");
if (
  !mainSource.includes('["Ctrl+C", "edit.copy"]') ||
  !mainSource.includes('["Ctrl+X", "edit.cut"]') ||
  !mainSource.includes('["Ctrl+V", "edit.paste"]') ||
  !mainSource.includes("NATIVE_CLIPBOARD_SHORTCUTS.get(stroke) === command?.id") ||
  nativeClipboardGuardIndexes.length !== 2 ||
  shortcutPreventDefaultIndex < 0 ||
  nativeClipboardGuardIndexes[0] > shortcutPreventDefaultIndex
) {
  failures.push("编辑器原生剪贴板快捷键没有覆盖普通按键和组合键回退");
}
if (!/if \(scope === "workspace" \|\| showPanel\)/.test(mainSource)) {
  failures.push("当前文件全部查找没有打开右侧结果面板");
}
if (!mainSource.includes("markdownMatchesToDto(activeMarkdownEditor.searchMatches())")) {
  failures.push("Markdown 当前文件结果没有使用 Muya 搜索坐标");
}
if (!mainSource.includes('document.body.classList.toggle("current-find-open", open)')) {
  failures.push("当前查找栏没有同步页面级打开状态");
}
if (!mainSource.includes("currentSearchPatternError(query)")) {
  failures.push("当前查找没有校验正则表达式");
}
if (/\slist="(?:findHistoryList|replaceHistoryDataList)"/.test(htmlSource)) {
  failures.push("文件查找历史仍在使用原生 datalist");
}
if (!htmlSource.includes('id="findHistoryMenu"') || !htmlSource.includes('id="replaceHistoryMenu"')) {
  failures.push("文件查找和替换缺少自绘历史菜单");
}
if (!htmlSource.includes('id="toggleKeybindingGroupsButton"')) {
  failures.push("快捷键设置缺少分组展开收起控制");
}
if (!mainSource.includes('className = `keybinding-group ${collapsed ? "collapsed" : ""}`')) {
  failures.push("快捷键设置没有按命令分类渲染分组");
}
if (
  !mainSource.includes("dirty: currentText !== textToSave")
  || !mainSource.includes("savedText: textToSave")
) {
  failures.push("保存完成后没有使用实际提交的文本快照清理未保存状态");
}

for (const [profileName, profile] of profiles) {
  const commandsByBinding = new Map();
  for (const [commandId, bindings] of Object.entries(profile)) {
    if (!implementedCommands.has(commandId)) failures.push(`${profileName}: ${commandId} 没有命令实现`);
    if (new Set(bindings).size !== bindings.length) failures.push(`${profileName}: ${commandId} 包含重复键位`);
    for (const binding of bindings) {
      commandsByBinding.set(binding, [...(commandsByBinding.get(binding) ?? []), commandId]);
      if (keybindings.normalizeBinding(binding) !== binding) {
        failures.push(`${profileName}: ${commandId} 键位未规范化：${binding}`);
      }
      for (const stroke of binding.split(" ")) {
        const actual = keybindings.keyboardEventStroke(physicalKeyEvent(stroke));
        if (actual !== stroke) failures.push(`${profileName}: ${commandId} 的 ${stroke} 实际按键被解析为 ${actual}`);
        testedStrokes += 1;
      }
    }
  }
  const allowedContextualConflicts = profileName === "VS Code"
    ? new Set([
      "Ctrl+Shift+O:editor.quickOutline,markdown.outline",
      "Ctrl+B:markdown.bold,view.toggleExplorer",
      "Ctrl+0:markdown.paragraph,view.zoomReset",
    ])
    : new Set([
      "Ctrl+Alt+L:editor.formatDocument,markdown.link",
      "Ctrl+B:editor.goToBracket,markdown.bold",
      "Ctrl+0:markdown.paragraph,view.zoomReset",
    ]);
  for (const [binding, commandIds] of commandsByBinding) {
    if (commandIds.length < 2) continue;
    const signature = `${binding}:${[...commandIds].sort().join(",")}`;
    if (!allowedContextualConflicts.has(signature)) {
      failures.push(`${profileName}: ${binding} 存在未声明冲突：${commandIds.join("、")}`);
    }
  }
}

for (const [profileName, profile] of profiles) {
  const requiredBindings = [
    ["file.save", "Ctrl+S"],
    ["edit.undo", "Ctrl+Z"],
    ["edit.cut", "Ctrl+X"],
    ["edit.copy", "Ctrl+C"],
    ["edit.paste", "Ctrl+V"],
    ["edit.pastePlain", "Ctrl+Shift+V"],
    ["edit.selectAll", "Ctrl+A"],
    ["search.find", "Ctrl+F"],
    ...Array.from({ length: 6 }, (_, index) => [`markdown.heading${index + 1}`, `Ctrl+${index + 1}`]),
  ];
  for (const [commandId, binding] of requiredBindings) {
    if (!profile[commandId]?.includes(binding)) failures.push(`${profileName}: ${commandId} 缺少 ${binding}`);
  }
}

const monacoModules = readMonacoImportClosure();
const monacoActionIds = new Set([
  ...[...mainSource.matchAll(/editorCommand\("[^"]+",\s*"[^"]+",\s*"([^"]+)"/g)].map((match) => match[1]),
  ...[...mainSource.matchAll(/runEditorAction\("([^"]+)"/g)].map((match) => match[1]),
]);
for (const actionId of monacoActionIds) {
  const registered = monacoModules.some(
    (text) => text.includes(`'${actionId}'`) || text.includes(`"${actionId}"`),
  );
  if (!registered) failures.push(`Monaco action 未随 main.ts 导入的模块注册：${actionId}`);
}

if (keybindings.resolveKeymapProfile("adaptive", "workspace") !== "vscode") {
  failures.push("跟随模式在工作区中未解析为 VS Code");
}
if (keybindings.resolveKeymapProfile("adaptive", "single") !== "notepad-plus-plus") {
  failures.push("跟随模式在单文件模式中未解析为 Notepad++");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`快捷键验证通过：2 套键位，${testedStrokes} 个按键 stroke，${monacoActionIds.size} 个 Monaco action。`);
}

// 按声明的键位还原浏览器真正上报的 key/code/shiftKey，避免用键位字符串自证
function physicalKeyEvent(stroke) {
  const parts = stroke.split("+");
  const plusChord = stroke.endsWith("++");
  const modifiers = new Set(parts.slice(0, -1));
  const key = plusChord ? "+" : parts[parts.length - 1];
  const shift = modifiers.has("Shift");
  let actualKey = key;
  let code = key;
  if (plusChord) {
    actualKey = "+";
    code = "Equal";
    modifiers.add("Shift");
  } else if (/^[A-Z]$/.test(key)) {
    actualKey = shift ? key : key.toLowerCase();
    code = `Key${key}`;
  } else if (/^[0-9]$/.test(key)) {
    actualKey = shift ? SHIFTED_GLYPHS.get(key) : key;
    code = `Digit${key}`;
  } else if (key === "Space") {
    actualKey = " ";
    code = "Space";
  } else if (SHIFTED_GLYPHS.has(key) || PHYSICAL_CODES.has(key)) {
    actualKey = shift ? (SHIFTED_GLYPHS.get(key) ?? key) : key;
    code = PHYSICAL_CODES.get(key) ?? key;
  }
  return {
    key: actualKey,
    code,
    ctrlKey: modifiers.has("Ctrl"),
    shiftKey: modifiers.has("Shift"),
    altKey: modifiers.has("Alt"),
    metaKey: modifiers.has("Meta"),
    isComposing: false,
  };
}

// main.ts 只 import 部分 contribution，未导入的模块即使存在于 node_modules 也不会注册 action
function readMonacoImportClosure() {
  const esmRoot = new URL("../node_modules/monaco-editor/esm/", import.meta.url);
  const pending = [...mainSource.matchAll(/(?:^|\n)[ \t]*import\s+(?:[^;]*?\s+from\s+)?"(monaco-editor\/esm\/[^"?]+)"/g)]
    .map((match) => new URL(`${match[1].slice("monaco-editor/esm/".length)}.js`, esmRoot))
    .filter((url) => fs.existsSync(url));
  const visited = new Set();
  const texts = [];
  while (pending.length > 0) {
    const file = pending.shift();
    if (visited.has(file.href)) continue;
    visited.add(file.href);
    const text = fs.readFileSync(file, "utf8");
    texts.push(text);
    const directory = new URL("./", file);
    for (const match of text.matchAll(/(?:from|import)\s+["'](\.[^"']*?)["']/g)) {
      const specifier = match[1].split("?")[0];
      if (!specifier.endsWith(".js")) continue;
      const dependency = new URL(specifier, directory);
      if (fs.existsSync(dependency)) pending.push(dependency);
    }
  }
  return texts;
}
