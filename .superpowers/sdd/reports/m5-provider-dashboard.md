# M5 provider dashboard

Added the SUPER_ADMIN-only `/providers` dashboard extension. It lists provider health and model metadata, supports creating and editing OpenAI providers and models, and submits health checks through the specified same-origin API. Provider and model ordering, timeouts, capability flags, optional per-million-token prices, enabled states, and health timestamps are visible and editable where appropriate. Model IDs are entered explicitly with no preselected model.

API keys are only ever entered into blank password fields. Existing key values are never rendered; an empty key on edit sends `null` to preserve the saved value, while success clears the client field. UI errors map HTTP status to fixed Thai copy and never display response payloads. Forms disable during submission, show pending and success/error feedback, refresh after success, and explain the reload path for stale/duplicate `409` results. Empty providers/models and the route error boundary have dedicated states. Styling extends the ticket dashboard’s Thai type, green/neutral palette, controls, and responsive conventions.

The route authenticates with `requireStaff()`, returns `notFound()` for non-SUPER_ADMIN users, and loads through the server-side `listProviders(staff.id)` service. The DTO exposes only `keyConfigured`, never key material.

The Impeccable detector completed with no findings. The focused ESLint process for the larger client form component exited from Node out-of-memory while other work was active; no lint diagnostic was produced. I avoided a global TypeScript run per the low-memory coordination instruction. No browser, database, or provider call was made; root’s full gate should run lint/type/build and verify API flows.

## Root acceptance evidence

Full lint, TypeScript and production build passed after integration. Actual local production browser checks pass all 12 cases with real Auth and temporary trusted local profiles; the 390px screenshot was visually inspected. Main development browser also passes Super Admin access, IT/Library denial, reload, logout and post-logout401. Keys and ciphertext do not appear in HTML/API readback. Health derives from refreshed server state; key fields share the backend512-character limit.
