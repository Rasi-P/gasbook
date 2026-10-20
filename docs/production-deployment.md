# Production deployment runbook — preparation only

No deployment is authorized by this document. The reviewed changes are local and uncommitted.
Never use `gasbook_qa`, unrelated development databases, or default credentials. Synthetic data belongs only in the
separately verified demo target; commercial production excludes demo data.

## Current scope: ₹0 personal demo — 2026-10-20

The current authorized preparation is a **non-commercial, fake-data demo**. Real LPG orders, real payments,
real customer/business records, payment credentials, billing activation and paid resources are excluded.
The commercial runbook below remains a future proposal; its paid disk/database assumptions do not apply to the demo.
No commit, push, Render/Vercel deployment, migration or cloud resource creation was performed by the agent.
The separately authorized Neon setup below linked the user-created demo project, applied a no-change PostgreSQL
policy and tested only that database with read-only transactions.

### Account evidence and remaining access

- Both repositories are still on `main` at `d14e7e1d99a6d3127e3ca936e28bdd6bb9c215eb` and
  `aefc229586510d9ca4f9f88cbc5f5b688b599128`. The latest Neon setup started with 55+21 pending files.
  Existing application changes were preserved; nothing was staged.
- Isolated Render CLI 2.30.0: personal identity **Rasi P** verified. The authorized local workspace selection is complete:
  **My Workspace**, `tea-d732k3ggjchc73atvj9g`. Read-only inventory found Finder, Finder-1 and SeatBite, all Free
  web services in Virginia, with `main`/commit-triggered deployments. Finder is suspended; the other two are not
  suspended. None is GasBook; no Render PostgreSQL resources were listed. Their settings were not changed.
  The user's billing screenshot evidence confirms Hobby, no card on file, $0 unbilled charges and 0.75/750 Free
  instance-hours used (749.25 remaining at capture time). Bandwidth/build balances remain unverified.
- Isolated Vercel CLI 64.5.0: personal identity **rasikkaa** verified. The default/only accessible team is
  **rasikkaas-projects**, `team_bZk8q2dF1xFh9R3TBWv13mtx`, with OWNER membership, active **Hobby** plan and no trial.
  All team/project pages were inspected: five projects, none named GasBook or connected to either GasBook repository.
  Consequently there are no GasBook project IDs, domains, configured environment-variable names, deployed SHAs or
  Git deployment triggers to report in this team. Unrelated projects were not changed.
  `vercel usage --json` for the same team returned billing-cost data unavailable for 2026-10-01 through 2026-10-20;
  that response does not establish zero usage/cost or sufficient remaining quota.
- Neon: the user's dashboard/screenshot evidence confirms personal account access, **Free at $0/month**, 1 GB
  database storage and 100 compute hours/month. Existing project `red-hill-13026001` is in AWS N. Virginia, with
  0 CU-hours and 0.03 GB storage at capture time. Its application association is unresolved: no reference was found
  in searched non-secret GasBook files, which does not establish that the project is unused. Do not repurpose it.
  That older project remains untouched. Neon CLI 8.8.0 is now installed under
  `~/.local/share/gasbook-cli/neon/`, with isolated authentication under `~/.local/share/gasbook-cli/auth/neon/`.
  Direct CLI/API evidence verifies personal identity Rasi, organization `org-odd-dawn-79396664` with plan `free`,
  and the user-supplied project `long-rain-96731013` (`gasbook-demo`), AWS Singapore, PostgreSQL 17.
  Its `production` branch is `br-calm-silence-b36z6m8z`, ready and not protected.
  The verified target has six hours of history retention; no backup or snapshot was created or restore-tested.
  A read-only direct TLS connection found zero public base tables and 37 pending forward migrations.
  The account screenshot shows Object Storage priced at **$0.023/GB-month**. It is **excluded** from this strict
  ₹0 demo, regardless of differing public free-allowance documentation; do not enable it or create a bucket.
- Sanitized inventory and source-preservation evidence are in `/private/tmp/gasbook-demo-prep-bsxpzrdz/`.
  No authentication files or environment values were copied into that evidence.

The Render/Vercel evidence above remains from the earlier audit; Neon plan/project evidence was refreshed by API.
No fresh payment-method or invoice audit was performed. Before any separately
approved creation, recheck the same account/plan/no-card conditions and remaining shared quotas. No new provider account,
resource or storage credential is authorized by this review. Stop if a card, trial, paid plan or marketplace subscription
is required. Do not use an unclaimed/temporary database or reuse an unrelated existing database. Never paste a connection
string or private key into chat.

### Published plans and the zero-cost gate

Public terms were checked on 2026-10-20. Published free allowances are evidence about the products, not proof that
an uninspected account has those entitlements. No existing account invoice or total account bill is asserted.

| Component | Exact proposed plan and recurring demo cost | Limits and billing conditions |
| --- | --- | --- |
| Admin and customer static Vite apps | Two projects on the verified Vercel **Hobby** team; ₹0 | Personal non-commercial use only. No paid add-ons, trial, marketplace provisioning or upgrade. Quotas are shared with the other team projects. |
| Django/Gunicorn | Render **Free web service**, native Python; ₹0 if the workspace/account gate passes | 750 free instance-hours/workspace/month; sleeps after 15 idle minutes, with roughly a minute to restart; no durable local disk, shell or one-off jobs. |
| PostgreSQL | Dedicated `gasbook-demo` project on **Neon Free**; ₹0, plan confirmed by authenticated API | 100 CU-hours/project/month and 1 GB storage from account screenshot; remaining quotas need account review. Target is linked but has no application schema. Unrelated `red-hill-13026001` remains excluded. |
| Demo images | Existing frontend artwork/placeholders; ₹0 | `DEMO_DISABLE_UPLOADS=True` rejects uploads and disables uploaded-media serving/storage. No media service or database image blobs. |
| Domains | Provider-generated domains only; ₹0 | No domain purchase. Actual URLs have not been assigned or verified. |

