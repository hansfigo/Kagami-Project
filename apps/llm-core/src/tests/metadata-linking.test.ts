/**
 * Test Script for PostgreSQL-Vector Store Linking
 * This script tests the new metadata linking between PostgreSQL messages and vector chunks
 */

import { UserConfig } from '../config';
import { chatHistoryVectorStore } from '../lib/Pinecone';
import { prisma } from '../lib/Prisma';
import { logger } from '../utils/logger';

async function testMetadataLinking() {
    try {
        console.log('🔍 Testing PostgreSQL-Vector Store metadata linking...');
        
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
        
        // Check if the message has vector chunk IDs in metadata
        const metadata = latestAssistantMessage.metadata as any;
        const vectorChunkIds = metadata?.metadata?.vectorChunkIds;
        
        console.log('📊 PostgreSQL Metadata Analysis:');
        console.log(`  - Has metadata: ${!!metadata}`);
        console.log(`  - Has vectorChunkIds: ${!!vectorChunkIds}`);
        console.log(`  - Chunk count from metadata: ${vectorChunkIds?.length || 0}`);
        console.log(`  - Is chunked: ${metadata?.metadata?.chunked || false}`);
        
        if (vectorChunkIds && Array.isArray(vectorChunkIds)) {
            console.log(`  - Vector chunk IDs: ${vectorChunkIds.join(', ')}`);
            
            // Verify each chunk exists in vector store
            console.log('\n🔍 Verifying chunks in vector store:');
            for (const chunkId of vectorChunkIds) {
                try {
                    // Search for the specific chunk
                    const chunkResults = await chatHistoryVectorStore.search('', 10, { id: chunkId });
                    const found = chunkResults.length > 0;
                    console.log(`  - Chunk ${chunkId}: ${found ? '✅ Found' : '❌ Not found'}`);
                    
                    if (found) {
                        const chunk = chunkResults[0];
                        console.log(`    Content: "${chunk.pageContent.substring(0, 50)}..."`);
                        console.log(`    MessageId: ${chunk.metadata?.messageId}`);
                        console.log(`    ChunkIndex: ${chunk.metadata?.chunkIndex}`);
                    }
                } catch (error) {
                    console.log(`  - Chunk ${chunkId}: ❌ Error checking: ${error}`);
                }
            }
        } else {
            console.log('⚠️ No vector chunk IDs found in metadata - this message was created before the linking update');
            
            // Try to find chunks using the old search method
            console.log('\n🔍 Trying old search method to find chunks:');
            const searchResults = await chatHistoryVectorStore.search('assistant response', 200, {
                messageId: latestAssistantMessage.id,
                role: 'assistant'
            });
            
            console.log(`  - Found ${searchResults.length} chunks via search`);
            if (searchResults.length > 0) {
                console.log('  - Chunk IDs from search:', searchResults.map((r: any) => r.metadata?.id).join(', '));
            }
        }

        // Compare with what's actually in the vector store for this messageId
        console.log('\n🔍 All chunks in vector store for this messageId:');
        const allChunksForMessage = await chatHistoryVectorStore.search('', 200, {
            messageId: latestAssistantMessage.id,
            role: 'assistant'
        });
        
        console.log(`  - Total chunks found: ${allChunksForMessage.length}`);
        if (allChunksForMessage.length > 0) {
            console.log('  - All chunk IDs:', allChunksForMessage.map((r: any) => r.metadata?.id).join(', '));
            
            // Check if metadata chunk IDs match found chunk IDs
            if (vectorChunkIds && Array.isArray(vectorChunkIds)) {
                const foundChunkIds = allChunksForMessage.map((r: any) => r.metadata?.id);
                const metadataSet = new Set(vectorChunkIds);
                const foundSet = new Set(foundChunkIds);
                
                const matching = vectorChunkIds.filter(id => foundSet.has(id));
                const missing = vectorChunkIds.filter(id => !foundSet.has(id));
                const extra = foundChunkIds.filter((id: any) => !metadataSet.has(id));
                
                console.log('\n📊 Metadata vs Vector Store Comparison:');
                console.log(`  - Matching chunks: ${matching.length}`);
                console.log(`  - Missing from vector store: ${missing.length} ${missing.length > 0 ? `(${missing.join(', ')})` : ''}`);
                console.log(`  - Extra in vector store: ${extra.length} ${extra.length > 0 ? `(${extra.join(', ')})` : ''}`);
                
                if (missing.length === 0 && extra.length === 0) {
                    console.log('✅ Perfect match! Metadata linking is working correctly.');
                } else {
                    console.log('⚠️ Mismatch detected - metadata may be outdated or incomplete.');
                }
            }
        }

    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    testMetadataLinking();
}

export { testMetadataLinking };

