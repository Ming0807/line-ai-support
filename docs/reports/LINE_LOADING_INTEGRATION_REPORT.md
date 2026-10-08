# ADV-04 — best-effort Student OA loading integration

8October2026. Actual Luna high implemented/tested bounded LINE transport; root owns fresh worker authorization, transaction/revision integration and actual PostgreSQL tests. [Transport report](LINE_LOADING_COMPONENT_REPORT.md), [plan](../superpowers/plans/2026-10-08-yru-line-loading.md).

Only the first eligible AI attempt with a fresh original event may start a20-second loading indicator. A short committed transaction validates conversation/job lease/ownership/revision, active private identity and original reply window; encrypted identity never enters the AI producer snapshot. LINE HTTP runs outsideSQL, then the worker rechecks its snapshot before generation. Network rejection/timeout remains best effort, with fixed safe error codes, no intermediate text and no extra retry. Existing reply/push expiry is unchanged.

19transport tests PASS.4actual PostgreSQL cases PASS within206owned tests: outside-transaction transport/private snapshot, expired/future/retry skips, network failure still continues and HUMAN takeover during the loading call suppresses generation. Root type/lint and production build PASS at the combined checkpoint. Actual OA loading animation, slow free generation and final late-reply/push flow remain MANUAL_PENDING; simulated transport is not live LINE evidence.
