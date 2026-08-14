/**
 * 思维导图渲染（C5 分层第三步：从 view.ts 整体搬出，v0.10.3）
 * - initMapPanDOM：画布平移/滚动（拖空白 + wheel 横向滚动）
 * - renderMindMap：Zotero renderWorkflow（SVG 连线 + 节点卡片 + 操作按钮 + 拖拽重组）
 * - attachDrag：节点拖拽（拖到节点=变子，拖空白=回主干）
 * 宿主依赖经 MapRenderHost 接口注入（view.ts 提供适配器），本模块行为与搬出前逐字一致。
 */
import { App, Notice } from "obsidian";
import { PromptModal, ConfirmModal } from "./modals";
import { MindMapThread, mindMapLayout, layoutToCoordinates, buildEdgePath } from "./canvas";
import {
  Conv, ConvThread, ConvMessage,
  addThread, collectSubtree, reparentThread, switchThread, ancestry, pushMessage,
} from "./conv";
import type { TutorPlugin } from "./view";

export interface BranchClipboard {
  threads: ConvThread[];
  ws: string;
  messages: ConvMessage[];
}

/** 渲染宿主依赖（view.ts 的 mapHost() 适配器实现） */
export interface MapRenderHost {
  app: App;
  plugin: TutorPlugin;
  isBusy: () => boolean;
  rerender: () => void;
  reloadConv: () => Promise<void>;
  clearBranchIntent: () => void;
  setStatus: (text: string) => void;
  inputEl: HTMLTextAreaElement;
  getWorkspace: () => string;
  getBranchClipboard: () => BranchClipboard;
  setBranchClipboard: (c: BranchClipboard) => void;
  getLastMapId: () => string | null;
  setLastMapId: (id: string | null) => void;
  mapContainer: HTMLElement;
  mapTitle: HTMLElement;
  scrollToBottom: () => void;
}

/** 导图平移/滚动（Zotero：拖空白平移 + wheel 横向滚动） */
export function initMapPanDOM(map: HTMLElement): void {
  map.addEventListener("wheel", (event) => {
    const delta = event.deltaX || (event.shiftKey ? event.deltaY : 0);
    if (!delta) return;
    if (map.scrollWidth <= map.clientWidth) return;
    event.preventDefault();
    map.scrollLeft += delta;
  }, { passive: false });

  let dragging = false;
  let startX = 0, startY = 0, startLeft = 0, startTop = 0;
  map.addEventListener("mousedown", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("button")) return;
    if (target.closest(".edge-tutor-map-node")) return;
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    startLeft = map.scrollLeft;
    startTop = map.scrollTop;
    map.classList.add("dragging");
    event.preventDefault();
  });
  map.addEventListener("mousemove", (event) => {
    if (!dragging) return;
    map.scrollLeft = startLeft - (event.clientX - startX);
    map.scrollTop = startTop - (event.clientY - startY);
  });
  const stop = () => {
    if (!dragging) return;
    dragging = false;
    map.classList.remove("dragging");
  };
  map.addEventListener("mouseup", stop);
  map.addEventListener("mouseleave", stop);
}

/** 拖拽落点检测 */
function dropTargetAt(canvas: HTMLElement, clientX: number, clientY: number): HTMLElement | null {
  const els = Array.from(canvas.querySelectorAll(".edge-tutor-map-node"));
  for (const n of els) {
    const node = n as HTMLElement;
    if (node.classList.contains("dragging")) continue;
    const r = node.getBoundingClientRect();
    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
      return node;
    }
  }
  return null;
}

