import { Document } from "@langchain/core/documents";
import { v4 as uuidv4 } from 'uuid';
import { UserConfig } from "../../../config";
import { chatHistoryVectorStore } from "../../../lib/Pinecone";
import { chunkText } from "../../../utils/chunking";
import { logger } from "../../../utils/logger";
import { CombinedMessage, CombinedRelevantContext } from "../types/chat.types";

export interface VectorMessage {
    id: string;
    role: string;
    content: string;
    timestamp: number;
    conversationId: string;
    metadata?: any;
}

export class VectorStoreService {
    /**
     * Check if user message content already exists in vector store
     */
    async isDuplicateUserMessage(content: string, hasImages: boolean = false): Promise<boolean> {
        try {
            const filter = {
                conversationId: UserConfig.conversationId,
                role: "user" as "user"
            };

            // Search for exact content match
            const results = await chatHistoryVectorStore.search(content, 5, filter);
            
            // Check if any result has exactly the same content
            const exactMatch = results.some((doc: Document) => {
                const originalText = doc.metadata?.originalText || doc.pageContent;
                const docHasImages = doc.metadata?.hasImages || false;
                
                // Content must match AND image presence must match
                const contentMatches = originalText.trim().toLowerCase() === content.trim().toLowerCase();
                const imageStatusMatches = docHasImages === hasImages;
                
                return contentMatches && imageStatusMatches;
            });

            if (exactMatch) {
                logger.info(`🔄 Duplicate user message detected: "${content.substring(0, 50)}..." (hasImages: ${hasImages})`);
                return true;
            }

            return false;
        } catch (error) {
            logger.error('Error checking duplicate user message:', error);
            // If check fails, allow saving to be safe
            return false;
        }
    }

    /**
     * Search for relevant chat history using semantic similarity
     */
    async searchRelevantHistory(query: string): Promise<string> {
        const filter = {
            conversationId: UserConfig.conversationId,
            role: "user" as "user"
        };

        const filterAssistant = {
            conversationId: UserConfig.conversationId,
            role: "assistant" as "assistant",
        };

        try {
            const [userResults, assistantResults] = await Promise.all([
                chatHistoryVectorStore.search(query, 4, filter),
                chatHistoryVectorStore.search(`${query}`, 4, filterAssistant)
            ]);

            const balancedResults: Document[] = [];
            const maxResults = Math.max(userResults.length, assistantResults.length);

            for (let i = 0; i < maxResults && balancedResults.length < 12; i++) {
                if (i < userResults.length && balancedResults.length < 12) {
                    balancedResults.push(userResults[i]);
                }
                if (i < assistantResults.length && balancedResults.length < 12) {
                    balancedResults.push(assistantResults[i]);
                }
            }

            const finalResults = balancedResults.filter((doc: Document) =>
                doc.pageContent && doc.pageContent.trim().length > 0
            );

            const sortedResults = finalResults.sort((a, b) =>
                (a.metadata?.timestamp || 0) - (b.metadata?.timestamp || 0)
            );

            const chatHistoryContext = sortedResults
                .map((doc: Document) => {
                    const role = doc.metadata?.role || 'unknown';
                    const timestamp = doc.metadata?.timestamp || Date.now();
                    const originalText = doc.pageContent;

                    const dateObj = new Date(timestamp);
                    const formattedDate = dateObj.toLocaleDateString('id-ID', {
                        year: 'numeric',
                        month: 'numeric',
                        day: 'numeric',
                    });
                    const formattedTime = dateObj.toLocaleTimeString('id-ID', {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                    });

                    const cleanText = originalText.replace(/\s+/g, ' ').trim();
                    return `[${role}] (${formattedDate} ${formattedTime}): ${cleanText}`;
                })
                .join('\n');

            return chatHistoryContext;
        } catch (error) {
            logger.error(`Error getting relevant chat history for query "${query}":`, error);
            throw new Error('Failed to retrieve relevant chat history');
        }
    }

