import { selectResultDocument } from "./result-view.mjs";
export const taskKey = (projectId, type) => `${projectId}:${type}`;
export function taskRecords(documents, runs, type, preferred) {
  const belongs = (item) =>
    type === "auto" || (item.taskType || "requirement_analysis") === type;
  const docs = documents.filter(belongs),
    history = runs.filter(belongs);
  return {
    docs,
    runs: history,
    documentId: selectResultDocument(
      docs,
      history,
      preferred && !docs.some((d) => d.id === preferred)
        ? undefined
        : preferred,
    ),
  };
}
