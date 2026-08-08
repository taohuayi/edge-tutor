# edge-tutor UX 优化任务书（opencode 交接简报）

> 本文档是给 opencode 实现用的自包含任务书。你（opencode）没有本项目的任何上下文，请先完整读完本文件再动手。实现语言用 TypeScript，注释/交互文案用中文。

## 1. 项目概览

**edge-tutor（认知边缘导师）** 是 Obsidian 桌面插件（v0.7.0，`isDesktopOnly`）。核心定位：把 AI 当作"价值识别器"——学生自由探索教材，AI 识别珍贵知识并推深。交互模式从 Zotero 插件 Paper Reading Flow 全量移植。

**代码位置（开发副本，改这里）**：`E:\杂七杂八的垃圾堆\LearningOS\.obsidian\plugins\edge-tutor\`
（注意路径含中文；用 VS Code / opencode 打开时用完整绝对路径。Obsidian 可能正在运行——改完 `main.js` 后需用户在 Obsidian 里重启/重载插件才能看到效果，构建产物 `main.js` 必须更新。）

**发布副本（不动，最后手动同步）**：`E:\杂七杂八的垃圾堆\edge-tutor\`（GitHub 私有仓库 `taohuayi/edge-tutor`，源码无 API key）。

## 2. 架构总览

```
src/
├── main.ts       入口：命令注册 + vault 读写（loadConv/saveConv/节点文件）+ 设置页 EdgeTutorSettingTab
├── view.ts       常驻对话面板 UI（TutorView extends ItemView，~2000 行，最大文件）
├── agentview.ts  执行面板 UI（AgentView，agent 模式）
├── conv.ts       会话数据模型（纯函数可单测）：ConvMessage / ConvThread / Conv
├── tutor.ts      CognitiveNode / ParkedQuestion 模型 + extractMentorResponse（纯函数）
├── canvas.ts     思维导图布局纯函数（mindMapLayout/layoutToCoordinates/buildEdgePath，可单测）
├── nodeops.ts    节点树操作纯函数（cloneBranch/attachBranch/renameNode/deleteNode，可单测）
├── export.ts     导出 MD/JSON、导入 JSON（纯函数）
├── guide.ts      方向指引 prompt 组装 + 结果解析
├── ai.ts         Provider 预设 + chat/completions + streamCompletion（SSE 流式）
├── agent.ts      agent 循环 + vault 工具集（DeepSeek function calling，纯循环可单测）
├── opencode.ts   opencode 委托通道（SSE 实时反馈工具步骤）
├── search.ts     会话搜索
└── data.ts       默认设置/工具函数
```

**分层铁律**：
- 纯函数模块（conv/tutor/canvas/nodeops/export/guide）= 无 obsidian 依赖，可 esbuild bundle 后 node 单测
- view.ts / main.ts / agentview.ts = UI + vault API，不写业务逻辑
- 业务逻辑改动优先落在纯函数模块，UI 只做渲染与事件

## 3. 数据模型（改 UI 前必读）

### ConvMessage（会话消息）
```ts
interface ConvMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  lineId?: string;        // 归属线程 id
  anchor?: string;        // 来源锚点（教材位置，如 "[[文件路径]]" 或 "📖 文件:行号"）
  verbatimContent?: string; // 原始 AI 输出（编辑前）
  agent?: boolean;        // 执行模式消息
  ts: number;
}
```

### ConvThread（思维链线程）
```ts
interface ConvThread {
  id: string;             // "q" + sequence
  title: string;
  rootQuestion: string;   // 发起这条链的原始问题
  parentId: string | null;
  anchor: { sourcePath?: string; quote?: string } | null;
  summary: string;
  status: "active" | "paused";
  originExcerpt?: string; // 触发问题的原文摘录
  lastQuestion?: string;
  mastery?: "mastered" | "exploring" | "fresh";
  createdAt: string;
  updatedAt: string;
}
```

### Conv（完整会话，每工作区一个）
```ts
interface Conv {
  workspace: string;
  messages: ConvMessage[];
  reading: {
    mode: "deep" | "quick";
    sequence: number;         // 线程 id 计数器
    activeId: string | null;  // 当前活跃线程
    threads: ConvThread[];
    parkingLot: ParkedQuestion[];  // 问题停车场
  };
}
```

**存储**：每工作区一个 `.conv.json`（vault 内，main=节点目录根，其他=子文件夹）。`main.ts` 的 `loadConv(ws)` / `saveConv(conv)` 负责读写。

**认知节点 = .md 文件**（frontmatter 单一数据源），`tutor.ts` 提供解析/序列化。对话中 AI 的回答会被"沉淀"为认知节点笔记，MOC 自动更新。

## 4. 面板 UI 结构（view.ts TutorView）

自上而下 DOM 顺序（必须保持，Zotero 对齐）：
```
搜索栏（searchEl）
思维导图容器（mapContainer，有节点时自动显示，SVG 层 + 节点卡片层）
消息区（msgContainer，edge-tutor-msg 列表）
输入区（inputRow：textarea 3 行 + 发送/方向指引按钮）
状态栏（statusEl，setStatus(text) 更新）
```

关键方法（改之前先 grep 确认签名）：
- `appendMessageRaw(opts): HTMLElement` — 消息渲染。opts: `{ role, content, anchor?, anchorQuote?, guideEntries?, agent?, messageIndex?, onRegenerate?, onEdit? }`。**只渲染不 push 数组**（见坑 4）
- `replaceMessage(el, msg)` — 替换消息元素
- `setStatus(text)` / `this.sendBtn.setText("思考中…")` — 状态反馈
- `scrollToBottom()` / 60px 阈值智能跟随（用户上滚时暂停跟随）
- `navigateToTextAnchor(sourcePath, quote?, line?)` — 打开文件+滚动定位+临时高亮（点击引用跳转已可用）
- 消息编辑按钮：内容区 `✏️ 编辑` 按钮（`onEdit` 回调，编辑后存 `verbatimContent`）
- 节点 hover 操作组：`.edge-tutor-map-node:hover .edge-tutor-map-acts { display:flex }`（CSS 模式，节点操作组已实现）

## 5. 技术栈与构建

- **vanilla TypeScript，无框架**（不用 React/Vue/Lexical/任何 DOM 框架）
- esbuild bundle：`external: ["obsidian"]`，`format: "cjs"`，`target: "es2018"`，outfile `main.js`
- 构建命令：`npm install --include=dev`（本机 npm 全局 omit=dev，必须显式 include）→ `node esbuild.config.mjs`
- tsconfig `lib` 数组**必须全小写**：`["dom", "es5", "es6", "es7", "es2018", "es2019", "es2020"]`（大写不生效会整片 TS2705）
- 单测：纯函数 esbuild bundle（`platform:"node"`, `write:false`）→ `new Function("module","exports", code)(mod, mod.exports)` → node 直接 require 断言
- Obsidian API 版本 1.4.0+（minAppVersion）
- CSS 类前缀：`edge-tutor-`，样式在 `styles.css`

## 6. 现有体验能力（已实现，不要重复做）

- ✅ 流式输出（`streamCompletion` SSE + onDelta 逐字）
- ✅ 流式中途保存（~3s / ~1.5KB 节流持久化）
- ✅ 重新生成回答（`regenerate`，流式替换原消息）
- ✅ 智能滚动跟随（60px 阈值）
- ✅ "思考中…" 按钮态 + 状态栏
- ✅ 公式转换（`normalizeMath`：`\(...\)`→`$...$`，`\[...\]`→`$$...$$`，先转行间再转行内）
- ✅ 消息编辑（✏️ 按钮 + verbatimContent 保留原始）
- ✅ 节点 hover 操作组（插入问题/改名/复制/粘贴/删除/改摘要）
- ✅ 会话搜索（搜索栏 + Enter 跳转）
- ✅ 锚点定位跳转（`navigateToTextAnchor`，支持行号）
- ✅ 草稿自动保存（800ms 节流 + onClose flush）
- ✅ 双通道手动切换（对话通道 / 执行通道 agent）
- ✅ 思维导图自动显示 + 拖拽平移 + hover 操作

## 7. 本次任务清单

### P0-1 上下文 chips + 回答回显"基于"（最高优先）

**目标**：用户随时知道 AI 看到了什么——透明感是这个插件信任的核心。

**A. 输入区上下文 chips**
- 现状：`view.ts` 有 `pendingAnchor`（收到选中文本时设置），但只在输入框 placeholder 里提示，不可见不可操作
- 实现：输入区（inputRow）上方加一个 chips 容器（`edge-tutor-context-chips`）。当 `pendingAnchor` / 最近 anchor 存在时渲染 chip：`📖 文件名 + 引用前 30 字`，带 × 移除按钮
- 交互：chip 可点击跳转（复用 `navigateToTextAnchor`）；× 移除后该消息不带 anchor 进上下文；新选中文本自动替换/追加 chip
- 涉及：view.ts（chips 渲染 + 事件）、ai.ts（组装 messages 时带上当前 chips 内容作为 system 提示）

**B. 回答气泡回显"基于"**
- 现状：回答消息有 anchor 字段但 UI 不显示
- 实现：assistant 气泡底部（`edge-tutor-msg-ctx` 小字）渲染：`📖 文件:行号`，点击跳转（复用 `navigateToTextAnchor`）。仅当该消息 `anchor` 存在时显示
- 验收：①选中教材文本提问 → chip 出现且可删可点 ②回答底部显示"基于 📖 ..." 可点击跳转 ③删除 chip 后该轮回答不再回显

### P0-2 消息 hover 操作组补全（复制/删除）

**目标**：一键复制 AI 回答（目前只能全选复制，回答不可选中问题已修复但复制麻烦）。

- 现状：消息只有 ✏️ 编辑按钮（`onEdit`）
- 实现：仿节点操作组模式——`.edge-tutor-msg:hover .edge-tutor-msg-acts { display:flex }`，按钮组：`📋 复制`（clipboard 写入 content）、`✏️ 编辑`（已有）、`🗑️ 删除`（删该条消息，需从 conv.messages 移除并 saveConv + 重绘）
- 注意：复制用 `navigator.clipboard.writeText`；删除确认用 Modal（**不要用 window.confirm**，见坑 1）
- 涉及：view.ts（appendMessageRaw 里加 acts 容器）、styles.css
- 验收：hover 任意消息出操作组；复制成功 Notice 提示；删除后消息消失且持久化

### P1-3 输入区 @ 引用笔记（EditorSuggest）

**目标**：输入时 `@` 弹出笔记选择器，选中插入 `[[笔记名]]`，AI 回答时可引用任意 vault 笔记。

- 现状：textarea 无 @ 能力
- 实现：**用 Obsidian 内置 `EditorSuggest` API（零依赖）**——监听 textarea 的 @ 触发，弹出 vault 笔记列表（`app.vault.getMarkdownFiles()` + 名称过滤），选中插入 `[[文件名]]`
- 注意：EditorSuggest 主要针对 CodeMirror 编辑器，textarea 场景需自定义 PopoverSuggest 或仿照实现（参考 Obsidian 官方 sample-plugin 的 EditorSuggest 用法，或社区 `obsidian-templater` 的 @ 实现思路——先做 PopoverSuggest 版本，锚点在 textarea 光标处）
- 发送消息时：把消息文本中的 `[[...]]` 解析为笔记路径，读文件内容拼进上下文（作为 system/context 块：`<context file="xxx">内容前 500 字</context>`）
- 涉及：新文件 `src/suggest.ts` + view.ts（textarea 集成）+ ai.ts（上下文解析）
- 验收：输入 @ 弹出笔记列表；选中插入双链；发送后 AI 能回答出笔记内容相关问题

### P1-4 流式段落增量渲染

**目标**：流式期间内容按段落渐进渲染（当前是流式纯文本 → 完成后才 Markdown 渲染，有跳变）。

- 现状：`view.ts` respond() 流式期间用纯文本节点逐字更新（快但无格式），完成后才 `MarkdownRenderer.render`
- 实现：流式增量累积 buffer，**按段落边界（`\n\n`）切分**——已完整的段落渲染为 Markdown（`MarkdownRenderer.render`），未完成的尾段保持纯文本。节流 200ms 渲染一次
- 关键：`normalizeMath` 公式转换**只对已提交的完整段落做**（半截 `\(` 会误伤，见坑 8）；段落内嵌公式未闭合时整段先保持纯文本
- 涉及：view.ts（respond/streaming 渲染逻辑）
- 验收：流式中能看到标题/列表/代码块渐进渲染；公式在段落完成才转 `$...$`；无跳变卡顿

### P2-5 代码块复制按钮

**目标**：AI 回答里的代码块 hover 出现复制按钮。

- 实现：消息渲染完成后 post-process——`msgEl.querySelectorAll("pre > code")` 遍历，每个 `pre` 加右上角复制按钮（`.edge-tutor-code-copy`），点击复制 `code.textContent`。约 20 行
- 注意：post-process 要在 MarkdownRenderer.render 的 then 回调里做（渲染是异步的）
- 涉及：view.ts（渲染后处理）+ styles.css
- 验收：回答含代码块 → hover 出复制按钮 → 点击剪贴板成功

### P2-6 长会话懒渲染（>100 条启用）

**目标**：消息超过 100 条时不卡。

- 现状：消息全量 DOM
- 实现：`renderAllMessages` 只渲染最近 50 条 + 顶部留"加载更早消息"按钮（点按向前加载 50 条）。消息总数 ≤100 时行为不变
- 注意：`data-msg-index` 已存在（appendMessageRaw 有 messageIndex），可直接用它定位；滚动定位（搜索跳转）时要先确保目标消息已加载
- 涉及：view.ts（renderMessages 分页逻辑）
- 验收：造 120 条消息 → 面板流畅；向上滚动能加载全部；搜索跳转能定位

## 8. 开发铁律与坑位（每条都是血泪教训，违反必踩坑）

1. **window.prompt / window.confirm 被 Obsidian（Electron）拦截**——对话框根本不弹。必须用 `Modal` 子类（PromptModal 模式：input + 确定/取消 + Enter/Esc）。交付前 `grep -c "window.prompt\|window.confirm" src/` 应为 0
2. **遍历渲染时禁止 push 同数组**——`for (const m of this.messages) this.appendMessage(m)` 若 appendMessage 内部 push 会死循环卡死 Obsidian。遍历用快照 `[...this.messages]`；渲染函数**不 push**（数组由调用方显式 push）
3. **`private xxx!: HTMLElement` 字段声明 ≠ 创建**——声明了但 onOpen 里没 `createEl` 赋值，点击时 TypeError。新增字段后逐个核对赋值点
4. **禁止静默 catch**——`catch (e) { /* 静默 */ }` 会让用户"功能看不见"且无法排查。错误要 appendMessage 到面板消息区（用户可见）+ console.error
5. **absolute 子元素容器必须显式宽高**——思维导图/新加的浮动层如果容器没 width/height 会高度塌陷为 0，内容不可见
6. **MarkdownRenderer.render 调用处加 `void` 前缀**——保持调用方同步返回（`void MarkdownRenderer.render(this.app, content, el, src, this)`），否则类型报错或调用方全要改 async
7. **功能必须可见**——新功能要有明确入口（面板按钮/右键菜单/命令），不要只注册命令。用户看不到入口会以为坏了
8. **公式格式**：LLM 输出 `\(...\)`/`\[...\]`，Obsidian MathJax 只认 `$...$`/`$$...$$`。`normalizeMath` 已存在（ai.ts 或纯函数模块），**流式渲染时只对完整段落调用**
9. **纯函数铁律**：conv/canvas/nodeops/tutor 等纯函数模块不改入参（浅拷贝节点 + 深拷贝 anchor），单测断言"原数组未变"
10. **tsconfig lib 全小写**（见第 5 节）；递归函数必须显式返回类型（TS7023）
11. **esbuild 报错带精确列号，比 tsc 好定位**；修完必跑 tsc + esbuild 双重验证
12. **面板内 AI 回答可选中**：CSS `.edge-tutor-msg-content { user-select: text; }`（已存在，别删）
13. **Obsidian 运行中**：改源码后需重建 main.js，用户重启/重载插件生效。**community-plugins.json 改启用列表不可靠**（重启会被回退），别依赖它
14. **git-bash cd 不了含中文的目录**——你如果走 bash 终端操作，用 glob（`/e/*/LearningOS/...`）或直接用工具/IDE 的绝对路径；写文件用完整 Windows 绝对路径
15. **apiKey 清理**：改完如果涉及 data.json/设置，不要把真实 key 写进源码。源码 apiKey 留空字符串

## 9. 验证标准（每项任务完成后必跑）

1. `tsc --noEmit 2>&1 | grep -v "obsidian.d.ts"` → 自己代码 0 错误（obsidian 类型包自身错误忽略）
2. `node esbuild.config.mjs` → 构建成功，main.js 更新
3. 改动涉及纯函数模块 → 跑对应单测（test/ 目录，node 直接跑）
4. `grep -c "window.prompt\|window.confirm" src/` → 0
5. **Obsidian 实机验证**（用户在 Obsidian 里重载插件后操作一遍任务清单的验收项）——你改完必须明确告诉用户：重启 Obsidian 或 Ctrl+P → 重载插件，然后按验收项逐条测
6. 交付时列出：改了哪些文件、每个文件改了什么、验收项怎么测

## 10. 参考资料

- 现役全部实现：`src/`（先读 view.ts 的 appendMessageRaw/respond/regenerate/renderAllMessages，再读 conv.ts 数据模型）
- 观察点：`docs/smoke_test_checklist.md`（发布副本有，含既有功能冒烟清单，改完跑一遍确认没破坏）
- 交互原型（Zotero Paper Reading Flow）：`C:/Users/xu/AppData/Local/Temp/prf-xpi/content/scripts/paper-reading-agent.js`（1MB 打包源码，grep 定位函数）
- 可借鉴实现（GitHub）：
  - `glowingjade/obsidian-smart-composer` — chat-input @mention（MentionNode.ts）、useAutoScroll、useChatStreamManager、core/mcp、core/rag（Lexical 是 React 系，**只参考思路不引依赖**）
  - `brianpetro/obsidian-smart-connections` — 本地 embedding 零配置模式（本期不做，仅了解）
  - Obsidian 官方 `obsidianmd/obsidian-sample-plugin` — EditorSuggest 用法示例

## 11. 本期范围外（明确不做）

- 语义搜索/embedding（smart-connections 模式）
- MCP client 集成
- 免 key OAuth 通道
- 面板动画（CSS 微过渡可以，重动画不做）
- 移动端支持（isDesktopOnly）
