import { startApp } from "./app";
import { logger } from "./utils/logger";


(async () => {
    try {
        await startApp();
    } catch (error) {
        logger.error(`Error starting Worker: ${error}`);
        process.exit(1);
    }
})();