Vercel publishes free Hobby hosting with quota pauses and restricts it to personal non-commercial projects. The user's
confirmed fake-data demonstration fits that description; this does not authorize later real business use.
No payment details are needed for the proposed Hobby hosting; never activate Pro or paid add-ons as a workaround.
See [Hobby](https://vercel.com/docs/plans/hobby) and [commercial-use rules](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage).

Render Free can charge bandwidth/build overages when a payment method is present. Without one, excess bandwidth
suspends free services and exhausted build allowance stops new builds. A build-minute spend limit alone does not establish
a total ₹0 cap. Require verified no-charge behavior before creation; account verification may still request a card, at
which point stop. Free instances may restart and Render advises against using them for production. External database/media
traffic may also trigger suspension. Render Free PostgreSQL expires after 30 days and lacks backups, so it is excluded.
[Free limits](https://render.com/docs/free), [card verification](https://render.com/terms).

Neon advertises Free without a card or trial deadline. Compute/egress exhaustion suspends compute; storage-cap exhaustion
rejects growth operations rather than upgrading the plan. Free restore history is limited to six hours/capped change
history, with one manual snapshot; it is not a long-term backup. An owned project is required: claimable projects have
a separate 72-hour expiry. No indefinite data-retention guarantee is inferred from a free-plan advertisement.
[Pricing](https://neon.com/pricing), [Free quotas](https://neon.com/docs/introduction/plans#what-happens-if-i-exceed-my-free-plan-limits),
[claimable project limits](https://neon.com/claimable-neon).

**Cost result:** the proposed service sum remains ₹0/month on these exact free plans, without add-ons, trials or upgrades.
Render/Neon screenshot evidence resolves the earlier plan questions; remaining shared quotas still need checking.
No ImageKit account or media entitlement is required for the selected upload-disabled demo. This is a conditional deployment budget, not certification of a live stack or every account
invoice. This review created no resources or charges. At a limit, accept downtime or halt the demo; never auto-upgrade.

### Authorized Neon CLI and agent setup — 2026-10-20

The user authorized CLI installation, linking the supplied project, PostgreSQL-only `neon deploy`, and connection
verification. `neon init -y --org-id org-odd-dawn-79396664 --project-id long-rain-96731013 --branch production
--services postgres --no-agent-setup --package-manager npm` ran from `gasbook/`, using the isolated CLI configuration.
Agent setup was installed separately at the shared workspace level to preserve global configuration and avoid duplicates:

- `../.agents/skills/neon/` and `../.agents/skills/neon-postgres/` contain the official skills and references.
  The installed overview exactly matched the requested official `/.well-known/agent-skills/neon/SKILL.md`.
- `../.codex/config.toml` adds only the Neon OAuth MCP URL, pinned to this project, with read-only project/branch/docs
  categories. Codex recognizes the entry. MCP OAuth/tool invocation is not verified; CLI login is verified.
  Global Codex configuration, including Vercel, is byte-identical. Skills become available on the next turn.
- New `neon.ts` declares no optional services or branch overrides. The generated default branch-expiration policy
  was removed before application. New root `package.json`/`package-lock.json` contain only Neon configuration tooling
  (`@neon/config` 1.9.2 and `@neon/env` 1.6.3). These do not replace Django's driver or frontend dependencies.
- `.neon` and `.env.local` are ignored. The new secret file has mode 0600; only variable names are reported:
  `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_BRANCH`. Existing backend/frontend `.env` files were not overwritten.
- `neon config plan` and the explicitly requested `neon deploy` both returned zero changes and zero conflicts,
  utilizing only PostgreSQL. This did not deploy the Django application or either frontend.

Django already reads `DATABASE_URL` through `dj_database_url` and uses psycopg 3.3.6. No application-driver rewrite
is needed. For the initial single-worker demo, privately supply the direct `DATABASE_URL_UNPOOLED` value as Django's
`DATABASE_URL`, including its TLS parameters. Do not pass database credentials to either frontend or add a `VITE_`
database variable. The local proof injected this value into a temporary process without changing settings or `.env`.
Root `.env.local` is not automatically loaded by Django. Provider environment injection remains the deployment path.

The temporary local Gunicorn test returned `/health/` 200 and `/ready/` 503 with `migrations_pending`.
The connection was forced read-only, so no migrations/bootstrap/records were written. Full login/catalog/checkout
testing remains blocked until the 37-migration plan and secure demo-admin bootstrap are separately approved.
Both frontend builds and local preview routes passed; their build-only API URL was an invalid placeholder.
See `phase-b-validation.md` and `/private/tmp/gasbook-neon-setup-ofl_voep/` for exact evidence and limitations.

### Selected simple demo image policy

Use the images already bundled with the customer frontend and the existing admin placeholders. No ImageKit, Neon
Object Storage, new media service, database image blobs or uploaded files are needed for the current fake-data demo.
This supersedes the earlier ImageKit investigation. Cylinder artwork is served with the Vercel frontend build and
therefore does not depend on Render's filesystem. Unknown cylinder types use the existing generic cylinder artwork.

Implemented locally:

- `DEMO_DISABLE_UPLOADS=True` selects `core.demo_media.DisabledMediaStorage`; production does not require `MEDIA_ROOT`
  in that mode. Storage rejects saves/reads and never deletes existing files. The default remains False; normal
  production still requires an absolute persistent `MEDIA_ROOT` and retains the existing safe image validation.
- Shared API/form validation rejects staff, product and cylinder image uploads before Pillow decoding. The message
  tells the tester to save without a photo. Photo inputs remain visible; choosing a photo produces this explicit error.
- Image responses use the existing null/placeholder contract, including staff profile responses. `/media/` returns 404
  before filesystem access. Existing model references/files are not erased merely by enabling the setting.
- Customer catalog fetching clears stale uploaded-image mappings when the API returns null and uses bundled artwork.
  No frontend application code or image assets changed. Staff use existing avatar placeholders.
- `render.demo.yaml` explicitly sets the flag; do not set an ephemeral `MEDIA_ROOT` or enable uploads on Render Free.
  Keep `GASBOOK_ENV=production`, HTTPS/security controls, migrations outside builds, and the existing readiness check.

Limits: this demo tests fake catalog, accounts, booking and checkout flows, but cannot demonstrate upload, photo
replacement or uploaded-media persistence. New artwork requires a reviewed frontend asset change/redeploy. Keep the
original assets locally. Real business data and real orders/payments remain excluded. Accessories stay disabled in the
initial template; no new accessory-image behavior is promised.

Validation: 33 database-forbidden backend tests and 23 mocked customer catalog tests passed in disposable copies.
`collectstatic`, Django system checks and WhiteNoise admin CSS (HTTP 200) passed. Python 3.12.15/Django 5.2.18/Pillow
13.0.0 were used. No database connection, migration, provider upload, hosted smoke test or deployment was performed.
See `phase-b-validation.md` for exact commands and scope. No dependency or migration change is required.

### Local configuration prepared

`render.demo.yaml` is a separate **review template**, preserving `render.yaml`. It pins `plan: free`, native Python,
one worker/four threads, no auto-deploy trigger, no disk/database/Redis, no startup/build migration and exact `/ready/`.
It sets `DEMO_DISABLE_UPLOADS=True` and omits `MEDIA_ROOT`; the explicit no-upload mode now permits secure startup.
Do not apply it until the dedicated database, candidate Git SHA, URLs/settings and deployment approvals are recorded. Applying a Blueprint may trigger an initial deployment
even when automatic Git deploys are disabled. [Blueprint semantics](https://render.com/docs/blueprint-spec).

Use `GASBOOK_ENV`'s existing production mode for public HTTPS; do not add a development-mode bypass for a demo.
Keep Django AdminSite disabled. The React `/login` and `/admin-dashboard` routes provide business-admin access.
Use the existing interactive `bootstrap_admin` command with a unique password and business admin role only after the
dedicated target and migration approval. Keep `seed_demo` blocked; manually enter approved synthetic records.

| Location | Environment-variable names / configuration |
| --- | --- |
| Render | `GASBOOK_ENV`, `DEBUG`, `SECRET_KEY`, `DATABASE_URL`, `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`, `PYTHON_VERSION`, `PORT`, `ACCESSORIES_ENABLED` |
| Each Vercel project | `VITE_API_BASE_URL`; optional `VITE_SUPPORT_CONTACT_NAME`, `VITE_SUPPORT_WHATSAPP_NUMBER` only if demonstrably non-real demo contact details |
| Demo images | `DEMO_DISABLE_UPLOADS=True`; no `MEDIA_ROOT` or media credentials. No ImageKit environment variables are required. |

Retain admin root `frontend`, `npm ci`, `npm run build`, output `dist`, and its existing Vercel SPA fallback.
Retain customer root `.`, `bun install --frozen-lockfile`, `bun run build`, output `dist`, and state/hash routing.
Both require their actual deployed HTTPS API origin plus `/api` at build time. Obtain exact provider hostnames before
setting allowed hosts and both CORS/CSRF origins; no guessed service URLs, wildcard origins or localhost deployment.
No GasBook Vercel projects were found; the Render URL remains unverified. Do not commit `.env` files or place secrets in `VITE_*`.

Start with a direct Neon TLS connection for this single-worker demo and release commands; keep the direct endpoint
private and require verified TLS options. The code uses transaction-scoped advisory locks; a future pooled connection
must be tested with Django cursor/session behavior and locking. Use direct connections for migration/export/import.
[Neon connection guidance](https://neon.com/docs/connect/connection-pooling).

`/health/` stays database-independent; `/ready/` queries PostgreSQL and verifies the migration ledger. Render probes must
not accept a redirect in place of readiness. Preserve the existing exact-path redirect exemption. Repeated readiness
queries can keep Neon compute active: at 0.25 CU, 100 CU-hours covers 400 active hours, less than a full always-on month.
Measure usage during the approved demo; accept suspension, avoid artificial keep-alive traffic and do not weaken readiness
to hide exhausted quotas. Cold-start retry behavior and the five-second DB connection timeout need actual provider testing.

### Demo rollout gates and fake-data smoke tests

1. Recheck remaining shared Render/Vercel/Neon quotas. Keep unrelated resources untouched and preserve the confirmed
   Free/no-charge conditions. No media account/setup is required; do not enable Neon Object Storage.
2. Dedicated target established: use only `long-rain-96731013` / `br-calm-silence-b36z6m8z`.
   Personal ownership, Free plan, region and PostgreSQL version are verified. Do not create a duplicate,
   branch from an unrelated database, or import production data.
3. Use the tested upload-disabled demo setting. Clearly identify the demo to testers and ensure support links and
   synthetic data cannot be mistaken for a real LPG service before sharing. Do not select photos in admin forms.
4. Review exact candidate files and obtain commit/push approval. Inspect any newly linked Git deployment triggers first.
   Obtain separate approval for two Vercel projects and the Render service; importing/linking can start deployments.
5. Prepare an isolated release environment using the approved code. Verify only the newly authorized demo target, its
   migration ledger, backup/snapshot status and full forward plan. Obtain **separate migration approval**.
   Migration 0015 must stop on legacy commerce orders; never bypass it. Migration 0017 remains unchanged.
6. Run the approved migrations from that release environment before expecting `/ready/` to pass; Render Free has no
   shell/one-off jobs. Bootstrap interactively after separate approval. Use fake catalog, locations, stock, staff and
   customers only; no default credentials, payment integration or real data imports.
7. After explicit backend deployment approval, verify actual provider status/SHA, HTTPS, `/health/`, `/ready/` and static
   files. Then approve each frontend deployment using the real API URL and exact CORS/CSRF origins.
8. With synthetic accounts, test React-admin login/direct navigation, customer login/refresh/password change, catalog
   pagination/error/retry on both layouts, bundled artwork/placeholders and upload rejection, cylinder-only checkout,
   same-key replay, changed-payload rejection and lost-response recovery without duplicate orders.
   With `ACCESSORIES_ENABLED=False`, verify new accessory purchases and new mixed checkout requests are rejected
   without creating a booking or reserving stock. Successful new mixed checkout requires a separately approved
   configuration change to enable accessories and approved synthetic catalog/stock setup; it is not an initial demo
   acceptance requirement.
   Check fake delivery/payment records and PDF receipts
   without contacting a payment service. Repeat after cold start. Never run load tests against shared free infrastructure.
9. Record verified URLs, SHAs, quotas and recovery instructions. Do not publish the demo as a real ordering service.

Before the first deploy, record a safe rollback artifact containing the Pillow, atomic-checkout and token-revocation fixes.
If none exists, halt an unsuccessful launch instead of deploying baseline main. Roll back compatible application artifacts
and origins without reversing migrations, restoring over newer records, deleting data or discarding media.

### Future commercial migration — planning only

No reliable, fully verified commercial stack meeting availability, backup and durable-media requirements has been
established at ₹0. The demo's free limits and non-commercial Vercel eligibility must not be carried into real business use.

| Component | Recommended commercial path | Alternatives / costs |
| --- | --- | --- |
| Frontends | Keep both on Vercel **Pro**, with approval immediately before any commercial use | Published platform fee is $20/month with one deploying seat and usage credit; extra usage/add-ons can cost more. |
| Django | Paid Render native Python web compute, sized from measured memory/latency and recovery needs | Use the current `0.5c-512mb` or larger compute ID after reviewing capacity and a current quote; enable monitoring, bounded concurrency and an approved availability target. |
| PostgreSQL | Separate Neon **Launch** production project; controlled backups/restore testing | Compute $0.106/CU-hour, DB storage $0.35/GB-month and retained history $0.20/GB-month. Alternatively evaluate paid Render Postgres and its backup/retention offering. |
| Media | Dedicated production object store with narrowly scoped server credentials and independent backup | Neon paid object storage is $0.023/GB-month plus shared egress usage; its limited versioning/lifecycle semantics require explicit backup design. S3-compatible alternatives require a separate pricing/security review. |
| Domain/operations | Owned domain, TLS, error/uptime monitoring, encrypted off-provider backups and restore drills | Domain renewal, retention, traffic, taxes and FX are additional costs, not covered by the demo's ₹0 budget. |

Sources: [Vercel commercial eligibility](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage),
[Pro pricing](https://vercel.com/docs/plans/pro-plan#pro-plan-pricing), [Render plans](https://render.com/pricing),
[Render compute IDs](https://render.com/docs/blueprint-spec#plan), [Neon pricing](https://neon.com/pricing).
Render's public article gives a July 2026 web/database example of roughly $13/month before storage/traffic; the current
pricing page did not expose a complete compute-price table to this review, so that historical example is not a current quote.
The older $34.75 allowance below is also an illustrative commercial budget, never a demo entitlement.

Cloudflare Pages was investigated as a **future optional frontend migration**, not selected for this demo. Pure static
asset requests are free, with 500 builds/month and 25 MiB per-file/20,000-file Free limits. The terms permit entity
customers, but also restrict collection/processing of credit-card information on Free Services. This review does not
establish an unconditional approval for every commercial payment flow. Confirm the actual application's eligibility
before selecting it; Vercel Pro provides the explicit commercial path above. Pages cannot replace the Django/Gunicorn
server or PostgreSQL. A future move must reproduce SPA routing, build-time API origins, CORS, assets and rollback tests.
[Pages limits](https://developers.cloudflare.com/pages/platform/limits/),
[static pricing](https://developers.cloudflare.com/pages/functions/pricing/),
[Cloudflare agreement](https://www.cloudflare.com/terms/),
[developer terms](https://www.cloudflare.com/service-specific-terms-developer-platform/).

Commercial cutover sequence:

1. Approve provider contracts, costs, capacity, data residency, backup RPO/RTO, access roles and monitoring. Provision
   separately from the demo. Real business data starts in a clean production database; do not promote fake customers,
   bookings, stock balances or credentials. Copy only reviewed real catalog/business configuration, if authorized.
2. Generate separate production secrets/roles and configure exact domains/origins. Retain password-hash/token safeguards;
   a signing-key change requires fresh login. Do not reuse demo users or storage credentials.
3. Rehearse export/import in a disposable restore environment using compatible PostgreSQL tools and direct TLS endpoints.
   For any later authorized real-data migration, take encrypted `pg_dump --format=custom` exports, verify checksums,
   restore into a new empty target, verify migrations/row counts/relationships/financial totals/sequences and restore
   timing. Do not run a destructive restore against a live target. Review 0015 before migration.
4. Inventory/export media with object keys, sizes, content hashes and database references; validate access policies and
   headers at the new origin. Keep the old objects intact through the rollback window. Database PITR is not proof of
   synchronized media restoration; verify both independently.
5. Build both frontends against the new API, smoke-test login/catalog/images/idempotent checkout/fulfillment/receipts,
   then approve cutover. Obtain the domain separately, reduce DNS TTL in advance, verify TLS, add explicit origins and
   switch DNS only after all checks pass. Migrate any future real payment integration separately in its sandbox first.
6. For a later live-data cutover, freeze writes, take a final export, verify it and switch with one authoritative writer.
   Keep old services read-only during the rollback window. After new writes occur, rollback requires reconciliation;
   blindly restoring the old snapshot loses orders/payments. Prefer a compatible application rollback or forward repair.
7. Monitor failures, cold-start/latency, checkout conflicts, DB saturation, storage growth and backup freshness. Test
   restores regularly. Revisit shared throttling before adding workers; protect API origin as well as frontends.
   Retire demo/public test credentials only through a separately approved operation.

## Runtime and builds

Backend: Python 3.12.15, Django 5.2.18, Gunicorn 26.2.0. `requirements.txt` pins the tested dependency set.
Render native Python root: `backend`. Build: `python -m pip install --upgrade pip==26.2.0 && python -m pip install -r requirements.txt && python manage.py collectstatic --noinput`.
The installer pin addresses vulnerabilities in the Python image's bundled pip; runtime requirements retain Pillow 13.0.0.
Start: `gunicorn gasbook.wsgi:application --bind 0.0.0.0:$PORT --workers 1 --threads 4 --access-logfile - --error-logfile -`.
There are no build/start migrations or automatic production seeds. Auto-deploy is disabled in the proposed Blueprint.
Existing provider settings can override repository files; inspect them before approving any push.
The proposal uses Render's native Python runtime. The preserved Dockerfile starts three workers; it is not the tested single-worker
Render command and would have separate process-local throttle counters. If the dashboard uses Docker, resolve that runtime/start-command
choice explicitly before deployment instead of assuming the Blueprint command applies.

| Vercel setting | Admin/staff | Customer |
| --- | --- | --- |
| Repository | Rasi-P/gasbook | Rasi-P/gasbook-customer |
| Production branch candidate | main | main |
| Root | frontend | repository root |
| Runtime | Node 24.x | Node 24.x; Bun 1.3.14 tested |
| Install | npm ci | bun install --frozen-lockfile |
| Build | npm run build | bun run build |
| Output | dist | dist |
| Routing | vercel.json SPA fallback; /login and /admin-dashboard | existing state/hash navigation |

Both builds require `VITE_API_BASE_URL`, an absolute HTTPS backend origin followed by `/api`.
The validator rejects missing, relative, HTTP, localhost/private IPv4, credential-bearing, query-bearing, or fragment-bearing URLs.
Use the actual Render URL when building deployment artifacts. The `.invalid` URL used in isolated tests is not deployable configuration.
Production builds are checked even with a custom Vite mode. Development Vite servers retain existing local behavior.
Keep frontend support-contact variable names unchanged. All VITE variables become public bundle contents; never put secrets in them.

## Environment checklist

| Variable | Purpose / approval requirement |
| --- | --- |
| GASBOOK_ENV | production; omitted selects production and fails closed if required settings are missing |
| DEBUG | false in production; invalid booleans and production true are rejected |
| SECRET_KEY | privately generated strong value of at least 50 characters; no development fallback in production |
| DATABASE_URL | approved Render PostgreSQL connection; set privately; SQLite and QA are refused |
| ALLOWED_HOSTS | exact approved API hostname(s), without scheme, wildcard, or port |
| CORS_ALLOWED_ORIGINS | both exact HTTPS Vercel production origins, without paths or trailing slashes |
| CSRF_TRUSTED_ORIGINS | exact HTTPS API/admin/customer origins; review previews separately, no Vercel wildcard |
| MEDIA_ROOT | absolute disk mount path, proposed /var/data/media |
| PYTHON_VERSION | 3.12.15 for Render |
| PORT | supplied by Render |
| ACCESSORIES_ENABLED | enable only after reviewing the full migration chain and intended accessory workflows |
| RECEIPT_BUSINESS_ADDRESS, RECEIPT_BUSINESS_PHONE, RECEIPT_BUSINESS_EMAIL, RECEIPT_BUSINESS_TAX_ID | optional real business details |
| VITE_API_BASE_URL | required on both Vercel projects at build time; actual HTTPS API URL ending /api |
| VITE_SUPPORT_CONTACT_NAME, VITE_SUPPORT_WHATSAPP_NUMBER | optional public contact information on both frontends |

Leave `REDIS_URL` unset for this architecture. `STATIC_ROOT` is optional for isolated builds; the normal collected directory is `backend/staticfiles`.
Supply `SECRET_KEY` privately: Render's base64-encoded 256-bit generated value is 44 characters, below this application's 50-character minimum.
The Blueprint therefore uses `sync: false`. For an existing Blueprint, add/update required settings in the dashboard explicitly;
Render only prompts for `sync: false` values at initial creation.
Local development now explicitly sets `GASBOOK_ENV=development`; update your ignored local environment or Compose configuration yourself before running local services.
Changing `.env.example` does not modify the existing local `.env`.

## HTTPS, authentication and health

Production trusts `X-Forwarded-Proto` from the hosting proxy, redirects HTTP, and sets secure session/CSRF cookies.
Verify Render overwrites the HTTPS proxy header. DRF `NUM_PROXIES=0` now uses the socket peer for IP throttling;
unverified caller-supplied `X-Forwarded-For` values are ignored. Behind Render, multiple users may therefore share a proxy bucket.
Verify the actual trusted proxy chain before proposing a different IP policy; do not enable header trust based on a guessed hop count.
HSTS starts at one hour. Subdomain inclusion and preload are deliberately disabled until domain ownership/TLS coverage is reviewed;
`check --deploy` therefore reports W005 and W021. No checks are silenced.

Login has account and IP throttles (10/minute and 60/minute). These use the in-process cache shared by the initial single Gunicorn worker's threads.
They are best-effort abuse reduction, have concurrency limits, and reset on restart. Do not add workers/instances expecting a shared limit.
Provider edge rate limiting or a shared cache is a later option. Django admin login does not use these API throttles,
so its entire `/admin/` route is absent in production. There is no production enable switch. Business admins/staff retain the
React management interface and business roles; local development/test AdminSite access and CSRF protection are preserved.
Reopening production AdminSite requires a separate protected-access design; an origin reachable around an access proxy is not protected.

Access and refresh tokens are bound to the current password hash. Changing/resetting a password invalidates older tokens.
The password-change response gives the current client replacement tokens; both clients store them before continuing.
Previously issued tokens lacking the new claim require a fresh login at rollout. Logout still clears client storage;
it does not implement a server-side per-session blacklist. The existing 12-hour access/30-day refresh policy is unchanged.

`GET /health/`: process liveness, 200, no database access.
`GET /ready/`: 200 only when the database responds and all installed migrations are recorded; otherwise 503 with a generic
`database_unavailable` or `migrations_pending` reason. No exception details or credentials are returned. Connection establishment times out after five seconds.
The proposed Render health check uses `/ready/`. A first empty database cannot pass it until the explicitly approved migration step finishes.
Do not work around this with automatic build/start migration or fake migration records.

Only the exact `/health/` and `/ready/` paths are exempt from Django's HTTPS redirect. They execute their views for an HTTP probe,
including when the proxy sends no forwarded-protocol header or explicitly sends `http`. Normal API/admin/media routes still redirect to HTTPS.
This is required because [Render accepts HTTP 3xx responses as healthy](https://render.com/docs/health-checks).
The dashboard must use the exact trailing-slash `/ready/` path and an allowed service hostname; `/ready` is not an equivalent probe.
Confirm the actual provider request reaches the view and returns 503 before migrations or during a database outage, then 200 after migrations.
Local Gunicorn checks do not verify the provider's dashboard, proxy, hostname, or network behavior.
Readiness checks the migration ledger and connectivity; it is not a full schema-integrity or business-data check.

## Persistent media

The existing filesystem storage works with a single Render disk mounted at `/var/data/media`.
Attach and verify the approved disk before accepting uploads; setting `MEDIA_ROOT` alone does not create or prove a persistent disk.
The Blueprint intentionally does not create a database, choose a paid plan, or create a disk before resource identities/costs are approved.

Runtime routes serve only PNG/JPEG/WebP files in `product-images`, `staff-images`, and `cylinder-images`, with decoded content validation,
5 MB/4096-pixel limits, path containment, no directory listing, and restrictive content headers. Files are public by URL;
staff photos must be intended for public delivery. This is not a private-document store. Older unsafe/oversized media returns 404.
This simple handler validates each request and buffers at most 5 MB; monitor CPU/memory as image traffic grows.
File replacement/deletion occurs after the database transaction commits. A failed upload transaction can leave an unreferenced new file;
review cleanup separately instead of deleting files automatically during deployment.

Only the disk mount persists. Existing repository/local uploads are not automatically copied into a new disk.
After approval, transfer approved media preserving relative paths, compare checksums and image URLs, and retain an independent backup.
Two images were already tracked before Phase B; ignore rules now prevent future untracked staff/cylinder uploads from entering Git,
but do not remove those historical tracked files.

Render disks require paid services, allow one service instance, and introduce downtime during redeployment.
They are unavailable in build/pre-deploy/one-off job filesystems. Copy files through the running service's approved access path.
Maintain database and media backups together. Test an actual provider redeployment before claiming persistence.

## Migrations and old release tooling

Do not run or modify `gasbook-migration-release` for this deployment. Its checksums, image/commit pins, accepted development baseline,
and expected schema plan are for core 0010–0012. They cannot certify current main through 0017 or a new production database.
Its historical QA references do not authorize accessing QA. No historical baselines should be overwritten.

Before any future use, document a separate production target, approved commits/artifacts, backup and restore evidence, applied migration ledger,
complete forward plan, expected schema/data deltas through 0017, and a new acceptance record. Prefer a separate production runbook over weakening old guards.
Never reverse/fake 0017 to match old tooling. Its local/development application status remains unknown.

The graph contains 19 core migrations and the Django admin/auth/contenttypes/sessions migrations.
0006 updates notification text; 0009 clears stale booking rejection fields. 0015 retains retired commerce tables and blocks if old commerce orders exist.
0012 refuses reversal when financial reversal records exist. These require data-aware review on any nonempty target.
No migration files changed in Phase B; no new schema migration is required by these fixes.

For the approved target only: first verify provider database/service identity, current database and user, backup/restore availability,
and the complete `showmigrations` / `migrate --plan` output, without logging connection strings. Then request explicit migration approval.
Only after that approval run `python manage.py migrate --noinput` once and confirm `migrate --plan --check` has no pending operations.
Use a separately authorized release shell/job or trusted release machine. Initial readiness will stay 503 until this is complete.

Arrange that release runner before starting the first deployment: an unmigrated database cannot make the new service healthy,
and a shell on an unpromoted service must not be assumed available. Use the exact approved candidate and private credentials in the
separately approved runner; migrate the verified target before attempting to promote the API. No disk access is needed by these migrations.
If 0015 finds retained commerce orders, stop for a separate data-preserving reconciliation plan. Do not delete records or bypass its guard.

## Disposable test cleanup

The ordinary test runner now includes the three physical commerce tables retained by 0015 in PostgreSQL test teardown's existing flush
statement. This corrects the baseline foreign-key TRUNCATE failure without CASCADE, table drops, migration edits or changes to the normal
`flush` command. Only synthetic data in the test database is cleared by test teardown.
The runner requires `GASBOOK_ENV=test`, a separate PostgreSQL test name beginning `test_`, a fresh serial run, and no `--keepdb`.
It restores the original connection method after the suite, including on failure. Provision a new disposable PostgreSQL server first;
the name checks alone do not prove a server is disposable. Never point the tests at a development/QA/production server.
The older guarded inventory settings remain unchanged. Their CASCADE workaround is no longer needed by the ordinary suite.
All three opt-in live browser suites also require Chromium, Node 24, installed frontend dependencies, four isolated frontend test ports,
and the two repositories as siblings. The validation report records the isolated harness and coverage limits.

## First administrator and real business setup

After the database/migration approvals, use a trusted interactive terminal with password input hidden:

```text
python manage.py bootstrap_admin --database-name <verified-name> --username <chosen-owner> --email <owner-email>
```

The command compares configured and connected database identities, validates the password, refuses an existing administrator,
and creates the admin/staff/customer business roles and first superuser with the business admin role. It prints no credentials.
It has no password argument/environment default and seeds no cylinders, locations, prices, stock, customers or demo accounts.
Create those records from approved business information through the application. Do not use `seed_demo`; it is blocked outside explicit debug development mode.
Keep shell history and provider logs free of secrets, including connection strings. The interactive password is never part of the command line.

## Proposed sequence after later approvals

1. Complete the read-only provider audit: accounts, resource IDs, Git links/branches, deploy triggers, URLs, plan/region and backup coverage.
2. Obtain approval for the exact commits, settings, resources/costs and release procedure. Push/deploy only those approved changes.
3. Provision/select the approved PostgreSQL and paid disk-backed API service; configure secrets privately and keep frontends off the new API.
4. Prepare the backend artifact and separate release runner; verify the database identity, backup/restore evidence and complete migration plan, then obtain separate migration approval.
5. Apply only that approved plan, deploy the API, confirm liveness/readiness, bootstrap the first admin, transfer approved media and enter real business data.
6. Build/deploy both Vercel projects with the actual API URL; set exact CORS/CSRF origins and verify browser preflights, login, refresh,
   password changes, dashboard direct navigation/refresh, catalog images, bookings, deliveries, payments, receipts and error states.
7. Verify actual provider status, SHAs and URLs. Redeploy once with a test image to prove disk persistence, then record the final smoke report.

No step above is authorized merely by this file. Phase C approval and a separate verified-target migration approval are still required.

## Costs and rollback

Budget for a paid Render web instance, PostgreSQL compute/storage/backup retention, persistent disk capacity and traffic overages.
Commercial Vercel use needs an eligible plan (Hobby is personal/non-commercial); both projects can share an eligible team plan.
Existing account plans and resource sizes are unknown, so a final quote belongs in the approval plan. No paid resources were created.

For planning only: assuming $7/month web compute, $6/month database compute, 5 GB database storage at $0.30/GB,
1 GB media disk at $0.25/GB, a $0 Render workspace fee and one $20/month Vercel Pro developer seat for both projects,
the allowance is $34.75/month before taxes, overages, backup exports or larger instances. This is not an account quote or a capacity guarantee.
Confirm current compute IDs/prices and backup retention in the dashboard; Render has renamed compute plans.
See [Render's cost model](https://render.com/articles/how-much-does-cloud-application-hosting-cost-for-small-businesses),
[current Render pricing](https://render.com/pricing) and [Vercel pricing](https://vercel.com/pricing).

## Approval checklist after focused remediation

- [ ] Review the exact combined patches and file hashes; approve the files, commit grouping and production branches for each repository.
  No new commit SHA exists yet. Check provider deploy triggers before any approved push, which could otherwise start a deployment.
- [ ] Inspect personal Render workspace/service access and the correct Vercel team/project scope; restore access if missing. Confirm actual Git links, root/build settings,
  production origins, probe path, proxy headers and auto-deploy settings. Repository configuration alone is not provider evidence.
- [ ] Approve region, paid service/database/disk sizes, eligible Vercel plan, recurring cost ceiling and permitted overages.
- [ ] Verify target database identity, migration ledger and full forward plan, especially 0015; approve the separate release runner.
  Verify backup retention, independent export and a restore rehearsal before separately approving any migration on the target.
- [ ] Approve `/var/data/media` attachment, media inventory/transfer and independent backup; verify permissions and an actual image-preserving redeploy.
  Accept the single-instance restriction and deployment downtime. Do not accept production uploads until the disk is verified.
- [ ] Approve interactive first-admin bootstrap with the business admin role and real initial business data. No default password or demo seed.
- [ ] Approve explicit backend then frontend deployment, actual API/origin configuration, smoke-test accounts/data and rollback window.
  Verify routes/login/password changes, catalog/images, mixed bookings, delivery/payment/receipts and failure handling on provider URLs.
- [ ] Record the compatible prior application artifacts, environment settings and coordinated database/media backups. If migration or
  smoke checks fail, halt promotion; preserve data and disk. Database restores, reverse/fake migrations and destructive cleanup need separate approval.

Local review and disposable tests do not authorize any item above. Process-local API throttling and shared proxy buckets,
public image URLs, bundle-size warnings and the remaining customer Fast Refresh lint warning remain documented limitations.

Before release record previous deployment SHAs/settings and take verified database/media backups.
Rollback normally redeploys a known compatible application/frontend artifact while keeping additive schema and the disk intact.
Do not reverse migrations or restore a database/media snapshot automatically: this may lose newer business records/files and requires separate approval.
Maintain the prior signing key privately for coordinated rollback; changing it invalidates sessions. Token revocation rollout requires users to sign in again.
The unchanged baseline main commit used for comparison is not an approved rollback artifact: it predates the Pillow patch and production
hardening. Keep Pillow 13.0.0 and the security fixes in any rollback candidate. If no compatible safe artifact exists, halt public traffic
while preparing a corrected release rather than automatically returning to the vulnerable baseline.

## Catalog and checkout release contract

Deploy the backend changes before either frontend. Cylinder and mixed carts now use the same signed preview and atomic
`POST /api/bookings/checkout/`, creating one Booking with all persisted BookingItem lines. The legacy scalar booking API is
unchanged for existing callers; it does not provide the new cart retry guarantee and must not be used as a fallback.

The existing unique nullable BookingItem.client_ref plus a PostgreSQL advisory lock, customer lock and request hash enforce
one successful checkout per key. Same customer/key/payload replays return the original booking before quote expiration or current
price validation. Changed payload/customer conflicts are rejected. All lines, notifications and accessory reservations commit or roll
back together. Cylinder deduction, empty returns, payments and receipts still occur through existing delivery workflows.
ACCESSORIES_ENABLED gates new accessory purchases; it does not hide saved lines or prevent replaying a successful booking.
No schema migration is added. Existing migration guards remain mandatory.

The customer stores only a UUID, SHA-256 payload fingerprint, status and confirmed booking ID in per-customer session storage.
Mobile and desktop share an in-flight promise. Unknown results retain the key and freeze cart edits; retries reuse it.
`GET /api/bookings/checkout-status/?client_ref=...` is authenticated, customer-scoped, read-only recovery. An absent result does not
prove an in-flight request cannot commit. A definite validation rejection, or an explicit recovery lookup with no visible result,
permits cart review/editing while retaining the same UUID. If an earlier request commits late, a changed-payload retry conflicts and
the customer can recover that original booking. An empty lookup never authorizes creating a fresh key or clearing the cart.
The client discards the intent only after saving the empty cart and confirmed result. Existing matching mixed-checkout keys are adopted.
No automatic transport retry is added. Blocked browser storage prevents new checkout; closing a tab or deliberately clearing its storage
can lose client recovery context. Review Orders before creating a new intent after such loss. Separate tabs/devices may create separate
intentional orders; identical business contents alone are not an idempotency identity.

Catalog fetches validate same-origin next links for the exact cylinder endpoint, advance one page at a time, and stop after at most
1,000 requests. Counts, duplicates, missing/empty intermediate pages and malformed metadata fail the whole load. Images are registered
only after complete success; inactive rows remain available for history and are filtered by the existing catalog hook. Desktop home's
four-item presentation limit stays intact. Backend ordering is weight/name/PK without a schema change. Concurrent catalog editing can
cause a safe load failure and require retry; offset pagination is not a transactional catalog snapshot.

Rollback must retain the atomic checkout endpoint, replay-before-expiry semantics and saved-line handling for cylinder-only carts.
An older backend that assumes every saved cart contains an accessory is not compatible. Prefer forward repair and retain schema/media.

## Frontend security and browser baseline

The confirmed Tailwind 3 dependency chain included unpatched braces and selector-parser advisories. The admin build now uses
Tailwind 4.3.3 and its official PostCSS plugin, retains the existing theme config and application CSS, and preserves the old border default.
The npm lock remains authoritative. Customer Bun uses a targeted source-map-js 1.2.2 override; its PDF packages and direct runtime
dependencies are unchanged. Do not replace bun.lock with an npm lockfile.
Tailwind 4 targets modern browsers (Safari 16.4+, Chrome 111+, Firefox 128+); Chromium workflows are covered locally. Confirm staff
device eligibility and physical-device appearance before public release. See the [official migration guide](https://tailwindcss.com/docs/upgrade-guide).
Detailed advisory versions and executed checks are in `phase-b-validation.md` under the latest remediation section.

References: [Render disks](https://render.com/docs/disks), [Render Python](https://render.com/docs/python-version),
[Render Blueprint](https://render.com/docs/blueprint-spec), [Vercel Vite](https://vercel.com/docs/frameworks/frontend/vite),
[Vercel Hobby terms](https://vercel.com/docs/plans/hobby), [Python 3.12.15](https://www.python.org/downloads/release/python-31215/),
[Django 5.2.18](https://docs.djangoproject.com/en/5.2/releases/5.2.18/), [Gunicorn](https://pypi.org/project/gunicorn/26.2.0/).
