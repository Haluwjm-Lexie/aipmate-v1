// Local text retrieval only. No network, embeddings or invented sources.
export function validateKnowledge(items = []) {
  if (!Array.isArray(items) || items.length > 20)
    throw Error("每个项目最多保存20份资料");
  let total = 0;
  for (const item of items) {
    if (
      !item ||
      typeof item.title !== "string" ||
      !item.title.trim() ||
      item.title.length > 100 ||
      typeof item.text !== "string" ||
      !item.text.trim() ||
      item.text.length > 50000 ||
      typeof item.id !== "string" ||
      !/^[\w-]+$/.test(item.id)
    )
      throw Error("资料格式错误：标题最多100字，正文最多50000字");
    total += item.text.length;
  }
  if (total > 200000) throw Error("项目资料总量不能超过20万字");
  return items;
}
const terms = (s) => {
  const words = s.toLowerCase().match(/[a-z0-9_]{2,}/g) || [];
  for (const run of s.match(/[\u4e00-\u9fff]+/g) || [])
    for (let i = 0; i < run.length - 1; i++) words.push(run.slice(i, i + 2));
  return [...new Set(words)];
};
export function retrieveKnowledge(items, query) {
  validateKnowledge(items);
  const q = terms(query);
  return items
    .flatMap((item) => {
      const chunks = [];
      for (let offset = 0; offset < item.text.length; offset += 1200) {
        const text = item.text.slice(offset, offset + 1600);
        const hay = (item.title + "\n" + text).toLowerCase();
        const score = q.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
        if (score)
          chunks.push({
            id: `K${item.id}_${offset}`,
            kind: "project_knowledge",
            title: item.title,
            text,
            score,
          });
      }
      return chunks;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}
