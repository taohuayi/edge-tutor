/**
 * 选中文本浮动按钮（C5 分层第四步：从 view.ts 整体搬出，v0.10.4）
 * 依赖经 SelFloatOpts 注入，行为与搬出前逐字一致。
 */
import { App, MarkdownView } from "obsidian";

export interface SelFloatOpts {
  app: App;
  /** 面板内容容器（isInPanel 判断用） */
  contentEl: HTMLElement;
  /** 输入区行元素（按钮避让用） */
  inputRowEl: HTMLElement | null;
  /** 注册 interval（宿主 Component.registerInterval） */
  registerInterval: (id: number) => void;
  isInPanel: () => boolean;
  resolveAnchor: () => string | null;
  onSelect: (text: string, anchorPath?: string) => void;
}

/** 返回清理函数（移除按钮 + 解绑 selectionchange 监听），宿主 onClose 调用 */
export function initSelectionFloat(opts: SelFloatOpts): () => void {
  const selBtn = document.createElement("button");
  selBtn.textContent = "由此追问";
  selBtn.style.cssText =
    "position:fixed;z-index:2147483647;background:#2563eb;color:#fff;border:none;" +
    "border-radius:8px;padding:4px 12px;font:12px/1.6 -apple-system,'Segoe UI','Microsoft YaHei UI',sans-serif;" +
    "cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.3);display:none;";
  document.body.appendChild(selBtn);

  const updateSelFloat = () => {
    try {
      const sel = document.getSelection();
      if (!sel || !sel.rangeCount) {
        selBtn.style.display = "none";
        return;
      }
      const txt = String(sel).trim();
      if (txt.length < 2) {
        selBtn.style.display = "none";
        return;
      }
      const rc = sel.getRangeAt(0).getBoundingClientRect();
      if (!rc || rc.width < 2 || rc.height < 2) {
        selBtn.style.display = "none";
        return;
      }
      selBtn.setAttribute("data-sel", txt);
      const x = rc.left + rc.width / 2 - 42;
      let y = rc.top - 34;
      if (y < 6) y = rc.bottom + 8;
      // 避让输入框：按钮若与输入区相交（会挡住点击）→ 不显示
      const btnRect = { left: Math.max(4, x), top: Math.max(4, y), width: 84, height: 28 };
      const inputRect = opts.inputRowEl?.getBoundingClientRect();
      if (
        inputRect &&
        btnRect.left < inputRect.right &&
        btnRect.left + btnRect.width > inputRect.left &&
        btnRect.top < inputRect.bottom &&
        btnRect.top + btnRect.height > inputRect.top
      ) {
        selBtn.style.display = "none";
        return;
      }
      selBtn.style.left = btnRect.left + "px";
      selBtn.style.top = btnRect.top + "px";
      selBtn.style.display = "block";
    } catch (e) {
      selBtn.style.display = "none";
    }
  };

  selBtn.addEventListener("click", async () => {
    const txt = selBtn.getAttribute("data-sel") || "";
    if (!txt) return;
    // 面板内选中：锚点取所选回答的引用（【📖 文件:行】/所属线程锚点），
    // 而不是活动 MarkdownView——面板聚焦时它常为 null（引用被静默丢弃）
    // 或指向无关笔记（锚点错位）。
    const anchorPath = opts.isInPanel()
      ? opts.resolveAnchor()
      : opts.app.workspace.getActiveViewOfType(MarkdownView)?.file?.path ?? null;
    document.getSelection()?.removeAllRanges();
    selBtn.style.display = "none";
    opts.onSelect(txt, anchorPath ?? undefined);
  });

  document.addEventListener("selectionchange", updateSelFloat);
  opts.registerInterval(window.setInterval(updateSelFloat, 500));
  return () => {
    document.removeEventListener("selectionchange", updateSelFloat);
    selBtn.remove();
  };
}
