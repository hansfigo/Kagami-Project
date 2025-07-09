// dontenv
import { Document } from '@langchain/core/documents'; // Contoh, path bisa berbeda tergantung versi atau library
import { EmbeddingsInterface } from '@langchain/core/embeddings';
import { PineconeStore } from '@langchain/pinecone';
import { Pinecone as PineconeClient } from "@pinecone-database/pinecone";
import 'dotenv/config';
import { config } from '../config';
import { PineconeChunkMetadata } from '../types/pinecone.types';
import { logger } from '../utils/logger';
import { embeddings, googleEmbeddings } from './embedding';
interface IupsertData {
    id: string;
    role: string;
    originalText: string;
    pageContent: string;
}

interface IUpsertParams {
    data: string;
    role?: string;
    messageId: string;
    conversationId: string;
    userId: string;
}


class LangchainPineconeStore {

    constructor(private pc: PineconeStore) { }

    public async upsert(docs: Document): Promise<void> {
        await this.pc.addDocuments([docs])
    }

    public async search(query: string, topK: number = 8, filter?: Partial<PineconeChunkMetadata>): Promise<any> {
        logger.info('🔍 Pinecone Search Debug:', {
            query: query.substring(0, 100),
            topK,
            filter,
            namespace: this.pc.namespace
        });

        // Handle legacy typo: search both 'conversationId' and 'coversationId'
        if (filter?.conversationId) {
            const conversationId = filter.conversationId;
            
            // First try with correct spelling
            let results = await this.pc.similaritySearch(
                query,
                topK,
                filter
            );

            logger.info('🔍 First search (correct spelling) results:', results.length);

            // If no results, try with legacy typo
            if (results.length === 0) {
                const legacyFilter = { ...filter };
                delete legacyFilter.conversationId;
                (legacyFilter as any).coversationId = conversationId;

                logger.info('🔍 Trying legacy search with typo filter:', legacyFilter);
                
                const legacyResults = await this.pc.similaritySearch(
                    query,
                    topK,
                    legacyFilter
                );

                logger.info('🔍 Legacy search (typo) results:', legacyResults.length);
                results = legacyResults;
            }

            // If still no results or we want comprehensive results, search both and merge
            if (results.length < topK) {
                const legacyFilter = { ...filter };
                delete legacyFilter.conversationId;
                (legacyFilter as any).coversationId = conversationId;

                const legacyResults = await this.pc.similaritySearch(
                    query,
                    Math.max(topK - results.length, 5), // Get remaining or at least 5
                    legacyFilter
                );

                // Merge results and remove duplicates by ID
                const mergedResults = [...results];
                legacyResults.forEach(legacyResult => {
                    const isDuplicate = mergedResults.some(existing => 
                        existing.metadata?.id === legacyResult.metadata?.id
                    );
                    if (!isDuplicate) {
                        mergedResults.push(legacyResult);
                    }
                });

                results = mergedResults.slice(0, topK); // Limit to topK
                logger.info('🔍 Merged results (correct + legacy):', results.length);
            }

            logger.info('🔍 Pinecone Search Final Results:', {
                count: results.length,
                sampleMetadata: results.length > 0 ? results[0].metadata : 'No results'
            });

            return results;
        }

        // Normal search without conversation filter
        const results = await this.pc.similaritySearch(
            query,
            topK,
            filter
        );

        logger.info('🔍 Pinecone Search Results:', {
            count: results.length,
            sampleMetadata: results.length > 0 ? results[0].metadata : 'No results'
        });

        return results;
    }

    public async delete(ids: string[]): Promise<void> {
        await this.pc.delete({
            ids: ids,
            namespace: this.pc.namespace
        })
    }

    public async deleteByNamespace(namespace: string): Promise<void> {
        await this.pc.delete({
            namespace: namespace,
            deleteAll: true
        })
    }

    public async deleteAll(): Promise<void> {
        await this.pc.delete({
            namespace: this.pc.namespace,
            deleteAll: true
        });
    }

    public async addDocuments(docs: Document[]): Promise<void> {
        await this.pc.addDocuments(docs);
    }
}

const pinecone = new PineconeClient({
    apiKey: process.env.PINECONE_API_KEY || '',
});

class vectorStore {
    private store: LangchainPineconeStore;

    constructor(private embeddings: EmbeddingsInterface, private pineconeClient: PineconeClient, private namespace: string, indexName: string = config.pinecone.indexName) {
        this.store = new LangchainPineconeStore(new PineconeStore(this.embeddings, {
            pineconeIndex: this.pineconeClient.index(indexName),
            maxConcurrency: 5,
            namespace: this.namespace
        }));
    }

    public getStore(): LangchainPineconeStore {
        return this.store;
    }
}

export const chatHistoryGoogleVectorStore = new vectorStore(googleEmbeddings, pinecone, 'chat-history', config.pinecone.index[3072]).getStore();



const userProfileVectorStore = new LangchainPineconeStore(new PineconeStore(embeddings, {
    pineconeIndex: pinecone.index(config.pinecone.indexName),
    maxConcurrency: 5,
    namespace: 'user-profile'
}));

const chatHistoryVectorStore = new vectorStore(googleEmbeddings, pinecone, 'chat-history', config.pinecone.index[3072]).getStore();


export { chatHistoryVectorStore, IupsertData, LangchainPineconeStore, userProfileVectorStore };

