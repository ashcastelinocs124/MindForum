import { test } from "node:test";
import assert from "node:assert/strict";
import { decideContextMode, renderRecapBlock, GATE, RECENT_WINDOW } from "./chat-context.ts";

test("constants are 20 / 8", () => {
  assert.equal(GATE, 20);
  assert.equal(RECENT_WINDOW, 8);
});

test("decideContextMode: at/under gate → raw", () => {
  assert.equal(decideContextMode({ chatCount: 1, deltaSize: 0 }), "raw");
  assert.equal(decideContextMode({ chatCount: 20, deltaSize: 99 }), "raw"); // count wins
});

test("decideContextMode: over gate, small delta → recap-nofold", () => {
  assert.equal(decideContextMode({ chatCount: 21, deltaSize: 8 }), "recap-nofold");
  assert.equal(decideContextMode({ chatCount: 60, deltaSize: 1 }), "recap-nofold");
});

test("decideContextMode: over gate, large delta → recap-fold", () => {
  assert.equal(decideContextMode({ chatCount: 21, deltaSize: 9 }), "recap-fold");
  assert.equal(decideContextMode({ chatCount: 60, deltaSize: 40 }), "recap-fold");
});

test("renderRecapBlock: empty bullets → empty string", () => {
  assert.equal(renderRecapBlock([], { names: [], decisions: [], files: [] }), "");
});

test("renderRecapBlock: includes bullets + pinned facts, labeled as summary", () => {
  const out = renderRecapBlock(["Group debated X.", "Chose Y."], {
    names: ["Ana"], decisions: ["Use Y"], files: ["spec.md"],
  });
  assert.match(out, /summary/i);
  assert.match(out, /Group debated X\./);
  assert.match(out, /Chose Y\./);
  assert.match(out, /Ana/);
  assert.match(out, /Use Y/);
  assert.match(out, /spec\.md/);
});
