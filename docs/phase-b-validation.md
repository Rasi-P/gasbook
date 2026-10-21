# Full-feature demo validation — 2026-10-21

## Scope and preservation

Local candidate based on gasbook main `3dcbbf2290e3e51026d0be2c25c8dad3345756db` and customer main
`0bff6fe798fa9d2b80404c5473896e62c1674dbc`. The pre-existing 30-line admin package-lock deletion is byte-for-byte
preserved; no frontend manifest/lockfile was modified by this phase. Customer began clean. No staging, commits, pushes,
provider mutation, hosted DB connection, shared demo fixture creation, migrations or bootstrap occurred. Database writes
below were confined to newly created disposable test PostgreSQL instances. No existing database was used.

## Fixes and policy changes

- Demo Admin's identity/TLS/connection-target guard remains exact, default off, with existing throttling/password policy.
  Accessories and validated remote uploads can now be enabled independently. Free demo filesystem uploads fail closed.
- Official ImageKit Storage adapter, bounded validation/HTTP, unique files, encrypted staff originals, authenticated
  owner/admin retrieval, stable application URLs, redacted failures and no local fallback. Legacy names remain URL-safe
  but missing remote bytes are not invented. Provider account eligibility/live persistence remains unverified.
- Staff-profile image serializer now uses shared validation; profile writes require admin and cannot reassign user.
- Image replacement/cascade deletion occurs after commit, checks references and isolates cleanup failures. Failed requests
  clean confirmed orphan uploads; crash/unknown-result orphans still require approved reconciliation.
- `/auth/me/` reports capabilities. Product image removal, upload previews/errors, private blob rendering, bounded catalog
  pagination, cold-start handling, and the customer booking View link are implemented across existing UI flows.
- No checkout/accounting schema or transaction logic was changed. Accessory-only customer ordering/live gateway processing
  remain outside implemented business scope. Financial model Admin protections remain intact.
- Docker default now matches one-worker/four-thread throttle assumptions; demo template uses the actual Docker runtime.

## Executed commands and results

Evidence root: `/private/tmp/gasbook-full-demo-validation/`; real-API browsers: `/private/tmp/gasbook-full-demo-browser/`.
The temporary launchers are **not release or migration tooling**. They copy source without `.env` files; create a fresh
PostgreSQL 17.11 container with `--network none`, no published ports, tmpfs database, no persistent volumes; verify
`current_database()` against their newly created name; and destroy only that container after tests. Python 3.12.15 and
isolated media/static paths are used. Source hashes are recorded in `final-backend-manifest.json`.

| Check | Exact command inside isolated environment | Verified result |
| --- | --- | --- |
| Clean Python installation | `python -m pip --isolated install --no-cache-dir --target /deps -r /requirements.txt imagekitio==5.11.0 cryptography==50.0.2` | Success; 32 resolved packages, subsequently pinned in requirements. |
| System checks | `python manage.py check --database default` | No issues. |
| Migration consistency | `python manage.py makemigrations --check --dry-run` | No changes detected. No migration files changed. |
| Expanded security | `python manage.py test core.tests.test_full_demo_media core.tests.test_image_security core.tests.test_demo_admin core.tests.test_admin_route_policy core.tests.test_production core.tests.test_demo_media core.tests.test_staff_image core.tests.test_login_throttle_policy core.tests.test_auth --noinput --verbosity 2` | 123 passed; zero failures/errors/skips. |
| Final full suite, accessories enabled | `python manage.py test core.tests --noinput --verbosity 2` | 686 total: 683 passed, 3 browser opt-in skips; zero failures/errors, 377.658 seconds. Final backend source hashes match the tested copy. |
| Historical disabled-accessory failures | Same 33 historical test identifiers, `ACCESSORIES_ENABLED=False`, unchanged HEAD and candidate separately | Both: 26 failures + 7 errors; exact identifiers/classifications match. These tests assume enabled accessory behavior. Full disabled suite was not rerun. |
| Real API browser workflows | `RUN_INVENTORY_BROWSER=1 RUN_PAYMENT_BROWSER=1 python manage.py test core.tests.test_product_browser core.tests.test_staff_payment_browser core.tests.test_checkout_browser --noinput --verbosity 2` | All 3 passed, 47.909 seconds; real disposable Django/PostgreSQL API, external network disabled. Both frontend app-source copies match current source. |
| Admin clean install | `npm ci --ignore-scripts --no-audit --no-fund` | Success, disposable copy; original lockfile preserved. |
| Admin unit/component tests | `bun test` | 93 passed, 0 failed. |
| Admin lint/build | `npm run lint`; `VITE_API_BASE_URL=https://api.invalid/api npm run build` | Both exit 0; build has existing >500 kB chunk warning. |
| Customer clean install | `bun install --frozen-lockfile --ignore-scripts` | Success in disposable copy; Bun lockfile preserved. |
| Customer unit/component tests | `bun test tests` | 140 passed, 0 failed. |
| Customer lint/build | `bun run lint`; `VITE_API_BASE_URL=https://api.invalid/api bun run build` | Both exit 0; unchanged OutstandingBalance fast-refresh warning, zero errors; large-chunk warning. |
| Customer mocked browser tests | `VITE_API_BASE_URL=https://api.invalid/api node node_modules/@playwright/test/cli.js test` | 13 passed in 45.2 seconds, including receipts/PDF and responsive layouts. These mock API responses. |
| Python advisory audit | `python -m pip_audit --disable-pip --no-deps --progress-spinner off -r /work/resolved-python.txt -f json` | 32 packages, zero known vulnerability findings; no hosted credentials supplied. |
| Working trees | `git diff --check` in both repositories | Pass; no staged changes. |

Real-API browser coverage includes product create/edit/image/stock, mixed booking, assignment, delivery, receipts/PDF,
partial/split collections, bank settlement, staff sale and lost-response retry, catalog pagination/inactive filtering,
cylinder checkout concurrent clicks/reload/layout switching, and history at widths 320–1280. The image service itself was
mocked; browser uploads used isolated local test media. Remote-upload tests also use the real SDK with MockTransport,
validating its multipart/signing contract without external calls. No hosted image, billing or persistence claim is made.

### Initial failures resolved without weakening tests

The first focused run had 3 subprocess dependency-path failures; the isolated Python harness was corrected. The first full
suite had one assertion expecting publicly accessible staff images. That assertion now requires anonymous 404 while
retaining all public catalog format checks; new authenticated tests cover all 3 staff-image formats. The initial admin
run exposed a loading-layout regression and 2 lint errors, all corrected. A new private-image test was made independent
of the build API origin. The first disabled comparison used duplicated test-method suffixes; the harness was corrected
and all 33 real baseline tests rerun. No existing financial/idempotency assertions were removed or skipped.

## Remaining gates

- Personal ImageKit account Forever Free/no card/no trial/billing-off status and remaining quota are not authenticated.
  User must verify the dashboard; credentials belong only in Render after separate approval.
- A real synthetic encrypted upload, retrieval/access check and persistence through restart/redeploy remain mandatory
  before calling hosted images ready. Do not exceed a free quota to test exhaustion; mock it locally.
- Encryption-key backup, storage inventory/reconciliation and separate media backup/restore verification remain needed.
- Git, Render/Vercel configuration/deployments and shared synthetic data all require separate explicit approval.
- No new migrations are required; preserve the existing ledger and migration 0015 guard. No release-tool changes.

## Exact pending file manifest

The following lists include this report and the preserved user lockfile edit. All entries are unstaged.

### gasbook — 41 files

- `README.md`
- `backend/Dockerfile`
- `backend/core/apps.py`
- `backend/core/exceptions.py`
- `backend/core/media_access.py`
- `backend/core/media_errors.py`
- `backend/core/media_lifecycle.py`
- `backend/core/media_storage.py`
- `backend/core/operations.py`
- `backend/core/products.py`
- `backend/core/serializers.py`
- `backend/core/services.py`
- `backend/core/tests/test_demo_admin.py`
- `backend/core/tests/test_full_demo_media.py`
- `backend/core/tests/test_image_security.py`
- `backend/core/tests/test_production.py`
- `backend/core/uploads.py`
- `backend/core/views.py`
- `backend/gasbook/environment.py`
- `backend/gasbook/settings.py`
- `backend/requirements.txt`
- `docs/phase-b-validation.md`
- `docs/production-deployment.md`
- `frontend/package-lock.json` — preserved pre-existing user change; untouched.
- `frontend/src/components/ImageUpload.tsx`
- `frontend/src/components/MediaImage.tsx`
- `frontend/src/components/catalog/CylinderTypesPanel.tsx`
- `frontend/src/hooks/useCapabilities.ts`
- `frontend/src/lib/api.ts`
- `frontend/src/lib/mediaUrl.ts`
- `frontend/src/lib/pagination.ts`
- `frontend/src/pages/Customers.tsx`
- `frontend/src/pages/Sales.tsx`
- `frontend/src/pages/admin/ProductsPanel.tsx`
- `frontend/src/pages/admin/Staff.tsx`
- `frontend/src/pages/admin/StaffHistory.tsx`
- `frontend/src/pages/staff/StaffDirectSale.tsx`
- `frontend/src/pages/staff/StaffMobileLayout.tsx`
- `frontend/tests/fullDemo.test.tsx`
- `frontend/tests/pagination.test.ts`
- `render.demo.yaml`

### gasbook-customer — 12 files

- `DEPLOYMENT.md`
- `src/components/common/CatalogProductCard.tsx`
- `src/components/common/ReliableImage.tsx`
- `src/components/desktop/DesktopExploreView.tsx`
- `src/components/desktop/DesktopHomeView.tsx`
- `src/components/views/ExploreView.tsx`
- `src/components/views/HomeView.tsx`
- `src/hooks/useAccessories.ts`
- `src/lib/auth.ts`
- `src/lib/pagination.ts`
- `src/lib/products.ts`
- `tests/pagination.test.ts`

---

## Historical validation reports

# Production-readiness validation — updated 2026-10-21

No commit, push, branch switch, Render/Vercel deployment, paid resource creation, or migration-tooling modification was performed.
The authorized Neon follow-up below includes only the dedicated demo database; earlier local-only sections are historical.
No production deployment or provider storage persistence is claimed.

## Exact demo database hostname correction — 2026-10-21

Starting state: both repositories clean on `main`; backend HEAD
`33edb8926613ec3e8c16e576fff962d4f39c4074`, customer HEAD
`0bff6fe798fa9d2b80404c5473896e62c1674dbc`. This local follow-up supersedes the earlier
direct/pooled hostname acceptance claims below; historical test results remain recorded unchanged.

