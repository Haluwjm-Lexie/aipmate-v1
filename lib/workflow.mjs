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
  validateRoute,
  checkEvidence,
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
  if (r.intent === "unknown" && taskType === "auto") {
    const guide = await node(7);
    if (typeof guide.body !== "string" || !guide.body.trim())
      throw Error("任务引导为空");
    return {
      status: "guidance",
      body: guide.body,
      title: "选择下一步交付物",
      taskType: "unknown",
      ...meta(),
    };
  }
  const type = taskType === "auto" ? r.intent : taskType;
  if (!r.sufficient) {
    const questions = r.clarifying_question
      .split(/\n/)
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 3);
    if (!questions.length) throw Error("识别为资料不足，但模型未返回有效追问");
    return { status: "needs_input", questions, taskType: type, ...meta() };
  }
  const headings = requiredHeadings[type]
    .map((h, i) => `## ${i + 1}. ${h}`)
    .join("\n");
  const draft = await node(
    taskNodes[type],
    {},
    '只输出合法JSON：{"body":"完整Markdown正文"}。保留本专业全部分析方法，正文必须逐项包含以下二级标题，不得省略或改成摘要：\n' +
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
  let final = await node(
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
  );
  try {
    checkStructure(final.body, type);
  } catch (e) {
    await onStep({
      node: 8,
      status: "running",
      trace: [...trace],
      draftBody: draft.body,
      repair: true,
    });
    final = await node(
      8,
      {
        ...branch,
        context: {
          ...context,
          task_type: type,
          format_error: e.message,
          previous_review: final,
        },
      },
      reviewContract +
        "\n上一份报告格式未通过，请仅修复缺失结构，保留事实边界；资料不足写待确认，不得编造。",
    );
    try {
      checkStructure(final.body, type);
    } catch (last) {
      throw Error("报告格式自动整理后仍未通过，已保留草稿。" + last.message);
    }
  }
  const evidence = checkEvidence(final.evidence, manifest);
  return {
    status: "completed",
    taskType: type,
    title: project.name + "｜" + taskNames[type],
    body: final.body,
    draftBody: draft.body,
    evidence,
    warnings: numericWarnings(final.body, manifest),
    ...meta(),
  };
}
