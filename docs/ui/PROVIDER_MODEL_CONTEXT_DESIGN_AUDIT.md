# Provider and model ownership UX audit

**Task:** UI-PROVIDER-CONTEXT-01A
**Status:** Read-only design proposal; no production UI or behavior changed.
**Scope:** Make it immediately clear which provider owns a model when an administrator adds or edits one.

## Finding

The current page already nests each model list and its add form under a provider card. However, the collapsed control says only “เพิ่ม Model,” and the open form does not repeat the provider name or adapter. Once a provider has been created, the page does not carry that creation context forward: the admin must locate its group and infer ownership from the surrounding layout. Long lists, mobile wrapping, and the current empty-model message make that inference less reliable. The edit control has the same implicit context.

The task is an **Operate** flow for a Super Admin. Success means the admin can identify the owning provider before entering model details and can confirm the saved model stayed with that provider. The existing visual authority is the dark rail, warm canvas, soft white cards, coral overview identity, and blue action controls in `DESIGN.md`; this proposal preserves it.

## Options considered

| Approach | Benefit | Cost | Assessment |
|---|---|---|---|
| **Provider-scoped inline form**: open a form inside the owning provider group, with the provider name repeated in the action and form heading | Keeps model ownership visible in place; avoids a second provider choice; fits the existing grouped layout and inline form pattern | Requires carrying a short-lived “continue with this provider” focus after provider creation | **Recommended.** Strongest continuity with the existing page and least room for an accidental cross-provider save. |
| Global “เพิ่ม Model” wizard with a required Provider selector | Makes ownership explicit as a field and gives one entry point | Adds a provider choice to a task already initiated from a provider; can switch ownership mid-entry and separates the form from provider status | Not recommended for the normal path. If ever used as a deep link, selection must be required and visible. |
| Separate provider detail page or modal for model management | Gives one provider a dedicated workspace | Adds navigation or overlay state, hides cross-provider fallback context, and is disproportionate for the current form | Not recommended for this focused correction. |

## Recommended interaction

1. Keep “เพิ่มผู้ให้บริการ” as the page-level action. The current create API returns the new provider `id` and `revision`; pair that ID with the submitted display name, retain the pair in page interaction state, refresh the server-rendered list, scroll or focus that provider group, and open its model-add form. Show a compact status line such as “เพิ่มผู้ให้บริการแล้ว · ตั้งค่า Model สำหรับ {ชื่อผู้ให้บริการ}” with the provider name as a link or focus target. Do not guess a provider model or automatically create one.
2. Replace the generic add-model summary with a provider-specific action: **“เพิ่ม Model ให้ {ชื่อผู้ให้บริการ}”**. When open, the form begins with a visible heading **“Model ใหม่ · {ชื่อผู้ให้บริการ}”** and a small adapter label from the existing provider record. The provider identity is read-only context, not a selectable field.
3. In edit mode, use **“แก้ไข Model ของ {ชื่อผู้ให้บริการ}”** and repeat **“กำลังแก้ Model ใน {ชื่อผู้ให้บริการ}”** above the fields. Keep the model ID and display name in the heading when known.
4. Keep the current nested route contract: creation posts to `/api/providers/{providerId}/models`; editing patches `/api/providers/{providerId}/models/{modelId}`. The visible provider name must come from the same provider object that supplies this route ID. Never infer ownership from a model name, display label, or current sort position.
5. On successful save, refresh and keep focus near the saved provider/model. Announce success with both model and provider names, for example “เพิ่ม {ชื่อ Model} ใน {ชื่อผู้ให้บริการ} แล้ว.” Keep the form open if the save fails; preserve every entered value and place validation or network errors beside the relevant field/action. On success, close/reset the form only after the refreshed model is present.

## States and details

- **No providers:** the existing empty state remains the first step and explains that a provider must be added before a model. The add-provider button opens/focuses the existing provider form.
- **Provider created, zero models:** the new provider group is visibly highlighted for this transition and shows an empty state with the same provider-specific add action. The action itself is sufficient; avoid repeating provider settings in another card.
- **Existing providers:** each provider group has one clearly bounded model section. Its heading/action names that provider. When the list is long, the action remains inside that group rather than moving to a global toolbar.
- **Several providers:** only one create/edit model form should be open at a time. Opening another moves focus to its heading and closes the prior form after an unsaved-change check only if dirty tracking is introduced; otherwise do not discard values silently. A provider refresh or revision conflict closes no active draft automatically.
- **Failure:** keep the selected provider context and draft values on API validation, offline, authorization, or stale-revision failure. A `409` refreshes server data as today, then explains that the current provider/model changed and asks the admin to review before resubmitting; do not silently redirect the draft to a replacement row.
- **Sensitive fields and defaults:** the model form must not reveal provider keys. Keep the existing enabled default and capability checkboxes. Do not autofill or seed model IDs, API endpoints, capabilities, prices, quotas, or health. A model may be saved while its live pricing/eligibility remains UNKNOWN; FREE_ONLY enforcement and selected-model testing remain backend-owned.
- **Ordering and tests:** retain provider up/down ordering, model up/down ordering, saved draft order with Save/Cancel, purpose scope, selected-model test buttons, per-model HTTP/result/time/latency, and truthful quota scope/unit/window/source/time. Creation or editing never changes order, paid mode, cooldown, or test status unless the existing backend contract explicitly returns a new observation.

