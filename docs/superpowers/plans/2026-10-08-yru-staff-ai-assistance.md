# ADV-05A execution

Root; CH052/USR-STAFFASSIST, [design](../../architecture/STAFF_AI_ASSISTANCE_DESIGN.md), original overview§14/master§52. Depends on existing staff auth/scoped tickets/gateway/approved ticket presentation; no new schema.

1. Strict browser-safe input/output contracts and minimized bounded source projection; RED→GREEN unit tests. Files `lib/staff/ai-assistance-contracts.ts`, `tests/staff-ai-assistance.test.ts`.
2. Root snapshot/service/gateway adapter: current active HUMAN case, outsideSQL generation, whole source digest/active actor and scope recheck, validated department/no tools, no ticket/outbox mutations. Files `lib/staff/ai-assistance.ts`, actual owned `tests/database/staff-ai-assistance.integration.ts`; extend owned verification runner explicitly.
3. Private same-origin POST `/api/tickets/[id]/assist` with strict bounded JSON/fixed errors and API tests. Minimal ticket composer panel generates/inspects/pastes a draft with stale response fencing; existing send action remains explicit and authorized. Files route/client panel/`ticket-actions.tsx` and ticket detail availability props.
4. Actual PG revocation/revision/new-message/outsideSQL/privacy/no side effects; focused/full type/lint/unit/production build; compiled browser fixture provider if possible, distinguish from live generation. Update board/matrix/decision/setup/report and exact staged credentials/whitespace gates, root-only push.

ADV-05B/C remain separate: exact universityDB→reviewed RAG→bounded officialYRU→generic Internet with foreign-university policy exclusion. Rich Menu is an optional original proposal; V1 defers it because the required contextual quick replies and direct text entry remain available. This is a recorded engineering decision, not a claim that its source forbids menus.
