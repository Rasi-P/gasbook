# GasBook Frontend

React 19 + TypeScript + Vite + Tailwind CSS admin/staff UI for GasBook. Full project docs live in [../README.md](../README.md).

## Run locally

```bash
npm install
cp .env.example .env   # points at the backend API
npm run dev            # http://localhost:5173
```

`VITE_API_BASE_URL` (see `.env.example`) must point at the Django backend, which runs on port 8001 locally.

## Scripts

- `npm run dev` — Vite dev server with HMR
- `npm run build` — type-check and production build to `dist/`
- `npm run lint` — ESLint
- `npm run preview` — serve the production build locally

## Docker

The [Dockerfile](Dockerfile) builds the app and serves it with nginx (see [nginx.conf](nginx.conf)); the root `docker-compose.yml` exposes it on http://localhost:8080.
