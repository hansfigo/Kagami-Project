/**
 * Test Script for DELETE Latest Pair Endpoint
 * This script tests the vector store cleanup for chunked assistant messages
 */

import { UserConfig } from '../config';
import { chatHistoryVectorStore } from '../lib/Pinecone';
import { prisma } from '../lib/Prisma';
import { logger } from '../utils/logger';

async function testVectorStoreDeletion() {
    try {
        console.log('🔍 Testing vector store deletion...');
        
        // Get the latest assistant message from database
        const latestAssistantMessage = await prisma.message.findFirst({
            where: {
                conversationId: UserConfig.conversationId,
                role: 'assistant'
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        if (!latestAssistantMessage) {
            console.log('❌ No assistant messages found in database');
            return;
        }

        console.log(`📝 Latest assistant message: ${latestAssistantMessage.id}`);
        console.log(`📄 Content preview: ${latestAssistantMessage.content.substring(0, 100)}...`);

        // Search for chunks in vector store
        const chunks = await chatHistoryVectorStore.search('assistant response', 200, {
            messageId: latestAssistantMessage.id,
            role: 'assistant'
        });

        console.log(`🔍 Found ${chunks.length} chunks in vector store for message ${latestAssistantMessage.id}`);
        
        if (chunks.length > 0) {
            console.log('📊 Chunk details:');
            chunks.forEach((chunk: any, index: number) => {
                console.log(`  Chunk ${index + 1}: ID=${chunk.metadata?.id}, ChunkIndex=${chunk.metadata?.chunkIndex}, Content="${chunk.pageContent.substring(0, 50)}..."`);
            });
        }

        // Test with alternative queries
        const testQueries = ['AI response', latestAssistantMessage.content.substring(0, 50), ''];
        
        for (const query of testQueries) {
            const results = await chatHistoryVectorStore.search(query, 200, {
                messageId: latestAssistantMessage.id,
                role: 'assistant'
            });
            console.log(`🔍 Query "${query.substring(0, 30)}..." found ${results.length} chunks`);
        }

    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    testVectorStoreDeletion();
}

export { testVectorStoreDeletion };
