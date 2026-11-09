import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runWorkflow } from "../lib/workflow.mjs";
import { requiredHeadings } from "../lib/quality.mjs";
import { readPrompt, taskNodes } from "../lib/prompts.mjs";
const route = (intent = "requirement_analysis", patch = {}) => ({
  intent,
  risk_level: "low",
  safe_response_required: false,
  sufficient: true,
  confidence: "high",
  risk_flags: [],
  missing_fields: [],
  clarifying_question: "",
  ...patch,
});
const report = (t) =>
  requiredHeadings[t]
    .map(
      (h, i) =>
        `## ${i + 1}. ${h}\n\n用户提供的资料需要核实，以下为建议与待验证事项。` +
        (t === "prd_draft"
          ? " Given 用户有权限 When 提交 Then 只读返回本人数据。"
          : ""),
    )
    .join("\n\n");
function fixture(r, type) {
  const nodes = [];
  return {
    nodes,
    invoke: async (messages) => {
      const n = [1, 2, 3, 4, 5, 6, 7, 8].find((id) =>
        messages[0].content.startsWith(readPrompt(id, "system")),
      );
      nodes.push(n);
      const result =
        n === 1
          ? r
          : n === 2
            ? {
                body: "不能执行未经授权的业务动作。建议使用授权规则与人工审批，并保留审计证据。",
              }
            : n === 7
              ? {
                  body: "我可以帮你完成需求、方案、PRD或竞品分析，请选择其中一项。",
                }
              : n === 8
                ? {
                    body: report(type),
                    evidence: {
                      facts: ["用户提供的项目"],
                      sources: [],
                      suggestions: ["建议验证"],
                      assumptions: [],
                      risks: [],
                      citations: [{ sourceId: "P1", quote: "零售" }],
                    },
                  }
                : { body: report(type) };
      return {
        result,
        model: "controlled-fixture",
        usage: { total_tokens: 1 },
      };
    },
  };
}
const base = {
  project: { name: "零售", business: "订单查询", users: "消费者" },
  task: "分析订单只读查询",
  sources: "",
};
for (const type of Object.keys(taskNodes))
  test(
    type + " uses distinct complete teacher System/User and review",
    async () => {
      const f = fixture(route(type), type);
      const r = await runWorkflow({ ...base, taskType: type }, undefined, {
        invoke: f.invoke,
      });
      assert.deepEqual(f.nodes, [1, taskNodes[type], 8]);
      assert.equal(r.status, "completed");
      assert.ok(r.draftBody);
      assert.equal(r.trace.length, 3);
      assert.equal(r.retrievalStatus, "not_configured");
    },
  );
