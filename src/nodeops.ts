/**
 * 认知节点树操作 —— 纯函数（无 obsidian API 依赖，可单测）
 * 对标 Zotero PRF 的节点操作：复制分支 / 挂载分支 / 重命名 / 删除
 *
 * 约定：CognitiveNode.title 作为唯一 id，parentTitle 指向父节点的 title。
 * 所有函数不修改入参，返回新的数组/节点（浅拷贝节点对象）。
 */

import type { CognitiveNode } from "./tutor";

/** 生成一个在 existingTitles 中唯一的新标题（基于 base，追加 副本/序号） */
function uniqueTitle(base: string, existingTitles: Set<string>): string {
  let candidate = base + " 副本";
  if (!existingTitles.has(candidate)) return candidate;
  let i = 2;
  while (existingTitles.has(base + " 副本" + i)) i++;
  return base + " 副本" + i;
}

/** 收集 targetId（即 title）及其所有子孙节点 */
function collectSubtree(nodes: CognitiveNode[], targetTitle: string): CognitiveNode[] {
  const byParent = new Map<string, CognitiveNode[]>();
  for (const n of nodes) {
    const p = n.parentTitle ?? "";
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(n);
  }
  const root = nodes.find((n) => n.title === targetTitle);
  if (!root) return [];
  const out: CognitiveNode[] = [];
  const stack: CognitiveNode[] = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    out.push(cur);
    const kids = byParent.get(cur.title);
    if (kids) for (const k of kids) stack.push(k);
  }
  return out;
}

/**
 * 复制某个节点及其所有子孙分支，返回新节点列表。
 * - 每个新节点 title 用原 title 生成新唯一 id（相对整个树 + 已分配的新 id）。
 * - parentTitle 保持分支内的相对关系（子孙指向复制后的新父节点 title）；
 *   被复制分支根节点的 parentTitle 保持指向原父节点（供后续 attachBranch 改写）。
 */
export function cloneBranch(nodes: CognitiveNode[], targetId: string): CognitiveNode[] {
  const subtree = collectSubtree(nodes, targetId);
  if (subtree.length === 0) return [];

  const existing = new Set(nodes.map((n) => n.title));
  const rename = new Map<string, string>(); // oldTitle -> newTitle

  // 先为子树中每个节点分配唯一新 title
  for (const n of subtree) {
    const nt = uniqueTitle(n.title, existing);
    existing.add(nt);
    rename.set(n.title, nt);
  }

  const rootTitle = subtree[0].title; // collectSubtree 保证 [0] 是根
  const cloned: CognitiveNode[] = subtree.map((n) => {
    const newTitle = rename.get(n.title)!;
    let newParent: string | undefined;
    if (n.title === rootTitle) {
      // 根节点：parentTitle 保持指向原父（未挂载状态）
      newParent = n.parentTitle;
    } else {
      // 子孙：指向复制后的新父节点
      newParent = n.parentTitle && rename.has(n.parentTitle)
        ? rename.get(n.parentTitle)
        : n.parentTitle;
    }
    return {
      ...n,
      title: newTitle,
      anchor: { ...n.anchor },
      ...(newParent === undefined ? { parentTitle: undefined } : { parentTitle: newParent }),
    };
  });
  return cloned;
}

/**
 * 把复制出的分支挂到指定父节点下。
 * 分支的根节点（parentTitle 不在分支内部的那个）改写为 parentTitle。
 * 返回原 nodes + 挂载后的 branchNodes 合并列表。
 */
export function attachBranch(
  nodes: CognitiveNode[],
  branchNodes: CognitiveNode[],
  parentTitle: string
): CognitiveNode[] {
  if (branchNodes.length === 0) return nodes.slice();
  const branchTitles = new Set(branchNodes.map((n) => n.title));
  const attached = branchNodes.map((n) => {
    // 分支内部节点：parentTitle 已指向分支内某节点 -> 保持
    if (n.parentTitle && branchTitles.has(n.parentTitle)) return { ...n, anchor: { ...n.anchor } };
    // 分支根节点：改写父指向为目标 parentTitle
    return { ...n, parentTitle, anchor: { ...n.anchor } };
  });
  return [...nodes, ...attached];
}

/**
 * 重命名节点并更新其所有子孙的 parentTitle 引用。
 * 直接子节点的 parentTitle 从 oldTitle 改为 newTitle（深层子孙无需改，因为它们指向的是中间层 title）。
 */
export function renameNode(
  nodes: CognitiveNode[],
  oldTitle: string,
  newTitle: string
): CognitiveNode[] {
  if (oldTitle === newTitle) return nodes.slice();
  return nodes.map((n) => {
    if (n.title === oldTitle) {
      return { ...n, title: newTitle, anchor: { ...n.anchor } };
    }
    if (n.parentTitle === oldTitle) {
      return { ...n, parentTitle: newTitle, anchor: { ...n.anchor } };
    }
    return n;
  });
}

/**
 * 删除节点及其子孙，返回删除后的列表。
 */
export function deleteNode(nodes: CognitiveNode[], targetId: string): CognitiveNode[] {
  const subtree = collectSubtree(nodes, targetId);
  if (subtree.length === 0) return nodes.slice();
  const toRemove = new Set(subtree.map((n) => n.title));
  return nodes.filter((n) => !toRemove.has(n.title));
}