The committed Admin guard and its positive fixtures omitted `.c-4` from the dedicated endpoint hostname.
The preceding read-only investigation found the actual Render configuration uses
`ep-calm-shape-b3nzc13z.c-4.ap-southeast-1.aws.neon.tech`, matching saved Neon endpoint metadata at
`/private/tmp/gasbook-neon-setup-ofl_voep/verified-endpoint.json` for project `long-rain-96731013`,
endpoint `ep-calm-shape-b3nzc13z`, branch `br-calm-silence-b36z6m8z`. That metadata supplies a direct
hostname only. The fresh Neon metadata request during the investigation returned HTTP 401; fresh
verification remains pending. This implementation phase made no provider requests or authentication changes.

Changes are limited to `backend/gasbook/environment.py`, `backend/core/tests/test_demo_admin.py`,
`docs/production-deployment.md` and this report. The guard now admits only the exact verified historical
direct hostname. The unverified pooled entry is removed; neither pooled spelling is admitted speculatively.
Positive fixtures use the actual direct hostname, and a new regression rejects the old hostnames,
unverified pooled aliases, different cluster/endpoint hosts, and prefix/suffix lookalikes. Existing TLS,
database-option/environment override, service identity, demo restriction, authentication and password-change
protections remain intact. The former pooled-positive cases are now explicit rejection cases; TLS/port
and effective connection-parameter assertions remain for the approved direct host.

Evidence, exact launchers and source hashes: `/private/tmp/gasbook-admin-hostname-obpywxpc/`.
The 140-file backend snapshot excludes credentials and local environment files. All 16 pinned runtime dependency
versions match `requirements.txt`; Python 3.12.15 and PostgreSQL 17.11 use existing local images only.
The focused launcher creates a fresh PostgreSQL container with `--network none`, no published ports or
persistent volumes, tmpfs data, and verified loopback database `gasbook_admin_hostname_obpywxpc`.
Tests use its separate `test_gasbook_admin_hostname_obpywxpc` database. Source/dependencies are mounted
read-only, and media/static output is disposable. The created container was removed after the tests.
No hosted/existing database, production service or QA database was accessed.

Commands actually executed:

```text
python3 -B /private/tmp/gasbook-admin-hostname-obpywxpc/run.py
python3 -B /private/tmp/gasbook-admin-hostname-obpywxpc/production_run.py
python3 -B /private/tmp/gasbook-admin-hostname-obpywxpc/baseline_run.py
```

The focused launcher invokes Django `collectstatic --noinput`, `check --database default`,
`makemigrations --check --dry-run` and the equivalent of:

```text
python manage.py test core.tests.test_demo_admin core.tests.test_admin_route_policy core.tests.test_production core.tests.test_login_throttle_policy core.tests.test_auth --noinput --verbosity 2
```

Results: **72 tests passed**, zero failures/errors/skips, 20.391 seconds, exit 0. System checks found
zero issues; migration consistency reported no changes. Database-target override rejection, actual
PostgreSQL connection-parameter construction without connection, production settings import, Admin
throttling/password-change and React authentication regressions all passed. The existing `runpy` warning
about re-executing `gasbook.urls` remains visible; it also appears in the preceding focused-suite log.

The production launcher uses a separate network-disabled container and explicitly forbids database
connections. `check --deploy` exited 0 with the two existing security.W005/W021 HSTS warnings; no warnings
were silenced. Admin login, WhiteNoise admin CSS and `/health/` returned 200, and the CSRF cookie was Secure.
The baseline launcher ran only the new hostname regression against the unchanged committed guard:
**one expected error**, the same `ImproperlyConfigured` at the actual-hostname acceptance assertion. Its
harness exited 0 after verifying that expected failure. The corrected guard passes this test in the focused suite.

The full backend/browser suites and hosted login were not rerun in this narrowly scoped correction.
No migration files, dependencies, `DATABASE_URL`, Render settings, customer files or existing data were changed.
No commit, push or deployment was performed. Fresh personal Neon metadata verification and separate
commit/push/deployment approval remain required; pooled-host support requires independent identity verification.

## Targeted Django Admin security follow-up — 2026-10-21

This section supersedes the earlier Admin implementation's security assessment. The existing nine-file patch
matched its saved final manifest before editing. Backend remains on main at `123a61202bc91c6bfc23d3d36070c305b18f1a2b`;
the customer repository remains clean on main at `0bff6fe798fa9d2b80404c5473896e62c1674dbc`.
All changes are local and uncommitted. No provider API, existing/hosted database or credential file was accessed.
Migrations, bootstrap commands, deployment settings, dependencies and customer-frontend files are unchanged.

### Fixes and coverage

- `backend/gasbook/environment.py`: constrain the exact direct/pooled Singapore hostname, database and port,
  allow only reviewed non-target connection options, and reject libpq target/service environment overrides.
  Previously `OPTIONS["dbname"]` could replace the name checked by the guard, and `hostaddr` could redirect
  the connection. Unknown options now fail closed. Tests parse actual synthetic URLs, inspect Django's real
  connection-parameter builder without opening connections, and exercise full production settings imports
  with network connections forbidden. Existing standard demo TLS/`channel_binding` configuration is supported.
- `backend/core/admin_site.py`: use Django's actual `UsernameField` normalization, with the model's username
  length bound, then case-fold before hashing the throttle key. Previously full-width and ASCII equivalents
  could get separate account buckets even though the login form treated them as the same username.
  Regression tests cover sequential and concurrent variants, the HTTP login path, expiry and oversized input.
- `backend/core/views.py`: reject new passwords matching the authenticated user's current password before
  validation/save, with a non-secret `password_reuse` error. Previously a strong temporary password could
  be reused and clear `must_change_password`. Existing validators remain; successful saves still update the
  hash and flag together and issue replacement tokens. Tests cover flagged/unflagged reuse, unchanged hash/
  flag/tokens on rejection, invalid new passwords, failed saves, successful changes, old access/refresh-token
  revocation, existing-session invalidation and subsequent Django Admin access.
- `backend/core/tests/test_demo_admin.py`: eleven additional test methods and stronger successful-change
  assertions; no existing assertions or tests removed. `docs/production-deployment.md` records the policy.

### Isolation and verification

Evidence and pre-change snapshots: `/private/tmp/gasbook-admin-security-34neki8_/`.
Each harness creates its own PostgreSQL 17.11 container with `--network none`, no published ports or persistent
volumes, and tmpfs data. Its backend runner can reach only that fresh container, has no hosted credentials,
mounts the source/dependency snapshots read-only and uses disposable media/static directories. Effective
loopback host and unique database name are asserted before connecting. Synthetic users exist only as test
fixtures; no existing user or business data is touched. Each test container is removed after its run.
All 16 installed runtime package versions match `requirements.txt`; no packages were installed or upgraded.

Focused launcher: `python3 -B /private/tmp/gasbook-admin-security-34neki8_/focused/run.py`.
It invokes the following through Django `call_command` after asserting the disposable target:

```text
python manage.py collectstatic --noinput
python manage.py check --database default
python manage.py makemigrations --check --dry-run
python manage.py test core.tests.test_demo_admin core.tests.test_admin_route_policy core.tests.test_production core.tests.test_login_throttle_policy core.tests.test_auth --noinput --verbosity 2
```

Focused result: **71 passed**, zero failures/errors/skips, 20.274 seconds, exit 0. System checks report zero
issues; migration consistency reports no changes. The first run had 18 subtest errors because the new standalone
connection-wrapper fixture omitted Django's normal `TIME_ZONE` default. Supplying that default fixed the
fixture; every case/assertion was retained. Both attempt logs and source manifests remain in the evidence directory.

Full feature-enabled launcher:
`python3 -B /private/tmp/gasbook-admin-security-34neki8_/full/run.py core.tests`.
It runs `python manage.py test core.tests --noinput --verbosity 2` with `ACCESSORIES_ENABLED=True` only in its
isolated container. Result: **668 tests, 665 passed, 3 existing opt-in browser skips, zero failures/errors**,
472.575 seconds, exit 0. System checks found no issues; migration consistency found no changes.
The demo configuration remains accessory-disabled. The browser suites were not enabled in this phase;
no hosted browser/login or frontend build verification is claimed.

Full disabled-accessory launcher:
`python3 -B /private/tmp/gasbook-admin-security-34neki8_/disabled/run.py core.tests`.
The same command/settings with the default `ACCESSORIES_ENABLED=False` ran **668 tests: 632 passed,
26 failures, 7 errors, 3 existing browser skips**, 514.886 seconds, exit 1. Every failing test identifier
matches the previously executed unchanged-`123a612` comparison at
`/private/tmp/gasbook-admin-baseline-hhp9e5v2/focused-suite.log`. That baseline source manifest was rechecked
against the exact committed blobs; it matches. The baseline itself was not rerun in this follow-up.
The failures remain accessory tests assuming enabled catalog/checkout/sales operations; disabled routes
return unavailable responses or empty catalogs. No new failure identifiers were introduced. See
`baseline-comparison.json`; existing tests and the live demo's disabled-accessory policy remain unchanged.

An additional production-mode run of `production_checks.py` in a `--network none` container explicitly forbade
database connections. `check --deploy` exited 0 with only the existing security.W005/W021 HSTS warnings.
The opted-in Admin login page, WhiteNoise admin CSS and `/health/` returned 200 with a Secure CSRF cookie.
This verifies local production settings without connecting to Neon; `production-checks.log` contains the results.

### Limits and approval

The exact demo opt-in, production HTTPS/CSRF/cookies, session permission guard and independent React API throttle
remain intact. The Admin limiter remains process-local and needs one worker; counters reset on restart and
shared proxy buckets can delay legitimate users. This is configuration validation, not live Neon attestation;
`sslmode=require` still does not guarantee hostname-certificate verification. No hosted login or browser
verification is claimed. Review and separately approve committing/pushing and deployment; no migrations,
bootstrap, new resources, paid service or billing change is required.

## Dedicated-demo Django Admin opt-in — 2026-10-21

This section describes local changes awaiting approval; older entries below are historical.
Starting repositories were clean: `gasbook` main at `123a61202bc91c6bfc23d3d36070c305b18f1a2b`
and `gasbook-customer` main at `0bff6fe798fa9d2b80404c5473896e62c1674dbc`.
No provider API, hosted database, credential file or existing database was accessed in this phase.

### Implementation

The original `/admin/` exclusion prevented two bypasses: Django session login does not run the DRF login
throttles, and AdminSite permission checks do not run the JWT forced-password-change guard.

- `backend/gasbook/environment.py`, `settings.py`, `urls.py`: default-off `DEMO_DJANGO_ADMIN_ENABLED`,
  validated against the approved Render service ID, backend hostname, Neon endpoint/database, required TLS,
  production security and demo upload/accessory restrictions. A mismatched opt-in fails startup. No connection
  is made by this check. No production route is opened merely because a superuser exists.
