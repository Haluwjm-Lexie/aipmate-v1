import { test } from "node:test";
import assert from "node:assert/strict";
import { taskKey, taskRecords } from "../lib/task-view.mjs";
test("switching tasks separates draft keys and document lists, including legacy documents", () => {
  assert.notEqual(
    taskKey("a", "prd_draft"),
    taskKey("a", "requirement_analysis"),
  );
  assert.notEqual(taskKey("a", "prd_draft"), taskKey("b", "prd_draft"));
  const docs = [
    { id: "p", taskType: "prd_draft" },
    { id: "r", taskType: "requirement_analysis" },
    { id: "old" },
  ];
  const runs = [
    { id: "failed", taskType: "prd_draft", status: "failed" },
    {
      id: "ok",
      taskType: "requirement_analysis",
      status: "completed",
      documentId: "r",
    },
  ];
  const prd = taskRecords(docs, runs, "prd_draft");
  assert.deepEqual(
    prd.docs.map((x) => x.id),
    ["p"],
  );
  assert.equal(prd.documentId, "");
  const demand = taskRecords(docs, runs, "requirement_analysis");
  assert.deepEqual(
    demand.docs.map((x) => x.id),
    ["r", "old"],
  );
  assert.equal(demand.documentId, "r");
  assert.equal(taskRecords(docs, runs, "competitor_analysis").docs.length, 0);
  assert.equal(taskRecords(docs, runs, "auto").docs.length, 3);
});

test("reloading a project uses active task records even when another task completed more recently", () => {
  const docs = [
    { id: "new-prd", taskType: "prd_draft" },
    { id: "demand", taskType: "requirement_analysis" },
  ];
  const runs = [
    { taskType: "prd_draft", status: "completed", documentId: "new-prd" },
    {
      taskType: "requirement_analysis",
      status: "completed",
      documentId: "demand",
    },
  ];
  assert.equal(
    taskRecords(docs, runs, "requirement_analysis").documentId,
    "demand",
  );
  assert.equal(
    taskRecords(docs, runs, "requirement_analysis", "new-prd").documentId,
    "demand",
  );
  assert.equal(
    taskRecords(docs, runs, "requirement_analysis", "").documentId,
    "",
  );
});
