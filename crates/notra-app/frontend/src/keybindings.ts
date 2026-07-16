export type KeymapProfile = "vscode" | "notepad-plus-plus" | "adaptive";
export type ResolvedKeymapProfile = Exclude<KeymapProfile, "adaptive">;
export type KeybindingOverrides = Record<string, string | null>;
export type KeybindingMap = Record<string, readonly string[]>;

export const KEYMAP_PROFILE_LABELS: Record<KeymapProfile, string> = {
  vscode: "VS Code",
  "notepad-plus-plus": "Notepad++",
  adaptive: "跟随模式",
};

export const VSCODE_KEYMAP: KeybindingMap = {
  "file.new": ["Ctrl+N"],
  "file.open": ["Ctrl+O"],
  "file.openFolder": ["Ctrl+K Ctrl+O"],
  "workspace.close": ["Ctrl+K F"],
  "file.save": ["Ctrl+S"],
  "file.saveAs": ["Ctrl+Shift+S"],
  "file.saveAll": ["Ctrl+K S"],
  "file.close": ["Ctrl+W"],
  "file.reopenClosed": ["Ctrl+Shift+T"],
  "tabs.next": ["Ctrl+PageDown", "Ctrl+Tab"],
  "tabs.previous": ["Ctrl+PageUp", "Ctrl+Shift+Tab"],
  "tabs.closeOthers": ["Ctrl+K Ctrl+W"],
  "edit.undo": ["Ctrl+Z"],
  "edit.redo": ["Ctrl+Y", "Ctrl+Shift+Z"],
  "edit.cut": ["Ctrl+X"],
  "edit.copy": ["Ctrl+C"],
  "edit.paste": ["Ctrl+V"],
  "edit.pastePlain": ["Ctrl+Shift+V"],
  "edit.selectAll": ["Ctrl+A"],
  "editor.duplicateLineDown": ["Shift+Alt+ArrowDown"],
  "editor.insertLineAfter": ["Ctrl+Enter"],
  "editor.insertLineBefore": ["Ctrl+Shift+Enter"],
  "editor.indentLines": ["Ctrl+]"],
  "editor.outdentLines": ["Ctrl+["],
  "editor.deleteLine": ["Ctrl+Shift+K"],
  "editor.moveLineUp": ["Alt+ArrowUp"],
  "editor.moveLineDown": ["Alt+ArrowDown"],
  "editor.toggleLineComment": ["Ctrl+/"],
  "editor.toggleBlockComment": ["Shift+Alt+A"],
  "editor.formatDocument": ["Shift+Alt+F"],
  "editor.selectNextOccurrence": ["Ctrl+D"],
  "editor.selectAllOccurrences": ["Ctrl+Shift+L"],
  "editor.addCursorAbove": ["Ctrl+Alt+ArrowUp"],
  "editor.addCursorBelow": ["Ctrl+Alt+ArrowDown"],
  "editor.triggerSuggest": ["Ctrl+Space"],
  "editor.triggerParameterHints": ["Ctrl+Shift+Space"],
  "editor.quickOutline": ["Ctrl+Shift+O"],
  "editor.goToBracket": ["Ctrl+Shift+\\"],
  "editor.renameSymbol": ["F2"],
  "editor.fold": ["Ctrl+Shift+["],
  "editor.unfold": ["Ctrl+Shift+]"],
  "editor.foldAll": ["Ctrl+K Ctrl+0"],
  "editor.unfoldAll": ["Ctrl+K Ctrl+J"],
  "search.find": ["Ctrl+F"],
  "search.replace": ["Ctrl+H"],
  "search.next": ["F3"],
  "search.previous": ["Shift+F3"],
  "search.workspaceFind": ["Ctrl+Shift+F"],
  "search.workspaceReplace": ["Ctrl+Shift+H"],
  "navigation.goToLine": ["Ctrl+G"],
  "navigation.quickOpen": ["Ctrl+P"],
  "navigation.commandPalette": ["Ctrl+Shift+P", "F1"],
  "navigation.focusExplorer": ["Ctrl+Shift+E"],
  "view.toggleExplorer": ["Ctrl+B"],
  "view.openSettings": ["Ctrl+,"],
  "view.toggleRightSidebar": ["Ctrl+Alt+B"],
  "view.toggleWordWrap": ["Alt+Z"],
  "view.zoomIn": ["Ctrl+=", "Ctrl++"],
  "view.zoomOut": ["Ctrl+-"],
  "view.zoomReset": ["Ctrl+0"],
  "view.toggleTheme": ["Ctrl+K Ctrl+T"],
  "bookmark.toggle": ["Ctrl+F2"],
  "markdown.outline": ["Ctrl+Shift+O"],
  "markdown.bold": ["Ctrl+B"],
  "markdown.italic": ["Ctrl+I"],
  "markdown.inlineCode": ["Ctrl+`"],
  "markdown.link": ["Ctrl+L"],
  "markdown.heading1": ["Ctrl+1"],
  "markdown.heading2": ["Ctrl+2"],
  "markdown.heading3": ["Ctrl+3"],
  "markdown.heading4": ["Ctrl+4"],
  "markdown.heading5": ["Ctrl+5"],
  "markdown.heading6": ["Ctrl+6"],
  "markdown.paragraph": ["Ctrl+0"],
  "markdown.insertImage": ["Ctrl+Shift+I"],
  "markdown.insertTable": ["Ctrl+Alt+T"],
  "markdown.codeBlock": ["Ctrl+Alt+K"],
  "markdown.mathBlock": ["Ctrl+Shift+M"],
  "markdown.modeWysiwyg": ["Ctrl+Alt+1"],
  "markdown.modeSplit": ["Ctrl+Alt+2"],
  "markdown.modeSource": ["Ctrl+Alt+3"],
};

