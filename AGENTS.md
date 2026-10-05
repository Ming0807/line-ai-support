<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# YRU project instructions

## Required reading before work

1. Read [project index](docs/PROJECT_INDEX.md), [current task board](docs/tasks/V1_TASK_BOARD.md) and [decision log](docs/decisions/DECISION_LOG.md).
2. Read the [master guide](CODEX_IMPLEMENTATION_GUIDE_YRU_AI_HELPDESK.md), relevant [original sources](docs/requirements/sources/README.md) and the task's rows in the [requirements matrix](docs/requirements/V1_REQUIREMENTS_MATRIX.md).
3. Read [system design](docs/architecture/YRU_V1_DESIGN.md), the relevant subsystem design and its execution plan before changing behavior.
4. For Next.js changes, read the relevant installed guide in `node_modules/next/dist/docs/` as required above. Check the installed APIs rather than relying on recalled versions.

Latest human instructions override earlier examples and implementation choices. If sources conflict, record the conflict and resolution in the decision log. An old report or plan is historical evidence, not authority to contradict the current requirements. Do not invent missing requirements or silently reduce scope.

## Scope and invariants

- Follow LINE → Ticket → AI/RAG, then Import → Structured Data → Advanced → final Flow A–F verification. Current prerequisite work is listed in the task board.
- Startup generation uses verified free services, primarily OpenCode Zen/OpenRouter; FREE_ONLY blocks unknown/paid inference. Latest human update selects local CPU `intfloat/multilingual-e5-small` / 384 as default embedding infrastructure, outside normal Provider UI. Follow [embedding design](docs/architecture/EMBEDDING_SERVICE_DESIGN.md): offline existing cache, query/passage prefixes, normalized vectors, no automatic old-cache deletion or model download. Paid generation/fallback is a later explicit university UI choice.
- Provider management includes Provider/Model ordering with up/down controls, per-model HTTP and quota observations and per-model test buttons. Follow [provider design](docs/architecture/AI_PROVIDER_DESIGN.md); a numeric priority field or provider-only health check does not complete this requirement.
- Anonymous V1: no students/profile/grade/enrollment database. Protect technical LINE identities; staff access remains department and sensitivity scoped.
- Preserve both working webhook routes: raw-body HMAC before JSON parsing, safe event handling and no secret/access/reply token logging.
- The backend validates and executes tools. AI cannot execute arbitrary SQL, auto-publish knowledge, bypass ticket state transitions or reply to a HUMAN ticket.
- One user may have multiple conversations/tickets. Do not route all messages to the latest ticket or use keywords as the final router.
- Imports update data and versions, not schema. No per-year tables, automatic DDL or deletion of old versions. Publication requires review; current/effective/authority/applicability filtering precedes similarity.
- Provider/LINE/network work stays outside SQL transactions. Preserve queue idempotency, leases, revisions, ownership and delivery/publication locks documented in the design.
- Do not commit `.env`, account passwords, private originals or tokens. Existing local credentials are not documentation content.

## Planning, delegation and completion

- Use a task ID, linked requirements, explicit files, dependencies and acceptance checks before implementation. See [working protocol](docs/agents/WORKING_PROTOCOL.md).
- Keep current status in `docs/tasks/V1_TASK_BOARD.md`. Plans describe execution, reports preserve dated evidence; `.superpowers/sdd/progress.md` is a historical ledger.
- Root owns contracts, DB/auth/privacy, migration gates, integration and acceptance. User-requested delegated tasks use Luna high/max according to difficulty; record the actual owner and do not claim reviews from unavailable agents.
- Human configuration/manual checks may remain deferred by the user while independent authorized implementation continues. List them in [final setup checklist](docs/operations/FINAL_SETUP_CHECKLIST.md); missing live evidence is not a pass.
- Run appropriate checks and read their results before claiming completion. Record source scope, commands, failures, remaining work and review provenance. A RED test means implementation is pending.
- Update requirements coverage, task board and any affected design/decision before handing off. V1 is complete only when every required acceptance and Flow A–F is accounted for; passing component tests is insufficient.
