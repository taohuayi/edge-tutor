/**
 * 工作区系统 —— 对标 Zotero PRF 的多工作区
 *
 * Zotero 实现：每个工作区 = 一个独立 JSON 会话文件（<key>.<workspace>.json）
 * Obsidian 移植：每个工作区 = 认知节点目录下的一个子文件夹
 *   - 默认工作区 main = 节点目录根
 *   - 其他工作区 = <节点目录>/<工作区名>/
 *
 * 纯函数（无 obsidian API 依赖，可单测）
 */

/** 工作区信息 */
export interface WorkspaceInfo {
  name: string;
  /** 该工作区在 vault 中的相对路径 */
  path: string;
  /** 是否默认工作区 */
  isDefault: boolean;
}

/** 生成工作区名（Zotero 规则：字母数字下划线，去非法字符） */
export function sanitizeWorkspaceName(name: string): string {
  return name
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

/** 工作区列表 */
export function listWorkspaces(
  defaultPath: string,
  existingFolders: string[],
): WorkspaceInfo[] {
  const result: WorkspaceInfo[] = [
    { name: "main", path: defaultPath, isDefault: true },
  ];
  for (const folder of existingFolders) {
    const rel = folder.replace(/^\/+|\/+$/g, "");
    if (!rel || rel === defaultPath.replace(/^\/+|\/+$/g, "")) continue;
    // 只取节点目录直接子文件夹（一层）
    if (rel.startsWith(defaultPath.replace(/^\/+|\/+$/g, "") + "/")) {
      const sub = rel.slice(defaultPath.replace(/^\/+|\/+$/g, "").length + 1);
      if (sub && !sub.includes("/")) {
        result.push({ name: sub, path: rel, isDefault: false });
      }
    }
  }
  return result;
}

/** 节点归属工作区（从路径推断） */
export function workspaceOfPath(nodePath: string, defaultPath: string): string {
  const rel = nodePath.replace(/^\/+|\/+$/g, "");
  const base = defaultPath.replace(/^\/+|\/+$/g, "");
  if (rel === base || rel.startsWith(base + "/")) {
    const sub = rel.slice(base.length + 1);
    if (sub.includes("/")) {
      return sub.split("/")[0];
    }
  }
  return "main";
}

/** 节点文件路径 → 工作区 + 文件名 */
export function splitNodePath(
  nodePath: string,
  defaultPath: string,
): { workspace: string; filename: string } {
  const rel = nodePath.replace(/^\/+|\/+$/g, "");
  const base = defaultPath.replace(/^\/+|\/+$/g, "");
  if (rel === base) return { workspace: "main", filename: "" };
  if (rel.startsWith(base + "/")) {
    const rest = rel.slice(base.length + 1);
    if (rest.includes("/")) {
      const [ws, ...restParts] = rest.split("/");
      return { workspace: ws, filename: restParts.join("/") };
    }
    return { workspace: "main", filename: rest };
  }
  return { workspace: "main", filename: rel };
}
