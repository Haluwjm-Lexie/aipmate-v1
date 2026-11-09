"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  buildUserPrompt,
  nextTask,
  upstreamDocs,
  slotFields,
  stageGuidance,
} from "../lib/guidance.mjs";
import { taskKey, taskRecords } from "../lib/task-view.mjs";

type Project = {
  id: string;
  name: string;
  business: string;
  users: string;
  stage: string;
  scope: string;
  constraints: string;
  unknowns: string;
  knowledge?: { id: string; title: string; text: string }[];
};
type Doc = {
  id: string;
  title: string;
  body: string;
  task: string;
  sources: string;
  taskType?: string;
  historyIds?: string[];
  retrievalStatus?: string;
  promptVersion?: string;
  trace?: {
    node: number;
    elapsed?: number;
    status: string;
    responseId?: string;
  }[];
  clarification?: string;
  version: number;
  createdAt: string;
  demo?: boolean;
  edited?: boolean;
  imported?: boolean;
  model?: string;
  elapsed?: number;
  usage?: { total_tokens: number };
  snapshot?: Partial<Project>;
  warnings?: string[];
  evidence: Record<string, string[]>;
};
type Run = {
  id: string;
  task: string;
  sources: string;
  taskType?: string;
  historyIds?: string[];
  retrievalStatus?: string;
  promptVersion?: string;
  trace?: {
    node: number;
    elapsed?: number;
    status: string;
    responseId?: string;
  }[];
  clarification?: string;
  status: string;
  error?: string;
  body?: string;
  draftBody?: string;
  stage?: number;
  stageStatus?: string;
  documentId?: string;
  createdAt: string;
  questions?: string[];
};
type Draft = {
  task: string;
  sources: string;
  clarification: string;
  questions: string[];
  taskType: string;
  historyIds: string[];
};
const blank: Omit<Project, "id" | "knowledge"> = {
  name: "",
  business: "",
  users: "",
  stage: "需求分析",
  scope: "",
  constraints: "",
  unknowns: "",
};
const newDraft = (taskType = "auto"): Draft => ({
  task: "",
  sources: "",
  clarification: "",
  questions: [],
  taskType,
  historyIds: [],
});
const labels: Record<string, string> = {
  name: "项目名称",
  business: "业务对象",
  users: "目标用户",
  stage: "当前阶段",
  scope: "已确认范围",
  constraints: "关键约束",
  unknowns: "待确认事项",
};
const evidenceLabels: Record<string, string> = {
  facts: "用户提供的事实",
  sources: "资料支持",
  suggestions: "分析建议",
  assumptions: "待验证假设",
  risks: "风险与人工确认点",
};
const runLabels: Record<string, string> = {
  running: "正在生成",
  completed: "已完成",
  needs_input: "需要补充",
  failed: "运行失败",
  cancelled: "已取消",
  high_risk: "风险提醒",
  guidance: "任务引导",
};
const stages = [
  "想法探索",
  "需求分析",
  "AI 方案设计",
  "PRD 草稿",
  "竞品分析",
  "开发验证",
  "上线运营",
];
const tasks: Record<
  string,
  { name: string; description: string; placeholder: string }