- `backend/core/admin_config.py`, `admin_site.py`: Django's supported custom default AdminSite, preserving
  all existing registrations and permissions. A temporary-password account cannot establish an admin session;
  the site permission hook also rejects existing sessions while that flag is set. The user must first change
  the password in the React management app. Session password-hash invalidation remains intact.
- Admin login has a separate thread-safe, bounded sliding-window limiter (10 username/peer, 30 peer, 60 global
  POSTs per minute), no forwarded-header trust, no persistent account lockout, 429/Retry-After/no-store responses,
  generic failed/throttled-login logging and sensitive form-field redaction. CSRF is retained.
  This is for the existing one-worker/four-thread demo only: counters reset on restart and are not shared
  between workers/instances. Shared proxy buckets can temporarily delay legitimate attempts.
- `backend/core/tests/test_admin_route_policy.py`, `test_demo_admin.py`: route policy, configuration rejection,
  concurrent/expiring/rotating login budgets, redaction, CSRF/HTTPS/static assets, staff/active checks, temporary
  passwords, flagged sessions, session invalidation and the real React password-change API.
- `docs/production-deployment.md`: exact opt-in, limitations, approval/deployment sequence and flag-off rollback.
  No Render template, dependency, migration, bootstrap command, business logic or customer frontend was changed.

### Isolation and commands

Evidence and final source hashes: `/private/tmp/gasbook-demo-admin-native-vafwolg1/`.
The runner creates a new PostgreSQL 17.11 container on `--network none`, with tmpfs data and no published ports
or persistent volume. The backend container shares only that new container's network namespace, uses a read-only
source snapshot and isolated `/tmp` media/static paths, and asserts the effective database name/loopback host
before Django connects. Source copies exclude `.env` files. The test target is
`test_gasbook_admin_review_native`; no existing database is used or restarted.
Each run stops/removes its own disposable database container.

Native runtime: Python 3.12.15; all 16 installed package versions exactly match the committed requirements,
including Django 5.2.18 and Pillow 13.0.0. No dependencies were installed/upgraded and the full suite retains
its ordinary password hashers. Tests specifically exercising admin request behavior use a test-class-only
fast hasher; existing security tests are unchanged.

Commands invoked by the isolated harness:

```text
python manage.py collectstatic --noinput
python manage.py check --database default
python manage.py makemigrations --check --dry-run
python manage.py test core.tests.test_demo_admin core.tests.test_admin_route_policy core.tests.test_production core.tests.test_login_throttle_policy --noinput --verbosity 2
python manage.py test core.tests --noinput --verbosity 2
```

The harness invokes these commands through Django's `call_command` after asserting the disposable target.
Exact launchers are `python3 -B /private/tmp/gasbook-demo-admin-native-vafwolg1/run.py` and
the same command with `core.tests`. No migrate command was run against an existing database;
the normal test runner applies existing migrations only when building its fresh disposable test database.

Final focused result: **47 passed**, zero errors/failures/skips. System checks report zero issues;
`makemigrations --check --dry-run` reports no changes. WhiteNoise serves admin CSS with DEBUG off, and
login issues a Secure CSRF cookie.

The first full run kept the default `ACCESSORIES_ENABLED=False`: **657 tests, 621 passed, 26 failures,
7 errors, 3 opt-in browser skips** (350.344 seconds, exit 1). All 33 failing tests expect enabled accessory
catalog/checkout/sales operations; disabled endpoints return unavailable responses or an empty catalog.
Running those exact 33 tests against unchanged commit `123a612` in another fresh disposable PostgreSQL
container reproduced **the same 26 failures and 7 errors** (13.704 seconds, exit 1). The six affected legacy
test modules are byte-identical to HEAD. These are existing test-configuration assumptions, not AdminSite
regressions. The demo remains accessory-disabled; no tests or application gates were weakened.
Baseline evidence: `/private/tmp/gasbook-admin-baseline-hhp9e5v2/` and `baseline-comparison.json` in the main
evidence directory. Its initial label-generation attempt failed discovery without executing tests; the
corrected run above is the actual baseline comparison, and both logs are preserved.

The complete candidate suite was then run with `ACCESSORIES_ENABLED=True` **only inside the disposable test
container**, using the same source and ordinary settings/password hashers:
`python3 -B /private/tmp/gasbook-admin-accessories-w5mktjqf/run.py core.tests`.
This invokes `python manage.py test core.tests --noinput --verbosity 2`.
Result: **657 tests, 654 passed, 3 existing opt-in browser skips, zero failures/errors**, 376.289 seconds,
exit 0. System checks reported zero issues and migration consistency reported no changes.
The test database was `test_gasbook_admin_review_accessories`; its fresh isolated PostgreSQL container was
removed after completion. See that directory's `full-suite.log` and source manifest. The passing feature-enabled
run supplements rather than replaces the disabled-feature results above. No hosted/demo setting was changed.
The skipped suites are checkout, inventory and staff-payment browser workflows; no browser, frontend build or
live deployment check was run in this phase. The new React authentication regression uses the actual Django API,
session/password code and disposable PostgreSQL through Django's test clients, not a hosted browser session.

An additional `production_checks.py` run used production/demo settings in a `--network none` container and
patched `BaseDatabaseWrapper.ensure_connection` to reject every database connection. `check --deploy`
exited 0 with only the existing security.W005/W021 HSTS subdomain/preload warnings (none silenced).
`/admin/login/`, admin CSS and `/health/` returned 200, with a Secure CSRF cookie and no database connection.
See `production-checks.log`; this is local verification, not a claim about the live Render route.

Earlier attempts are preserved rather than hidden: the x86 focused run passed 45 tests before the two extra
static/session checks. Its full run was intentionally stopped (exit 137) to avoid CPU emulation, then replaced
with the dependency-matched native run. The first native focused run had nine cascading setup errors because
the newly added CSS test manually closed its streaming response inside a TestCase transaction. Consuming the
stream through Django's test-client wrapper fixed the cleanup; no assertion or application control was removed.
The pre-existing runpy URL-module warning remains non-fatal.

### Remaining approval

The live `/admin/` route has not been enabled or deployed in this phase. Review/approve the diff before any
commit or push. Separately approve setting `DEMO_DJANGO_ADMIN_ENABLED=True` and deploying the approved backend
commit on the existing Free demo service after verifying its identity and single-worker start command.
No migration, database change, admin re-bootstrap, new credential, paid resource or billing change is needed.
Authenticated browser verification of the hosted Django Admin remains a post-deployment step.

## Neon setup, agent tooling and read-only connection proof — 2026-10-20

Starting state: backend/admin `main` at `d14e7e1d99a6d3127e3ca936e28bdd6bb9c215eb`, 55 pending files;
customer `main` at `aefc229586510d9ca4f9f88cbc5f5b688b599128`, 21 pending files; nothing staged.

Installed official Neon CLI 8.8.0 into `~/.local/share/gasbook-cli/neon/` with npm and separate empty npm configuration
files. The initial install attempt failed because npm rejects using `/dev/null` as both configuration files;
the corrected isolated install succeeded (155 packages). No shared npm configuration was changed.
Browser login succeeded using only `~/.local/share/gasbook-cli/auth/neon/`; authenticated identity is the confirmed personal
account. API metadata confirms organization `org-odd-dawn-79396664`, plan `free`, project `gasbook-demo`
(`long-rain-96731013`), Singapore, PostgreSQL 17, branch `production` (`br-calm-silence-b36z6m8z`).

Installed the official `neon` and `neon-postgres` skills (12 files including references) under the workspace's
`.agents/skills/`. The fetched official overview and installed overview have identical hashes. Added only the
project-local OAuth Neon MCP entry in `.codex/config.toml`, read-only and restricted to project/branch/docs categories
for the supplied project. `codex mcp list --json` recognizes Neon as enabled; MCP authentication remains unverified.
Global Codex configuration and its Vercel entry are byte-identical.

Changes in `gasbook/`: `.gitignore` protects new local Neon secrets/context and tooling dependencies; new `neon.ts`
contains a PostgreSQL-only policy with no branch overrides; root `package.json`/`package-lock.json` contain
`@neon/config` 1.9.2 and `@neon/env` 1.6.3. Existing application, migration, dependency and customer source files
were preserved. Updated this report and `production-deployment.md`. Ignored `.neon` and mode-0600 `.env.local`
were created; no existing `.env` was overwritten. Reported env names only: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`,
`NEON_BRANCH`. The Python application already accepts the connection through its existing `DATABASE_URL` configuration.

### Commands and verified outcomes

All Neon commands use the isolated `--config-dir`, `--no-analytics`, and the explicit project/branch. No secret output is retained.

| Check | Actual result |
| --- | --- |
| `neon init -y --org-id org-odd-dawn-79396664 --project-id long-rain-96731013 --branch production --services postgres --no-agent-setup --package-manager npm` in `gasbook/` | Exit 0; local link/config/env created. Existing agent setup was preserved. |
| `neon config plan --project-id long-rain-96731013 --branch production` | Exit 0; Postgres only; zero non-noop changes, zero conflicts |
| `neon deploy --project-id long-rain-96731013 --branch production` | Exit 0; Postgres only; zero non-noop changes, zero conflicts; local env refreshed. No app deployment. |
| New root tooling: isolated `npm ci --offline --ignore-scripts --no-audit --no-fund` | Exit 0; 22 packages installed from the isolated public-registry cache; lockfile reproduced |
| New root tooling: isolated `npm audit --package-lock-only --json --ignore-scripts` | Exit 0; zero vulnerabilities at all severities. This is not a new audit of the frontend/Python dependency trees. |
| Django `check(databases=[])` in isolated Python 3.12.15 runtime | Zero issues |
| Named demo endpoint verification, direct psycopg TLS, `SHOW transaction_read_only`, `SELECT 1` | Pass; host matched the verified project endpoint; client TLS True; read-only True |
| Read-only schema/migration metadata | Zero public base tables; 37 pending forward migrations; no migrations executed |
| Temporary local Gunicorn with production security and demo upload flag | `/health/` 200; `/ready/` 503, `migrations_pending`; process stopped after checks |
| Admin disposable copy: `npm run build` | Exit 0, 1869 modules, built in 1.36s; large-chunk warning remains |
| Customer disposable copy: `npm run build` | Exit 0, 227 modules, built in 1.36s; large-chunk warning remains |
| Network-disabled local Vite previews | Admin `/`, `/login`, `/admin-dashboard` and built JS: 200; customer `/` and built JS: 200; processes stopped |

The initial connection harness failed an assertion because it used `pg_stat_ssl` for the database-side hop to establish
client TLS. That internal-hop observation is False behind the provider proxy. The corrected test explicitly asserts
psycopg/libpq's `ssl_in_use` (True) for the actual client connection and keeps read-only enforcement; it then passed.
Both sanitized attempt logs are retained. No existing test was weakened or changed.

Frontend checks used current source copies plus the previously clean-installed Linux dependencies, after confirming
both manifests/lockfiles exactly matched those installations. They ran with Node 24.22.0, network disabled and
`VITE_API_BASE_URL=https://api.invalid/api`; these were not new frontend installs, provider tests, or live frontend/API
integration tests. Full backend/unit/browser suites were not rerun in this setup phase.

