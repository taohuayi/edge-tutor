/**
 * AI 对话层：直连 OpenAI 兼容 API（DeepSeek 等）
 * 设计原则：价值识别器 —— 识别"珍贵/细节"，推深但不拉回
 *
 * 安全：API key 优先从环境变量 EDGE_TUTOR_API_KEY 读取，
 * 不再要求明文写在 data.json。
 */

export interface TutorSettings {
  apiBase: string;
  /** 环境变量名（默认 EDGE_TUTOR_API_KEY）或空 */
  apiKeyEnv: string;
  apiKey: string;
  model: string;
  /** 认知节点输出目录（vault 内相对路径） */
  nodeFolder: string;
  /** 教材根目录（vault 内相对路径，用于定位锚点） */
  textbookRoot: string;
  /** 未发送的输入草稿（含分支意图，对齐 Zotero composerDraft） */
  draft?: {
    text: string;
    timestamp: number;
    workspace?: string;
    /** 是否将作为新分支发送 */
    branchNext?: boolean;
    /** 分支来源（当前线程摘要/问题） */
    branchOrigin?: string;
    /** 下一跳锚点 */
    nextAnchor?: string | null;
  } | null;
  /** 已完成旧版 .conv.json 迁移 */
  migrated?: boolean;
  /** 回答最大 token 数（控制回答长度） */
  maxTokens: number;
  /** 发散度（temperature，0-2，越高越发散） */
  temperature: number;
  /** 当前激活的 provider id */
  activeProvider?: string;
}

/** 一个 API 提供商（OpenAI 兼容端点） */
export interface Provider {
  id: string;
  name: string;
  apiBase: string;
  apiKey: string;
  /** 该 provider 的可用模型 */
  models: string[];
}

/** 内置 provider 预设 */
export const PRESET_PROVIDERS: Provider[] = [
  {
    id: "deepseek",
    name: "DeepSeek（官方）",
    apiBase: "https://api.deepseek.com/v1",
    apiKey: "",
    models: ["deepseek-chat", "deepseek-reasoner", "deepseek-v4-flash", "deepseek-v4-flash-0731", "deepseek-v4-pro"],
  },
  {
    id: "tokeness-claude",
    name: "Tokeness（Claude）",
    apiBase: "https://n.tokeness.io/v1",
    apiKey: "",
    models: ["claude-opus-4-8", "claude-sonnet-4-6"],
  },
  {
    id: "tokeness-gpt",
    name: "Tokeness（GPT）",
    apiBase: "https://n.tokeness.io/v1",
    apiKey: "",
    models: ["gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini"],
  },
  {
    id: "zhuomatech",
    name: "Zhuomatech",
    apiBase: "https://api.zhuomatech.cn/v1",
    apiKey: "",
    models: ["codex-auto-review", "gpt-5.4-mini", "gpt-5.5", "gpt-5.6-luna", "gpt-5.6-terra"],
  },
  {
    id: "chat2api",
    name: "chat2api 反代（本机 5005）",
    apiBase: "http://127.0.0.1:5005/v1",
    apiKey: "",
    models: ["gpt-5.6", "gpt-5.5", "gpt-5.4", "gpt-5", "gpt-4.5o", "gpt-4o", "gpt-4o-mini", "o3-mini"],
  },
];

export const DEFAULT_SETTINGS: TutorSettings = {
  apiBase: "https://api.deepseek.com/v1",
  apiKeyEnv: "EDGE_TUTOR_API_KEY",
  apiKey: "",
  model: "deepseek-chat",
  nodeFolder: "learning/peizhi/learn/_wiki/认知边缘",
  textbookRoot: "learning/peizhi/learn/_materials/math/张宇基础30讲/markdown_v2/最终版",
  draft: null,
  maxTokens: 4096,
  temperature: 0.7,
  activeProvider: "deepseek",
};

