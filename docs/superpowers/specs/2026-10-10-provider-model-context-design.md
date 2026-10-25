# Provider-owned model setup design

Task UI-PROVIDER-CONTEXT-01; 10 October 2026. Root owns integration/contracts. Linked CH014, USR-UX/ORDER/STATUS/QUOTA/TEST/FREE; original overview §§32–36, master §§14–15/29–31, provider design and surface brief. Human explicitly selected “เพิ่มจากการ์ดผู้ให้บริการแต่ละเจ้า (แนะนำ)” after reviewing the provider-scoped action/form concept. Refine the existing approved visual world.

## Selected approach

Keep each provider as the model owner and work area. The [design audit](../../ui/PROVIDER_MODEL_CONTEXT_DESIGN_AUDIT.md) compares inline ownership, a global selector wizard and a separate detail/modal workspace. Use inline ownership: no extra provider selector or modal/navigation. Every create/edit entry point, form heading and save result names the provider. The same `provider.id` supplies the displayed context and nested API route; names, model IDs and sort positions never select ownership.

```text
GroqCloud                         เปิดใช้งาน
อื่น ๆ · OpenAI compatible · api.groq.com
โมเดลใน GroqCloud                 [เพิ่มโมเดลใน GroqCloud]

เพิ่มโมเดลใน GroqCloud
ผู้ให้บริการ: GroqCloud · api.groq.com
[Model ID]   [ชื่อที่แสดง]
[ความสามารถเดิม / เปิดใช้งาน]
[การตั้งค่าขั้นสูง: ลำดับ เวลา ราคา]
                         [เพิ่มโมเดลใน GroqCloud]
```

This illustrates composition, not saved data/free eligibility. Preserve dark rail, warm canvas, white surfaces and approved action tokens; no new palette/dependencies. Operate mode prioritizes ownership and short setup.

## Flow and states

- After successful provider POST, retain its real returned UUID above the ordered list. Wait for refreshed props to include it, then open/focus its model-add form once and announce the provider/next action. Pending disables inputs; failure preserves entered configuration without false continuation.
- Model create/edit repeats provider name, adapter and safe hostname before fields. Keep required model ID/display name prominent; disclose existing advanced order/timeout/manual-price fields. Preserve defaults/backend validation; do not infer IDs, capabilities, prices or account status. No key readback.
- Disable the submitting form's fields so post-submit typing cannot be erased on success. Announce accepted saves with model and provider names; reset only that successful new-model draft and keep its form available for the next model. Error/409 retains draft/owner and notice. A missing provider never triggers reassociation.
- Keep provider/model React identity stable across revision refreshes, preserving unrelated open forms/drafts. Reconcile order drafts against incoming row IDs/revisions; discard stale order intent without remounting children. Existing atomic reorder Save/Cancel remains.
- A substantive remote settings/model change keeps the local draft fenced by its old revision. Show an explicit action to replace only that draft with the latest saved fields/revision; never silently rebase a draft over another operator's edit. Harmless same-setting revision bumps may use the current revision. The separate source reviewer found and root reproduced repeated409 without this recovery before the correction.
- Empty/load-error/disabled/key-missing/UNKNOWN/cooldown/test/quota states remain truthful. Disabled providers can be configured. Local E5 remains read-only infrastructure.
- Use native disclosures, contextual headings/accessibility names, visible focus/status/alerts and wrapping identity text. Mobile fields/actions stack without page overflow. No new modal/focus trap.

Frontend only: retain nested POST/PATCH ownership/revision authorization, FREE_ONLY/UNKNOWN refusal, paid opt-in, ordering, selected-only tests, quota/HTTP observations and privacy. No probed provider activation or production tool/schema acceptance is included.

Acceptance: two providers with identical model labels remain distinct by UUID; provider creation continues to its returned UUID once; pending/error/success cannot move or erase another provider's draft; stale ordering cannot replay; actual desktop/mobile/keyboard evidence is recorded separately from live account/OA acceptance. Root self-review and actual delegated review provenance are required.
