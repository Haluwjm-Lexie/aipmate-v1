import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { retrieveKnowledge, validateKnowledge } from "../lib/knowledge.mjs";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "pmate-knowledge-"));
const { store } = await import("../lib/store.mjs");
const { handle } = await import("../lib/api.mjs");
const request = (
  path,
  method = "GET",
  body,
  origin = "http://127.0.0.1:3020",
) =>
  handle(
    new Request("http://127.0.0.1:3020/api/" + path, {
      method,
      headers: { host: "127.0.0.1:3020", origin },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
test("password-free local API still rejects foreign origins", async () => {
  process.env.APP_PASSWORD = "obsolete-existing-value";
  assert.equal(
    (await request("session").then((r) => r.json())).authenticated,
    true,
  );
  assert.equal((await request("projects")).status, 200);
  assert.equal(
    (await request("projects", "POST", { name: "forged" }, "http://other.test"))
      .status,
    403,
  );
  const s = await request("settings").then((r) => r.json());
  assert.equal(s.capabilities.webSearch, false);
  assert.equal(s.protected, false);
});
test("project knowledge is isolated, retrieved verbatim and preserved on backup/restore", async () => {
  const a = store.createProject({ name: "资料项目" }),
    b = store.createProject({ name: "其他项目" });
  const item = store.addKnowledge(a.id, {
    title: "订单规则",
    text: "订单查询只允许本人读取。失败时转人工。",
  });
  assert.equal(store.listKnowledge(b.id).length, 0);
  const found = retrieveKnowledge(store.listKnowledge(a.id), "订单查询权限");
  assert.equal(found.length, 1);
  assert.equal(found[0].text, item.text);
  assert.ok(found[0].id.startsWith("K"));
  assert.equal(
    retrieveKnowledge(store.listKnowledge(a.id), "天气预报").length,
    0,
  );
  assert.throws(() =>
    validateKnowledge([{ ...item, text: "x".repeat(50001) }]),
  );
  const backup = store.exportBackup();
  store.restoreBackup(backup);
  assert.equal(
    store.listProjects().find((x) => x.name === "资料项目（导入）").knowledge[0]
      .text,
    item.text,
  );
  const r = await request(
    `projects/${b.id}/knowledge/${item.id}`,
    "DELETE",
    {},
  );
  assert.notEqual(r.status, 200);
  store.updateProject(a.id, { name: "新名称", stage: "PRD 草稿" });
  assert.equal(store.listKnowledge(a.id).length, 1);
  store.deleteKnowledge(a.id, item.id);
  assert.equal(store.listKnowledge(a.id).length, 0);
});
test("deleting a task preserves documents and rejects running or cross-project tasks", async () => {
  const a = store.createProject({ name: "任务项目" }),
    b = store.createProject({ name: "隔离" });
  const d = store.addDocument(a.id, {
    title: "保留",
    task: "分析",
    body: "# 文档",
  });
  const r = store.createRun(a.id, {
    task: "分析",
    status: "completed",
    documentId: d.id,
  });
  assert.throws(() => store.deleteRun(b.id, r.id));
  assert.equal(
    (await request(`projects/${a.id}/runs/${r.id}`, "DELETE", {})).status,
    200,
  );
  assert.equal(store.listRuns(a.id).length, 0);
  assert.equal(store.getDocument(a.id, d.id).body, "# 文档");
  const active = store.createRun(a.id, { task: "进行中", status: "running" });
  assert.equal(
    (await request(`projects/${a.id}/runs/${active.id}`, "DELETE", {})).status,
    409,
  );
});

test("DELETE accepts an empty streamed body as browsers and production Next can send", async () => {
  const p = store.createProject({ name: "空请求体删除" });
  const item = store.addKnowledge(p.id, {
    title: "资料.md",
    text: "用户提供的测试资料。",
  });
  const r = await handle(
    new Request(
      `http://127.0.0.1:3020/api/projects/${p.id}/knowledge/${item.id}`,
      {
        method: "DELETE",
        headers: { host: "127.0.0.1:3020", origin: "http://127.0.0.1:3020" },
        body: "",
      },
    ),
  );
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).knowledge, []);
});
