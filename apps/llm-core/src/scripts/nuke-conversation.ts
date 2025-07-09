/**
 * Script to NUKE/Reset specific conversation data
 * 
 * This script will:
 * 1. Delete all messages for conversation "FIGO-TEST-1" from PostgreSQL
 * 2. Delete all vectors for conversation "FIGO-TEST-1" from Pinecone
 * 3. Keep the conversation record but clear all content
 * 
 * Run with: npx tsx src/scripts/nuke-conversation.ts
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

async function nukeConversation(conversationId: string = TARGET_CONVERSATION_ID) {
    try {
        logger.info(`🔥 Starting NUKE operation for conversation: ${conversationId}`);
        
        // Step 1: Delete from PostgreSQL Databasee
        logger.info('💾 Cleaning PostgreSQL database...');
        
        let deletedMessages = 0;
        let deletedImages = 0;
        
        await prisma.$transaction(async (tx) => {
            // First, delete all message images
            const messageImages = await tx.messageImage.deleteMany({
                where: {
                    message: {
                        conversationId: conversationId
                    }
                }
            });
            deletedImages = messageImages.count;
            
            // Then, delete all messages
            const messages = await tx.message.deleteMany({
                where: {
                    conversationId: conversationId
                }
            });
            deletedMessages = messages.count;
            
            logger.info(`📊 Database cleanup - Messages: ${deletedMessages}, Images: ${deletedImages}`);
        });
        
        // Step 2: Delete from Pinecone Vector Store
        logger.info('🔍 Cleaning Pinecone vector store...');
        
        const index = pinecone.index(config.pinecone.index[3072]);
        const namespace = 'chat-history';
        
        // Query all vectors for this conversation (try both correct and typo field names)
        logger.info('📋 Fetching vectors to delete...');
        
        const vectorsToDelete: string[] = [];
        
        // Search with correct spelling
        try {
            const queryResponse1 = await index.namespace(namespace).query({
                vector: new Array(3072).fill(0),
                topK: 10000,
                includeMetadata: true,
                filter: {
                    conversationId: conversationId
                }
            });
            
            queryResponse1.matches?.forEach((match: any) => {
                if (match.id && match.metadata?.conversationId === conversationId) {
                    vectorsToDelete.push(match.id);
                }
            });
            
            logger.info(`🎯 Found ${queryResponse1.matches?.length || 0} vectors with correct spelling`);
        } catch (error) {
            logger.warn('⚠️ Error querying with correct spelling:', error);
        }
        
        // Search with typo spelling (legacy data)
        try {
            const queryResponse2 = await index.namespace(namespace).query({
                vector: new Array(3072).fill(0),
                topK: 10000,
                includeMetadata: true,
                filter: {
                    coversationId: conversationId // typo version
                }
            });
            
            queryResponse2.matches?.forEach((match: any) => {
                if (match.id && match.metadata?.coversationId === conversationId) {
                    // Avoid duplicates
                    if (!vectorsToDelete.includes(match.id)) {
                        vectorsToDelete.push(match.id);
                    }
                }
            });
            
            logger.info(`🎯 Found ${queryResponse2.matches?.length || 0} vectors with legacy typo`);
        } catch (error) {
            logger.warn('⚠️ Error querying with typo spelling:', error);
        }
        
        // Remove duplicates and delete vectors
        const uniqueVectorIds = [...new Set(vectorsToDelete)];
        logger.info(`🗑️ Total unique vectors to delete: ${uniqueVectorIds.length}`);
        
        if (uniqueVectorIds.length > 0) {
            // Delete in batches to avoid API limits
            const batchSize = 1000;
            let deletedVectors = 0;
            
            for (let i = 0; i < uniqueVectorIds.length; i += batchSize) {
                const batch = uniqueVectorIds.slice(i, i + batchSize);
                
                try {
                    await index.namespace(namespace).deleteMany(batch);
                    deletedVectors += batch.length;
                    
                    logger.info(`🔥 Deleted vector batch ${Math.ceil((i + 1) / batchSize)} - Progress: ${deletedVectors}/${uniqueVectorIds.length}`);
                    
                    // Small delay to avoid rate limiting
                    if (i + batchSize < uniqueVectorIds.length) {
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                } catch (error) {
                    logger.error(`❌ Failed to delete vector batch:`, error);
                    throw error;
                }
            }
            
            logger.info(`✅ Successfully deleted ${deletedVectors} vectors from Pinecone`);
        } else {
            logger.info('ℹ️ No vectors found to delete in Pinecone');
        }
        
        // Step 3: Verify cleanup
        logger.info('🔍 Verifying cleanup...');
        
        // Check database
        const remainingMessages = await prisma.message.count({
            where: {
                conversationId: conversationId
            }
        });
        
        const remainingImages = await prisma.messageImage.count({
            where: {
                message: {
                    conversationId: conversationId
                }
            }
        });
        
        // Check if conversation still exists (should exist but be empty)
        const conversation = await prisma.conversation.findUnique({
            where: {
                id: conversationId
            }
        });
        
        logger.info('📊 Cleanup Verification:');
        logger.info(`   - Conversation exists: ${conversation ? '✅' : '❌'}`);
        logger.info(`   - Remaining messages: ${remainingMessages}`);
        logger.info(`   - Remaining images: ${remainingImages}`);
        
        // Final summary
        logger.info('🎉 NUKE operation completed successfully!');
        logger.info('📈 Summary:');
        logger.info(`   - Conversation ID: ${conversationId}`);
        logger.info(`   - Messages deleted: ${deletedMessages}`);
        logger.info(`   - Images deleted: ${deletedImages}`);
        logger.info(`   - Vectors deleted: ${uniqueVectorIds.length}`);
        logger.info(`   - Conversation record: ${conversation ? 'Preserved' : 'Not found'}`);
        
        if (remainingMessages > 0 || remainingImages > 0) {
            logger.warn('⚠️ Warning: Some data may still remain. Please check manually.');
        } else {
            logger.info('✅ All conversation data successfully removed!');
        }
        
    } catch (error) {
        logger.error('💥 NUKE operation failed:', error);
        throw error;
    }
}

// Self-executing script
if (require.main === module) {
    const conversationId = process.argv[2] || TARGET_CONVERSATION_ID;
    
    logger.info(`🚀 Starting NUKE script for conversation: ${conversationId}`);
    
    // Confirmation prompt
    if (conversationId === TARGET_CONVERSATION_ID) {
        logger.info('⚠️ WARNING: This will permanently delete all data for conversation FIGO-TEST-1');
        logger.info('🔥 This action cannot be undone!');
    }
    
    nukeConversation(conversationId)
        .then(() => {
            logger.info('🏁 NUKE script finished successfully');
            process.exit(0);
        })
        .catch(error => {
            logger.error('💥 NUKE script failed:', error);
            process.exit(1);
        });
}

export { nukeConversation };

