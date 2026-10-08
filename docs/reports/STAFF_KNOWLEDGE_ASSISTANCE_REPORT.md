# ADV-05B-1 Staff knowledge assistance — 8 October 2026

Root implementation and self-review on `feat/yru-helpdesk-v1`, parent `a19b028`; CH052/USR-STAFFASSIST, original overview §14/master §52. [Design](../architecture/STAFF_KNOWLEDGE_ASSISTANCE_DESIGN.md), [execution](../superpowers/plans/2026-10-08-yru-staff-knowledge-assistance.md). Internal knowledge component passes the checks below; do not infer whole V1 or live acceptance.

Active authorized HUMAN cases now have an explicit “ค้นเอกสารประกอบ” action. The backend takes the latest actual USER text and only bounded previous USER history, reuses grounded scope/structured/RAG production, and builds citations from server-selected approved PUBLIC sources. Staff/AI summaries are not user scope. Missing questions invoke no provider and have an explicit state. Unknown/ambiguous evidence stays unverified with no citation or insertion action.

The shared snapshot preserves current actor/grants/department/sensitivity, HUMAN state, ticket/conversation revisions and selected case/department digest. Knowledge takes the shared source catalog fence before conversation locks; provider/local CPU HTTP runs after commit. Fresh Staff adapters authorize each SQL search; the final snapshot repeats exact retrieval and checks rule contexts/cited RAG or complete authenticated structured evidence. Revocation, new messages, mode changes or changed document eligibility discard the result. No Student tool authorization, job/delivery creation, ticket mutation, automatic publication or automatic sending is reused.

The private revision-only POST is `/api/tickets/[id]/knowledge-assistance`. Browser-safe DTOs expose only answer/title/year/HTTPS URL/location and the server-built draft, excluding source IDs/private proof/content. Canonical references remain in the draft; an oversized draft is not silently truncated. Insertion requires explicit staff action and confirms replacing existing composer text. The normal reply permission/revision/idempotency path still controls sending. The existing summary/draft action remains available.

| Check | Evidence |
|---|---|
| Focused contracts and private API | 14 PASS across original/new four files |
| Full Vitest | 145 files / 1,897 tests PASS; 240.78s |
| Typecheck / full lint | PASS before fresh production build |
| Production build | PASS; new private route compiled; controlled 1-worker page generation |
| Owned PostgreSQL | Final225 PASS (5 new Staff knowledge,5 old assistance,121 schema,49 structured publication/search/delivery,16 RAG,8 operations,4 loading,1 readiness,8 incidents,8 binding);33 migration replay/foundation RLS; owned cleanup PASS; normal schema unchanged |
| Pinned CLI advisors | 2.119.0, ERROR0/WARN0/INFO103; private deny-all and synthetic unused-index observations retained |
| Compiled browser | 8 new groups PASS; actual Staff login/private strict/no-question/disabled-AI HTTP; fixture citations/composer/stale/invalid URL/responsive checks |
| Existing summary browser regression | 5 groups PASS on the new compiled build |
| Visual inspection | Root inspected320px screenshot; 1440/390/320 have no overflow/page errors and no reply/outbox effects |
| Independent review | Requested Luna high review failed at usage limit before a verdict. Root self-review only |

RED evidence: missing projection/API/service modules and accepting an unsafe source URL were reproduced before implementation; the URL contract was repaired. The first actual PG invocation had four synthetic fixture failures because STAFF messages omitted required `sender_staff_id`; corrected the fixture without weakening schema constraints. The initial unsafe-URL browser check used a nonunique alert locator; narrowed it to the expected failure state and reran all8 groups PASS, with no product change for that QA repair. Actual PostgreSQL provider/E5 results are injected fixtures, not live transport. Compiled browser advice is explicitly `FIXTURE`, while private HTTP/auth/SQL and absence of outbox effects are actual.

No migration/new key/provider payment choice is introduced. Normal local/DEVELOPMENT remains33 migrations. Existing free gateway and offline local E5/384 configuration apply. Live provider quality, approved real corpus, actual OA/manual draft sending and production setup remain deferred in the [setup checklist](../operations/FINAL_SETUP_CHECKLIST.md). The producer's structured-empty behavior still stops with clarification; this internal slice does not complete the full structured→RAG→officialYRU→Internet cascade. External search, semantic business/context routing, incident context enrichment and final Flow A–F remain root work.

Git handoff: exact-file staging, whitespace/credentials and root push verification are checked separately after this report. External proposal files/private originals/QA credentials are excluded. README's obsolete missing-pricing/import-not-implemented statements were corrected against current source and linked evidence.
