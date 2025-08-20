import { FirebaseStorageService } from "../../../utils/firebaseStorage";
import { analyzeImageContent, analyzeMultipleImages, validateImagesForStorage } from "../../../utils/imageUtils";
import { logger } from "../../../utils/logger";

interface UploadResult {
    url: string;
    path: string;
    fileName: string;
    size: number;
    mimeType: string;
}

interface MessageInput {
    text: string;
    images?: string[]; // Array of base64 encoded images or image URLs
}

interface ProcessedMessageInput {
    text: string;
    imageUrls?: string[]; // Array of Firebase Storage URLs
    originalImages?: string[]; // Original input (for reference)
    base64Images?: string[]; // Base64 images for LLM processing
    imageDescriptions?: string[]; // AI-generated descriptions of images
}

export class ImageService {
    private firebaseStorage: FirebaseStorageService;

    constructor() {
        this.firebaseStorage = new FirebaseStorageService();
    }

    /**
     * Process images from user input - validate, store, and generate descriptions
     */
    async processImages(input: MessageInput): Promise<ProcessedMessageInput> {
        const result: ProcessedMessageInput = {
            text: input.text,
            originalImages: input.images
        };

        if (!input.images || input.images.length === 0) {
            return result;
        }

        try {
            // Validate images
            const validationResult = validateImagesForStorage(input.images);
            if (!validationResult) {
                logger.warn('Image validation failed');
                throw new Error('Image validation failed');
            }

            // Upload images to Firebase Storage
            const uploadPromises = input.images.map(async (image, index) => {
                try {
                    const filename = `chat-image-${Date.now()}-${index}`;
                    const uploadResult = await this.firebaseStorage.uploadBase64Image(image, filename);
                    logger.info(`✅ Image ${index + 1} uploaded successfully`);
                    return uploadResult;
                } catch (error) {
                    logger.error(`❌ Failed to upload image ${index + 1}:`, error);
                    throw new Error(`Failed to upload image ${index + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            });

            const uploadResults = await Promise.all(uploadPromises);
            result.imageUrls = uploadResults.map(r => r.url);

            // Keep base64 images for LLM processing
            result.base64Images = input.images;

            // Generate AI descriptions for the images
            try {
                logger.info('🖼️ Generating AI descriptions for images...');
                const descriptions = await Promise.all(
                    input.images.map(async (image, index) => {
                        try {
                            const description = await analyzeImageContent(image, input.text);
                            logger.info(`✅ Generated description for image ${index + 1}`);
                            return description;
                        } catch (error) {
                            logger.error(`❌ Failed to generate description for image ${index + 1}:`, error);
                            return null;
                        }
                    })
                );

                result.imageDescriptions = descriptions.filter(Boolean) as string[];

                if (result.imageDescriptions.length > 0) {
                    logger.info(`✅ Generated ${result.imageDescriptions.length} image descriptions`);
                }
            } catch (error) {
                logger.error('❌ Failed to generate image descriptions:', error);
                // Don't throw here - descriptions are optional
            }

            // Analyze multiple images for additional context if enabled
            if (input.images.length > 1) {
                try {
                    logger.info('🔍 Analyzing multiple images for context...');
                    const analysis = await analyzeMultipleImages(input.images, input.text);
                    if (analysis) {
                        logger.info('✅ Multi-image analysis completed');
                        // You can add the analysis to the result if needed
                        // result.multiImageAnalysis = analysis;
                    }
                } catch (error) {
                    logger.error('❌ Failed to analyze multiple images:', error);
                    // Don't throw here - analysis is optional
                }
            }

            return result;

        } catch (error) {
            logger.error('❌ Image processing failed:', error);
            throw error;
        }
    }

    /**
     * Download image from Firebase Storage (placeholder - not implemented)
     */
    async downloadImage(url: string): Promise<string> {
        throw new Error('Download functionality not implemented yet');
    }

    /**
     * Delete image from Firebase Storage
     */
    async deleteImage(url: string): Promise<void> {
        try {
            await this.firebaseStorage.deleteImage(url);
            logger.info('✅ Image deleted successfully');
        } catch (error) {
            logger.error('❌ Failed to delete image:', error);
            throw new Error(`Failed to delete image: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}

export const imageService = new ImageService();
