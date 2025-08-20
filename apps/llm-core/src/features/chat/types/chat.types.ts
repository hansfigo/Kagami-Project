export interface CombinedMessage {
    id: string;
    role: string;
    content: string;
    timestamp: number;
    source: 'vector' | 'database';
    conversationId: string;
    metadata?: any;
}

export interface CombinedRelevantContext {
    messages: CombinedMessage[];
    totalMessages: number;
    vectorMessages: number;
    databaseMessages: number;
}
