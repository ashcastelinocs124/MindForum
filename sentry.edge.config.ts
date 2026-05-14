// Sentry init for the Edge runtime — used by `middleware.ts`. Same posture as
// the Node config but the SDK ships a slimmer build that runs under
// edge-runtime constraints (no Node globals, no fs).

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}
