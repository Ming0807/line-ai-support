# STR-01C-3 — review3 RAG compatibility

8October2026, root baseline `1b09cc3e99ca6715e5c4a7bae62c40a7043b89a2`; [plan](../superpowers/plans/2026-10-08-yru-review3-rag-compatibility.md), DEC-053. Root implemented/self-reviewed this small compatibility change. No independent review of this delta is claimed.

Schema3/null mapping may publish reviewed RAG chunks without downgrading the saved schema floor. Storage mode drives row preparation: RAG uses current acknowledged chunks/E5/legacy receipt transaction; STRUCTURED/BOTH preserve their separate source-bound preparation/readiness gates. Existing attestations, provenance, warnings, quality, authorization, revision locks and immutable receipt remain. No normal installation, UI activation, automatic mapping discard or new human configuration.

Three collected policy cases were RED, then40/40 policy and53/53 combined publication/structured review cases GREEN. Actual schema3 RAG approval test was RED with PUBLICATION_STRUCTURED_SCHEMA_UNAVAILABLE, then final owned PostgreSQL **121schema+47structured+16RAG=184 PASS**,31 replay/foundationRLS/normal0/7 unchanged/ownedcleanup PASS. Actual test saves3, approves only chunks, retains3, finds no structured proof and replays without another embedding call. Embedding/LINE adapters are controlled; no live claim. Final advisors0ERROR/0WARN/98INFO, no new unindexed FK.

Typecheck/scoped lint exit0. The previous1664/full lint/build evidence belongs to `1b09cc3`; this minor delta is covered by focused/actual SQL and will join final full/build gates after UI/readiness integration. Root does not borrow prior final-source evidence. Combined UI/browser, normal activation, M9 and Flow A–F remain.
