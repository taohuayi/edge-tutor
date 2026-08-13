/**
 * 诊断测试：为什么"问了好几个问题但感觉只检索了一次"？
 *
 * 背景（来自 main.ts / view.ts 源码）：
 * - 每次提问 respond() 都会调用 semanticTextbookSearch(lastUser.content)
 * - 但 L0 会话缓存（searchCache，LRU 10 条）以 normalizeQuery(rawQ) 为 key，
 *   命中即返回缓存结果，不再真正检索（main.ts:1236-1246, 1428-1438）
 * - normalizeQuery 只取归一化后的前 40 字符（search.ts:101-108）
 * - "选中原文追问"模式的消息内容是：
 *     【由这段原文引出】\n> {选中原文}\n\n问题：{问题}（view.ts:890）
 *
 * 本测试验证：不同提问场景下缓存 key 是否碰撞 → 决定"真检索次数"。
 *
 * 修复（2026-08-11）：main.ts 的缓存 key 改为 normalizeQuery(extractQuestionPart(rawQFull))——
 * 先剥「选中原文追问」前缀只留问题本体（search.ts 新增 extractQuestionPart）。
 * simulateQuestions 的 key 构造与修复后 main.ts 一致；场景 A 保留裸 normalizeQuery 断言，
 * 作为"修复前行为"的回归文档；场景 F 直接测真实 extractQuestionPart。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeQuery, extractQuestionPart } from "./.build/search.cjs";

/** view.ts:890 的消息内容构造（选中原文追问模式） */
function contentFromSelection(origin, question) {
  return `【由这段原文引出】\n> ${origin}\n\n问题：${question}`;
}

/** 复刻 main.ts L0 会话缓存（searchCache，LRU 10 条，key = normalizeQuery(extractQuestionPart(msg))） */
function makeCacheSim() {
  const map = new Map();
  return {
    /** 命中返回 true（等价 main.ts:1238-1245），并刷新 LRU */
    lookup(qKey) {
      if (qKey && map.has(qKey)) {
        const v = map.get(qKey);
        map.delete(qKey);
        map.set(qKey, v);
        return true;
      }
      return false;
    },
    /** 写缓存（等价 main.ts:1428-1438） */
    store(qKey) {
      if (qKey) {
        if (map.size >= 10) map.delete(map.keys().next().value);
        map.set(qKey, true);
      }
    },
    size: () => map.size,
  };
}

/** 修复前行为的模拟（回归文档用）：key = normalizeQuery(整条消息)，无前缀剥离 */
function simulateLegacyQuestions(messages) {
  const cache = makeCacheSim();
  let realSearches = 0;
  for (const msg of messages) {
    const key = normalizeQuery(msg);
    if (cache.lookup(key)) continue;
    realSearches++;
    cache.store(key);
  }
  return { realSearches, total: messages.length, cacheSize: cache.size() };
}

/** 模拟连续提问：统计真正发起检索的次数（每问查缓存，未命中才"真检索"）。
 *  key 构造与修复后的 main.ts 一致：先剥「选中原文追问」前缀，再归一化 */
function simulateQuestions(messages) {
  const cache = makeCacheSim();
  let realSearches = 0;
  for (const msg of messages) {
    const key = normalizeQuery(extractQuestionPart(msg));
    if (cache.lookup(key)) {
      continue; // 缓存命中 → 不真检索
    }
    realSearches++;
    cache.store(key);
  }
  return { realSearches, total: messages.length, cacheSize: cache.size() };
}

/** 教材风格长原文（>40 字符，缓存 key 截断后问题部分进不去） */
const LONG_ORIGIN =
  "设函数 f(x) 在闭区间 [a,b] 上连续，在开区间 (a,b) 内可导，则至少存在一点 ξ∈(a,b)，使得 f'(ξ)=[f(b)-f(a)]/(b-a)。";

/** 较短原文（去标点后仍 >40 字符 → 问题同样被挤出） */
const SHORT_ORIGIN = "拉格朗日中值定理：存在 ξ 使 f'(ξ)=[f(b)-f(a)]/(b-a)";

/** 极短原文（去标点后 <40 字符，问题部分能进 key）——教材里几乎不存在这种原文 */
const TINY_ORIGIN = "存在 ξ 使 f'(ξ)=0";

