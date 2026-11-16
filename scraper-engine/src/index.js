/**
 * SCRAPER PREMIUM — Node.js Scraper Worker
 * Entry point: starts the internal API server, then listens for jobs from Flask.
 */

import "./utils/env.js"; // load .env first
import { startApiServer } from "./services/api.js";
import { logger } from "./utils/logger.js";

process.on("uncaughtException",  (err) => logger.error("uncaughtException",  { error: err.message, stack: err.stack }));
process.on("unhandledRejection", (err) => logger.error("unhandledRejection", { error: String(err) }));

async function main() {
  logger.info("SCRAPER PREMIUM worker starting…");
  await startApiServer();
  logger.info("Worker ready — waiting for dispatch requests from Flask backend");
}

main();
