# 02 架构设计

## Workspace

```text
crates/
  notra-core/   文档模型、文件 IO、搜索替换、目录扫描
  notra-app/    eframe/egui 桌面应用和交互
```

## 核心边界

`notra-core` 不依赖 GUI，负责：

- 文档状态。
- 编码识别和保存。
- 查找、替换、替换预览。
- 目录扫描。
- 结果统计。

`notra-app` 负责：

- 现代工具台 UI。
- 多 Tab。
- 文件对话框。
- 命令行启动参数。
- 会话文件、历史记录和工作区过滤。
- 键盘快捷键。
- 结果面板。
- 将用户操作转换成 core 命令。

## 搜索替换数据流

```text
UI 输入 SearchOptions
  -> core::find_all / search_directory
  -> SearchResult 列表
  -> UI 结果面板
  -> 用户确认替换
  -> core::preview_replace
  -> core::apply_replace
  -> 文档或文件写回
```

## 替换安全性

- 当前文件替换先进入文档 undo 栈。
- 目录替换必须先生成预览。
- 文件写回保留原编码和换行符。
- 对无法解码或超过大小上限的文件跳过并记录。

## 后续可替换点

当前 UI 以 eframe/egui 先落地完整工作流。编辑核心和搜索模块已独立，后续可替换为 winit + wgpu + cosmic-text 的自绘编辑区。