Evidence: `/private/tmp/gasbook-neon-setup-ofl_voep/`, including `before.json`, `build-results.json`, build logs,
`preview-results.json`, `neon-plan-summary.json`, `neon-deploy-summary.json`, `neon-connectivity.json` (complete ordered
37-migration list), sanitized attempt logs and read-only harness. No credentials are stored in these reports.

**Remaining gate:** user approval for the 37 forward migrations on this named empty demo target, then separate secure
admin bootstrap/test-data approval. Core 0015's legacy-order guard and 0017's nullable image migration stay intact.
No backup/snapshot was created or restore-tested. Do not claim end-to-end login/booking readiness, hosted frontend/API
URLs, or a live Render/Vercel deployment. The existing unrelated Neon project and `gasbook_qa` were not accessed.

## Simple ₹0 demo: bundled images and no uploads — 2026-10-20

This is the current demo decision and supersedes the ImageKit candidate below. Keep two Vercel Hobby frontends,
Render Free and Neon Free. No media service or database image storage is required.

### Local changes

- New `core/demo_media.py`: storage rejects uploads/reads and does not delete existing files.
- `gasbook/settings.py`: explicit `DEMO_DISABLE_UPLOADS` flag, default False; only this mode removes the persistent
  `MEDIA_ROOT` requirement. All normal production security/PostgreSQL requirements remain.
- `core/uploads.py`, `core/products.py`, `core/views.py`, `core/operations.py`: reject shared staff/cylinder/product
  uploads before decoding, return null image fields and make uploaded-media routes 404 without filesystem access.
  Existing non-demo image validation/URLs are retained.
- `render.demo.yaml`: sets the demo flag without any media credential, disk or resource.
- New `core/tests/test_demo_media.py`, plus one customer `tests/cylinderCatalog.test.ts` case for bundled fallback images.
- This report, the runbook and customer deployment notes describe the no-upload limits and rollout gates.

Admin image inputs remain visible; an attempted upload reports that photos are disabled for the demo and asks the user
to save without a photo. Existing customer cylinder artwork and admin/staff placeholders are used. No application
frontend code, image asset, dependency, migration, old release tool or HomeView.tsx change was made.

### Checks actually executed

Disposable source copies and harness: `/private/tmp/gasbook-simple-demo-5jvs54rk/`.

1. A fresh `docker run --rm --network none --read-only` runner used the already installed verified dependencies,
   mounting them and the source copy read-only, with `/tmp` in disposable memory. No old test/database container was
   restarted. Exact runtime: Python 3.12.15, Django 5.2.18, Pillow 13.0.0, DRF 3.18.3.
2. `/work/verified-venv/bin/python -B /review/check_backend.py` used `django.db.backends.dummy` and forbidden connection
   methods, then `check(databases=[])` and direct unittest loading (no database setup or migration). Labels:
   `core.tests.test_demo_media`, `core.tests.test_production.ProductionConfigurationTests`,
   `core.tests.test_production.ProductionMediaTests`, `core.tests.test_image_security.ImageBoundaryTests`,
   `core.tests.test_admin_route_policy`. Final result: **33 passed, 0 errors/failures/skips**.
   An initial run had one teardown error caused by mocking the database connection proxy's cursor; replacing the
   whole proxy in the test fixed cleanup without weakening the no-database guard or changing application behavior.
   The existing admin-route runpy warning remains; it did not fail the tests.
3. The same harness ran `collectstatic` into disposable `/tmp/demo-static`, Django system checks (zero issues), and
   verified WhiteNoise `/static/admin/css/base.css` returned HTTP 200. Production configuration subprocess checks
   require no `MEDIA_ROOT` in demo mode while still rejecting missing security/DB settings, debug mode and SQLite.
4. In the disposable customer copy:
   `env -i PATH=/opt/homebrew/bin:/usr/bin:/bin VITE_API_BASE_URL=https://api.invalid/api /opt/homebrew/bin/bun test tests/cylinderCatalog.test.ts`
   Result: **23 passed, 0 failed, 75 assertions** using mocked API requests. No real API/provider was called.

No full backend suite, PostgreSQL/browser integration run or frontend production build was repeated in this focused
phase; the previous results below remain historical. No dependency installation, hosted upload, database connection,
migration, admin bootstrap, provider mutation, commit, push or deployment occurred.
The local media blocker is resolved for the explicitly upload-disabled demo, not for future uploaded-media use.
The hosted demo is not running: dedicated Neon target creation, release Git operations, migration/bootstrap and
Render/Vercel configuration/deployment still require their separate approvals.

## Earlier free media review and account evidence — 2026-10-20

This section supersedes the account/media blockers recorded in the earlier planning section below. It is a
documentation/public-source review, not an implemented storage integration.

- Authorized isolated Render workspace selection and read-only inventory are complete: personal workspace, three
  unrelated Free services, no GasBook service or listed Render PostgreSQL resource. User screenshot evidence confirms
  Hobby, no card, $0 unbilled and 0.75/750 Free hours used; bandwidth/build balances remain unknown.
- User Neon screenshot evidence confirms personal access and Free at $0/month, 1 GB database storage and 100 monthly
  compute hours. Existing project `red-hill-13026001` has an unresolved application association; no data was accessed.
  Object Storage is displayed at $0.023/GB-month and is excluded under the user's strict ₹0 instruction.
- Official ImageKit documentation establishes a Forever Free/no-card hosted media candidate with capped storage and
  bandwidth, feature stoppage at quota exhaustion, Python support and basic signed/private delivery. This does not
  verify a personal account, implement a Django adapter, or prove live access controls/persistence.
- The runbook records the selected candidate, quota/retention/backup limitations, local database-free test proposal and
  a separately gated upload-disabled fallback. Vercel frontends, Render Free and Neon Free remain the architecture.
- Starting HEADs/status and all non-secret saved source hashes matched `/private/tmp/gasbook-demo-prep-bsxpzrdz/final-manifest.json`.
  Only the existing runbook, this validation report and customer `DEPLOYMENT.md` are updated in this review.
  Final hash comparison confirms every other saved non-secret source file, including HomeView.tsx, is unchanged.
  Branches/HEADs/status are preserved: 53 backend/admin and 21 customer pending files, zero staged.
- Both repositories' `git diff --check` passed. Because these documents are already untracked candidate files,
  each was also checked against its saved pre-review copy with `git diff --no-index --check`: no whitespace
  diagnostics. The initial verification wrapper incorrectly treated exit 1 for changed files as a failure;
  the corrected check accepts that normal diff status only when there are no diagnostics.
- No installation, application tests/builds, database connections, provider writes, media uploads, commit/push or
  deployment occurred. Earlier test counts below remain historical and do not establish an ImageKit integration.

Evidence and document snapshots: `/private/tmp/gasbook-free-media-review-tyfs2o8a/`.
Hosted fake-data testing remains **BLOCKED** pending media account verification/implementation and separate release approvals.

## Earlier ₹0 demo preparation follow-up — 2026-10-20

This is configuration/release planning, not another application remediation or a deployment.
The new personal non-commercial demo scope permits only synthetic customers/bookings and no real payments.
The full demo/commercial plan is recorded in `production-deployment.md`; the customer contract is updated in
`gasbook-customer/DEPLOYMENT.md`.

### Current evidence

- Started at the same `main` HEADs recorded below, with 52 backend/admin and 21 customer pending files, nothing staged.
  Every saved source hash matched `/private/tmp/gasbook-remediation-rkuoqlm3/final-manifest.json`.
- Render personal identity and its single visible workspace were verified using the existing isolated CLI. No active
  workspace is selected; selection is awaiting approval. Render services, billing, payment methods and deploy triggers
  remain unverified.
- Vercel personal identity, OWNER membership and active Hobby/non-trial plan were verified. Complete team/project
  pagination found one accessible team and five projects, with neither GasBook repository connected. No GasBook domains
  or deployments exist in that inspected scope. Usage/cost retrieval returned unavailable, not zero.
- Neon has no authenticated access here. No dedicated free project, database or bucket was created or inspected.
- Official free-plan/eligibility/media documentation was checked. The confirmed non-commercial demo fits Vercel Hobby's
  published usage restriction. The proposed ₹0 sum still requires Render no-charge and Neon account verification.
- `render.demo.yaml` is a new review-only Free plan template, not a deployable completed configuration. No media mount
  is supplied; current production settings fail closed until durable storage is resolved. This deliberately prevents
  silently persisting uploads on an ephemeral Render filesystem.

### Files and checks in this follow-up

Only four files changed relative to the preceding remediation: new `render.demo.yaml`, existing
`docs/production-deployment.md`, existing `docs/phase-b-validation.md`, and customer `DEPLOYMENT.md`.
The original `render.yaml`, every application/test/dependency/migration file, and customer HomeView.tsx are unchanged.
Pending totals are now 53 backend/admin and 21 customer files, still with nothing staged and unchanged HEADs.
The earlier runnable source remains byte-identical; no application tests/builds were rerun in this follow-up.
All backend/unit/browser/build numbers below describe the preceding isolated remediation run.

| Executed check | Result |
| --- | --- |
| Both repositories: `git diff --check` | Pass |
| Ruby/Psych `YAML.safe_load` plus 12 static assertions on `render.demo.yaml` | Pass: single free Python service; auto-deploy off; exact readiness route; no DB/disk/release side effects; one worker/four threads; media gate; unset secrets; production settings |
| Source hashes against this follow-up's initial manifest | All application/dependency/test/migration files preserved; only the listed documentation/template changed |
| Provider/resource/database mutations | None |
| Hosted smoke tests and persistent-media tests | Not run: no approved deployment, verified database or storage integration |

No package installation, new runtime tests, database access, migration, bootstrap, commit, push, or deployment was done.
Sanitized provider evidence, final manifest, incremental patches and static-validation details are kept under
`/private/tmp/gasbook-demo-prep-bsxpzrdz/`. The local template does not certify Render dashboard settings or billing.
Readiness for a **hosted fake-data demo is BLOCKED**, pending the access/₹0/media gates and specific release approvals.

## Coordinated production-readiness remediation — 2026-10-20

This section records the preceding implementation and supersedes the older remediation findings/results below.
The demo-preparation section above governs the current deployment scope. This was local implementation and disposable validation only.
No Git operation beyond inspection, provider mutation, deployment, existing-database access or release-tool execution occurred.
No existing database status is inferred from the disposable migration tests.

