# Edge Tutor 重写计划（2026-08-06）

> 目标：把 Zotero PRF 移植插件从「状态分裂导致一堆 bug」重构为「单一数据源」。
> 决策已由用户确认：**全新重写插件（按诊断稿四层架构）**，非打补丁。
> **二次决策（交互对齐）**：全面对齐 Zotero paper-reading-flow 交互，架构转向**内存会话为主，节点 md 为镜像**。

---

## 1. 旧版根因（已修掉）

旧版同时维护**两套消息 + 两棵树**，状态分裂在三处存储里：

| 分裂点 | 存储 A | 存储 B | 后果 |
|:-------|:-------|:-------|:-----|
| 消息 | `conv.messages[]`（落盘 .conv.json） | `this.messages[]`（面板内存） | 重启后面板不回显历史；清屏/切区只清内存不清盘，触发回答后旧消息复活 |
| 树 | `.conv.json` 里的 `reading.threads[]` | 导出成 `.md` 文件的节点 | 同一棵树两种表示，永远不同步 |
| 工作区 | `view.currentWorkspace` | `settings.draft.workspace` | `.conv.json` | 导出永远用默认工作区 |

另外：`package.json` / `manifest.json` 的 UTF-8 中文被按 Latin-1 写回 → 描述乱码。

---

## 2. 新架构：四层映射 + 会话为主

```
L1 交互界面   →  view.ts（面板，对齐 Zotero 交互）+ main.ts（入口/命令/设置）
L2 追根陪练   →  guide.ts（方向指引）+ ai.ts（LLM 调用）
L3 入口生成   →  guide.ts（基于全书推荐）
L4 认知地图   →  conv.ts（会话模型）+ data.ts（节点导出）
```

**核心（用户确认）：内存会话为主，节点 md 为镜像。**

- `.conv.json` 存**完整会话**：`messages[]`（带 `lineId` 归属线程）+ `reading.threads[]` + `parkingLot[]` = 运行态真源
- 节点 `.md` = **沉淀镜像**：`saveConversation` 时从会话同步导出，供 Obsidian 阅读/检索
- 导图/消息/拖拽/视图全部从会话渲染（对齐 Zotero，线程是内存对象）

### 交互对齐 Zotero（新实现）

| Zotero 原版交互 | 实现状态 |
|:--|:--|
| 当前思维链区（面包屑 + 当前问题 + 由原文引出 + 上次停在哪 + 📍锚点 + 分叉/搁置） | ✅ |
| 视图模式（当前路径 / 全部 / 单节点） | ✅ |
| 消息按线程归属 + 线程分隔按钮（点击跳转） | ✅ |
| 消息内联编辑（textarea + 保存/取消 + verbatimContent） | ✅ |
| 导图节点拖拽重组（拖到节点=变子，拖空白=回主干） | ✅ |
| 导图活跃路径高亮 + 自动滚动定位 | ✅ |
| 节点操作 ➕✏️📋📌📝🗑️（含改摘要） | ✅ |
| 状态栏操作反馈 | ✅ |
| 停车场「提问」取出 | ✅ |
| 会话搜索（Enter 逐条跳转 + 命中高亮 + 计数） | ✅ |
| 导图平移/滚动（拖空白平移 + wheel 横向滚动） | ✅ |
| 复制分支带消息 + 粘贴为根 | ✅ |
| 面板工具栏导出 MD/JSON 按钮 | ✅ |
| 锚点定位（Obsidian markdown 文本锚点适配） | ✅ |
| 分支语境注入 AI（祖先链 + 原文引出 + checkpoint + 继续/新开指令） | ✅ |
| 树形大纲导出（线程树缩进 + 每条消息 + 未归属消息 + 停车场） | ✅ |
| 草稿带分支上下文（branchNext/branchOrigin，重启后还原分叉意图） | ✅ |
| 回答收尾 finishAnswer（理解沉淀 + 最近追问 lastQuestion） | ✅ |
| 流式回答（SSE 逐字渲染 + 底部自动跟随） | ✅ |

> **平台适配（关键）**：Zotero 的「PDF 页内框选定位」（pickPdfArea）在 Obsidian 没有等价物 —— Obsidian 处理的是 markdown 文档。已适配为 **markdown 文本锚点**：
> - 选中文本 → 存 `{文件路径, 引用文本 quote}`（线程 anchor）
> - 点击「📍 教材锚点」或消息中的 `📖 路径` → 打开文件 + 在文档中搜索引用文本 + 滚动定位 + 临时选中高亮
> - 消息锚点归属线程 → 跳回触发该问题的原文位置

---

## 3. 安全性

- API key：优先环境变量 `EDGE_TUTOR_API_KEY`，`data.json` 兜底；`.obsidian/` 已 gitignore。

---

## 4. 验收（Type-A Gate）

- [x] `npm run build` 无报错
- [x] `npx tsc --noEmit` src 0 错误（obsidian.d.ts 兼容报错除外）
- [ ] Obsidian 手动冒烟（见 smoke_test_checklist.md）

---

## 5. 数据格式演进

- v1/v2：`reading.threads` 存在，树在两处
- v3：消息+parkingLot 顶层，无线程（过渡）
- v4（当前）：messages 带 lineId + reading.threads + parkingLot，会话完整
- `parseConv` 向后兼容 v1-v4；旧文件自动升级

