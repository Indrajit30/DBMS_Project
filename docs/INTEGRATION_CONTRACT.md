# Shared Backend and Database Integration Contract

**Schema owner:** Member 1.  
**Contract source:** `backend/migrations/*.sql`; migration history in PostgreSQL is authoritative.

## Shared table changes

- Do not add, rename, or repurpose shared columns in a module route or by manually editing a local database.
- Propose changes to Member 1. Accepted changes arrive as a new ordered SQL migration; do not edit a migration already applied to a shared environment.
- Apply schema changes with `cd backend` then `npm run db:migrate`. Check drift and pending versions with `npm run db:status`.
- Each workflow transaction must use one checked-out `PoolClient`, parameterized SQL, and commit/rollback before releasing it.
- Stock updates must lock/check the affected balance row and change `inventory_balances` and append corresponding `stock_movements` in the same transaction. Do not calculate availability as `on_hand - reserved`; `unavailable` must also be subtracted.
- Deletion of referenced operational data is restricted. Use status and audit events to preserve history.

## TypeScript interfaces

Import shared roles, identities, auth and response shapes from `backend/src/shared/types.ts`:

- `UserRole`: `customer | warehouse_employee | manager`.
- `AuthenticatedUser`: `userId`, `role`, `customerId`, `warehouseIds`.
- `LoginRequest`, `RegisterCustomerRequest`, `LoginResponse`, and `ApiErrorResponse`.

Import middleware from `backend/src/auth/middleware.ts`:

- `requireAuth` attaches the current active database-backed role and scope to `request.auth` on every request.
- `requireRoles(...roles)` enforces role requirements.
- `requireWarehouseScope('warehouseId')` allows managers network access and employees only their assigned warehouse. Compose it after `requireAuth`.
- `requireOrderOwnership(orderId, request.auth)` permits a customer’s own order and a manager, returning 404 for another customer’s order to avoid revealing it exists.

Never authorize from a role or warehouse ID supplied in the request body. Role and membership changes take effect on the next request because middleware reloads them from PostgreSQL.

## API conventions

- Prefix application routes with `/api`; JSON request and response bodies use `snake_case`.
- Use `Authorization: Bearer <access_token>` for protected requests. Access tokens are HS256 JWTs issued for 15 minutes; `JWT_SECRET` must be secret and at least 32 characters. The database role/status/auth-version is checked on each request.
- Successful reads return a resource object or `{ "data": [...], "page": { "limit": n, "next_cursor": "..." } }` for collections. Prefer cursor pagination on high-volume histories; do not use unbounded list responses.
- Errors use `{ "error": { "code", "message", "request_id", "details?" } }`. Server responses include `x-request-id`.
- Validate request bodies and path/query values before SQL. Use `$1`, `$2`, … parameters; never interpolate user values into SQL.
- Mutation endpoints that may be retried should accept an `Idempotency-Key` header and persist it with the operation (the schema’s `request_id` stores the accepted key where appropriate). Replays return the existing result; keys must be scoped to the actor/resource operation. The random `x-request-id` is a separate per-request tracing value.
- Timestamps are ISO 8601 with an explicit offset; persisted values use `timestamptz`.
- Do not log passwords, password hashes, bearer tokens, or full payment-like secrets.

## Implemented shared auth routes

| Method and path | Access | Request / response |
|---|---|---|
| `POST /api/auth/register` | Public, rate limited | Customer profile and credentials; returns `LoginResponse`. |
| `POST /api/auth/login` | Public, rate limited | `{email,password}`; returns `LoginResponse`. |
| `GET /api/auth/me` | Authenticated | Returns current user role, customer ID, and warehouse scope. |
| `POST /api/auth/logout` | Authenticated | Returns 204; client discards bearer token. Tokens expire after 15 minutes. Increment `users.auth_version` to invalidate all existing tokens for an account. |
| `GET /api/health` | Public | Database connectivity status only. |

Workflow routes remain contracts for their module owners; they are not implemented by this shared foundation:

| Suggested route | Module owner action |
|---|---|
| `GET /api/products`, `GET /api/products/:productId/availability` | Catalog and indicative availability. |
| `POST /api/orders`, `GET /api/orders/:orderId`, `POST /api/orders/:orderId/cancellations` | Customer ordering, ownership and eligible cancellation. |
| `GET /api/warehouses/:warehouseId/inventory` | Employee warehouse scope and inventory reads. |
| `POST /api/transfers`, `POST /api/transfers/:transferId/receive` | Manager approval and idempotent transfer receipt. |
| `POST /api/returns`, `POST /api/returns/:returnId/inspection` | Return authorization, receipt and inspection. |
| `GET /api/alerts`, `POST /api/alerts/:alertId/acknowledge` | Manager risk queue and action workflow. |

Route names are initial integration proposals. The owning teammate should document exact payloads, transitions and idempotency behavior before implementing the route.

## Ownership boundaries

Member 1 owns migrations, shared database helpers/types, auth middleware and account foundation, local seed, and synthetic data generation. Other members own customer ordering, employee picking/dispatch/receiving, and manager business workflows. They may use the contract without creating or changing shared tables independently.