> = {
  auto: {
    name: "智能识别",
    description: "不知道选哪项？说说你的问题，助理帮你判断先做什么。",
    placeholder: "例如：我想做一个客服助手，但不知道应该从哪里开始。",
  },
  requirement_analysis: {
    name: "需求分析",
    description: "先弄清谁遇到了什么问题，再决定要做哪些功能。",
    placeholder:
      "例如：我读长文章时想在网页上高亮、画线，现在只能截图。请分析适合哪些用户，以及第一版应该做哪些功能。",
  },
  solution_design: {
    name: "AI 方案设计",
    description: "把需求变成可执行的方案，讲清 AI、程序和人工分别做什么。",
    placeholder:
      "例如：基于选中的需求分析，设计网页批注插件。首版支持高亮和手绘，只在本机保存，请说明实现分工与失败处理。",
  },
  prd_draft: {
    name: "PRD 草稿",
    description: "写一份给开发看的需求文档，说明功能、操作流程和验收要求。",
    placeholder:
      "例如：基于已选需求和方案，写网页批注插件的PRD。请写清开启批注、保存、重新打开恢复，以及异常和验收要求。",
  },
  competitor_analysis: {
    name: "竞品分析",
    description: "比较类似产品，找出值得借鉴的做法和你的机会。",
    placeholder:
      "例如：比较网页批注插件与浏览器截图，重点看高亮、手绘、保存和隐私。只使用实际提供的资料。",
  },
};
const examples = [
  {
    name: "售后流程需求",
    taskType: "requirement_analysis",
    text: "请诊断电商售后申请流程，目标用户是消费者和客服，当前人工分散查询申请状态，希望改善重复沟通。请还原流程、问题和AI适配性，至少给一种非AI替代方案。",
  },
  {
    name: "AI客服方案",
    taskType: "solution_design",
    text: "请为零售电商商品咨询和本人订单只读查询设计AI客服MVP方案。目标是减少资料搜索与系统切换，订单权限由规则/API验证，不执行退款；知识接口能力待确认。",
  },
  {
    name: "订单查询PRD",
    taskType: "prd_draft",
    text: "请生成订单只读查询MVP PRD。目标用户是消费者和授权客服，核心任务是查询本人订单状态，本期不修改订单。需覆盖身份/权限失败、上游超时、人工接管和Given-When-Then验收。",
  },
  {
    name: "AI客服竞品",
    taskType: "competitor_analysis",
    text: "请对比拟建零售AI客服与人工客服、FAQ检索的替代关系。目标用户是消费者和客服，重点比较入口、任务闭环、权限和人工接管。目前无具体厂商资料，请输出比较框架与取证计划。",
  },
];
function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    folder: <path d="M3 7V5h6l2 2h10v13H3V7Z" />,
    file: (
      <>
        <path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6" />
      </>
    ),
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 5 5" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2" />
      </>
    ),
    arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />,
    copy: (
      <>
        <rect x="8" y="8" width="12" height="13" rx="2" />
        <path d="M16 8V3H3v13h5" />
      </>
    ),
    book: (
      <>
        <path d="M12 5c-3-2-7-2-10 0v15c3-2 7-2 10 0 3-2 7-2 10 0V5c-3-2-7-2-10 0Zm0 0v15" />
      </>
    ),
    spark: (
      <>
        <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
      </>
    ),
  };
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.file}
    </svg>
  );
}
async function serverApi(path: string, method = "GET", body?: unknown) {
  let response;
  try {
    response = await fetch("/api/" + path, {
      method,
      headers:
        body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Error("网络连接中断，请检查连接后重试");
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw Error("服务暂时无法响应，请稍后重试");
  }
  if (!response.ok) throw Error(data.error || "操作失败");
  return data;
}
// Vercel Functions do not provide a durable disk.  The public demo therefore
// keeps each visitor's workspace in their own browser; only model generation
// is sent to the server (where the API key remains private).
const workspaceKey = "aipmate-browser-workspace-v1";
type BrowserWorkspace = { projects: Project[]; documents: Record<string, Doc[]>; runs: Record<string, Run[]> };
function browserWorkspace(): BrowserWorkspace {
  if (typeof window === "undefined") return { projects: [], documents: {}, runs: {} };
  try {
    const data = JSON.parse(localStorage.getItem(workspaceKey) || "");
    if (Array.isArray(data?.projects) && data.documents && data.runs) return data;
  } catch {}
  return { projects: [], documents: {}, runs: {} };
}
function saveBrowserWorkspace(data: BrowserWorkspace) {
  localStorage.setItem(workspaceKey, JSON.stringify(data));
}
const uid = () => crypto.randomUUID();
const copy = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
async function browserApi(path: string, method: string, body?: any): Promise<any> {
  const db = browserWorkspace();
  const parts = path.split("/");
  const projectId = parts[1];
  const project = db.projects.find((p) => p.id === projectId);
  const docs = (id: string) => db.documents[id] || [];
  const runs = (id: string) => db.runs[id] || [];
  const commit = () => saveBrowserWorkspace(db);
  if (path === "projects" && method === "GET") return copy(db.projects);
  if (path === "projects" && method === "POST") {
    const p = { ...blank, ...body, id: uid(), createdAt: new Date().toISOString(), knowledge: [] };
    if (!p.name?.trim()) throw Error("请填写项目名称");
    db.projects.unshift(p); db.documents[p.id] = []; db.runs[p.id] = []; commit(); return copy(p);
  }
  if (path === "activity") return db.projects.map((p) => ({ projectId: p.id, run: copy(runs(p.id)[0] || null) }));
  if (path === "backup") return { format: "aipm-v1", exportedAt: new Date().toISOString(), projects: db.projects.map((p) => ({ ...p, documents: docs(p.id) })) };
  if (path === "restore" && method === "POST") {
    if (body?.format !== "aipm-v1" || !Array.isArray(body.projects)) throw Error("不是有效的工作台备份");
    let count = 0;
    for (const old of body.projects.slice(0, 100)) {
      const id = uid(); const p = { ...old, id, name: `${old.name || "未命名项目"}（导入）`, knowledge: old.knowledge || [] };
      db.projects.unshift(p); db.documents[id] = (old.documents || []).map((d: Doc) => ({ ...d, id: uid(), projectId: id, imported: true })); db.runs[id] = []; count++;
    }
    commit(); return { count };
  }
  if (!project) throw Error("项目不存在");
  if (parts.length === 2) {
    if (method === "PUT") { Object.assign(project, body, { updatedAt: new Date().toISOString() }); commit(); return copy(project); }
    if (method === "DELETE") { db.projects = db.projects.filter((p) => p.id !== projectId); delete db.documents[projectId]; delete db.runs[projectId]; commit(); return { ok: true }; }
  }
  if (parts[2] === "documents") {
    if (parts.length === 3 && method === "GET") return copy(docs(projectId));
    const old = docs(projectId).find((d) => d.id === parts[3]);
    if (!old) throw Error("文档不存在");
    if (method === "DELETE") { db.documents[projectId] = docs(projectId).filter((d) => d.id !== old.id); commit(); return { ok: true }; }
    if (method === "PUT") { const next = { ...old, ...body, id: uid(), parentId: old.id, version: Math.max(0, ...docs(projectId).map((d) => d.version || 0)) + 1, createdAt: new Date().toISOString(), edited: true }; db.documents[projectId].unshift(next); commit(); return copy(next); }
  }
  if (parts[2] === "runs") {
    if (method === "GET") return copy(runs(projectId));
    if (method === "DELETE") { db.runs[projectId] = runs(projectId).filter((r) => r.id !== parts[3]); commit(); return { ok: true }; }
  }
  if (parts[2] === "knowledge") {
    if (method === "GET") return copy(project.knowledge || []);
    if (method === "POST") { const item = { id: uid(), title: body.title, text: body.text, createdAt: new Date().toISOString() }; project.knowledge = [...(project.knowledge || []), item]; commit(); return copy(item); }
    if (method === "DELETE") { project.knowledge = (project.knowledge || []).filter((x) => x.id !== parts[3]); commit(); return { ok: true, knowledge: copy(project.knowledge) }; }
  }
  if (parts[2] === "cancel") return { ok: true };
  if (parts[2] === "jobs" && method === "POST") {
    const history = docs(projectId).filter((d) => (body.historyIds || []).includes(d.id)).map((d) => ({ id: d.id, title: d.title, body: d.body }));
    const result = await serverApi("client-generate", "POST", { ...body, project: copy(project), history });
    const run: Run = { id: result.runId || uid(), task: body.task, sources: body.sources || "", taskType: body.taskType, status: result.status, documentId: result.document?.id, createdAt: new Date().toISOString() };
    if (result.document) { const doc = { ...result.document, version: Math.max(0, ...docs(projectId).map((d) => d.version || 0)) + 1 }; db.documents[projectId] = [doc, ...docs(projectId)]; run.documentId = doc.id; }
    db.runs[projectId] = [run, ...runs(projectId)]; commit(); return { ...result, runId: run.id };
  }
  throw Error("不支持此操作");
}
async function api(path: string, method = "GET", body?: unknown) {
  if (["session", "settings"].includes(path)) return serverApi(path, method, body);
  return browserApi(path, method, body);
}
function download(
  name: string,
  data: string,
  type = "text/markdown;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[\\/:*?"<>|]/g, "-");
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function fmt(date: string) {
  return new Date(date).toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    ref.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const elements = ref.current?.querySelectorAll<HTMLElement>(
          'button,input,textarea,select,[tabindex="0"]',
        );
        if (!elements?.length) return;
        const first = elements[0],
          last = elements[elements.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      old?.focus();
    };
  }, [close]);
  return (
    <div className="overlay">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={close} aria-label="关闭">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function TaskTemplate({
  type,
  project,
  references,
  apply,
}: {
  type: string;
  project: Project;
  references: string[];
  apply: (text: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({
    users: project.users,
    scenario: project.business,
    features: project.scope,
    constraints: project.constraints,
  });
  return (
    <details className="slot-template">
      <summary>不会写要求？用填空模板</summary>
      <p>
        填你知道的，不清楚可以留空。点击下面按钮，会整理成当前任务的要求；不会自动开始分析。
      </p>
      <div className="slot-grid">
        {(slotFields[type as keyof typeof slotFields] || slotFields.auto).map(
          ([key, label]: string[]) => (
            <label key={key}>
              {label}
              <textarea
                rows={2}
                value={values[key] || ""}
                onChange={(e) =>
                  setValues((old) => ({ ...old, [key]: e.target.value }))
                }
                maxLength={2000}
              />
            </label>
          ),
        )}
      </div>
      <button
        className="secondary"
        type="button"
        onClick={() =>
          apply(buildUserPrompt(type, values, project, references))
        }
      >
        把填空内容放入输入框
      </button>
    </details>
  );
}
export default function Workspace() {
  const [ready, setReady] = useState(false),
    [auth, setAuth] = useState(false),
    [projects, setProjects] = useState<Project[]>([]),
    [current, setCurrent] = useState(""),
    [docs, setDocs] = useState<Doc[]>([]),
    [runs, setRuns] = useState<Run[]>([]),
    [docId, setDocId] = useState(""),
    [selectedRunId, setSelectedRunId] = useState(""),
    [attemptFailure, setAttemptFailure] = useState<{
      projectId: string;
      run: Run;
    } | null>(null),
    [selectedTypes, setSelectedTypes] = useState<Record<string, string>>({}),
    [deleteKnowledgeId, setDeleteKnowledgeId] = useState(""),
    [projectStatuses, setProjectStatuses] = useState<Record<string, string>>(
      {},
    ),
    [busyProjects, setBusyProjects] = useState<Record<string, string>>({}),
    [knowledgeTitle, setKnowledgeTitle] = useState(""),
    [knowledgeText, setKnowledgeText] = useState(""),
    [drafts, setDrafts] = useState<Record<string, Draft>>({}),
    [search, setSearch] = useState("");
  const [modal, setModal] = useState(""),
    [form, setForm] = useState({ ...blank }),
    [action, setAction] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [drawer, setDrawer] = useState(false),
    [mobile, setMobile] = useState(false),
    [editing, setEditing] = useState(false),
    [editBody, setEditBody] = useState(""),
    [settings, setSettings] = useState({
      hasKey: false,
      hasModel: false,
      model: "",
      protected: false,
      capabilities: { webSearch: false, knowledge: true },
    }),
    [connection, setConnection] = useState(""),
    [loading, setLoading] = useState(false);
  const busy = busyProjects[current] ? current : "";
  const project = projects.find((p) => p.id === current),
    selectedType = selectedTypes[current] || "auto",
    draft = drafts[taskKey(current, selectedType)] || newDraft(selectedType),
    taskView = taskRecords(docs, runs, selectedType),
    taskDocs = taskView.docs as Doc[],
    taskRuns = taskView.runs as Run[],
    doc = taskDocs.find((d) => d.id === docId);
  const visibleRun =
    attemptFailure?.projectId === current
      ? attemptFailure.run
      : taskRuns.find((r) => r.id === selectedRunId) || taskRuns[0];
  const fileRef = useRef<HTMLInputElement>(null);
  const editingActive = useRef(editing);
  editingActive.current = editing;
  const active = useRef(current);
  active.current = current;
  const activeTask = useRef(selectedType);
  activeTask.current = selectedType;
  const loadedAuth = useRef(false);
  const generating = useRef(new Set<string>());
  const activityVersions = useRef<Record<string, string>>({});
  function patchDraft(p: Partial<Draft>) {
    const type = p.taskType || selectedType;
    const key = taskKey(current, type);
    if (p.taskType) setSelectedTypes((old) => ({ ...old, [current]: type }));
    setDrafts((old) => ({
      ...old,
      [key]: { ...(old[key] || newDraft(type)), ...p },
    }));
  }
  function selectTask(type: string) {
    if (editing && !confirm("正文修改尚未保存，确定切换？")) return;
    setSelectedTypes((old) => ({ ...old, [current]: type }));
    setDocId(taskRecords(docs, runs, type).documentId);
    setSelectedRunId("");
    setAttemptFailure(null);
    setEditing(false);
    setError("");
  }
  async function loadProjects(select?: string) {
    const list: Project[] = await api("projects");
    setProjects(list);
    setCurrent(
      (old) =>
        select || (list.some((p) => p.id === old) ? old : list[0]?.id || ""),
    );
  }
  async function loadRecords(id: string, select?: string, fromPoll = false) {
    const [ds, rs] = await Promise.all([
      api(`projects/${id}/documents`),
      api(`projects/${id}/runs`),
    ]);
    if (active.current !== id) return;
    setDocs(ds);
    setRuns(rs);
    if (fromPoll && editingActive.current) return;
    const view = taskRecords(ds, rs, activeTask.current, select);
    setDocId(view.documentId);
    setSelectedRunId(view.runs[0]?.id || "");
    const latest = view.runs[0] as Run | undefined;
    if (latest?.status === "needs_input" && latest.questions?.length) {
      const type = activeTask.current;
      const key = taskKey(id, type);
      setDrafts((old) => {
        const existing = old[key];
        if (existing?.task && existing.task !== latest.task) return old;
        return {
          ...old,
          [key]: {
            ...(existing || newDraft(type)),
            task: latest.task,
            sources: latest.sources || "",
            historyIds: latest.historyIds || [],
            questions: latest.questions || [],
            clarification: existing?.clarification || "",
          },
        };
      });
    }
  }
  async function refreshSettings() {
    setSettings(await api("settings"));
  }
  useEffect(() => {
    api("session")
      .then((s) => {
        setAuth(s.authenticated);
        setReady(true);
      })
      .catch((e) => {
        setError(e.message);
        setReady(true);
      });
  }, []);
  useEffect(() => {
    if (!auth || loadedAuth.current) return;
    loadedAuth.current = true;
    Promise.all([loadProjects(), refreshSettings()]).catch((e) =>
      setError(e.message),
    );
  }, [auth]);
  useEffect(() => {
    setDocs([]);
    setRuns([]);
    setDocId("");
    setEditing(false);
    setDrawer(false);
    setAttemptFailure(null);
    setKnowledgeTitle("");
    setKnowledgeText("");
    setDeleteKnowledgeId("");
    if (current) {
      setLoading(true);
      loadRecords(current)
        .catch((e) => setError(e.message))
        .finally(() => {
          if (active.current === current) setLoading(false);
        });
    }
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  function changeProject(id: string) {
    if (editing && !confirm("正文修改尚未保存，确定切换项目？")) return;
    setCurrent(id);
    setMobile(false);
    setError("");
  }
  async function perform(fn: () => Promise<void>) {
    if (action) return;
    setAction(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAction(false);
    }
  }
  function openProject(edit = false) {
    setForm(
      edit && project
        ? {
            name: project.name,
            business: project.business,
            users: project.users,
            stage: project.stage,
            scope: project.scope,
            constraints: project.constraints,
            unknowns: project.unknowns,
          }
        : { ...blank },
    );
    setModal(edit ? "edit" : "create");
  }
  async function saveProject(e: React.FormEvent) {
    e.preventDefault();
    await perform(async () => {
      const p = await api(
        modal === "edit" ? `projects/${current}` : "projects",
        modal === "edit" ? "PUT" : "POST",
        form,
      );
      await loadProjects(p.id);
      setModal("");
      setToast("项目已保存");
    });
  }
  async function generate() {
    const id = current;
    if (generating.current.has(id) || busyProjects[id] || editing) return;
    if (!draft.task.trim()) {
      setError("请先描述当前业务任务");
      return;
    }
    generating.current.add(id);
    setBusyProjects((old) => ({ ...old, [id]: "submitting" }));
    setAttemptFailure(null);
    setDocId("");
    setError("");
    setEditing(false);
    try {
      const r = await api(`projects/${id}/jobs`, "POST", {
        ...draft,
        previousQuestions: draft.questions,
      });
      setBusyProjects((old) => ({ ...old, [id]: r.runId }));
      setToast("已在后台开始，可以切到其他项目继续工作");
      await loadRecords(id, "");
    } catch (e) {
      setBusyProjects((old) => {
        const n = { ...old };
        delete n[id];
        return n;
      });
      if (active.current === id) setError((e as Error).message);
    } finally {
      generating.current.delete(id);
    }
  }
  async function cancel() {
    await perform(async () => {
      await api(`projects/${current}/cancel`, "POST", {});
      setToast("已请求取消，结束后会保留任务记录");
    });
  }
  useEffect(() => {
    if (!auth) return;
    let live = true,
      polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const entries = (await api("activity")) as {
          projectId: string;
          run: Run | null;
        }[];
        if (!live) return;
        const running: Record<string, string> = {};
        const states: Record<string, string> = {};
        const observed: Record<string, string> = {};
        for (const { projectId, run } of entries) {
          if (run) {
            states[projectId] = run.status;
            observed[projectId] = run.id;
          }
          if (run?.status === "running") running[projectId] = run.id;
          const signature = JSON.stringify([run?.id, run?.status, run?.stage]);
          const before = activityVersions.current[projectId];
          activityVersions.current[projectId] = signature;
          if (before !== signature && active.current === projectId)
            await loadRecords(projectId, undefined, true);
          if (before && before !== signature && run?.status === "completed")
            setToast("有一份分析已完成，已保存到对应项目");
        }
        if (live) {
          setProjectStatuses(states);
          setBusyProjects((old) => {
            for (const [id, runId] of Object.entries(old))
              if (
                generating.current.has(id) ||
                (runId !== "submitting" && observed[id] !== runId)
              )
                running[id] = runId;
            return running;
          });
        }
      } catch {
        /* A transient polling error must not erase an active task. */
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = setInterval(poll, 1500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [auth]);
  function continueWith(type: string, source?: Doc) {
    const refs = upstreamDocs(docs, type) as Doc[];
    const selected =
      source && !source.demo
        ? [source, ...refs.filter((d) => d.id !== source.id)]
        : refs;
    const ids = selected.slice(0, 3).map((d) => d.id);
    patchDraft({
      taskType: type,
      historyIds: ids,
      task: buildUserPrompt(
        type,
        {
          users: project?.users,
          features: project?.scope,
          constraints: project?.constraints,
        },
        project || {},
        ids,
      ),
      questions: [],
      clarification: "",
    });
    setDocId(taskRecords(docs, runs, type).documentId);
    setAttemptFailure(null);
    setEditing(false);
    setToast(
      ids.length
        ? "已勾选上一阶段文档；补充本次要求后开始"
        : "暂时没有上一阶段文档，也可以直接描述已确定的需求",
    );
    requestAnimationFrame(() =>
      document
        .getElementById("task")
        ?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  }
  const closeModal = useCallback(() => setModal(""), []);
  if (!ready)
    return (
      <main className="login">
        <div className="spinner" />
        正在打开工作台…
      </main>
    );
  if (!auth)
    return (
      <main className="login">
        <p>{error || "暂时无法打开工作台，请刷新重试。"}</p>
      </main>
    );
  return (
    <div className="app-shell">
      {mobile && (
        <button
          className="sidebar-scrim"
          aria-label="收起项目列表"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={"sidebar " + (mobile ? "open" : "")}>
        <div className="brand" aria-label="AI 产品经理助理工作台">
          <strong className="wordmark">
            PM<span>ATE</span>
            <i />
          </strong>
        </div>
        <button className="new-project" onClick={() => openProject()}>
          <Icon name="plus" />
          新建项目
        </button>
        <label className="search">
          <Icon name="search" />
          <input
            aria-label="搜索项目或任务"
            placeholder="搜索项目或任务"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="nav-label">
          我的项目 <span>{projects.length.toString().padStart(2, "0")}</span>
        </div>
        <nav className="project-list" aria-label="项目列表">
          {projects
            .filter(
              (p) =>
                p.name.includes(search) ||
                (p.id === current && runs.some((r) => r.task.includes(search))),
            )
            .map((p) => (
              <button
                className={
                  "project-item " + (p.id === current ? "selected" : "")
                }
                key={p.id}
                onClick={() => changeProject(p.id)}
              >
                <Icon name="folder" />
                <span>
                  {p.name}
                  {(busyProjects[p.id] || projectStatuses[p.id]) && (
                    <small className="project-running">
                      {busyProjects[p.id]
                        ? "生成中…"
                        : runLabels[projectStatuses[p.id]]}
                    </small>
                  )}
                </span>
                <i />
              </button>
            ))}
          {!projects.length && <p className="muted">从一个新项目开始。</p>}
        </nav>
        <div className="nav-label history-label">最近任务</div>
        <nav className="history" aria-label="历史任务">
          {runs
            .filter((r) => r.task.includes(search))
            .slice(0, 12)
            .map((r) => (
              <div className="history-row" key={r.id}>
                <button
                  disabled={!!busy}
                  onClick={() => {
                    if (editing && !confirm("放弃尚未保存的正文修改？")) return;
                    patchDraft({
                      task: r.task,
                      taskType: r.taskType || "requirement_analysis",
                      historyIds: r.historyIds || [],
                      sources: r.sources || "",
                      clarification: r.clarification || "",
                      questions: r.questions || [],
                    });
                    setDocId(r.documentId || "");
                    setAttemptFailure(null);
                    setSelectedRunId(r.id);
                    setEditing(false);
                    setMobile(false);
                    if (r.error) setError(r.error);
                  }}
                >
                  <span className={"status-dot " + r.status} />
                  <span>
                    <strong>{r.task.slice(0, 28)}</strong>
                    <small>
                      {runLabels[r.status]} · {fmt(r.createdAt)}
                    </small>
                  </span>
                </button>
                <button
                  className="history-delete"
                  aria-label={"删除任务：" + r.task}
                  disabled={action || r.status === "running"}
                  onClick={() => {
                    if (!confirm("删除这条任务记录？已保存的分析文档会保留。"))
                      return;
                    perform(async () => {
                      await api(`projects/${current}/runs/${r.id}`, "DELETE");
                      setRuns((old) => old.filter((x) => x.id !== r.id));
                      if (selectedRunId === r.id) setSelectedRunId("");
                      setToast("任务记录已删除，文档仍保留");
                    });
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          {!runs.length && <p className="muted">分析任务将记录在这里</p>}
        </nav>
        <div className="sidebar-bottom">
          <button
            onClick={() => {
              setModal("settings");
              refreshSettings().catch((e) => setError(e.message));
            }}
          >
            <Icon name="settings" />
            连接与资料
          </button>
          <button onClick={() => setModal("changelog")}>
            <Icon name="file" />
            更新日志
          </button>
          <button onClick={() => setModal("help")}>
            <Icon name="book" />
            帮助与数据备份
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-btn mobile-menu"
              aria-label="展开项目列表"
              onClick={() => setMobile(true)}
            >
              <Icon name="menu" />
            </button>
            <span>工作空间</span>
            <span className="slash">/</span>
            <strong>{project?.name || "未选择项目"}</strong>
          </div>
          <div className="header-actions">
            <button
              className={
                "connection " +
                (settings.hasKey && settings.hasModel ? "configured" : "")
              }
              onClick={() => setModal("settings")}
            >
              <span />
              {connection === "已连接"
                ? "已连接"
                : settings.hasKey && settings.hasModel
                  ? "已配置 · 待测试"
                  : "未配置模型"}
            </button>
            <button
              className="icon-btn"
              aria-label="帮助中心"
              onClick={() => setModal("help")}
            >
              <Icon name="book" />
            </button>
          </div>
        </header>
        <main className="workspace">
          <section className="page-heading">
            <div>
              <h1>项目工作台</h1>
              <p>选一项工作，填写要求，生成并保存文档。</p>
            </div>
          </section>
          <nav className="task-tabs" role="tablist" aria-label="选择要做的工作">
            {Object.entries(tasks).map(([key, t]) => (
              <button
                key={key}
                className={draft.taskType === key ? "active" : ""}
                disabled={!!busy}
                onClick={() => selectTask(key)}
                role="tab"
                aria-selected={draft.taskType === key}
              >
                {t.name}
              </button>
            ))}
          </nav>
          <p className="task-explainer">{tasks[draft.taskType]?.description}</p>
          {error && (
            <div className="notice error" role="alert">
              <div>
                <strong>操作未完成</strong>
                <p>{error}</p>
              </div>
              <button onClick={() => setError("")} aria-label="关闭错误提示">
                <Icon name="close" />
              </button>
            </div>
          )}
          {!project ? (
            <section className="panel empty">
              <Icon name="folder" />
              <h2>让第一个项目有个开始</h2>
              <p>建立项目背景，让每一次分析都有依据。</p>
              <button className="primary" onClick={() => openProject()}>
                新建项目
              </button>
              <button
                className="text-btn"
                disabled={action}
                onClick={() =>
                  perform(async () => {
                    const p = await api("demo", "POST", {});
                    await loadProjects(p.id);
                  })
                }
              >
                载入模拟示例
              </button>
            </section>
          ) : (
            <>
              <details className="stage-guide">
                <summary>什么时候进入下一步？怎样带入上一份结果？</summary>
                <p>
                  {stageGuidance[selectedType as keyof typeof stageGuidance]}
                </p>
                <p>
                  推荐：需求分析 → AI方案设计 →
                  PRD草稿。竞品分析随时可做。选中的历史文档会一起发送给模型，不需要重复复制正文。
                </p>
                {(selectedType === "solution_design" ||
                  selectedType === "prd_draft") && (
                  <button
                    className="secondary"
                    onClick={() => continueWith(selectedType)}
                  >
                    带入最近的
                    {selectedType === "solution_design"
                      ? "需求分析"
                      : "需求分析和方案"}
                  </button>
                )}
              </details>
              <details className="context panel">
                <summary>
                  项目背景 <span>四类任务共用 · 点击查看或编辑</span>
                </summary>
                <div className="section-heading">
                  <div className="section-title">
                    <Icon name="folder" />
                    <h2>项目背景</h2>
                    <span className="subtle-badge">
                      项目阶段：{project.stage || "未设置"}
                    </span>
                  </div>
                  <button
                    className="text-btn"
                    onClick={() => openProject(true)}
                  >
                    编辑背景 <span>↗</span>
                  </button>
                </div>
                <div className="context-grid">
                  <div>
                    <span>业务对象</span>
                    <p>{project.business || "尚未填写"}</p>
                  </div>
                  <div>
                    <span>目标用户</span>
                    <p>{project.users || "尚未填写"}</p>
                  </div>
                  <div>
                    <span>已确认范围</span>
                    <p>{project.scope || "尚未填写"}</p>
                  </div>
                  <div>
                    <span>关键约束</span>
                    <p>{project.constraints || "尚未填写"}</p>
                  </div>
                </div>
                {project.unknowns && (
                  <div className="unknowns">
                    <span>待确认</span>
                    {project.unknowns}
                  </div>
                )}
              </details>
              <section
                className="panel task-panel"
                key={selectedType}
                role="tabpanel"
                aria-label={tasks[selectedType]?.name}
              >
                <button
                  className="text-btn knowledge-shortcut"
                  onClick={() => setModal("knowledge")}
                >
                  项目资料：{project.knowledge?.length || 0} 份 · 添加或管理
                </button>
                <label className="sr-only" htmlFor="task">
                  本次业务任务
                </label>
                <textarea
                  id="task"
                  className="task-input"
                  placeholder={tasks[draft.taskType]?.placeholder}
                  value={draft.task}
                  maxLength={20000}
                  disabled={!!busy}
                  onChange={(e) =>
                    patchDraft({
                      task: e.target.value,
                      questions: [],
                      clarification: "",
                    })
                  }
                />
                <TaskTemplate
                  key={taskKey(current, selectedType)}
                  type={selectedType}
                  project={project}
                  references={draft.historyIds}
                  apply={(text) => {
                    if (
                      draft.task.trim() &&
                      !confirm("用填空模板替换当前输入？")
                    )
                      return;
                    patchDraft({
                      task: text,
                      questions: [],
                      clarification: "",
                    });
                  }}
                />
                <div className="input-meta">
                  <span>从一个示例开始</span>
                  <span>{draft.task.length.toLocaleString()} / 20,000 字</span>
                </div>
                <div className="example-row">
                  {examples.map((ex) => (
                    <button
                      key={ex.name}
                      disabled={!!busy}
                      onClick={() =>
                        patchDraft({
                          task: ex.text,
                          taskType: ex.taskType,
                          questions: [],
                          clarification: "",
                        })
                      }
                    >
                      {ex.name}
                      <span>↗</span>
                    </button>
                  ))}
                </div>
                <details className="sources">
                  <summary>
                    添加参考资料{" "}
                    <span>可选 · 粘贴访谈、业务说明或已有需求</span>
                  </summary>
                  <label className="sr-only" htmlFor="sources">
                    参考资料
                  </label>
                  <textarea
                    id="sources"
                    value={draft.sources}
                    onChange={(e) => patchDraft({ sources: e.target.value })}
                    maxLength={50000}
                    disabled={!!busy}
                    placeholder="请标注来源，例如【访谈记录 1】。只粘贴链接不会自动读取网页。"
                  />
                  <small>
                    {draft.sources.length.toLocaleString()} / 50,000 字 ·
                    本次资料随任务发送；长期资料可保存在项目资料库。
                  </small>
                </details>
                {draft.questions.length > 0 && (
                  <div className="questions">
                    <strong>还需要你确认</strong>
                    <ol>
                      {draft.questions.map((q) => (
                        <li key={q}>{q}</li>
                      ))}
                    </ol>
                    <label>
                      补充信息
                      <textarea
                        value={draft.clarification}
                        onChange={(e) =>
                          patchDraft({ clarification: e.target.value })
                        }
                        maxLength={10000}
                        disabled={!!busy}
                        placeholder="直接补充即可，无需重新输入整个任务"
                      />
                    </label>
                  </div>
                )}
                {editing && (
                  <p className="notice warning">
                    你正在编辑文档，请先保存或取消修改，再开始新的分析。
                  </p>
                )}
                <details className="history-reference">
                  <summary>引用历史文档（可选）</summary>
                  <p>
                    只引用当前项目非演示版本。历史AI草稿不是已确认事实，最多3份、合计5万字。
                  </p>
                  {docs
                    .filter((d) => !d.demo)
                    .map((d) => (
                      <label key={d.id}>
                        <input
                          type="checkbox"
                          disabled={!!busy}
                          checked={draft.historyIds.includes(d.id)}
                          onChange={(e) =>
                            patchDraft({
                              historyIds: e.target.checked
                                ? [...draft.historyIds, d.id]
                                : draft.historyIds.filter((id) => id !== d.id),
                            })
                          }
                        />
                        <span>
                          v{d.version} · {d.title}
                        </span>
                      </label>
                    ))}
                </details>
                <div className="task-footer">
                  <small>
                    <span className="lock-mark">◇</span>{" "}
                    请勿输入未经授权的个人信息、商业秘密或生产凭证。
                  </small>
                  <div>
                    <button
                      className="text-btn"
                      disabled={!!busy}
                      onClick={() => patchDraft(newDraft(selectedType))}
                    >
                      清空
                    </button>
                    <button
                      className="primary"
                      disabled={
                        editing ||
                        !!busy ||
                        action ||
                        (!!draft.questions.length &&
                          !draft.clarification.trim())
                      }
                      onClick={generate}
                    >
                      {busy === current ? (
                        <>
                          <span className="spinner" />
                          正在生成
                        </>
                      ) : (
                        <>
                          开始分析 <Icon name="arrow" />
                        </>
                      )}
                    </button>
                  </div>
                </div>
                {busy && (
                  <div className="running" role="status">
                    <span className="spinner" />
                    <div>
                      <strong>
                        {busy === current
                          ? (
                              {
                                1: "理解任务与完整性检查",
                                2: "生成安全替代建议",
                                3: "生成需求诊断",
                                4: "设计AI方案",
                                5: "撰写PRD",
                                6: "生成竞品分析",
                                7: "整理任务引导",
                                8: "风险审核与最终整理",
                              } as Record<number, string>
                            )[
                              runs.find((r) => r.status === "running")?.stage ||
                                0
                            ] || "正在提交本次任务"
                          : "另一个项目正在分析"}
                      </strong>
                      <small>
                        正在后台处理，完成后自动保存。可以切到其他项目；请保持服务运行，复杂报告可能需要几分钟。
                      </small>
                    </div>
                    <button
                      className="text-btn"
                      disabled={action}
                      onClick={cancel}
                    >
                      取消任务
                    </button>
                  </div>
                )}
              </section>
              <section className="result-section" id="result">
                <div className="result-heading">
                  <div className="section-title">
                    <Icon name="file" />
                    <h2>
                      {selectedType === "auto"
                        ? "生成的文档"
                        : tasks[selectedType]?.name + " · 分析结果"}
                    </h2>
                    <span className="count">{taskDocs.length}</span>
                  </div>
                  {taskDocs.length > 0 && (
                    <label className="version-select">
                      版本
                      <select
                        aria-label="选择文档版本"
                        disabled={!!busy || editing}
                        value={docId}
                        onChange={(e) => {
                          if (editing && !confirm("放弃尚未保存的正文修改？"))
                            return;
                          setDocId(e.target.value);
                          setEditing(false);
                        }}
                      >
                        <option value="">本次任务状态 / 暂无新文档</option>
                        {taskDocs.map((d) => (
                          <option key={d.id} value={d.id}>
                            {tasks[d.taskType || "requirement_analysis"]?.name}{" "}
                            · v{d.version} ·{" "}
                            {d.demo
                              ? "演示"
                              : d.edited
                                ? "人工修订"
                                : "AI 生成"}{" "}
                            · {fmt(d.createdAt)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                {loading ? (
                  <div className="panel empty">
                    <span className="spinner" />
                    正在读取文档…
                  </div>
                ) : busy === current ? (
                  <div className="panel empty" role="status">
                    <span className="spinner" />
                    <h3>正在生成本次分析</h3>
                    <p>助理正在检查信息、生成文档并复核，请稍候。</p>
                  </div>
                ) : doc ? (
                  <article className="document panel">
                    <div className="doc-meta">
                      <span className="subtle-badge purple">
                        {tasks[doc.taskType || "requirement_analysis"]?.name ||
                          "文档"}{" "}
                        · v{doc.version}
                      </span>
                      <span>{fmt(doc.createdAt)}</span>
                      <span>文档编号 {doc.id.slice(0, 8)}</span>
                      <span>
                        {doc.edited
                          ? "人工修订"
                          : doc.demo
                            ? "模拟示例"
                            : "模型生成"}
                      </span>
                      <button
                        className="text-btn"
                        onClick={() => setDrawer(true)}
                      >
                        查看依据 <span>↗</span>
                      </button>
                    </div>
                    {!doc.demo && (
                      <div className="notice success">
                        <strong>
                          {doc.edited ? "人工修订文档" : "本次模型生成已完成"}
                        </strong>
                        <span>
                          {" "}
                          · v{doc.version} · {doc.model || "保留原始来源"} ·{" "}
                          {fmt(doc.createdAt)}
                        </span>
                        <p>任务：{doc.task}</p>
                      </div>
                    )}
                    {doc.demo && (
                      <div className="notice demo">
                        你正在查看预置示例，不是本次分析结果。真实生成会创建新版本；失败原因会在任务状态中显示。
                      </div>
                    )}
                    {doc.warnings?.map((w) => (
                      <div className="notice warning" key={w}>
                        {w}
                      </div>
                    ))}
                    {editing ? (
                      <>
                        <label className="edit-label">
                          编辑 Markdown 正文 · 保存后创建新版本
                        </label>
                        <textarea
                          className="document-editor"
                          value={editBody}
                          onChange={(e) => setEditBody(e.target.value)}
                          maxLength={120000}
                        />
                        <div className="edit-actions">
                          <button
                            className="secondary"
                            onClick={() => setEditing(false)}
                          >
                            取消修改
                          </button>
                          <button
                            className="primary"
                            disabled={action}
                            onClick={() =>
                              perform(async () => {
                                const n = await api(
                                  `projects/${current}/documents/${doc.id}`,
                                  "PUT",
                                  { body: editBody },
                                );
                                await loadRecords(current, n.id);
                                setEditing(false);
                                setToast("已另存为新版本");
                              })
                            }
                          >
                            保存为新版本
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="markdown">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            img: () => null,
                            a: ({ href, children }) => (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {children}
                              </a>
                            ),
                          }}
                        >
                          {doc.body}
                        </ReactMarkdown>
                      </div>
                    )}
                    <div className="document-toolbar">
                      <div>
                        <button
                          className="secondary"
                          onClick={() =>
                            perform(async () => {
                              await navigator.clipboard.writeText(doc.body);
                              setToast("全文已复制");
                            })
                          }
                        >
                          <Icon name="copy" />
                          复制全文
                        </button>
                        <button
                          className="secondary"
                          disabled={!!busy}
                          onClick={() => {
                            setEditBody(doc.body);
                            setEditing(true);
                          }}
                        >
                          继续编辑
                        </button>
                        <button
                          className="secondary"
                          onClick={() =>
                            download(
                              `${project.name}-${tasks[doc.taskType || "requirement_analysis"]?.name}-v${doc.version}.md`,
                              doc.body,
                            )
                          }
                        >
                          <Icon name="download" />
                          导出
                        </button>
                      </div>
                      <div>
                        <button
                          className="text-btn"
                          disabled={!!busy}
                          onClick={() => {
                            patchDraft({
                              task: doc.task,
                              taskType: doc.taskType || "requirement_analysis",
                              historyIds: doc.historyIds || [],
                              sources: doc.sources || "",
                              clarification: doc.clarification || "",
                              questions: [],
                            });
                            document.getElementById("task")?.focus();
                            setToast(
                              "原任务已填入，点击开始分析将重新调用模型",
                            );
                          }}
                        >
                          重新生成
                        </button>
                        {nextTask(doc.taskType || "requirement_analysis") && (
                          <button
                            className="text-btn"
                            disabled={!!busy}
                            onClick={() =>
                              continueWith(
                                nextTask(
                                  doc.taskType || "requirement_analysis",
                                )!,
                                doc,
                              )
                            }
                          >
                            {doc.taskType === "solution_design"
                              ? "采用此方案，去写PRD"
                              : "采用此需求，去设计方案"}
                          </button>
                        )}
                        <button
                          className="text-btn danger"
                          disabled={action}
                          onClick={() => {
                            if (
                              confirm(
                                `确定删除 v${doc.version}？删除后不可撤销。`,
                              )
                            )
                              perform(async () => {
                                await api(
                                  `projects/${current}/documents/${doc.id}`,
                                  "DELETE",
                                );
                                await loadRecords(current);
                                setToast("版本已删除");
                              });
                          }}
                        >
                          删除版本
                        </button>
                      </div>
                    </div>
                    <details className="trace-summary">
                      <summary>运行记录与提示词版本</summary>
                      <p>
                        提示词：{doc.promptVersion || "旧版"} ·
                        {doc.retrievalStatus === "matched"
                          ? "已引用相关项目资料"
                          : doc.retrievalStatus === "no_matches"
                            ? "已查找项目资料，没有匹配片段"
                            : "本次使用项目背景与任务中提供的资料"}
                        。以下是本次运行记录。
                      </p>
                      {doc.trace?.map((t, i) => (
                        <p key={i}>
                          步骤 {t.node} · {t.status} · {t.elapsed || 0} ms ·
                          请求编号 {t.responseId || "服务商未提供"}
                        </p>
                      ))}
                    </details>
                    <div className="saved-line">
                      <span>
                        <Icon name="check" />
                        已保存到项目 · {project.name}
                      </span>
                      {doc.usage && (
                        <span>
                          {doc.usage.total_tokens.toLocaleString()} Tokens ·{" "}
                          {Math.round((doc.elapsed || 0) / 1000)} 秒 ·{" "}
                          {doc.model}
                        </span>
                      )}
                    </div>
                  </article>
                ) : visibleRun ? (
                  <div
                    className={"panel task-outcome " + visibleRun.status}
                    role="status"
                  >
                    <span className="subtle-badge">
                      本次任务 ·{" "}
                      {runLabels[visibleRun.status] || visibleRun.status}
                    </span>
                    <h3>
                      {visibleRun.status === "high_risk"
                        ? "风险边界与安全替代方案"
                        : visibleRun.status === "guidance"
                          ? "选择下一步交付物"
                          : visibleRun.status === "needs_input"
                            ? "请先补充信息，再继续分析"
                            : visibleRun.status === "completed"
                              ? "该任务文档已删除"
                              : visibleRun.status === "running"
                                ? "任务仍在服务端运行"
                                : "本次没有生成新文档"}
                    </h3>
                    <p>
                      {visibleRun.error ||
                        (visibleRun.status === "needs_input"
                          ? "问题已显示在任务输入区。原输入保留，无需重填。"
                          : "可以从版本列表查看以前的文档。")}
                    </p>
                    {visibleRun.body && (
                      <div className="markdown">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{ img: () => null }}
                        >
                          {visibleRun.body}
                        </ReactMarkdown>
                      </div>
                    )}
                    {visibleRun.status === "failed" && visibleRun.draftBody && (
                      <details className="failed-draft">
                        <summary>查看已生成但未通过检查的草稿</summary>
                        <p>此草稿尚未通过检查，不能当作完成的报告。</p>
                        <div className="markdown">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{ img: () => null }}
                          >
                            {visibleRun.draftBody}
                          </ReactMarkdown>
                        </div>
                      </details>
                    )}
                    <p className="outcome-task">任务：{visibleRun.task}</p>
                    <div>
                      <button
                        className="primary"
                        disabled={!!busy}
                        onClick={() => {
                          patchDraft({
                            task: visibleRun.task,
                            taskType: tasks[visibleRun.taskType || ""]
                              ? visibleRun.taskType
                              : selectedType,
                            historyIds: visibleRun.historyIds || [],
                            sources: visibleRun.sources || "",
                            clarification: visibleRun.clarification || "",
                            questions: visibleRun.questions || [],
                          });
                          document.getElementById("task")?.focus();
                        }}
                      >
                        返回任务，修改后重试
                      </button>
                      <button
                        className="secondary"
                        onClick={() => setModal("settings")}
                      >
                        检查连接
                      </button>
                    </div>
                    <small>本次状态已记录，历史文档仍保留在版本列表。</small>
                  </div>
                ) : (
                  <div className="panel empty result-empty">
                    <div className="empty-icon">
                      <Icon name="file" />
                    </div>
                    <h3>下一份清晰的需求，从这里开始</h3>
                    <p>输入任务并开始分析，结果将自动保存到当前项目。</p>
                    <span>执行摘要 · MVP 范围 · 业务流程 · 验收标准</span>
                  </div>
                )}
              </section>
            </>
          )}
          <footer className="page-footer">
            <span>LEXIE · AI PRODUCT ASSISTANT</span>
            <span>让判断有依据，让想法可执行。</span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" />
          {toast}
        </div>
      )}
      {drawer && doc && (
        <div className="drawer-overlay">
          <button
            className="drawer-backdrop"
            aria-label="关闭依据面板"
            onClick={() => setDrawer(false)}
          />
          <aside
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label="依据与假设"
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">DOCUMENT CONTEXT</span>
                <h2>依据与假设</h2>
              </div>
              <button
                className="icon-btn"
                onClick={() => setDrawer(false)}
                aria-label="关闭依据面板"
              >
                <Icon name="close" />
              </button>
            </div>
            <p className="section-description">
              以下是本次文档使用的资料、分析建议和待确认事项，仍需要你核对。
            </p>
            {Object.entries(evidenceLabels).map(([key, label]) => (
              <section className="evidence-section" key={key}>
                <h3>{label}</h3>
                {Array.isArray(doc.evidence?.[key]) &&
                doc.evidence[key].length ? (
                  <ul>
                    {doc.evidence[key].map((v, i) => (
                      <li key={i}>{v}</li>
                    ))}
                  </ul>
                ) : (
                  <p>暂无记录，请人工补充。</p>
                )}
              </section>
            ))}
            <details className="snapshot">
              <summary>查看本次输入与项目快照</summary>
              <h4>任务输入</h4>
              <p>{doc.task}</p>
              <h4>参考资料</h4>
              <p>{doc.sources || "未提供"}</p>
              {doc.clarification && (
                <>
                  <h4>补充回答</h4>
                  <p>{doc.clarification}</p>
                </>
              )}
              {Object.entries(labels).map(([key, label]) => (
                <div key={key}>
                  <h4>{label}</h4>
                  <p>{doc.snapshot?.[key as keyof typeof blank] || "未填写"}</p>
                </div>
              ))}
            </details>
          </aside>
        </div>
      )}
      {(modal === "create" || modal === "edit") && (
        <Modal
          title={modal === "create" ? "新建项目" : "编辑项目背景"}
          close={closeModal}
        >
          <form onSubmit={saveProject}>
            <p className="section-description">
              只有项目名称必填，其他可稍后补充。项目背景会用于四类任务；项目阶段只是记录进度，不会限制你选择任务。
            </p>
            <div className="project-form">
              {Object.entries(labels).map(([k, label]) => (
                <label key={k}>
                  {label}
                  {(k === "business" || k === "users") && (
                    <span className="field-hint">
                      {k === "business"
                        ? "处理哪类业务或事情？例如：网页阅读批注、商品售后服务。"
                        : "谁会使用这个产品？例如：学生、职场人士、客服人员。"}
                    </span>
                  )}
                  <span className="field-hint">
                    {k === "name"
                      ? "必填 · 最多100字"
                      : k === "stage"
                        ? "选填 · 单选"
                        : "选填 · 最多6000字"}
                  </span>
                  {k === "stage" ? (
                    <select
                      value={form.stage}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, stage: e.target.value }))
                      }
                    >
                      <option value="">暂不选择</option>
                      {!stages.includes(form.stage) && form.stage && (
                        <option value={form.stage}>
                          {form.stage}（原阶段）
                        </option>
                      )}
                      {stages.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  ) : k === "name" ? (
                    <input
                      required={k === "name"}
                      value={form[k as keyof typeof blank]}
                      maxLength={k === "name" ? 100 : 6000}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, [k]: e.target.value }))
                      }
                    />
                  ) : (
                    <textarea
                      rows={2}
                      value={form[k as keyof typeof blank]}
                      maxLength={6000}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, [k]: e.target.value }))
                      }
                    />
                  )}
                </label>
              ))}
            </div>
            {error && <div className="notice error">{error}</div>}
            <div className="modal-actions">
              {modal === "edit" && (
                <button
                  type="button"
                  className="text-btn danger"
                  disabled={action || !!busy}
                  onClick={() => {
                    if (
                      confirm(
                        "删除项目会一并删除该项目的全部任务与文档，是否继续？",
                      )
                    )
                      perform(async () => {
                        await api(`projects/${current}`, "DELETE");
                        await loadProjects();
                        setModal("");
                        setToast("项目已删除");
                      });
                  }}
                >
                  删除项目
                </button>
              )}
              <button type="button" className="secondary" onClick={closeModal}>
                取消
              </button>
              <button className="primary" disabled={action}>
                保存项目
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "settings" && (
        <Modal title="连接与资料" close={closeModal}>
          <div className="settings-status">
            <span
              className={
                "status-dot " +
                (settings.hasKey && settings.hasModel ? "completed" : "failed")
              }
            />
            <strong>
              {connection ||
                (settings.hasKey && settings.hasModel
                  ? "已配置 · 尚未测试"
                  : "未配置")}
            </strong>
          </div>
          <p>模型：{settings.model || "尚未填写模型名称"}</p>
          <div className="capability-list">
            <p>
              <strong>项目资料库</strong>
              <span>
                {project?.knowledge?.length
                  ? `已有 ${project.knowledge.length} 份资料，生成时自动查找相关内容`
                  : "还没有资料，可添加文字或导入文件"}
              </span>
            </p>
            <button
              className="secondary"
              disabled={!project}
              onClick={() => setModal("knowledge")}
            >
              管理当前项目资料
            </button>
            <p>
              <strong>联网搜索</strong>
              <span>
                {settings.capabilities.webSearch
                  ? "已启用"
                  : "此版本没有搜索服务；模型连接成功不代表能搜索网页。"}
              </span>
            </p>
          </div>
          <p className="section-description">
            密钥只保存在服务端，不在网页中填写或回显。配置后需重启应用。
          </p>
          <ol className="help-list">
            <li>
              本地：将根目录的 <code>.env.example</code> 复制为{" "}
              <code>.env.local</code>。
            </li>
            <li>
              填写 <code>DEEPSEEK_API_KEY</code> 和 <code>DEEPSEEK_MODEL</code>
              。本地打开不再需要密码。
            </li>
            <li>
              在线：在部署平台设置同名环境变量，并挂载持久化磁盘保存数据。
            </li>
          </ol>
          <div className="notice warning">
            连接测试会发起一次真实的小额模型调用。请勿将 .env.local 上传到
            GitHub。
          </div>
          {error && <div className="notice error">{error}</div>}
          <div className="modal-actions">
            <button
              className="secondary"
              disabled={action}
              onClick={() =>
                perform(async () => {
                  await refreshSettings();
                  setConnection("");
                })
              }
            >
              刷新配置状态
            </button>
            <button
              className="primary"
              disabled={action}
              onClick={() =>
                perform(async () => {
                  setConnection("正在连接");
                  try {
                    await api("settings", "POST", {});
                    setConnection("已连接");
                    setToast("模型连接测试成功");
                  } catch (e) {
                    setConnection("连接失败");
                    throw e;
                  }
                })
              }
            >
              测试连接
            </button>
          </div>
        </Modal>
      )}
      {modal === "knowledge" && project && (
        <Modal title="项目资料库" close={closeModal}>
          <p className="section-description">
            保存产品介绍、访谈或业务规则。生成时自动查找相关片段，并保留来源。每个项目最多20份，总计20万字。
          </p>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <div className="knowledge-list">
            {(project.knowledge || []).map((item) => (
              <div key={item.id}>
                <strong>{item.title}</strong>
                <span>{item.text.length.toLocaleString()} 字</span>
                {deleteKnowledgeId === item.id ? (
                  <span className="delete-confirm">
                    <button
                      type="button"
                      disabled={action}
                      className="text-btn danger"
                      onClick={() =>
                        perform(async () => {
                          const result = await api(
                            `projects/${current}/knowledge/${item.id}`,
                            "DELETE",
                          );
                          setProjects((old) =>
                            old.map((p) =>
                              p.id === current
                                ? { ...p, knowledge: result.knowledge }
                                : p,
                            ),
                          );
                          setDeleteKnowledgeId("");
                          setToast("资料已删除；已有文档保留");
                        })
                      }
                    >
                      确认删除
                    </button>
                    <button
                      type="button"
                      className="text-btn"
                      onClick={() => setDeleteKnowledgeId("")}
                    >
                      取消
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={action}
                    className="text-btn danger"
                    onClick={() => setDeleteKnowledgeId(item.id)}
                  >
                    删除
                  </button>
                )}
              </div>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              perform(async () => {
                await api(`projects/${current}/knowledge`, "POST", {
                  title: knowledgeTitle,
                  text: knowledgeText,
                });
                await loadProjects(current);
                setKnowledgeTitle("");
                setKnowledgeText("");
                setToast("资料已保存，下一次生成即可使用");
              });
            }}
          >
            <label className="import-knowledge">
              先导入文件（Markdown / TXT）
              <input
                type="file"
                accept=".md,.txt,text/plain,text/markdown"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (!/\.(md|txt)$/i.test(f.name) || f.size > 200000) {
                    setError("请选择不超过200KB的Markdown或TXT文件");
                    return;
                  }
                  const text = await f.text();
                  if (text.length > 50000) {
                    setError("单份资料最多50000字");
                    return;
                  }
                  setKnowledgeTitle(f.name.slice(0, 100));
                  setKnowledgeText(text);
                  e.target.value = "";
                  setToast("已自动填入名称和正文，请检查后点击保存资料");
                }}
              />
            </label>
            <p className="section-description">
              导入后，下面的名称和正文会自动填好，不用再复制。也可以不导入，直接在下面填写。保存后可继续添加下一份。
            </p>{" "}
            <label>
              资料名称 · 导入会自动填写，可修改 · 最多100字
              <input
                required
                maxLength={100}
                value={knowledgeTitle}
                onChange={(e) => setKnowledgeTitle(e.target.value)}
              />
            </label>
            <label>
              资料正文 · 导入会自动填写，也可直接粘贴 ·{" "}
              {knowledgeText.length.toLocaleString()} / 50000字
              <textarea
                required
                rows={7}
                maxLength={50000}
                value={knowledgeText}
                onChange={(e) => setKnowledgeText(e.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={closeModal}>
                关闭
              </button>
              <button className="primary" disabled={action}>
                保存资料
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "changelog" && (
        <Modal title="更新日志" close={closeModal}>
          <div className="help-content">
            <h3>V2.2 · 2026年11月5日</h3>
            <p>
              删除重复输入标题与序号；新增填空模板、需求→方案→PRD文档衔接、项目后台运行；改善资料导入和删除；格式不完整先自动整理一次，失败保留草稿。
            </p>
            <h3>V2.1 · 2026年11月5日</h3>
            <p>
              PMATE品牌、本地免密码、五任务独立输入和结果、项目资料库、任务记录删除、阶段下拉选择。
            </p>
            <h3>V2.0 · 2026年11月5日</h3>
            <p>
              迁移老师八节点专业提示词，接入四类交付物、独立风险审核和来源检查。
            </p>
            <h3>V1.1 / V1.0</h3>
            <p>
              项目管理、需求分析、DeepSeek连接、历史版本与备份；之后调整初版界面。
            </p>
          </div>
        </Modal>
      )}
      {modal === "help" && (
        <Modal title="帮助与数据备份" close={closeModal}>
          <div className="help-content">
            <h3>PMATE 是什么意思？</h3>
            <p>
              PM 是 Product Manager（产品经理），mate
              是伙伴。两部分共享字母M：PM + MATE →
              PMATE，意思是产品经理的工作伙伴，ATE不是单独的缩写。
            </p>
            <h3>保存在哪里？</h3>
            <p>
              在线体验版将项目、资料和历史文档保存在当前浏览器中；刷新页面后仍在。换浏览器、清除浏览器数据或使用无痕模式时不会保留，重要内容请导出备份。模型生成在服务端完成，API Key 不会出现在浏览器中。
            </p>
            <h3>如何开始</h3>
            <p>
              新建项目并填写背景，选择示例或描述任务，再点击“开始分析”。如有关键追问，在原任务下补充即可继续。
            </p>
            <h3>结果如何保存</h3>
            <p>
              成功生成的结果自动保存到当前项目。继续编辑会创建新版本；取消修改保留原文。可复制正文或导出
              Markdown。
            </p>
            <h3>演示和真实结果</h3>
            <p>
              预置项目和示例文档是模拟内容。点击开始分析才会真实调用模型，失败不会用演示结果替代。AI
              输出仍需人工检查。
            </p>
            <h3>隐私与使用边界</h3>
            <p>
              项目、任务与参考资料会发送给配置的模型服务商。仅输入有权使用的资料，避免个人敏感信息、商业秘密和生产凭证。备份文件也包含项目资料，请妥善保管。
            </p>
            <h3>备份与恢复</h3>
            <p>
              备份包含全部项目和文档版本，不包含 API
              密钥，也不包含运行日志。恢复会创建带“导入”后缀的副本，不覆盖现有项目。
            </p>
            <div className="backup-actions">
              <button
                className="secondary"
                onClick={() =>
                  perform(async () =>
                    download(
                      "AI-PM-项目备份.json",
                      JSON.stringify(await api("backup"), null, 2),
                      "application/json",
                    ),
                  )
                }
              >
                <Icon name="download" />
                导出全部项目
              </button>
              <button
                className="secondary"
                onClick={() => fileRef.current?.click()}
                disabled={action || !!busy}
              >
                导入备份副本
              </button>
              <input
                ref={fileRef}
                className="sr-only"
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 2000000) {
                    setError("备份文件不能超过 2 MB");
                    e.target.value = "";
                    return;
                  }
                  if (confirm("将备份作为新项目副本导入，是否继续？"))
                    perform(async () => {
                      const data = JSON.parse(await f.text());
                      const r = await api("restore", "POST", data);
                      await loadProjects();
                      setToast(`已导入 ${r.count} 个项目副本`);
                    });
                  e.target.value = "";
                }}
              />
            </div>
            {error && <div className="notice error">{error}</div>}
          </div>
        </Modal>
      )}
    </div>
  );
}
