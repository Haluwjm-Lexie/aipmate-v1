import { test } from "node:test";
import assert from "node:assert/strict";
import { selectResultDocument } from "../lib/result-view.mjs";
test("failed or pending attempts never select the previous demo as a new result", () => {
  const docs = [{ id: "demo", demo: true }];
  for (const status of ["failed", "cancelled", "running", "needs_input"])
    assert.equal(selectResultDocument(docs, [{ status }]), "");
  assert.equal(selectResultDocument(docs, []), "demo");
});
test("completed run selects its own document; explicit historical selection remains available", () => {
  const docs = [{ id: "new" }, { id: "old" }];
  assert.equal(
    selectResultDocument(docs, [{ status: "completed", documentId: "new" }]),
    "new",
  );
  assert.equal(
    selectResultDocument(docs, [{ status: "failed" }], "old"),
    "old",
  );
  assert.equal(
    selectResultDocument(docs, [
      { status: "completed", documentId: "deleted" },
    ]),
    "",
  );
});
