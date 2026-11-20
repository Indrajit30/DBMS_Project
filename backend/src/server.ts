import { app } from "./app.js";
import { config } from "./config.js";
import { closePool } from "./db/pool.js";

const server = app.listen(config.PORT, () => {
  console.log(`Multiwarehouse API listening on port ${config.PORT}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}; shutting down`);
  server.close(async (error) => {
    if (error) {
      console.error("HTTP server close failed", error.message);
      process.exitCode = 1;
    }
    await closePool();
    process.exit();
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
