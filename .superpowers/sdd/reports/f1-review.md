# F1 bootstrap and auth review

Reviewed the F1 brief, implementation report, and the supplied diff from `96d6a8c` to `5e7416b`. This review did not modify application files or rerun the reported tests.

## Spec compliance verdict: Mostly compliant; one important logout gap

The staff boundary follows the intended authority model: `requireStaff()` obtains the subject from `getClaims()`, looks up `staff_profiles` by that subject, and requires `active === true` plus a recognized role. It does not use `user_metadata`. The protected dashboard layout is forced dynamic and calls the guard on each request. Redirect targets are reduced to same-origin paths, modern publishable keys take precedence over legacy anon keys, and the browser reader only returns the Supabase URL and publishable key. The login action validates credentials and returns generic recoverable errors; the form presents them with an alert and permits retry.

The logout action redirects to `/login` even if client creation or sign-out fails, and it discards the `error` returned by `signOut()`. In those failure paths the action gives the appearance of success without ensuring that the cookie-backed session was cleared. F1 explicitly requires logout to clear the session, so this needs a fix before the auth contract is complete.

The server environment reader uses Zod and validates its configured URL, encryption key, and timeout values. The public reader does not use Zod and accepts any non-empty URL or key string after trimming. This is a small gap against the brief's instruction to validate environment readers with Zod; it does not expose secrets, but malformed public configuration can pass this reader and fail later when a browser client is created.

System-level role authority still depends on the pending F2 SQL: `staff_profiles` role, active, and permission columns must not be writable by an authenticated user, and its read policy must be appropriate. SQL/RLS is outside this review's assigned scope, so that integration dependency remains unverified here.

## Code quality verdict: Sound structure with one important failure-handling issue

The auth and environment responsibilities are separated cleanly, secrets stay out of the browser reader, and access denial does not surface database error text. The important issue is the unchecked logout result described above. The public environment reader's lack of schema validation is a minor consistency issue.

## Important findings

### F1-R1 — Logout can report success while retaining the session

**Location:** `app/auth/actions.ts:33-39`

`signOutAction()` ignores the `{ error }` result from `supabase.auth.signOut()` and redirects from `finally` even if client creation or sign-out throws. If session-cookie removal fails, the user is still sent to the login screen and receives no indication that the session may remain usable. This does not meet the requirement that logout clears the session.

**Proposed fix:** Handle the sign-out result explicitly and make clearing the current SSR auth cookies the success condition. If remote revocation fails, still clear the local session where possible and surface a safe failure state when local clearing cannot be completed. Add focused coverage for returned and thrown sign-out failures.

## Minor findings

### F1-R2 — Public environment values bypass Zod validation

**Location:** `lib/config/public-env.ts:6-20`

`readPublicEnv()` trims values but does not validate their types or URL shape with Zod, while the F1 brief asks for Zod validation in the environment readers. A malformed non-empty public URL is accepted and passed onward. Keep the schema limited to the two public values, but validate them before returning.

### F1-R3 — Logout uses Supabase's global scope by default

**Location:** `app/auth/actions.ts:36`

Supabase JavaScript defaults `signOut()` to the `global` scope, which revokes refresh tokens for every active session for that user. If the dashboard's sign-out control is intended to end only the current browser session, pass `{ scope: 'local' }`. The [Supabase JavaScript sign-out reference](https://supabase.com/docs/reference/javascript/auth-signout) documents the scopes and the global default. This is a behavior choice rather than a direct violation of the F1 logout requirement.

## Verified against the reviewed code

- `lib/auth/staff.ts:30-48` rejects missing/failed verified claims and denies absent, inactive, errored, or unrecognized staff rows without exposing database details.
- `lib/auth/redirect.ts:4-16` rejects external origins, protocol-relative paths, backslashes, and control characters; both the login page and sign-in action apply it.
- `lib/config/env.ts:82-108` prefers modern publishable keys before legacy anon keys and parses server configuration with Zod.
- `lib/supabase/browser.ts:6-15` and `lib/config/public-env.ts:14-20` keep server secrets out of the browser client configuration.
- `app/(dashboard)/layout.tsx:5-17` is dynamic and invokes `requireStaff()` while rendering the protected route group.
- `app/auth/actions.ts:10-30` validates credentials, returns generic errors for invalid credentials/configuration, and leaves Next's redirect outside the catch block so it is not swallowed.
