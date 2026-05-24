# GasBook

GasBook is a modern full-stack digital notebook for small gas delivery and cylinder distribution businesses. It tracks Shop and Kandam stock, filled and empty cylinders, sales, payments, expenses, movement history, and daily reports.

## Stack

- Frontend: React, React Router, Axios, Tailwind CSS, Vite
- Backend: Django, Django REST Framework, JWT auth
- Database: PostgreSQL for deployment, SQLite fallback for local development
- Deployment: Vercel frontend, Render backend

## Folder Structure

```text
gas/
  backend/
    gasbook/          Django project settings and URLs
    core/             Models, serializers, API views, seed command
    requirements.txt
    Procfile
  frontend/
    src/
      lib/            Axios API client and demo fallback data
      pages/          Login, Dashboard, Stock, Sales, Reports
    tailwind.config.js
  render.yaml
```

## Local Setup

Backend:

```bash
cd backend
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py seed_demo
python manage.py runserver
```

Seed login:

```text
username: admin
password: admin123
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Set `frontend/.env` if your API URL is different:

```text
VITE_API_BASE_URL=http://127.0.0.1:8000/api
```

## MVP Features Included

- JWT login/logout with Admin and Staff roles
- Dashboard analytics for total, filled, empty, Shop, Kandam, sales, collections, pending, and low stock
- Cylinder type, location, stock, movement, customer, sale, payment, expense, report, and activity APIs
- Stock movement transaction logic with automatic source deduction and destination addition
- Sale entry with automatic total, paid amount, balance due, and filled stock deduction
- Customer ledger endpoint with sales and payment history
- Daily/monthly report endpoint
- Responsive UI with large touch targets for mobile, tablet, and desktop

## Core API Endpoints

```text
POST /api/auth/token/
POST /api/auth/token/refresh/
GET  /api/auth/me/
GET  /api/dashboard/
GET  /api/reports/

/api/cylinder-types/
/api/locations/
/api/stock/
/api/movements/
/api/customers/
/api/customers/{id}/ledger/
/api/sales/
/api/payments/
/api/expenses/
/api/activity/
```

## Deployment Notes

- Render can use `render.yaml`; add a PostgreSQL database and set `DATABASE_URL`.
- Vercel should deploy `frontend/`; set `VITE_API_BASE_URL` to the Render API URL ending in `/api`.
- For production, change seed/demo credentials and set a strong `SECRET_KEY`.
