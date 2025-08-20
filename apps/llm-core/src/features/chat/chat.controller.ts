import { v4 as uuidv4 } from 'uuid';
import { UserConfig } from "../../config";
import { logger } from "../../utils/logger";
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

            // Step 5: Save user message to database
            await this.saveUserMessage(messageInput, processedInput);

            // Step 6: Save AI response to database
            await this.saveAIMessage(aiResponse, aiMessageCreatedAt, systemPrompt);

            // Step 7: Store both messages in vector store for future semantic search
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
     * Save user message to database
     */
    private async saveUserMessage(
        messageInput: MessageInput, 
        processedInput: any
    ): Promise<void> {
        const userMessageId = this.currentUserMessageId!;
        const userTimestamp = Date.now(); // Ensure consistent timestamp
        
        const userMessageData = {
            id: userMessageId,
            conversationId: UserConfig.conversationId,
            role: 'user',
            content: messageInput.text,
            createdAt: new Date(userTimestamp),
            updatedAt: new Date(userTimestamp),
            hasImages: !!(processedInput.imageUrls && processedInput.imageUrls.length > 0),
            metadata: {
                id: userMessageId,
                metadata: {
                    id: userMessageId,
                    conversationId: UserConfig.conversationId,
                    userId: UserConfig.id,
                    timestamp: userTimestamp,
                    role: 'user',
                    chunkIndex: 0,
                    imageCount: processedInput.imageUrls?.length || 0,
                    imageDescriptions: processedInput.imageDescriptions || []
                },
                pageContent: messageInput.text
            }
        };

        await chatRepository.addMessage(userMessageData);

        // Save image metadata if images were uploaded
        if (processedInput.imageUrls && processedInput.imageUrls.length > 0) {
            await this.saveImageMetadata(userMessageData.id, processedInput);
        }
    }

    /**
     * Save AI response to database
     */
    private async saveAIMessage(
        aiResponse: string, 
        aiMessageCreatedAt: number, 
        systemPrompt: string
    ): Promise<void> {
        const aiMessageId = this.currentAIMessageId!;
        // Ensure AI message timestamp is always after user message
        // Add a small buffer (100ms) to ensure proper ordering
        const adjustedTimestamp = Math.max(aiMessageCreatedAt, Date.now() + 100);
        
        const aiMessageData = {
            id: aiMessageId,
            conversationId: UserConfig.conversationId,
            role: 'assistant',
            content: aiResponse,
            createdAt: new Date(adjustedTimestamp),
            updatedAt: new Date(adjustedTimestamp),
            hasImages: false,
            fullPrompt: systemPrompt,
            metadata: {
                id: aiMessageId,
                metadata: {
                    id: aiMessageId,
                    conversationId: UserConfig.conversationId,
                    userId: UserConfig.id,
                    timestamp: adjustedTimestamp,
                    role: 'assistant',
                    chunked: false, // Will be updated when vector chunks are stored
                    vectorChunkIds: [], // Will be updated when vector chunks are stored
                    vectorChunkCount: 0, // Will be updated when vector chunks are stored
                    respondedToImageDescriptions: [],
                    systemPromptLength: systemPrompt.length,
                    responseLength: aiResponse.length
                },
                pageContent: aiResponse
            }
        };

        await chatRepository.addMessage(aiMessageData);
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
            
            // Store user message
            await vectorStoreService.storeUserMessage(
                userMessageId,
                messageInput.text,
                timestamp,
                'imageUrls' in processedInput ? processedInput.imageUrls : undefined,
                'imageDescriptions' in processedInput ? processedInput.imageDescriptions : undefined
            );

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