/** 解析当前生效的 provider（找不到则退回 deepseek 预设） */
export function resolveProvider(settings: TutorSettings): Provider {
  const id = settings.activeProvider || "deepseek";
  const found = PRESET_PROVIDERS.find((p) => p.id === id);
  if (found) return found;
  return PRESET_PROVIDERS[0];
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** 读取有效 API key：环境变量 > 设置里的旧值（兼容） */
export function resolveApiKey(settings: TutorSettings): string {
  if (settings.apiKeyEnv) {
    try {
      const env = (globalThis as any)?.process?.env?.[settings.apiKeyEnv];
      if (env) return env;
    } catch (e) {
      // 忽略环境变量访问失败
    }
  }
  return settings.apiKey || "";
}

/** 当前生效的端点（provider 优先，回落旧字段） */
export function activeEndpoint(settings: TutorSettings): { apiBase: string; apiKey: string } {
  const p = resolveProvider(settings);
  const apiBase = p.apiBase || settings.apiBase || "https://api.deepseek.com/v1";
  const key =
    (p.apiKey && p.apiKey.trim() ? p.apiKey : "") ||
    (() => {
      try {
        const env = (globalThis as any)?.process?.env?.[settings.apiKeyEnv || "EDGE_TUTOR_API_KEY"];
        return env ? String(env) : "";
      } catch (e) {
        return "";
      }
    })() ||
    settings.apiKey ||
    "";
  return { apiBase, apiKey: key };
}

/** 价值识别器系统提示词 —— 范式核心 */
export function buildSystemPrompt(): string {
  return [
    "你是「认知边缘导师」——一个价值识别器，不是路线规划器。",
    "",
    "铁律：",
    "1. 学生自由探索，你基于教材识别价值：珍贵（结构性/反直觉/能连接多讲）就推深；细节（技术计算/铺垫）就标记为可略过，但不贬低。",
    "2. 绝不拉回：不因章节边界、超纲、够用就好而阻止学生深入。学生想追根就陪他追。",
    "3. 停止权在学生：学生说停就停，不催促、不布置作业。",
    "4. 回答要基于教材证据：引用教材原文/题号时标注来源；不确定的明确说教材里未确认。",
    "5. 用为什么驱动：先给撞墙问题/直觉，再给理论，不先灌定义。",
    "6. 珍贵总是少数：教材里大部分是细节，帮学生识别哪些是珍贵少数。",
    "",
    "输出风格：中文，教练口吻（不是AI腔），用反例和边界检验理解，允许学生自己推导。",
    "",
    "回答组织（强制）：",
    "1. 结构清晰：分小节展开，每小节给一个小标题。推荐结构：【核心直觉】→【教材里的机制】→【边界与反例】→【能追根的方向】。",
    "2. 用朴实的语言讲清原理，先直觉后形式化。宁可讲透一个点，也不要堆砌含混的术语。",
    "3. 数学表达式必须用标准 LaTeX 且完整成对：行内用 \\(...\\)，块级用 \\[...\\]。禁止输出残缺或不完整的公式标记。",
    "4. 每段话都要「说人话」：能读出声、句子通顺、逻辑连贯。禁止意识流、禁止堆砌同义反复的玄学表述。",
    "5. 回答长度适中（几百字到一千字左右），把当前问题讲清楚即可；如果学生追问，再深入。不要为了显得高深而过度发散。",
    "6. 如果要给出可追根的方向，用简洁的条目列出，不要展开成长篇离题论述。",
  ].join("\n");
}

/** 调用 OpenAI 兼容 chat/completions */
export async function chatCompletion(
  settings: TutorSettings,
  messages: ChatMessage[],
): Promise<string> {
  const { apiBase, apiKey } = activeEndpoint(settings);
  if (!apiKey) {
    throw new Error("未配置 API Key：请在设置中选择 Provider 或填写密钥");
  }
  const resp = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      temperature: settings.temperature ?? 0.8,
      max_tokens: settings.maxTokens ?? 4096,
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`AI 请求失败 (${resp.status}): ${errText.slice(0, 300)}`);
  }
  const data = await resp.json();
  const content: string | undefined = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("AI 返回空内容");
  }
  return content;
}

/**
 * 流式调用 OpenAI 兼容 chat/completions（SSE）。
 * 返回可迭代的文本增量；用 `stream` 消费。
 */
export async function streamCompletion(
  settings: TutorSettings,
  messages: ChatMessage[],
  opts: { signal?: AbortSignal; onDelta?: (delta: string) => void } = {}
): Promise<string> {
  const { apiBase, apiKey } = activeEndpoint(settings);
  if (!apiKey) {
    throw new Error("未配置 API Key：请在设置中选择 Provider 或填写密钥");
  }
  const resp = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      temperature: settings.temperature ?? 0.8,
      max_tokens: settings.maxTokens ?? 4096,
      stream: true,
    }),
    signal: opts.signal,
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`AI 请求失败 (${resp.status}): ${errText.slice(0, 300)}`);
  }
  const reader = resp.body?.getReader();
  if (!reader) throw new Error("无法读取流式响应");
  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // 按行解析 SSE（data: {...}）
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line || line.startsWith(":")) continue;
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const delta: string | undefined = json?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length) {
            full += delta;
            opts.onDelta?.(delta);
          }
        } catch (e) {
          // 忽略解析失败的碎片
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return full;
}
