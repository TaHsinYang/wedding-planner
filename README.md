# Our Wedding Planner ♡

Original warm, responsive wedding planner, upgraded for two verified accounts using GitHub Pages + Supabase. No build step or privileged key is required in the browser.

## Open the website

https://TaHsinYang.github.io/wedding-planner/

1. Create your account and confirm your email, then sign in.
2. One person creates the shared space. If old local data exists on that browser, choose **帶入這台裝置的舊資料** instead. The old local copy is kept.
3. The creator enters the partner's exact email and generates a 48-hour invite. Copy and share it privately yourself.
4. The partner opens the link, creates/verifies an account using that email, then chooses **加入伴侶的空間**. Do not create a second space.
5. Both can edit all wedding records. Active pages poll every 5 seconds and save changes after a short debounce. Keep the page open until **已同步 ♡** appears.

## Required Auth configuration before first use

Project: `hzuzusrtphmyjmkjfhmx` (Tokyo).

- In Supabase **Authentication → URL Configuration**, set **Site URL** and add the exact **Redirect URL** to `https://tahsinyang.github.io/wedding-planner/`.
- Keep **Confirm email** enabled. Never disable confirmation to work around delivery problems: invitations rely on verified email ownership.
- In **Authentication → Email → SMTP Settings**, configure your own SMTP service. The default Supabase mailer sends only to organization team members and has strict limits. Set credentials only in Supabase's dashboard, never in this repository or in chat. See [official SMTP guide](https://supabase.com/docs/guides/auth/auth-smtp).
- First-use acceptance requires real accounts: verify both inboxes, create the owner space, redeem the partner invitation, and edit from two devices. These actions must be performed by the actual account holders.

## Synchronization and recovery

- RLS exposes only the current owner's or partner's space. Accounts without membership see no wedding data.
- Updates use revision-based compare-and-swap. Different fields and different records merge automatically. Conflicting same-field edits and delete/edit races stop synchronization and retain the local draft.
- On conflict: **匯出本機草稿**, then **載入雲端版本**, compare and reapply your intended changes.
- Offline or failed saves retain a user/space-scoped local draft. The same account restores it on next login. A clean logout hides all data and clears in-memory state. Unsaved drafts may remain in that browser, so use trusted devices and export before clearing browser storage.
- Browser storage is not an encrypted vault. Cloud access controls cannot protect a compromised device or malicious browser extensions.
- Import replaces shared records after confirmation; export a backup first. The original browser-only backup JSON remains compatible. Backups contain private information; share them carefully.
- Each account can belong to one space and each space supports two people. Partner removal/account deletion are deliberately administrative actions, not an exposed self-service endpoint in this version.

## Security and deployment

- `config.js` contains a **publishable** key, intended for public browser use. No secret/service role key or database password is used.
- The only publicly readable table is protected by RLS; no direct inserts, updates, or deletes are granted to browser roles. Explicit, authenticated RPCs perform validated writes.
- Privileged functions live in `wedding_private`, outside the REST-exposed schema, and validate `auth.uid()` and verified email. Public RPC wrappers are security invokers. Functions have fixed empty search paths and explicitly restricted execution grants.
- Invitations use high-entropy random tokens; the database stores only SHA-256 hashes, bound to email, expiring in 48 hours, consumed on successful join. New invitations invalidate old ones. Invite links use URL fragments and a no-referrer policy.
- Every record's user-visible text is HTML-escaped. Imports are normalized and reject unsafe or duplicate IDs. A Content Security Policy blocks third-party scripts and objects.
- GitHub Pages is deployed by `.github/workflows/pages.yml` on pushes to `main`, after unit and syntax checks. In repository **Settings → Pages**, choose **GitHub Actions** as the source. The uploaded artifact contains only website assets; `.nojekyll` preserves plain static serving. No application deployment secrets are needed.
- Database schema is preserved in `database/schema.sql`; the corresponding migration is applied in Supabase. Do not rerun the bootstrap SQL on an existing populated project.

## Verification

```sh
npm test
npm run check
```

`tests/security.sql` performs integration tests in a transaction and rolls back all test accounts and data. It checks anonymous access, outsider access, unverified users, direct writes, email-bound invites, invitation reuse, membership limits, and stale-revision protection. Run through the Supabase SQL editor as an administrator, on an isolated project if there is pre-existing data (the tests assume a fresh app database).

Browser QA additionally covers the mobile login gate, two simulated device sessions, field merging, escaped notes, offline drafts and reconnect. A real email round-trip and real two-device acceptance require completed Auth/SMTP configuration and the users' own inbox access.

## Vendored dependency

Supabase JS 2.57.4, vendored UMD bundle from:
https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/dist/umd/supabase.js

SHA-256: `7e94b62086deecef8c0ba3b38f514e2a1944ff6c81d92fb3ff967828c406c38f`.
The version and checksum are pinned; website visitors load it from this repository, without a third-party CDN request. Supabase JS is MIT licensed; see `vendor/SUPABASE-LICENSE`.
