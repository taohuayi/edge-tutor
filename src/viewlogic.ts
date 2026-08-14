/**
 * view.ts 提取的纯逻辑与 DOM 后处理助手（C5 分层第一步，v0.10.1）
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