test("auto recognition, insufficiency, high risk and unknown route independently", async () => {
  let f = fixture(route("solution_design"), "solution_design");
  assert.equal(
    (
      await runWorkflow({ ...base, taskType: "auto" }, undefined, {
        invoke: f.invoke,
      })
    ).taskType,
    "solution_design",
  );
  f = fixture(
    route("prd_draft", {
      sufficient: false,
      clarifying_question: "谁使用这个功能？",
    }),
    "prd_draft",
  );
  let r = await runWorkflow({ ...base, taskType: "prd_draft" }, undefined, {
    invoke: f.invoke,
  });
  assert.equal(r.status, "needs_input");
  assert.deepEqual(f.nodes, [1]);
  f = fixture(
    route("requirement_analysis", { risk_level: "high", sufficient: false }),
    "requirement_analysis",
  );
  r = await runWorkflow(base, undefined, { invoke: f.invoke });
  assert.equal(r.status, "high_risk");
  assert.deepEqual(f.nodes, [1, 2]);
  f = fixture(route("unknown"), "requirement_analysis");
  assert.equal(
    (
      await runWorkflow({ ...base, taskType: "auto" }, undefined, {
        invoke: f.invoke,
      })
    ).status,
    "guidance",
  );
  assert.deepEqual(f.nodes, [1, 7]);
});
test("empty, failed, forged citations and bad structure never become deliverables", async () => {
  await assert.rejects(
    runWorkflow(base, undefined, {
      invoke: async () => {
        throw Error("上游失败");
      },
    }),
    /上游失败/,
  );
  await assert.rejects(
    runWorkflow(base, undefined, {
      invoke: async () => ({ result: {}, usage: {} }),
    }),
    /意图识别/,
  );
  const f = fixture(route(), "requirement_analysis");
  const invoke = async (...a) => {
    const r = await f.invoke(...a);
    if (f.nodes.at(-1) === 8)
      r.result.evidence.citations = [{ sourceId: "fake", quote: "虚构来源" }];
    return r;
  };
  await assert.rejects(runWorkflow(base, undefined, { invoke }), /引用不在/);
});
test("prompt migration preserves all four original professional System bodies exactly", () => {
  for (const n of [3, 4, 5, 6]) {
    assert.equal(
      readPrompt(n, "system"),
      readFileSync(`prompts/original/${n}-system.md`, "utf8").trimEnd(),
    );
    assert.ok(!readPrompt(n, "user").includes("{{input}}"));
  }
});
test("explicitly prohibiting unsafe actions does not force high-risk response", async () => {
  const f = fixture(route(), "requirement_analysis");
  const r = await runWorkflow(
    { ...base, task: "分析订单查询，必须验证身份，不绕过权限，不要自动退款。" },
    undefined,
    { invoke: f.invoke },
  );
  assert.equal(r.status, "completed");
});
test("invented source names without structured citations fail closed", async () => {
  const f = fixture(route(), "requirement_analysis");
  const invoke = async (...a) => {
    const r = await f.invoke(...a);
    if (f.nodes.at(-1) === 8) {
      r.result.evidence.sources = ["不存在的行业报告"];
      r.result.evidence.citations = [];
    }
    return r;
  };
  await assert.rejects(runWorkflow(base, undefined, { invoke }), /来源/);
});
test("cancelled request cannot call the next professional node", async () => {
  const c = new AbortController();
  const f = fixture(route(), "requirement_analysis");
  const invoke = async (...args) => {
    const r = await f.invoke(...args);
    c.abort();
    return r;
  };
  await assert.rejects(runWorkflow(base, c.signal, { invoke }), /取消/);
  assert.deepEqual(f.nodes, [1]);
});
test("project, clarification and selected history reach review; draft survives review failure", async () => {
  const events = [];
  const f = fixture(route(), "requirement_analysis");
  const invoke = async (...args) => {
    const sys = args[0][0].content;
    if (sys.startsWith(readPrompt(8, "system"))) {
      const user = args[0][1].content;
      assert.ok(user.includes("历史业务线索"));
      assert.ok(user.includes("补充事实"));
      assert.ok(user.includes("not_configured"));
      throw Error("审校失败");
    }
    return f.invoke(...args);
  };
  await assert.rejects(
    runWorkflow(
      {
        ...base,
        clarification: "补充事实",
        history: [{ id: "h1", title: "历史版本", body: "历史业务线索" }],
      },
      undefined,
      { invoke, onStep: (e) => events.push(e) },
    ),
    /审校失败/,
  );
  assert.ok(events.some((e) => typeof e.draftBody === "string"));
});

test("local knowledge reaches professional and review nodes with actual excerpt IDs", async () => {
  const f = fixture(route(), "requirement_analysis");
  const seen = [];
  const invoke = async (messages, ...rest) => {
    seen.push(messages[1].content);
    return f.invoke(messages, ...rest);
  };
  const r = await runWorkflow(
    {
      ...base,
      project: {
        ...base.project,
        knowledge: [
          {
            id: "manual",
            title: "订单规则",
            text: "订单查询异常必须转人工，不承诺人工响应时间。",
          },
          { id: "unrelated", title: "天气", text: "晴天适合出门。" },
        ],
      },
    },
    undefined,
    { invoke },
  );
  assert.equal(r.retrievalStatus, "matched");
  assert.ok(r.evidenceManifest.some((x) => x.id === "Kmanual_0"));
  assert.ok(!r.evidenceManifest.some((x) => x.id.startsWith("Kunrelated")));
  assert.ok(seen.every((x) => x.includes("订单查询异常必须转人工")));
  assert.ok(seen.every((x) => !x.includes("晴天适合出门")));
});

test("an incomplete professional draft reaches final review for repair instead of demanding user business input", async () => {
  const f = fixture(route("solution_design"), "solution_design");
  const r = await runWorkflow(
    { ...base, taskType: "solution_design" },
    undefined,
    {
      invoke: async (...a) => {
        const out = await f.invoke(...a);
        if (f.nodes.at(-1) === 4)
          out.result.body =
            "## 初步业务方案\n" +
            "这是根据用户资料形成的待评审方案，仍需最终整理。".repeat(8);
        return out;
      },
    },
  );
  assert.equal(r.status, "completed");
  assert.deepEqual(f.nodes, [1, 4, 8]);
  assert.match(r.body, /方案结论/);
});
test("final review format repair is bounded to one extra review and still fails closed", async () => {
  for (const recover of [true, false]) {
    const f = fixture(route(), "requirement_analysis");
    let reviews = 0;
    const invoke = async (...a) => {
      const out = await f.invoke(...a);
      if (f.nodes.at(-1) === 8 && (!recover || ++reviews === 1))
        out.result.body =
          "## 未整理的报告\n" + "需要按专业标题整理，事实保持不变。".repeat(10);
      return out;
    };
    if (recover)
      assert.equal(
        (await runWorkflow(base, undefined, { invoke })).status,
        "completed",
      );
    else
      await assert.rejects(
        runWorkflow(base, undefined, { invoke }),
        /自动整理后仍未通过/,
      );
    assert.deepEqual(f.nodes, [1, 3, 8, 8]);
  }
});
