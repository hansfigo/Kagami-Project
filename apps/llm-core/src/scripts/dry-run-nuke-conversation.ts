/**
 * DRY RUN Script to check what would be deleted for specific conversation
 * 
 * This script will:
 * 1. Check how many messages exist for conversation in PostgreSQL
 * 2. Check how many vectors exist for conversation in Pinecone
 * 3. Show what WOULD be deleted without actually deleting anything
 * 
 * Run with: npx tsx src/scripts/dry-run-nuke-conversation.ts
 */

import { Pinecone as PineconeClient } from "@pinecone-database/pinecone";
import 'dotenv/config';
import { config } from '../config';
import { prisma } from '../lib/Prisma';
import { logger } from '../utils/logger';

const pinecone = new PineconeClient({
    apiKey: process.env.PINECONE_API_KEY || '',
});

const TARGET_CONVERSATION_ID = 'FIGO-TEST-1';

async function dryRunNukeConversation(conversationId: string = TARGET_CONVERSATION_ID) {
    try {
        logger.info(`🔍 DRY RUN: Checking what would be deleted for conversation: ${conversationId}`);
        
        // Step 1: Check PostgreSQL Database
        logger.info('💾 Checking PostgreSQL database...');
        
        // Count messages
        const messageCount = await prisma.message.count({
            where: {
                conversationId: conversationId
            }
        });
        
        // Count images
        const imageCount = await prisma.messageImage.count({
            where: {
                message: {
                    conversationId: conversationId
                }
            }
        });
        
        // Check conversation
        const conversation = await prisma.conversation.findUnique({
            where: {
                id: conversationId
            }
        });
        
        // Get sample messages
        const sampleMessages = await prisma.message.findMany({
            where: {
                conversationId: conversationId
            },
            take: 3,
            orderBy: {
                createdAt: 'desc'
            },
            select: {
                id: true,
                role: true,
                content: true,
                createdAt: true,
                hasImages: true
            }
        });
        
        logger.info('📊 Database Analysis:');
        logger.info(`   - Conversation exists: ${conversation ? '✅' : '❌'}`);
        logger.info(`   - Messages to delete: ${messageCount}`);
        logger.info(`   - Images to delete: ${imageCount}`);
        
        if (sampleMessages.length > 0) {
            logger.info('   - Sample messages:');
            sampleMessages.forEach((msg, idx) => {
                logger.info(`     ${idx + 1}. [${msg.role}] ${msg.content.substring(0, 50)}... (${msg.createdAt.toISOString()})`);
            });
        }
        
        // Step 2: Check Pinecone Vector Store
        logger.info('🔍 Checking Pinecone vector store...');
        
        const index = pinecone.index(config.pinecone.index[3072]);
        const namespace = 'chat-history';
        
        const vectorsToDelete: string[] = [];
        let correctSpellingCount = 0;
        let typoSpellingCount = 0;
        
        // Check with correct spelling
        try {
            const queryResponse1 = await index.namespace(namespace).query({
                vector: new Array(3072).fill(0),
                topK: 10000,
                includeMetadata: true,
                filter: {
                    conversationId: conversationId
                }
            });
            
            correctSpellingCount = queryResponse1.matches?.length || 0;
            
            queryResponse1.matches?.forEach((match: any) => {
                if (match.id) vectorsToDelete.push(match.id);
            });
            
            // Show sample metadata
            if (queryResponse1.matches && queryResponse1.matches.length > 0) {
                logger.info('   - Sample vector metadata (correct spelling):');
                const sample = queryResponse1.matches[0];
                logger.info(`     ID: ${sample.id}`);
                logger.info(`     ConversationId: ${sample.metadata?.conversationId}`);
                logger.info(`     Role: ${sample.metadata?.role}`);
                logger.info(`     Timestamp: ${sample.metadata?.timestamp}`);
            }
            
        } catch (error) {
            logger.warn('⚠️ Error querying with correct spelling:', error);
        }
        
        // Check with typo spelling (legacy data)
        try {
            const queryResponse2 = await index.namespace(namespace).query({
                vector: new Array(3072).fill(0),
                topK: 10000,
                includeMetadata: true,
                filter: {
                    coversationId: conversationId // typo version
                }
            });
            
            typoSpellingCount = queryResponse2.matches?.length || 0;
            
            queryResponse2.matches?.forEach((match: any) => {
                if (match.id && !vectorsToDelete.includes(match.id)) {
                    vectorsToDelete.push(match.id);
                }
            });
            
            // Show sample metadata
            if (queryResponse2.matches && queryResponse2.matches.length > 0) {
                logger.info('   - Sample vector metadata (typo spelling):');
                const sample = queryResponse2.matches[0];
                logger.info(`     ID: ${sample.id}`);
                logger.info(`     CoversationId: ${sample.metadata?.coversationId}`);
                logger.info(`     Role: ${sample.metadata?.role}`);
                logger.info(`     Timestamp: ${sample.metadata?.timestamp}`);
            }
            
        } catch (error) {
            logger.warn('⚠️ Error querying with typo spelling:', error);
        }
        
        const uniqueVectorIds = [...new Set(vectorsToDelete)];
        
        logger.info('📊 Vector Store Analysis:');
        logger.info(`   - Vectors with correct spelling: ${correctSpellingCount}`);
        logger.info(`   - Vectors with typo spelling: ${typoSpellingCount}`);
        logger.info(`   - Total unique vectors to delete: ${uniqueVectorIds.length}`);
        
        // Step 3: Summary
        logger.info('📋 DRY RUN SUMMARY:');
        logger.info('🔥 The following would be PERMANENTLY DELETED:');
        logger.info(`   📝 PostgreSQL Messages: ${messageCount}`);
        logger.info(`   🖼️ PostgreSQL Images: ${imageCount}`);
        logger.info(`   🔍 Pinecone Vectors: ${uniqueVectorIds.length}`);
        logger.info('');
        logger.info('✅ The following would be PRESERVED:');
        logger.info(`   💬 Conversation Record: ${conversation ? 'YES' : 'NO (already missing)'}`);
        logger.info('');
        
        if (messageCount === 0 && imageCount === 0 && uniqueVectorIds.length === 0) {
            logger.info('ℹ️ No data found to delete. Conversation is already clean or doesn\'t exist.');
        } else {
            logger.info('⚠️ WARNING: This would permanently delete all the data above!');
            logger.info('🔥 To proceed with actual deletion, run: npm run nuke:figo-test');
        }
        
    } catch (error) {
        logger.error('💥 DRY RUN failed:', error);
        throw error;
    }
}

// Self-executing script
if (require.main === module) {
    const conversationId = process.argv[2] || TARGET_CONVERSATION_ID;
    
    logger.info(`🚀 Starting DRY RUN for conversation: ${conversationId}`);
    
    dryRunNukeConversation(conversationId)
        .then(() => {
            logger.info('🏁 DRY RUN completed successfully');
            process.exit(0);
        })
        .catch(error => {
            logger.error('💥 DRY RUN failed:', error);
            process.exit(1);
        });
}

export { dryRunNukeConversation };

