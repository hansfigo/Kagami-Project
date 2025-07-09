/**
 * Script to migrate legacy Pinecone data with typo 'coversationId' to correct 'conversationId'
 * 
 * This script:
 * 1. Queries all vectors with 'coversationId' field
 * 2. Updates them to use 'conversationId' field
 * 3. Removes the old typo field
 * 
 * Run with: npx tsx src/scripts/migrate-conversation-id-typo.ts
 */

import { Pinecone as PineconeClient } from "@pinecone-database/pinecone";
import 'dotenv/config';
import { config } from '../config';
import { logger } from '../utils/logger';

const pinecone = new PineconeClient({
    apiKey: process.env.PINECONE_API_KEY || '',
});

async function migrateConversationIdTypo() {
    try {
        logger.info('🔧 Starting Pinecone conversation ID migration...');
        
        const index = pinecone.index(config.pinecone.index[3072]);
        const namespace = 'chat-history';
        
        // Step 1: Query all vectors in the namespace
        logger.info('📋 Fetching all vectors to check for typo...');
        
        // Note: Pinecone doesn't have a direct "get all" operation
        // We need to use the list operation or query with high top_k
        const queryResponse = await index.namespace(namespace).query({
            vector: new Array(3072).fill(0), // Dummy vector for listing
            topK: 10000, // Large number to get many results
            includeMetadata: true
        });
        
        const vectorsToUpdate: any[] = [];
        let legacyCount = 0;
        
        // Step 2: Identify vectors with typo
        queryResponse.matches?.forEach((match: any) => {
            if (match.metadata && 'coversationId' in match.metadata) {
                legacyCount++;
                vectorsToUpdate.push({
                    id: match.id,
                    metadata: match.metadata,
                    score: match.score
                });
            }
        });
        
        logger.info(`📊 Found ${legacyCount} vectors with legacy typo 'coversationId'`);
        
        if (vectorsToUpdate.length === 0) {
            logger.info('✅ No migration needed - all vectors use correct spelling');
            return;
        }
        
        // Step 3: Update vectors with correct spelling
        logger.info('🔄 Starting migration process...');
        
        const batchSize = 100;
        let updatedCount = 0;
        
        for (let i = 0; i < vectorsToUpdate.length; i += batchSize) {
            const batch = vectorsToUpdate.slice(i, i + batchSize);
            
            const updatePromises = batch.map(async (vector) => {
                const newMetadata = { ...vector.metadata };
                
                // Add correct field
                if (newMetadata.coversationId) {
                    newMetadata.conversationId = newMetadata.coversationId;
                    delete newMetadata.coversationId;
                }
                
                // Update the vector
                await index.namespace(namespace).update({
                    id: vector.id,
                    metadata: newMetadata
                });
                
                return vector.id;
            });
            
            const updatedIds = await Promise.all(updatePromises);
            updatedCount += updatedIds.length;
            
            logger.info(`✨ Updated batch ${Math.ceil((i + 1) / batchSize)} - Total: ${updatedCount}/${vectorsToUpdate.length}`);
            
            // Small delay to avoid rate limiting
            if (i + batchSize < vectorsToUpdate.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        logger.info('🎉 Migration completed successfully!');
        logger.info(`📈 Summary: Updated ${updatedCount} vectors from 'coversationId' to 'conversationId'`);
        
    } catch (error) {
        logger.error('❌ Migration failed:', error);
        throw error;
    }
}

// Self-executing script
if (require.main === module) {
    migrateConversationIdTypo()
        .then(() => {
            logger.info('🏁 Migration script finished');
            process.exit(0);
        })
        .catch(error => {
            logger.error('💥 Migration script failed:', error);
            process.exit(1);
        });
}

export { migrateConversationIdTypo };

