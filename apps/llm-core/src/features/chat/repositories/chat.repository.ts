import { UserConfig } from "../../../config";
import { prisma } from "../../../lib/Prisma";
import { logger } from "../../../utils/logger";

export interface SaveChatArgs {
    user: {
        id: string;
        conversationId: string;
        userMessageId: string;
        userMessageCreatedAt: number;
        message: string;
        images?: string[];
        imageDescriptions?: string[];
    };
    ai: {
        aiMessageId: string;
        aiMessageCreatedAt: number;
        aiResponse: string;
        systemPrompt: string;
    };
}

export class ChatRepository {
    /**
     * Check if user conversation exists, create if not
     */
    async ensureConversationExists(userId: string, conversationId: string): Promise<void> {
        const userConversation = await prisma.conversation.findFirst({
            where: { userId, id: conversationId }
        });

        if (!userConversation) {
            await prisma.conversation.create({
                data: {
                    id: conversationId,
                    userId: userId,
                    title: 'FIGOMAGER Default Conversation',
                }
            });
            logger.info(`Created new conversation: ${conversationId}`);
        }
    }

    /**
     * Check if user message already exists (duplicate prevention)
     */
    async checkMessageDuplicate(userMessageId: string, conversationId: string): Promise<boolean> {
        const existingMessage = await prisma.message.findFirst({
            where: {
                id: userMessageId,
                conversationId: conversationId,
                role: 'user',
            }
        });

        return !!existingMessage;
    }

    /**
     * Get recent chat messages from database
     */
    async getRecentMessages(userId: string, conversationId: string, limit: number = 16): Promise<string[]> {
        try {
            const userWithMessages = await prisma.user.findUnique({
                where: { id: userId },
                include: {
                    Conversation: {
                        where: { id: conversationId },
                        include: {
                            messages: {
                                orderBy: { createdAt: 'desc' },
                                take: limit,
                            },
                        },
                    },
                },
            });

            return userWithMessages?.Conversation
                .flatMap((conversation) => conversation.messages)
                .map((msg) => {
                    const dateObj = new Date(msg.createdAt);
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

                    const cleanContent = msg.content.replace(/\s+/g, ' ').trim();
                    return `[${msg.role}] (${formattedDate} ${formattedTime}): ${cleanContent}`;
                })
                .reverse() || [];

        } catch (error) {
            logger.error(`Error getting recent chat history for user ${userId}:`, error);
            throw new Error('Failed to retrieve recent chat history');
        }
    }

    /**
     * Get recent chat messages as objects for context service
     */
    async getRecentMessagesAsObjects(conversationId: string, limit: number = 16): Promise<any[]> {
        try {
            const messages = await prisma.message.findMany({
                where: { conversationId },
                orderBy: { createdAt: 'desc' },
                take: limit,
            });

            return messages.map((msg) => ({
                id: msg.id,
                role: msg.role,
                content: msg.content,
                timestamp: new Date(msg.createdAt).getTime(),
                conversationId: msg.conversationId,
                metadata: msg.metadata
            })).reverse(); // Reverse to get chronological order

        } catch (error) {
            logger.error(`Error getting recent chat messages as objects:`, error);
            throw new Error('Failed to retrieve recent chat messages');
        }
    }

