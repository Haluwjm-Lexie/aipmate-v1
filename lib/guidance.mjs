export const slotFields = {
  auto: [
    ["idea", "我想做什么"],
    ["users", "给谁使用"],
    ["problem", "想解决什么问题"],
  ],
  requirement_analysis: [
    ["users", "谁遇到问题"],
    ["scenario", "在什么场景"],
    ["problem", "具体遇到什么问题"],
    ["current", "现在怎么处理"],
    ["goal", "希望改善什么"],
    ["constraints", "限制或暂时不做什么"],
  ],
  solution_design: [
    ["features", "第一版要实现哪些功能"],
    ["resources", "已有资料、系统或接口"],
    ["constraints", "预算、时间与操作限制"],
    ["human", "哪些情况交给人工"],
    ["validation", "准备怎样验证可用"],
  ],
  prd_draft: [
    ["features", "确定开发哪些功能"],
    ["flow", "用户怎样开始、操作和结束"],
    ["permissions", "身份、权限和数据限制"],
    ["exceptions", "失败或异常怎么处理"],
    ["acceptance", "怎样判断开发完成"],
  ],
  competitor_analysis: [
    ["products", "比较哪些产品或替代做法"],
    ["users", "面向哪些用户"],
    ["dimensions", "最关心哪些差异"],
    ["evidence", "有哪些资料，哪些尚未查证"],
  ],
};
export const nextTask = (type) =>
  ({ requirement_analysis: "solution_design", solution_design: "prd_draft" })[
    type
  ] || null;
export const stageGuidance = {
  auto: "描述你的想法即可。助理会判断适合先分析需求、设计方案、写PRD，还是比较产品。",
  requirement_analysis:
    "当你能说清目标用户、核心问题、第一版做什么和不做什么，就可以带着需求分析进入AI方案设计。",
  solution_design:
    "先带入需求分析。看完方案，确认功能范围、AI/程序/人工分工和失败处理，再进入PRD草稿。不确定的内容保留为待确认。",
  prd_draft:
    "带入需求分析和已选方案，补充操作流程、权限、异常和验收要求。PRD生成后先评审，再交给开发或Vibe Coding工具。",
  competitor_analysis:
    "任何阶段都可以做。提供想比较的产品与资料；没有证据的地方只能作为待查证线索。",
};
export function buildUserPrompt(
  type,
  values = {},
  project = {},
  references = [],
) {
  const titles = {
    auto: "判断下一步工作",
    requirement_analysis: "需求分析",
    solution_design: "AI方案设计",
    prd_draft: "PRD草稿",
    competitor_analysis: "竞品分析",
  };
  const lines = (slotFields[type] || slotFields.auto).map(
    ([key, label]) =>
      `${label}：${String(values[key] || "").trim() || "待确认，请列为开放问题，不要编造"}`,
  );
  return [
    `请为「${project.name || "当前项目"}」完成${titles[type] || titles.auto}。`,
    references.length
      ? "请参考已勾选的上一阶段文档，保留已确定的业务边界；其中的假设仍需验证。"
      : "请结合当前项目背景和实际提供的资料分析。",
    ...lines,
    "请按本任务的完整专业方法输出。区分用户提供的信息、建议、假设与风险；不要编造数字或企业事实。只有无法继续的关键信息缺失时才追问，其他缺口集中列为待确认。",
  ].join("\n\n");
}
export function upstreamDocs(documents, type) {
  const wanted =
    type === "solution_design"
      ? ["requirement_analysis"]
      : type === "prd_draft"
        ? ["solution_design", "requirement_analysis"]
        : [];
  return wanted
    .map((t) =>
      documents.find(
        (d) => !d.demo && (d.taskType || "requirement_analysis") === t,
      ),
    )
    .filter(Boolean);
}
