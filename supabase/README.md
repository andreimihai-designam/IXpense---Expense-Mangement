# IXpence cloud setup

1. Run `schema.sql` in Supabase SQL Editor. It is idempotent. Its DROP POLICY replaces only the named access rule; it does not drop tables or financial records.
2. In Authentication > URL Configuration, set Site URL and an allowed Redirect URL to:
   `https://andreimihai-designam.github.io/IXpense---Expense-Mangement/`
3. Keep email authentication enabled. For production email volume, configure an SMTP provider in Supabase; its credentials belong in Supabase, never in this repository.
4. `dist/cloud-config.js` contains only the project URL and browser publishable key. Never add a service-role key, database password or management token to the browser application.

## First connection

Open Settings > Sincronizare între dispozitive in the browser holding the desired local data. Request the email link and open it in the same browser (PKCE). Choose **Importă datele acestui browser** and confirm; the app downloads a backup first. Starting empty also requires an explicit choice. The original anonymous browser data remain separate.

Connect the other devices using the same email address. Existing cloud data load automatically; another browser's anonymous data are not merged or uploaded automatically. Appearance preferences remain local to the device.

## Data and conflict model

Financial data remain the existing version-1 JSON state: integer bani, transactions identified by stable IDs, category allocations, vouchers, favorites, planning records and monthly closure snapshots. Derived balances are not stored as additional credits/debits. The cloud stores one document per `auth.uid()`.

Authenticated users have SELECT permission for their own row under row-level security. Writes are possible only through `ixpence_save`, a function that checks `auth.uid()` and the expected version. A stale write fails rather than overwriting a newer device's data. There are no anonymous table grants or anonymous RPC grants.

Saves are queued after local persistence and sent automatically. Other devices are checked every 10 seconds while the application is open, and on reconnection/return to the tab. Pulling is deferred while a form is open so stale form edits are caught by the version check. Unsynchronized data are retained in an account-scoped local cache across reloads.

Conflicts pause writes until the user chooses explicitly. Selecting cloud downloads a backup of the pending device copy; selecting device downloads both known copies, then performs another compare-and-swap. If the cloud changed again, the operation stops again. Automatic last-write-wins is deliberately avoided.

Anonymous storage retains `jarvis-expencer-v1`; account caches use `jarvis-expencer-v1:user:<uid>`, with separate synchronization metadata. Signing out switches back to the anonymous data, not to another account's cache. A local browser cache is not an encrypted vault; on shared devices, use browser profiles and sign out.

The existing all-finances reset is synchronized as a new empty document only after its normal confirmation. It does not bypass version checks. Existing monthly closures stay snapshots until recalculated explicitly.

## Verification

`npm ci --ignore-scripts`, `npm run check`, and `npm test` run the financial tests, isolated cloud-client tests and the SQL migration against an embedded PostgreSQL engine (PGlite). The SQL test checks anonymous access denial, cross-account read denial, direct-write denial, idempotent setup and stale-version rejection.

The browser integration uses the real bundled Supabase SDK with mocked HTTP responses, covering PKCE callback handling, importing, two independent browser sessions, CRUD propagation, offline edits, conflict resolution and sign-out. Production email delivery and the first authenticated round trip must be verified by the account owner with their own email; tests never send emails or upload personal data.

The Supabase SDK is bundled in `dist/vendor/supabase.js`. Rebuild it with `npm run vendor`; pinned packages and license notices are included. The GitHub Pages workflow runs validation before publishing the static application.
