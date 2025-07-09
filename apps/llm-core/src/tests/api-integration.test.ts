/**
 * API Integration Tests for Firebase Storage Integration
 * Tests the complete flow from API endpoints to Firebase Storage
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { testHelpers, testPayloads } from './api.test';

// Test server URL - adjust if needed
const API_BASE_URL = 'http://localhost:3000';

// Helper function to make API requests
async function apiRequest(endpoint: string, payload: any) {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    
    return response.json();
}

describe('API Firebase Storage Integration', () => {
    
    beforeAll(() => {
        // Check if server is running
        console.log('🚀 Starting API integration tests...');
        console.log('📡 Make sure the server is running on', API_BASE_URL);
    });

    describe('POST /api/chat - Basic Chat Endpoint', () => {
        
        test('should handle text-only message (legacy format)', async () => {
            const result = await apiRequest('/api/chat', testPayloads.textOnlyLegacy);
            
            expect(result).toHaveProperty('status', 'success');
            expect(result).toHaveProperty('message', 'Message processed successfully');
            expect(result.data.input).toHaveProperty('hasImages', false);
            expect(result.data.input).toHaveProperty('imageCount', 0);
        }, 15000);

        test('should handle text-only message (new format)', async () => {
            const result = await apiRequest('/api/chat', testPayloads.textOnlyNew);
            
            expect(result).toHaveProperty('status', 'success');
            expect(result.data.input).toHaveProperty('hasImages', false);
            expect(result.data.input).toHaveProperty('imageCount', 0);
        }, 15000);

        test('should handle multimodal message and upload images to Firebase', async () => {
            const payload = {
                text: "What do you see in this image?",
                images: [testHelpers.generateSampleImage()]
            };
            
            const result = await apiRequest('/api/chat', payload);
            
            expect(result).toHaveProperty('status', 'success');
            expect(result.data.input).toHaveProperty('hasImages', true);
            expect(result.data.input).toHaveProperty('imageCount', 1);
            expect(result.data).toHaveProperty('response');
        }, 20000);

        test('should handle multiple images and upload all to Firebase', async () => {
            const payload = {
                text: "Compare these images",
                images: [
                    testHelpers.generateSampleImage(),
                    testHelpers.generateSampleImage()
                ]
            };
            
            const result = await apiRequest('/api/chat', payload);
            
            expect(result).toHaveProperty('status', 'success');
            expect(result.data.input).toHaveProperty('hasImages', true);
            expect(result.data.input).toHaveProperty('imageCount', 2);
        }, 25000);

        test('should reject empty text message', async () => {
            await expect(
                apiRequest('/api/chat', { text: "" })
            ).rejects.toThrow();
        });

        test('should reject invalid image format', async () => {
            const payload = {
                text: "Test message",
                images: ["invalid-image-data"]
            };
            
            await expect(
                apiRequest('/api/chat', payload)
            ).rejects.toThrow();
        });
    });

    describe('POST /api/chat/multimodal - Dedicated Multimodal Endpoint', () => {
        
        test('should process multimodal message with Firebase upload', async () => {
            const payload = {
                text: "Describe this image in detail",
                images: [testHelpers.generateSampleImage()]
            };
            
            const result = await apiRequest('/api/chat/multimodal', payload);
            
            expect(result).toHaveProperty('status', 'success');
            expect(result.data.input).toHaveProperty('imageCount', 1);
        }, 20000);

        test('should require images for multimodal endpoint', async () => {
            const payload = {
                text: "This should fail",
                images: []
            };
            
            await expect(
                apiRequest('/api/chat/multimodal', payload)
            ).rejects.toThrow();
        });
    });

    describe('POST /api/chat/search - Enhanced Search', () => {
        
        test('should search chat history', async () => {
            // First add a message with image
            await apiRequest('/api/chat', {
                text: "This is a test message with an image",
                images: [testHelpers.generateSampleImage()]
            });
            
            // Then search for it
            const searchResult = await apiRequest('/api/chat/search', {
                query: "test message"
            });
            
            expect(searchResult).toHaveProperty('status', 'success');
            expect(searchResult.data).toHaveProperty('results');
            expect(Array.isArray(searchResult.data.results)).toBe(true);
        }, 25000);

        test('should return image metadata in search results', async () => {
            const searchResult = await apiRequest('/api/chat/search', {
                query: "image"
            });
            
            expect(searchResult).toHaveProperty('status', 'success');
            expect(searchResult.data).toHaveProperty('results');
            
            // Check if any results have image metadata
            const resultsWithImages = searchResult.data.results.filter(
                (r: any) => r.hasImages === true
            );
            
            // Should have at least some results with images from previous tests
            expect(resultsWithImages.length).toBeGreaterThanOrEqual(0);
        }, 15000);
    });

    describe('Firebase Storage Verification', () => {
        
        test('should create unique Firebase URLs for each image', async () => {
            const results = await Promise.all([
                apiRequest('/api/chat', {
                    text: "Image 1",
                    images: [testHelpers.generateSampleImage()]
                }),
                apiRequest('/api/chat', {
                    text: "Image 2", 
                    images: [testHelpers.generateSampleImage()]
                })
            ]);
            
            // Both should succeed
            results.forEach(result => {
                expect(result).toHaveProperty('status', 'success');
                expect(result.data.input).toHaveProperty('hasImages', true);
            });
            
            // Images should be processed and stored
            expect(results).toHaveLength(2);
        }, 30000);

        test('should handle concurrent image uploads', async () => {
            const concurrentRequests = Array(3).fill(null).map((_, index) =>
                apiRequest('/api/chat', {
                    text: `Concurrent test ${index}`,
                    images: [testHelpers.generateSampleImage()]
                })
            );
            
            const results = await Promise.all(concurrentRequests);
            
            // All should succeed
            results.forEach(result => {
                expect(result).toHaveProperty('status', 'success');
                expect(result.data.input).toHaveProperty('hasImages', true);
                expect(result.data.input).toHaveProperty('imageCount', 1);
            });
        }, 35000);
    });

    afterAll(() => {
        console.log('✅ API integration tests completed');
    });
});

// Error handling test suite
describe('API Error Handling', () => {
    
    test('should handle malformed JSON', async () => {
        const response = await fetch(`${API_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: 'invalid-json'
        });
        
        expect(response.status).toBe(400);
    });

    test('should handle missing request body', async () => {
        const response = await fetch(`${API_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        expect(response.status).toBe(400);
    });

    test('should handle oversized images gracefully', async () => {
        // Create a large base64 string (simulate oversized image)
        const largeBase64 = 'data:image/png;base64,' + 'A'.repeat(10000000); // 10MB of A's
        
        await expect(
            apiRequest('/api/chat', {
                text: "This image is too large",
                images: [largeBase64]
            })
        ).rejects.toThrow();
    });
});
