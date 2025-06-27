import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

interface IChunkTextOptions {
    chunkSize?: number;
    chunkOverlap?: number;
}

export async function chunkText(text: string, opt: IChunkTextOptions): Promise<Document[]> {
    const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: opt.chunkSize ?? 1000,
        chunkOverlap: opt.chunkOverlap ?? 200,
        separators: ['---\n\n', '\n\n', '\n', ' ', ''],
    });
    const docs = await splitter.splitDocuments([
        new Document({
            pageContent: text,
            metadata: {}
        })
    ]);

    return docs;
}



export async function chunkTextDocs(doc: Document, opt: IChunkTextOptions): Promise<Document[]> {
    const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: opt.chunkSize ?? 1000,
        chunkOverlap: opt.chunkOverlap ?? 200,
        separators: ['---\n\n', '\n\n', '\n', ' ', ''],
    });
    const docs = await splitter.splitDocuments([doc]);

    return docs;
}


