/**
 * view.ts 提取的纯逻辑与 DOM 后处理助手（C5 分层，v0.10.1 起）
 * 分层铁律：本模块零 obsidian 依赖（纯函数 + DOM 操作，回调注入），
 * 可被 esbuild bundle 后由 node 单测覆盖。
 */

/** 引用标记样式：`【📖 文件:行】` 或 `【📖 文件:行-行】` */
export interface CiteRef {
  file: string;
  line: number;
}

/** 新建引用正则（每次独立实例，避免 /g 共享 lastIndex 状态） */
export function citeRefRe(): RegExp {
  return /【📖\s*([^】]+?):(\d+)(?:-(\d+))?】/g;
}

/** 解析单条引用标记文本（取第一个命中；无命中返回 null） */
export function parseCiteRef(text: string): CiteRef | null {
  const re = citeRefRe();
  const m = re.exec(text);
  if (!m) return null;
  const line = parseInt(m[2], 10);
  if (!Number.isFinite(line)) return null;
  return { file: m[1].trim(), line };
}

/** 段落是否可提交：``` 围栏成对且 \( \) \[ \] 各自闭合（P1-4 坑 8 守卫） */
export function paragraphReady(t: string): boolean {
  let fences = 0;
  for (const line of t.split("\n")) {
    if (line.trimStart().startsWith("```")) fences++;
  }
  if (fences % 2 !== 0) return false;
  return (
    (t.split("\\(").length - 1) === (t.split("\\)").length - 1) &&
    (t.split("\\[").length - 1) === (t.split("\\]").length - 1)
  );
}

/**
 * 按 \n\n 切分流式 pending 文本：
 * 可提交的完整段落放 done；第一个未闭合段落（含其后所有内容）整体归入 rest
 * （围栏/公式可能在跨段之后才闭合）。
 */
export function splitCommittableParagraphs(pending: string): { done: string[]; rest: string } {
  const parts = pending.split("\n\n");
  const done: string[] = [];
  let rest = "";
  for (let i = 0; i < parts.length; i++) {
    if (i < parts.length - 1 && paragraphReady(parts[i])) {
      done.push(parts[i]);
    } else {
      rest = parts.slice(i).join("\n\n");
      break;
    }
  }
  return { done, rest };
}

/**
 * 扫描容器内文本节点中的【📖 文件:行】引用标记 → 替换为可点击按钮。
 * onNavigate 由调用方注入（view 层接 navigateToTextAnchor），保持本模块无 obsidian 依赖。
 */
export function attachCitationButtonsDOM(
  container: HTMLElement,
  onNavigate: (ref: CiteRef) => void,
): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const text = node.nodeValue ?? "";
    if (!text.includes("【📖")) continue;
    const re = citeRefRe();
    const frag = document.createDocumentFragment();
    let last = 0;
    let replaced = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const file = m[1].trim();
      const line = parseInt(m[2], 10);
      const btn = document.createElement("button");
      btn.className = "edge-tutor-cite-btn";
      btn.textContent = `📖 ${file}:${line}`;
      btn.addEventListener("click", () => onNavigate({ file, line }));
      frag.appendChild(btn);
      replaced++;
      last = m.index + m[0].length;
    }
    if (replaced > 0) {
      frag.appendChild(document.createTextNode(text.slice(last)));
      node.replaceWith(frag);
    }
  }
}

/**
 * 代码块 hover 复制按钮（P2-5）：在 MarkdownRenderer.render 完成后调用。
 * notify 由调用方注入（Obsidian Notice），保持本模块无 obsidian 依赖。
 */
export function attachCodeCopyButtonsDOM(
  container: HTMLElement,
  notify: (msg: string) => void,
  onError?: (e: unknown) => void,
): void {
  for (const pre of Array.from(container.querySelectorAll("pre"))) {
    if (pre.querySelector(".edge-tutor-code-copy")) continue;
    const code = pre.querySelector("code");
    if (!code) continue;
    pre.classList.add("edge-tutor-code-block");
    const btn = document.createElement("button");
    btn.className = "edge-tutor-code-copy";
    btn.textContent = "📋";
    btn.setAttribute("title", "复制代码");
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(code.textContent ?? "");
        notify("已复制代码");
      } catch (err) {
        onError?.(err);
        notify("复制失败，请手动选择复制");
      }
    });
    pre.appendChild(btn);
  }
}

/* ===== C5 第二步新增（v0.10.2） ===== */

