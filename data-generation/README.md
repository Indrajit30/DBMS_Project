# Synthetic Data Generator

`generate.py` creates a seeded, five-year operational history and bulk-loads the shared schema with PostgreSQL `COPY`. It uses synthetic electronics-accessory catalog rows because a public catalog source has not been selected. It creates customer activity with Zipf-skewed customer and product popularity, weekend and holiday-season weights, and a weighted daily-hour profile.

## Default scale

- 50,000 customers, 500 products, three warehouses, and 400,000 orders.
- Exactly 1,000,000 order-item rows by default: half the orders receive two distinct lines and half receive three.
- Approximately 1,000,000 allocations and shipment items, plus derived shipment events, cancellations, returns, inspections, transfers, alerts, movement ledger entries, audit rows, purchase orders, cycle counts, forecasts, and recall investigations.
- Initial balances are sized from product popularity expectations with a safety margin. The generator checks that every requested order quantity can be allocated before loading.
- Orders are generated chronologically from a fixed five-year window. The default `--as-of` is fixed at `2026-10-22T23:59:59+00:00` so the workload timestamps are repeatable.

Generated customer users have fresh random, unknown bcrypt credentials; the customer/order/product/stock/event records and counts are reproducible for the same seed and options. Local demo login accounts are created separately by the backend seed command. Synthetic data contains no real customer information.

## Setup and run

From this directory:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e .
python generate.py --database-url "postgresql://postgres:postgres@localhost:5432/multiwarehouse" --seed 20261022
```

You can also set `DATABASE_URL` and omit `--database-url`. Use `--customers`, `--products`, `--orders`, `--order-items`, `--transfers`, `--alerts`, and `--recalls` to change the generated volume. The order-item target must be between one and three times the order count. The shipped assignment target remains at least 1,000,000 rows. `--allow-small` exists only for local smoke tests and bypasses that threshold.

## Safety and loading behavior

1. Apply schema migrations first.
2. Use a fresh database with empty application tables. The script checks all application tables and exits if it finds data; it does not truncate, delete, or overwrite records.
3. It stages compressed CSV files in a temporary directory, then uses one database transaction for the load. A load failure rolls back the database changes.
4. Explicit identity values are supplied through COPY and identity sequences are advanced to the loaded maxima.
5. Balance rows are initially loaded from receipt stock, then reconciled from the complete movement ledger in the same transaction. Check `on_hand`, `reserved`, and `unavailable` bounds after loading.
6. Load report prints actual row counts, table bytes, index bytes, total relation bytes, staging time, and database load time for every application table.

Do not run the local seed before this generator. After a successful scale load, `npm run db:seed` may add local demo accounts and a few additional reference rows. To rerun the scale load, create a new empty database, apply migrations, and use the same arguments.

## Reproducibility note

Use the same Python major/minor version, psycopg/bcrypt dependency versions, seed, options, and `--as-of` for repeatable workload values and row counts. Bcrypt salts are intentionally fresh per run so generated account hashes do not create reusable demo credentials; those hash bytes are not part of the synthetic workload comparisons.
