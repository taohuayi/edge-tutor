/**
 * opencode serve 通道：把 agent 任务委托给 opencode（完整 agent 运行时，含 bash/网络/文件工具）。
 *
 * 协议（opencode server API，非 OpenAI 兼容）：
 *   POST /session              → 创建会话（返回 { id }）
 *   POST /session/:id/message  → 发送消息并等待完成（同步），返回 { info, parts }
 *   DELETE /session/:id        → 清理会话
 *
 * parts 结构（type 列表）：
 *   step-start / reasoning / text / tool / step-finish
 *   tool part：{ type: "tool", tool: string, state: "pending|running|completed|error",
 *                input: unknown, output: Part[] }
 */

/** opencode 通道配置 */
export interface OpenCodeConfig {
  /** serve 地址，默认 http://127.0.0.1:10999 */
  base: string;
  /** provider id（opencode 配置里的 provider 名） */
  provider: string;
  /** 模型 id */
  model: string;
}

/** 默认启用的工具（true = 可用）。覆盖文件/终端/检索/网络，足够执行任意 vault 任务 */
const DEFAULT_TOOLS: Record<string, boolean> = {
  bash: true,
  read: true,
  glob: true,
  grep: true,
  write: true,
  edit: true,
  webfetch: true,
  websearch: true,
  task: true,
  apply_patch: true,
};

/** 安全铁律（注入 system，防止 agent 误删/误改 vault 内容） */
const SAFETY_SYSTEM = [
  "你是用户在 Obsidian vault 里的执行代理。以下铁律必须遵守：",
  "1. 禁止删除 vault 内任何文件或文件夹（包括节点 .md、.conv.json、.obsidian 配置、隐藏文件）。",
  "2. 禁止移动/重命名/批量覆盖文件，除非用户指令明确要求，且操作前先在回复中说明计划。",
  "3. 修改或创建文件前，先读取目标现状，不要凭空覆盖已有内容。",
  "4. 任务完成后用一两句话总结做了什么、文件在哪。",
].join("\n");

/** 工具执行步骤（与 agent.ts 的 AgentStep 同形，供 UI 统一显示） */
export interface OpenCodeStep {
  /** 顺序号（从 1 起） */
  turn: number;
  /** 工具调用信息 */
  call: { name: string; arguments: string };
  /** 执行结果摘要 */
  result: string;
}

/** 一次任务的结果 */
export interface OpenCodeResult {
  ok: boolean;
  /** 最终回复（合并所有 assistant 文本 part） */
  answer: string;
  /** 工具步骤列表 */
  steps: OpenCodeStep[];
}

/** 请求一次任务：创建会话 → 发送消息 → 清理会话 */
export async function runOpenCodeTask(
  config: OpenCodeConfig,
  userInput: string,
  opts: { signal?: AbortSignal; onStep?: (step: OpenCodeStep) => void; system?: string; maxWaitMs?: number } = {}
): Promise<OpenCodeResult> {
  const base = (config.base || "http://127.0.0.1:10999").replace(/\/+$/, "");
  const sessionId = await createSession(base, opts.signal);
  try {
    return await sendMessage(base, config, sessionId, userInput, opts);
  } finally {
    // 任务结束即清理会话，避免堆积
    try {
      await fetch(`${base}/session/${sessionId}`, { method: "DELETE", signal: opts.signal });
    } catch (e) {
      // 清理失败不影响结果
    }
  }
}

