# Multiwarehouse Order Fulfillment and Returns

Shared PostgreSQL schema, backend foundation, authentication contract, and reproducible synthetic data generator for a four-person course project.

## Requirements

- PostgreSQL 13 or later.
- Node.js 20 or later and npm.
- Python 3.10 or later.
- A local database named `multiwarehouse` (or another URL configured in `backend/.env`).

## Backend setup

```powershell
cd backend
Copy-Item .env.example .env
# Set DATABASE_URL and replace JWT_SECRET in .env.
npm install
npm run db:migrate
# For local development only. Skip this before a scale-data load.
npm run db:seed
npm run dev
```

The local seed creates three local role accounts. All use password `LocalDemo!2026`:

- `manager@local.test`
- `employee@local.test`
- `customer@local.test`

If you plan to load the full synthetic dataset, skip `db:seed` until after the generator finishes.

These credentials are for local development only. The seed creates reference data and balances, not customer-order or warehouse/manager workflow examples.

Useful backend commands from `backend/`:

```powershell
npm run db:status
npm run typecheck
npm test
```

## Synthetic scale data

Create and activate a Python virtual environment in `data-generation/`, install the package dependencies, and run:

```powershell
cd data-generation
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e .
python generate.py --database-url "postgresql://postgres:postgres@localhost:5432/multiwarehouse" --seed 20261022
```

The generator refuses to load into non-empty application tables. For repeatability, use a fresh database, apply migrations, then run the generator. Do not run `db:seed` before the scale generator. Generator arguments and its expected tables are documented in `data-generation/README.md`.

## Shared contract

Read [the integration contract](docs/INTEGRATION_CONTRACT.md) before adding a module route. The migration files under `backend/migrations/` are the single source of truth for shared schema changes. Midterm-only presentation material stays in `docs/midterm/`.