// ============================================================
// 场景 A：选中原文追问（插件主用法）—— 同一段长原文 + 不同问题
// ============================================================
test("A. 选中长原文追问：3 个不同问题的缓存 key 碰撞（问题被原文挤掉）", () => {
  const keys = ["为什么要求闭区间连续？", "为什么开区间内可导就够？", "等号什么时候成立？"].map((q) =>
    normalizeQuery(contentFromSelection(LONG_ORIGIN, q))
  );
  // 端到端（修复前 key 逻辑）：3 问只真检索 1 次
  const sim = simulateLegacyQuestions(
    ["为什么要求闭区间连续？", "为什么开区间内可导就够？", "等号什么时候成立？"].map((q) =>
      contentFromSelection(LONG_ORIGIN, q)
    )
  );
  assert.equal(sim.realSearches, 1, "3 个不同问题应只真检索 1 次（后续 2 次缓存命中）");
  assert.equal(keys[0], keys[1]);
  assert.equal(keys[1], keys[2]);
  console.log(`  [A] 3 问真检索 ${sim.realSearches} 次 → key 示例: ${JSON.stringify(keys[0].slice(0, 25))}…`);
});

test("A'. 选中较短原文追问：原文+前缀去标点后仍 ≥40 字符 → 问题照样被挤出，同样碰撞", () => {
  const keys = ["为什么要求闭区间连续？", "等号什么时候成立？"].map((q) =>
    normalizeQuery(contentFromSelection(SHORT_ORIGIN, q))
  );
  const sim = simulateLegacyQuestions([
    contentFromSelection(SHORT_ORIGIN, "为什么要求闭区间连续？"),
    contentFromSelection(SHORT_ORIGIN, "等号什么时候成立？"),
  ]);
  assert.equal(sim.realSearches, 1, "原文去标点后仍 >40 字符 → 问题进不了 key，2 问只真检索 1 次");
  assert.equal(keys[0], keys[1]);
  console.log(`  [A'] 2 问真检索 ${sim.realSearches} 次 → key 仍相同（原文 36 字符+前缀已超 40 截断）`);
});

test("A''. 选中极短原文：原文+前缀 <40 字符时问题才能进 key（教材原文几乎不满足）", () => {
  const keys = ["为什么？", "等号什么时候成立？"].map((q) =>
    normalizeQuery(contentFromSelection(TINY_ORIGIN, q))
  );
  const sim = simulateLegacyQuestions([
    contentFromSelection(TINY_ORIGIN, "为什么？"),
    contentFromSelection(TINY_ORIGIN, "等号什么时候成立？"),
  ]);
  assert.equal(sim.realSearches, 2, "极短原文时问题进得了 key，应真检索 2 次");
  assert.notEqual(keys[0], keys[1]);
  console.log(`  [A''] 2 问真检索 ${sim.realSearches} 次 → key 不同（原文极短，问题未被挤出）`);
});

// ============================================================
// 场景 B：纯文本提问（不选原文）—— 不同问题
// ============================================================
test("B. 纯文本提问：3 个不同问题 key 不碰撞，每次真检索", () => {
  const questions = ["拉格朗日中值定理的适用条件是什么？", "柯西中值定理什么时候用？", "罗尔定理证明怎么构造辅助函数？"];
  const keys = questions.map(normalizeQuery);
  const sim = simulateQuestions(questions);
  assert.equal(sim.realSearches, 3, "纯文本不同问题应每次真检索");
  assert.equal(new Set(keys).size, 3, "3 个 key 应互不相同");
  console.log(`  [B] 3 问真检索 ${sim.realSearches} 次 → key 各不相同（正常）`);
});

// ============================================================
// 场景 C：链式追问短句（"为什么""然后呢"）—— 归一化后为空
// ============================================================
test("C. 追问短句：多数归一化为空（不缓存、每次真检索），但残留语气词会留下非空 key", () => {
  const cases = ["为什么？", "为什么", "详细讲讲", "继续", "然后呢"];
  const keys = cases.map(normalizeQuery);
  // 实际行为：前 4 个被去词表清空；"然后呢" → "然后"被去 → 残留"呢"
  assert.deepEqual(keys.slice(0, 4), ["", "", "", ""], "为什么/详细讲讲/继续 归一化后应为空");
  assert.equal(keys[4], "呢", "「然后呢」残留语气词「呢」→ 非空 key");
  const sim = simulateQuestions(cases);
  assert.equal(sim.realSearches, 5, "key 为空的不缓存，非空的「呢」入缓存 → 5 问各真检索一次");
  console.log(`  [C] 5 问真检索 ${sim.realSearches} 次 → key = ${JSON.stringify(keys)}`);
});

