import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requiredHeadings } from "../lib/quality.mjs";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "pmate-bg-"));
process.env.DEEPSEEK_API_KEY = "controlled-only-key";
process.env.DEEPSEEK_MODEL = "controlled-model";
const { handle } = await import("../lib/api.mjs");
const { store } = await import("../lib/store.mjs");
const req = async (path, method = "GET", body, signal) => {
  const r = await handle(
    new Request("http://127.0.0.1:3020/api/" + path, {
      method,
      headers: { host: "127.0.0.1:3020", origin: "http://127.0.0.1:3020" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    }),
  );
  return { status: r.status, data: await r.json() };
};
const modelResponse = (result) =>
  Response.json({
    choices: [
      { finish_reason: "stop", message: { content: JSON.stringify(result) } },
    ],
    usage: { total_tokens: 1 },
  });
test("two project jobs continue after initiating request aborts; duplicate and third jobs are rejected", async () => {
  const original = globalThis.fetch;
  let release;
  const gate = new Promise((r) => (release = r));
  const document = requiredHeadings.requirement_analysis
    .map((h) => "## " + h + "\n依据用户提供的资料提出建议，缺失信息等待验证。")
    .join("\n");
  globalThis.fetch = async (_url, options) => {
    await gate;
    if (options.signal.aborted) throw Error("aborted");
    const sys = JSON.parse(options.body).messages[0].content;
    if (sys.includes("任务路由器"))
      return modelResponse({
        intent: "requirement_analysis",
        risk_level: "low",
        safe_response_required: false,
        sufficient: true,
        confidence: "high",
        risk_flags: [],
        missing_fields: [],
        clarifying_question: "",
      });
    return modelResponse({
      body: document,
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
  const a = store.createProject({ name: "后台A" }),
    b = store.createProject({ name: "后台B" }),
    c = store.createProject({ name: "后台C" });
  const abort = new AbortController();
  try {
    assert.equal(
      (
        await req(
          `projects/${a.id}/jobs`,
          "POST",
          { task: "分析问题" },
          abort.signal,
        )
      ).status,
      202,
    );
    abort.abort();
    assert.equal(
      (await req(`projects/${a.id}/jobs`, "POST", { task: "重复" })).status,
      409,
    );
    assert.equal(
      (await req(`projects/${b.id}/jobs`, "POST", { task: "另一个项目" }))
        .status,
      202,
    );
    assert.equal(
      (await req(`projects/${c.id}/jobs`, "POST", { task: "第三个" })).status,
      409,
    );
    assert.equal(
      (await req("activity")).data.filter((x) => x.run?.status === "running")
        .length,
      2,
    );
    release();
    for (
      let i = 0;
      i < 100 &&
      [a, b].some((p) => store.listRuns(p.id)[0].status === "running");
      i++
    )
      await new Promise((r) => setTimeout(r, 5));
    for (const p of [a, b]) {
      assert.equal(store.listRuns(p.id)[0].status, "completed");
      assert.equal(store.listDocuments(p.id).length, 1);
    }
  } finally {
    release();
    globalThis.fetch = original;
  }
});
