import OpenAI from "openai";
import type { Message, RoomFile } from "./store";

const MODEL_CHAT = process.env.OPENAI_MODEL || "gpt-5.4";
const MODEL_BRIEF = process.env.OPENAI_MODEL_BRIEF || MODEL_CHAT;
const MAX_FILE_CHARS = 200_000;
const MAX_HISTORY = 30;

function client(): OpenAI {
  // Instantiated per-call so missing env vars fail at request time, not build time.
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function fileBlock(files: RoomFile[]): string {
  if (files.length === 0) return "";
  const parts = files.map(
    (f) => `--- FILE: ${f.name} ---\n${f.extractedText.slice(0, MAX_FILE_CHARS)}`
  );
  return `\n\nShared files selected by the room:\n${parts.join("\n\n")}`;
}

function historyBlock(messages: Message[]): { role: "user" | "assistant"; content: string }[] {
  const recent = messages.slice(-MAX_HISTORY);
  return recent.map((m) => ({
    role: m.authorId === "ai" ? "assistant" : "user",
    content: m.authorId === "ai" ? m.content : `${m.authorName}: ${m.content}`,
  }));
}

function roomGuidanceBlock(systemPrompt: string): string {
  const trimmed = systemPrompt.trim();
  if (!trimmed) return "";
  return `\n\nRoom-specific guidance from the organizer (follow it unless it conflicts with these instructions):\n${trimmed}`;
}

function chatSystemPrompt(files: RoomFile[], systemPrompt: string): string {
  return `You are an AI collaborator in a MindForum room — a small group brainstorming together. Keep replies concise and useful. Reference the shared files when relevant. Stay grounded in what people have actually said; don't invent context.${roomGuidanceBlock(systemPrompt)}${fileBlock(files)}`;
}

export async function chatReply(
  messages: Message[],
  files: RoomFile[],
  systemPrompt = ""
): Promise<string> {
  const res = await client().chat.completions.create({
    model: MODEL_CHAT,
    messages: [
      { role: "system", content: chatSystemPrompt(files, systemPrompt) },
      ...historyBlock(messages),
    ],
  });
  return res.choices[0]?.message?.content?.trim() ?? "";
}

export async function* chatReplyStream(
  messages: Message[],
  files: RoomFile[],
  systemPrompt = ""
): AsyncGenerator<string, void, void> {
  const stream = await client().chat.completions.create({
    model: MODEL_CHAT,
    stream: true,
    messages: [
      { role: "system", content: chatSystemPrompt(files, systemPrompt) },
      ...historyBlock(messages),
    ],
  });
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}

export type Brief = {
  themes: string[];
  outline: { section: string; points: string[] }[];
  risks: string[];
  nextSteps: string[];
  suggestedCollaborators: string[];
};

export async function generateBrief(
  messages: Message[],
  files: RoomFile[],
  systemPrompt = ""
): Promise<Brief> {
  const system = `You turn a MindForum conversation and shared files into a structured project brief. Be specific, not generic. Every item should be grounded in the conversation or the files. If a section has no grounding, return an empty array for it rather than inventing content.${roomGuidanceBlock(systemPrompt)}${fileBlock(files)}`;
  const res = await client().chat.completions.create({
    model: MODEL_BRIEF,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "ProjectBrief",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            themes: { type: "array", items: { type: "string" } },
            outline: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  section: { type: "string" },
                  points: { type: "array", items: { type: "string" } },
                },
                required: ["section", "points"],
              },
            },
            risks: { type: "array", items: { type: "string" } },
            nextSteps: { type: "array", items: { type: "string" } },
            suggestedCollaborators: { type: "array", items: { type: "string" } },
          },
          required: ["themes", "outline", "risks", "nextSteps", "suggestedCollaborators"],
        },
      },
    },
    messages: [{ role: "system", content: system }, ...historyBlock(messages)],
  });
  const raw = res.choices[0]?.message?.content ?? "{}";
  return JSON.parse(raw) as Brief;
}