test("C2. 短追问互相碰撞：不同短句归一化后同为「呢」→ 命中同一缓存（已知次要缺陷，本次不修）", () => {
  const keys = ["然后呢", "为什么呢？", "那这个呢？"].map(normalizeQuery);
  assert.deepEqual(keys, ["呢", "呢", "呢"], "三个不同追问归一化后 key 全为「呢」→ 互相碰撞");
  const sim = simulateQuestions(keys);
  assert.equal(sim.realSearches, 1, "3 个不同追问只真检索 1 次（后 2 次命中缓存）");
  console.log(`  [C2] 3 问真检索 ${sim.realSearches} 次 → key 全为「呢」（短追问链也会撞）`);
});

// ============================================================
// 场景 D：同一问题不同表述
// ============================================================
test("D. 同一问题不同表述：key 不同，不会误命中缓存", () => {
  const keys = ["拉格朗日中值定理的适用条件", "拉格朗日中值定理何时可以使用"].map(normalizeQuery);
  assert.notEqual(keys[0], keys[1]);
  console.log(`  [D] 两种表述 key 不同（"${keys[0]}" ≠ "${keys[1]}"）→ 不会误命中`);
});

// ============================================================
// 场景 E：完全相同的重复问题（"重复问题一律新建结点"）
// ============================================================
test("E. 完全相同的问题重复提问：缓存命中（设计内行为：同主题追问 <1s）", () => {
  const q = "拉格朗日中值定理的适用条件是什么？";
  const sim = simulateQuestions([q, q, q]);
  assert.equal(sim.realSearches, 1, "同问 3 次应只真检索 1 次");
  console.log(`  [E] 同问 3 次真检索 ${sim.realSearches} 次（设计如此，非缺陷）`);
});

// ============================================================
// 场景 F（修复方向验证）：key 构造剥掉原文前缀 → 问题独立进 key
// ============================================================
test("F. 修复已落地：extractQuestionPart 只留问题本体 → 同一原文的追问不再碰撞", () => {
  const c1 = contentFromSelection(LONG_ORIGIN, "为什么要求闭区间连续？");
  const c2 = contentFromSelection(LONG_ORIGIN, "等号什么时候成立？");
  const keys = [c1, c2].map((c) => normalizeQuery(extractQuestionPart(c)));
  assert.notEqual(keys[0], keys[1], "修复后同一原文的不同问题 key 应不同");
  const sim = simulateQuestions([c1, c2]);
  assert.equal(sim.realSearches, 2, "修复后 2 问应真检索 2 次");
  console.log(`  [F] 修复后 2 问真检索 ${sim.realSearches} 次 → key: "${keys[0]}" ≠ "${keys[1]}"`);
});

test("F2. 原文里含「问题」字样（非段分隔）不会被误剥；纯文本消息原样返回", () => {
  // 教材原文里有"问题"一词但不构成 "\n\n问题：" 段分隔 → 前缀剥到真正的分隔符
  const originWithWord = "这类问题在考试中常见。设 f(x) 在 [a,b] 上连续…";
  const c = contentFromSelection(originWithWord, "为什么要求闭区间连续？");
  assert.equal(extractQuestionPart(c), "为什么要求闭区间连续？", "「问题」字样不构成段分隔时提取正确");
  assert.equal(extractQuestionPart("纯文本提问不剥任何东西"), "纯文本提问不剥任何东西", "无前缀消息原样返回");
  console.log('  [F2] 边界：原文含「问题」字样不误剥；无前缀消息原样返回');
});

// ============================================================
// 总览：修复后各场景真检索次数（A 场景裸 key 碰撞为修复前行为文档）
// ============================================================
test("总览：修复后模拟结果汇总", () => {
  const longSameOrigin = ["为什么要求闭区间连续？", "为什么开区间内可导就够？", "等号什么时候成立？"].map((q) =>
    contentFromSelection(LONG_ORIGIN, q)
  );
  const plain = ["拉格朗日中值定理的适用条件是什么？", "柯西中值定理什么时候用？", "罗尔定理证明怎么构造辅助函数？"];
  const rows = [
    ["选中原文追问（长原文，3 问）", simulateQuestions(longSameOrigin).realSearches],
    ["纯文本提问（3 问）", simulateQuestions(plain).realSearches],
  ];
  console.log("\n  ┌─────────────────────────────┬──────────┐");
  console.log("  │ 发问模式（修复后 key 逻辑）    │ 真检索次数 │");
  for (const [name, n] of rows) {
    console.log(`  ├─────────────────────────────┼──────────┤`);
    console.log(`  │ ${name.padEnd(27)} │    ${n}     │`);
  }
  console.log("  └─────────────────────────────┴──────────┘\n");
});
