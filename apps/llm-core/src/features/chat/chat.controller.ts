import { v4 as uuidv4 } from 'uuid';
import { UserConfig } from "../../config";
import { chatHistoryVectorStore } from "../../lib/Pinecone";
import { prisma } from "../../lib/Prisma";
import { logger } from "../../utils/logger";
import type { SaveChatArgs } from "./repositories/chat.repository";
import {
    chatRepository,
    contextService,
    imageService,
    llmService,
    systemPromptService,
    vectorStoreService
} from "./services";

interface MessageInput {
    text: string;
    images?: string[];
}

interface ProcessedMessageInput extends MessageInput {
    imageUrls?: string[];
    originalImages?: string[];
    base64Images?: string[];
    imageDescriptions?: string[];
}

interface ChatResponse {
    aiResponse: string;
    aiMessageCreatedAt: number;
    systemPrompt: string;
    error?: {
        type: string;
        message: string;
        details?: any;
    };
}

export class ChatController {
    // Store message IDs to sync between database and vector store
    private currentUserMessageId?: string;
    private currentAIMessageId?: string;

    /**
     * Process a chat message with optional images
     */
    async processMessage(input: string | MessageInput): Promise<ChatResponse> {
        const startTime = Date.now();
        
        try {
            // Generate message IDs upfront for consistency
            this.currentUserMessageId = uuidv4();
            this.currentAIMessageId = uuidv4();

            // Normalize input
            const messageInput = typeof input === 'string' 
                ? { text: input } 
                : input;

            logger.info(`🎯 Processing message: "${messageInput.text.substring(0, 100)}${messageInput.text.length > 100 ? '...' : ''}"`);
            
            if (messageInput.images && messageInput.images.length > 0) {
                logger.info(`📷 With ${messageInput.images.length} image(s)`);
            }

            // Step 1: Process images if provided
            const processedInput = messageInput.images && messageInput.images.length > 0
                ? await imageService.processImages(messageInput)
                : messageInput;

            // Step 2: Build system prompt with semantic context
            const systemPrompt = await systemPromptService.buildSystemPrompt(
                messageInput.text, 
                UserConfig.conversationId
            );

            // Step 3: Get recent chat history for conversation context
            const recentChatHistory = await contextService.getRecentChatHistory(
                UserConfig.conversationId, 
                8 // Limit to last 8 messages for context
            );

            // Step 4: Call LLM with retry mechanism
            const images = 'base64Images' in processedInput 
                ? processedInput.base64Images 
                : messageInput.images;
                
            const { aiResponse, aiMessageCreatedAt } = await llmService.callLLM(
                messageInput.text,
                systemPrompt,
                images,
                recentChatHistory
            );

            // Step 5: Save both user and AI messages to database atomically
            // Only save if LLM call was successful
            await this.saveChatPairToDatabase(messageInput, processedInput, aiResponse, aiMessageCreatedAt, systemPrompt);

            // Step 6: Store both messages in vector store for future semantic search
            await this.storeInVectorStore(messageInput, aiResponse, processedInput);

            const duration = Date.now() - startTime;
            logger.info(`✅ Message processed successfully in ${duration}ms`);

            return {
                aiResponse,
                aiMessageCreatedAt,
                systemPrompt
            };

        } catch (error) {
            const duration = Date.now() - startTime;
            logger.error(`❌ Message processing failed after ${duration}ms:`, error);
            
            // Create detailed error response for debugging
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const errorType = error instanceof Error ? error.constructor.name : 'UnknownError';
            
            // Try to get the latest message as fallback
            let fallbackResponse = 'Maaf, ada masalah teknis. Silakan coba lagi.';
            try {
                const latestMessage = await chatRepository.getLatestMessage();
                if (latestMessage) {
                    fallbackResponse = `Maaf, ada masalah teknis. Ini pesan terakhir yang berhasil: "${latestMessage.substring(0, 100)}..."`;
                }
            } catch (fallbackError) {
                logger.error('Failed to get fallback message:', fallbackError);
            }
            
            return {
                aiResponse: fallbackResponse,
                aiMessageCreatedAt: Date.now(),
                systemPrompt: '',
                error: {
                    type: errorType,
                    message: errorMessage,
                    details: {
                        duration: `${duration}ms`,
                        timestamp: new Date().toISOString(),
                        step: this.identifyFailureStep(error)
                    }
                }
            };
        } finally {
            // Clean up message IDs
            this.currentUserMessageId = undefined;
            this.currentAIMessageId = undefined;
        }
    }

