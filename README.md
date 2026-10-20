# GasBook

GasBook is a full-stack digital notebook for small gas delivery and cylinder distribution businesses. It tracks Shop and Kandam stock, filled and empty cylinders, sales, payments, expenses, movement history, customer ledgers, staff credentials, and date-range reports.

## Stack

- **Frontend:** React 19, React Router 7, Axios, Tailwind CSS, Vite, TypeScript
- **Backend:** Django 5, Django REST Framework, SimpleJWT
- **Database:** PostgreSQL (production), SQLite (local fallback)
- **Cache:** Redis (optional — enabled when `REDIS_URL` is set)
- **Package Manager:** npm

## Folder Structure

```text
gasbook/
  backend/
    gasbook/          Django project settings and URLs
    core/             Models, serializers, API views, migrations, seed command
    requirements.txt
    Procfile
    Dockerfile
  frontend/
    src/
      components/     RatesPanel (floating gas rates widget)
      lib/            Axios API client (api.ts)
      pages/          Login, Stock, Sales, Customers, ChangePassword
        admin/        Dashboard, Staff, Reports, AdminBookings
        staff/        Staff-facing pages
        customer/     Customer-facing pages
    nginx.conf
    tailwind.config.js
    vite.config.ts
  docker-compose.yml      Production-style stack (frontend on 8080)
  docker-compose.dev.yml  Dev stack with hot reload (frontend on 5173)
  render.yaml
```

## Local Setup

### Backend

```bash
cd backend
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py seed_demo
python manage.py runserver 8001
```

Seed login:

```text
username: admin
password: admin123
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Set `frontend/.env` if your API URL is different:

```text
VITE_API_BASE_URL=http://127.0.0.1:8001/api
```

## Features

### Roles
- **Admin** — full access: dashboard, stock, sales, customers, staff, reports, gas rates
- **Staff** — dashboard, stock, sales, customers (no reports)
- **Customer** — basic account view only

### Dashboard
- Live stock: filled, empty, with customers per cylinder type
- Shop and Kandam breakdown (Filled/Empty)
- Today's sales and collections
- Pending payments alert
- Low stock warnings (filled cylinders only, when quantity > 0 and below threshold)
- Auto-refreshes every 30 seconds across all devices

### Stock & Load
- New Load — receive filled cylinders from supplier, recorded in movement history
- Movement — transfer cylinders between Shop and Kandam
- History — searchable movement log with staff name and timestamp

### Sales
- Multi-cylinder invoice entry
- Customer autocomplete — auto-fills phone and address from existing records
- Empty cylinder tracking per sale item
- Payment modes: Cash, GPay, Bank, Credit
- Credit sales track balance due per customer
- Sales history with staff name, pending filter

### Customers (Cashbook)
- Search by name or phone
- Pending balance badge and empties owed badge on list
- Full transaction timeline (sales + payments interleaved)
- Per-sale cylinder breakdown with empties owed/returned
- Edit customer details inline
- 🔑 Credentials panel — admin can view username, see/copy password, reset password

### Staff Management (Admin only)
- List all users (admin, staff, customer) with role badges
- Show/hide password per user
- Copy username + password to clipboard (for sharing via WhatsApp)
- Add new users directly from this page

### Reports (Admin only)
- Date range picker with Today / Yesterday / This Month shortcuts
- **Summary** — sales, collection, expenses, movements, pending dues alert, cylinder-wise sales, monthly net
- **Stock** — loads received, current stock snapshot, sold in range
- **Sales** — expandable list with items, staff name, payment status
- **Pending** — all customers with outstanding balance
- **Expenses** — category breakdown + individual entries
- **Movements** — all cylinder transfers in range
- **📋 Full** — plain text report, copy to WhatsApp/SMS in one tap

### Gas Rates Panel
- Floating ₹ button visible to admin on all pages
- Shows today's new-cylinder deposit and refill rate per cylinder size
- Inline edit — changes apply to all new sales immediately

### Cylinder Types & Locations (Admin only)
- **Products & Inventory → Cylinder Types**: add or edit a size with its picture, **refill price** and **new-cylinder deposit**. There is no separate selling price. A **refill** costs the refill price only; a **new connection** costs the refill price **plus** the deposit, each once per cylinder (a discount applies to the refill part only and never reduces the deposit). Prices apply to new transactions only; past bookings, sales and receipts keep the components they were charged. The deposit stays inside the billed total, as before; the Reports summary shows how much of gross sales is deposits. The old `selling_price` column is kept for older records but is read-only and unused for pricing.
- **Products & Inventory → Locations**: add shops, godowns or a supplier without code changes. A new active location appears in stock, sales, delivery and report lists immediately. A location's type (stock location or supplier) and its generated code are fixed once created.
- **Active / inactive**: inactive types and locations are refused by the API for new bookings, sales, deliveries and stock movements (not just hidden in the UI), but stay in history, receipts and reports. A location that still holds cylinders cannot be deactivated until they are moved; nothing is moved automatically. Existing stock of an inactive type can still be moved between stock locations, and cylinders can always be moved out of an inactive location.
- A delivery takes stock from the staff member's configured location, else the shop; if neither is available and several stock locations are active, the app asks which one.
- Cylinder pictures are stored with the other uploads (`MEDIA_ROOT/cylinder-images/`).

### Security
- JWT authentication with 12-hour access token, 30-day refresh token
- Role-based route protection — staff/customer cannot access admin pages
- Plain password stored for admin visibility (admin use only)

## Cylinder Tracking Logic

```
Filled Stock   = Loaded from supplier - Sold
Empty Stock    = Returned at sale time (empty_returned field)
With Customers = Total sold - Returned at sale - Collected via payments
Total          = Filled + Empty + With Customers
```

## Core API Endpoints

```text
POST /api/auth/token/
POST /api/auth/token/refresh/
GET  /api/auth/me/
POST /api/auth/register/
GET  /api/auth/users/
GET  /api/dashboard/
GET  /api/reports/?start=YYYY-MM-DD&end=YYYY-MM-DD

