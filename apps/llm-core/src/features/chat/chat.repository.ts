import { UserConfig } from "../../config";
import { prisma } from "../../lib/Prisma";
import { logger } from "../../utils/logger";


interface IChatRepository {
    getLatestMessage(): Promise<string | null>;
    getRecentMessages(conversationId: string, limit: number): Promise<any[]>;
    addImageMetadata(imageData: any): Promise<void>;
    getMessageWithImages(messageId: string): Promise<any>;
    updateMessageWithChunkIds(messageId: string, chunkIds: string[]): Promise<void>;
}

export class ChatRepository implements IChatRepository {


    constructor() {
    }

    public async getLatestMessage(): Promise<string | null> {
        const messages = await prisma.message.findMany({
            where: {
                conversationId: UserConfig.conversationId,
                role: 'assistant',
            },
            orderBy: {
                createdAt: 'desc',
            },
            take: 1,
        });

        return messages[0]?.content || null;
    }

    public async addMessage(data : any): Promise<void> {
        await prisma.message.create({
            data: data
        });
    }

    public async getRecentMessages(conversationId: string, limit: number): Promise<any[]> {
        const messages = await prisma.message.findMany({
            where: {
                conversationId: conversationId,
            },
            orderBy: {
                createdAt: 'desc', // Get newest first
            },
            take: limit,
        });

        // Reverse to get oldest-to-newest order for proper conversation flow
        const orderedMessages = messages.reverse();

        return orderedMessages.map(msg => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            timestamp: msg.createdAt.getTime(),
            conversationId: msg.conversationId,
            metadata: {
                messageId: msg.id,
                hasImages: msg.hasImages,
                fullPrompt: msg.fullPrompt,
                prismaMetadata: msg.metadata
            }
        }));
    }

    public async addImageMetadata(imageData: any): Promise<void> {
        await prisma.messageImage.create({
            data: imageData
        });
    }

    public async getMessageWithImages(messageId: string): Promise<any> {
        const message = await prisma.message.findUnique({
            where: {
                id: messageId
            },
            include: {
                images: true
            }
        });

        if (!message) {
            throw new Error('Message not found');
        }

        return {
            id: message.id,
            role: message.role,
            content: message.content,
            timestamp: message.createdAt.getTime(),
            conversationId: message.conversationId,
            hasImages: message.hasImages,
            images: message.images.map(img => ({
                id: img.id,
                imageUrl: img.imageUrl,
                imageType: img.imageType,
                mimeType: img.mimeType,
                size: img.size,
                metadata: img.metadata
            })),
            metadata: {
                messageId: message.id,
                fullPrompt: message.fullPrompt,
                prismaMetadata: message.metadata
            }
        };
    }

    public async updateMessageWithChunkIds(messageId: string, chunkIds: string[]): Promise<void> {
        try {
            // Get the current message to preserve existing metadata
            const currentMessage = await prisma.message.findUnique({
                where: { id: messageId }
            });

            if (!currentMessage) {
                throw new Error(`Message with ID ${messageId} not found`);
            }

            // Update the metadata to include chunk information
            const currentMetadata = currentMessage.metadata as any;
            const updatedMetadata = {
                ...currentMetadata,
                metadata: {
                    ...currentMetadata.metadata,
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

            logger.info(`✅ Updated message ${messageId} with ${chunkIds.length} chunk IDs`);
        } catch (error) {
            logger.warn('Failed to update message metadata with chunk IDs:', error);
            // Continue even if metadata update fails
        }
    }
}

export const chatRepository = new ChatRepository();


// Other routes can be added here as needed
// For example:
// this.server.post("/api/chat/send", async (ctx) => {
//     const body = ctx.body as { query: string };
//     const messages = await this.chatService.sendMessage(body.query);
//     return {
//         message: "Message sent successfully",