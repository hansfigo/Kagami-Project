// OPERATION #2 

import { Document } from "@langchain/core/documents";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { chat } from "@pinecone-database/pinecone/dist/assistant/data/chat";
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { UserConfig } from "../config";
import { chatHistoryVectorStore } from "../lib/Pinecone";
import { prisma } from "../lib/Prisma";
import { IPineconeChunkMetadata, MessageRole, PineconeChunkMetadataSchema } from "../types/pinecone.types";
import { chunkTextDocs } from "../utils/chunking";
import { DbMessage } from "./reset-kagami-memory";

const createSystemMessage = (messageHistory: string) => {
    return `
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

PENTING: Outputkan HANYA dalam format JSON murni tanpa markdown code blocks. Jangan gunakan \`\`\`json atau \`\`\`.

Format JSON yang diinginkan:
{
  "extracted_facts": [
    {"fact": "Figo sering begadang.", "category": "PERSONAL_HABITS", "related_message_id": "uuid-pesan-terkait"},
    {"fact": "Backend Kagami.AI menggunakan framework ElysiaJS.", "category": "AI_IDENTITY", "related_message_id": "uuid-pesan-terkait"}
  ]
}

Jika tidak ada fakta yang jelas, kembalikan:
{"extracted_facts": []}

Message yang dianalisis:
${messageHistory}
`
}

export const llm = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-pro",
    temperature: 0,
    maxRetries: 1,
});

const getChatHistory = async (): Promise<DbMessage[]> => {
    return await prisma.message.findMany({
        where: {
            conversationId: UserConfig.conversationId
        },
        orderBy: {
            createdAt: 'asc',
        },
        take: 10,
    }) as DbMessage[];
}

const formatMessagesHistoryBeforeLLM = (batch: DbMessage[]) => {
    const combinedChatContent = batch.map(msg => {
        const timestampStr = (msg.createdAt as Date).toLocaleString('id-ID', {
            year: 'numeric', month: 'numeric', day: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        });
        return `[${msg.role}] (${timestampStr}) (ID: ${msg.id}): ${msg.content}`;
    }).join('\n\n---\n\n');

    return combinedChatContent
}

const cleanJsonResponse = (response: string): string => {
    // Remove markdown code blocks
    let cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    
    // Remove any leading/trailing whitespace
    cleaned = cleaned.trim();
    
    // If the response doesn't start with {, try to find the JSON part
    if (!cleaned.startsWith('{')) {
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            cleaned = jsonMatch[0];
        }
    }
    
    return cleaned;
}

const knowledgeExtraction = async (messageHistory: string) => {
    const systemMessage = createSystemMessage(messageHistory);
    const response = await llm.invoke([
        ['system', systemMessage],
        ['human', 'Tolong analisis percakapan ini dan ekstrak fakta-fakta penting.']
    ]);
    return response.content as string
}


const startOperationTwo = async () => {
    const chatHistory = await getChatHistory();
    if (chatHistory.length === 0) {
        console.log("Tidak ada riwayat chat untuk diproses.");
        return;
    }

    const BATCH_SIZE = 10;
    let chatBatches: any[] = [];
    let allExtractedFacts: any[] = [];

    for (const msgDb of chatHistory) {
        chatBatches.push(msgDb);

        if (chatBatches.length >= BATCH_SIZE) {
            const formatted = formatMessagesHistoryBeforeLLM(chatBatches);
            const AIResponse = await knowledgeExtraction(formatted);
            console.log("AI Response:", AIResponse);

            // format response to JSON
            let extractedFacts;
            try {
                const cleanedResponse = cleanJsonResponse(AIResponse);
                console.log("Cleaned response:", cleanedResponse);
                extractedFacts = JSON.parse(cleanedResponse);
                if (extractedFacts.extracted_facts && extractedFacts.extracted_facts.length > 0) {
                    allExtractedFacts.push(...extractedFacts.extracted_facts);
                }
            }
            catch (error) {
                console.error("Error parsing AI response:", error);
                console.error("Raw AI Response:", AIResponse);
                extractedFacts = { extracted_facts: [] }; 
            }

            chatBatches = []
        }
    }

    // Handle remaining messages if any
    if (chatBatches.length > 0) {
        const formatted = formatMessagesHistoryBeforeLLM(chatBatches);
        const AIResponse = await knowledgeExtraction(formatted);
        console.log("AI Response:", AIResponse);

        let extractedFacts;
        try {
            const cleanedResponse = cleanJsonResponse(AIResponse);
            console.log("Cleaned response (remaining):", cleanedResponse);
            extractedFacts = JSON.parse(cleanedResponse);
            if (extractedFacts.extracted_facts && extractedFacts.extracted_facts.length > 0) {
                allExtractedFacts.push(...extractedFacts.extracted_facts);
            }
        }
        catch (error) {
            console.error("Error parsing AI response (remaining):", error);
            console.error("Raw AI Response (remaining):", AIResponse);
        }
    }

    // Save all extracted facts to JSON file
    const outputData = {
        extraction_date: new Date().toISOString(),
        total_facts: allExtractedFacts.length,
        extracted_facts: allExtractedFacts
    };

    const outputPath = path.join(__dirname, '..', '..', 'extracted-facts.json');
    
    try {
        fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf8');
        console.log(`✅ Extracted facts saved to: ${outputPath}`);
        console.log(`📊 Total facts extracted: ${allExtractedFacts.length}`);
    } catch (error) {
        console.error("Error saving extracted facts to file:", error);
    }
}


(async () => {
    try {
        await startOperationTwo();
    } catch (error) {
        console.error("Error during operation:", error);
    }
})();