import { randomUUID } from "node:crypto";
import express from "express";
import { authRouter } from "./auth/routes.js";
import { pool } from "./db/pool.js";
import { ApiError, errorHandler } from "./shared/errors.js";

export const app = express();

app.disable("x-powered-by");
app.use((request, response, next) => {
  request.requestId = randomUUID();
  response.setHeader("x-request-id", request.requestId);
  next();
});
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", async (_request, response, next) => {
  try {
    await pool.query("SELECT 1");
    response.json({ status: "ok" });
  } catch (error) {
    next(error);
  }
});

app.use("/api/auth", authRouter);
app.use((_request, _response, next) => next(new ApiError(404, "NOT_FOUND", "Route not found")));
app.use(errorHandler);
