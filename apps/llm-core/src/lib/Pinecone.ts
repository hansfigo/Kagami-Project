// dontenv
import { PineconeStore } from '@langchain/pinecone';
import { Pinecone as PineconeClient } from "@pinecone-database/pinecone";
import 'dotenv/config';
import { config } from '../config';
import { embeddings } from './embedding';

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
    coversationId: string;
    userId: string;
}


class LangchainPineconeStore {

    constructor(private pc: PineconeStore) { }

    public async upsert(params: IUpsertParams): Promise<void> {
        const { data, role, messageId, coversationId, userId } = params;
        const timestamp = Date.now();

        if (role) {
            await this.pc.addDocuments([
                {
                    id: messageId,
                    metadata: {
                        id: messageId,
                        coversationId: coversationId,
                        userId: userId,
                        timestamp: timestamp,
                        originalText: data,
                        role: role
                    },
                    pageContent: data
                }
            ]);

            return;
        }

        await this.pc.addDocuments([
            {
                id: messageId,
                metadata: {
                    id: messageId,
                    timestamp: timestamp,
                    originalText: data
                },
                pageContent: data
            }
        ]);
    }

    public async search(query: string, topK: number = 5): Promise<any> {
        return await this.pc.similaritySearch(
            query,
            topK
        );
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
}

const pinecone = new PineconeClient({
    apiKey: process.env.PINECONE_API_KEY || '',
});


const userProfileVectorStore = new LangchainPineconeStore(new PineconeStore(embeddings, {
    pineconeIndex: pinecone.index(config.pinecone.indexName),
    maxConcurrency: 5,
    namespace: 'user-profile'
}));

const chatHistoryVectorStore = new LangchainPineconeStore(new PineconeStore(embeddings, {
    pineconeIndex: pinecone.index(config.pinecone.indexName),
    maxConcurrency: 5,
    namespace: 'chat-history'
}));


export { chatHistoryVectorStore, IupsertData, LangchainPineconeStore, userProfileVectorStore };

