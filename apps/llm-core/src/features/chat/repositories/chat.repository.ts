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
     * Save chat message pair to database
     */
    async saveChatMessage(args: SaveChatArgs): Promise<void> {
        const { user, ai } = args;
        const { userMessageId, userMessageCreatedAt, message, images, imageDescriptions } = user;
        const { aiMessageId, aiMessageCreatedAt, aiResponse, systemPrompt } = ai;

        try {
            await prisma.$transaction(async (tx) => {
                // Create user message
                await tx.message.create({
                    data: {
                        id: userMessageId,
                        conversationId: UserConfig.conversationId,
                        content: message,
                        role: 'user',
                        hasImages: (images && images.length > 0),
                        metadata: {
                            id: userMessageId,
                            metadata: {
                                id: userMessageId,
                                conversationId: UserConfig.conversationId,
                                userId: UserConfig.id,
                                timestamp: userMessageCreatedAt,
                                role: 'user',
                                chunkIndex: 0,
                                imageCount: images?.length || 0,
                                imageDescriptions: imageDescriptions || []
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
                                respondedToImages: (images && images.length > 0),
                                respondedToImageDescriptions: imageDescriptions || []
                            },
                            pageContent: aiResponse
                        }
                    }
                });
            });

        } catch (error) {
            logger.error('Error saving chat message to database:', error);
            throw new Error('Failed to save chat message to database');
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
            
            // Update only the chunk-related fields while preserving everything else
            const updatedMetadata = {
                ...existingMetadata,
                metadata: {
                    ...existingMetadata?.metadata,
                    vectorChunkIds: chunkIds,
                    vectorChunkCount: chunkIds.length,
                    chunked: true
                }
            };

            await prisma.message.update({
                where: { id: messageId },
                data: {
                    metadata: updatedMetadata
                }
            });

            logger.info(`✅ Successfully updated message ${messageId} metadata with ${chunkIds.length} chunk IDs`);
            
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