/** 公式格式转换：\(...\) → $...$，\[...\] → $$...$$（Obsidian MathJax 兼容） */
export function normalizeMath(text: string): string {
  let out = text;
  out = out.replace(/\\\[[\s\S]*?\\\]/g, (m) => "$$" + m.slice(2, -2).trim() + "$$");
  out = out.replace(/\\\(([^\\]*?)\\\)/g, (m) => "$" + m.slice(2, -2).trim() + "$");
  out = out.replace(/\\\(/g, "$").replace(/\\\)/g, "$");
  out = out.replace(/\\\[/g, "$$").replace(/\\\]/g, "$$");
  return out;
}

/** 方向指引入口卡片（guide entries）DOM 构建；onStart 由 view 层注入状态变更 */
export interface GuideEntryLike {
  type: string;
  id: string;
  title: string;
  jiang?: string;
  anchorNode?: string;
  question?: string;
  direction?: string;
  whyWorthExploring?: string;
  entryPoint?: string;
  tensions?: string[];
  connections?: string[];
  possibleTrails?: string[];
  anchor?: string;
}

export function buildGuideEntryBox(
  entry: GuideEntryLike,
  opts: { isBusy: () => boolean; onStart: (entry: GuideEntryLike) => void },
): HTMLElement {
  const box = document.createElement("div");
  box.className = "edge-tutor-entry";
  const heading = box.createEl("h5");
  heading.createSpan({
    text: entry.type === "deepen" ? "🔻 深化" : "🆕 新域",
    cls: "edge-tutor-entry-badge" + (entry.type === "deepen" ? " deepen" : ""),
  });
  heading.createSpan({ text: entry.id + " " + entry.title });
  if (entry.jiang) heading.createSpan({ text: " · " + entry.jiang, cls: "edge-tutor-entry-meta" });
  const rows: [string, string][] = [];
  if (entry.type === "deepen" && entry.anchorNode) rows.push(["锚定节点", "[[" + entry.anchorNode + "]]"]);
  if (entry.question) rows.push(["下一堵墙", entry.question]);
  if (entry.direction) rows.push(["延伸方向", entry.direction]);
  if (entry.whyWorthExploring) rows.push(["为什么值得追", entry.whyWorthExploring]);
  if (entry.entryPoint) rows.push(["自然切入口", entry.entryPoint]);
  if ((entry.tensions ?? []).length) rows.push(["关键张力", (entry.tensions ?? []).join("；")]);
  if ((entry.connections ?? []).length) rows.push(["可连接", (entry.connections ?? []).join("；")]);
  if ((entry.possibleTrails ?? []).length) rows.push(["可能尾迹", (entry.possibleTrails ?? []).join("；")]);
  if (entry.anchor) rows.push(["教材锚点", entry.anchor]);
  for (const [k, v] of rows) {
    const line = box.createEl("p", { cls: "edge-tutor-entry-row" });
    line.createEl("strong", { text: k + "：" });
    line.createSpan({ text: v });
  }
  const start = box.createEl("button", { text: "从这里开始探索", cls: "edge-tutor-entry-start" });
  start.addEventListener("click", () => {
    if (opts.isBusy()) return;
    opts.onStart(entry);
  });
  return box;
}

/** 面板内 Obsidian 双链点击拦截：交给回调打开（避免面板内导航把面板内容覆盖成笔记） */
export function attachInternalLinkInterception(container: HTMLElement, onOpen: (path: string) => void): void {
  for (const a of Array.from(container.querySelectorAll("a.internal-link"))) {
    a.addEventListener("click", (e) => {
      const el = a as HTMLAnchorElement;
      const path = el.dataset.href ? decodeURIComponent(el.dataset.href) : (el.textContent ?? "");
      if (!path) return;
      e.preventDefault();
      e.stopPropagation();
      onOpen(path);
    });
  }
}

/** 消息 hover 操作条构建（📋 复制 / ✏️ 编辑 / 🔄 重新生成 / 🗑️ 删除） */
export function buildMsgActBar(
  host: HTMLElement,
  buttons: { label: string; tip: string; handler: () => void | Promise<void>; danger?: boolean }[],
): void {
  const acts = host.createEl("div", { cls: "edge-tutor-msg-acts" });
  for (const btn of buttons) {
    const b = acts.createEl("button", {
      text: btn.label,
      cls: "edge-tutor-msg-act" + (btn.danger ? " danger" : ""),
      attr: { title: btn.tip },
    });
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      void btn.handler();
    });
  }
}

