import { Document } from "@langchain/core/documents";
import { v4 as uuidv4 } from 'uuid';
import { id } from "zod/v4/locales";
import { config, createSystemPromot, UserConfig } from "../../config";
import { llm } from "../../lib/LLMClient";
import { chatHistoryVectorStore, userProfileVectorStore } from "../../lib/Pinecone";
import { prisma } from "../../lib/Prisma";
import { IMessageQueue } from "../../lib/RabbitMQ";
import { chunkText } from "../../utils/chunking";
import { getCurrentDateTimeInfo } from "../../utils/date";
import { FirebaseStorageService } from "../../utils/firebaseStorage";
import { analyzeMultipleImages, createImageDescription, extractImageMetadata, validateImagesForStorage } from "../../utils/imageUtils";
import { logger } from "../../utils/logger";
import { chatRepository } from "./chat.repository";

interface MessageInput {
    text: string;
    images?: string[]; // Array of base64 encoded images or image URLs
}

interface ProcessedMessageInput {
    text: string;
    imageUrls?: string[]; // Array of Firebase Storage URLs
    originalImages?: string[]; // Original input (for reference)
    base64Images?: string[]; // Base64 images for LLM processing
    imageDescriptions?: string[]; // AI-generated descriptions of images
}

export interface IChatService {
    addMessage(input: string | MessageInput): Promise<unknown>;
    getMessages(): string[];
    clearMessages(): void;
    getMessageCount(): number;
    getLatestMessage(): Promise<string>;
}

export class ChatService implements IChatService {
    private messages: string[] = [];
    private firebaseStorage: FirebaseStorageService;

    constructor(
        private messageQueue: IMessageQueue
    ) {
        this.firebaseStorage = new FirebaseStorageService();
    }

    public isQueueHealthy(): boolean {
        return this.messageQueue.isHealthy();
    }

