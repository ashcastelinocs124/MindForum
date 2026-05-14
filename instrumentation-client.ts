// Sentry init for the browser. Next 15 picks this up automatically; the file
// must live at the project root and use the `instrumentation-client` name.
//
// `NEXT_PUBLIC_SENTRY_DSN` is the client-exposed copy of the DSN. DSNs are
// safe to ship to the browser (they only grant event ingest), but we still
// keep both server and client gated on env presence so dev / preview builds
// without the env var simply no-op.

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    // No Session Replay — would record form input + chat content.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    ignoreErrors: [
      "ResizeObserver loop",
      "Non-Error promise rejection captured",
    ],
  });
}

// Wire router transitions so error events get the route name.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