/* ===== C5 第四步新增（v0.10.4） ===== */

/** 工作区树节点（id=可激活的工作区；children=子目录/子工作区） */
export interface WsTreeItem {
  name: string;
  id?: string;
  children: WsTreeItem[];
}

/** 工作区 id 列表（形如 教材名/子工作区名，可任意层级）→ 树（纯函数，可单测） */
export function buildWsTreeData(workspaces: string[]): WsTreeItem[] {
  const root: WsTreeItem = { name: "", children: [] };
  const ensure = (parent: WsTreeItem, name: string): WsTreeItem => {
    let n = parent.children.find((c) => c.name === name);
    if (!n) {
      n = { name, children: [] };
      parent.children.push(n);
    }
    return n;
  };
  for (const ws of workspaces) {
    if (ws === "main") {
      root.children.push({ name: "默认工作区", id: "main", children: [] });
      continue;
    }
    const segs = ws.split("/");
    let cur = root;
    for (let i = 0; i < segs.length; i++) {
      cur = ensure(cur, segs[i]);
      if (i === segs.length - 1) cur.id = ws; // 末段 = 可激活的工作区
    }
  }
  const sort = (list: WsTreeItem[]) => {
    list.sort(
      (a, b) => (a.children.length ? 0 : 1) - (b.children.length ? 0 : 1) || a.name.localeCompare(b.name, "zh")
    );
    for (const n of list) if (n.children.length) sort(n.children);
  };
  sort(root.children);
  return root.children;
}

/** 工作区树节点行渲染（递归）；currentWs/onSelect 由调用方注入 */
export function renderWsTreeNode(
  container: HTMLElement,
  node: WsTreeItem,
  depth: number,
  expandSet: Set<string>,
  opts: { currentWs: () => string; onSelect: (id: string) => void },
): void {
  const isFolder = node.children.length > 0;
  const row = container.createEl("div", { cls: "edge-tutor-ws-tree-row" });
  row.style.paddingLeft = (6 + depth * 14) + "px";
  if (isFolder) {
    row.createSpan({ cls: "edge-tutor-ws-tree-toggle", text: "▸" });
    row.createSpan({ cls: "edge-tutor-ws-tree-name", text: node.name });
    // 文件夹行点击 = 展开/收起；容器工作区本身由 ↙ 按钮激活
    const sub = container.createEl("div", { cls: "edge-tutor-ws-tree-sub" });
    sub.hidden = true;
    const toggleIcon = row.querySelector(".edge-tutor-ws-tree-toggle")!;
    row.onclick = (e) => {
      e.stopPropagation();
      const opening = sub.hidden;
      toggleIcon.setText(opening ? "▾" : "▸");
      sub.hidden = !opening;
    };
    if (node.id) {
      const go = row.createEl("button", { cls: "edge-tutor-ws-tree-go", attr: { title: "打开容器工作区" } });
      go.setText("↗");
      go.onclick = (e) => {
        e.stopPropagation();
        opts.onSelect(node.id!);
      };
    }
    // 当前工作区在祖先链上 → 默认展开
    if (expandSet.has(node.name)) {
      toggleIcon.setText("▾");
      sub.hidden = false;
    }
    for (const c of node.children) renderWsTreeNode(sub, c, depth + 1, expandSet, opts);
  } else {
    row.createSpan({ cls: "edge-tutor-ws-tree-toggle", text: "·" });
    row.createSpan({ cls: "edge-tutor-ws-tree-name", text: node.name });
    row.onclick = () => {
      opts.onSelect(node.id!);
    };
  }
  if (node.id && node.id === opts.currentWs()) row.addClass("is-current");
}

/** 会话搜索结果行渲染（最多 50 条） */
export function renderSearchResultRows(
  el: HTMLElement,
  hits: { role: string; lineId: string | null; excerpt?: string }[],
  cursor: number,
  onNavigate: (index: number) => void,
): void {
  hits.slice(0, 50).forEach((hit, i) => {
    const row = el.createEl("button", {
      cls: "edge-tutor-search-result" + (i === cursor ? " active" : ""),
    });
    row.createEl("span", { text: hit.role, cls: "edge-tutor-search-result-kind" });
    row.createEl("span", {
      text: (hit.lineId ? hit.lineId + " · " : "") + (hit.excerpt || ""),
      cls: "edge-tutor-search-result-text",
    });
    row.addEventListener("click", () => onNavigate(i));
  });
}


