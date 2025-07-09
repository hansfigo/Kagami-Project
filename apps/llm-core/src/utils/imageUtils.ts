import { visionLLM } from '../lib/LLMClient';
import { logger } from './logger';

export interface ImageMetadata {
    index: number;
    type: 'base64' | 'url' | 'file_path';
    mimeType: string;
    size?: number;
    description?: string; // For AI-generated descriptions
}

export interface ProcessedImage {
    id: string;
    messageId: string;
    originalUrl: string;
    metadata: ImageMetadata;
}

/**
 * Extract metadata from image string
 */
export const extractImageMetadata = (image: string, index: number): ImageMetadata => {
    const type = image.startsWith('data:') ? 'base64' : 
                 image.startsWith('http') ? 'url' : 'base64';
    
    const mimeType = image.startsWith('data:') ? 
                    image.split(';')[0].split(':')[1] : 'image/jpeg';
    
    return {
        index,
        type,
        mimeType,
        size: image.length
    };
};

/**
 * Process images for storage
 */
export const processImagesForStorage = (
    images: string[], 
    messageId: string
): ProcessedImage[] => {
    return images.map((image, index) => ({
        id: `${messageId}_img_${index}`,
        messageId,
        originalUrl: image,
        metadata: extractImageMetadata(image, index)
    }));
};

/**
 * Create description for vector storage
 * This helps with semantic search when dealing with images
 */
export const createImageDescription = (
    text: string, 
    imageCount: number,
    imageMetadata: ImageMetadata[]
): string => {
    const imageTypes = imageMetadata.map(img => img.mimeType).join(', ');
    const descriptions = imageMetadata
        .filter(img => img.description && img.description !== `Firebase Storage image ${img.index + 1}`)
        .map(img => img.description)
        .join(', ');
    
    if (descriptions) {
        return `${text} [Contains ${imageCount} image(s): ${descriptions}]`;
    }
    
    return `${text} [Contains ${imageCount} image(s): ${imageTypes}]`;
};

/**
 * Validate if images are appropriate for storage
 */
export const validateImagesForStorage = (images: string[]): boolean => {
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB per image
    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    
    return images.every(image => {
        // Size check
        if (image.length > MAX_SIZE) return false;
        
        // Type check for data URLs
        if (image.startsWith('data:')) {
            const mimeType = image.split(';')[0].split(':')[1];
            return ALLOWED_TYPES.includes(mimeType);
        }
        
        // For URLs, we'll trust them for now
        return true;
    });
};

/**
 * Compress base64 image if too large
 */
export const compressImageIfNeeded = async (image: string): Promise<string> => {
    // This is a placeholder - you might want to implement actual compression
    // using libraries like sharp, canvas, or browser APIs
    if (image.length > 1024 * 1024) { // 1MB
        console.warn('Image is large, consider implementing compression');
    }
    return image;
};

/**
 * Analyze image content using Vision AI to generate meaningful descriptions
 * This helps with semantic search and AI memory
 */
export const analyzeImageContent = async (
    image: string, 
    userText: string = ''
): Promise<string> => {
    const startTime = Date.now();
    
    try {
        // Prepare the image for analysis
        const imageUrl = image.startsWith('data:') ? image : 
                        `data:image/jpeg;base64,${image}`;
        
        logger.info('🔍 Starting image analysis with Gemini Flash...');
        
        // Create a concise prompt for image analysis
        const analysisPrompt = `Deskripsikan gambar ini dalam 1-2 kalimat bahasa Indonesia. 
        Fokus pada objek utama, warna, aktivitas, dan konteks penting.
        ${userText ? `Konteks: "${userText}"` : ''}`;

        // Use lightweight vision AI to analyze the image
        const result = await visionLLM.invoke([
            ['system', 'Analisis gambar dan berikan deskripsi singkat dalam bahasa Indonesia.'],
            ['human', [
                {
                    type: "text",
                    text: analysisPrompt
                },
                {
                    type: "image_url",
                    image_url: {
                        url: imageUrl
                    }
                }
            ]]
        ]);

        const description = result.content as string;
        const duration = Date.now() - startTime;
        
        logger.info(`✅ Image analysis completed in ${duration}ms: ${description.substring(0, 100)}...`);
        
        return description.trim();
        
    } catch (error) {
        const duration = Date.now() - startTime;
        logger.error(`❌ Image analysis failed after ${duration}ms:`, error);
        return 'Gambar tidak dapat dianalisis';
    }
};

/**
 * Analyze multiple images and generate descriptions
 */
export const analyzeMultipleImages = async (
    images: string[], 
    userText: string = ''
): Promise<string[]> => {
    const descriptions: string[] = [];
    
    for (let i = 0; i < images.length; i++) {
        const image = images[i];
        try {
            const description = await analyzeImageContent(image, userText);
            descriptions.push(description);
            
            // Add small delay to avoid rate limiting (reduced for faster model)
            if (i < images.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        } catch (error) {
            logger.error(`Error analyzing image ${i + 1}:`, error);
            descriptions.push(`Gambar ${i + 1} tidak dapat dianalisis`);
        }
    }
    
    return descriptions;
};