    /**
     * Save chat message pair to database
     */
    async saveChatMessage(args: SaveChatArgs): Promise<void> {
        const { user, ai } = args;
        const { userMessageId, userMessageCreatedAt, message, images, imageDescriptions } = user;
        const { aiMessageId, aiMessageCreatedAt, aiResponse, systemPrompt } = ai;

        try {
            await prisma.$transaction(async (tx) => {
                // Ensure conversation exists first
                await this.ensureConversationExists(UserConfig.id, UserConfig.conversationId);
                
                // Create user message
                await tx.message.create({
                    data: {
                        id: userMessageId,
                        conversationId: UserConfig.conversationId,
                        content: message,
                        role: 'user',
                        createdAt: new Date(userMessageCreatedAt),
                        hasImages: (images && images.length > 0),
                        metadata: {
                            id: userMessageId,
                            metadata: {
                                id: userMessageId,
                                conversationId: UserConfig.conversationId,
                                userId: UserConfig.id,
                                timestamp: userMessageCreatedAt,
                                role: 'user',
                                chunked: false, // Will be updated when vector chunks are stored
                                vectorChunkIds: [], // Will be updated when vector chunks are stored
                                vectorChunkCount: 0, // Will be updated when vector chunks are stored
                                imageCount: images?.length || 0,
                                imageDescriptions: imageDescriptions || [],
                                messageLength: message.length
                            },
                            pageContent: message
                        }
                    }
                });

                // Create images if any
                if (images && images.length > 0) {
                    const imageRecords = images.map((image, index) => {
                        const imageType = image.startsWith('data:') ? 'base64' :
                            image.startsWith('http') ? 'url' : 'base64';
                        const mimeType = image.startsWith('data:') ?
                            image.split(';')[0].split(':')[1] : 'image/jpeg';

                        return {
                            id: crypto.randomUUID(),
                            messageId: userMessageId,
                            imageUrl: image,
                            imageType,
                            mimeType,
                            size: image.length,
                            metadata: {
                                index,
                                processedAt: new Date().toISOString(),
                                description: imageDescriptions?.[index] || `Gambar ${index + 1}`,
                                aiGenerated: true
                            }
                        };
                    });

                    await tx.messageImage.createMany({
                        data: imageRecords
                    });
                }

                // Create AI response
                await tx.message.create({
                    data: {
                        id: aiMessageId,
                        conversationId: UserConfig.conversationId,
                        content: aiResponse,
                        role: 'assistant',
                        createdAt: new Date(aiMessageCreatedAt),
                        fullPrompt: systemPrompt,
                        hasImages: false,
                        metadata: {
                            id: aiMessageId,
                            metadata: {
                                id: aiMessageId,
                                conversationId: UserConfig.conversationId,
                                userId: UserConfig.id,
                                timestamp: aiMessageCreatedAt,
                                role: 'assistant',
                                chunked: false, // Will be updated when vector chunks are stored
                                vectorChunkIds: [], // Will be updated when vector chunks are stored
                                vectorChunkCount: 0, // Will be updated when vector chunks are stored
                                respondedToImages: (images && images.length > 0),
                                respondedToImageDescriptions: imageDescriptions || [],
                                systemPromptLength: systemPrompt.length,
                                responseLength: aiResponse.length
                            },
                            pageContent: aiResponse
                        }
                    }
                });
            });

        } catch (error) {
            logger.error('❌ Error saving chat message to database:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
                userMessageId,
                aiMessageId,
                conversationId: UserConfig.conversationId,
                timestamp: new Date().toISOString()
            });
            
            // Provide more specific error message for debugging
            if (error instanceof Error) {
                throw new Error(`Database transaction failed: ${error.message}`);
            } else {
                throw new Error('Failed to save chat message to database - unknown error');
            }
        }
    }

    /**
     * Update message metadata with vector chunk IDs
     */
    async updateMessageWithChunkIds(messageId: string, chunkIds: string[]): Promise<void> {
        try {
            logger.info(`💾 Updating metadata for message ${messageId} with ${chunkIds.length} chunk IDs: ${chunkIds.join(', ')}`);
            
            // First, get the existing message to preserve other metadata
            const existingMessage = await prisma.message.findUnique({
                where: { id: messageId }
            });

            if (!existingMessage) {
                logger.warn(`❌ Message ${messageId} not found for chunk ID update`);
                return;
            }

            logger.info(`📋 Found existing message, preserving metadata and adding chunk IDs`);
            const existingMetadata = existingMessage.metadata as any;
            
            // Determine if this is chunked based on number of IDs and role
            const isChunked = chunkIds.length > 1 || existingMessage.role === 'assistant';
            
            // Update only the chunk-related fields while preserving everything else
            const updatedMetadata = {
                ...existingMetadata,
                metadata: {
                    ...existingMetadata?.metadata,
                    vectorChunkIds: chunkIds,
                    vectorChunkCount: chunkIds.length,
                    chunked: isChunked // User messages are not chunked (single document), assistant messages are chunked
                }
            };

            await prisma.message.update({
                where: { id: messageId },
                data: {
                    metadata: updatedMetadata
                }
            });

            logger.info(`✅ Successfully updated message ${messageId} metadata with ${chunkIds.length} chunk IDs (chunked: ${isChunked})`);
            
            // Log the final metadata for verification
            logger.info(`🔍 Final metadata vectorChunkIds: ${JSON.stringify(updatedMetadata.metadata.vectorChunkIds)}`);
        } catch (error) {
            logger.error(`❌ Failed to update message metadata with chunk IDs for message ${messageId}:`, error);
            // Continue even if metadata update fails
        }
    }

    /**
     * Get message with images
     */
    async getMessageWithImages(messageId: string) {
        const message = await prisma.message.findUnique({
            where: { id: messageId },
            include: { images: true }
        });

        if (!message) {
            throw new Error('Message not found');
        }

        return {
            ...message,
            imageUrls: message.images.map(img => img.imageUrl)
        };
    }

    /**
     * Get last user message with its corresponding AI response
     */
    async getLastUserMessageWithAIResponse(): Promise<{
        userMessage: any;
        aiMessage: any;
    } | null> {
        try {
            // Get the latest user message
            const lastUserMessage = await prisma.message.findFirst({
                where: {
                    conversationId: UserConfig.conversationId,
                    role: 'user'
                },
                orderBy: {
                    createdAt: 'desc'
                },
                include: {
                    images: true
                }
            });

            if (!lastUserMessage) {
                return null;
            }

            // Get the AI response that came after this user message
            const aiResponse = await prisma.message.findFirst({
                where: {
                    conversationId: UserConfig.conversationId,
                    role: 'assistant',
                    createdAt: {
                        gt: lastUserMessage.createdAt
                    }
                },
                orderBy: {
                    createdAt: 'asc'
                },
                include: {
                    images: true
                }
            });

            return {
                userMessage: {
                    id: lastUserMessage.id,
                    content: lastUserMessage.content,
                    images: lastUserMessage.images
                },
                aiMessage: aiResponse ? {
                    id: aiResponse.id,
                    content: aiResponse.content
                } : null
            };
        } catch (error) {
            logger.error('Error getting last user message with AI response:', error);
            return null;
        }
    }

    /**
     * Save AI message only (for retry scenarios)
     */
    async saveAIMessage(args: {
        aiMessageId: string;
        aiMessageCreatedAt: number;
        aiResponse: string;
        systemPrompt: string;
        conversationId: string;
        userId: string;
    }): Promise<void> {
        try {
            await prisma.$transaction(async (tx) => {
                // Ensure conversation exists
                await tx.conversation.upsert({
                    where: { id: args.conversationId },
                    update: {},
                    create: {
                        id: args.conversationId,
                        userId: args.userId
                    }
                });

                // Save AI message
                await tx.message.create({
                    data: {
                        id: args.aiMessageId,
                        conversationId: args.conversationId,
                        role: 'assistant',
                        content: args.aiResponse,
                        createdAt: new Date(args.aiMessageCreatedAt),
                        metadata: {
                            systemPrompt: args.systemPrompt,
                            timestamp: args.aiMessageCreatedAt,
                            metadata: {
                                chunked: false, // Will be updated when chunks are added
                                vectorChunkIds: [],
                                vectorChunkCount: 0
                            }
                        }
                    }
                });
            });

            logger.info(`✅ Successfully saved AI message: ${args.aiMessageId}`);
        } catch (error) {
            logger.error('❌ Failed to save AI message:', error);
            throw error;
        }
    }

    /**
     * Add image metadata to database
     */
    async addImageMetadata(imageData: {
        id: string;
        messageId: string;
        imageUrl: string;
        imageType: string;
        mimeType?: string;
        size?: number;
        metadata?: any;
    }): Promise<void> {
        try {
            await prisma.messageImage.create({
                data: {
                    id: imageData.id,
                    messageId: imageData.messageId,
                    imageUrl: imageData.imageUrl,
                    imageType: imageData.imageType,
                    mimeType: imageData.mimeType,
                    size: imageData.size,
                    metadata: imageData.metadata || {}
                }
            });
            
            logger.info(`✅ Successfully saved image metadata for message: ${imageData.messageId}`);
        } catch (error) {
            logger.error('❌ Failed to save image metadata to database:', error);
            throw error;
        }
    }

    /**
     * Get latest message content
     */
    async getLatestMessage(): Promise<string | null> {
        try {
            const latestMessage = await prisma.message.findFirst({
                where: {
                    conversationId: UserConfig.conversationId,
                    role: 'assistant'
                },
                orderBy: {
                    createdAt: 'desc'
                }
            });

            return latestMessage?.content || null;
        } catch (error) {
            logger.error('Error getting latest message:', error);
            return null;
        }
    }

    /**
     * Add a single message to database
     */
    async addMessage(messageData: {
        id: string;
        conversationId: string;
        role: string;
        content: string;
        createdAt: Date;
        updatedAt: Date;
        hasImages: boolean;
        fullPrompt?: string;
        metadata?: any;
    }): Promise<void> {
        try {
            await prisma.message.create({
                data: {
                    id: messageData.id,
                    conversationId: messageData.conversationId,
                    role: messageData.role,
                    content: messageData.content,
                    createdAt: messageData.createdAt,
                    hasImages: messageData.hasImages,
                    fullPrompt: messageData.fullPrompt,
                    metadata: messageData.metadata || {}
                }
            });
            
            logger.info(`✅ Successfully saved ${messageData.role} message: ${messageData.id}`);
        } catch (error) {
            logger.error(`❌ Failed to save ${messageData.role} message:`, error);
            throw error;
        }
    }
}

export const chatRepository = new ChatRepository();