### Baseline and preservation

- `gasbook`: main, `d14e7e1d99a6d3127e3ca936e28bdd6bb9c215eb`; started with 41 pending files (27 modified, 14 untracked), nothing staged.
- `gasbook-customer`: main, `aefc229586510d9ca4f9f88cbc5f5b688b599128`; started with 8 pending files (3 modified, 5 untracked), nothing staged.
- Final pending totals: 52 backend/admin (34 modified, 18 untracked), 21 customer (11 modified, 10 untracked); HEADs/branches/staging unchanged.
- No source from the initial snapshot was removed. HomeView.tsx, requirements.txt/Pillow 13.0.0, upload validation, token revocation,
  the ordinary test runner, old guarded settings and every migration file remain byte-identical to the starting candidate.
- Source snapshot, raw audits, sanitized logs, install reports, harnesses, final hashes and incremental/combined patches:
  `/private/tmp/gasbook-remediation-rkuoqlm3/`. Temporary artifacts are local evidence, not deployment files.

### Implemented fixes and evidence

| Issue/root cause | Implementation | Coverage |
| --- | --- | --- |
| Catalog fetched only the first page | Complete same-origin, exact-endpoint, sequential pagination; consistent counts, unique IDs, valid rows, bounded requests; defer image registration; weight/name/PK backend ordering | 22 catalog tests plus real mobile/desktop Explore, error/retry and desktop home first-four limit |
| Cylinder cart used independent POSTs and could partially succeed | Reuse atomic Booking/BookingItem checkout with signed quotes; PostgreSQL key advisory lock, customer lock, unique persisted client_ref and request hash | Rollback after first line, same-key replay, changed payload/customer, concurrent collisions, notifications, stock/delivery and mixed-cart regressions |
| Retry state was cleared before cart acknowledgment and layouts had separate submission state | Shared in-flight promise; per-customer session intent; same-key retry; scoped read-only recovery endpoint; retain key until confirmed cart clearing persists | 11 checkout unit tests, real response loss/reload/layout switch/replay and recovery; backend verifies exactly two intended bookings |
| Responsive session restoration could strand a desktop-started page on login after resizing to mobile | Complete bootstrap for any non-splash screen, retaining mobile splash timing | Real browser reload and layout switching during restoration |
| API throttling did not protect Django AdminSite | Omit all admin routes in production; retain development/test access and React business interface | Repeated and concurrent attempts, usernames/IPs/forwarded spoofing all remain 404; health and API routes unaffected |
| IP throttle trusted an unverified forwarded hop | NUM_PROXIES=0 uses socket peer; account throttling retained | Spoofed-header independence, account normalization, expiry; existing real API login/password-revocation tests |
| Frontend/build dependencies had confirmed advisories | Targeted compatible upgrades, tested Tailwind 4/PostCSS migration, targeted Bun source-map-js override; patched pip build installer | Clean installs, full-tree audits, lint, builds, real browser workflows and PDF tests |

No schema migration is needed. The existing globally unique nullable BookingItem.client_ref is sufficient with transaction/advisory locking.
Replays precede new-checkout quote expiry/pricing/feature-flag checks. ACCESSORIES_ENABLED still gates new accessory purchases; existing
lines and successful replays remain available when the flag is off. The scalar booking API remains for legacy callers, without the new cart guarantee.

Recovery stores only UUID/hash/status/confirmed booking ID; no credentials, quote, address or payment secrets are added to the intent.
An explicit recovery lookup with no visible result permits edits while keeping the same UUID: a late original commit makes a changed request
conflict instead of creating another booking. Absence never authorizes discarding the UUID. This also permits recovery after the UI cart is lost.
Browser storage denial prevents sending a new checkout. Closing the tab/clearing storage loses session recovery context; review Orders before
creating another intent. Separate tabs/devices are separate intents. Matching previous-version mixed-cart keys are adopted without copying their
plaintext payload into the new format. Existing auth/cart storage behavior is otherwise preserved.

### Executed validation

All database commands below ran only inside the newly created PostgreSQL 17.11 container `gasbook-remediation-postgres-rkuoqlm3`,
with tmpfs storage, no host ports and no external network. The runner asserted the disposable database name and loopback address before
importing Django. Test database: `test_remediation_rkuoqlm3`; production probes used newly created `test_remediation_probe_*` databases.
Media/static paths and browser artifacts were isolated. No existing PostgreSQL server, development database or QA was consulted.
Python 3.12.15, Node 24.22.0, Bun 1.3.14 and the lockfiles were used. Network audits/installations ran in a separate credential-free container,
with only sanitized source copies mounted and isolated empty npm configuration. No host node_modules was reused.

| Command/check | Verified result |
| --- | --- |
| `python -m pip install --upgrade pip==26.2.0`; `python -m pip install -r requirements.txt`; `python -m pip check` | Fresh environment; pip reports 26.2 (same normalized version); all 16 runtime requirements installed; no broken requirements |
| `pip-audit --disable-pip --no-deps -r backend/requirements.txt -f json` | 16 pinned runtime packages, zero findings |
| `pip-audit --path /work/verified-venv/lib/python3.12/site-packages --progress-spinner off -f json` | 17 installed packages including pip, zero findings after installer fix |
| `python manage.py collectstatic --noinput` | Pass in isolated static directory |
| `python manage.py check` | No issues |
| `python manage.py makemigrations --check --dry-run` | No changes detected; no files generated |
| `python manage.py check --deploy` in production configuration | Exit 0; existing W005/W021 HSTS subdomain/preload warnings; no checks silenced |
| `python manage.py test core.tests --noinput --verbosity=2` with disposable `isolated_settings` | 626 discovered, 623 passed, 3 opt-in browser skips, 0 errors/failures |
| `RUN_INVENTORY_BROWSER=1 RUN_PAYMENT_BROWSER=1 python manage.py test core.tests.test_product_browser core.tests.test_staff_payment_browser core.tests.test_checkout_browser --noinput --verbosity=2` | 3 passed, none skipped; real Django/PostgreSQL workflows |
| Admin: `npm ci --no-audit --no-fund`; `npm audit --package-lock-only --json` | Clean lock-respecting install; zero vulnerabilities across runtime and development dependencies |
| Customer: `bun install --frozen-lockfile`; `bun audit --json` | Clean lock-respecting install; zero vulnerabilities; Bun lock retained |
| Admin: `bun test tests`; `npm run lint`; `npm run build` | 74 passed; lint 0 errors/warnings; build passes |
| Customer: `bun test tests`; `npm run lint`; `npm run build` | 123 passed; lint 0 errors/1 existing Fast Refresh warning in OutstandingBalance.tsx; build passes |
| Customer: `node node_modules/@playwright/test/cli.js test` | 13 passed; mocked API receipt/PDF/layout checks, distinct from real-API suites |
| Real Gunicorn production probe, one worker/four threads | Liveness 200 without DB; readiness 503 on empty/0016 DB, 200 after migrations, 503 on DB failure; no probe redirects for absent/http/https forwarded protocol |
| Same real Gunicorn probe | Normal routes retain HTTPS redirects; HTTPS admin login 404; WhiteNoise admin CSS 200 |
| Disposable `migrate core 0016`, synthetic historical-model catalog/stock rows, then `migrate` through 0017 | Existing names, active flags, prices and stock preserved; image field nullable; readiness becomes 200; no migration edits |
| Both repositories: `git diff --check` | Pass |

Build-only checks used the reserved invalid API origin; their bundles are not production artifacts. Browser network routing reaches only the
disposable Django server. The new catalog proxy preserves the public Host to exercise strict same-origin next-link validation. Browser users
use synthetic pre-issued test tokens; these tests do not prove public-provider login, CORS, TLS, billing or storage persistence. Transport failures
are deliberately injected after a real database commit for recovery tests. Test diagnostics redact Authorization headers, and route teardown waits
for outstanding proxy requests. No production customer/payment data was used.

Historical baseline comparison: the unchanged-main 561-test/91-error run and guarded 606-test result below were not rerun in this phase.
Their exact teardown cause/fix remains documented below; the preserved ordinary runner now passes the complete expanded suite without CASCADE.
The historical 19 admin lint errors/3 warnings stay resolved. During development, new test fixtures/harnesses required authentication setup,
static collection, DRF request headers, real responsive button labels and proxy teardown corrections; these are resolved, with no weakened assertions.
One actual application regression found by the new browser test—the responsive bootstrap race—was fixed as described above.

### Current security audit and dependency changes

Fresh admin npm audit reproduced 18 affected-package findings (14 high, 2 moderate, 2 low), representing 47 distinct direct advisory IDs plus
inherited findings. This is not a count of reachable browser exploits. Customer Bun audit found one high advisory, source-map-js through Vite/PostCSS.
Both final lockfile audits report zero. PDF renderer/parser and customer React versions were not flagged and remain unchanged.
No forced audit fix, broad override, customer npm lockfile or speculative package upgrade was used.

Tailwind 3 had no patched braces dependency path: [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) lists no patched braces
release. Tailwind 4.3.3 plus its official PostCSS plugin removes that chain and the vulnerable selector parser. Existing theme config, application
CSS and old default border color are retained. Modern staff browser eligibility (Safari 16.4+, Chrome 111+, Firefox 128+) needs confirmation;
Chromium workflows passed, while Firefox/WebKit/physical devices were not tested. No override forces incompatible transitive major versions.

Customer source-map-js 1.2.1 → 1.2.2 fixes [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), using a single targeted
override within its consumers' compatible range. Other customer direct versions are unchanged. The audit metadata and before/after lockfiles
in the evidence directory preserve vulnerable ranges and release resolutions.