## Responsive and accessibility behavior

At desktop widths, keep the form visually within the provider card with a single identity line above the fields. On phones, use the same group nesting and identity line before the first field; stack controls and actions full width, keep names wrapping safely, and avoid horizontal page scrolling. Keep touch targets at least 44px. The provider name should remain visible even when the form is scrolled; a compact non-sticky heading is enough unless browser inspection proves the form is unusually long.

Use a real heading for the form context and associate it with the section via `aria-labelledby`. The add/edit button’s accessible name includes the provider name. On opening, focus the form heading or first input; on save/error, expose the result through the existing status/alert pattern and restore focus to a meaningful control. Keep native details disclosure or equivalent keyboard operation; do not require drag. Respect existing high-contrast focus outline and reduced-motion rules.

## Component and file boundaries for implementation

- [`app/(dashboard)/providers/page.tsx`](../../app/(dashboard)/providers/page.tsx): keep authorization and server data loading here. If the transition needs the newly created provider identity across `router.refresh()`, pass a minimal serializable provider ID/name to the client interaction layer or use a URL fragment/query state that is removed after focus. Keep this page a Server Component.
- [`app/(dashboard)/providers/provider-forms.tsx`](../../app/(dashboard)/providers/provider-forms.tsx): own client-only context and interactions. Add a `ProviderModelSection` boundary around the provider model heading, empty state, list, and add form; pass `provider` as the single source for display identity and API path. Split `ModelForm` into explicit `create` and `edit` presentation states or a small shared form with required `provider` context. Add a page-level post-create continuation hook to `CreateProviderForm` without moving its server-owned provider list into the client.
- [`app/providers.css`](../../app/providers.css): style the provider identity line, provider-specific action label, focused newly-created group, and mobile wrapping using current tokens and existing surface rules. Avoid introducing another nested card or new accent palette.
- Existing API routes and provider contracts: no route or schema change is proposed. Keep ownership enforced by the nested provider route and existing authorization/revision checks.

The current Next.js App Router guide confirms that page data/auth can stay in Server Components while only stateful form and focus interactions live in a narrow Client Component; props crossing that boundary must remain serializable. No API-version assumptions are needed for this UI-only design.

## Acceptance criteria

1. Starting with no providers, the flow clearly leads to “เพิ่มผู้ให้บริการ”; after save, the newly created group is brought into view and the next action names that provider.
2. In every provider group, the add and edit triggers and open form heading identify the owning provider. No model form exposes a provider selector in the normal path.
3. Model create/edit requests use the owning provider ID shown to the admin. A failed request cannot migrate a draft to a different provider.
4. API validation/network/stale revision errors preserve typed model fields and provider context; success is announced with both model and provider identity after the updated list appears.
5. Empty, loading, load-error, no-key, UNKNOWN pricing, disabled provider/model, test pending/failure, and quota UNKNOWN states remain accurate and actionable. No invented model catalog, endpoint, quota, health result, or free eligibility is displayed.
6. Existing provider/model ordering and save/cancel semantics, per-model testing and observation details, FREE_ONLY defaults/enforcement, no-key-readback behavior, and permission boundaries remain intact.
7. At phone width and 200% zoom, provider identity remains visible before model entry, controls remain reachable without horizontal page scrolling, keyboard focus and announcements work, and the warm canvas/dark rail/coral approved identity is preserved.

## Evidence read

Read the supplied `AGENTS.md` and the required project index, current task board, decision log, master guide, requirements source index/matrix, original provider requirements §§32–36, system/provider design, provider-management execution plan, `PRODUCT.md`, `DESIGN.md`, provider surface brief, installed Next.js Server/Client Components and `use client` guides, and the current provider page/forms/CSS. The Impeccable shape guidance calls for a discovery round; the task owner explicitly prohibited asking the human, so this audit uses the settled product/design requirements above and records the remaining implementation choices as assumptions. No tests, servers, or processes were run or changed.
