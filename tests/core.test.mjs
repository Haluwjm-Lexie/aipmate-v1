import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "aipm-"));
const { store } = await import("../lib/store.mjs");
const { issueSession, verifySession, validOrigin } =
  await import("../lib/security.mjs");
test("reloading the store preserves jobs owned by the live worker", async () => {
  const project = store.createProject({ name: "运行中任务" });
  const run = store.createRun(project.id, {
    status: "running",
    workerPid: process.pid,
  });
  const { store: reloaded } = await import("../lib/store.mjs?reload");
  assert.equal(reloaded.listRuns(project.id).find((item) => item.id === run.id).status, "running");
});
test("projects isolate documents; manual edits append versions", () => {
  const a = store.createProject({ name: "项目A" }),
    b = store.createProject({ name: "项目B" });
  const d = store.addDocument(a.id, {
    title: "需求分析",
    body: "# v1",
    task: "任务",
    evidence: {},
  });
  store.reviseDocument(a.id, d.id, "# v2");
  assert.equal(store.listDocuments(a.id).length, 2);
  assert.equal(store.listDocuments(b.id).length, 0);
  assert.throws(() => store.reviseDocument(b.id, d.id, "越权"));
  assert.equal(store.getDocument(a.id, d.id).body, "# v1");
  store.deleteProject(a.id);
  assert.equal(store.listDocuments(a.id).length, 0);
});
test("backup validates before transaction and imports as copies", () => {
  const backup = store.exportBackup();
  const before = store.listProjects().length;
  assert.throws(() =>
    store.restoreBackup({ format: "aipm-v1", projects: [{ name: 3 }] }),
  );
  assert.equal(store.listProjects().length, before);
  store.restoreBackup(backup);
  assert.equal(store.listProjects().length, before * 2);
});
test("session tamper and expiry rejected; same origin required", () => {
  const token = issueSession("secret", 1000);
  assert.equal(verifySession(token, "secret", 1001), true);
  assert.equal(verifySession(token + "x", "secret", 1001), false);
  assert.equal(verifySession(token, "different", 1001), false);
  assert.equal(verifySession(token, "secret", 1000 + 9 * 3600 * 1000), false);
  assert.equal(validOrigin("https://evil.example", "workspace.example"), false);
  assert.equal(
    validOrigin("https://workspace.example", "workspace.example"),
    true,
  );
});
test("backup rejects object values that would break document rendering", () => {
  const valid = store.exportBackup();
  const sample = valid.projects.find((p) => p.documents.length);
  assert.ok(sample);
  const broken = structuredClone(valid);
  broken.projects.find((p) => p.documents.length).documents[0].snapshot = {
    name: { unsafe: "object" },
  };
  assert.throws(() => store.restoreBackup(broken));
  const wrong = structuredClone(valid);
  wrong.projects.find((p) => p.documents.length).documents[0].evidence = {
    facts: [{ unsafe: "object" }],
  };
  assert.throws(() => store.restoreBackup(wrong));
});
test("export and restore retain follow-up answers and document provenance", () => {
  const p = store.createProject({ name: "追问项目" });
  store.addDocument(p.id, {
    title: "需求分析",
    body: "# 分析正文",
    task: "分析任务",
    clarification: "已确认用户为客服坐席",
    evidence: {
      facts: [],
      sources: [],
      suggestions: [],
      assumptions: [],
      risks: [],
    },
    model: "test-model",
    warnings: ["待核实"],
    usage: { total_tokens: 123 },
    elapsed: 1000,
  });
  const backup = {
    ...store.exportBackup(),
    projects: store.exportBackup().projects.filter((x) => x.id === p.id),
  };
  store.restoreBackup(backup);
  const imported = store
    .listProjects()
    .find((x) => x.name === "追问项目（导入）");
  const d = store.listDocuments(imported.id)[0];
  assert.equal(d.clarification, "已确认用户为客服坐席");
  assert.equal(d.model, "test-model");
  assert.equal(d.usage.total_tokens, 123);
  assert.deepEqual(d.warnings, ["待核实"]);
  const invalid = structuredClone(backup);
  invalid.projects[0].documents[0].clarification = { wrong: true };
  assert.throws(() => store.restoreBackup(invalid));
});
test("backup preserves workflow prompt version, draft and call traces", () => {
  const p = store.createProject({ name: "工作流元数据" });
  store.addDocument(p.id, {
    title: "报告",
    body: "# 审校稿",
    draftBody: "# 原专业稿",
    task: "任务",
    taskType: "prd_draft",
    promptVersion: "teacher-v2.0",
    trace: [{ node: 1, status: "completed", elapsed: 5 }],
    retrievalStatus: "not_performed",
    evidence: {},
  });
  const data = store.exportBackup();
  store.restoreBackup({
    ...data,
    projects: data.projects.filter((x) => x.id === p.id),
  });
  const copy = store
    .listProjects()
    .find((p) => p.name === "工作流元数据（导入）");
  const d = store.listDocuments(copy.id)[0];
  assert.equal(d.promptVersion, "teacher-v2.0");
  assert.equal(d.draftBody, "# 原专业稿");
  assert.equal(d.trace[0].node, 1);
});
