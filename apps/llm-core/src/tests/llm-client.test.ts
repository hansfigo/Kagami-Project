/**
 * LLM Client Simple Tests
 */

import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { llm, visionLLM } from '../lib/LLMClient';

describe('LLM Client Tests', () => {
    beforeAll(() => {
        // Ensure environment variables are set for testing
        if (!process.env.GOOGLE_API_KEY) {
            console.warn('GOOGLE_API_KEY not set, tests may fail');
        }
    });

    test('should initialize LLM client correctly', () => {
        expect(llm).toBeDefined();
        expect(llm.model).toBe('gemini-2.5-flash');
        expect(llm.temperature).toBe(1);
    });

    test('should initialize vision LLM client correctly', () => {
        expect(visionLLM).toBeDefined();
        expect(visionLLM.model).toBe('gemini-1.5-flash');
        expect(visionLLM.temperature).toBe(0.7);
    });

    test('should respond to simple text input', async () => {
        const messages = [
            new SystemMessage('You are a helpful assistant. Respond briefly.'),
            new HumanMessage('Say "Hello, test!" and nothing else.')
        ];

        try {
            const response = await llm.invoke(messages);
            
            expect(response).toBeDefined();
            expect(response.content).toBeDefined();
            expect(typeof response.content).toBe('string');
            expect(response.content.length).toBeGreaterThan(0);
            
            console.log('LLM Response:', response.content);
        } catch (error) {
            console.error('LLM Test Error:', error);
            // If API key is missing, skip the test
            if (error instanceof Error && error.message.includes('API key')) {
                console.warn('Skipping LLM test due to missing API key');
                return;
            }
            throw error;
        }
    }, 30000); // 30 second timeout for LLM calls

    test('should handle Indonesian language input', async () => {
        const messages = [
            new SystemMessage('You are Kagami, a helpful AI assistant. Respond in Indonesian.'),
            new HumanMessage('Halo, apa kabar?')
        ];

        try {
            const response = await llm.invoke(messages);
            
            expect(response).toBeDefined();
            expect(response.content).toBeDefined();
            expect(typeof response.content).toBe('string');
            expect(response.content.length).toBeGreaterThan(0);
            
            console.log('Indonesian Response:', response.content);
        } catch (error) {
            console.error('Indonesian LLM Test Error:', error);
            // If API key is missing, skip the test
            if (error instanceof Error && error.message.includes('API key')) {
                console.warn('Skipping Indonesian LLM test due to missing API key');
                return;
            }
            throw error;
        }
    }, 30000);

    test('should handle mathematical questions', async () => {
        const messages = [
            new SystemMessage('You are a math assistant. Give precise numerical answers.'),
            new HumanMessage('What is 15 + 27?')
        ];

        try {
            const response = await llm.invoke(messages);
            
            expect(response).toBeDefined();
            expect(response.content).toBeDefined();
            expect(typeof response.content).toBe('string');
            expect(response.content).toContain('42');
            
            console.log('Math Response:', response.content);
        } catch (error) {
            console.error('Math LLM Test Error:', error);
            // If API key is missing, skip the test
            if (error instanceof Error && error.message.includes('API key')) {
                console.warn('Skipping math LLM test due to missing API key');
                return;
            }
            throw error;
        }
    }, 30000);

    test('should handle conversation context', async () => {
        const messages = [
            new SystemMessage('You are a helpful assistant. Remember previous context.'),
            new HumanMessage('My name is John'),
            new AIMessage('Nice to meet you, John!'),
            new HumanMessage('What is my name?')
        ];

        try {
            const response = await llm.invoke(messages);
            
            expect(response).toBeDefined();
            expect(response.content).toBeDefined();
            expect(typeof response.content).toBe('string');
            expect((response.content as string).toLowerCase()).toContain('john');
            
            console.log('Context Response:', response.content);
        } catch (error) {
            console.error('Context LLM Test Error:', error);
            // If API key is missing, skip the test
            if (error instanceof Error && error.message.includes('API key')) {
                console.warn('Skipping context LLM test due to missing API key');
                return;
            }
            throw error;
        }
    }, 30000);

    test('should handle empty message gracefully', async () => {
        const messages = [
            new SystemMessage('You are a helpful assistant.'),
            new HumanMessage('')
        ];

        try {
            const response = await llm.invoke(messages);
            
            expect(response).toBeDefined();
            expect(response.content).toBeDefined();
            expect(typeof response.content).toBe('string');
            
            console.log('Empty Message Response:', response.content);
        } catch (error) {
            // This might fail, which is expected behavior
            console.log('Empty message handled with error (expected):', (error as Error).message);
            expect(error).toBeDefined();
        }
    }, 30000);
});

describe('Vision LLM Client Tests', () => {
    test('should initialize vision LLM correctly', () => {
        expect(visionLLM).toBeDefined();
        expect(visionLLM.model).toBe('gemini-1.5-flash');
    });

    test('should respond to text input (vision model)', async () => {
        const messages = [
            new SystemMessage('You are a vision AI assistant.'),
            new HumanMessage('Describe what you would see in a typical office environment.')
        ];

        try {
            const response = await visionLLM.invoke(messages);
            
            expect(response).toBeDefined();
            expect(response.content).toBeDefined();
            expect(typeof response.content).toBe('string');
            expect(response.content.length).toBeGreaterThan(0);
            
            console.log('Vision LLM Response:', response.content);
        } catch (error) {
            console.error('Vision LLM Test Error:', error);
            // If API key is missing, skip the test
            if (error instanceof Error && error.message.includes('API key')) {
                console.warn('Skipping vision LLM test due to missing API key');
                return;
            }
            throw error;
        }
    }, 30000);
});
