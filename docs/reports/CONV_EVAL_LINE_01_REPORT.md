# CONV-EVAL-LINE-01 — LINE-style input evaluation with a fake provider

16 November 2026, Root (DEC-206). Cases: [tests/fixtures/conv-eval-line.ts](../../tests/fixtures/conv-eval-line.ts); runner: [tests/database/conv-eval-line.integration.ts](../../tests/database/conv-eval-line.integration.ts).

## What it checks

Each case is a sequence of Student fragments with real gaps (and optionally the bot's reply being delivered in between). It runs through the real PostgreSQL window trigger (migration 57), job preparation, the carry-over of unanswered input, the greeting short-cut and the AI worker, with a fake model that only records the question it receives. It checks which questions reach the model and which replies are sent without a model call. It does **not** measure answer quality: that needs a real model run (CONV-V2-00/06), which waits for the owner's budget approval.

## Result (owned PostgreSQL, 56+1 migrations)

```
pnpm exec tsx scripts/database/run-owned-test.ts --seed tests/database/conv-eval-line.integration.ts
{"cases":41,"modelCalls":42,"fixedReplies":6,"failures":0}
```

| Category | Cases | Pass | Examples |
|---|---|---|---|
| SHORT | 8 | 8 | "ค่าเทอมเท่าไหร่", "ลืมรหัส reg" |
| MISSPELLED | 8 | 8 | "ค่าเทมเท่าไร", "เน็ตมหาลัยใช้ไม่ด้าย" |
| BURST | 8 | 8 | "คือ" + 3 s "ค่าเทอมเท่าไหร่" → one question; two questions 20 s apart before any reply → one model call with both |
| GREETING | 7 | 7 | "หวัดดีค่ะ" → fixed reply, no model call; "สวัสดีครับ" + 5 s or 12 s question → one model call with both |
| FOLLOW_UP | 6 | 6 | answer delivered, then "แล้วภาคพิเศษล่ะ" → a new turn with the earlier exchange as history |
| EDGE | 4 | 4 | ten fragments over 18 s (crosses the 15 s cap) → still one model call; "ขอบคุณครับ แล้วค่าเทอมเท่าไหร่" → model |

Model calls for 41 Student turns: 42 (each follow-up case has two answered turns); 6 replies needed no model call. Before DEC-206 a greeting cost a classifier call and "สวัสดี" followed by a question 5–12 s later became two turns.

## Limits

- Fake provider: no retrieval, answer quality, latency or quota measurement.
- Timing is simulated with past timestamps; real LINE delivery, loading animation and network jitter are not covered. The owner's OA test (CONV-V2-07) remains required.