    /**
     * Store user message in vector store
     */
    async storeUserMessage(
        messageId: string,
        message: string,
        timestamp: number,
        imageUrls?: string[],
        imageDescriptions?: string[]
    ): Promise<void> {
        try {
            // Check for duplicate content first (skip if duplicate)
            const hasImages = !!(imageUrls && imageUrls.length > 0);
            const isDuplicate = await this.isDuplicateUserMessage(message, hasImages);
            if (isDuplicate) {
                logger.info(`⏭️ Skipping duplicate user message storage for: "${message.substring(0, 50)}..." (hasImages: ${hasImages})`);
                return;
            }

            // Create enhanced page content for better semantic search
            const imageMetadata = imageUrls?.length ? 
                imageUrls.map((url, idx) => ({
                    index: idx,
                    type: 'url' as const,
                    mimeType: 'image/jpeg',
                    description: imageDescriptions?.[idx] || `Firebase Storage image ${idx + 1}`,
                    url: url
                })) : [];

            let enhancedPageContent = message;
            if (imageUrls?.length && imageDescriptions?.length) {
                const imageDescText = imageDescriptions.map((desc, idx) =>
                    `Gambar ${idx + 1}: ${desc}`
                ).join('; ');
                enhancedPageContent = `${message} [Berisi ${imageUrls.length} gambar: ${imageDescText}]`;
            }

            const userInputDoc = new Document({
                pageContent: enhancedPageContent,
                metadata: {
                    id: messageId,
                    conversationId: UserConfig.conversationId,
                    userId: UserConfig.id,
                    timestamp: timestamp,
                    role: 'user',
                    messageId: messageId,
                    chunkIndex: 0,
                    hasImages: (imageUrls?.length || 0) > 0,
                    imageCount: imageUrls?.length || 0,
                    originalText: message,
                    imageUrls: imageUrls || [],
                    imageDescriptions: imageDescriptions || [],
                    imageMetadata: imageMetadata
                }
            });

            await chatHistoryVectorStore.upsert(userInputDoc);
            logger.info(`✅ Stored new user message: "${message.substring(0, 50)}..."`);
        } catch (error) {
            logger.error('Error storing user message to vector store:', error);
            throw new Error('Failed to store user message to vector store');
        }
    }

    /**
     * Store and chunk AI response in vector store
     */
    async storeAIResponse(
        messageId: string,
        aiResponse: string,
        timestamp: number,
        chunkSize: number = 800,
        chunkOverlap: number = 100
    ): Promise<string[]> {
        try {
            logger.info(`📦 Starting to chunk AI response for message: ${messageId}, length: ${aiResponse.length}`);
            
            // Chunk the AI response
            const chunks: Document[] = await chunkText(aiResponse, {
                chunkSize,
                chunkOverlap
            });

            logger.info(`📄 Created ${chunks.length} chunks from AI response`);

            const docsToUpsert = chunks.map((chunk, index) => {
                const chunkDocsId = uuidv4();
                
                logger.info(`🔖 Creating chunk ${index + 1}/${chunks.length} with ID: ${chunkDocsId}`);

                return new Document({
                    pageContent: chunk.pageContent,
                    metadata: {
                        id: chunkDocsId,
                        conversationId: UserConfig.conversationId,
                        userId: UserConfig.id,
                        timestamp: timestamp,
                        chunkIndex: index,
                        originalText: chunk.pageContent,
                        role: 'assistant',
                        messageId: messageId
                    }
                });
            });

            logger.info(`🚀 Uploading ${docsToUpsert.length} chunks to Pinecone...`);
            await chatHistoryVectorStore.addDocuments(docsToUpsert);

            // Return chunk IDs for metadata linking - use metadata.id like the old service
            const chunkIds = docsToUpsert.map(doc => doc.metadata.id);
            logger.info(`✅ Successfully stored chunks. Returning IDs: ${chunkIds.join(', ')}`);
            
            return chunkIds;
        } catch (error) {
            logger.error('Error storing AI response to vector store:', error);
            throw new Error('Failed to store AI response to vector store');
        }
    }

    /**
     * Search messages with enhanced context
     */
    async searchWithContext(query: string, limit: number = 10): Promise<VectorMessage[]> {
        try {
            const filterOptions = {
                conversationId: UserConfig.conversationId,
            };

            const results = await chatHistoryVectorStore.search(query, limit, filterOptions);
            
            return results.map((doc: Document) => ({
                id: doc.id || doc.metadata?.id || doc.metadata?.messageId || 'unknown',
                role: doc.metadata?.role || 'unknown',
                content: doc.metadata?.originalText || doc.pageContent,
                timestamp: doc.metadata?.timestamp || Date.now(),
                conversationId: doc.metadata?.conversationId || UserConfig.conversationId,
                metadata: doc.metadata
            }));
        } catch (error) {
            logger.error('Error searching vector store:', error);
            throw new Error('Failed to search vector store');
        }
    }