export const NOTEPAD_PLUS_PLUS_KEYMAP: KeybindingMap = {
  "file.new": ["Ctrl+N"],
  "file.open": ["Ctrl+O"],
  "file.openFolder": ["Ctrl+Alt+O"],
  "file.save": ["Ctrl+S"],
  "file.saveAs": ["Ctrl+Alt+S"],
  "file.saveAll": ["Ctrl+Shift+S"],
  "file.close": ["Ctrl+W"],
  "file.reopenClosed": ["Ctrl+Shift+T"],
  "tabs.next": ["Ctrl+Tab", "Ctrl+PageDown"],
  "tabs.previous": ["Ctrl+Shift+Tab", "Ctrl+PageUp"],
  "tabs.closeOthers": ["Ctrl+Alt+W"],
  "edit.undo": ["Ctrl+Z"],
  "edit.redo": ["Ctrl+Y"],
  "edit.cut": ["Ctrl+X"],
  "edit.copy": ["Ctrl+C"],
  "edit.paste": ["Ctrl+V"],
  "edit.pastePlain": ["Ctrl+Shift+V"],
  "edit.selectAll": ["Ctrl+A"],
  "edit.uppercase": ["Ctrl+Shift+U"],
  "edit.lowercase": ["Ctrl+U"],
  "editor.duplicateLineDown": ["Ctrl+D"],
  "editor.insertLineAfter": ["Ctrl+Enter"],
  "editor.insertLineBefore": ["Ctrl+Shift+Enter"],
  "editor.indentLines": ["Ctrl+]"],
  "editor.outdentLines": ["Ctrl+["],
  "editor.deleteLine": ["Ctrl+L"],
  "editor.moveLineUp": ["Ctrl+Shift+ArrowUp"],
  "editor.moveLineDown": ["Ctrl+Shift+ArrowDown"],
  "editor.toggleLineComment": ["Ctrl+Q"],
  "editor.toggleBlockComment": ["Ctrl+Shift+Q"],
  "editor.selectNextOccurrence": ["Ctrl+F3"],
  "editor.selectAllOccurrences": ["Alt+F3"],
  "editor.triggerSuggest": ["Ctrl+Space"],
  "editor.triggerParameterHints": ["Ctrl+Shift+Space"],
  "editor.quickOutline": ["Ctrl+Shift+Alt+O"],
  "editor.goToBracket": ["Ctrl+B"],
  "editor.foldAll": ["Alt+0"],
  "editor.unfoldAll": ["Shift+Alt+0"],
  "search.find": ["Ctrl+F"],
  "search.replace": ["Ctrl+H"],
  "search.next": ["F3"],
  "search.previous": ["Shift+F3"],
  "search.workspaceFind": ["Ctrl+Shift+F"],
  "search.workspaceReplace": ["Ctrl+Shift+H"],
  "navigation.goToLine": ["Ctrl+G"],
  "navigation.quickOpen": ["Ctrl+Alt+P"],
  "navigation.commandPalette": ["F1"],
  "navigation.focusExplorer": ["Ctrl+Alt+E"],
  "view.toggleExplorer": ["Ctrl+Alt+B"],
  "view.openSettings": ["Ctrl+Alt+,"],
  "view.toggleRightSidebar": ["Ctrl+Shift+Alt+B"],
  "view.toggleWordWrap": ["Alt+Z"],
  "view.zoomIn": ["Ctrl+=", "Ctrl++"],
  "view.zoomOut": ["Ctrl+-"],
  "view.zoomReset": ["Ctrl+0"],
  "bookmark.toggle": ["Ctrl+F2"],
  "bookmark.next": ["F2"],
  "bookmark.previous": ["Shift+F2"],
  "markdown.outline": ["Ctrl+Shift+O"],
  "markdown.bold": ["Ctrl+B"],
  "markdown.italic": ["Ctrl+I"],
  "markdown.inlineCode": ["Ctrl+`"],
  "markdown.link": ["Ctrl+Alt+L"],
  "markdown.heading1": ["Ctrl+1"],
  "markdown.heading2": ["Ctrl+2"],
  "markdown.heading3": ["Ctrl+3"],
  "markdown.heading4": ["Ctrl+4"],
  "markdown.heading5": ["Ctrl+5"],
  "markdown.heading6": ["Ctrl+6"],
  "markdown.paragraph": ["Ctrl+0"],
  "markdown.insertImage": ["Ctrl+Shift+I"],
  "markdown.insertTable": ["Ctrl+Alt+T"],
  "markdown.codeBlock": ["Ctrl+Alt+K"],
  "markdown.mathBlock": ["Ctrl+Shift+M"],
  "markdown.modeWysiwyg": ["Ctrl+Alt+1"],
  "markdown.modeSplit": ["Ctrl+Alt+2"],
  "markdown.modeSource": ["Ctrl+Alt+3"],
};

