import { CombinedMessage, getCombinedRelevantContext } from '../features/chat/chat.service';
import { logger } from '../utils/logger';

/**
 * Example usage of getCombinedRelevantContext function
 * 
 * This function demonstrates how to use the new getCombinedRelevantContext
 * to get a comprehensive chat history that combines:
 * 1. Semantic search results from Pinecone vector store (long-term memory)
 * 2. Recent messages from PostgreSQL database (short-term memory)
 * 3. Deduplication and chronological sorting
 */
export async function exampleUsage() {
    try {
        // Example parameters
        const query = "tell me about artificial intelligence and machine learning";
        const userId = "user_12345";
        const conversationId = "conv_67890";
        const maxMessages = 15;

        logger.info('🚀 Getting combined relevant context for LLM...');

        // Get combined context
        const context = await getCombinedRelevantContext(
            query,
            userId,
            conversationId,
            maxMessages
        );

        // Log the results
        logger.info(`📊 Context Summary:`);
        logger.info(`   Total messages: ${context.totalMessages}`);
        logger.info(`   Vector store messages: ${context.vectorMessages}`);
        logger.info(`   Database messages: ${context.databaseMessages}`);
        logger.info(`   Formatted context length: ${context.formattedContext.length} characters`);

        // Use the formatted context in your LLM prompt
        const systemPrompt = `
You are Kagami, a helpful AI assistant. Use the following conversation history to provide context-aware responses:

## Recent Conversation History:
${context.formattedContext}

## Current User Query:
${query}

Please respond based on the conversation context above.
`;

        logger.info('📝 System prompt ready for LLM');
        logger.info(`System prompt length: ${systemPrompt.length} characters`);

        // Individual messages are also available for more granular processing
        context.messages.forEach((msg: CombinedMessage, index: number) => {
            const source = msg.source === 'vector' ? '🔍 Vector' : '📝 Database';
            logger.info(`${index + 1}. ${source} - [${msg.role}]: ${msg.content.substring(0, 50)}...`);
        });

        return {
            systemPrompt,
            context,
            success: true
        };

    } catch (error) {
        logger.error('❌ Error in example usage:', error);
        return {
            systemPrompt: null,
            context: null,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Example of how to integrate with existing chat flow
 */
export async function integrateWithChatFlow(userMessage: string, userId: string, conversationId: string) {
    try {
        // 1. Get combined context using the user's message as query
        const relevantContext = await getCombinedRelevantContext(
            userMessage,
            userId,
            conversationId,
            12 // Limit to 12 messages for optimal token usage
        );

        // 2. Build enhanced system prompt
        const enhancedPrompt = `
You are Kagami, an intelligent AI assistant with access to conversation history.

## Conversation Context:
${relevantContext.formattedContext}

## Current User Message:
${userMessage}

Instructions:
- Use the conversation history to understand context and maintain continuity
- Reference previous messages when relevant
- Provide helpful, accurate, and contextually appropriate responses
- If the user asks about something discussed before, acknowledge and build upon it
`;

        // 3. Return data for LLM processing
        return {
            prompt: enhancedPrompt,
            contextMetadata: {
                totalMessages: relevantContext.totalMessages,
                vectorMessages: relevantContext.vectorMessages,
                databaseMessages: relevantContext.databaseMessages,
                hasVectorResults: relevantContext.vectorMessages > 0,
                hasRecentMessages: relevantContext.databaseMessages > 0
            },
            success: true
        };

    } catch (error) {
        logger.error('❌ Error integrating with chat flow:', error);
        
        // Fallback: continue without enhanced context
        return {
            prompt: `You are Kagami, an AI assistant. User message: ${userMessage}`,
            contextMetadata: {
                totalMessages: 0,
                vectorMessages: 0,
                databaseMessages: 0,
                hasVectorResults: false,
                hasRecentMessages: false
            },
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

// Export functions for use
export { getCombinedRelevantContext };
