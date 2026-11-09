import { validateKnowledge } from "./knowledge.mjs";
import { demoProject, demoDoc } from "./demo.mjs";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
const dir = resolve(process.env.DATA_DIR || "data");
mkdirSync(dir, { recursive: true });
const db = new DatabaseSync(join(dir, "workspace.sqlite"));
db.exec(
  "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, data TEXT NOT NULL)",
);
const fields = [
  "name",
  "business",
  "users",
  "stage",
  "scope",
  "constraints",
  "unknowns",
];
export function projectInput(input) {
  if (
    !input ||
    typeof input !== "object" ||
    typeof input.name !== "string" ||
    !input.name.trim()
  )
    throw Error("请填写项目名称");
  const p = {};
  for (const f of fields) {
    if (input[f] !== undefined && typeof input[f] !== "string")
      throw Error("项目字段格式错误");
    p[f] = (input[f] || "").trim();
    if (p[f].length > (f === "name" ? 100 : 6000)) throw Error("项目字段过长");
  }
  return p;
}
const parse = (row) => (row ? JSON.parse(row.data) : null);
function getProject(id) {
  return parse(db.prepare("SELECT data FROM projects WHERE id=?").get(id));
}
function requireProject(id) {
  const p = getProject(id);
  if (!p) throw Error("项目不存在");
  return p;
}
function listDocuments(pid) {
  return db
    .prepare(
      "SELECT data FROM documents WHERE project_id=? ORDER BY rowid DESC",
    )
    .all(pid)
    .map(parse);
}
function getDocument(pid, id) {
  return parse(
    db
      .prepare("SELECT data FROM documents WHERE id=? AND project_id=?")
      .get(id, pid),
  );
}
function addDocument(pid, input) {
  requireProject(pid);
  const docs = listDocuments(pid);
  const d = {
    ...input,
    id: randomUUID(),
    projectId: pid,
    version: docs.reduce((n, d) => Math.max(n, d.version || 0), 0) + 1,
    createdAt: new Date().toISOString(),
  };
  db.prepare("INSERT INTO documents VALUES(?,?,?)").run(
    d.id,
    pid,
    JSON.stringify(d),
  );
  return d;
}
function validateDoc(d) {
  if (
    !d ||
    typeof d.body !== "string" ||
    !d.body.trim() ||
    d.body.length > 120000 ||
    typeof d.title !== "string" ||
    d.title.length > 500 ||
    typeof d.task !== "string" ||
    d.task.length > 20000
  )
    throw Error("备份文档格式错误");
  for (const [k, max] of [
    ["clarification", 10000],
    ["model", 200],
    ["originalCreatedAt", 100],
  ])
    if (d[k] !== undefined && (typeof d[k] !== "string" || d[k].length > max))
      throw Error("备份文档附加信息格式错误");
  if (
    d.warnings !== undefined &&
    (!Array.isArray(d.warnings) ||
      d.warnings.length > 100 ||
      d.warnings.some((w) => typeof w !== "string" || w.length > 8000))
  )
    throw Error("备份检查提示格式错误");
  if (
    d.usage !== undefined &&
    (!d.usage ||
      typeof d.usage !== "object" ||
      ["prompt_tokens", "completion_tokens", "total_tokens"].some(
        (k) =>
          d.usage[k] !== undefined &&
          (!Number.isFinite(d.usage[k]) || d.usage[k] < 0),
      ))
  )
    throw Error("备份用量格式错误");
  if (d.elapsed !== undefined && (!Number.isFinite(d.elapsed) || d.elapsed < 0))
    throw Error("备份耗时格式错误");
  if (
    d.taskType !== undefined &&
    ![
      "requirement_analysis",
      "solution_design",
      "prd_draft",
      "competitor_analysis",
    ].includes(d.taskType)
  )
    throw Error("备份任务类型无效");
  if (
    d.draftBody !== undefined &&
    (typeof d.draftBody !== "string" || d.draftBody.length > 120000)
  )
    throw Error("备份草稿格式无效");
  if (
    d.promptVersion !== undefined &&
    (typeof d.promptVersion !== "string" || d.promptVersion.length > 100)
  )
    throw Error("备份提示词版本无效");
  if (
    d.trace !== undefined &&
    (!Array.isArray(d.trace) ||
      d.trace.length > 12 ||
      d.trace.some(
        (t) =>
          !t ||
          !Number.isInteger(t.node) ||
          t.node < 1 ||
          t.node > 8 ||
          !["completed", "running", "failed"].includes(t.status) ||
          (t.elapsed !== undefined && !Number.isFinite(t.elapsed)) ||
          (t.responseId !== undefined &&
            t.responseId !== null &&
            typeof t.responseId !== "string"),
      ))
  )
    throw Error("备份运行记录格式无效");
  if (d.evidence) {
    if (typeof d.evidence !== "object" || Array.isArray(d.evidence))
      throw Error("备份证据格式错误");
    for (const k of [
      "facts",
      "sources",
      "suggestions",
      "assumptions",
      "risks",
    ]) {
      const a = d.evidence[k];
      if (
        a !== undefined &&
        (!Array.isArray(a) ||
          a.length > 100 ||
          a.some((v) => typeof v !== "string" || v.length > 8000))
      )
        throw Error("备份证据格式错误");
    }
  }
  if (d.snapshot) {
    if (
      typeof d.snapshot !== "object" ||
      Array.isArray(d.snapshot) ||
      fields.some(
        (k) => d.snapshot[k] !== undefined && typeof d.snapshot[k] !== "string",
      )
    )
      throw Error("备份项目快照格式错误");
  }
}
export const store = {
  getProject,
  listKnowledge(pid) {
    return requireProject(pid).knowledge || [];
  },
  addKnowledge(pid, input) {
    const p = requireProject(pid);
    const item = {
      id: randomUUID(),
      title: input.title,
      text: input.text,
      createdAt: new Date().toISOString(),
    };
    const knowledge = validateKnowledge([...(p.knowledge || []), item]);
    db.prepare("UPDATE projects SET data=? WHERE id=?").run(
      JSON.stringify({ ...p, knowledge }),
      pid,
    );
    return item;
  },
  deleteKnowledge(pid, id) {
    const p = requireProject(pid);
    if (!(p.knowledge || []).some((x) => x.id === id))
      throw Error("资料不存在");
    db.prepare("UPDATE projects SET data=? WHERE id=?").run(
      JSON.stringify({
        ...p,
        knowledge: p.knowledge.filter((x) => x.id !== id),
      }),
      pid,
    );
  },
  deleteRun(pid, id) {
    const r = parse(
      db
        .prepare("SELECT data FROM runs WHERE id=? AND project_id=?")
        .get(id, pid),
    );
    if (!r) throw Error("任务不存在");
    if (r.status === "running") throw Error("请先取消正在运行的任务");
    db.prepare("DELETE FROM runs WHERE id=? AND project_id=?").run(id, pid);
  },
  listDocuments,
  getDocument,
  listProjects() {
    return db
      .prepare("SELECT data FROM projects ORDER BY rowid DESC")
      .all()
      .map(parse);
  },
  createProject(input) {
    const p = {
      ...projectInput(input),
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    db.prepare("INSERT INTO projects VALUES(?,?)").run(p.id, JSON.stringify(p));
    return p;
  },
  updateProject(id, input) {
    const p = {
      ...requireProject(id),
      ...projectInput(input),
      updatedAt: new Date().toISOString(),
    };
    db.prepare("UPDATE projects SET data=? WHERE id=?").run(
      JSON.stringify(p),
      id,
    );
    return p;
  },
  deleteProject(id) {
    requireProject(id);
    db.prepare("DELETE FROM projects WHERE id=?").run(id);
  },
  addDocument,
  reviseDocument(pid, id, body) {
    const old = getDocument(pid, id);
    if (!old) throw Error("文档不存在");
    if (typeof body !== "string" || !body.trim() || body.length > 120000)
      throw Error("正文不能为空或过长");
    return addDocument(pid, { ...old, body, parentId: old.id, edited: true });
  },
  deleteDocument(pid, id) {
    if (!getDocument(pid, id)) throw Error("文档不存在");
    db.prepare("DELETE FROM documents WHERE id=? AND project_id=?").run(
      id,
      pid,
    );
  },
  createRun(pid, input) {
    requireProject(pid);
    const r = {
      ...input,
      id: randomUUID(),
      projectId: pid,
      createdAt: new Date().toISOString(),
    };
    db.prepare("INSERT INTO runs VALUES(?,?,?)").run(
      r.id,
      pid,
      JSON.stringify(r),
    );
    return r;
  },
  updateRun(pid, id, patch) {
    const row = parse(
      db
        .prepare("SELECT data FROM runs WHERE id=? AND project_id=?")
        .get(id, pid),
    );
    if (!row) throw Error("任务不存在");
    const r = { ...row, ...patch };
    db.prepare("UPDATE runs SET data=? WHERE id=?").run(JSON.stringify(r), id);
    return r;
  },
  listRuns(pid) {
    return db
      .prepare(
        "SELECT data FROM runs WHERE project_id=? ORDER BY rowid DESC LIMIT 100",
      )
      .all(pid)
      .map(parse);
  },
  exportBackup() {
    return {
      format: "aipm-v1",
      exportedAt: new Date().toISOString(),
      projects: this.listProjects().map((p) => ({
        ...p,
        documents: listDocuments(p.id),
      })),
    };
  },
  restoreBackup(backup) {
    if (
      !backup ||
      backup.format !== "aipm-v1" ||
      !Array.isArray(backup.projects) ||
      backup.projects.length > 100
    )
      throw Error("不是有效的工作台备份");
    for (const p of backup.projects) {
      projectInput(p);
      validateKnowledge(p.knowledge || []);
      if (!Array.isArray(p.documents) || p.documents.length > 300)
        throw Error("备份文档数量无效");
      for (const d of p.documents) validateDoc(d);
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      let count = 0;
      for (const p of backup.projects) {
        const n = this.createProject({
          ...p,
          name: p.name.slice(0, 90) + "（导入）",
        });
        if (p.knowledge?.length) {
          db.prepare("UPDATE projects SET data=? WHERE id=?").run(
            JSON.stringify({ ...n, knowledge: p.knowledge }),
            n.id,
          );
        }
        const importedIds = new Map();
        const remap = [];
        for (const d of [...p.documents].reverse()) {
          const copied = addDocument(n.id, {
            title: d.title,
            body: d.body,
            task: d.task,
            evidence: d.evidence || {},
            sources: typeof d.sources === "string" ? d.sources : "",
            snapshot: d.snapshot || {},
            demo: !!d.demo,
            edited: !!d.edited,
            imported: true,
            clarification: d.clarification || "",
            model: d.model,
            usage: d.usage,
            elapsed: d.elapsed,
            warnings: d.warnings,
            taskType: d.taskType,
            routing: d.routing,
            promptVersion: d.promptVersion,
            draftBody: d.draftBody,
            trace: d.trace,
            evidenceManifest: d.evidenceManifest,
            retrievalStatus: d.retrievalStatus,

            originalVersion: d.version,
            originalParentId: d.parentId,
            originalCreatedAt:
              d.originalCreatedAt ||
              (typeof d.createdAt === "string" ? d.createdAt : ""),
          });
          importedIds.set(d.id, copied.id);
          remap.push({ copied, original: d });
        }
        for (const { copied, original } of remap) {
          copied.historyIds = Array.isArray(original.historyIds)
            ? original.historyIds
                .filter((id) => typeof id === "string" && importedIds.has(id))
                .map((id) => importedIds.get(id))
            : [];
          if (original.parentId && importedIds.has(original.parentId))
            copied.parentId = importedIds.get(original.parentId);
          db.prepare("UPDATE documents SET data=? WHERE id=?").run(
            JSON.stringify(copied),
            copied.id,
          );
        }
        count++;
      }
      db.exec("COMMIT");
      return count;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  },
};

db.exec("CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT)");
if (!db.prepare("SELECT key FROM metadata WHERE key='initialized'").get()) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const p = store.createProject(demoProject);
    store.addDocument(p.id, demoDoc);
    db.prepare("INSERT INTO metadata VALUES('initialized','1')").run();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// Route modules can be loaded again while the worker is still running.
for (const row of db.prepare("SELECT id,data FROM runs").all()) {
  const r = JSON.parse(row.data);
  if (r.status === "running") {
    if (Number.isSafeInteger(r.workerPid) && r.workerPid > 0) {
      try {
        process.kill(r.workerPid, 0);
        continue;
      } catch (error) {
        if (error.code !== "ESRCH") continue;
      }
    }
    r.status = "failed";
    r.error = "后台任务已中断。可以用原任务直接重试。";
    db.prepare("UPDATE runs SET data=? WHERE id=?").run(
      JSON.stringify(r),
      row.id,
    );
  }
}
