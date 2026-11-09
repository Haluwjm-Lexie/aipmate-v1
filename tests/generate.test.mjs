import { test } from "node:test";
import assert from "node:assert/strict";
import { validateResult, generateAnalysis } from "../lib/legacy-generate.mjs";
test("empty and malformed generated content cannot become deliverable", () => {
  assert.throws(() => validateResult({ status: "completed", body: "" }));
  assert.throws(() =>
    validateResult({
      status: "completed",
      body: "x".repeat(100),
      evidence: { facts: "invented" },
    }),
  );
  assert.throws(() =>
    validateResult({ status: "anything", body: "x".repeat(100) }),
  );
  assert.equal(
    validateResult({ status: "needs_input", questions: ["目标用户是谁？"] })
      .questions.length,
    1,
  );
});
test("valid analysis preserves explicitly separated evidence", () => {
  const r = validateResult({
    status: "completed",
    title: "需求分析",
    body: "# 需求分析\n" + "业务分析。".repeat(50),
    evidence: {
      facts: ["用户提供：测试项目"],
      sources: [],
      suggestions: ["先验证需求"],
      assumptions: [],
      risks: [],
    },
  });
  assert.equal(r.status, "completed");
  assert.equal(r.evidence.sources.length, 0);
});
test("missing key fails in Chinese instead of demo fallback", async () => {
  const old = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    await assert.rejects(
      generateAnalysis({ project: { name: "测试" }, task: "测试" }),
      /API 密钥/,
    );
  } finally {
    if (old) process.env.DEEPSEEK_API_KEY = old;
  }
});
test("each analysis sends current task to upstream; different tasks are not replaced with canned demo", async () => {
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.DEEPSEEK_API_KEY;
  const oldModel = process.env.DEEPSEEK_MODEL;
  process.env.DEEPSEEK_API_KEY = "test-key";
  process.env.DEEPSEEK_MODEL = "test-model";
  let calls = 0;
  globalThis.fetch = async (_url, opts) => {
    calls++;
    const payload = JSON.parse(opts.body);
    const input = JSON.parse(
      payload.messages[1].content.split("\n").slice(1).join("\n"),
    );
    return Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              status: "completed",
              title: input.task,
              body: "# " + input.task + "\n" + "具体业务分析".repeat(30),
              evidence: {
                facts: [],
                sources: [],
                suggestions: [],
                assumptions: [],
                risks: [],
              },
            }),
          },
        },
      ],
    });
  };
  try {
    const first = await generateAnalysis({
      project: { name: "产品" },
      task: "分析售后",
    });
    const second = await generateAnalysis({
      project: { name: "产品" },
      task: "分析订单",
    });
    assert.equal(calls, 2);
    assert.notEqual(first.body, second.body);
    assert.equal(second.title, "分析订单");
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey) process.env.DEEPSEEK_API_KEY = oldKey;
    else delete process.env.DEEPSEEK_API_KEY;
    if (oldModel) process.env.DEEPSEEK_MODEL = oldModel;
    else delete process.env.DEEPSEEK_MODEL;
  }
});
test("upstream HTTP status and response-body timeouts have useful Chinese errors", async () => {
  const { callModel } = await import("../lib/legacy-generate.mjs");
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.DEEPSEEK_API_KEY;
  const oldModel = process.env.DEEPSEEK_MODEL;
  process.env.DEEPSEEK_API_KEY = "test-key";
  process.env.DEEPSEEK_MODEL = "test-model";
  try {
    globalThis.fetch = async () => new Response("", { status: 400 });
    await assert.rejects(callModel([]), /HTTP 400/);
    globalThis.fetch = async () => ({
      ok: true,
      text: async () => {
        throw new DOMException("timeout", "TimeoutError");
      },
    });
    await assert.rejects(callModel([]), /等待模型超过/);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey) process.env.DEEPSEEK_API_KEY = oldKey;
    else delete process.env.DEEPSEEK_API_KEY;
    if (oldModel) process.env.DEEPSEEK_MODEL = oldModel;
    else delete process.env.DEEPSEEK_MODEL;
  }
});
