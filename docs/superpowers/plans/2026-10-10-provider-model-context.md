# Provider-owned model setup Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development with root integration/review. Agents do not commit/push shared work; root owns staged scope.

**Goal:** Make model ownership unmistakable and continue from a newly created provider directly to its model form.

**Architecture:** Refine provider-scoped client forms and use provider UUID as route identity. Stable component identities preserve drafts; explicit revision scopes fence reorder intent. Server auth/API/DB/cost contracts remain unchanged.

**Tech Stack:** Installed Next.js16.3.8, React19.3, TypeScript, existing CSS/Vitest/browser support.

## Global Constraints

- Follow the [human-selected design](../specs/2026-10-10-provider-model-context-design.md), CH014/USR-UX/ORDER/STATUS/QUOTA/TEST/FREE and DESIGN.md.
- Preserve FREE_ONLY/UNKNOWN refusal, per-model tests/HTTP/quota, ordering and local E5 exclusion. No real provider inference or DB writes from agent checks.
- Displayed ownership and `/api/providers/{id}/models` use the same UUID. No body `providerId`, inferred association or global selector.
- No keys/env/runtime activation/process stopping/unrelated BATCH edits. Read installed Next docs. Existing dependencies only; serial bounded checks on this constrained host.

## Task 1: Context regression tests — Luna high

Create `tests/provider-model-context.test.tsx`. Consume actual ProviderForms, mock next/navigation and use typed ProviderView fixtures; no new DOM dependency.

- [x] Render two provider groups with repeated model labels; assert contextual add/edit controls, form ownership/hostname, no provider selector/secret readback.
- [x] Cover no-provider/zero-model context without invented eligibility or health.
- [x] For an introduced order-state helper, test changed revision rejects stale draft while identical scope preserves intent; test behavior rather than source strings.
- [x] Run `pnpm exec vitest run tests/provider-model-context.test.tsx --maxWorkers=1`; establish actual behavioral RED before Task2 production writes, then GREEN. Allocation failure is not RED evidence.

## Task 2: Provider-owned setup and stable drafts — Luna max

Modify `app/(dashboard)/providers/provider-forms.tsx` and `app/providers.css`; optional pure helper `app/(dashboard)/providers/provider-interaction-state.ts`. No backend/page-auth changes.

- [x] Callback from CreateProviderForm carries returned validated UUID/submitted name. ProviderForms owns continuation; wait for actual matching refreshed provider, focus/open once. Failed POST has no continuation.
- [x] Contextual create/edit heading, owner name/adapter/hostname and save labels. ID/display name prominent; existing advanced fields disclosed; exact existing nested routes/success copy retained.
- [x] Disable pending create-provider/model fieldsets; retain failed values, reset only successful create values. No model catalog/preset/automatic test/eligibility invented.
- [x] Remove revision-driven provider/model form/order remounts. Stable owner/model keys retain unrelated drafts. Scope order drafts/saved flags to row IDs/revisions and discard stale order intent without remounting children. Core signature is `rows.map(row => row.id + '.' + row.revision).join(',')`; only use a draft carrying that exact signature.
- [x] Use current tokens/focus rules, wrapping names and stacked mobile fields/actions. Retain every order/test/status/quota control.
- [x] Root serializes verification; agent self-reviews files/concerns and does not commit/push.

## Task 3: Root integration, checks and separate review

Root owns board/matrix/provider design/surface brief/decision and new `docs/reports/PROVIDER_MODEL_CONTEXT_REPORT.md`.

- [x] Review ownership, async drafts and unchanged API/DB/cost against actual diff.
- [x] Run focused tests, `pnpm typecheck`, changed-file lint and `git diff --check` serially. Build only with safe headroom/isolated output; never disturb active dev output. Record allocation failures honestly.
- [x] Inspect desktop/mobile together, contextual add/edit/keyboard, and safe fixture continuation/delayed saves where available. Run Impeccable detector once on finished UI.
- [x] Get separate actual Luna code/spec review, resolve findings and update evidence/coverage/setup. Scan unstaged docs for credentials. No git add-all or remote push.

Task1 and Task2 are dependent: RED first, production writes second. Root diagnostic-document verification runs independently. Human's continuous execution request and explicit direction selection authorize this focused correction without another aesthetic approval round.

Completed component scope10October: actual Luna high/max owners and root checks/browser evidence are in [report](../../reports/PROVIDER_MODEL_CONTEXT_REPORT.md). Optional pure helper was not introduced; its conditional helper-unit item is N/A, while revision/order/draft behavior was exercised against actual components. Source review identified409 recovery, root reproduced RED and the implementer corrected it; final reviewer closed P2. Real-account workflow and provider runtime/OA gates remain separate.
