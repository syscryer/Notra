# Notra

Notra 是一个 Rust 原生文本编辑器，目标是做到漂亮、便捷、速度快。

核心方向：

- 外观参考 Catio 的干净产品感和 mxterm 的高密度工具台。
- 搜索替换体验参考 Notepad++，并强化当前文件、打开文档、目录搜索、替换预览。
- 第一版不做插件、宏、FTP，把编辑、文件和搜索替换打磨扎实。

当前已具备：

- 当前文件、打开文档、目录三种搜索范围。
- 普通、扩展、正则三种搜索模式。
- 目录过滤、跳过目录、子目录递归、隐藏文件和最大文件大小控制。
- 主窗口保持 Notepad++ 式干净布局，文件树、工具轨和搜索输入不常驻。
- 查找、替换、文件查找使用浮动工具窗，结果和替换预览按需显示。
- 会话恢复：打开文件、最近文件、工作目录、搜索历史、替换历史、主题和搜索选项。
- 命令行启动可直接打开文件或目录。

## 开发生命周期

本项目用 Trellis 管理开发阶段：

```text
00 产品定义
01 UI 原型
02 架构设计
03 编辑核心
04 搜索替换
05 性能验证
```

## 本地运行

```powershell
cargo run -p notra-app
cargo run -p notra-app -- path\to\file.txt
cargo run -p notra-app -- path\to\workspace
```

## 验证

```powershell
cargo test --workspace
cargo check --workspace
cargo clippy --workspace -- -D warnings
cargo run -p notra-core --example perf_smoke
```
