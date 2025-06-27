// OPERATION : RESET KAGAMI MEMORY
// 1. Get all chat history from the database
// 2. Delete all existing chat history from the vector store
// 3. chunk the chat history into smaller parts
// 4. upsert the chunks into the vector 

import { Document } from "@langchain/core/documents";
import { v4 as uuidv4 } from 'uuid';
import { UserConfig } from "../config";
import { chatHistoryVectorStore } from "../lib/Pinecone";
import { prisma } from "../lib/Prisma";
import { IPineconeChunkMetadata, MessageRole, PineconeChunkMetadataSchema } from "../types/pinecone.types";
import { chunkTextDocs } from "../utils/chunking";



export interface DbMessage {
    id: string;
    conversationId: string;
    role: string;
    content: string;
    createdAt: Date;
    updatedAt: Date;
    metadata: Record<string, any> | null;
}



const getChatHistory = async (): Promise<DbMessage[]> => {
    return await prisma.message.findMany({
        where: {
            conversationId: UserConfig.conersationId
        },
        orderBy: {
            createdAt: 'asc',
        },
    }) as DbMessage[];
}

const chuckChatHistory = async (chatHistory: DbMessage[], chunkSize: number = 800, chunkOverlap: number = 100) => {
    const allChunksForPinecone: Document[] = [];
    const MIN_CHUNK_LENGTH_THRESHOLD = 150;

    for (const msgDb of chatHistory) {
        const content = msgDb.content;
        const baseMetadata = {
            conversationId: msgDb.conversationId || UserConfig.conersationId,
            userId: UserConfig.id,
            timestamp: msgDb.createdAt?.getTime() || Date.now(),
            role: msgDb.role as MessageRole,
            messageId: msgDb.id
        }

        if (content.length < MIN_CHUNK_LENGTH_THRESHOLD) {
            const metadata: IPineconeChunkMetadata = {
                ...baseMetadata,
                id: msgDb.id,
                chunkIndex: 0,
            }

            const validatedMetadata = PineconeChunkMetadataSchema.parse(metadata);

            const docs = new Document({
                id: msgDb.id,
                pageContent: content,
                metadata: validatedMetadata
            });

            allChunksForPinecone.push(docs);
            continue;
        }




        const fulldocs: Document = new Document({
            id: msgDb.id,
            pageContent: content,
            metadata: baseMetadata
        });

        const chunks: Document[] = await chunkTextDocs(fulldocs, {
            chunkSize: chunkSize,
            chunkOverlap: chunkOverlap
        });

        for (const [chunkIndex, chunk] of chunks.entries()) {
            const chunkId = uuidv4();
            const chunkMetadata: IPineconeChunkMetadata = {
                ...baseMetadata,
                id: chunkId,
                chunkIndex: chunkIndex,
            };

            const validatedChunkMetadata = PineconeChunkMetadataSchema.parse(chunkMetadata);

            const chunkDoc = new Document({
                id: chunkId,
                pageContent: chunk.pageContent,
                metadata: validatedChunkMetadata
            });

            allChunksForPinecone.push(chunkDoc);
        }
    }
    return allChunksForPinecone;
}

const startOperation = async () => {
    console.log("[1]Fetching chat history from the database...");
    const chatHistory = await getChatHistory();

    console.log(`[2]Found ${chatHistory.length} messages in the chat history.`);

    if (chatHistory.length === 0) {
        console.log("No chat history found. Nothing to reset.");
        return;
    }

    console.log("[3] Deleting all existing chat history from Pinecone...");
    await nukeChatHistoryPineconeMemory();


    console.log("[4]Chunking chat history into smaller parts...");
    const allChunksForPinecone = await chuckChatHistory(chatHistory);

    console.log(`[5]Total chunks created: ${allChunksForPinecone.length}`);
    if (allChunksForPinecone.length === 0) {
        console.log("No chunks created. Nothing to upsert.");
        return;
    }

    console.log("[6]Re-upserting chat history to Pinecone...");
    await reUpsertChatHistoryToPinecone(allChunksForPinecone);

    console.log("[7]Reset operation completed successfully.");
    console.log(`Total messages processed: ${chatHistory.length}`);
}

const nukeChatHistoryPineconeMemory = async () => {
    console.log("Deleting all existing chat history from Pinecone...");
    chatHistoryVectorStore.deleteAll();
    console.log("All existing chat history deleted from Pinecone.");
}

const reUpsertChatHistoryToPinecone = async (allChunksForPinecone: Document[]) => {
    console.log("Re-upserting chat history to Pinecone...");
    await chatHistoryVectorStore.addDocuments(allChunksForPinecone);
    console.log("Chat history re-upserted to Pinecone successfully.");
}

(async () => {
    try {
        console.log("Starting reset operation...");
        // await startOperation();
        console.log("Reset operation completed successfully.");
    } catch (error) {
        console.error("Error during reset operation:", error);
    } finally {
        await prisma.$disconnect();
    }
})();