// Next.js 15 instrumentation hook. Called once per runtime (Node, Edge) at
// process boot, before any request handlers run. The `NEXT_RUNTIME` env var
// is set by Next so the right SDK config loads.
//
// Also exports `onRequestError` — Next 15's App Router hook for capturing
// errors thrown in server components, route handlers, and server actions
// that would otherwise bubble to the framework error boundary and disappear.

import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  } else if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
