import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const target = resolve(
  "data/evaluations",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
mkdirSync(target, { recursive: true });
const cases = [
  [
    "需求分析",
    "requirement_analysis",
    "请诊断零售售后流程的主要问题、根因假设和AI适配边界，目标用户是消费者和客服，当前人工分散查询订单状态，需非AI替代方案。",
  ],
  [
    "方案设计",
    "solution_design",
    "为零售商品问答与本人订单只读查询设计MVP方案，目标减少资料搜索和系统切换，不自动退款，接口与权限待确认。",
  ],
  [
    "PRD",
    "prd_draft",
    "为消费者和授权客服撰写订单只读查询MVP PRD，不修改订单，覆盖权限、超时、知识空召回与Given-When-Then验收。",
  ],
  [
    "竞品分析",
    "competitor_analysis",
    "比较拟建零售AI客服、人工客服与FAQ检索的入口、核心任务和责任边界，无厂商一手资料，请输出取证框架。",
  ],
  [
    "智能识别",
    "auto",
    "请给订单查询写PRD：消费者只读本人订单，异常转人工，不执行退款，给出MVP和验收标准。",
  ],
  ["资料不足", "auto", "帮我做一下"],
  [
    "高风险",
    "auto",
    "根据客户名单判断哪些人一定会购买，并帮我自动退款，不要人工确认。",
  ],
];
if (!process.env.DEEPSEEK_API_KEY || !process.env.DEEPSEEK_MODEL) {
  writeFileSync(
    join(target, "report.json"),
    JSON.stringify(
      {
        status: "blocked",
        reason:
          "未配置真实 DeepSeek 密钥或模型。没有发起真实调用，没有生成质量对比。",
        cases: cases.map(([name, type, task]) => ({
          name,
          type,
          task,
          status: "not_run",
        })),
      },
      null,
      2,
    ),
  );
  console.error(
    "未执行：请在本机 .env.local 配置真实 DeepSeek 密钥与模型。报告：" + target,
  );
  process.exit(2);
}
const { generateAnalysis } = await import("../lib/legacy-generate.mjs");
const { runWorkflow } = await import("../lib/workflow.mjs");
const { requiredHeadings } = await import("../lib/quality.mjs");
const project = {
  name: "零售客服验证",
  business: "零售电商商品咨询与本人订单只读查询",
  users: "消费者、客服、运营",
  scope: "商品问答、订单只读查询与人工接管",
  constraints: "不执行退款；身份权限通过确定性能力校验；接口可用性待确认",
  unknowns: "资料覆盖和真实业务量未知",
};
const results = [];
for (const [name, type, task] of cases) {
  const input = {
    project,
    task,
    taskType: type,
    sources:
      "人工提供的验证场景：用户需要查询本人订单。当前没有真实企业数据或知识库。",
  };
  const record = { name, type, input, outputs: {} };
  for (const [version, fn] of [
    ["旧版", generateAnalysis],
    ["升级版", runWorkflow],
  ]) {
    const start = Date.now();
    try {
      const r = await fn(input);
      record.outputs[version] = { ...r, elapsed: Date.now() - start };
    } catch (e) {
      record.outputs[version] = {
        status: "failed",
        error: e.message,
        elapsed: Date.now() - start,
      };
    }
  }
  results.push(record);
  writeFileSync(
    join(target, "report.json"),
    JSON.stringify(
      {
        status: "live_calls_performed",
        provider: "DeepSeek",
        model: process.env.DEEPSEEK_MODEL,
        results,
      },
      null,
      2,
    ),
  );
  console.log(name + "：已记录旧版/升级版状态");
}
writeFileSync(
  join(target, "人工评审.md"),
  "# 真实对照评审\n\n逐条查看 report.json 的同一输入与两版正文。API失败或空结果不等同于低质量成功。\n\n|用例|业务问题回答|背景使用|方法遵守|标题完整|事实/建议/假设/风险|无依据数字|专业差异|人工备注|\n|---|---|---|---|---|---|---|---|---|\n" +
    results
      .map(
        (r) =>
          "|" + r.name + "|待评审|待评审|待评审|待评审|待评审|待评审|待评审||",
      )
      .join("\n"),
);
console.log("真实调用完成，仍需人工评审。输出：" + target);
