// OPERATION #2 

import { Document } from "@langchain/core/documents";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { chat } from "@pinecone-database/pinecone/dist/assistant/data/chat";
import { v4 as uuidv4 } from 'uuid';
import { UserConfig } from "../config";
import { chatHistoryVectorStore } from "../lib/Pinecone";
import { prisma } from "../lib/Prisma";
import { IPineconeChunkMetadata, MessageRole, PineconeChunkMetadataSchema } from "../types/pinecone.types";
import { chunkTextDocs } from "../utils/chunking";
import { DbMessage } from "./reset-kagami-memory";

const systemPrompt = `
Analisis percakapan di atas dan identifikasi fakta-fakta penting dan persisten.
Pisahkan fakta tentang pengguna (figo) dan fakta tentang AI ini sendiri (Kagami.AI).
Untuk setiap fakta, berikan KATEGORI yang paling sesuai dari daftar berikut:
[Daftar Kategori di Sini, Contoh:]
- PERSONAL_HABITS
- PERSONAL_INTERESTS
- PROFESSIONAL_SKILLS
- PROJECTS
- PERSONAL_PREFERENCES
- AI_IDENTITY
- AI_BEHAVIOR
- DAILY_ROUTINE
- GOALS_ASPIRATIONS
- RELATIONSHIPS
- HEALTH_WELLBEING
- MISCELLANEOUS

Outputkan dalam format JSON berikut. Jika tidak ada fakta yang ditemukan, array bisa kosong.

{
  "extracted_facts": [
    {"fact": "Figo sering begadang.", "category": "PERSONAL_HABITS", "related_message_id": "uuid-pesan-terkait"},
    {"fact": "Backend Kagami.AI menggunakan framework ElysiaJS.", "category": "AI_IDENTITY", "related_message_id": "uuid-pesan-terkait"}
  ]
}

Jika tidak ada fakta yang jelas, array bisa kosong.

{}

`

export const llm = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash",
    temperature: 0,
    maxRetries: 1,
});

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


const startOperationTwo = async () => {
    const chatHistory = await getChatHistory();
    if (chatHistory.length === 0) {
        console.log("Tidak ada riwayat chat untuk diproses.");
        return;
    }

    const BATCH_SIZE = 70;
    let chatBatches: any[] = [];

    for (const msgDb of chatHistory) {

        if (chatBatches.length === 0 || chatBatches[chatBatches.length - 1].length >= BATCH_SIZE) {
            chatBatches.push([]);


            chatBatches = []
        }
    }

}


(async () => {
    try {
        await startOperationTwo();
    } catch (error) {
        console.error("Error during operation:", error);
    }
})();