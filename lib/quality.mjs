export const requiredHeadings = {
  requirement_analysis: [
    "业务结论",
    "需求主体",
    "当前流程",
    "问题与根因",
    "AI适配性",
    "指标候选",
    "约束与风险",
    "非AI替代方案",
    "证据与冲突",
    "待验证假设",
    "下一步问题",
  ],
  solution_design: [
    "方案结论",
    "事实状态与关键缺口",
    "产品定位与场景嵌入",
    "架构选择与方案取舍",
    "MVP核心业务链路",
    "角色与技术职责边界",
    "分阶段流程设计",
    "异常、降级与人工确认",
    "MVP范围与实施顺序",
    "成功指标与验证计划",
    "风险、约束与待验证假设",
    "下一步动作",
  ],
  prd_draft: [
    "文档说明",
    "事实状态与开放问题",
    "项目背景与业务问题",
    "产品目标与非目标",
    "目标用户与核心场景",
    "MVP范围",
    "用户故事",
    "产品总体流程",
    "AI、知识库、规则、API与人工职责边界",
    "功能需求",
    "异常与降级流程",
    "权限、数据、安全与审计",
    "非功能需求",
    "成功指标与评测方案",
    "Given-When-Then验收标准",
    "依赖、风险与待验证假设",
    "实施顺序与下一步动作",
  ],
  competitor_analysis: [
    "分析结论",
    "分析对象与任务边界",
    "事实状态与证据缺口",
    "竞品与替代方案分类",
    "统一竞品矩阵",
    "重点产品业务链路拆解",
    "AI嵌入位置与职责边界",
    "共性能力与基础门槛",
    "优势、弱点与成立条件",
    "生态位假设",
    "机会缺口与差异化建议",
    "风险、限制与待核验事项",
    "验证计划",
    "下一步动作",
  ],
};
const norm = (s) =>
  s
    .replace(/[\s\d.#*`、，,（）()：:\-—]/g, "")
    .replace(/[与及和]/g, "")
    .toLowerCase();
export function checkStructure(body, type) {
  if (
    typeof body !== "string" ||
    body.trim().length < 80 ||
    body.length > 120000
  )
    throw Error("没有得到有效的完整正文");
  const headings = body
    .split("\n")
    .filter((x) => /^#{1,6}\s/.test(x))
    .map(norm);
  const missing = (requiredHeadings[type] || []).filter(
    (h) => !headings.some((x) => x.includes(norm(h))),
  );
  if (missing.length)
    throw Error("文档结构校验未通过，缺少：" + missing.join("、"));
  if (
    type === "prd_draft" &&
    !(/Given/i.test(body) && /When/i.test(body) && /Then/i.test(body))
  )
    throw Error("PRD 缺少 Given-When-Then 验收条件");
  return true;
}
export function validateRoute(x) {
  const intents = [
    "requirement_analysis",
    "solution_design",
    "prd_draft",
    "competitor_analysis",
    "unknown",
  ];
  if (
    !x ||
    !intents.includes(x.intent) ||
    !["low", "medium", "high"].includes(x.risk_level) ||
    typeof x.sufficient !== "boolean" ||
    typeof x.safe_response_required !== "boolean" ||
    !["high", "medium", "low"].includes(x.confidence) ||
    !Array.isArray(x.risk_flags) ||
    !Array.isArray(x.missing_fields) ||
    typeof x.clarifying_question !== "string"
  )
    throw Error("意图识别结果格式无效，不继续执行");
  for (const k of ["risk_flags", "missing_fields"])
    if (
      x[k].length > 30 ||
      x[k].some((v) => typeof v !== "string" || v.length > 2000)
    )
      throw Error("意图识别字段格式无效");
  return x;
}
export function checkEvidence(e, manifest) {
  for (const k of ["facts", "sources", "suggestions", "assumptions", "risks"])
    if (
      !Array.isArray(e?.[k]) ||
      e[k].length > 100 ||
      e[k].some((v) => typeof v !== "string" || v.length > 8000)
    )
      throw Error("审校证据分类格式无效");
  if (!Array.isArray(e.citations)) throw Error("审校缺少结构化引用");
  for (const c of e.citations) {
    const source = manifest.find((s) => s.id === c.sourceId);
    if (
      !source ||
      typeof c.quote !== "string" ||
      !c.quote.trim() ||
      !source.text.includes(c.quote)
    )
      throw Error("审校引用不在实际输入资料中，不保存为有效结果");
  }
  for (const item of e.sources) {
    const id = item.split(/[：:｜|]/)[0].trim();
    if (
      !manifest.some((m) => m.id === id) ||
      !e.citations.some((c) => c.sourceId === id)
    )
      throw Error("资料来源缺少真实来源ID与逐字引用，不保存为有效结果");
  }
  return e;
}
// Limited deterministic guard; semantic review still requires node 1 and human review.
export function riskSignals(task) {
  const rules = [
    [/一定.{0,5}(购买|买单)|确定.{0,5}购买名单/g, "确定性客户购买判断"],
    [/(绕过|跳过).{0,10}(身份|权限|审批|确认)/g, "绕过身份或审批"],
    [
      /自动退款|自动补偿|自动改价|承诺最低价|保证到货/g,
      "未经确认的执行或商业承诺",
    ],
    [/(未经授权|未授权).{0,12}(获取|查询|使用|导出)/g, "未授权数据使用"],
  ];
  const flags = [];
  for (const [pattern, label] of rules) {
    for (const match of task.matchAll(pattern)) {
      const before = task.slice(Math.max(0, match.index - 15), match.index);
      if (
        /(不要|不得|禁止|不允许|不会|不能|不做|不用|不|避免)\s*$/.test(before)
      )
        continue;
      flags.push(label);
      break;
    }
  }
  return flags;
}
export function numericWarnings(body, manifest) {
  const joined = manifest.map((s) => s.text).join("\n");
  return [...new Set(body.match(/\d+(?:\.\d+)?\s*[%％]/g) || [])]
    .filter((n) => !joined.includes(n))
    .map(
      (n) =>
        "检测到资料中未出现的百分比 " +
        n +
        "，需人工核查（程序不作真实性判断）",
    );
}
