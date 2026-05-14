"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

/** Bare-bones admin modal — backdrop, ESC to close, focus-trap-light.
 *  Not a generic component; tuned for the admin row action modals. */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    // Auto-focus the first focusable element.
    const first = ref.current?.querySelector<HTMLElement>(
      "input, textarea, button",
    );
    first?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        ref={ref}
        style={{
          background: "white",
          borderRadius: 10,
          padding: 22,
          minWidth: 360,
          maxWidth: 640,
          width: "92%",
          maxHeight: "85vh",
          overflowY: "auto",
          boxShadow: "0 20px 40px rgba(19,41,75,0.15), 0 4px 12px rgba(19,41,75,0.1)",
          borderTop: "3px solid var(--orange)",
        }}
      >
        <div
          style={{
            fontWeight: 600,
            fontSize: 17,
            marginBottom: 14,
            color: "var(--navy)",
          }}
        >
          {title}
        </div>
        {children}
      </div>
    </div>
  );
}