/api/cylinder-types/
/api/locations/
/api/stock/
/api/movements/
/api/customers/
/api/customers/{id}/ledger/
/api/customers/{id}/credentials/
/api/sales/
/api/payments/
/api/expenses/
/api/activity/
```

## Deployment — ₹0 personal demo

Follow [the deployment runbook](docs/production-deployment.md) and its approval gates.
Use fake customers, bookings and payment records only; no real orders, payments or customer data.
Keep billing disabled and use provider-generated domains.

- **Backend:** Render Free, native Python, using `render.demo.yaml`.
- **Database:** the separately verified, dedicated Neon Free demo project.
- **Frontends:** separate Vercel Hobby projects for admin and customer, for personal non-commercial demonstration.
- **Images:** bundled frontend artwork/placeholders with `DEMO_DISABLE_UPLOADS=True`; no persistent disk or media service.

`render.demo.yaml` is a review template, not permission to create or deploy a service.
Keep `render.yaml` as the earlier commercial proposal; do not apply it to this ₹0 demo.

### Backend configuration

Keep `GASBOOK_ENV=production`, `DEBUG=False`, `DEMO_DISABLE_UPLOADS=True` and `ACCESSORIES_ENABLED=False`.
Privately configure `SECRET_KEY`, `DATABASE_URL`, `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS` and
`CSRF_TRUSTED_ORIGINS` using the verified backend and both frontend origins. Never commit their secret values.
Supply the approved Neon connection with TLS through Render's environment; Django does not load root `.env.local`.
The template pins Python, serves static files with WhiteNoise and runs Gunicorn. Build/start commands must not
run migrations, bootstrap or seed commands.

### Frontend configuration

| Project | Repository / root | Install | Build | Output |
| --- | --- | --- | --- | --- |
| Admin | `gasbook` / `frontend` | `npm ci` | `npm run build` | `dist` |
| Customer | `gasbook-customer` / `.` | `bun install --frozen-lockfile` | `bun run build` | `dist` |

Use Node 24.x. Each build requires `VITE_API_BASE_URL` set to the actual Render HTTPS API URL ending in `/api`.
Do not deploy a localhost or build-test placeholder URL. Preserve the admin Vercel SPA fallback for `/login`
and `/admin-dashboard`; customer navigation uses application state/hash. Never put database credentials in `VITE_*`.

### Separate approval steps

1. Review the exact files and obtain explicit commit/push approval. Recheck Git deployment triggers before any push.
   Resource creation, linking and each deployment require separate approval; linking can trigger an initial deployment.
2. Verify the dedicated demo database identity, backup/restore status and complete migration plan before requesting
   **migration approval**. Preserve migration 0015's legacy-order guard. Apply migrations only in the approved release
   environment; `/ready/` remains 503 until the required migrations are applied.
3. After migration verification, request **separate admin-bootstrap approval**. Use the interactive `bootstrap_admin`
   command with a unique password and the business admin role. Keep `seed_demo` blocked in the hosted demo.
   Enter only approved synthetic business data.
4. Deploy the backend only after approval and verify its actual status, HTTPS, `/health/` and `/ready/`.
   Then separately approve both frontend deployments using its verified URL and run the fake-data smoke tests.

### Local Docker development

Use `docker-compose.dev.yml` only with an explicitly verified local development database.
Compose loads the gitignored `backend/.env`; its explicit development settings and internal database/cache addresses
take precedence. Create the file only if it is missing; keep existing configuration:

```bash
cp -n backend/.env.example backend/.env
# then edit it: use the Docker hostnames
#   DATABASE_URL=postgres://gasbook:gasbook123@db:5432/gasbook
#   REDIS_URL=redis://redis:6379/0
docker compose -f docker-compose.dev.yml up --build
```

Frontend: http://localhost:8080 — Backend API: http://localhost:8001/api

All published development ports bind to `127.0.0.1`: PostgreSQL 5434, Redis 6379, backend 8001 and frontend 8080.
Container-to-container traffic still uses the Compose service names. Existing named volumes retain local data;
do not remove volumes or treat this stack as a disposable test environment.

The startup command above starts local services only; it does not run migrations, seed data or bootstrap an admin.
Each database operation needs its own verified target and explicit approval. Never point this stack at Neon,
production or `gasbook_qa`, and never reuse its development credentials for the hosted demo.