| Package | Before → after | Severity | Shortest dependency path before fix | Advisory IDs / inherited dependency | Exposure |
| --- | --- | --- | --- | --- | --- |
| @babel/core | 7.29.0 → 7.29.7 | low | eslint-plugin-react-hooks → @babel/core | [GHSA-4x5r-pxfx-6jf8](https://github.com/advisories/GHSA-4x5r-pxfx-6jf8) | Build/development only |
| axios | 1.16.0 → 1.20.0 | high | axios | [GHSA-xj6q-8x83-jv6g](https://github.com/advisories/GHSA-xj6q-8x83-jv6g), [GHSA-mmx7-hfxf-jppx](https://github.com/advisories/GHSA-mmx7-hfxf-jppx), [GHSA-pmv8-rq9r-6j72](https://github.com/advisories/GHSA-pmv8-rq9r-6j72), [GHSA-mwf2-3pr3-8698](https://github.com/advisories/GHSA-mwf2-3pr3-8698), [GHSA-gcfj-64vw-6mp9](https://github.com/advisories/GHSA-gcfj-64vw-6mp9), [GHSA-7q8q-rj6j-mhjq](https://github.com/advisories/GHSA-7q8q-rj6j-mhjq), [GHSA-jqh4-m9w3-8hp9](https://github.com/advisories/GHSA-jqh4-m9w3-8hp9), [GHSA-f4gw-2p7v-4548](https://github.com/advisories/GHSA-f4gw-2p7v-4548), [GHSA-42h9-826w-cgv3](https://github.com/advisories/GHSA-42h9-826w-cgv3), [GHSA-hcpx-6fm6-wx23](https://github.com/advisories/GHSA-hcpx-6fm6-wx23), [GHSA-vh66-26gq-q6x8](https://github.com/advisories/GHSA-vh66-26gq-q6x8), [GHSA-9fr6-4gfg-395g](https://github.com/advisories/GHSA-9fr6-4gfg-395g), [GHSA-mghh-pgcx-3jjj](https://github.com/advisories/GHSA-mghh-pgcx-3jjj), [GHSA-x97p-jq2g-jp4f](https://github.com/advisories/GHSA-x97p-jq2g-jp4f), [GHSA-3pq3-5fj3-cg6v](https://github.com/advisories/GHSA-3pq3-5fj3-cg6v), [GHSA-542g-h47m-68v8](https://github.com/advisories/GHSA-542g-h47m-68v8), [GHSA-j8rh-479h-cp32](https://github.com/advisories/GHSA-j8rh-479h-cp32), [GHSA-4hqw-qxg8-jxx2](https://github.com/advisories/GHSA-4hqw-qxg8-jxx2), [GHSA-m8m8-qj5v-23w3](https://github.com/advisories/GHSA-m8m8-qj5v-23w3), [GHSA-44g4-m2mj-wpvx](https://github.com/advisories/GHSA-44g4-m2mj-wpvx) | Browser runtime; Node-only paths also included by audit |
| baseline-browser-mapping | 2.10.29 → 2.11.29 | moderate | autoprefixer → browserslist → baseline-browser-mapping | [GHSA-w5vr-8v7q-w6rv](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv) | Build/development only |
| brace-expansion | 5.0.6 → 5.0.12 | high | eslint → minimatch → brace-expansion | [GHSA-3jxr-9vmj-r5cp](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp), [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg), [GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895), [GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr), [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7), [GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) | Build/development only |
| braces | 3.0.3 → removed | high | tailwindcss → chokidar → braces | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | Build/development only |
| browserslist | 4.28.2 → 4.29.4 | high | autoprefixer → browserslist | [GHSA-c83g-rgw3-j3cx](https://github.com/advisories/GHSA-c83g-rgw3-j3cx), [GHSA-73wf-gq98-2v4g](https://github.com/advisories/GHSA-73wf-gq98-2v4g) | Build/development only |
| chokidar | 3.6.0 → removed | high | tailwindcss → chokidar | `braces` | Build/development only |
| fast-glob | 3.3.3 → removed | high | tailwindcss → fast-glob | `micromatch` | Build/development only |
| form-data | 4.0.5 → 4.0.6 | high | axios → form-data | [GHSA-hmw2-7cc7-3qxx](https://github.com/advisories/GHSA-hmw2-7cc7-3qxx) | Node adapter only in this browser application |
| micromatch | 4.0.8 → removed | high | tailwindcss → micromatch | `braces` | Build/development only |
| nanoid | 3.3.12 → 3.3.20 | high | postcss → nanoid | [GHSA-28wg-ghj8-5hjv](https://github.com/advisories/GHSA-28wg-ghj8-5hjv), [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8) | Build/development only |
| postcss | 8.5.14 → 8.5.31 | high | postcss | [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp), [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) | Build/development only |
| postcss-selector-parser | 6.1.2 → removed | moderate | tailwindcss → postcss-selector-parser | [GHSA-w9m9-85wc-3x92](https://github.com/advisories/GHSA-w9m9-85wc-3x92), [GHSA-rj75-hqrm-r3gf](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) | Build/development only |
| react-router | 7.15.0 → 7.18.4 | high | react-router-dom → react-router | [GHSA-84g9-w2xq-vcv6](https://github.com/advisories/GHSA-84g9-w2xq-vcv6), [GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6), [GHSA-h8fp-f39c-q6mh](https://github.com/advisories/GHSA-h8fp-f39c-q6mh), [GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg), [GHSA-chx6-hx7r-mcp5](https://github.com/advisories/GHSA-chx6-hx7r-mcp5), [GHSA-qwww-vcr4-c8h2](https://github.com/advisories/GHSA-qwww-vcr4-c8h2) | Browser routing; SSR/RSC modes not used here |
| react-router-dom | 7.15.0 → 7.18.4 | low | react-router-dom | `react-router` | Browser routing; SSR/RSC modes not used here |
| source-map-js | 1.2.1 → 1.2.2 | high | postcss → source-map-js | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) | Build/development only |
| tailwindcss | 3.4.19 → 4.3.3 | high | tailwindcss | `chokidar`, `fast-glob`, `micromatch` | Build/development only |
| vite | 8.0.11 → 8.0.16 | high | vite | [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3), [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) | Build/development only |


The initial installed Python tree also exposed bundled **pip 25.0.1**: 12 feed entries represented six distinct advisories, not 12 independent
vulnerabilities. These are installer exposure, not Django request handling. Build definitions now install pip 26.2.0 before runtime dependencies:

| Advisory | Severity | Fixed by |
| --- | --- | --- |
| [GHSA-4xh5-x5gv-qwph](https://github.com/advisories/GHSA-4xh5-x5gv-qwph) | medium | pip 26.2.0 |
| [GHSA-6vgw-5pg2-w6jp](https://github.com/advisories/GHSA-6vgw-5pg2-w6jp) | low | pip 26.2.0 |
| [GHSA-58qw-9mgm-455v](https://github.com/advisories/GHSA-58qw-9mgm-455v) | medium | pip 26.2.0 |
| [GHSA-jp4c-xjxw-mgf9](https://github.com/advisories/GHSA-jp4c-xjxw-mgf9) | medium | pip 26.2.0 |
| [GHSA-wf93-45jw-7689](https://github.com/advisories/GHSA-wf93-45jw-7689) | medium | pip 26.2.0 |
| [GHSA-qwm4-qh6w-59xr](https://github.com/advisories/GHSA-qwm4-qh6w-59xr) | medium | pip 26.2.0 |

Pillow remains 13.0.0, retaining the prior parser fix and pre-decode format/size validation. The clean full suite includes its upload regressions.
Zero scanner findings is current advisory evidence, not a guarantee that unknown vulnerabilities do not exist.

### Exact incremental file manifest

These are changes made in this remediation, relative to the saved 41+8-file candidate, including new files. All other pending work is preserved.

**Backend, tests and release documentation (`gasbook/`):**

- `backend/core/booking_items.py` — cylinder/mixed transactional checkout, key locking and saved-line handling.
- `backend/core/views.py` — deterministic catalog ordering, shared signed preview and scoped read-only recovery.
- `backend/gasbook/settings.py`, `backend/gasbook/urls.py` — conservative proxy identity and production admin-route removal.
- `backend/core/tests/test_checkout_recovery.py`, `test_product_concurrency.py`, `test_products.py` — atomicity, replay, locking, stock and flags.
- `backend/core/tests/test_admin_route_policy.py`, `test_login_throttle_policy.py` — production route policy and existing API throttle behavior.
- `backend/core/tests/test_checkout_browser.py` — real database/browser catalog and checkout recovery coverage, redacted diagnostics.
- `backend/Dockerfile`, `render.yaml` — pinned patched pip in build setup; no provider settings changed and no migration command added.
- `docs/production-deployment.md`, `docs/phase-b-validation.md` — current contracts, evidence, remaining prerequisites and rollback constraints.

**Admin frontend (`gasbook/frontend/`):**

- `package.json`, `package-lock.json` — targeted audited fixes and official Tailwind 4 PostCSS plugin.
- `postcss.config.js`, `src/index.css` — compatible build wiring, retained theme and border default.

**Customer (`gasbook-customer/`):**

- `package.json`, `bun.lock` — targeted source-map-js patch.
- `src/lib/auth.ts` — validated complete cylinder pagination and deferred image registration.
- `src/lib/products.ts`, `src/lib/checkoutIntent.ts`, `src/hooks/useCheckout.ts` — atomic checkout, shared state, persistence and recovery.
- `src/components/views/CheckoutView.tsx`, `src/components/desktop/DesktopCheckoutView.tsx` — consistent submission/recovery in both layouts.
- `src/components/views/HomeScreen.tsx`, `src/lib/uiState.ts` — cart lock, durable acknowledgment and empty-cart recovery.
- `src/App.tsx` — session restoration during responsive resizing.
- `tests/cylinderCatalog.test.ts`, `tests/checkoutRecovery.test.ts`, `e2e/checkout-live.mjs` — new defensive catalog and checkout regressions.
- `DEPLOYMENT.md` — backend contract, runtime/lockfile requirements, recovery and rollout constraints.

### Remaining release gates

Readiness is **READY WITH BLOCKERS**: safe local remediation is complete; production state is unverified.
Provider/account access was not inspected in this phase. Inspect personal Render/Vercel identity, project IDs, Git links, production branches,
auto-deploy triggers, root/build/runtime settings, exact URLs, environment-variable names, PostgreSQL identity/region/plan/backups and disk first.
Before any push, approve the exact combined files/commits and confirm it cannot trigger an unauthorized deployment.

Separately approve paid resources/eligible Vercel plan and recurring cost ceiling; verified backup/restore and target migration plan (especially
0015); persistent media disk/transfer and a persistence rehearsal; secure first business-admin bootstrap and real initial business data; and
backend-first/frontend-second deployment with actual API origins, CORS/CSRF, smoke tests and a compatible rollback artifact.
The cost figures in the runbook remain planning assumptions, not an account quote. No plan or commercial-use eligibility was verified here.

No new schema migration exists, but the first target still needs the complete approved chain. Never use the old release tooling unchanged,
fake/reverse migration records, bypass the legacy-order guard, or include migrations in build/start commands. Keep additive schema/media during
application rollback; an old backend lacking cylinder checkout/recovery is not a compatible rollback. Preserve Pillow/security fixes.

Process-local API limits remain best-effort and reset on restart; socket-peer buckets may group users behind Render. Provider proxy behavior,
single-worker/disk configuration, real backups, uploaded-file persistence and first-admin access remain external verification tasks.
The two existing HSTS warnings, one customer Fast Refresh warning and large-bundle warnings are retained and explained, not suppressed.

## Historical focused remediation — 2026-10-19

This section supersedes the unresolved test/lint/browser/readiness findings in the historical Phase B results below.
It includes all preserved Phase B changes and the subsequent Pillow 13.0.0 fix. No dependency pin, migration file,
older release tool, provider setting, or customer application source was changed in this focused phase.
Both repositories remain on `main` at the SHAs in Preserved state, with empty staging areas.

### Final results

| Check | Unchanged main / earlier finding | Final combined candidate |
| --- | --- | --- |
| Ordinary-settings PostgreSQL suite | Fresh baseline reproduced 561 tests, 91 errors, 2 skips; error names/multiplicity exactly match Phase B | 606 tests, OK, 2 opt-in browser skips; 604 executed successfully |
| Existing guarded PostgreSQL suite | Earlier baseline passed with its pre-existing CASCADE workaround | 606 tests, OK, same 2 opt-in skips; guarded settings unchanged |
| Two opt-in backend browser suites | Skipped in ordinary runs; product script had stale UI interactions | Both run separately and pass against the real disposable Django API/PostgreSQL |
| Admin lint | Fresh baseline clean install reproduced 19 errors and 3 warnings | 0 errors, 0 warnings |
| Customer lint | Existing Fast Refresh warning | 0 errors, same 1 warning in OutstandingBalance.tsx |
| Frontend unit tests | Earlier baseline: admin 57, customer 74 | Admin 74 pass; customer 90 pass |
| Frontend production builds | Earlier builds passed | Both clean-install builds pass; existing chunk-size warnings remain |
| Separate customer Playwright suite | 13 mocked-API tests | 13 pass; this is distinct from the live-API workflows |
| Django checks / migration drift | Earlier checks passed | System check passes; makemigrations --check --dry-run reports no changes |
| Production Gunicorn readiness | HTTPS redirect could mask unready state | Actual HTTP: 503 on fresh unmigrated DB, 200 after all migrations, 503 with unavailable DB; no Location header |
| HTTPS / liveness | Preserve normal HTTPS enforcement | API/admin/media still redirect; exact health/ready paths do not; liveness remains 200 without DB |
| Python installation | Pillow fix already pending | Clean Python 3.12.15 install includes Pillow 13.0.0; pip check passes; image-security tests pass in full suite |
| Git / preservation | Phase B + Pillow pending | diff --check passes; HomeView, all migrations and older tooling hashes preserved |

The 91 errors are now resolved in the ordinary test runner. Migration 0015 uses SeparateDatabaseAndState to retire models while
retaining `core_commerceorder`, `core_commerceline` and `core_serviceoffering`. Django's flush omits tables without current models;
PostgreSQL refuses to truncate referenced current tables (for example commerceorder references core_sale). Failed teardown then
causes duplicate-key errors in later tests. The new test runner includes only those existing retired tables in the same test flush
statement, without adding CASCADE or dropping tables. It applies only during a fresh serial test run in explicit test mode on the
created `test_…` database, then restores the connection method. Tests cover refusal and restoration paths.
The normal flush command, old guarded settings and all migration guards are unchanged. The existing test proving that populated
commerce orders block 0015 and remain present still passes. No existing legacy records were deleted or accessed.

Readiness uses exact, anchored Django SECURE_REDIRECT_EXEMPT entries for `/health/` and `/ready/`. Tests exercise absent/http/https
forwarded-protocol headers with healthy, pending-migration and failed-database states. Similar paths and normal routes still redirect.
An actual Gunicorn process with production settings repeated all nine state/header combinations against new disposable databases;
it also retained CSRF enforcement. Unauthenticated POST is 403 at middleware; the view itself allows only safe methods.
This does not certify Render's actual health-check path, allowed Host header or proxy configuration.

Admin lint fixes use lazy initial state, stable callbacks, state updates in API responses/events and explicit payload/report types.
No ESLint rules were disabled. Live regressions verify stock defaults after reload, report totals/date/location filters and staff
listing alongside existing sale/history workflows. Product browser selectors now follow the current image label, cart stepper,
order-detail panels, payment confirmation, expanded history and raster PDF preview. Amount/item/stock assertions remain;
the downloaded PDF must contain the product name and 1,420.00 total. No tests were removed or skipped to obtain these results.

### Isolation, evidence and coverage limits

Evidence is retained at `/private/tmp/gasbook-final-fix-s5yx0dmc` (temporary local storage, not permanent CI storage).
`before/` preserves the pre-phase candidate; `baseline/` was exported from unchanged HEAD; `candidate/` contains isolated test copies.
The new PostgreSQL 17.11 container used tmpfs, no published port, and only the new Python container shared its network namespace.
No developer environment file or existing database was used. Both disposable containers were stopped after the checks.
The tmpfs database contents are not retained; logs, scripts, install reports and patches remain.

Runtime/toolchain: Python 3.12.15, pinned Django/Gunicorn/Pillow requirements, Node 24.22.0, Bun 1.3.14 and Chromium via Playwright.
Clean installs used pip, admin npm ci and customer bun install --frozen-lockfile in temporary copies. Positive frontend builds
used `https://final-test.invalid/api`, deliberately unsuitable for deployment. No bundle from these checks is a production artifact.

- `backend-checks.py`, `final-backend-checks.py`: fresh ordinary/guarded PostgreSQL suites and model checks.
- `probe-checks.py`, `production-probe-results.json`: real production-mode Gunicorn before/after migrations and DB failure.
- `frontend-checks.py`, `extra-frontend-checks.py`: lint/unit/build checks, baseline lint and customer mocked-API Playwright.
- `browser-checks.py`, `candidate-live-browser.log`: both opt-in LiveServerTestCase suites with Chromium and four private Vite ports.
- `baseline-full-1.log`, `candidate-full-1.log`, `candidate-guarded-1.log`: complete backend results.
- `final-manifest.md` / `.json`: exact 41 gasbook and 8 customer pending files, hashes and phase classification.
- `gasbook-focused.patch`, `gasbook-customer-focused.patch`: changes from the preserved pre-phase snapshots.
- `gasbook-combined.patch`, `gasbook-customer-combined.patch`: complete HEAD-to-candidate patches including untracked files.

The two live browser suites forward requests to the real Django test server; they do not supply mocked API responses. They cover
product/image/catalog/stock, mixed checkout, admin assignment, staff delivery, cash/split/partial/credit payments, settlement,
lost-response retry, customer/admin history, receipt PDF and responsive widths. They use synthetic users and pre-issued fixture tokens,
development Vite servers and test CORS settings. They do not establish production login, HTTPS, Vercel rewrites, provider CORS,
backup restore, or Render disk persistence. Those remain explicit rollout smoke tests.

Intermediate failures were retained and resolved: lint-refactor declaration/dependency diagnostics, stale product-browser UI selectors,
new report/staff assertion selectors, collecting static files under settings that intentionally permit only `manage.py test`, and
expecting a view-level 405 before real CSRF middleware rejected POST with 403. Harness corrections did not bypass application guards.
No unresolved introduced test failures remain. This phase did not repeat the vulnerability scanner; dependency pins and the Pillow
image-validation implementation are byte-identical to the preceding security fix, and its regression tests were rerun.

### Files changed in this focused phase

Paths below are relative to `gasbook` unless stated otherwise; other pending Phase B/Pillow files are preserved.

| File | Change |
| --- | --- |
| backend/gasbook/settings.py | Exact operational-probe redirect exemptions; register disposable test runner |
| backend/gasbook/test_runner.py | New scoped cleanup for 0015-retained tables in fresh test databases |
| backend/core/tests/test_test_runner.py | New refusal, table-selection and restoration regressions |
| backend/core/tests/test_production.py | Explicit readiness/HTTPS redirect regressions |
| frontend/src/App.tsx | Lazy cached account state and asynchronous account updates |
| frontend/src/pages/Sales.tsx | Typed customers/payload, stable history callback, event-driven suggestions |
| frontend/src/pages/Stock.tsx | Initialize defaults on reference-data response; typed filter |
| frontend/src/pages/admin/Reports.tsx | Stable initial request and typed report aggregation |
| frontend/src/pages/admin/Staff.tsx | Stable loader and functional role default |
| frontend/src/pages/staff/StaffMobileLayout.tsx | Lazy cached profile state; separate initial request and explicit reload |
| frontend/e2e/staff-payments-live.mjs | Real-API regressions for lint-modified admin pages |
| gasbook-customer/e2e/products-live.mjs | Reconcile stale UI interactions while retaining business assertions |
| docs/production-deployment.md | Probe semantics, test cleanup, first-release ordering and approval checklist |
| docs/phase-b-validation.md | Current evidence and exact change inventory, retaining historical results |

### Outstanding release approvals

No provider audit was performed in this phase. The latest review's Render access gap and unresolved Vercel project/team scope remain;
callable tools alone do not verify dashboard access or settings. Approve the exact pending files/commit grouping and push/deploy steps
only after inspecting actual deploy triggers, resource identities and project roots. There are no new commit SHAs yet.
Then separately approve paid resource sizes/cost ceiling, database identity/backup/restore/full plan and migrations, disk/media transfer,
interactive first-admin bootstrap, real business setup and rollout smoke tests. Migration 0015 still requires data-preserving reconciliation
if legacy orders exist; the old 0010–0012 release tooling remains unsuitable and untouched. No existing migration status was inferred.
The earlier representative-data 0017 rehearsal remains historical evidence; this phase reapplied the complete unchanged chain only on
new disposable databases and ran all existing migration tests. Database/media restore or migration reversal needs separate approval.

Remaining limitations: customer Fast Refresh warning, large frontend bundles, process-local API login throttling and unthrottled Django
admin login, public media URLs, unverified paid-disk persistence and provider backups. The updated production runbook contains the
environment checklist, cost assumptions, safe rollout and rollback procedure. Stop for approval before further release work.

## Historical Phase B evidence

The sections below describe the original Phase B run; their unresolved findings are superseded by the latest section above.

## Preserved state

- Backend/admin baseline: `d14e7e1d99a6d3127e3ca936e28bdd6bb9c215eb` on `main`.
- Customer baseline at Phase B start: `aefc229586510d9ca4f9f88cbc5f5b688b599128` on `main`.
  This follows the Phase A audit SHA `1c0f525` and commits the pre-existing HomeView layout edit.
- Both trees were clean at Phase B start. `HomeView.tsx` was not edited by this work;
  its SHA-256 remains `1c050b3c327495c26b17f2ff8756e71b41029549a47a1ef7d7a04ea19be49fec`.
- Baselines came from `git archive HEAD`; candidate snapshots include tracked and new source files while excluding ignored `.env`, dependencies and local databases.
- Existing migrations and `gasbook-migration-release` were left unchanged. No database outside the new test container was accessed.

## Isolation and reproducibility

Evidence and runner scripts are retained locally in `/private/tmp/gasbook-phaseb-ufbw2bxq`.
This temporary directory is not a permanent CI artifact store. Relevant scripts are `backend_checks.py`, `inventory_checks.py`,
`candidate_inventory_checks.py`, `node24_checks.cjs`, `node24_candidate.cjs`, `migration_0017_final.py`, `runtime_smoke.py`,
`browser_checks.py` and `admin_spa_browser.mjs`.
They are specific to this disposable environment, not production release tooling.

PostgreSQL 17.11 ran in a new container with a tmpfs data directory. Python tests shared only that container's network;
database addresses were explicit and never obtained from a developer `.env` file. Separate standard-suite databases were used for baseline and candidate.
The existing inventory-test settings used `inventory_test`/`test_inventory_suite` only on that new server. Migration rehearsals used their own fresh databases.
The full suites were sequential when sharing static artifacts. Runtime static output was separated after an initial artifact race.
Both disposable backend/PostgreSQL containers were stopped after verification. Test evidence remains in the temporary directory;
the tmpfs database contents are not retained.

Final backend runtime: Python 3.12.15, Django 5.2.18, DRF 3.18.3, SimpleJWT 5.5.1, Gunicorn 26.2.0, psycopg 3.3.6, WhiteNoise 6.12.0.
The complete tested pins are in `backend/requirements.txt`; `pip check` reports no broken requirements.
Baseline's unrestricted Django range resolved to 5.2.18, while its Gunicorn constraint installed 21.2.0.

Frontend verification used clean npm/Bun installs in temporary copies, followed by fresh Linux installs in Node 24.22.0 with Bun 1.3.14.
The initial host runs used Node 26.5.0; the Node 24 runs verify the intended Vercel runtime.
All positive builds used a deliberately non-routable HTTPS test API hostname. None of those bundles is approved for deployment.

## Results

| Check | Unchanged baseline | Final candidate |
| --- | --- | --- |
| Django system check | pass | pass |
| `makemigrations --check --dry-run` | no changes | no changes |
| Default-settings PostgreSQL suite | 561 run; 91 errors; 2 skips | 578 run; same 91 errors; same 2 skips |
| Existing guarded inventory PostgreSQL suite | 561 run; OK; 2 skips | 578 run; OK; 2 skips |
| Admin clean unit tests | 57 pass | 74 pass |
| Customer clean unit tests | 74 pass | 90 pass |
| Both clean Node 24 production builds | pass | pass |
| Admin lint | 19 errors, 3 warnings | identical diagnostics after normalizing temporary paths |
| Customer lint | exit 0; 1 warning | exit 0; same warning |
| Customer Playwright | 13 pass | 13 pass |
| Candidate builds with missing/localhost API URL | no baseline guard | rejected as expected in both projects |
| Local admin direct-route/refresh browser smoke | not repeated | pass for login and protected admin-dashboard |
| Blueprint YAML and release safeguards | not repeated | pass; no build/start migration, manual secret, auto-deploy off |
| `git diff --check` | clean initially | pass |

The 91 standard-suite errors match by test name and error multiplicity. Retained commerce-table foreign keys prevent PostgreSQL TRUNCATE during flush;
the failed flush then leaves rows that cause duplicate-key errors. These are pre-existing, not introduced by Phase B.
The pre-existing `gasbook.test_inventory_settings` helper already uses `allow_cascade` exclusively for a guarded disposable database;
it was neither modified nor added by this work. Both full suites pass with it. The standard-suite failure remains visible and is not relabeled as a pass.

The two backend skips are the existing opt-in `ProductBrowserTests` and `StaffPaymentBrowserTests`.
Customer Playwright uses mocked APIs. Backend API/concurrency suites ran against PostgreSQL, but these results do not replace an actual provider end-to-end smoke test.
Both frontend builds retain bundle-size warnings. Existing admin lint remains a release/CI decision to resolve before deployment.

## New behavior exercised

- Production configuration rejects missing/weak secrets, debug true/invalid, missing or non-PostgreSQL database configuration,
  wildcard hosts, invalid origins and relative media paths. Configuration tests use an unreachable test address and never open a connection.
- Liveness is independent of the database. Readiness checks connectivity and the migration ledger, returns generic 503 errors, and disables caching.
- Both approved frontend origins pass CORS preflight and CSRF origin checks; an untrusted origin is rejected.
- Raster-only production media serving works with DEBUG false and rejects fake images, SVG, path traversal and outside symlinks.
- Staff upload creation/update reject invalid content, excess byte size and excess dimensions before retaining profile changes.
- File removal/replacement waits for transaction commit. Existing tests now assert old-file survival before commit as well as deletion after commit.
- Password change/reset invalidates old access and refresh tokens. Both frontend clients save replacement tokens before the next authenticated request.
  The existing test that expected old-token reuse was updated to assert revocation and replacement-token success.
- Production API login throttles respond with 429/Retry-After. Demo seeding is refused before writes outside explicit debug development mode.
- Interactive admin bootstrap confirms database identity, creates the three roles and one business admin, rejects a second admin,
  leaves business tables empty, and never prints the password.
- Build URL validation covers missing/relative/HTTP/local/credential/query/fragment cases; the admin rewrite configuration covers real app routes.

No tests were deleted or disabled. Initial candidate issues (upload exception conversion, static-manifest preparation,
transaction-commit assertions, and a customer TypeScript import extension) were corrected and rerun.
Final configuration review also replaced Render secret generation with an explicit private setting because its generated value
would not satisfy the tested minimum key length. No secret was generated or stored during this review.
An intermediate concurrent collectstatic/test race was fixed in the temporary harness by separating artifacts and sequencing checks.
The admin routing harness was also corrected to wait for the existing splash screen. No unresolved introduced test failures remain.

## Migration and production-mode smoke evidence

A fresh disposable database was migrated through core 0016. Representative existing cylinder/location/stock rows were created,
including pricing and nonzero stock. The pending core plan contained only 0017. Applying the full remaining plan preserved all old cylinder fields,
timestamps and stock rows, left the new image field empty, and left no pending migrations or model drift.
The final rehearsal used the pinned Django 5.2.18 runtime. No inference was made about development or production migration status.

Gunicorn 26.2.0 ran with production settings against the disposable migrated database. Verified:

- `/health/` and `/ready/` return 200 when appropriate.
- Hashed Django admin CSS is served by WhiteNoise with gzip; the admin login renders and issues a Secure CSRF cookie.
- Both configured origins receive the expected CORS preflight response.
- A valid uploaded image survives stopping/restarting the application process with a retained media directory; fake image content returns 404.
- A deliberately refused local database connection yields readiness 503 while liveness remains 200.

This proves application behavior with persistent filesystem contents, not Render disk provisioning or persistence across provider deployments.
`check --deploy --fail-level ERROR` passes with exactly W005/W021 because HSTS subdomain inclusion/preload remain intentionally off. No warnings were silenced.

## Exact file changes

Paths below are relative to the indicated repository.

| gasbook file | Reason |
| --- | --- |
| `.gitignore` | Ignore future runtime staff/cylinder uploads; preserve already tracked images |
| `backend/.env.example` | Explicit development-mode opt-in |
| `backend/.python-version` | Render-compatible Python pin |
| `backend/runtime.txt` | Keep the legacy runtime declaration consistent |
| `backend/Dockerfile` | Match Python pin; collect build assets without runtime production secrets |
| `backend/requirements.txt` | Reproducible tested dependencies and patched Django/Gunicorn |
| `backend/gasbook/environment.py` | Validate booleans, hosts, HTTPS origins and media paths |
| `backend/gasbook/settings.py` | Fail-closed production/database settings, HTTPS/cookies, STORAGES, media, CORS/CSRF and JWT policy |
| `backend/gasbook/urls.py` | Register liveness/readiness and safe media routes |
| `backend/core/operations.py` | Health/readiness behavior and raster-only media responses |
| `backend/core/authentication.py` | Account/IP throttling and password-aware refresh validation |
| `backend/core/uploads.py` | Reuse image decoding/limits for manual uploads and normalize validation errors |
| `backend/core/views.py` | Enable login throttles, validate staff uploads, defer file deletion, issue password-change replacements |
| `backend/core/management/commands/seed_demo.py` | Refuse production use; remove credential logging |
| `backend/core/management/commands/bootstrap_admin.py` | Interactive, identity-confirmed first business admin without demo data |
| `backend/core/tests/test_production.py` | Production configuration, HTTP, media, uploads, auth and bootstrap coverage |
| `backend/core/tests/test_auth.py` | Assert intentional token-revocation contract |
| `backend/core/tests/test_staff_image.py` | Verify file deletion after commit, preserving prior assertions |
| `frontend/.nvmrc` | Align local Node selection with tested Node 24 |
| `frontend/build/api-url.ts` | Production API URL validation |
| `frontend/vite.config.ts` | Enforce validated API URL in every build |
| `frontend/vercel.json` | SPA fallback |
| `frontend/src/lib/api.ts` | Store rotated refresh tokens and password-change replacements |
| `frontend/tests/productionConfig.test.ts` | URL guard and SPA configuration tests |
| `frontend/tests/passwordTokens.test.ts` | Verify replacement credentials are used on the next request |
| `render.yaml` | Controlled build/start, readiness, explicit settings and disabled auto-deploy; no resource creation |
| `docs/production-deployment.md` | Environment checklist, bootstrap, storage, migration reconciliation, sequence, costs and rollback |
| `docs/phase-b-validation.md` | This evidence and change inventory |

| gasbook-customer file | Reason |
| --- | --- |
| `.nvmrc` | Tested Node 24 selection |
| `build/api-url.ts` | Same production API URL validation |
| `vite.config.ts` | Enforce the build guard without renaming variables |
| `src/lib/auth.ts` | Store password-change replacement tokens while retaining storage preference |
| `tests/productionConfig.test.ts` | URL guard tests |
| `tests/passwordTokens.test.ts` | Session-only token replacement behavior |
| `DEPLOYMENT.md` | Correct separate Vercel project configuration and rollout limitations |

## Remaining approval and provider work

Render access is not connected in this session. Phase A Vercel requests for the discovered team were forbidden; that access remains unresolved.
Actual service/database IDs, existing billing plans, regions, backup policy, production branches, deploy triggers, origins and deployed SHAs require provider inspection.
No provider settings were changed in Phase B.

The old development release tool must not be reused without the separate reconciliation described in the deployment runbook.
Existing-data import would also require an approved review of legacy plaintext-password fields and historical media; neither was queried here.
Paid resource sizing, commercial Vercel plan eligibility, actual HTTPS/proxy behavior, migration approval, first-admin creation,
real business setup, media transfer and actual redeployment persistence remain future approved operations.

Read `production-deployment.md` for the proposed sequence, costs to confirm and rollback approach. Stop after Phase B and obtain approval before Phase C.