    /**
     * Get semantic context for system prompt
     */
    async getSemanticContext(query: string, conversationId: string): Promise<CombinedRelevantContext> {
        try {
            const filter = {
                conversationId: conversationId
            };

            // Search for relevant context from vector store
            const results = await chatHistoryVectorStore.search(query, 6, filter);
            
            const messages: CombinedMessage[] = results.map((doc: Document) => ({
                id: doc.id || doc.metadata?.id || doc.metadata?.messageId || 'unknown',
                role: doc.metadata?.role || 'unknown',
                content: doc.metadata?.originalText || doc.pageContent,
                timestamp: doc.metadata?.timestamp || Date.now(),
                source: 'vector' as const,
                conversationId: doc.metadata?.conversationId || conversationId,
                metadata: doc.metadata
            }));

            return {
                messages,
                totalMessages: messages.length,
                vectorMessages: messages.length,
                databaseMessages: 0
            };
        } catch (error) {
            logger.error('Error getting semantic context:', error);
            return {
                messages: [],
                totalMessages: 0,
                vectorMessages: 0,
                databaseMessages: 0
            };
        }
    }

    /**
     * Search messages directly from Pinecone vector store
     */
    async searchMessages(query: string, limit: number = 10): Promise<VectorMessage[]> {
        try {
            const filter = {
                conversationId: UserConfig.conversationId,
            };

            const results = await chatHistoryVectorStore.search(query, limit, filter);
            
            return results.map((doc: Document) => ({
                id: doc.id || doc.metadata?.id,
                role: doc.metadata?.role || 'unknown',
                content: doc.metadata?.originalText || doc.pageContent,
                timestamp: doc.metadata?.timestamp || Date.now(),
                conversationId: doc.metadata?.conversationId || UserConfig.conversationId,

            }));
        } catch (error) {
            logger.error('❌ Failed to search messages from vector store:', error);
            return [];
        }
    }

    /**
     * Get latest messages from vector store without query search
     */
    async getLatestMessages(limit: number = 10): Promise<VectorMessage[]> {
        try {
            const filter = {
                conversationId: UserConfig.conversationId,
            };

            // Use a broad query to get recent messages
            const results = await chatHistoryVectorStore.search("*", limit * 2, filter);
            
            // Convert to VectorMessage format
            const messages = results.map((doc: Document) => ({
                id: doc.id || doc.metadata?.id,
                role: doc.metadata?.role || 'unknown',
                content: doc.metadata?.originalText || doc.pageContent,
                timestamp: doc.metadata?.timestamp || Date.now(),
                conversationId: doc.metadata?.conversationId || UserConfig.conversationId,
                metadata: doc.metadata
            }));

            // Sort by timestamp descending and take the requested limit
            return messages
                .sort((a: VectorMessage, b: VectorMessage) => b.timestamp - a.timestamp)
                .slice(0, limit);

        } catch (error) {
            logger.error('❌ Failed to get latest messages from vector store:', error);
            return [];
        }
    }

    /**
     * Verify that chunks exist in the vector store (optimized version)
     */
    async verifyChunks(chunkIds: string[]): Promise<{
        total: number;
        found: number;
        missing: string[];
        existing: string[];
    }> {
        try {
            logger.info(`🔍 Verifying ${chunkIds.length} chunks: ${chunkIds.join(', ')}`);
            
            const existing: string[] = [];
            const missing: string[] = [];
            
            // Instead of searching all documents, search for each chunk individually
            // This is more efficient than loading 1000+ documents
            for (const chunkId of chunkIds) {
                try {
                    // Search with a specific filter for this chunk ID
                    // Use a simple query but filter by the specific ID
                    const results = await chatHistoryVectorStore.search("assistant", 5, {
                        conversationId: UserConfig.conversationId,
                        id: chunkId,
                        role: "assistant"
                    });
                    
                    // Check if any result has the exact ID we're looking for
                    const found = results.some((doc: Document) => doc.id === chunkId || doc.metadata?.id === chunkId);
                    
                    if (found) {
                        existing.push(chunkId);
                        logger.info(`✅ Found chunk: ${chunkId}`);
                    } else {
                        missing.push(chunkId);
                        logger.warn(`❌ Missing chunk: ${chunkId}`);
                    }
                } catch (searchError) {
                    logger.warn(`⚠️ Search failed for chunk ${chunkId}:`, searchError);
                    missing.push(chunkId);
                }
            }
            
            return {
                total: chunkIds.length,
                found: existing.length,
                missing,
                existing
            };
        } catch (error) {
            logger.error('❌ Failed to verify chunks in vector store:', error);
            return {
                total: chunkIds.length,
                found: 0,
                missing: chunkIds,
                existing: []
            };
        }
    }
}

export const vectorStoreService = new VectorStoreService();
