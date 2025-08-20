import { logger } from "../../../utils/logger";
import { chatRepository } from "../chat.repository";
import { CombinedMessage, CombinedRelevantContext } from "../types/chat.types";
import { vectorStoreService } from "./vector-store.service";

export class ContextService {
    /**
     * Get recent chat history for conversation context (not system prompt)
     */
    async getRecentChatHistory(conversationId: string, limit: number = 10): Promise<CombinedMessage[]> {
        try {
            const messages = await chatRepository.getRecentMessages(conversationId, limit);
            return messages.map(msg => ({
                id: msg.id,
                role: msg.role,
                content: msg.content,
                timestamp: msg.timestamp,
                source: 'database' as const,
                conversationId: msg.conversationId,
                metadata: msg.metadata
            }));
        } catch (error) {
            logger.error('❌ Failed to get recent chat history:', error);
            return [];
        }
    }

    /**
     * Get combined relevant context from both vector store and database
     * Used for advanced context retrieval (currently not used in optimized flow)
     */
    async getCombinedRelevantContext(
        query: string, 
        conversationId: string,
        maxMessages: number = 20
    ): Promise<CombinedRelevantContext> {
        try {
            // Get semantic context from vector store
            const vectorContext = await vectorStoreService.getSemanticContext(query, conversationId);
            
            // Get recent database context
            const recentMessages = await this.getRecentChatHistory(conversationId, 10);
            
            // Combine and deduplicate messages
            const messageMap = new Map<string, CombinedMessage>();
            
            // Add vector messages first (higher priority for semantic relevance)
            vectorContext.messages.forEach(msg => {
                messageMap.set(msg.id, msg);
            });
            
            // Add recent database messages (only if not already included)
            recentMessages.forEach(msg => {
                if (!messageMap.has(msg.id)) {
                    messageMap.set(msg.id, msg);
                }
            });
            
            // Sort by timestamp and limit
            const combinedMessages = Array.from(messageMap.values())
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, maxMessages);
            
            return {
                messages: combinedMessages,
                totalMessages: combinedMessages.length,
                vectorMessages: vectorContext.messages.length,
                databaseMessages: recentMessages.length
            };
        } catch (error) {
            logger.error('❌ Failed to get combined relevant context:', error);
            return {
                messages: [],
                totalMessages: 0,
                vectorMessages: 0,
                databaseMessages: 0
            };
        }
    }

    /**
     * Clean and deduplicate messages
     */
    private cleanAndDeduplicateMessages(messages: CombinedMessage[]): CombinedMessage[] {
        const seenContent = new Set<string>();
        const deduplicatedMessages: CombinedMessage[] = [];
        
        for (const message of messages) {
            const normalizedContent = message.content.trim().toLowerCase();
            
            if (!seenContent.has(normalizedContent) && message.content.trim() !== '') {
                seenContent.add(normalizedContent);
                const cleanedMessage: CombinedMessage = {
                    ...message,
                    content: message.content.trim()
                };
                deduplicatedMessages.push(cleanedMessage);
            }
        }
        
        return deduplicatedMessages;
    }
}

export const contextService = new ContextService();