    public async addMessage(input: string | MessageInput) {
        // Normalize input
        const messageData: MessageInput = typeof input === 'string' 
            ? { text: input, images: [] } 
            : input;
        
        const { text: message, images } = messageData;
        const userMessageId = uuidv4();

        // Validate input
        if (!message || message.trim().length === 0) {
            throw new Error('Message text cannot be empty');
        }

        // Process images: upload to Firebase Storage and get URLs
        let processedData: ProcessedMessageInput & { base64Images: string[]; imageDescriptions?: string[] } = { text: message, base64Images: [] };
        
        if (images && images.length > 0) {
            logger.info(`Processing ${images.length} image(s) for message`);
            
            // Validate images first
            if (!this.validateImages(images)) {
                throw new Error('Invalid image format. Images must be base64 strings, data URLs, or HTTP URLs');
            }
            if (!validateImagesForStorage(images)) {
                throw new Error('Images exceed size limit or contain unsupported formats');
            }

            try {
                processedData = await this.processImagesForStorage(messageData);
                logger.info(`Successfully uploaded ${processedData.imageUrls?.length || 0} image(s) to Firebase Storage`);
                logger.info(`Generated ${processedData.imageDescriptions?.length || 0} image description(s)`);
            } catch (error) {
                logger.error('Failed to upload images to Firebase Storage:', error);
                throw new Error(`Image upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }


        logger.info(`1 Checking if user conversation exists for user ID: ${UserConfig.id} and conversation ID: ${UserConfig.conversationId}`);
        await checkIfUserConversationExists(UserConfig.id, UserConfig.conversationId);

        logger.info(`2 Checking if user message is a duplicate for message ID: ${userMessageId}`);
        const existingMessage = await checkIfUserMessageDuplicate(userMessageId)

        // const userFacts = await userProfileVectorStore.search(message);
        // const userProfileContext = userFacts.map((doc: Document) => doc.metadata.originalText).join('\n');

        logger.info(`3 Getting relevant chat history for message: ${message}`);
        const chatHistoryContext = await getRelevantChatHistory(message);
        logger.info(`3.1 Success getting relevant chat history context for message: ${chatHistoryContext.length} characters retrieved`);

        logger.info(`3.2 Getting recent chat history from database for user ID: ${UserConfig.id}`);
        const recentChatContextData = await getRecentChatHistory(UserConfig.id);
        logger.info(`3.3 Success getting recent chat context data: ${recentChatContextData.length} messages retrieved`);

        logger.info(`4 Creating system prompt with chat history context, current date/time info, and recent chat context data`);
        const systemPromptVersion = config.systemPrompt.version as keyof typeof createSystemPromot;
        const rawSystemPrompt = createSystemPromot[systemPromptVersion](
            chatHistoryContext,
            getCurrentDateTimeInfo(),
            recentChatContextData
        );
        
        // Clean system prompt to reduce token usage
        const systemPrompt = cleanSystemPrompt(rawSystemPrompt);
        
        const originalTokens = estimateTokens(rawSystemPrompt);
        const cleanedTokens = estimateTokens(systemPrompt);
        const tokenSavings = originalTokens - cleanedTokens;
        
        logger.info(`4.1 System prompt optimized - chars: ${rawSystemPrompt.length}→${systemPrompt.length}, tokens: ${originalTokens}→${cleanedTokens} (saved: ${tokenSavings})`);

        const fullPrompt = `${systemPrompt}\n\nfigo: ${message}\nKamu:`;

        logger.info(`5 Calling LLM with message: ${message}${processedData.base64Images && processedData.base64Images.length > 0 ? ` and ${processedData.base64Images.length} image(s)` : ''}`);
        const { aiResponse, aiMessageCreatedAt } = await callLLM(message, systemPrompt, processedData.base64Images)

        const aiMessageId = uuidv4();
        const userMessageCreatedAt = Date.now();

        const queueMessagePayload = {
            user: {
                id: UserConfig.id,
                conversationId: UserConfig.conversationId,
                userMessageId,
                userMessageCreatedAt,
                message,
                images: processedData.imageUrls || [],
                imageDescriptions: processedData.imageDescriptions || []
            },
            ai: {
                aiMessageId,
                aiMessageCreatedAt,
                aiResponse,
            }
        }

        await this.messageQueue.sendToQueue('kagami.chat_memory.process', queueMessagePayload);

        logger.info(`6 Preparing to save chat message with IDs: userMessageId=${userMessageId}, aiMessageId=${aiMessageId}`);
        // Save message to database with image URLs (not base64)
        await saveChatMessage({
            user: {
                id: UserConfig.id,
                conversationId: UserConfig.conversationId,
                userMessageId,
                userMessageCreatedAt,
                message,
                images: processedData.imageUrls || [],
                imageDescriptions: processedData.imageDescriptions || []
            },
            ai: {
                aiMessageId,
                aiMessageCreatedAt,
                aiResponse,
                systemPrompt
            }
        });

        logger.info(`7 Upserting user message to chat history vector store with ID: ${userMessageId}`);
        if (!existingMessage) {
            logger.info('User message already exists in chat history, skipping upsert:', existingMessage);

            try {
                // Create enhanced page content for better semantic search
                // Use URLs for metadata, not base64 data
                const imageUrls = processedData.imageUrls || [];
                const imageDescriptions = processedData.imageDescriptions || [];
                
                const imageMetadata = imageUrls.length > 0 ? 
                    imageUrls.map((url, idx) => ({
                        index: idx,
                        type: 'url' as const,
                        mimeType: 'image/jpeg', // Default, could be enhanced later
                        description: imageDescriptions[idx] || `Firebase Storage image ${idx + 1}`,
                        url: url
                    })) : [];
                
                // Create enhanced page content that includes image descriptions for better search
                let enhancedPageContent = message;
                if (imageUrls.length > 0 && imageDescriptions.length > 0) {
                    const imageDescText = imageDescriptions.map((desc, idx) => 
                        `Gambar ${idx + 1}: ${desc}`
                    ).join('; ');
                    enhancedPageContent = `${message} [Berisi ${imageUrls.length} gambar: ${imageDescText}]`;
                } else if (imageUrls.length > 0) {
                    enhancedPageContent = createImageDescription(message, imageUrls.length, imageMetadata);
                }

                // 1. Add user input to chat history with image URLs and descriptions
                const userInputDocs = new Document({
                    pageContent: enhancedPageContent,
                    metadata: {
                        id: userMessageId,
                        conversationId: UserConfig.conversationId, // Fixed typo
                        userId: UserConfig.id,
                        timestamp: userMessageCreatedAt,
                        role: 'user',
                        messageId: userMessageId,
                        chunkIndex: 0,
                        hasImages: (imageUrls.length > 0),
                        imageCount: imageUrls.length,
                        originalText: message, // Keep original text separate
                        // Store image URLs, descriptions, and metadata
                        imageUrls: imageUrls,
                        imageDescriptions: imageDescriptions,
                        imageMetadata: imageMetadata
                    }
                });

                await chatHistoryVectorStore.upsert(userInputDocs);
            } catch (error) {
                logger.error('Error saat menyimpan pesan user ke chat history:', error);
                throw new Error('Gagal menyimpan pesan user ke chat history');
            }
        }

        // chunking aiResponse if it is too long
        const chunkSize = 800;
        const chunkOverlap = 100;

        logger.info(`8 Chunking AI response with chunk size: ${chunkSize} and chunk overlap: ${chunkOverlap}`);
        const chunks: Document[] = await chunkText(aiResponse as string, {
            chunkSize: chunkSize,
            chunkOverlap: chunkOverlap
        });

        const docsToUpsert = chunks.map((chunk, index) => {
            const chunkDocsId = uuidv4();

            return new Document({
                id: chunkDocsId,
                pageContent: chunk.pageContent,
                metadata: {
                    id: chunkDocsId,
                    conversationId: UserConfig.conversationId, // Fixed typo
                    userId: UserConfig.id,
                    timestamp: aiMessageCreatedAt,
                    chunkIndex: index,
                    originalText: chunk.pageContent,
                    role: 'assistant',
                    messageId: aiMessageId
                }
            })
        });

        logger.info(`9 Upserting AI response chunks to chat history vector store with IDs: ${docsToUpsert.map(doc => doc.metadata.id).join(', ')}`);
        await chatHistoryVectorStore.addDocuments(docsToUpsert);



        return { aiResponse, fullPrompt };
    }

    public async search(query: string) {
        if (!query || typeof query !== 'string') {
            throw new Error("Invalid query format. Please provide a valid string.");
        }

        const filterOptions = {
            conversationId: UserConfig.conversationId,
        }

        const results = await chatHistoryVectorStore.search(query, 10, filterOptions);
        return results.map((doc: Document) => ({
            role: doc.metadata.role,
            content: doc.pageContent,
            timestamp: new Date(doc.metadata.timestamp).toLocaleTimeString(),
        }));
    }

    /**
     * Get message with images
     */
    public async getMessageWithImages(messageId: string) {
        const message = await prisma.message.findUnique({
            where: { id: messageId },
            include: {
                images: true
            }
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
     * Search messages with image support
     */
    public async searchWithImageContext(query: string) {
        if (!query || typeof query !== 'string') {
            throw new Error("Invalid query format. Please provide a valid string.");
        }

        const filterOptions = {
            conversationId: UserConfig.conversationId,
        }

        const results = await chatHistoryVectorStore.search(query, 10, filterOptions);
        
        // Get full message details including images for messages that have them
        const enhancedResults = await Promise.all(
            results.map(async (doc: Document) => {
                const baseResult = {
                    role: doc.metadata.role,
                    content: doc.metadata.originalText || doc.pageContent,
                    timestamp: new Date(doc.metadata.timestamp).toLocaleTimeString(),
                    hasImages: doc.metadata.hasImages || false,
                    imageCount: doc.metadata.imageCount || 0
                };

                // If message has images, fetch them from database
                if (doc.metadata.hasImages && doc.metadata.messageId) {
                    try {
                        const messageWithImages = await this.getMessageWithImages(doc.metadata.messageId);
                        return {
                            ...baseResult,
                            images: messageWithImages.images
                        };
                    } catch (error) {
                        logger.warn(`Failed to fetch images for message ${doc.metadata.messageId}:`, error);
                        return baseResult;
                    }
                }

                return baseResult;
            })
        );

        return enhancedResults;
    }

    public getMessages(): string[] {
        return this.messages;
    }

    public clearMessages(): void {
        this.messages = [];
    }

    public getMessageCount(): number {
        return this.messages.length;
    }

    public async getLatestMessage(): Promise<string> {
        const latestMessage = await chatRepository.getLatestMessage();

        if (latestMessage === null) {
            logger.warn('No messages found in the database');
            return 'No messages found';
        } else {
            return latestMessage;
        }
    }

    /**
     * Process images for storage: upload base64 images to Firebase Storage and return URLs
     * Also keeps original base64 for LLM processing and generates descriptions
     */
    private async processImagesForStorage(messageData: MessageInput): Promise<ProcessedMessageInput & { base64Images: string[]; imageDescriptions?: string[] }> {
        const { text, images } = messageData;
        
        if (!images || images.length === 0) {
            return { text, base64Images: [] };
        }

        const imageUrls: string[] = [];
        const base64Images: string[] = [];
        const urlImages: string[] = [];
        const base64ForLLM: string[] = []; // Keep base64 for LLM processing
        let imageDescriptions: string[] = [];

        // Separate base64 images from URLs
        for (const image of images) {
            if (image.startsWith('http://') || image.startsWith('https://')) {
                // Already a URL, use as-is
                urlImages.push(image);
                imageUrls.push(image);
                // Note: For URLs, we can't convert to base64 easily, so skip LLM processing
                logger.warn(`URL image detected: ${image.substring(0, 50)}... - may not work with LLM`);
            } else if (image.startsWith('data:image/') || this.isBase64String(image)) {
                // Base64 image, needs to be uploaded
                base64Images.push(image);
                base64ForLLM.push(image); // Keep original base64 for LLM
            } else {
                throw new Error(`Invalid image format: ${image.substring(0, 50)}...`);
            }
        }

        // Analyze image content for better descriptions
        if (base64ForLLM.length > 0) {
            try {
                logger.info(`Analyzing ${base64ForLLM.length} image(s) for content description...`);
                imageDescriptions = await analyzeMultipleImages(base64ForLLM, text);
                logger.info(`Successfully analyzed ${imageDescriptions.length} image(s)`);
            } catch (error) {
                logger.error('Error analyzing images:', error);
                // Continue without descriptions
                imageDescriptions = base64ForLLM.map((_, index) => `Gambar ${index + 1}`);
            }
        }

        // Upload base64 images to Firebase Storage
        if (base64Images.length > 0) {
            try {
                const uploadResults = await this.firebaseStorage.uploadMultipleBase64Images(
                    base64Images, 
                    'chat-images'
                );
                
                const uploadedUrls = uploadResults.map(result => result.url);
                imageUrls.push(...uploadedUrls);
                
                logger.info(`Successfully uploaded ${base64Images.length} images to Firebase Storage`);
            } catch (error) {
                logger.error('Error uploading images to Firebase:', error);
                throw new Error(`Failed to upload images: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }

        return {
            text,
            imageUrls,
            originalImages: images,
            base64Images: base64ForLLM,
            imageDescriptions
        };
    }

    /**
     * Helper method to add a text-only message (backward compatibility)
     */
    public async addTextMessage(message: string) {
        return this.addMessage(message);
    }

    /**
     * Helper method to add a message with images
     */
    public async addMessageWithImages(text: string, images: string[]) {
        return this.addMessage({ text, images });
    }

    /**
     * Helper method to validate image format
     */
    private validateImages(images: string[]): boolean {
        return images.every(image => 
            image.startsWith('data:image/') || 
            image.startsWith('http') || 
            this.isBase64String(image)
        );
    }

    /**
     * Helper method to check if string is base64
     */
    private isBase64String(str: string): boolean {
        try {
            return btoa(atob(str)) === str;
        } catch (err) {
            return false;
        }
    }
}


/**
 * Estimate token count for text (rough approximation)
 */
const estimateTokens = (text: string): number => {
    // Rough estimation: ~1.3 tokens per word for Indonesian text
    const words = text.split(/\s+/).length;
    const chars = text.length;
    
    // More accurate estimation considering Indonesian + technical terms
    return Math.ceil(words * 1.4 + chars * 0.1);
};

/**
 * Clean system prompt to reduce unnecessary whitespace and tokens
 */
const cleanSystemPrompt = (prompt: string): string => {
    return prompt
        // Remove multiple consecutive spaces
        .replace(/[ ]{2,}/g, ' ')
        // Remove multiple consecutive newlines (keep max 2 for readability)
        .replace(/\n{3,}/g, '\n\n')
        // Remove trailing whitespace from lines
        .replace(/[ \t]+$/gm, '')
        // Remove leading whitespace from lines (except intentional indentation)
        .replace(/^\s+/gm, '')
        // Trim overall string
        .trim();
};

const getRecentChatHistory = async (userId: string): Promise<string[]> => {

    try {
        const userWithMessages = await prisma.user.findUnique({
            where: {
                id: userId
            },
            include: {
                Conversation: {
                    where: {
                        id: UserConfig.conversationId, // pastikan hanya mengambil percakapan yang relevan
                    },
                    include: {
                        messages: {
                            orderBy: {
                                createdAt: 'desc',
                            },
                            take: 5, // ambil 5 pesan terakhir
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
                
                // Clean content to remove unnecessary whitespace and newlines
                const cleanContent = msg.content.replace(/\s+/g, ' ').trim();
                
                return `[${msg.role}] (${formattedDate} ${formattedTime}): ${cleanContent}`;
            })
            .reverse() || [];

    }
    catch (error) {
        logger.error(`Error getting recent chat history for user ${userId}:`, error);
        throw new Error('Failed to retrieve recent chat history');
    }
}


const getRelevantChatHistory = async (query: string): Promise<string> => {

    const filter = {
        conversationId: UserConfig.conversationId,
    }

    logger.info('🔍 Chat History Filter Debug:', {
        query: query.substring(0, 100),
        filter,
        userConfigConversationId: UserConfig.conversationId
    });

    try {

        const relevantChat = await chatHistoryVectorStore.search(query, 10, filter);

        logger.info('🔍 Chat History Search Results:', {
            count: relevantChat.length,
            sampleConversationIds: relevantChat.slice(0, 3).map((doc: Document) => doc.metadata?.conversationId || 'No conversationId'),
            sampleRoles: relevantChat.slice(0, 3).map((doc: Document) => doc.metadata?.role || 'No role')
        });

        const chatHistoryContext = relevantChat
            .filter((doc: Document) => doc.pageContent && doc.pageContent.trim().length > 0)
            .map((doc: Document) => {
                const role = doc.metadata?.role || 'unknown';
                const timestamp = doc.metadata?.timestamp || Date.now();
                const originalText = doc.pageContent;

                const dateObj = new Date(timestamp);

                const formattedDate = dateObj.toLocaleDateString('id-ID', {
                    year: 'numeric',
                    month: 'numeric', // e.g., 6
                    day: 'numeric',   // e.g., 27
                    // timeZone: 'Asia/Jakarta'
                }); // Output: "27/6/2025" atau "27/06/2025"

                const formattedTime = dateObj.toLocaleTimeString('id-ID', {
                    hour: '2-digit',
                    minute: '2-digit',
                    // second: '2-digit', // Opsional
                    hour12: false, // Untuk format 24 jam
                    // timeZone: 'Asia/Jakarta'
                }); // Output: "00.49.18"

                // Clean content to remove unnecessary whitespace and newlines
                const cleanText = originalText.replace(/\s+/g, ' ').trim();

                // Gabungkan sesuai format yang kamu mau
                return `[${role}] (${formattedDate} ${formattedTime}): ${cleanText}`; // Output: [user] (27/6/2025 00.49.18):
            })
            .reverse()
            .join('\n');

        logger.info('🔍 Final Chat History Context length:', chatHistoryContext.length);

        return chatHistoryContext;
    } catch (error) {
        logger.error(`Error getting relevant chat history for query "${query}":`, error);
        throw new Error('Failed to retrieve relevant chat history');
    }

}


const checkIfUserConversationExists = async (userId: string, conversationId: string): Promise<void> => {
    const userConversation = await prisma.conversation.findFirst({
        where: {
            userId: userId,
            id: conversationId
        }
    });

    if (!userConversation) {
        logger.info(`Conversation with ID ${conversationId} does not exist for user ${userId}, creating a new one.`);
        await prisma.conversation.create({
            data: {
                id: conversationId,
                userId: userId,
                title: 'FIGOMAGER Default Conversation',
            }
        });

        logger.info(`Conversation with ID ${conversationId} created for user ${userId}`);
    }

    logger.info(`Conversation with ID ${conversationId} already exists for user ${userId}`);
    return;
}


const callLLM = async (
    message: string, 
    systemPrompt: string, 
    images?: string[]
): Promise<{ aiResponse: string; aiMessageCreatedAt: number }> => {

    let aiResponse: string;
    let aiMessageCreatedAt: number | null = null;

    try {
        // Prepare the human message content
        let humanContent: any = message;
        
        // If images are provided, format the message for multimodal input
        if (images && images.length > 0) {
            humanContent = [
                {
                    type: "text",
                    text: message
                },
                ...images.map(image => ({
                    type: "image_url",
                    image_url: {
                        // Google GenAI expects base64 data URLs
                        // All images should be base64 at this point
                        url: image.startsWith('data:') ? image : 
                             `data:image/jpeg;base64,${image}`
                    }
                }))
            ];
        }

        const result = await llm.invoke([
            ['system', systemPrompt],
            ['human', humanContent]
        ]);
        
        aiResponse = result.content as string
        aiMessageCreatedAt = Date.now();

        return { aiResponse, aiMessageCreatedAt }
    } catch (error) {
        logger.error('Error saat berinteraksi dengan LLM:', error);
        throw new Error('Gagal mendapatkan respons dari AI');
    }
}


const checkIfUserMessageDuplicate = async (userMessageId: string) => {
    const existingMessage = await prisma.message.findFirst({
        where: {
            id: userMessageId,
            conversationId: UserConfig.conversationId,
            role: 'user',
        }
    });

    return existingMessage
}


interface ISaveChatArgs {
    user: {
        id: string;
        conversationId: string;
        userMessageId: string;
        userMessageCreatedAt: number;
        message: string;
        images?: string[];
        imageDescriptions?: string[];
    },
    ai: {
        aiMessageId: string;
        aiMessageCreatedAt: number;
        aiResponse: string;
        systemPrompt: string;
    }
}


const saveChatMessage = async (args: ISaveChatArgs) => {
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
                            conversationId: UserConfig.conversationId, // Fixed typo
                            userId: UserConfig.id,
                            timestamp: userMessageCreatedAt,
                            role: 'user',
                            chunkIndex: 0,
                            imageCount: images?.length || 0,
                            imageDescriptions: imageDescriptions || []
                        },
                        pageContent: message as string
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
                        id: uuidv4(),
                        messageId: userMessageId,
                        imageUrl: image,
                        imageType,
                        mimeType,
                        size: image.length, // Approximate size
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
                    content: aiResponse as string,
                    role: 'assistant',
                    fullPrompt: systemPrompt,
                    hasImages: false,
                    metadata: {
                        id: aiMessageId,
                        metadata: {
                            id: aiMessageId,
                            conversationId: UserConfig.conversationId, // Fixed typo
                            userId: UserConfig.id,
                            timestamp: aiMessageCreatedAt,
                            role: 'assistant',
                            respondedToImages: (images && images.length > 0),
                            respondedToImageDescriptions: imageDescriptions || []
                        },
                        pageContent: aiResponse as string
                    }
                }
            });
        });

    } catch (error) {
        logger.error('Error saat menyimpan pesan ke database:', error);
        throw new Error('Gagal menyimpan pesan ke database');
    }
}

