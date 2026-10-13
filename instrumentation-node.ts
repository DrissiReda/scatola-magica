import { cleanupExpiredSessions } from "@/app/_lib/uploads";
import { logger } from "@/app/_lib/logger";
import { startSearchIndex } from "@/app/_lib/search-index";

const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

export const startScheduler = async (): Promise<void> => {
  startSearchIndex().catch((error) =>
    logger.error("search-index", "Search index failed to start", error)
  );

  await cleanupExpiredSessions();

  const cleanupInterval = setInterval(() => {
    logger.info("scheduler", "Running upload cleanup");
    cleanupExpiredSessions().catch((error) =>
      logger.error("scheduler", "Upload cleanup failed", error)
    );
  }, CLEANUP_INTERVAL_MS);

  process.on("SIGTERM", () => clearInterval(cleanupInterval));

  logger.info("server-init", "Upload cleanup scheduler started");
};
