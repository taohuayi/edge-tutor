/**
 * Agent 执行模式：插件内嵌 agent（OpenAI 兼容通道，支持 function calling）
 *
 * 架构（用户确认 2026-08-07）：
 *   - 对话模式 → chat2api 反代（免费号，纯文本）——见 ai.ts
 *   - 执行模式 → 本模块：DeepSeek 官方 API + tool_calls → vault 工具执行
 *   - 用户手动切换模式（不做自动路由）
 *
 * 工具边界：全部在 vault 内（安全），无 shell/网络。
 */

import { Notice, TFile, TFolder } from "obsidian";
import type { App } from "obsidian";
import type { CognitiveNode } from "./tutor";

/** Agent 工具定义（OpenAI function calling 格式） */
export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** 一次工具调用（模型请求的） */
export interface ToolCall {
  id: string;
  name: string;
  /** openai 模式为对象；opencode 模式为字符串摘要 */
  arguments: Record<string, unknown> | string;
}

/** 一次工具执行步骤（回调给 UI 显示过程日志） */
export interface AgentStep {
  turn: number;
  call: ToolCall;
  result: string;
}

/** vault 工具执行器 —— 由插件实现（main.ts 注入），返回给模型的结果文本 */
export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<string>;

/** Agent 通道配置 */
export interface AgentConfig {
  apiBase: string;
  apiKey: string;
  model: string;
}

/** Agent 运行结果 */
export interface AgentResult {
  ok: boolean;
  /** 最终回复（模型文本） */
  answer: string;
  /** 实际执行的工具名列表（去重） */
  toolsUsed: string[];
  /** 轮数 */
  turns: number;
}

/** 内置工具清单（OpenAI function schema） */
export const AGENT_TOOLS: AgentTool[] = [
  {
    name: "read_note",
    description:
      "读取 vault 内笔记的完整内容。参数 path 为 vault 相对路径（如 learning/peizhi/learn/_wiki/认知边缘/xxx.md）。用于了解已有笔记内容。",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "vault 相对路径" } },
      required: ["path"],
    },
  },
  {
    name: "list_nodes",
    description:
      "列出认知边缘节点（当前工作区的思维链节点树）。返回节点标题、父节点、摘要。用于了解认知地图现状、决定挂载位置。",
    parameters: {
      type: "object",
      properties: { workspace: { type: "string", description: "工作区名（可选，默认当前）" } },
    },
  },
  {
    name: "create_node",
    description:
      "创建认知节点笔记（沉淀知识到认知地图）。参数：title 节点标题（简洁、具体）；content 节点正文（Markdown，含理解沉淀）；parentTitle 父节点标题（可省略=挂根）。每次创建新节点文件，同名自动追加 -2/-3，不合并。写入后自动更新 MOC。",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "节点标题" },
        content: { type: "string", description: "节点正文（Markdown）" },
        parentTitle: { type: "string", description: "父节点标题（可省略）" },
      },
      required: ["title", "content"],
    },
  },
  {
    name: "update_moc",
    description: "重新生成当前工作区的认知地图索引（MOC）文件。用于节点变动后刷新索引。",
    parameters: {
      type: "object",
      properties: { workspace: { type: "string", description: "工作区名（可选，默认当前）" } },
    },
  },
  {
    name: "query_backlinks",
    description:
      "查询某个笔记在 vault 中的反向链接（哪些笔记引用了它）。参数 path 为 vault 相对路径。用于理解笔记间的关系。",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "vault 相对路径" } },
      required: ["path"],
    },
  },
  {
    name: "search_notes",
    description:
      "按关键词搜索 vault 内笔记内容（标题或正文包含关键词）。返回匹配的笔记路径和摘要片段。用于定位相关材料。",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "搜索关键词" } },
      required: ["query"],
    },
  },
];

/** 工具名集合（快速校验） */
const TOOL_NAMES = new Set(AGENT_TOOLS.map((t) => t.name));

