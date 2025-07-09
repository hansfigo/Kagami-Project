/**
 * ChatService Unit Tests with Firebase Storage Integration
 */

import { beforeEach, describe, expect, Mock, test, vi } from 'vitest';
import { ChatService } from '../features/chat/chat.service';

// Mock all external dependencies
vi.mock('../utils/firebaseStorage', () => ({
    FirebaseStorageService: vi.fn().mockImplementation(() => ({
        uploadBase64Image: vi.fn(),
        uploadMultipleBase64Images: vi.fn(),
    }))
}));

vi.mock('../lib/RabbitMQ', () => ({
    IMessageQueue: vi.fn(),
}));

vi.mock('../lib/Prisma', () => ({
    prisma: {
        $transaction: vi.fn(),
        conversation: {
            findFirst: vi.fn().mockResolvedValue({}),
            create: vi.fn(),
        },
        message: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn(),
            findUnique: vi.fn(),
        },
        messageImage: {
            createMany: vi.fn(),
        },
        user: {
            findUnique: vi.fn().mockResolvedValue({
                Conversation: [{ messages: [] }]
            }),
        },
    },
}));

vi.mock('../lib/Pinecone', () => ({
    chatHistoryVectorStore: {
        search: vi.fn().mockResolvedValue([]),
        upsert: vi.fn(),
        addDocuments: vi.fn(),
    },
}));

vi.mock('../lib/LLMClient', () => ({
    llm: {
        invoke: vi.fn().mockResolvedValue({
            content: 'AI response'
        }),
    },
}));

vi.mock('../config', () => ({
    UserConfig: {
        id: 'test-user',
        conversationId: 'test-conversation',
    },
    createSystemPromot: {
        old: vi.fn(() => 'System prompt'),
    },
}));

vi.mock('../utils/date', () => ({
    getCurrentDateTimeInfo: vi.fn(() => 'current date info'),
}));

vi.mock('../utils/chunking', () => ({
    chunkText: vi.fn().mockResolvedValue([{
        pageContent: 'AI response chunk',
        metadata: {}
    }]),
}));

vi.mock('../utils/imageUtils', () => ({
    validateImagesForStorage: vi.fn(() => true),
    extractImageMetadata: vi.fn(() => ({
        index: 0,
        type: 'base64',
        mimeType: 'image/png',
        size: 1024
    })),
    createImageDescription: vi.fn(() => 'Image description'),
}));

describe('ChatService Firebase Integration', () => {
    let chatService: ChatService;
    let mockMessageQueue: any;

    beforeEach(() => {
        // Reset mocks
        vi.clearAllMocks();
        
        // Mock message queue
        mockMessageQueue = {
            sendToQueue: vi.fn(),
        };
        
        // Create ChatService instance
        chatService = new ChatService(mockMessageQueue);
    });

    test('should initialize with FirebaseStorageService', () => {
        expect(chatService).toBeDefined();
        // Verify that FirebaseStorageService was instantiated
        const { FirebaseStorageService } = require('../utils/firebaseStorage');
        expect(FirebaseStorageService).toHaveBeenCalled();
    });

    test('should handle text-only messages (backward compatibility)', async () => {
        // Mock Prisma transaction
        const { prisma } = require('../lib/Prisma');
        prisma.$transaction.mockImplementation(async (callback: any) => {
            return await callback({
                message: { create: vi.fn() },
                messageImage: { createMany: vi.fn() },
            });
        });

        const result = await chatService.addMessage('Hello, this is a text message');

        // Should process the message without Firebase upload
        expect(result).toHaveProperty('aiResponse');
        expect(mockMessageQueue.sendToQueue).toHaveBeenCalled();
    });

    test('should validate image formats', async () => {
        const testInput = {
            text: 'Test invalid image',
            images: ['invalid-image-data']
        };

        // This should throw due to validation failure
        await expect(chatService.addMessage(testInput)).rejects.toThrow();
    });

    test('should validate empty text messages', async () => {
        await expect(chatService.addMessage('')).rejects.toThrow('Message text cannot be empty');
        await expect(chatService.addMessage({ text: '', images: [] })).rejects.toThrow('Message text cannot be empty');
    });

    test('should provide helper methods', async () => {
        // Mock successful processing
        const { prisma } = require('../lib/Prisma');
        prisma.$transaction.mockImplementation(async (callback: any) => {
            return await callback({
                message: { create: vi.fn() },
                messageImage: { createMany: vi.fn() },
            });
        });

        // Test helper methods exist and work
        expect(typeof chatService.addTextMessage).toBe('function');
        expect(typeof chatService.addMessageWithImages).toBe('function');
        expect(typeof chatService.getMessages).toBe('function');
        expect(typeof chatService.clearMessages).toBe('function');
        expect(typeof chatService.getMessageCount).toBe('function');

        // Test helper method calls
        const textResult = await chatService.addTextMessage('Hello');
        expect(textResult).toHaveProperty('aiResponse');

        // Test utility methods
        expect(chatService.getMessages()).toEqual([]);
        expect(chatService.getMessageCount()).toBe(0);
        
        chatService.clearMessages();
        expect(chatService.getMessages()).toEqual([]);
    });

    test('should handle search functionality', async () => {
        const results = await chatService.search('test query');
        expect(Array.isArray(results)).toBe(true);
    });

    test('should handle search with image context', async () => {
        const results = await chatService.searchWithImageContext('test query');
        expect(Array.isArray(results)).toBe(true);
    });

    test('should validate search queries', async () => {
        await expect(chatService.search('')).rejects.toThrow('Invalid query format');
        await expect(chatService.searchWithImageContext('')).rejects.toThrow('Invalid query format');
    });
});
