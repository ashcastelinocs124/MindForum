import { test } from "node:test";
import assert from "node:assert/strict";
import { summaryBlock, resolveDocumentRead, needsSummary, MAX_FILE_CHARS } from "./doc-context.ts";

const f = (over = {}) => ({
  name: "doc.md", summary: "A short summary.", extractedText: "FULL TEXT", ...over,
});

test("summaryBlock: empty list → empty string", () => {
  assert.equal(summaryBlock([]), "");
});

test("summaryBlock: uses name + summary when summary present", () => {
  const out = summaryBlock([f({ name: "a.md", summary: "Summary A." })]);
  assert.match(out, /a\.md/);
  assert.match(out, /Summary A\./);
  assert.doesNotMatch(out, /FULL TEXT/);
});

test("summaryBlock: NULL summary falls back to truncated full text", () => {
  const big = "X".repeat(MAX_FILE_CHARS + 50);
  const out = summaryBlock([f({ name: "b.md", summary: null, extractedText: big })]);
  assert.match(out, /b\.md/);
  // truncated to MAX_FILE_CHARS
  assert.ok(out.includes("X".repeat(100)));
  assert.ok(!out.includes("X".repeat(MAX_FILE_CHARS + 50)));
});

test("resolveDocumentRead: returns capped full text for a selected file", () => {
  const big = "Y".repeat(MAX_FILE_CHARS + 10);
  const r = resolveDocumentRead([f({ name: "c.md", extractedText: big })], "c.md");
  assert.equal(r.found, true);
  assert.equal(r.text.length, MAX_FILE_CHARS);
});

test("resolveDocumentRead: unknown name → not found", () => {
  const r = resolveDocumentRead([f({ name: "c.md" })], "nope.md");
  assert.equal(r.found, false);
  assert.match(r.text, /no such document/i);
});

test("needsSummary: true only when summary is null/empty", () => {
  assert.equal(needsSummary(f({ summary: null })), true);
  assert.equal(needsSummary(f({ summary: "" })), true);
  assert.equal(needsSummary(f({ summary: "x" })), false);
});
