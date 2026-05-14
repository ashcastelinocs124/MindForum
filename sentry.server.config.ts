// Sentry init for the Node.js runtime (API routes, server components,
// instrumentation). Loaded by `instrumentation.ts` when NEXT_RUNTIME === 'nodejs'.
//
// Privacy posture (per ~/admin/agent-infra/sentry-setup.md):
//   - sendDefaultPii: false — no IPs, no headers, no UA capture
//   - no Session Replay
//   - we never call setUser with email; only id when known
//
// Error reporting only; no performance tracing (tracesSampleRate: 0).

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    // Drop known noise.
    ignoreErrors: [
      "ResizeObserver loop",
      "Non-Error promise rejection captured",
    ],
  });
}
