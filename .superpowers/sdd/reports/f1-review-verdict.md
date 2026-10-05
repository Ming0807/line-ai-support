# F1 correction verdict

Reviewed the correction diff from `5e7416b` to `5883d65` and the correction evidence. I did not rerun tests or edit application/database files.

## Finding status

| Finding | Status | Review |
| --- | --- | --- |
| F1-R1 — logout failure can leave the session while redirecting as if successful | **Partial** | The action now explicitly deletes the current Supabase cookie and chunks, uses local-session scope, and shows `signout_failed` if cookie removal throws. However, it derives the cookie name from `readPublicEnv()`, which only reads `NEXT_PUBLIC_SUPABASE_URL`. The supported server reader also accepts `SUPABASE_URL`; with that valid server-only configuration, a failed `signOut()` reaches `new URL('')`, skips cookie deletion, and reports failure while leaving the cookie in place. Derive the cookie name from `readServerEnv().supabaseUrl` or share a server-side cookie-name helper based on the same URL used by `createUserClient()`. Add coverage for server-only URL configuration. |
| F1-R2 — public environment reader bypasses Zod URL validation | **Resolved** | `readPublicEnv()` now parses a Zod schema and accepts either an empty URL or an HTTP(S) URL. It still exposes only the two public fields. |
| F1-R3 — logout defaults to global sign-out | **Resolved** | `signOutAction()` now explicitly passes `{ scope: 'local' }`, matching the intended current-browser logout behavior. |
| Base64 encryption-key validation rejected valid 32-byte keys | **Resolved** | The reader now decodes the value, requires exactly 32 bytes, and requires canonical re-encoding to match. This accepts a canonical 32-byte key and rejects keys decoding to 31 or 33 bytes, as recorded in the correction evidence. |

## Verdict

The corrections resolve the public URL validation, logout scope, and encryption-key findings. The logout fix is **partial** because its fallback cleanup depends on a public URL even though `createUserClient()` also supports a server-only Supabase URL. With that edge corrected, the reviewed findings would be resolved. The correction report also records updated SUPER_ADMIN permission behavior and successful checks; those checks were not rerun in this verdict pass.
