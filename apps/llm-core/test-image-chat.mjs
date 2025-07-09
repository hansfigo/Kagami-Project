#!/usr/bin/env node
/**
 * Manual Testing Script for Image Chat Endpoints
 * Run this script to test all image chat functionality
 */

import fs from 'fs';
import path from 'path';

const API_BASE = 'http://localhost:3000';

// Helper function to convert image file to base64
function imageToBase64(imagePath) {
    try {
        const imageBuffer = fs.readFileSync(imagePath);
        const base64 = imageBuffer.toString('base64');
        const extension = path.extname(imagePath).toLowerCase();
        
        const mimeType = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg', 
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp'
        }[extension] || 'image/jpeg';
        
        return `data:${mimeType};base64,${base64}`;
    } catch (error) {
        console.error('Error reading image:', error.message);
        return null;
    }
}

// Sample base64 image (1x1 red pixel)
const sampleImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

async function testAPI(endpoint, payload, options = {}) {
    try {
        console.log(`\n🧪 Testing ${endpoint}...`);
        console.log('📤 Payload:', JSON.stringify(payload, null, 2));
        
        const response = await fetch(`${API_BASE}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            body: JSON.stringify(payload),
            ...options
        });
        
        const result = await response.json();
        
        if (response.ok) {
            console.log('✅ Success!');
            console.log('📨 Response:', JSON.stringify(result, null, 2));
        } else {
            console.log('❌ Failed!');
            console.log('📨 Error:', JSON.stringify(result, null, 2));
        }
        
        return result;
    } catch (error) {
        console.error('🚨 Request failed:', error.message);
        return null;
    }
}

async function testFormData(endpoint, formData) {
    try {
        console.log(`\n🧪 Testing ${endpoint} with FormData...`);
        
        const response = await fetch(`${API_BASE}${endpoint}`, {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (response.ok) {
            console.log('✅ Success!');
            console.log('📨 Response:', JSON.stringify(result, null, 2));
        } else {
            console.log('❌ Failed!');
            console.log('📨 Error:', JSON.stringify(result, null, 2));
        }
        
        return result;
    } catch (error) {
        console.error('🚨 Request failed:', error.message);
        return null;
    }
}

async function runTests() {
    console.log('🚀 Starting Image Chat API Tests...');
    console.log('📡 API Base URL:', API_BASE);
    console.log('⚠️  Make sure the server is running with: npm run dev\n');
    
    // Test 1: Basic chat with image (JSON)
    await testAPI('/api/chat', {
        text: 'What do you see in this image?',
        images: [sampleImage]
    });
    
    // Test 2: Legacy format with image
    await testAPI('/api/chat', {
        msg: 'Describe this picture please',
        images: [sampleImage]
    });
    
    // Test 3: Dedicated multimodal endpoint
    await testAPI('/api/chat/multimodal', {
        text: 'Analyze this image in detail',
        images: [sampleImage]
    });
    
    // Test 4: Multiple images
    await testAPI('/api/chat', {
        text: 'Compare these two images',
        images: [sampleImage, sampleImage]
    });
    
    // Test 5: FormData with base64 in form fields
    const formData = new URLSearchParams();
    formData.append('text', 'What is this image showing?');
    formData.append('image1', sampleImage);
    
    await testFormData('/api/chat/form', formData);
    
    // Test 6: Search for messages with images
    await testAPI('/api/chat/search', {
        query: 'image'
    });
    
    // Test 7: Error handling - no images for multimodal
    await testAPI('/api/chat/multimodal', {
        text: 'This should fail',
        images: []
    });
    
    // Test 8: Error handling - invalid image format
    await testAPI('/api/chat', {
        text: 'This should also fail',
        images: ['invalid-image-data']
    });
    
    console.log('\n🎉 All tests completed!');
}

// CLI functionality
if (process.argv.length > 2) {
    const imagePath = process.argv[2];
    const text = process.argv[3] || 'What do you see in this image?';
    
    console.log(`📸 Converting image: ${imagePath}`);
    const base64Image = imageToBase64(imagePath);
    
    if (base64Image) {
        console.log('✅ Image converted to base64');
        testAPI('/api/chat', {
            text: text,
            images: [base64Image]
        }).then(() => {
            console.log('🎯 Single image test completed!');
        });
    }
} else {
    // Run all tests
    runTests().catch(console.error);
}

// Export functions for use in other scripts
export { imageToBase64, testAPI, testFormData };

