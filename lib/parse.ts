import pdfParse from "pdf-parse";
import mammoth from "mammoth";

export type ParseResult = { text: string; mime: string };

export async function parseFile(name: string, mime: string, buf: Buffer): Promise<ParseResult> {
  const lower = name.toLowerCase();

  if (mime === "application/pdf" || lower.endsWith(".pdf")) {
    const res = await pdfParse(buf);
    return { text: res.text ?? "", mime: "application/pdf" };
  }

  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx")
  ) {
    const res = await mammoth.extractRawText({ buffer: buf });
    return {
      text: res.value ?? "",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }

  if (mime.startsWith("text/") || lower.endsWith(".txt") || lower.endsWith(".md")) {
    return { text: buf.toString("utf8"), mime: mime || "text/plain" };
  }

  throw new Error(`unsupported_file_type:${mime || lower}`);
}
