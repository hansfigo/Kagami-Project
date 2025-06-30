import { startServer } from "./app";
import { logger } from "./utils/logger";

(async () => {
  await startServer();
}
)().catch((error) => {
  logger.error("Failed to start LLM Core Server:", error);
  process.exit(1);
});