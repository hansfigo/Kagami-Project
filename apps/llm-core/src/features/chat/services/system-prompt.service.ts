import { config, createSystemPromot, SystemPromptVersion } from "../../../config";
import { getCurrentDateTimeInfo } from "../../../utils/date";
import { logger } from "../../../utils/logger";
import { vectorStoreService } from "./vector-store.service";

export class SystemPromptService {
    /**
     * Build system prompt using the original config system
     */
    async buildSystemPrompt(userMessage: string, conversationId: string): Promise<string> {
        const dateTimeInfo = getCurrentDateTimeInfo();
        
        // Get ONLY semantic context from vector store (pure similarity search)
        const semanticContext = await vectorStoreService.searchRelevantHistory(userMessage);
        
        logger.info(`📚 Built system prompt with semantic context: ${semanticContext.split('\n').length} messages`);

        // Use the original system prompt from config
        const systemPromptVersion: SystemPromptVersion = config.systemPrompt.version;
        
        if (systemPromptVersion === 'optimized-v2' || systemPromptVersion === 'optimized-v3') {
            // v2 and v3 use the same signature: (combinedFormattedContext, currentDate, userProfileContext?)
            return createSystemPromot[systemPromptVersion](
                semanticContext,
                dateTimeInfo
            );
        } else {
            // For other versions (default, old, optimized), pass semantic context only
            return createSystemPromot[systemPromptVersion](
                semanticContext,
                dateTimeInfo,
                [] // No recent chat history - pure similarity search only
            );
        }
    }
}

export const systemPromptService = new SystemPromptService();