const MODIFIER_ORDER = ["Ctrl", "Shift", "Alt", "Meta"] as const;
const KEY_ALIASES: Record<string, string> = {
  " ": "Space",
  Esc: "Escape",
  Del: "Delete",
  Left: "ArrowLeft",
  Right: "ArrowRight",
  Up: "ArrowUp",
  Down: "ArrowDown",
  Add: "+",
  Subtract: "-",
};

export function resolveKeymapProfile(profile: KeymapProfile, workMode: "single" | "workspace"): ResolvedKeymapProfile {
  if (profile !== "adaptive") return profile;
  return workMode === "workspace" ? "vscode" : "notepad-plus-plus";
}

export function profileKeymap(profile: KeymapProfile, workMode: "single" | "workspace"): KeybindingMap {
  return resolveKeymapProfile(profile, workMode) === "vscode" ? VSCODE_KEYMAP : NOTEPAD_PLUS_PLUS_KEYMAP;
}

export function commandBindings(
  commandId: string,
  profile: KeymapProfile,
  workMode: "single" | "workspace",
  overrides: KeybindingOverrides,
): string[] {
  if (Object.prototype.hasOwnProperty.call(overrides, commandId)) {
    const override = overrides[commandId];
    return override ? [normalizeBinding(override)] : [];
  }
  return [...(profileKeymap(profile, workMode)[commandId] ?? [])].map(normalizeBinding);
}

export function keyboardEventStroke(event: KeyboardEvent): string | null {
  if (event.isComposing || ["Control", "Shift", "Alt", "Meta"].includes(event.key)) return null;
  let key = KEY_ALIASES[event.key] ?? event.key;
  if (key.length === 1 && /[a-z]/i.test(key)) key = key.toUpperCase();
  const modifiers = [
    event.ctrlKey ? "Ctrl" : "",
    event.shiftKey ? "Shift" : "",
    event.altKey ? "Alt" : "",
    event.metaKey ? "Meta" : "",
  ].filter(Boolean);
  if (key === "+" && event.shiftKey) {
    const shiftIndex = modifiers.indexOf("Shift");
    if (shiftIndex >= 0) modifiers.splice(shiftIndex, 1);
  }
  return [...modifiers, key].join("+");
}

export function normalizeBinding(binding: string): string {
  return binding
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeStroke)
    .join(" ");
}

function normalizeStroke(stroke: string): string {
  const plusKey = stroke === "+" || stroke.endsWith("++");
  const parts = (plusKey ? stroke.slice(0, -1) : stroke)
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  const key = plusKey ? "+" : parts.pop() ?? "";
  const modifiers = new Set(parts.filter((part) => MODIFIER_ORDER.includes(part as typeof MODIFIER_ORDER[number])));
  return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key].filter(Boolean).join("+");
}

export function bindingStartsWith(binding: string, stroke: string): boolean {
  return binding.startsWith(`${stroke} `);
}

export function bindingLabel(binding: string): string {
  return normalizeBinding(binding).replaceAll("Meta", "Win");
}

export function ariaKeyShortcut(binding: string): string {
  const firstStroke = normalizeBinding(binding).split(" ")[0] ?? "";
  return firstStroke
    .replaceAll("Ctrl", "Control")
    .replaceAll("+", "+");
}

export function isKeymapProfile(value: unknown): value is KeymapProfile {
  return value === "vscode" || value === "notepad-plus-plus" || value === "adaptive";
}
