import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSort } from "./admin-sort.ts";

test("default when no input", () => {
  assert.deepEqual(resolveSort(undefined, undefined), {
    column: "last_message_at",
    direction: "DESC",
  });
});

test("valid sort key passes through", () => {
  assert.deepEqual(resolveSort("msgs_7d", "asc"), {
    column: "msgs_7d",
    direction: "ASC",
  });
});

test("invalid sort key falls back to default", () => {
  assert.deepEqual(resolveSort("'; DROP TABLE rooms;--", "desc"), {
    column: "last_message_at",
    direction: "DESC",
  });
});

test("invalid direction falls back to DESC", () => {
  const r = resolveSort("name", "sideways");
  assert.equal(r.direction, "DESC");
});

test("name accepts both asc and desc", () => {
  assert.equal(resolveSort("name", "asc").direction, "ASC");
  assert.equal(resolveSort("name", "desc").direction, "DESC");
});
