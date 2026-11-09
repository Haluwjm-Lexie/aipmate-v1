// A failed attempt has no result. Historical documents remain explicitly selectable.
export function selectResultDocument(documents, runs, preferred) {
  if (preferred !== undefined)
    return documents.some((d) => d.id === preferred) ? preferred : "";
  const last = runs[0];
  if (last)
    return last.status === "completed" &&
      documents.some((d) => d.id === last.documentId)
      ? last.documentId
      : "";
  return documents[0]?.id || "";
}
