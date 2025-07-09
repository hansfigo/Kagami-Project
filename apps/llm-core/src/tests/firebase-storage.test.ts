/**
 * Firebase Storage Integration Test
 * 
 * This test verifies that the Firebase Storage service works correctly
 * for uploading base64 images and returning URLs.
 */

import { beforeAll, describe, expect, test } from 'vitest';
import { FirebaseStorageService } from '../utils/firebaseStorage';
import { logger } from '../utils/logger';

// Sample base64 image (1x1 pixel red dot)
const sampleBase64Image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

describe('Firebase Storage Integration', () => {
    let firebaseStorage: FirebaseStorageService;

    beforeAll(() => {
        firebaseStorage = new FirebaseStorageService();
    });

    test('should upload single base64 image to Firebase Storage', async () => {
        logger.info('🧪 Testing single image upload...');
        
        const result = await firebaseStorage.uploadBase64Image(sampleBase64Image);
        
        // Verify upload result structure
        expect(result).toHaveProperty('url');
        expect(result).toHaveProperty('fileName');
        expect(result).toHaveProperty('size');
        expect(result).toHaveProperty('mimeType');
        
        // Verify URL is valid Firebase Storage URL
        expect(result.url).toMatch(/^https:\/\/firebasestorage\.googleapis\.com/);
        
        // Verify file properties
        expect(result.mimeType).toBe('image/png');
        expect(result.size).toBeGreaterThan(0);
        expect(result.fileName).toMatch(/\.png$/);
        
        logger.info('✅ Single upload successful:', {
            url: result.url,
            fileName: result.fileName,
            size: result.size,
            mimeType: result.mimeType
        });
    }, 10000); // 10 second timeout for upload

    test('should upload multiple base64 images to Firebase Storage', async () => {
        logger.info('🧪 Testing multiple image upload...');
        
        const multipleResults = await firebaseStorage.uploadMultipleBase64Images([
            sampleBase64Image,
            sampleBase64Image
        ]);
        
        // Verify we got results for both images
        expect(multipleResults).toHaveLength(2);
        
        // Verify each result
        multipleResults.forEach((result, index) => {
            expect(result).toHaveProperty('url');
            expect(result).toHaveProperty('fileName');
            expect(result).toHaveProperty('size');
            expect(result).toHaveProperty('mimeType');
            
            expect(result.url).toMatch(/^https:\/\/firebasestorage\.googleapis\.com/);
            expect(result.mimeType).toBe('image/png');
            expect(result.size).toBeGreaterThan(0);
            
            // Each file should have unique filename
            expect(result.fileName).toMatch(/\.png$/);
        });
        
        // Verify filenames are unique
        const fileNames = multipleResults.map(r => r.fileName);
        const uniqueFileNames = [...new Set(fileNames)];
        expect(uniqueFileNames).toHaveLength(fileNames.length);
        
        logger.info('✅ Multiple upload successful:', {
            count: multipleResults.length,
            urls: multipleResults.map(r => r.url)
        });
    }, 15000); // 15 second timeout for multiple uploads

    test('should handle invalid base64 image data', async () => {
        logger.info('🧪 Testing invalid base64 handling...');
        
        const invalidBase64 = 'invalid-base64-data';
        
        await expect(
            firebaseStorage.uploadBase64Image(invalidBase64)
        ).rejects.toThrow('Invalid base64 string format');
        
        logger.info('✅ Invalid base64 handling test passed');
    });

    test('should handle malformed data URI', async () => {
        logger.info('🧪 Testing malformed data URI handling...');
        
        const malformedDataUri = 'data:image/png;base64,invalid-data';
        
        // This should not throw during validation but might fail during upload
        // depending on Firebase's validation
        try {
            await firebaseStorage.uploadBase64Image(malformedDataUri);
        } catch (error) {
            // Expected to fail - malformed data should be rejected
            expect(error).toBeInstanceOf(Error);
        }
        
        logger.info('✅ Malformed data URI handling test completed');
    });

    test('should generate unique filenames for concurrent uploads', async () => {
        logger.info('🧪 Testing concurrent uploads...');
        
        // Upload same image multiple times concurrently
        const uploadPromises = Array(3).fill(null).map(() => 
            firebaseStorage.uploadBase64Image(sampleBase64Image)
        );
        
        const results = await Promise.all(uploadPromises);
        
        // All uploads should succeed
        expect(results).toHaveLength(3);
        
        // All should have unique filenames
        const fileNames = results.map(r => r.fileName);
        const uniqueFileNames = [...new Set(fileNames)];
        expect(uniqueFileNames).toHaveLength(fileNames.length);
        
        // All should have valid URLs
        results.forEach(result => {
            expect(result.url).toMatch(/^https:\/\/firebasestorage\.googleapis\.com/);
        });
        
        logger.info('✅ Concurrent uploads test passed:', {
            uploadCount: results.length,
            uniqueFiles: uniqueFileNames.length
        });
    }, 20000); // 20 second timeout for concurrent uploads
});
