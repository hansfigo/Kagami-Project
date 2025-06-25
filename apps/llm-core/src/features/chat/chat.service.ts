import { Document } from "@langchain/core/documents";
import { v4 as uuidv4 } from 'uuid';
import { createSystemPromot, UserConfig } from "../../config";
import { llm } from "../../lib/LLMClient";
import { chatHistoryVectorStore, userProfileVectorStore } from "../../lib/Pinecone";
import { prisma } from "../../lib/Prisma";
import { IMessageQueue } from "../../lib/RabbitMQ";
import { chunkText } from "../../utils/chunking";
import { getCurrentDateTimeInfo } from "../../utils/date";

export interface IChatService {
    addMessage(message: string): Promise<unknown>;
    getMessages(): string[];
    clearMessages(): void;
    getMessageCount(): number;
}

export class ChatService implements IChatService {
    private messages: string[] = [];

    constructor(
        private messageQueue: IMessageQueue
    ) { }

    public async addMessage(message: string) {
        const userMessageId = uuidv4();

        // check if user have default conversation
        const userConversation = await prisma.conversation.findFirst({
            where: {
                userId: UserConfig.id,
            }
        });

        if (!userConversation) {
            await prisma.conversation.create({
                data: {
                    id: UserConfig.conersationId,
                    userId: UserConfig.id,
                    title: 'FIGOMAGER Default Conversation',
                }
            });
        }


        //check if userMessageId already exists in chat history
        const existingMessage = await prisma.message.findFirst({
            where: {
                id: userMessageId,
                conversationId: UserConfig.conersationId,
                role: 'user',
            }
        });

        console.log(existingMessage, 'Existing message in chat history:', userMessageId);

        const userMessageCreatedAt = Date.now();

        // 1. Simpan ke Database SQL (Source of Truth)
        await prisma.message.create({
            data: {
                id: userMessageId,
                conversationId: UserConfig.conersationId,
                content: message,
                role: 'user',
                metadata: {
                    id: userMessageId,
                    metadata: {
                        id: userMessageId,
                        coversationId: UserConfig.conersationId,
                        userId: UserConfig.id,
                        timestamp: userMessageCreatedAt,
                        originalText: message as string,
                        role: 'assistant'
                    },
                    pageContent: message as string
                }
            }
        });

        if (!existingMessage) {
            console.log(existingMessage, 'User message already exists in chat history, skipping upsert');

            try {
                // 1. Tambahkan input user ke chat history
                const userInputDocs = new Document({
                    pageContent: message,
                    metadata: {
                        id: userMessageId,
                        coversationId: UserConfig.conersationId,
                        userId: UserConfig.id,
                        timestamp: userMessageCreatedAt,
                        originalText: message as string,
                        role: 'user',
                        messageId: userMessageId
                    }
                });

                await chatHistoryVectorStore.upsert(userInputDocs);
            } catch (error) {
                console.error('Error saat menyimpan pesan user ke chat history:', error);
                throw new Error('Gagal menyimpan pesan user ke chat history');
            }
        }



        console.log('Pesan user berhasil disimpan ke chat history:', message);

        // 2. Ambil fakta profil relevan tentang user
        const userFacts = await userProfileVectorStore.search(message);
        const userProfileContext = userFacts.map((doc: Document) => doc.metadata.originalText).join('\n');

        // 3. Ambil riwayat chat relevan (misal 5 menit terakhir dari user saja)
        const relevantChat = await chatHistoryVectorStore.search(message);

        const chatHistoryContext = relevantChat
            .map((doc: Document) => `[${doc.metadata.role}] (${new Date(doc.metadata.timestamp).toLocaleTimeString()}): ${doc.metadata.originalText}`)
            .reverse()
            .join('\n');

        // get chat history context with timestamp
        const userWithMessages = await prisma.user.findUnique({
            where: {
                id: UserConfig.id,
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

        const recentChatContextData = userWithMessages?.Conversation
            .flatMap((conversation) => conversation.messages)
            .map((msg) => `[${msg.role}] (${new Date(msg.createdAt).toLocaleTimeString()}): ${msg.content}`)
            .reverse() || [];



        const systemPrompt = createSystemPromot.old(
            userProfileContext,
            chatHistoryContext,
            getCurrentDateTimeInfo(),
            recentChatContextData
        );

        const fullPrompt = `${systemPrompt}\n\nfigo: ${message}\nKamu:`;

        let aiResponse: unknown;
        let aiMessageCreatedAt: number | null = null;

        try {
            const result = await llm.invoke(fullPrompt);
            aiResponse = result.content
            aiMessageCreatedAt = Date.now();
        } catch (error) {
            console.error('Error saat berinteraksi dengan LLM:', error);
            throw new Error('Gagal mendapatkan respons dari AI');
        }


        //check if airesponse is already exists in chat history
        const existingResponse = await prisma.message.findFirst({
            where: {
                content: aiResponse as string,
                role: 'assistant',
                conversationId: UserConfig.conersationId,
            }
        });

        if (existingResponse) {
            console.log('AI response already exists in chat history, skipping upsert');
            return { aiResponse: existingResponse.content, fullPrompt };
        }

        const aiMessageId = uuidv4();

        // 7. Simpan respons AI ke Database SQL
        await prisma.message.create({
            data: {
                id: aiMessageId,
                conversationId: UserConfig.conersationId,
                content: aiResponse as string,
                role: 'assistant',
                metadata: {
                    id: aiMessageId,
                    metadata: {
                        id: aiMessageId,
                        coversationId: UserConfig.conersationId,
                        userId: UserConfig.id,
                        timestamp: aiMessageCreatedAt,
                        originalText: aiResponse as string,
                        role: 'assistant'
                    },
                    pageContent: aiResponse as string
                }
            }
        });


        // chunking aiResponse if it is too long
        const chunkSize = 800;
        const chunkOverlap = 50;

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
                    coversationId: UserConfig.conersationId,
                    userId: UserConfig.id,
                    timestamp: aiMessageCreatedAt,
                    chunkIndex: index,
                    originalText: chunk.pageContent,
                    role: 'assistant',
                    messageId: aiMessageId
                }
            })
        });



        // 6. Simpan respons AI ke chat history
        // await chatHistoryVectorStore.upsert({
        //     data: aiResponse as string,
        //     role: 'assistant',
        //     messageId: aiMessageId,
        //     coversationId: UserConfig.conersationId,
        //     userId: UserConfig.id
        // });

        await chatHistoryVectorStore.addDocuments(docsToUpsert);



        return { aiResponse, fullPrompt };
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
}