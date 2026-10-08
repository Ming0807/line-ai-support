# V1-UI-IMPORT-03 — Structured mapping UI report

Date: 8 October 2026
Owner: delegated structured mapping UI worker (requested Luna high/max; runtime model metadata was not exposed in this session)
Status: assigned slice implemented; root integration and combined acceptance remain pending

## Result

Built a three-step structured data editor for table disposition, field binding, and final review. Every source table starts undecided. The operator must either map it or enter an exclusion reason and a human-written note. Mapped tables retain each field binding independently and partition every source row into data ranges or noted exclusions, including exclusions in the middle of a table. No exclusion note or disposition is generated automatically.

The browser contract mirrors all seven server datasets, field types/nullability, and compatible transform choices. Header suggestions use exact aliases and remain subject to explicit operator review. Every mapped table must have at least one nonnullable column binding; constants require a nonempty note. CSV/XLSX labels use source row and column coordinates; PDF, DOCX, and HTML labels identify the extracted logical position and available page/heading context.

The client strictly validates the structured-source and preview envelopes, checks their job/extraction tuple, submits the exact expected revisions and Mapping1 body, then validates the complete server snapshot, plan tuple, source locations, transformed row manifest, payload and plan digests, acknowledgment digest, and boolean `publicationAvailable`. The acknowledgment comes only from the server. The displayed status is Thai, omits the raw digest and mapper version, and reports publication availability from the server response without implying approval or publication.

Saved mappings restore only after strict parsing and inventory checks. When the source revision changes but table/range indices still fit, the saved field choices remain editable and are rebound to the live source with the acknowledgment cleared. Saved acknowledgments are revalidated against the live source and review revision; the acknowledgment-stability test confirms that advancing the review counter does not change the acknowledgment. Editing fields, notes, existing exclusions, or a new exclusion draft clears the prior plan/acknowledgment and invalidates in-flight work with `AbortController` plus an epoch gate.

The component interface for the root-owned review form is:

```ts
interface StructuredMappingPanelProps {
  jobId: string;
  savedValue: StructuredMappingChange | null;
  suggestedDataset?: StructuredDataset | null;
  disabled?: boolean;
  onChange: (value: StructuredMappingChange) => void;
}
```

`onChange` emits only `{mapping, acknowledgment}`. Review-v3 persistence, mode switching, approval, and publication remain owned by root.

## Files

- `app/(dashboard)/knowledge/import/structured-mapping-panel.tsx`
- `app/(dashboard)/knowledge/import/structured-client-contract.ts`
- `app/structured-mapping.css`
- `tests/structured-client-contract.test.ts`
- `tests/fixtures/structured-client-contract.ts`
- `docs/ui/V1_STRUCTURED_MAPPING_UI_PLAN.md`
- `docs/reports/V1_STRUCTURED_MAPPING_UI_REPORT.md`

The historical UI at checkpoint `458c76f` was inspected as background only. Its generated exclusions, single-table assumption, acknowledgment restore gap, and unchecked source bootstrap were not carried forward.

## Verification

- `pnpm exec vitest run tests/structured-client-contract.test.ts` — 1 file, 9 tests passed. Coverage includes the complete server registry and transform compatibility vocabulary, middle-row partitioning, explicit table dispositions and human notes, required-column and constant-note rules, CSV/XLSX/PDF coordinates, malformed restore rejection, strict source/preview parsing, snapshot/row/digest/publication validation, acknowledgment stability across a review-counter change, and stale-response rejection after an edit.
- Scoped ESLint on the panel, browser contract, focused test, and fixture — passed with no warnings.
- `pnpm exec tsc --noEmit --pretty false` — passed for the repository at the latest check snapshot.
- Runtime contract contains no server/lib imports, Node `Buffer`, or `node:crypto`; SHA-256 uses browser Web Crypto.
- No browser session or real-source review was run for this slice. Full unit/build gates and review-form integration remain with root. No dependency installation, browser credit, or publication action was used.

## Remaining integration

Root owns wiring the props/callback into review-v3, verifying parent state behavior and disabled/loading conditions, then running combined repository gates. The panel can only report the server's current `publicationAvailable` boolean; actual approval and publication are outside this component.
