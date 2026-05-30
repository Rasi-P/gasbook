# GasBook

GasBook is a full-stack digital notebook for small gas delivery and cylinder distribution businesses. It tracks Shop and Kandam stock, filled and empty cylinders, sales, payments, expenses, movement history, customer ledgers, staff credentials, and date-range reports.

## Stack

- **Frontend:** React 19, React Router 7, Axios, Tailwind CSS, Vite, TypeScript
- **Backend:** Django 5, Django REST Framework, SimpleJWT
- **Database:** PostgreSQL (production), SQLite (local fallback)
- **Package Manager:** npm

## Folder Structure

```text
gas/
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
      pages/          Login, Dashboard, Stock, Sales, Customers, Staff, Reports
    tailwind.config.js
    vite.config.ts
  docker-compose.yml
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
- Shows today's selling price and refill rate per cylinder size
- Inline edit — changes apply to all new sales immediately

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

## Deployment

### Render (Backend)
- Use `render.yaml` — add a PostgreSQL database and set `DATABASE_URL`
- Set `SECRET_KEY`, `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS` environment variables

### Vercel (Frontend)
- Deploy the `frontend/` folder
- Set `VITE_API_BASE_URL` to your Render backend URL ending in `/api`

### Docker
```bash
docker-compose up --build
```

> For production: change the seed admin password, set a strong `SECRET_KEY`, and disable `DEBUG`.
