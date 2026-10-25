# SOL-02N — observe the actual decision request

Requirements: CH023/026/029/031/060 and USR-AI-AUTONOMY/TEST/FREE. Depends on SOL-02J frozen30 and SOL-04D's failed B06 on current `430a97ab…`. Owner: root, self-review.

The owned snapshot contains the delivered safe step, but this alone does not prove the latest question and that history reach the HTTP decision boundary. Hypothesis: lost or mispacked context may explain repeated diagnostic questions. Observe that boundary before another policy experiment.

Files: ignored `sol02n-*` staging helpers and a separately hashed copy of the existing selected-account owned evaluator. No production policy, transport payload, deadline, fixture, rubric, model configuration or normal database mutation. Reuse the exact current 120B model-bound Free attestation, without extending its expiry, the production Gateway and pinned transport, normal15s generation/8s routing, existing ownership journal and exact disposable cleanup. Synthetic conversations only; never record request headers, credentials or normal private history.

Acceptance: capture only allowlisted request fields and synthetic response content; assert the final decision USER message equals the unchanged frozen question, and preceding roles/content equal the current owned snapshot. Assert body byte length equals its existing Content-Length, record body/system/schema hashes, and return the original input/response unchanged. Preserve all original workflow witnesses and score failures honestly. Inspect routing observations for the separately failed Qwen case without treating HTTP200 as a routing pass. Recheck the complete844-file source fingerprint. This diagnostic receives no model qualification or frozen30 acceptance credit.
