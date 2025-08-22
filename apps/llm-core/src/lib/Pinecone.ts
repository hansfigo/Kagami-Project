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

        // Handle legacy typo: search both 'conversationId' and 'coversationId'
        if (filter?.conversationId) {
            const conversationId = filter.conversationId;
            
            // First try with correct spelling
            let results = await this.pc.similaritySearch(
                query,
                topK,
                filter
            );


            if (results.length === 0) {
                const legacyFilter = { ...filter };
                delete legacyFilter.conversationId;
                (legacyFilter as any).coversationId = conversationId;

                const legacyResults = await this.pc.similaritySearch(
                    query,
                    topK,
                    legacyFilter
                );
                results = legacyResults;
            }

            if (results.length < topK) {
                const legacyFilter = { ...filter };
                delete legacyFilter.conversationId;
                (legacyFilter as any).coversationId = conversationId;

                const legacyResults = await this.pc.similaritySearch(
                    query,
                    Math.max(topK - results.length, 5),
                    legacyFilter
                );

                const mergedResults = [...results];
                legacyResults.forEach(legacyResult => {
                    const isDuplicate = mergedResults.some(existing => 
                        existing.metadata?.id === legacyResult.metadata?.id
                    );
                    if (!isDuplicate) {
                        mergedResults.push(legacyResult);
                    }
                });

                results = mergedResults.slice(0, topK);
            }



            return results;
        }

        // Normal search without conversation filter
        const results = await this.pc.similaritySearch(
            query,
            topK,
            filter
        );

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
        logger.info(`📤 Pinecone: Attempting to add ${docs.length} documents...`);
        
        // Extract IDs from metadata for proper Pinecone storage
        const ids: string[] = [];
        const docsWithoutId: Document[] = [];
        
        docs.forEach((doc, index) => {
            // Use metadata.id as the document ID for Pinecone
            const docId = doc.metadata?.id || doc.id || `doc-${Date.now()}-${index}`;
            ids.push(docId);
            
            // Create document without the id property (LangChain Pinecone doesn't use doc.id)
            const docWithoutId = new Document({
                pageContent: doc.pageContent,
                metadata: {
                    ...doc.metadata,
                    id: docId // Ensure ID is in metadata
                }
            });
            
            docsWithoutId.push(docWithoutId);
        });
        
        // Use the correct LangChain Pinecone pattern with separate ids parameter
        await this.pc.addDocuments(docsWithoutId, { ids });
        logger.info(`✅ Pinecone: Successfully added ${docs.length} documents with IDs: ${ids.join(', ')}`);
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

