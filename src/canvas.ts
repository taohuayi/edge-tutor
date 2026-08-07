/**
 * 思维导图布局 —— 对标 Zotero paper-reading-flow 的 mindMapLayout
 * 纯函数（无 obsidian API 依赖，可单测）
 *
 * Zotero 形式：面板内纵向树形 SVG
 *  - 纵向主干：column=深度（向下生长），row=分支
 *  - 节点坐标：x = PAD + row*X_STEP, y = PAD + column*Y_STEP
 *  - 连线：贝塞尔曲线（父底 → 子顶）
 *  - 活跃路径高亮（当前线程的祖先链）
 */

export interface MindMapThread {
  id: string;
  title: string;
  parentId?: string | null;
  status?: "active" | "paused";
  /** 节点卡片点击时要打开的笔记路径（Obsidian vault 相对） */
  filePath?: string;
}

export interface MindMapPosition {
  thread: MindMapThread;
  column: number;
  row: number;
}

export interface MindMapLayout {
  nodes: MindMapPosition[];
  edges: { from: string; to: string }[];
  /** 有序线程列表（BFS 序） */
  ordered: MindMapThread[];
}

/** Zotero mindMapLayout 移植：树形布局 + 环检测 + 子节点居中 */
export function mindMapLayout(threads: MindMapThread[]): MindMapLayout {
  const byID = new Map<string, MindMapThread>();
  for (const t of threads) byID.set(t.id, t);

  // 构建 children 表（parentId 无效或缺失 → 归入 null 根）
  const children = new Map<string | null, MindMapThread[]>();
  for (const t of threads) {
    const parent = t.parentId && byID.has(t.parentId) ? t.parentId : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent)!.push(t);
  }

  const positions = new Map<string, MindMapPosition>();
  const edges: { from: string; to: string }[] = [];
  const visiting = new Set<string>();
  const finished = new Set<string>();
  let nextRow = 0;

  function place(thread: MindMapThread, column: number): MindMapPosition | undefined {
    if (!thread || finished.has(thread.id)) return positions.get(thread.id);
    if (visiting.has(thread.id)) {
      // 环：给一个独立位置避免死循环
      const cyclePosition: MindMapPosition = { thread, column, row: nextRow++ };
      positions.set(thread.id, cyclePosition);
      finished.add(thread.id);
      return cyclePosition;
    }
    visiting.add(thread.id);
    const childPositions: MindMapPosition[] = [];
    for (const child of children.get(thread.id) ?? []) {
      if (visiting.has(child.id)) continue;
      edges.push({ from: thread.id, to: child.id });
      const childPosition = place(child, column + 1);
      if (childPosition) childPositions.push(childPosition);
    }
    const row = childPositions.length
      ? childPositions.reduce((sum, p) => sum + p.row, 0) / childPositions.length
      : nextRow++;
    const position: MindMapPosition = { thread, column, row };
    positions.set(thread.id, position);
    visiting.delete(thread.id);
    finished.add(thread.id);
    return position;
  }

  // 从根开始（BFS 序保证稳定性）
  for (const thread of children.get(null) ?? []) {
    place(thread, 0);
  }
  // 兜底：任何未放置的线程
  for (const t of threads) {
    if (!finished.has(t.id)) place(t, 0);
  }

  // ordered：BFS 序（从根开始），再补上兜底放置的孤立/环节点
  const ordered: MindMapThread[] = [];
  const seen = new Set<string>();
  const queue: (MindMapThread | null)[] = [null];
  while (queue.length > 0) {
    const cur = queue.shift();
    const kids = children.get(cur ? cur.id : null) ?? [];
    for (const k of kids) {
      if (!seen.has(k.id)) {
        seen.add(k.id);
        ordered.push(k);
        queue.push(k);
      }
    }
  }
  // 兜底：任何已放置但未被 BFS 访问的（环/孤立）节点
  for (const t of threads) {
    if (!seen.has(t.id) && positions.has(t.id)) {
      seen.add(t.id);
      ordered.push(t);
    }
  }

  return {
    nodes: ordered
      .filter((t) => positions.has(t.id))
      .map((t) => positions.get(t.id)!),
    edges,
    ordered,
  };
}

/** 把布局转成渲染坐标（Zotero 渲染参数） */
export function layoutToCoordinates(
  layout: MindMapLayout,
  opts: { nodeW?: number; nodeH?: number; xStep?: number; yStep?: number; pad?: number } = {},
): {
  positions: Map<string, { x: number; y: number; column: number; row: number }>;
  canvasWidth: number;
  canvasHeight: number;
} {
  const NODE_W = opts.nodeW ?? 150;
  const NODE_H = opts.nodeH ?? 48;
  const X_STEP = opts.xStep ?? 166;
  const Y_STEP = opts.yStep ?? 76;
  const PAD = opts.pad ?? 18;

  let maxColumn = 0;
  let maxRow = 0;
  const positions = new Map<string, { x: number; y: number; column: number; row: number }>();
  for (const p of layout.nodes) {
    maxColumn = Math.max(maxColumn, p.column);
    maxRow = Math.max(maxRow, p.row);
    positions.set(p.thread.id, {
      x: PAD + p.row * X_STEP,
      y: PAD + p.column * Y_STEP,
      column: p.column,
      row: p.row,
    });
  }
  const canvasWidth = Math.max(300, PAD * 2 + maxRow * X_STEP + NODE_W);
  const canvasHeight = Math.max(150, PAD * 2 + maxColumn * Y_STEP + NODE_H);
  return { positions, canvasWidth, canvasHeight };
}

/** 生成 SVG 贝塞尔连线（Zotero 形式） */
export function buildEdgePath(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  nodeW: number,
  nodeH: number,
): string {
  const x1 = fromX + nodeW / 2;
  const y1 = fromY + nodeH;
  const x2 = toX + nodeW / 2;
  const y2 = toY;
  const bend = Math.max(22, (y2 - y1) * 0.48);
  return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
}
