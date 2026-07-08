# Trellis 生命周期

本项目用 Trellis 管理开发生命周期。所有阶段都先形成明确产物，再进入实现。

## 阶段

| 阶段 | 目标 | 主要产物 |
| --- | --- | --- |
| 00-product | 产品定义 | 产品原则、功能边界、v0.1 范围 |
| 01-ui-prototype | UI 原型 | 工作台布局、搜索替换面板、设计 tokens |
| 02-architecture | 架构设计 | Rust workspace、模块边界、核心数据流 |
| 03-editor-core | 编辑核心 | 文本缓冲、光标、选择、撤销重做、大文件策略 |
| 04-search-replace | 搜索替换 | 当前文件、打开文档、目录搜索、批量替换预览 |
| 05-performance | 性能验证 | 启动、打开、搜索、替换、滚动性能目标 |

## 使用方式

```powershell
trellis-ctl -json workflow list
trellis-ctl -json workflow run 00-product
trellis-ctl -json workflow run check
```

如果 `trellis-ctl` 不在 PATH 中，先使用 Trellis 项目里的本地二进制或把它加入 PATH。

## 阶段规则

- 每个阶段都要能说明目标、完成标准和验证方式。
- 不自动提交 git。
- 搜索替换、性能和 UI 体验优先于扩展功能。
- 参考 Notepad++ 或 notepad-- 只提炼行为，不复制代码。