    /**
     * Save both user and AI messages to database in a single atomic transaction
     * This ensures that if AI message fails, user message is also not saved
     */
    private async saveChatPairToDatabase(
        messageInput: MessageInput,
        processedInput: any,
        aiResponse: string,
        aiMessageCreatedAt: number,
        systemPrompt: string
    ): Promise<void> {
        const userMessageId = this.currentUserMessageId!;
        const aiMessageId = this.currentAIMessageId!;
        const userTimestamp = Date.now();
        const adjustedAiTimestamp = Math.max(aiMessageCreatedAt, userTimestamp + 100);

        try {
            await chatRepository.saveChatMessage({
                user: {
                    id: UserConfig.id,
                    conversationId: UserConfig.conversationId,
                    userMessageId: userMessageId,
                    userMessageCreatedAt: userTimestamp,
                    message: messageInput.text,
                    images: processedInput.imageUrls || [],
                    imageDescriptions: processedInput.imageDescriptions || []
                },
                ai: {
                    aiMessageId: aiMessageId,
                    aiMessageCreatedAt: adjustedAiTimestamp,
                    aiResponse: aiResponse,
                    systemPrompt: systemPrompt
                }
            });
            
            logger.info(`✅ Successfully saved chat pair to database: user(${userMessageId}) + ai(${aiMessageId})`);
        } catch (error) {
            logger.error(`❌ Failed to save chat pair to database:`, error);
            throw new Error(`Database save failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Store messages in vector store for semantic search
     */
    private async storeInVectorStore(
        messageInput: MessageInput, 
        aiResponse: string, 
        processedInput: any
    ): Promise<void> {
        try {
            // Use consistent message IDs
            const userMessageId = this.currentUserMessageId!;
            const aiMessageId = this.currentAIMessageId!;
            const timestamp = Date.now();
            
            // Store user message (returns single document ID, same as messageId)
            const userVectorId = await vectorStoreService.storeUserMessage(
                userMessageId,
                messageInput.text,
                timestamp,
                'imageUrls' in processedInput ? processedInput.imageUrls : undefined,
                'imageDescriptions' in processedInput ? processedInput.imageDescriptions : undefined
            );

            // Update user message metadata with vector ID (for user messages, vectorChunkIds contains the single document ID)
            if (userVectorId) {
                logger.info(`💾 Updating user message metadata with vector ID: ${userVectorId}`);
                await chatRepository.updateMessageWithChunkIds(userMessageId, [userVectorId]);
                
                // Verify the update was successful
                try {
                    const updatedUserMessage = await prisma.message.findUnique({
                        where: { id: userMessageId }
                    });
                    if (updatedUserMessage) {
                        const metadata = updatedUserMessage.metadata as any;
                        logger.info(`🔍 User message metadata after update: ${JSON.stringify(metadata?.metadata?.vectorChunkIds)}`);
                    } else {
                        logger.warn(`⚠️ Could not verify user message update for ID: ${userMessageId}`);
                    }
                } catch (verifyError) {
                    logger.warn(`⚠️ Could not verify user message update:`, verifyError);
                }
            } else {
                logger.warn(`⚠️ No vector ID returned for user message: ${userMessageId}`);
            }

            // Store AI response with chunk tracking
            logger.info(`📦 Storing AI response in vector store for message: ${aiMessageId}`);
            const chunkIds = await vectorStoreService.storeAIResponse(
                aiMessageId,
                aiResponse,
                Date.now()
            );

            // Log the chunk IDs that were returned
            logger.info(`🔗 Vector store returned ${chunkIds.length} chunk IDs: ${chunkIds.join(', ')}`);

            // Update the assistant message metadata with chunk IDs if chunks were created
            if (chunkIds && chunkIds.length > 0) {
                logger.info(`💾 Updating database metadata for message ${aiMessageId} with chunk IDs`);
                await chatRepository.updateMessageWithChunkIds(aiMessageId, chunkIds);
                
                // Optional verification for debugging (can be disabled in production)
                const shouldVerify = process.env.NODE_ENV !== 'production' && process.env.VERIFY_CHUNKS !== 'false';
                
                if (shouldVerify) {
                    logger.info(`🔍 Verifying chunks exist in vector store...`);
                    
                    // Add a small delay to account for Pinecone indexing
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    const verificationResults = await vectorStoreService.verifyChunks(chunkIds);
                    logger.info(`✅ Chunk verification: ${verificationResults.found}/${verificationResults.total} chunks found`);
                    
                    if (verificationResults.missing.length > 0) {
                        logger.warn(`⚠️ Missing chunks: ${verificationResults.missing.join(', ')}`);
                    }
                } else {
                    logger.info(`⏭️ Chunk verification skipped (production mode or disabled)`);
                }
            } else {
                logger.warn(`⚠️ No chunk IDs returned from vector store for message: ${aiMessageId}`);
            }

        } catch (error) {
            logger.error('❌ Failed to store in vector store:', error);
            // Don't throw - vector store errors shouldn't fail the main flow
        }
    }

    /**
     * Save image metadata to database
     */
    private async saveImageMetadata(messageId: string, processedInput: any): Promise<void> {
        if (!processedInput.imageUrls || processedInput.imageUrls.length === 0) {
            return;
        }

        try {
            for (let i = 0; i < processedInput.imageUrls.length; i++) {
                const imageUrl = processedInput.imageUrls[i];
                const description = processedInput.imageDescriptions?.[i] || `Image ${i + 1}`;
                
                // Determine mimeType and size from URL or default values
                const mimeType = imageUrl.includes('jpeg') || imageUrl.includes('jpg') ? 'image/jpeg' : 'image/png';
                
                const imageData = {
                    id: uuidv4(),
                    messageId: messageId,
                    imageUrl: imageUrl,
                    imageType: 'upload', // Required field
                    mimeType: mimeType, // Optional but good to have
                    metadata: {
                        index: i,
                        originalFormat: 'base64',
                        uploadedAt: new Date().toISOString(),
                        description: description // Store description in metadata instead
                    }
                };

                await chatRepository.addImageMetadata(imageData);
            }
        } catch (error) {
            logger.error('❌ Failed to save image metadata:', error);
            // Don't throw - metadata errors shouldn't fail the main flow
        }
    }

    /**
     * Get latest message
     */
    async getLatestMessage(): Promise<string | null> {
        return await chatRepository.getLatestMessage();
    }

    /**
     * Retry last user message by deleting AI response and re-processing
     */
    async retryLastMessage(): Promise<{
        originalMessage?: string;
        aiResponse?: string;
        deletedAIMessageId?: string;
        newAIMessageId?: string;
        error?: string;
    }> {
        try {
            logger.info("🔄 Starting retry process for last user message...");

            // Step 1: Get the last user message and its corresponding AI response
            const lastUserMessage = await chatRepository.getLastUserMessageWithAIResponse();
            
            if (!lastUserMessage) {
                logger.warn("❌ No user message found to retry");
                return { error: "No user message found to retry" };
            }

            const { userMessage, aiMessage } = lastUserMessage;
            logger.info(`📝 Found user message to retry: "${userMessage.content.substring(0, 50)}..."`);
            
            if (!aiMessage) {
                logger.warn("❌ No AI response found for the last user message");
                return { error: "No AI response found for the last user message" };
            }

            // Step 2: Delete the AI response (database + vector store)
            logger.info(`🗑️ Deleting AI response: ${aiMessage.id}`);
            await this.deleteAIMessage(aiMessage.id);

            // Step 3: Re-process the user message
            logger.info(`♻️ Re-processing user message...`);
            
            // Generate new AI message ID
            this.currentUserMessageId = userMessage.id; // Use existing user message ID
            this.currentAIMessageId = uuidv4(); // Generate new AI message ID

            // Rebuild message input from stored user message
            const messageInput: MessageInput = {
                text: userMessage.content,
                images: userMessage.images?.map((img: any) => img.imageUrl) || []
            };

            // Process images if they exist
            const processedInput = messageInput.images && messageInput.images.length > 0
                ? await imageService.processImages(messageInput)
                : messageInput;

            // Build system prompt with semantic context
            const systemPrompt = await systemPromptService.buildSystemPrompt(
                messageInput.text, 
                UserConfig.conversationId
            );

            // Get recent chat history (excluding the deleted AI message)
            const recentChatHistory = await contextService.getRecentChatHistory(
                UserConfig.conversationId, 
                8
            );

            // Call LLM
            const images = 'base64Images' in processedInput 
                ? processedInput.base64Images 
                : messageInput.images;
                
            const { aiResponse, aiMessageCreatedAt } = await llmService.callLLM(
                messageInput.text,
                systemPrompt,
                images,
                recentChatHistory
            );

            // Step 4: Save new AI response to database
            const adjustedAiTimestamp = Math.max(aiMessageCreatedAt, Date.now());
            
            await chatRepository.saveAIMessage({
                aiMessageId: this.currentAIMessageId!,
                aiMessageCreatedAt: adjustedAiTimestamp,
                aiResponse: aiResponse,
                systemPrompt: systemPrompt,
                conversationId: UserConfig.conversationId,
                userId: UserConfig.id
            });

            // Step 5: Store new AI response in vector store
            const chunkIds = await vectorStoreService.storeAIResponse(
                this.currentAIMessageId!,
                aiResponse,
                adjustedAiTimestamp
            );

            // Update AI message metadata with chunk IDs
            if (chunkIds && chunkIds.length > 0) {
                await chatRepository.updateMessageWithChunkIds(this.currentAIMessageId!, chunkIds);
            }

            logger.info(`✅ Retry completed successfully. New AI message: ${this.currentAIMessageId}`);

            return {
                originalMessage: userMessage.content,
                aiResponse: aiResponse,
                deletedAIMessageId: aiMessage.id,
                newAIMessageId: this.currentAIMessageId!
            };

        } catch (error) {
            logger.error("❌ Failed to retry last message:", error);
            return { 
                error: `Failed to retry message: ${error instanceof Error ? error.message : 'Unknown error'}` 
            };
        } finally {
            // Clean up message IDs
            this.currentUserMessageId = undefined;
            this.currentAIMessageId = undefined;
        }
    }

    /**
     * Delete AI message from database and vector store
     */
    private async deleteAIMessage(aiMessageId: string): Promise<void> {
        try {
            // Get AI message to find chunk IDs
            const aiMessage = await prisma.message.findUnique({
                where: { id: aiMessageId },
                include: { images: true }
            });

            if (!aiMessage) {
                logger.warn(`AI message ${aiMessageId} not found in database`);
                return;
            }

            // Extract chunk IDs from metadata for vector store deletion
            const metadata = aiMessage.metadata as any;
            const chunkIds = metadata?.metadata?.vectorChunkIds || [];

            // Delete from database (with cascade for images)
            await prisma.$transaction(async (tx) => {
                // Delete associated images first
                if (aiMessage.images.length > 0) {
                    await tx.messageImage.deleteMany({
                        where: { messageId: aiMessageId }
                    });
                }

                // Delete the message
                await tx.message.delete({
                    where: { id: aiMessageId }
                });
            });

            // Delete from vector store
            if (chunkIds.length > 0) {
                try {
                    await chatHistoryVectorStore.delete(chunkIds);
                    logger.info(`🗑️ Deleted ${chunkIds.length} chunks from vector store: ${chunkIds.join(', ')}`);
                } catch (vectorError) {
                    logger.warn(`⚠️ Failed to delete chunks from vector store:`, vectorError);
                }
            }

            logger.info(`✅ Successfully deleted AI message: ${aiMessageId}`);

        } catch (error) {
            logger.error(`❌ Failed to delete AI message ${aiMessageId}:`, error);
            throw error;
        }
    }

    /**
     * Search messages with image context
     */
    async searchWithImageContext(query: string): Promise<any[]> {
        return await vectorStoreService.searchMessages(query);
    }

    /**
     * Get message with images
     */
    async getMessageWithImages(messageId: string): Promise<any> {
        return await chatRepository.getMessageWithImages(messageId);
    }

    /**
     * Identify which step failed based on error message
     */
    private identifyFailureStep(error: any): string {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        if (errorMessage.includes('image') || errorMessage.includes('Firebase')) {
            return 'Image Processing';
        } else if (errorMessage.includes('system prompt') || errorMessage.includes('semantic')) {
            return 'System Prompt Building';
        } else if (errorMessage.includes('LLM') || errorMessage.includes('AI') || errorMessage.includes('gemini')) {
            return 'LLM Call';
        } else if (errorMessage.includes('database') || errorMessage.includes('prisma') || errorMessage.includes('SQL')) {
            return 'Database Save';
        } else if (errorMessage.includes('vector') || errorMessage.includes('pinecone')) {
            return 'Vector Store';
        } else if (errorMessage.includes('network') || errorMessage.includes('timeout') || errorMessage.includes('connection')) {
            return 'Network/Connection';
        } else {
            return 'Unknown Step';
        }
    }
}

export const chatController = new ChatController();


