import { store } from "./store.mjs";
import { validOrigin } from "./security.mjs";
import { callModel } from "./generate.mjs";
import { runWorkflow } from "./workflow.mjs";
import { demoProject, demoDoc } from "./demo.mjs";
import { randomUUID } from "node:crypto";
const running = new Map(),
  attempts = new Map();
function limited(key, count, windowMs = 60000) {
  const now = Date.now();
  if (attempts.size > 2000) {
    for (const [k, v] of attempts) if (now > v.until) attempts.delete(k);
    if (attempts.size > 2000) return true;
  }
  const v = attempts.get(key);
  if (!v || now > v.until) {
    attempts.set(key, { n: 1, until: now + windowMs });
    return false;
  }
  return ++v.n > count;
}
function json(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}
async function input(req) {
  const reader = req.body?.getReader();
  if (!reader) return {};
  let total = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 2000000) {
      await reader.cancel();
      throw Error("输入超过 2 MB，请缩小资料");
    }
    chunks.push(value);
  }
  if (total === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Error("请求格式错误");
  }
}
const text = (x, name, max) => {
  if (typeof x !== "string" || x.length > max)
    throw Error(name + "格式错误或过长");
  return x.trim();
};
export async function handle(req) {
  const pathname = new URL(req.url).pathname;
  const p = pathname.split("/").filter(Boolean).slice(1);
  const method = req.method;
  let body;
  try {
    if (
      method !== "GET" &&
      !validOrigin(req.headers.get("origin"), req.headers.get("host"))
    )
      return json({ error: "请求来源无效，请刷新页面后重试" }, 403);
    if (p[0] === "session")
      return json({ authenticated: true, configured: true });
    if (method !== "GET") body = await input(req);
    if (p[0] === "settings") {
      if (method === "GET")
        return json({
          hasKey: !!process.env.DEEPSEEK_API_KEY,
          hasModel: !!process.env.DEEPSEEK_MODEL,
          model: process.env.DEEPSEEK_MODEL || "",
          protected: false,
          capabilities: { webSearch: false, knowledge: true },
        });
      if (method === "POST") {
        if (limited("test", 5))
          return json({ error: "连接测试过于频繁，请稍后再试" }, 429);
        await callModel(
          [
            { role: "system", content: '只输出 JSON：{"ok":true}' },
            { role: "user", content: "测试连接" },
          ],
          req.signal,
          64,
        );
        return json({ ok: true });
      }
    }
    // Online demo mode: project data lives in the visitor's browser, not in
    // Vercel's ephemeral filesystem.  This endpoint only performs the model
    // call; the browser receives the completed document and saves it locally.
    if (p[0] === "client-generate" && method === "POST") {
      const project = body?.project;
      if (!project || typeof project !== "object" || typeof project.name !== "string")
        return json({ error: "项目数据无效，请刷新后重试" }, 400);
      const task = text(body.task, "任务", 20000);
      const sources = text(body.sources || "", "参考资料", 50000);
      const clarification = text(body.clarification || "", "补充信息", 10000);
      if (!task) return json({ error: "请先描述当前业务任务" }, 400);
      const taskType = body.taskType || "requirement_analysis";
      if (!["auto", "requirement_analysis", "solution_design", "prd_draft", "competitor_analysis"].includes(taskType))
        return json({ error: "任务类型无效" }, 400);
      const history = Array.isArray(body.history) ? body.history.slice(0, 3) : [];
      const result = await runWorkflow(
        {
          project,
          task,
          sources,
          clarification,
          previousQuestions: Array.isArray(body.previousQuestions) ? body.previousQuestions.slice(0, 3) : [],
          taskType,
          history,
        },
        req.signal,
      );
      const now = new Date().toISOString();
      if (result.status !== "completed") return json({ ...result, runId: randomUUID() });
      return json({
        status: "completed",
        runId: randomUUID(),
        document: {
          id: randomUUID(), projectId: project.id, version: 1, createdAt: now,
          title: result.title, body: result.body, task, sources, clarification,
          snapshot: project, demo: false, model: result.model, usage: result.usage,
          elapsed: 0, warnings: result.warnings || [], taskType: result.taskType,
          draftBody: result.draftBody, promptVersion: result.promptVersion,
          trace: result.trace, evidence: result.evidence || {},
          evidenceManifest: result.evidenceManifest, retrievalStatus: result.retrievalStatus,
          historyIds: Array.isArray(body.historyIds) ? body.historyIds.slice(0, 3) : [],
          routing: result.routing,
        },
      });
    }
    if (p[0] === "activity" && method === "GET")
      return json(
        store.listProjects().map((project) => {
          const r = store.listRuns(project.id)[0];
          return {
            projectId: project.id,
            run: r
              ? {
                  id: r.id,
                  status: r.status,
                  stage: r.stage,
                  taskType: r.taskType,
                  documentId: r.documentId,
                }
              : null,
          };
        }),
      );
    if (p[0] === "backup" && method === "GET")
      return json(store.exportBackup());
    if (p[0] === "restore" && method === "POST")
      return json({ count: store.restoreBackup(body) });
    if (p[0] === "demo" && method === "POST") {
      const project = store.createProject(demoProject);
      store.addDocument(project.id, demoDoc);
      return json(project);
    }
    if (p[0] !== "projects") return json({ error: "接口不存在" }, 404);
    if (p.length === 1) {
      if (method === "GET") return json(store.listProjects());
      if (method === "POST") return json(store.createProject(body));
    }
    const id = p[1];
    const project = store.getProject(id);
    if (!project) return json({ error: "项目不存在" }, 404);
    if (p.length === 2) {
      if (method === "PUT") return json(store.updateProject(id, body));
      if (method === "DELETE") {
        if (running.has(id))
          return json({ error: "请先取消正在运行的任务" }, 409);
        store.deleteProject(id);
        return json({ ok: true });
      }
    }
    if (p[2] === "knowledge") {
      if (method === "GET") return json(store.listKnowledge(id));
      if (method === "POST") return json(store.addKnowledge(id, body));
      if (method === "DELETE") {
        store.deleteKnowledge(id, p[3]);
        return json({ ok: true, knowledge: store.listKnowledge(id) });
      }
    }
    if (p[2] === "runs" && method === "DELETE") {
      try {
        store.deleteRun(id, p[3]);
        return json({ ok: true });
      } catch (e) {
        return json({ error: e.message }, 409);
      }
    }
    if (p[2] === "documents") {
      if (p.length === 3 && method === "GET")
        return json(store.listDocuments(id));
      const doc = store.getDocument(id, p[3]);
      if (!doc) return json({ error: "文档不存在" }, 404);
      if (method === "PUT")
        return json(store.reviseDocument(id, doc.id, body.body));
      if (method === "DELETE") {
        store.deleteDocument(id, doc.id);
        return json({ ok: true });
      }
    }
    if (p[2] === "runs" && method === "GET") return json(store.listRuns(id));
    if (p[2] === "cancel" && method === "POST") {
      running.get(id)?.abort();
      return json({ ok: true });
    }
    if (["generate", "jobs"].includes(p[2]) && method === "POST") {
      const background = p[2] === "jobs";
      const task = text(body.task, "任务", 20000),
        sources = text(body.sources || "", "参考资料", 50000),
        clarification = text(body.clarification || "", "补充信息", 10000);
      if (!task) return json({ error: "请先描述当前业务任务" }, 400);
      if (
        !Array.isArray(body.previousQuestions || []) ||
        (body.previousQuestions || []).length > 3 ||
        (body.previousQuestions || []).some(
          (q) => typeof q !== "string" || q.length > 1000,
        )
      )
        throw Error("追问格式错误");
      if (running.has(id))
        return json({ error: "当前项目已有任务正在运行，请等待或取消" }, 409);
      if (running.size >= 2)
        return json(
          { error: "最多同时运行两个项目，请等其中一个完成后再开始" },
          409,
        );
      if (limited("generation", 15))
        return json({ error: "任务提交过于频繁，请稍后重试" }, 429);
      const taskType = body.taskType || "requirement_analysis";
      if (
        ![
          "auto",
          "requirement_analysis",
          "solution_design",
          "prd_draft",
          "competitor_analysis",
        ].includes(taskType)
      )
        throw Error("任务类型无效");
      const historyIds = body.historyIds || [];
      if (
        !Array.isArray(historyIds) ||
        historyIds.length > 3 ||
        historyIds.some((x) => typeof x !== "string")
      )
        throw Error("最多引用三个历史版本");
      const history = historyIds.map((did) => {
        const d = store.getDocument(id, did);
        if (!d || d.demo) throw Error("历史引用不存在、跨项目或为演示文档");
        return { id: d.id, title: d.title, body: d.body };
      });
      if (history.reduce((n, d) => n + d.body.length, 0) > 50000)
        throw Error("引用历史正文超过5万字，请减少引用");
      const controller = new AbortController();
      running.set(id, controller);
      const start = Date.now();
      const run = store.createRun(id, {
        task,
        sources,
        clarification,
        snapshot: project,
        status: "running",
        taskType,
        historyIds,
        previousQuestions: body.previousQuestions || [],
      });
      const execute = async () => {
        try {
          const result = await runWorkflow(
            {
              project,
              task,
              sources,
              clarification,
              previousQuestions: body.previousQuestions || [],
              taskType,
              history,
            },
            background
              ? controller.signal
              : AbortSignal.any([controller.signal, req.signal]),
            {
              onStep: async (step) =>
                store.updateRun(id, run.id, {
                  stage: step.node,
                  trace: step.trace || [],
                  stageStatus: step.status,
                  ...(typeof step.draftBody === "string"
                    ? { draftBody: step.draftBody }
                    : {}),
                }),
            },
          );
          if (controller.signal.aborted || (!background && req.signal.aborted))
            throw Error("任务已取消");
          const elapsed = Date.now() - start;
          if (result.status === "needs_input") {
            store.updateRun(id, run.id, {
              status: "needs_input",
              questions: result.questions,
              elapsed,
              taskType: result.taskType,
              trace: result.trace,
              promptVersion: result.promptVersion,
            });
            return json({
              status: result.status,
              questions: result.questions,
              taskType: result.taskType,
              runId: run.id,
            });
          }
          if (result.status === "high_risk" || result.status === "guidance") {
            store.updateRun(id, run.id, {
              status: result.status,
              body: result.body,
              title: result.title,
              trace: result.trace,
              promptVersion: result.promptVersion,
              elapsed,
            });
            return json({
              status: result.status,
              body: result.body,
              title: result.title,
              runId: run.id,
            });
          }
          const warnings = result.warnings || [];
          const doc = store.addDocument(id, {
            title: result.title,
            body: result.body,
            evidence: result.evidence,
            task,
            sources,
            clarification,
            snapshot: project,
            demo: false,
            model: result.model,
            usage: result.usage,
            elapsed,
            warnings,
            taskType: result.taskType,
            draftBody: result.draftBody,
            promptVersion: result.promptVersion,
            trace: result.trace,
            evidenceManifest: result.evidenceManifest,
            retrievalStatus: result.retrievalStatus,
            historyIds,
            routing: result.routing,
          });
          store.updateRun(id, run.id, {
            status: "completed",
            documentId: doc.id,
            elapsed,
            taskType: result.taskType,
            promptVersion: result.promptVersion,
            trace: result.trace,
          });
          return json({ status: "completed", document: doc });
        } catch (e) {
          const canceled =
            controller.signal.aborted || (!background && req.signal.aborted);
          const message = canceled ? "任务已取消" : e.message;
          store.updateRun(id, run.id, {
            status: canceled ? "cancelled" : "failed",
            error: message,
            elapsed: Date.now() - start,
          });
          return json({ error: message }, canceled ? 409 : 502);
        } finally {
          running.delete(id);
        }
      };
      if (background) {
        void execute().catch(() => {});
        return json({ status: "running", runId: run.id, projectId: id }, 202);
      }
      return await execute();
    }
    return json({ error: "不支持此操作" }, 405);
  } catch (e) {
    return json(
      {
        error: /sqlite|SQLITE|database|constraint|ENOENT/i.test(e.message)
          ? "数据保存失败，请检查磁盘权限与空间"
          : e.message || "操作失败，请重试",
      },
      400,
    );
  }
}