/** 拖拽重组（Zotero pointerdown 移植） */
function attachDrag(
  host: MapRenderHost,
  conv: Conv,
  node: HTMLElement,
  thread: ConvThread,
  origX: number,
  origY: number,
  canvas: HTMLElement,
): void {
  let drag: { startX: number; startY: number; origLeft: number; origTop: number; moved: boolean } | null = null;
  let suppressClick = false;

  node.addEventListener("pointerdown", (e) => {
    if (host.isBusy()) return;
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".edge-tutor-map-act")) return;
    drag = {
      startX: e.clientX,
      startY: e.clientY,
      origLeft: origX,
      origTop: origY,
      moved: false,
    };

    const onMove = (ev: PointerEvent) => {
      if (!drag) return;
      const dx = ev.clientX - drag.startX;
      const dy = ev.clientY - drag.startY;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 5) {
        drag.moved = true;
        node.classList.add("dragging");
      }
      if (!drag.moved) return;
      node.style.left = drag.origLeft + dx + "px";
      node.style.top = drag.origTop + dy + "px";
      canvas.querySelectorAll(".edge-tutor-map-node.drop-target").forEach((n) => n.classList.remove("drop-target"));
      const target = dropTargetAt(canvas, ev.clientX, ev.clientY);
      if (target && target.getAttribute("data-thread-id") !== thread.id) {
        target.classList.add("drop-target");
      }
    };
    const onUp = (ev: PointerEvent) => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      if (drag?.moved) suppressClick = true;
      const target = dropTargetAt(canvas, ev.clientX, ev.clientY);
      const targetId = target ? target.getAttribute("data-thread-id") : null;
      if (targetId && targetId !== thread.id) {
        if (reparentThread(conv, thread.id, targetId)) {
          void host.plugin.saveConv(conv);
          host.rerender();
        }
      } else if (!targetId && thread.parentId) {
        if (reparentThread(conv, thread.id, null)) {
          void host.plugin.saveConv(conv);
          host.rerender();
        }
      }
      drag = null;
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });

  node.addEventListener("click", (e) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    void e;
  });
}

