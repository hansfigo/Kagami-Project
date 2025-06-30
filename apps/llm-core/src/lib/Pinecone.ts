// dontenv
import { Document } from '@langchain/core/documents'; // Contoh, path bisa berbeda tergantung versi atau library
import { PineconeStore } from '@langchain/pinecone';
import { Pinecone as PineconeClient } from "@pinecone-database/pinecone";
import 'dotenv/config';
import { config } from '../config';
import { PineconeChunkMetadata } from '../types/pinecone.types';
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

    public async upsert(docs: Document): Promise<void> {
        await this.pc.addDocuments([docs])
    }

    public async search(query: string, topK: number = 8, filter?: Partial<PineconeChunkMetadata>): Promise<any> {
        return await this.pc.similaritySearch(
            query,
            topK,
            filter
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

