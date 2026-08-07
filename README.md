# edge-tutor — 认知边缘导师（Obsidian 插件）

右侧常驻对话面板 + 选中即问 + 思维导图 + 多工作区。让 AI 做「价值识别器」：学生自由探索，导师识别珍贵知识并推深，绝不拉回。

## 功能

- **常驻对话面板**（ItemView，右侧）：与教材对话，连续追问，回答归属线程
- **选中即问**：任意文档选中文字 ≥2 字符 → 浮动「由此追问」按钮 / 右键菜单
- **思维导图**：认知节点纵向树（SVG），hover 节点操作（插入问题/改名/复制/粘贴/删除/改摘要），拖拽平移
- **多工作区**：每个工作区独立会话 + 节点树 + 停车场
- **问题停车场**：暂存待处理问题（later/branch 分类）
- **方向指引**：基于教材范围 + 掌握深度给出探索建议
- **沉淀认知节点**：对话 → 认知节点 .md（frontmatter 单一数据源）→ MOC 自动更新
- **导出/导入**：Markdown / JSON 备份
- **Agent 执行模式**（v0.6）：输入指令让 AI 直接操作 vault——读笔记、沉淀节点、更新 MOC、查双链、搜索（DeepSeek 官方通道 + function calling）

## 双通道架构

| 模式 | 通道 | 用途 |
|:----|:-----|:-----|
| 对话 | chat2api 反代 / Tokeness / DeepSeek 等（OpenAI 兼容） | 我问它答，纯文本 |
| 执行 | DeepSeek 官方 API（function calling） | 输入指令 → agent 调 vault 工具执行 |

用户手动切换模式（不做自动路由）。Agent 工具全部限制在 vault 内（读笔记/写节点/查双链/搜索），无 shell、无网络——安全边界明确。

## 安装

1. 下载本仓库，将 `edge-tutor/` 放入 vault 的 `.obsidian/plugins/`
2. 重启 Obsidian，在 设置 → 第三方插件 启用
3. 左侧边栏点指南针图标 / 选中文本 →「由此追问」

## 配置

设置页选择 Provider（DeepSeek / Tokeness / chat2api 反代等），切换自动填充地址与模型。API Key 存本地 `data.json`（已 gitignore，不会提交）。

> 源码不含任何 API Key。密钥只在你的本地 `data.json`。

## 开发

```bash
npm install --include=dev   # 本机 npm 全局 omit=dev，需显式 include
node esbuild.config.mjs    # 构建 main.js
tsc --noEmit               # 类型检查（obsidian.d.ts 自身错误可忽略）
```

## 架构

- `src/ai.ts` — provider 预设 + chat/completions（对话通道）
- `src/agent.ts` — agent 循环 + vault 工具集（执行通道，function calling）
- `src/conv.ts` — 会话数据模型（threads/messages/parkingLot，对齐 Zotero PRF）
- `src/view.ts` — 常驻面板 UI（ItemView）
- `src/canvas.ts` — 思维导图布局纯函数（可单测）
- `src/nodeops.ts` — 节点树操作纯函数（复制/挂载/改名/删除）
- `src/workspace.ts` / `src/export.ts` / `src/tutor.ts` / `src/guide.ts` — 工作区/导出/节点模型/方向指引

纯函数模块（canvas/conv/nodeops）可 esbuild bundle 后 node 直接单测。

## 参考

Zotero Paper Reading Flow 交互模式全量移植（面板布局、updateSelFloat 浮动按钮、mindMapLayout、hover 操作组均对齐原版）。
