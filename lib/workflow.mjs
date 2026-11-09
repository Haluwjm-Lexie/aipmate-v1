import { retrieveKnowledge } from "./knowledge.mjs";
import { callModel } from "./generate.mjs";
import {
  promptMessages,
  taskNames,
  taskNodes,
  promptVersion,
  hash,
} from "./prompts.mjs";
import {
  requiredHeadings,
  checkStructure,
  structureWarnings,
  validateRoute,
  evidenceWarnings,
  riskSignals,
  numericWarnings,
} from "./quality.mjs";
export async function runWorkflow(
  input,
  signal,
  { onStep = () => {}, invoke = callModel } = {},
) {
  const {
    project,
    task,
    sources = "",
    clarification = "",
    history = [],
    taskType = "auto",
    previousQuestions = [],
  } = input;
  if (!Object.hasOwn(taskNames, taskType)) throw Error("不支持的任务类型");
  const knowledge = retrieveKnowledge(
    project.knowledge || [],
    task + "\n" + clarification,
  );
  const { knowledge: _storedKnowledge, ...projectContext } = project;
  const retrievalStatus = (project.knowledge || []).length
    ? knowledge.length
      ? "matched"
      : "no_matches"
    : "not_configured";
  const manifest = [
    {
      id: "P1",
      kind: "user_provided",
      title: "项目背景",
      text: JSON.stringify(projectContext),
    },
    { id: "T1", kind: "user_provided", title: "当前任务", text: task },
  ];
  if (sources)
    manifest.push({
      id: "S1",
      kind: "user_provided",
      title: "用户粘贴资料（未独立核实）",
      text: sources,
    });
  if (clarification)
    manifest.push({
      id: "A1",
      kind: "user_provided",
      title: "本轮补充回答",
      text: clarification,
    });
  for (const d of history)
    manifest.push({
      id: "H" + d.id,
      kind: "unconfirmed_draft",
      title: d.title,
      text: d.body,
    });
  manifest.push(...knowledge);
  const context = {
    project: projectContext,
    task,
    clarification,
    previousQuestions,
    history: history.map((d) => ({
      id: d.id,
      title: d.title,
      body: d.body,
      status: "历史AI草稿，不是已确认事实",
    })),
    retrieval: { status: retrievalStatus, items: knowledge },
    evidence_manifest: manifest,
  };
  const vars = {
    task_input: task,
    project_context: JSON.stringify(projectContext),
    retrieved_evidence: JSON.stringify(knowledge),
    risk_flags: [],
    Requirement: "",
    Solution: "",
    Draft: "",
    Competitive_Analysis: "",
    context,
  };
  const trace = [];
  let model = "",
    total = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  async function node(
    id,
    extra = {},
    contract = '只输出合法JSON，格式：{"body":"保留专业要求的完整 Markdown 正文"}。Markdown 标题和方法必须遵守原规则，不压缩成摘要。',
  ) {
    if (signal?.aborted) throw Error("任务已取消");
    await onStep({ node: id, status: "running" });
    const messages = promptMessages(id, { ...vars, ...extra }, contract);
    const start = Date.now();
    try {
      const r = await invoke(messages, signal, id === 1 ? 3000 : 18000);
      model = r.model;
      for (const k of Object.keys(total)) total[k] += r.usage?.[k] || 0;
      trace.push({
        node: id,
        promptVersion,
        systemHash: hash(messages[0].content),
        userHash: hash(messages[1].content),
        elapsed: Date.now() - start,
        usage: r.usage,
        responseId: r.responseId || null,
        status: "completed",
      });
      await onStep({ node: id, status: "completed", trace: [...trace] });
      return r.result;
    } catch (e) {
      trace.push({ node: id, status: "failed", elapsed: Date.now() - start });
      await onStep({ node: id, status: "failed", trace: [...trace] });
      throw e;
    }
  }
  const r = validateRoute(
    await node(
      1,
      {},
      "仅输出系统规则要求的路由 JSON，字段统一为 safe_response_required。明确选择的任务入口是 " +
        taskType +
        "；显式入口时按该类型检查完整性，智能识别才自行决定 intent。不能把历史AI草稿当会话已确认事实。",
    ),
  );
  const programFlags = riskSignals(task + "\n" + clarification);
  const flags = [...new Set([...r.risk_flags, ...programFlags])];
  const meta = () => ({
    trace,
    model,
    usage: total,
    promptVersion,
    evidenceManifest: manifest,
    retrievalStatus,
    routing: r,
  });
  if (
    r.risk_level === "high" ||
    r.safe_response_required ||
    programFlags.length
  ) {
    // Node 2 receives a minimal risk summary, never raw sources/customer records.
    const safeContext = {
      project: { name: project.name },
      risk_flags: flags,
      task: "用户请求涉及高风险判断、承诺或越权操作，请给出边界和替代方案",
    };
    const safe = await node(2, {
      task_input: safeContext.task,
      risk_flags: flags,
      context: safeContext,
    });
    if (typeof safe.body !== "string" || safe.body.trim().length < 30)
      throw Error("高风险安全回复为空");
    return {
      status: "high_risk",
      body: safe.body,
      title: "风险边界与安全替代方案",
      taskType: r.intent,
      ...meta(),
    };
  }
  const type = taskType === "auto"
    ? (r.intent === "unknown" ? "requirement_analysis" : r.intent)
    : taskType;
  context.open_questions = r.sufficient ? [] : r.missing_fields;
  const headings = requiredHeadings[type]
    .map((h, i) => `## ${i + 1}. ${h}`)
    .join("\n");
  const draft = await node(
    taskNodes[type],
    {},
    '只输出合法JSON：{"body":"Markdown正文"}。用户可以用一句话描述想法。基于现有信息先给出有用草稿，明确区分事实和假设，把未知事项放到文末。优先回答用户的实际问题，以下栏目按相关性选用：\n' +
      headings,
  );
  await onStep({
    node: taskNodes[type],
    status: "completed",
    trace: [...trace],
    draftBody: draft.body,
  });
  if (
    typeof draft.body !== "string" ||
    draft.body.trim().length < 80 ||
    draft.body.length > 120000
  )
    throw Error("没有得到有效的完整正文");
  if (process.env.VERCEL === "1") {
    return {
      status: "completed",
      taskType: type,
      title: project.name + "｜" + taskNames[type],
      body: draft.body,
      draftBody: draft.body,
      evidence: {
        facts: [],
        sources: [],
        suggestions: [],
        assumptions: ["线上部署跳过最终复核以避免函数超时。"],
        risks: ["请人工检查生成报告。"],
      },
      warnings: ["线上快速生成模式：保留完整提示词和初稿，跳过最终复核。"],
      ...meta(),
    };
  }
  let draftFormatIssue = "";
  try {
    checkStructure(draft.body, type);
  } catch (e) {
    draftFormatIssue = e.message;
  }
  const branch = {
    Requirement: "",
    Solution: "",
    Draft: "",
    Competitive_Analysis: "",
  };
  branch[
    {
      requirement_analysis: "Requirement",
      solution_design: "Solution",
      prd_draft: "Draft",
      competitor_analysis: "Competitive_Analysis",
    }[type]
  ] = draft.body;
  const reviewContract =
    '仅输出合法JSON：{"body":"完整审校后的专业Markdown正文","evidence":{"facts":[],"sources":[],"suggestions":[],"assumptions":[],"risks":[],"citations":[{"sourceId":"真实来源ID","quote":"来源中逐字存在的片段"}]}}。facts仅记录用户提供的信息，历史AI草稿不得当作已确认事实；sources写成“来源ID：说明”，必须有对应逐字引用。不得虚构事实或来源。正文必须保留全部专业要求并包含以下标题：\n' +
    headings;
  const final = await node(
    8,
    {
      ...branch,
      context: {
        ...context,
        task_type: type,
        draft_format_issue: draftFormatIssue,
      },
    },
    reviewContract,
  ).catch((error) => {
    if (signal?.aborted || !error.message.includes("自动精简后仍未完整结束"))
      throw error;
    return null;
  });
  const body =
    typeof final?.body === "string" && final.body.trim().length >= 80
      ? final.body
      : draft.body;
  const evidence = final?.evidence || {
    facts: [],
    sources: [],
    suggestions: [],
    assumptions: [],
    risks: [],
    citations: [],
  };
  const qualityWarnings = [
    ...(!final ? ["复核输出过长，已保留初稿，建议人工检查。"] : []),
    ...structureWarnings(body, type),
    ...evidenceWarnings(evidence, manifest),
  ];
  return {
    status: "completed",
    taskType: type,
    title: project.name + "｜" + taskNames[type],
    body,
    draftBody: draft.body,
    evidence,
    warnings: [...qualityWarnings, ...numericWarnings(body, manifest)],
    ...meta(),
  };
}
