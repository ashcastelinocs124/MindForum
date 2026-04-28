"use client";
import { useState } from "react";

export default function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // clipboard API unavailable — fall back to a prompt
          window.prompt("Copy this URL:", url);
        }
      }}
      style={{ fontSize: 12, padding: "2px 8px", cursor: "pointer" }}
      aria-label={`Copy link to ${url}`}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
