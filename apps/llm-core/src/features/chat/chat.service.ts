import { Document } from "@langchain/core/documents";
import { v4 as uuidv4 } from 'uuid';
import { createSystemPromot, UserConfig } from "../../config";
import { llm } from "../../lib/LLMClient";
import { chatHistoryVectorStore, userProfileVectorStore } from "../../lib/Pinecone";
import { prisma } from "../../lib/Prisma";
import { IMessageQueue } from "../../lib/RabbitMQ";
import { chunkText } from "../../utils/chunking";
import { getCurrentDateTimeInfo } from "../../utils/date";
import { logger } from "../../utils/logger";
import { chatRepository } from "./chat.repository";

export interface IChatService {
    addMessage(message: string): Promise<unknown>;
    getMessages(): string[];
    clearMessages(): void;
    getMessageCount(): number;
    getLatestMessage(): Promise<string>;
}

export class ChatService implements IChatService {
    private messages: string[] = [];

    constructor(
        private messageQueue: IMessageQueue
    ) { }

    public async addMessage(message: string) {
        const userMessageId = uuidv4();


        logger.info(`1 Checking if user conversation exists for user ID: ${UserConfig.id} and conversation ID: ${UserConfig.conversationId}`);
        await checkIfUserConversationExists(UserConfig.id, UserConfig.conversationId);

        logger.info(`2 Checking if user message is a duplicate for message ID: ${userMessageId}`);
        const existingMessage = await checkIfUserMessageDuplicate(userMessageId)

        // const userFacts = await userProfileVectorStore.search(message);
        // const userProfileContext = userFacts.map((doc: Document) => doc.metadata.originalText).join('\n');

        logger.info(`3 Getting relevant chat history context for message: ${message}`);
        const chatHistoryContext = await getRelevantChatHistory(message);
        const recentChatContextData = await getRecentChatHistory(UserConfig.id);


        logger.info(`4 Creating system prompt with chat history context, current date/time info, and recent chat context data`);
        const systemPrompt = createSystemPromot.old(
            chatHistoryContext,
            getCurrentDateTimeInfo(),
            recentChatContextData
        );

        const fullPrompt = `${systemPrompt}\n\nfigo: ${message}\nKamu:`;

        logger.info(`5 Calling LLM with message: ${message} and system prompt: ${systemPrompt}`);
        const { aiResponse, aiMessageCreatedAt } = await callLLM(message, systemPrompt)

        const aiMessageId = uuidv4();
        const userMessageCreatedAt = Date.now();

        logger.info(`6 Preparing to save chat message with IDs: userMessageId=${userMessageId}, aiMessageId=${aiMessageId}`);
        // Simpan pesan ke database
        await saveChatMessage({
            userMessageId,
            aiMessageId,
            userMessageCreatedAt,
            aiMessageCreatedAt,
            message,
            aiResponse,
            systemPrompt
        });

        logger.info(`7 Upserting user message to chat history vector store with ID: ${userMessageId}`);
        if (!existingMessage) {
            console.log(existingMessage, 'User message already exists in chat history, skipping upsert');

            try {
                // 1. Tambahkan input user ke chat history
                const userInputDocs = new Document({
                    pageContent: message,
                    metadata: {
                        id: userMessageId,
                        coversationId: UserConfig.conversationId,
                        userId: UserConfig.id,
                        timestamp: userMessageCreatedAt,
                        role: 'user',
                        messageId: userMessageId,
                        chunkIndex: 0,
                    }
                });

                await chatHistoryVectorStore.upsert(userInputDocs);
            } catch (error) {
                console.error('Error saat menyimpan pesan user ke chat history:', error);
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
                    coversationId: UserConfig.conversationId,
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

        const results = await chatHistoryVectorStore.search(query, 10);
        return results.map((doc: Document) => ({
            role: doc.metadata.role,
            content: doc.pageContent,
            timestamp: new Date(doc.metadata.timestamp).toLocaleTimeString(),
        }));
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
}


const getRecentChatHistory = async (userId: string): Promise<string[]> => {

    try {
        const userWithMessages = await prisma.user.findUnique({
            where: {
                id: userId
            },
            include: {
                Conversation: {
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
            .map((msg) => `[${msg.role}] (${new Date(msg.createdAt).toLocaleTimeString()}): ${msg.content}`)
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

    try {

        const relevantChat = await chatHistoryVectorStore.search(query, 10, filter);

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

                // Gabungkan sesuai format yang kamu mau
                return `[${role}] (${formattedDate} ${formattedTime}): ${originalText}`; // Output: [user] (27/6/2025 00.49.18):
            })
            .reverse()
            .join('\n');

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
}


const callLLM = async (message: string, systemPrompt: string): Promise<{ aiResponse: string; aiMessageCreatedAt: number }> => {

    let aiResponse: string;
    let aiMessageCreatedAt: number | null = null;


    try {
        const result = await llm.invoke(
            [['system', systemPrompt],
            ['human', message]]
        );
        aiResponse = result.content as string
        aiMessageCreatedAt = Date.now();

        return { aiResponse, aiMessageCreatedAt }
    } catch (error) {
        console.error('Error saat berinteraksi dengan LLM:', error);
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
    userMessageId: string;
    aiMessageId: string;
    userMessageCreatedAt: number;
    aiMessageCreatedAt: number;
    message: string;
    aiResponse: string;
    systemPrompt: string;
}


const saveChatMessage = async (args: ISaveChatArgs) => {
    const { userMessageId, aiMessageId, userMessageCreatedAt, aiMessageCreatedAt, message, aiResponse, systemPrompt } = args;
    try {


        await prisma.$transaction([
            prisma.message.create({
                data: {
                    id: userMessageId,
                    conversationId: UserConfig.conversationId,
                    content: message,
                    role: 'user',
                    metadata: {
                        id: userMessageId,
                        metadata: {
                            id: userMessageId,
                            coversationId: UserConfig.conversationId,
                            userId: UserConfig.id,
                            timestamp: userMessageCreatedAt,
                            role: 'assistant',
                            chunkIndex: 0,

                        },
                        pageContent: message as string
                    }
                }
            }),
            prisma.message.create({
                data: {
                    id: aiMessageId,
                    conversationId: UserConfig.conversationId,
                    content: aiResponse as string,
                    role: 'assistant',
                    fullPrompt: systemPrompt,
                    metadata: {
                        id: aiMessageId,
                        metadata: {
                            id: aiMessageId,
                            coversationId: UserConfig.conversationId,
                            userId: UserConfig.id,
                            timestamp: aiMessageCreatedAt,
                            role: 'assistant'
                        },
                        pageContent: aiResponse as string
                    }
                }
            })
        ])


    } catch (error) {
        console.error('Error saat menyimpan pesan ke database:', error);
        throw new Error('Gagal menyimpan pesan ke database');
    }
}

