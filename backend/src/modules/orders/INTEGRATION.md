# Customer API handoff

Uses the actual shared contract in `docs/INTEGRATION_CONTRACT.md`, `src/shared/contracts.ts`, `src/shared/types.ts`, and migration 001. No migrations or shared files are changed. Owned backend paths are mapped to the repository's established `backend/src/modules/catalog/` and `backend/src/modules/orders/` rather than creating a parallel apps/api stack.

Shared app registration (explicitly approved by the user and applied):

```ts
import { catalogRouter } from "./modules/catalog/routes.js";
import { ordersRouter } from "./modules/orders/routes.js";
// after express.json and /api/auth, BEFORE the existing 404 handler:
app.use("/api/products", catalogRouter);
app.use("/api", ordersRouter);
```

For isolated verification, the customer test harness mounts the same routers with the shared authentication and error handlers. This is one Express application and one shared PostgreSQL pool, not a separate database or microservice.