/** 构造 agent system prompt（价值识别器 + 工具使用说明） */
export function buildAgentSystemPrompt(wsHint?: string): string {
  return [
    "你是「认知边缘导师」的执行代理（agent）。用户在 Obsidian 里给你下达操作指令，你通过调用工具完成它。",
    "",
    wsHint ? wsHint : "",
    "",
    "工具使用铁律：",
    "1. 需要了解现状 → 先 list_nodes / search_notes / read_note，不要凭空假设。",
    "2. 沉淀知识 → create_node：标题简洁具体；正文用 Markdown 写清楚理解；有明确父子关系时给 parentTitle。",
    "3. 一次任务可能要多步：查现状 → 执行 → 验证。逐步来，每步工具结果会返回给你。",
    "4. 工具失败（如路径不存在）→ 根据错误信息调整参数重试，不要编造结果。",
    "5. 任务完成后，用一两句话向用户总结：做了什么、节点/文件在哪、如需调整可怎么说。",
    "",
    "内容风格：中文，教练口吻（不是 AI 腔）。",
  ].join("\n");
}

/**
 * 运行 agent 循环：LLM(tools) → 执行工具 → 回填 → 循环，直到模型不再要工具或超轮数。
 *
 * @param config  通道配置（DeepSeek 官方）
 * @param userInput 用户指令
 * @param executor 工具执行器（vault 操作，由插件注入）
 * @param signal   中止信号（可选）
 */
