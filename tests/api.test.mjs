import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requiredHeadings } from "../lib/quality.mjs";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "aipm-api-"));
process.env.NODE_ENV = "production";
process.env.APP_PASSWORD = "test-only-pass";
const { handle } = await import("../lib/api.mjs");
let cookie = "";
async function req(path, method = "GET", body, origin = "https://app.test") {
  const r = await handle(
    new Request("https://app.test/api/" + path, {
      method,
      headers: { host: "app.test", origin, cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return {
    status: r.status,
    data: await r.json(),
    cookie: r.headers.get("set-cookie"),
  };
}
const response = (result) =>
  Response.json({
    id: "controlled-response",
    choices: [
      { finish_reason: "stop", message: { content: JSON.stringify(result) } },
    ],
    usage: { total_tokens: 2 },
  });
test("upgraded API preserves projects and versions; rejects failures without demo substitution", async () => {
  assert.equal((await req("projects")).status, 200);
  assert.equal((await req("session")).data.authenticated, true);
  assert.equal(
    (await req("projects", "POST", { name: "错误来源" }, "https://evil.test"))
      .status,
    403,
  );
  const p = (
    await req("projects", "POST", { name: "真实测试项目", users: "消费者" })
  ).data;
  const q = (await req("projects", "POST", { name: "另一个项目" })).data;
  assert.equal(
    (await req(`projects/${p.id}/generate`, "POST", { task: "" })).status,
    400,
  );
  assert.equal(
    (await req(`projects/${p.id}/generate`, "POST", { task: "无密钥" })).status,
    502,
  );
  process.env.DEEPSEEK_API_KEY = "test-only-key";
  process.env.DEEPSEEK_MODEL = "test-model";
  const original = globalThis.fetch;
  let mode = "completed";
  const doc = requiredHeadings.requirement_analysis
    .map((h) => "## " + h + "\n\n依据用户资料提出分析建议与待验证事项。")
    .join("\n\n");
  try {
    globalThis.fetch = async (_url, options) => {
      const sys = JSON.parse(options.body).messages[0].content;
      if (mode === "failure") return new Response("", { status: 401 });
      if (mode === "empty") return response({});
      if (sys.includes("任务路由器"))
        return response({
          intent: "requirement_analysis",
          risk_level: mode === "risk" ? "high" : "low",
          safe_response_required: mode === "risk",
          sufficient: mode !== "question",
          confidence: "high",
          risk_flags: [],
          missing_fields: [],
          clarifying_question: mode === "question" ? "目标用户是谁？" : "",
        });
      if (sys.startsWith("你负责生成高风险"))
        return response({
          body: "不能执行未经授权的操作。建议由人工审批并明确授权规则，记录审计证据。",
        });
      return response({
        body: doc,
        evidence: {
          facts: [],
          sources: [],
          suggestions: [],
          assumptions: [],
          risks: [],
          citations: [],
        },
      });
    };
    mode = "question";
    const ask = await req(`projects/${p.id}/generate`, "POST", {
      task: "分析业务",
    });
    assert.equal(ask.data.status, "completed");
    mode = "risk";
    assert.equal(
      (await req(`projects/${p.id}/generate`, "POST", { task: "业务请求" }))
        .data.status,
      "high_risk",
    );
    assert.equal((await req(`projects/${p.id}/documents`)).data.length, 1);
    mode = "completed";
    const done = await req(`projects/${p.id}/generate`, "POST", {
      task: "分析订单查询",
      taskType: "requirement_analysis",
      clarification: "消费者",
    });
    assert.equal(done.status, 200);
    assert.equal(done.data.document.trace.length, 3);
    assert.equal(done.data.document.taskType, "requirement_analysis");
    const id = done.data.document.id;
    assert.equal((await req(`projects/${q.id}/generate`,'POST',{task:'引用另一个项目',historyIds:[id]})).status,400);
    assert.equal(
      (await req(`projects/${q.id}/documents/${id}`, "PUT", { body: "越权" }))
        .status,
      404,
    );
    assert.equal(
      (
        await req(`projects/${p.id}/documents/${id}`, "PUT", {
          body: "# 人工编辑正文",
        })
      ).data.version,
      3,
    );
    mode = "failure";
    assert.equal(
      (await req(`projects/${p.id}/generate`, "POST", { task: "失败测试" }))
        .status,
      502,
    );
    mode = "empty";
    assert.equal(
      (await req(`projects/${p.id}/generate`, "POST", { task: "空结果测试" }))
        .status,
      502,
    );
    assert.equal((await req(`projects/${p.id}/documents`)).data.length, 3);
    mode = "completed";
    await req(`projects/${p.id}/generate`, "POST", { task: "再次生成" });
    assert.equal((await req(`projects/${p.id}/documents`)).data.length, 4);
    const backup = (await req("backup")).data;
    assert.ok(!JSON.stringify(backup).includes("test-only-key"));
    assert.equal((await req("restore", "POST", backup)).status, 200);
  } finally {
    globalThis.fetch = original;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_MODEL;
  }
});
