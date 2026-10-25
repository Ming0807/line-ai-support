# SOL-02T — OpenRouter JSON object transport implementation plan

> Execute with superpowers:executing-plans and TDD. Root owns adapter contracts, schema validation and integration. Existing user authorization to continue V1 and latest request cover this reversible compatibility work. Preserve the dirty checkout; no commits, reset, new worktree from HEAD, normal provider changes or assistant activation.

**Goal:** Keep Gemini3.5FlashLite as the user's selected primary while supporting a future qualified OpenRouter Free backup whose endpoint accepts JSON object mode instead of strict JSON Schema.

**Architecture:** Derive optional transport capability from the same fresh exact OpenRouter public model row already read for FREE_ONLY pricing. Prefer JSON_SCHEMA where structured_outputs is explicitly supported. Allow JSON_OBJECT only when response_format is explicitly supported and native tools are absent. Send the backend schema as an additional system instruction; retain original messages, deadlines, price-zero routing and require_parameters. Validate returned JSON with the exact existing Zod schema and tool allowlist before delivery/action. No automatic second HTTP or repair on400/invalid JSON, no weaker validators.

**Requirements:** USR-AI-FREE/TEST/AUTONOMY, CH023/026/029/031/060; existing provider design and SOL-02/SOL-04 gates. This is transport compatibility, not semantic qualification. Latest user defers further Gemini tuning. Gemini compatible adapter, registered order/key/grant state and embedding remain unchanged.

Alternatives assessed: strict-only excludes JSON-only endpoints; prompt-only/text parsing loses explicit JSON capability and encourages repair; fresh capability-selected JSON_OBJECT plus unchanged validation supports both without accepting wrong shapes. Select the third. Unknown/malformed/embedding/other-provider metadata retains strict default. Native tool calls retain strict transport until separately proven. Public supported_parameters is model-level evidence; provider.require_parameters constrains endpoint routing, and actual selected-model tests remain necessary.

**Files:** lib/ai/types.ts (backend-only request option); pricing.ts (fresh optional capability); gateway.ts and model-probe.ts (same scope selection); providers/chat-completions.ts (wire format and schema instruction); provider-pricing.ts (strict optional metadata acceptance, no persistence change). tests/ai-json-output-modes.test.ts exercises actual gateway/catalog/chat adapter chain with controlled HTTP; tests/model-probe.test.ts covers selected JSON-only probe; existing assistant-grounding PG case verifies refresh accepts metadata without mutating model revisions/Free mode. Update provider design, decisions, task board, matrix, report and setup checklist.

- [x] Freeze pre-change source and preserve all prior modifications.
- [x] RED: JSON-only wire, strict preference/defaults, unchanged messages, schema rejection, tool rejection,400 single attempt, freshness/paid blockers, mixed-primary fallback and selected probe.
- [x] Implement minimal capability and wire selection. No migration/schema/rubric/prompt policy tuning.
- [x] GREEN focused tests; typecheck/full lint/full unit, affected owned PostgreSQL grounding/conversation and exact cleanup, current build. Serialize expensive commands.
- [x] Read source scope and actual output. No actual OpenRouter inference required to prove component compatibility; if no already-qualified configured backup exists, record live compatibility and original30/repeats as pending, never enable a model or treat HTTP200/JSON as answer quality.
- [x] Record reviewer provenance and source hashes, scan all changed/untracked non-ignored files, update coverage/status honestly. Existing model27/30+17/20 is historical after runtime-source change, not borrowed as new qualification.

19October completion: all component checklist steps complete. Actual JSON-only Free request429, so no live answer/model qualification; record as pending in report, not component failure or activation. Current runtime proof and current-source scan follow the serial gates.