/** ===== 思维导图（Zotero renderWorkflow） ===== */
export async function renderMindMap(host: MapRenderHost, conv: Conv): Promise<void> {
  const state = conv.reading;
  if (!conv || state.threads.length === 0) {
    host.mapContainer.style.display = "none";
    host.mapTitle.style.display = "none";
    return;
  }

  const threads: MindMapThread[] = state.threads.map((t) => ({
    id: t.id,
    title: t.title || t.rootQuestion,
    parentId: t.parentId,
    status: t.status,
  }));
  const layout = mindMapLayout(threads);
  const { positions, canvasWidth, canvasHeight } = layoutToCoordinates(layout);

  host.mapContainer.style.display = "block";
  host.mapContainer.empty();
  host.mapTitle.style.display = "block";
  host.mapTitle.textContent = `🧭 思维导图 · 纵向主干与分支（${state.threads.length} 个节点）`;

  const NODE_W = 150;
  const NODE_H = 48;
  const ns = "http://www.w3.org/2000/svg";

  // 画布层：全部用原生 DOM 创建，消除对 Obsidian 增强 API / max-content 的依赖
  const canvas = document.createElement("div");
  canvas.className = "edge-tutor-map-canvas";
  canvas.style.position = "relative";
  canvas.style.width = canvasWidth + "px";
  canvas.style.height = canvasHeight + "px";
  host.mapContainer.appendChild(canvas);

  const activePath = new Set(ancestry(conv, state.activeId).map((t) => t.id));

  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", String(canvasWidth));
  svg.setAttribute("height", String(canvasHeight));
  svg.setAttribute("viewBox", `0 0 ${canvasWidth} ${canvasHeight}`);
  svg.setAttribute("class", "edge-tutor-map-links");
  for (const edge of layout.edges) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) continue;
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", buildEdgePath(from.x, from.y, to.x, to.y, NODE_W, NODE_H));
    const active = activePath.has(edge.from) && activePath.has(edge.to);
    path.setAttribute("class", "edge-tutor-map-link" + (active ? " active" : ""));
    svg.appendChild(path);
  }
  canvas.appendChild(svg);

  for (const p of layout.nodes) {
    const point = positions.get(p.thread.id);
    if (!point) continue;
    const t = state.threads.find((x) => x.id === p.thread.id);
    if (!t) continue;
    const childrenCount = layout.edges.filter((e) => e.from === t.id).length;
    const cls = [
      "edge-tutor-map-node",
      p.column === 0 ? "root" : "",
      childrenCount > 1 ? "branch" : "",
      t.id === state.activeId ? "active" : "",
      t.status === "paused" ? "paused" : "",
      t.title && t.title !== t.rootQuestion ? "renamed" : "",
      t.mastery === "mastered" ? "mastered" : "",
    ].filter(Boolean).join(" ");
    const node = document.createElement("div");
    node.className = cls;
    node.setAttribute("data-thread-id", t.id);
    node.style.position = "absolute";
    node.style.left = point.x + "px";
    node.style.top = point.y + "px";
    node.style.width = NODE_W + "px";
    node.style.height = NODE_H + "px";
    node.setAttribute("aria-level", String(p.column + 1));
    node.setAttribute(
      "title",
      `原始问题：${t.rootQuestion || t.title || "—"}` +
        (t.anchor?.quote ? `\n锚定：${t.anchor.quote.slice(0, 60)}` : "") +
        (t.summary ? `\n\n摘要：${t.summary.slice(0, 100)}` : "") +
        "\n\n拖拽可调整层级：拖到另一节点上=变为其子节点，拖到空白=回到主干。"
    );
    const label = document.createElement("span");
    label.className = "edge-tutor-map-node-title";
    label.textContent = t.title || t.rootQuestion;
    node.appendChild(label);
    canvas.appendChild(node);

    // 操作按钮（Zotero act()）
    const actions = document.createElement("div");
    actions.className = "edge-tutor-map-acts";
    node.appendChild(actions);
    const act = (labelText: string, tip: string, handler: () => void | Promise<void>, danger = false) => {
      const b = document.createElement("button");
      b.textContent = labelText;
      b.className = "edge-tutor-map-act" + (danger ? " danger" : "");
      b.setAttribute("title", tip);
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        if (host.isBusy()) return;
        void handler();
      });
      actions.appendChild(b);
    };
    act("➕", "在此节点下插入一个新问题节点", async () => {
      const q = await new PromptModal(host.app, `新问题节点（挂在「${t.title || t.rootQuestion}」之下）`).openPrompt();
      if (q == null) return;
      addThread(conv, { question: q, parentId: t.id, anchor: host.plugin.getAnchor() });
      await host.plugin.saveConv(conv);
      host.rerender();
      host.inputEl.placeholder = "向这个新问题提问…";
      host.inputEl.focus();
    });
    act("✏️", "改写标题（原始问题仍保留）", async () => {
      const v = await new PromptModal(host.app, "改写节点标题（原始问题不变）", "", t.title || t.rootQuestion).openPrompt();
      if (v == null || v === t.title) return;
      t.title = v;
      t.updatedAt = new Date().toISOString();
      await host.plugin.saveConv(conv);
      host.rerender();
    });
    act("🔒", t.mastery === "mastered" ? "已封顶，点击取消" : "此链封顶（导引暂不深化此链，可随时取消）", async () => {
      t.mastery = t.mastery === "mastered" ? "exploring" : "mastered";
      t.updatedAt = new Date().toISOString();
      await host.plugin.saveConv(conv);
      // 持久化到节点 frontmatter（重建会话时恢复封顶状态）
      await host.plugin.setNodeLocked(host.getWorkspace(), t.title, t.mastery === "mastered");
      host.rerender();
      host.setStatus(t.mastery === "mastered" ? `「${t.title}」已封顶（导引将聚焦其他链）` : `「${t.title}」已解除封顶`);
    });
    act("📋", "复制此节点及其全部分支", () => {
      const subtree = collectSubtree(conv, t.id);
      const ids = new Set(subtree.map((s) => s.id));
      host.setBranchClipboard({
        threads: subtree,
        ws: host.getWorkspace(),
        messages: conv.messages.filter((m) => m.lineId && ids.has(m.lineId)),
      });
      const clip = host.getBranchClipboard();
      host.setStatus(`已复制 ${subtree.length} 个节点（含 ${clip.messages.length} 条消息），在任何节点上点「粘贴」可挂入`);
    });
    act("📌", "将剪贴板节点粘贴为此节点的子节点", async () => {
      const clip = host.getBranchClipboard();
      if (clip.threads.length === 0) {
        host.setStatus("剪贴板为空：先在某个节点上点「复制」。");
        return;
      }
      const idMap = new Map<string, string>();
      for (const src of clip.threads) {
        const newId = "q" + (++conv.reading.sequence);
        idMap.set(src.id, newId);
        const isRootOfBranch = src.parentId === clip.threads[0].id;
        const newParent = isRootOfBranch ? t.id : idMap.get(src.parentId ?? "") ?? src.parentId;
        conv.reading.threads.push({
          ...src,
          id: newId,
          parentId: newParent,
          nodeFile: undefined, // 剥离源工作区 nodeFile（粘贴后是新线程，不指向源文件）
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      // 粘贴消息（复制分支带消息）
      if (clip.messages.length > 0) {
        for (const srcMsg of clip.messages) {
          const newLine = srcMsg.lineId ? idMap.get(srcMsg.lineId) ?? srcMsg.lineId : undefined;
          pushMessage(conv, srcMsg.role, srcMsg.content, { anchor: srcMsg.anchor, lineId: newLine });
        }
      }
      await host.plugin.saveConv(conv);
      host.rerender();
      host.setStatus(`已粘贴 ${clip.threads.length} 个节点到「${t.title}」之下`);
      // 跨工作区移动：提示删除源工作区的节点
      const srcWs = clip.ws;
      const srcIds = clip.threads.map((s) => s.id);
      if (srcWs && srcWs !== host.getWorkspace() && srcIds.length > 0) {
        const srcTitles = clip.threads.map((s) => s.title || s.rootQuestion).slice(0, 3).join("、");
        const modal = new ConfirmModal(host.app, "删除源工作区的节点？", [
          `已把分支粘贴到「${host.getWorkspace()}」。`,
          `是否同时删除「${srcWs}」中的 ${srcIds.length} 个源节点（${srcTitles}${clip.threads.length > 3 ? "…" : ""}）？`,
          "删除会连带移除消息和节点文件（进回收站）。",
        ].join("\n"));
        modal.onConfirm = async () => {
          const n = await host.plugin.deleteThreadsWithFiles(srcWs, srcIds);
          new Notice(`已从「${srcWs}」删除 ${n} 个源节点`);
        };
        modal.open();
      }
    });
    act("📝", "改写摘要（理解沉淀）", async () => {
      const v = await new PromptModal(host.app, "改写摘要（理解沉淀）", "", t.summary || "").openPrompt();
      if (v == null) return;
      t.summary = v;
      t.updatedAt = new Date().toISOString();
      await host.plugin.saveConv(conv);
      host.rerender();
    });
    act("🗑️", "删除此节点及其全部分支（含消息与节点文件，进回收站）", async () => {
      const subtree = collectSubtree(conv, t.id);
      const ids = subtree.map((s) => s.id);
      const modal = new ConfirmModal(
        host.app,
        "删除节点？",
        `删除「${t.title || t.rootQuestion}」及其 ${ids.length - 1} 个子分支？\n将同步删除消息与节点文件（进回收站可找回）。`,
        "确认删除"
      );
      modal.onConfirm = async () => {
        // 三处同步删除：线程 + 消息 + 节点文件（内部已保存 conv）
        await host.plugin.deleteThreadsWithFiles(host.getWorkspace(), ids);
        await host.reloadConv();
        host.rerender();
        host.setStatus(`已删除 ${ids.length} 个节点（含消息与文件）`);
      };
      modal.open();
    });

    // 拖拽重组（Zotero：拖到节点=变子，拖空白=回主干）
    attachDrag(host, conv, node, t, point.x, point.y, canvas);

    // 点击 → 切换活跃线程
    node.addEventListener("click", (e) => {
      if (host.isBusy()) return;
      if ((e.target as HTMLElement).closest(".edge-tutor-map-act")) return;
      if (t.id === state.activeId) return;
      switchThread(conv, t.id);
      host.clearBranchIntent();
      void host.plugin.saveConv(conv);
      host.rerender();
      host.inputEl.placeholder = "继续这条思路…";
      host.inputEl.focus();
    });
  }

  // 自动定位活跃节点（Zotero mapLocate）
  const activePoint = positions.get(state.activeId ?? "");
  const mapLocate = !host.getLastMapId() || host.getLastMapId() !== state.activeId;
  if (activePoint && mapLocate) {
    host.mapContainer.scrollLeft = Math.max(0, activePoint.x - Math.max(0, (host.mapContainer.clientWidth - NODE_W) / 2));
    host.mapContainer.scrollTop = Math.max(0, activePoint.y - 54);
  }
  host.setLastMapId(state.activeId);
  host.scrollToBottom();
}
