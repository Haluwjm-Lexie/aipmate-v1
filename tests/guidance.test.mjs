import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildUserPrompt,
  nextTask,
  upstreamDocs,
  slotFields,
} from "../lib/guidance.mjs";
test("three-stage handoff references correct real upstream versions and ends at PRD", () => {
  const docs = [
    { id: "demo", taskType: "solution_design", demo: true },
    { id: "s2", taskType: "solution_design" },
    { id: "r2", taskType: "requirement_analysis" },
    { id: "r1", taskType: "requirement_analysis" },
  ];
  assert.equal(nextTask("requirement_analysis"), "solution_design");
  assert.equal(nextTask("solution_design"), "prd_draft");
  assert.equal(nextTask("prd_draft"), null);
  assert.deepEqual(
    upstreamDocs(docs, "prd_draft").map((d) => d.id),
    ["s2", "r2"],
  );
  assert.deepEqual(
    upstreamDocs(docs, "solution_design").map((d) => d.id),
    ["r2"],
  );
});
test("slot prompts answer the selected professional task and mark missing input as unconfirmed", () => {
  assert.equal(Object.keys(slotFields).length, 5);
  const text = buildUserPrompt(
    "solution_design",
    { features: "高亮和手绘", constraints: "只在本人浏览器保存" },
    { name: "网页批注" },
    ["r1"],
  );
  assert.match(text, /AI方案设计/);
  assert.match(text, /高亮和手绘/);
  assert.match(text, /本人浏览器/);
  assert.match(text, /上一阶段/);
  assert.match(text, /待确认/);
  assert.doesNotMatch(text, /100%|保证/);
});