/** 创建会话 */
async function createSession(base: string, signal?: AbortSignal): Promise<string> {
  const resp = await fetch(`${base}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "edge-tutor agent task" }),
    signal,
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`创建 opencode 会话失败 (${resp.status}): ${errText.slice(0, 200)}`);
  }
  const data = await resp.json();
  const id = data?.id;
  if (!id) throw new Error("opencode 会话创建失败：无 id");
  return String(id);
}

/**
 * 发送消息并实时反馈（SSE）：
 *   1. prompt_async 异步发起（不等待）
 *   2. GET /event 监听 SSE：工具调用 message.part.updated 实时回调 onStep
 *   3. session.idle = 完成 → 拉全量消息取最终回答
 */
async function sendMessage(
  base: string,
  config: OpenCodeConfig,
  sessionId: string,
  text: string,
  opts: { signal?: AbortSignal; onStep?: (step: OpenCodeStep) => void; system?: string; maxWaitMs?: number } = {}
): Promise<OpenCodeResult> {
  const asyncResp = await fetch(`${base}/session/${sessionId}/prompt_async`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: { providerID: config.provider, modelID: config.model },
      tools: DEFAULT_TOOLS,
      system: opts.system ?? SAFETY_SYSTEM,
      parts: [{ type: "text", text }],
    }),
    signal: opts.signal,
  });
  if (!asyncResp.ok) {
    const errText = await asyncResp.text();
    throw new Error(`opencode 任务失败 (${asyncResp.status}): ${errText.slice(0, 300)}`);
  }

  // SSE 事件流：实时捕捉工具步骤 + 完成信号
  const reported = new Set<string>();
  let sseTurn = 0;
  const controller = new AbortController();
  const outer = opts.signal;
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener("abort", () => controller.abort());
  }
  const maxWaitMs = opts.maxWaitMs ?? 15 * 60 * 1000; // 默认 15 分钟；检索类任务可调短
  const evtResp = await fetch(`${base}/event`, { signal: controller.signal });
  if (!evtResp.ok || !evtResp.body) {
    throw new Error(`opencode 事件流失败 (${evtResp.status})`);
  }
  const reader = evtResp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let idle = false;
  const deadline = Date.now() + maxWaitMs;

  try {
    while (!idle) {
      if (Date.now() > deadline) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let ev: unknown;
        try {
          ev = JSON.parse(payload);
        } catch (e) {
          continue;
        }
        const type = (ev as { type?: string }).type;
        const props = (ev as { properties?: Record<string, unknown> }).properties ?? {};
        if (type === "session.idle") {
          idle = true;
          break;
        }
        if (type === "message.part.updated" || type === "message.part.created") {
          const part = props.part as
            | { id?: string; type?: string; tool?: string; input?: unknown; state?: unknown }
            | undefined;
          if (part?.type !== "tool" || typeof part.tool !== "string" || !part.id || reported.has(part.id)) {
            continue;
          }
          // 执行中（无结果）不报，等 completed/error 再上报，避免空状态刷屏
          const st0 = (typeof part.state === "object" && part.state !== null ? part.state : {}) as Record<string, unknown>;
          const status0 = String(st0?.status ?? "");
          const output0 = String(st0?.output ?? "").trim();
          if (status0 !== "completed" && status0 !== "error" && !output0) continue;
          reported.add(part.id);
          const step = toolPartToStep(part);
          step.turn = ++sseTurn;
          opts.onStep?.(step);
        }
      }
    }
  } finally {
    controller.abort();
    try {
      reader.releaseLock();
    } catch (e) {
      // 忽略
    }
  }

  // 拉全量消息（最终文本 + 兜底补漏步骤）
  const listResp = await fetch(`${base}/session/${sessionId}/message`, { signal: opts.signal });
  if (!listResp.ok) {
    throw new Error(`opencode 读取结果失败 (${listResp.status})`);
  }
  const msgs: unknown[] = await listResp.json();
  return parseMessages(msgs, opts, reported);
}

/** 把 SSE 的 tool part 转成步骤（state 内联执行结果） */
function toolPartToStep(part: {
  tool?: string;
  input?: unknown;
  state?: unknown;
}): OpenCodeStep {
  const st = (typeof part.state === "object" && part.state !== null ? part.state : {}) as Record<string, unknown>;
  const status = String(st?.status ?? "");
  const output = String(st?.output ?? "").trim();
  const title = String(st?.title ?? "");
  const rawInput = st?.input;
  const inputArg =
    title ||
    (typeof rawInput === "string" ? rawInput.trim() : summarizeJson(rawInput, 100)) ||
    summarizeJson(part.input, 100);
  const out = output || summarizeOutput(undefined);
  const result = status === "error" ? `⚠️ 失败：${out}` : out.length > 300 ? out.slice(0, 300) + "…" : out;
  return { turn: 0, call: { name: part.tool ?? "", arguments: inputArg }, result };
}

/** 跨全部消息解析：工具步骤（按出现顺序）+ 最终文本。已实时上报过的 part 跳过 */
function parseMessages(
  msgs: unknown[],
  opts: { onStep?: (step: OpenCodeStep) => void },
  reported?: Set<string>
): OpenCodeResult {
  const texts: string[] = [];
  const steps: OpenCodeStep[] = [];
  let turn = 0;

  for (const raw of msgs) {
    const msg = (raw ?? {}) as { info?: { role?: string }; parts?: unknown[] };
    const role = msg.info?.role;
    const parts = Array.isArray(msg.parts) ? msg.parts : [];
    for (const rp of parts) {
      const p = (rp ?? {}) as {
        id?: string;
        type?: string;
        text?: string;
        tool?: string;
        input?: unknown;
        output?: unknown;
        state?: unknown;
      };
      if (p.type === "text" && typeof p.text === "string" && p.text.trim() && role !== "user") {
        texts.push(p.text);
      } else if (p.type === "tool" && typeof p.tool === "string") {
        turn++;
        // SSE 已实时上报过的不重复回调（但保留在 steps 列表里）
        const already = reported?.has(p.id ?? "");
        const step: OpenCodeStep = { turn, call: { name: p.tool, arguments: "" }, result: "" };
        // 复用完整解析（含 output part 兜底）
        const st = (typeof p.state === "object" && p.state !== null ? p.state : {}) as Record<string, unknown>;
        const status = String(st?.status ?? "");
        const output = String(st?.output ?? "").trim();
        const title = String(st?.title ?? "");
        const rawInput = st?.input;
        const inputArg =
          title ||
          (typeof rawInput === "string" ? rawInput.trim() : summarizeJson(rawInput, 100)) ||
          summarizeJson(p.input, 100);
        const out = output || summarizeOutput(p.output);
        step.call.arguments = inputArg;
        step.result = status === "error" ? `⚠️ 失败：${out}` : out.length > 300 ? out.slice(0, 300) + "…" : out;
        steps.push(step);
        if (!already) opts.onStep?.(step);
      }
    }
  }

  const answer = texts.join("\n\n").trim() || "（任务完成，无文本回复）";
  return { ok: true, answer, steps };
}

/** 摘要化 JSON（截断 + 折叠换行） */
function summarizeJson(v: unknown, maxLen: number): string {
  if (v === undefined || v === null) return "";
  let s: string;
  try {
    s = typeof v === "string" ? v : JSON.stringify(v);
  } catch (e) {
    s = String(v);
  }
  s = s.replace(/\s+/g, " ").trim();
  return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
}

/** 工具输出摘要：取第一个文本类 part / agent part 的文本 */
function summarizeOutput(out: unknown): string {
  if (Array.isArray(out)) {
    const text = out
      .filter((x) => (x as { type?: string }).type === "text")
      .map((x) => (x as { text?: string }).text ?? "")
      .join(" ");
    const plain = text.replace(/\s+/g, " ").trim();
    if (plain) return plain.length > 200 ? plain.slice(0, 200) + "…" : plain;
    const kinds = out.map((x) => (x as { type?: string }).type ?? "?").join(",");
    return kinds ? `[输出：${kinds}]` : "[无文本输出]";
  }
  const s = summarizeJson(out, 200);
  return s || "[无文本输出]";
}
