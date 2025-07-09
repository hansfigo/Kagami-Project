import { analyzeImageContent, analyzeMultipleImages } from '../utils/imageUtils';
import { logger } from '../utils/logger';

/**
 * Test script untuk mengetes analisis gambar
 */
async function testImageAnalysis() {
    try {
        console.log('🧪 Testing Image Analysis System...\n');
        
        // Test dengan gambar kucing (contoh base64 kecil)
        const testImage = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';
        
        console.log('📸 Analyzing test image...');
        const description = await analyzeImageContent(testImage, 'This is a test image');
        console.log(`✅ Generated description: ${description}\n`);
        
        // Test dengan multiple images
        console.log('📸 Analyzing multiple images...');
        const descriptions = await analyzeMultipleImages([testImage, testImage], 'Testing multiple images');
        console.log(`✅ Generated ${descriptions.length} descriptions:`);
        descriptions.forEach((desc, idx) => {
            console.log(`   ${idx + 1}. ${desc}`);
        });
        
        console.log('\n🎉 Image analysis test completed successfully!');
        
    } catch (error) {
        logger.error('❌ Error during image analysis test:', error);
        throw error;
    }
}

// Run the test
if (require.main === module) {
    testImageAnalysis()
        .then(() => {
            console.log('\n✅ Test completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Test failed:', error);
            process.exit(1);
        });
}

export { testImageAnalysis };