export async function runAgent(
  config: AgentConfig,
  userInput: string,
  executor: ToolExecutor,
  opts: { signal?: AbortSignal; onDelta?: (text: string) => void; onStep?: (step: AgentStep) => void; maxTurns?: number; wsHint?: string } = {}
): Promise<AgentResult> {
  const maxTurns = opts.maxTurns && opts.maxTurns > 0 ? opts.maxTurns : 30;
  const toolsUsed = new Set<string>();
  const messages: Record<string, unknown>[] = [
    { role: "system", content: buildAgentSystemPrompt(opts.wsHint) },
    { role: "user", content: userInput },
  ];
  let turns = 0;

  while (turns < maxTurns) {
    turns++;
    const payload = {
      model: config.model,
      messages,
      tools: AGENT_TOOLS.map((t) => ({
        type: "function" as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      tool_choice: "auto" as const,
      temperature: 0.4,
      max_tokens: 2048,
    };

    const resp = await fetch(`${config.apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: opts.signal,
    });
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Agent 请求失败 (${resp.status}): ${errText.slice(0, 300)}`);
    }
    const data = await resp.json();
    const msg = data?.choices?.[0]?.message;
    if (!msg) throw new Error("Agent 返回空响应");

    // 模型要求调用工具
    const calls: ToolCall[] = (msg.tool_calls ?? [])
      .filter((c: Record<string, unknown>) => c?.type === "function")
      .map((c: Record<string, unknown>) => {
        const fn = c.function as Record<string, unknown>;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(String(fn.arguments ?? "{}"));
        } catch {
          args = {};
        }
        return { id: String(c.id), name: String(fn.name), arguments: args };
      });

    // 先把 assistant 消息（含 tool_calls）加入历史
    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: msg.tool_calls ?? [] });

    if (calls.length === 0) {
      // 模型直接回答：结束
      const answer = String(msg.content ?? "");
      opts.onDelta?.(answer);
      return { ok: true, answer, toolsUsed: [...toolsUsed], turns };
    }

    // 逐个执行工具并回填
    for (const call of calls) {
      if (!TOOL_NAMES.has(call.name)) {
        const err = `未知工具：${call.name}`;
        messages.push({ role: "tool", tool_call_id: call.id, content: err });
        opts.onStep?.({ turn: turns, call, result: err });
        continue;
      }
      toolsUsed.add(call.name);
      let result: string;
      try {
        result = await executor(call.name, call.arguments as Record<string, unknown>);
      } catch (e) {
        result = `工具执行失败: ${(e as Error).message.slice(0, 300)}`;
      }
      opts.onStep?.({ turn: turns, call, result });
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  return {
    ok: true,
    answer: `⚠️ 任务超过 ${maxTurns} 轮仍未完成，已停止。你可以把任务拆小再试。`,
    toolsUsed: [...toolsUsed],
    turns,
  };
}

/**
 * 构造默认 vault 工具执行器（绑定 Obsidian app）。
 * 注意：这是纯 vault 操作，绝不执行 shell/网络。
 */
export function buildVaultExecutor(app: App, ctx: {
  currentWorkspace: () => string;
  listNodes: (ws?: string) => Promise<CognitiveNode[]>;
  createNode: (node: CognitiveNode) => Promise<TFile>;
  updateMoc: (ws?: string) => Promise<void>;
}): ToolExecutor {
  const { currentWorkspace, listNodes, createNode, updateMoc } = ctx;
  return async (name, args) => {
    switch (name) {
      case "read_note": {
        const path = String(args.path ?? "");
        if (!path) return "错误：需要 path 参数";
        const f = app.vault.getAbstractFileByPath(path);
        if (!(f instanceof TFile)) return `文件不存在：${path}`;
        const text = await app.vault.read(f);
        return text.slice(0, 4000);
      }
      case "list_nodes": {
        const ws = String(args.workspace ?? "") || currentWorkspace();
        const nodes = await listNodes(ws);
        if (nodes.length === 0) return "（当前工作区没有认知节点，可以从零开始创建）";
        return nodes
          .map((n) => `- ${n.title}${n.parentTitle ? `（父: ${n.parentTitle}）` : ""}${n.summary ? `: ${n.summary.slice(0, 80)}` : ""}`)
          .join("\n");
      }
      case "create_node": {
        const title = String(args.title ?? "").trim();
        const content = String(args.content ?? "").trim();
        if (!title || !content) return "错误：需要 title 和 content 参数";
        const parentTitle = args.parentTitle ? String(args.parentTitle) : undefined;
        const ws = currentWorkspace();
        const node: CognitiveNode = {
          title,
          content,
          parentTitle,
          workspace: ws,
          anchor: { sourcePath: "", quote: "" },
          status: "active",
        };
        const f = await createNode(node);
        return `已创建节点：${f.path}`;
      }
      case "update_moc": {
        const ws = String(args.workspace ?? "") || currentWorkspace();
        await updateMoc(ws);
        return `已更新认知地图 MOC（工作区：${ws}）`;
      }
      case "query_backlinks": {
        const path = String(args.path ?? "");
        if (!path) return "错误：需要 path 参数";
        // metadataCache.getBacklinksForPath 不在类型声明里（新版 d.ts），运行时存在
        const cache = app.metadataCache as unknown as {
          getBacklinksForPath: (path: string) => Map<string, unknown>;
        };
        const links = cache.getBacklinksForPath(path);
        const keys = [...links.keys()];
        if (keys.length === 0) return `没有笔记引用 ${path}`;
        return `引用 ${path} 的笔记：\n${keys.slice(0, 20).map((k) => `- ${k}`).join("\n")}`;
      }
      case "search_notes": {
        const query = String(args.query ?? "").trim();
        if (!query) return "错误：需要 query 参数";
        const q = query.toLowerCase();
        const hits: string[] = [];
        const files = app.vault.getMarkdownFiles();
        for (const f of files) {
          if (hits.length >= 15) break;
          if (f.path.toLowerCase().includes(q)) {
            hits.push(`- ${f.path}（标题命中）`);
            continue;
          }
          const text = await app.vault.cachedRead(f);
          if (text.toLowerCase().includes(q)) {
            const idx = text.toLowerCase().indexOf(q);
            const snippet = text.slice(Math.max(0, idx - 40), idx + 80).replace(/\n+/g, " ");
            hits.push(`- ${f.path}：…${snippet}…`);
          }
        }
        return hits.length ? hits.join("\n") : `没有找到包含 "${query}" 的笔记`;
      }
      default:
        return `未知工具：${name}`;
    }
  };
}
