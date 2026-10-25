# SOL-04H — Google compatible metadata identity

Root executes with executing-plans and TDD; self-review. Requirements USR-STATUS/TEST/FREE and CH029/031. Existing authorized V1 provider-observation scope; preserve dirty work, no commit/reset/clean.

Problem: current selected Lite METADATA returns HTTP200/MODEL_UNAVAILABLE while generation succeeds. Fresh same-key catalog in SOL-04G reports exact candidate `models/gemini-3.8-flash`. `metadataProbe` requires `item.id===model.modelId`, so the resource-name prefix produces a false unavailable result. Google documents the exact compatible endpoint and bare generation/retrieve identifiers at https://ai.google.dev/gemini-api/docs/openai#list-models . Actual current response supplies prefix evidence; documentation alone is not claimed to show a response it does not print.

Options: strip arbitrary prefixes for every compatible provider (unsafe identity conflation); change saved IDs to resource names (alters generation/cost bindings); selected: accept either the exact configured ID or one `models/` prefix for a bare configured ID only at the canonical exact Google `v1beta/openai` endpoint. Count both forms together: duplicate exact or mixed aliases remain INVALID_OUTPUT. Do not strip twice, suffix-match or broaden another endpoint. Metadata success supplies no price, quota, generation capability or model-quality credit.

Files: `lib/ai/model-probe.ts`, `tests/compatible-configuration.test.ts`, provider design/decision/task/matrix/current evidence. No Next API/schema/normal model/credential change.

- [x] RED regression for real bare/resource mismatch, duplicate resource/mixed aliases; negatives for other host/path, suffix/prefix, missing ID, and preserve generic exact matches/no inference or pricing calls.
- [x] Implement the narrow canonical endpoint match in metadata only; same transport/status/limits.
- [x] GREEN focused compatible/probe/observations/cost tests; type/lint/full unit and current-source snapshot. Re-run production build/provider browser because selected status changes. Do not call old full844 fingerprint current after editing.
- [x] Actual same-key METADATA probe verifies returned identity without inference or normal writes; guarded selected browser operation verifies persisted observation. Preserve HTTP503 from separate3.8generation probe. Any retry remains bounded and distinct.
- [x] Update scope-bound evidence and pending gates. No full30 quality or V1 completion inferred from this fix; latest frozen30 failure remains the last complete quality run and predates this metadata-only revision.
