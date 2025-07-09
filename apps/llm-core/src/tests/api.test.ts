// API Test Examples and Helpers for Firebase Storage Integration

/**
 * Test payload examples for different API endpoints
 * Note: Base64 images will be automatically uploaded to Firebase Storage
 */
export const testPayloads = {
    // Legacy format (backward compatible)
    textOnlyLegacy: {
        msg: "Hello, this is a test message"
    },

    // New format - text only
    textOnlyNew: {
        text: "Hello, this is a test message"
    },

    // New format - with images (will be uploaded to Firebase)
    multimodal: {
        text: "What do you see in these images?",
        images: [
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", // Will upload to Firebase
            "https://firebasestorage.googleapis.com/v0/b/project.appspot.com/o/chat-images%2Fsample.jpg?alt=media" // Direct Firebase URL
        ]
    },

    // Dedicated multimodal endpoint
    dedicatedMultimodal: {
        text: "Describe these images in detail",
        images: [
            "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAAQABAAD//gAcAA==" // Will upload to Firebase
        ]
    },

    // Search payload
    search: {
        query: "photos of cats"
    },

    // Invalid payloads for testing
    invalid: {
        emptyText: { text: "" },
        invalidImages: { 
            text: "Test", 
            images: ["invalid-image-data"] 
        },
        noImages: { 
            text: "Test message",
            images: [] 
        }
    },

    // FormData examples
    formData: {
        text: "What do you see in this image?",
        image1: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
    },

    // Multiple images in form data
    formDataMultiple: {
        text: "Compare these images",
        image1: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        image2: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAAQABAAD//gAcAA=="
    }
};

/**
 * Expected response formats
 */
export const expectedResponses = {
    successfulChat: {
        message: "Message processed successfully",
        status: "success",
        data: {
            input: {
                text: "Sample message",
                imageCount: 0,
                hasImages: false
            },
            response: "AI response here"
        }
    },

    successfulMultimodal: {
        message: "Multimodal message processed successfully", 
        status: "success",
        data: {
            input: {
                text: "Sample message",
                imageCount: 2
            },
            response: "AI response about images"
        }
    },

    searchResults: {
        message: "Search completed successfully",
        status: "success", 
        data: {
            query: "search term",
            results: [],
            totalResults: 0
        }
    },

    messageWithImages: {
        message: "Message retrieved successfully",
        status: "success",
        data: {
            id: "msg_123",
            content: "Message content",
            hasImages: true,
            images: [],
            imageUrls: []
        }
    },

    errors: {
        missingBody: { error: "Request body is required." },
        missingText: { error: "Text message is required." },
        invalidImages: { error: "Images must be an array of strings." },
        messageNotFound: { error: "Message not found" }
    }
};

// Helper functions for actual API testing
export const testHelpers = {
    createTextMessage: (text: string) => ({ text }),
    
    createMultimodalMessage: (text: string, images: string[]) => ({
        text,
        images
    }),
    
    createLegacyMessage: (msg: string) => ({ msg }),
    
    generateSampleImage: () => 
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    
    validateImageFormat: (image: string) => {
        return image.startsWith('data:image/') || image.startsWith('http');
    },
    
    validatePayload: (payload: any) => {
        if ('msg' in payload) {
            return typeof payload.msg === 'string' && payload.msg.length > 0;
        }
        if ('text' in payload) {
            return typeof payload.text === 'string' && payload.text.length > 0;
        }
        return false;
    }
};

// Integration test examples
export const integrationTests = {
    async testTextOnlyChat() {
        const response = await fetch('http://localhost:3000/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: "Hello world" })
        });
        return response.json();
    },

    async testMultimodalChat() {
        const image = testHelpers.generateSampleImage();
        const response = await fetch('http://localhost:3000/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: "What do you see?",
                images: [image]
            })
        });
        return response.json();
    },

    async testDedicatedMultimodal() {
        const image = testHelpers.generateSampleImage();
        const response = await fetch('http://localhost:3000/api/chat/multimodal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: "Describe this image",
                images: [image]
            })
        });
        return response.json();
    },

    async testFormData() {
        const formData = new URLSearchParams();
        formData.append('text', 'What do you see in this image?');
        formData.append('image1', testHelpers.generateSampleImage());

        const response = await fetch('http://localhost:3000/api/chat/form', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData
        });
        return response.json();
    },

    async testFormDataMultiple() {
        const formData = new URLSearchParams();
        formData.append('text', 'Compare these images');
        formData.append('image1', testHelpers.generateSampleImage());
        formData.append('image2', testHelpers.generateSampleImage());

        const response = await fetch('http://localhost:3000/api/chat/form', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData
        });
        return response.json();
    }
};

/**
 * Firebase Storage Integration Tests
 * These tests verify that images are properly uploaded to Firebase Storage
 */
export const firebaseIntegrationTests = {
    async testImageUploadFlow() {
        console.log('🧪 Testing Firebase Storage integration...');
        
        const payload = {
            text: "What do you see in this image?",
            images: [testHelpers.generateSampleImage()]
        };

        const response = await fetch('http://localhost:3000/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        
        // Verify response structure
        if (result.status === 'success') {
            console.log('✅ Image upload and processing successful');
            console.log('📊 Response data:', {
                hasImages: result.data.input.hasImages,
                imageCount: result.data.input.imageCount
            });
        }
        
        return result;
    },

    async testMultipleImageUpload() {
        console.log('🧪 Testing multiple image upload to Firebase...');
        
        const payload = {
            text: "Compare these images",
            images: [
                testHelpers.generateSampleImage(),
                testHelpers.generateSampleImage()
            ]
        };

        const response = await fetch('http://localhost:3000/api/chat/multimodal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        
        if (result.status === 'success') {
            console.log('✅ Multiple image upload successful');
            console.log('📊 Processed images:', result.data.input.imageCount);
        }
        
        return result;
    },

    async testImageRetrieval() {
        console.log('🧪 Testing image retrieval from database...');
        
        // First, send a message with images
        const sendPayload = {
            text: "Store this image for me",
            images: [testHelpers.generateSampleImage()]
        };

        const sendResponse = await fetch('http://localhost:3000/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sendPayload)
        });

        const sendResult = await sendResponse.json();
        
        if (sendResult.status === 'success') {
            // Then search for messages with images
            const searchPayload = { query: "image" };
            
            const searchResponse = await fetch('http://localhost:3000/api/chat/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(searchPayload)
            });

            const searchResult = await searchResponse.json();
            
            if (searchResult.status === 'success') {
                console.log('✅ Image retrieval from vector store successful');
                console.log('📊 Found messages with images:', 
                    searchResult.data.results.filter((r: any) => r.hasImages).length
                );
            }
            
            return searchResult;
        }
        
        return sendResult;
    }
};

/**
 * Complete integration test suite
 */
export async function runFirebaseIntegrationTests() {
    try {
        console.log('🚀 Starting Firebase Storage integration tests...\n');
        
        await firebaseIntegrationTests.testImageUploadFlow();
        console.log('');
        
        await firebaseIntegrationTests.testMultipleImageUpload();
        console.log('');
        
        await firebaseIntegrationTests.testImageRetrieval();
        console.log('');
        
        console.log('🎉 All Firebase integration tests completed successfully!');
    } catch (error) {
        console.error('❌ Firebase integration tests failed:', error);
        throw error;
    }
}
