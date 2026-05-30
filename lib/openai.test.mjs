import { test } from "node:test";
import assert from "node:assert/strict";
import { chatReplyStream } from "./openai.ts";

// Build a fake OpenAI whose .chat.completions.create returns a scripted stream.
function fakeOpenAI(scripts) {
  let call = 0;
  return {
    chat: {
      completions: {
        create: async () => {
          const chunks = scripts[call++];
          return (async function* () { for (const c of chunks) yield c; })();
        },
      },
    },
  };
}
const content = (s) => ({ choices: [{ delta: { content: s } }] });
const toolCall = (id, name, args) => ({
  choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: args } }] } }],
});
const files = [{ name: "a.md", summary: "sum", extractedText: "FULL A", selected: true,
  id: "1", roomId: "r", mime: "text/markdown", sizeBytes: 1, uploadedById: "u",
  uploadedAt: 0, sourceType: "uploaded", sourceUrl: null, sourceMeta: null }];

test("answers directly → streams tokens, no read_document", async () => {
  const reads = [];
  const gen = chatReplyStream([], files, "", {
    openai: fakeOpenAI([[content("Hello "), content("world")]]),
    onReadDocument: (n) => reads.push(n),
  });
  let out = ""; for await (const t of gen) out += t;
  assert.equal(out, "Hello world");
  assert.deepEqual(reads, []);
});

test("escalates → reads a doc, then streams the final answer", async () => {
  const reads = [];
  const gen = chatReplyStream([], files, "", {
    openai: fakeOpenAI([
      [toolCall("call_1", "read_document", JSON.stringify({ name: "a.md" }))],
      [content("Per the file, X.")],
    ]),
    onReadDocument: (n) => reads.push(n),
  });
  let out = ""; for await (const t of gen) out += t;
  assert.equal(out, "Per the file, X.");
  assert.deepEqual(reads, ["a.md"]);
});

test("unknown file read → not reported, model still answers", async () => {
  const reads = [];
  const gen = chatReplyStream([], files, "", {
    openai: fakeOpenAI([
      [toolCall("call_1", "read_document", JSON.stringify({ name: "ghost.md" }))],
      [content("Sorry, no data.")],
    ]),
    onReadDocument: (n) => reads.push(n),
  });
  let out = ""; for await (const t of gen) out += t;
  assert.equal(out, "Sorry, no data.");
  assert.deepEqual(reads, []); // ghost.md not found → not grounded
});
