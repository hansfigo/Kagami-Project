import { z } from 'zod';

export type MessageRole = 'user' | 'ai' | 'assistant';

export interface IPineconeChunkMetadata {
    id: string;
    messageId: string;
    chunkIndex: number;
    userId: string;
    conversationId: string;
    role: MessageRole;
    timestamp: number;
}

export const PineconeChunkMetadataSchema = z.object({
    id: z.string().uuid(),
    messageId: z.string().uuid(),
    chunkIndex: z.number().int().nonnegative(),
    userId: z.string(),
    conversationId: z.string(),
    role: z.enum(['user', 'ai', 'assistant']),
    timestamp: z.number().int().positive(),
});

export type PineconeChunkMetadata = z.infer<typeof PineconeChunkMetadataSchema>;