import 'dotenv/config'; // Load environment variables from .env file
import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import { deleteObject, FirebaseStorage, getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger';

interface FirebaseConfig {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket: string;
    messagingSenderId: string;
    appId: string;
}

interface UploadResult {
    url: string;
    path: string;
    fileName: string;
    size: number;
    mimeType: string;
}

export class FirebaseStorageService {
    private app!: FirebaseApp;
    private storage!: FirebaseStorage;
    private bucketName!: string;

    constructor() {
        this.initializeFirebase();
    }

    private initializeFirebase() {
        const firebaseConfig: FirebaseConfig = {
            apiKey: process.env.FIREBASE_API_KEY!,
            authDomain: process.env.FIREBASE_AUTH_DOMAIN!,
            projectId: process.env.FIREBASE_PROJECT_ID!,
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET!,
            messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID!,
            appId: process.env.FIREBASE_APP_ID!
        };

        this.bucketName = firebaseConfig.storageBucket;

        // Initialize Firebase only if not already initialized
        if (getApps().length === 0) {
            this.app = initializeApp(firebaseConfig);
        } else {
            this.app = getApps()[0];
        }

        this.storage = getStorage(this.app);
        logger.info('Firebase Storage initialized successfully');
    }

    /**
     * Upload base64 image to Firebase Storage
     */
    async uploadBase64Image(
        base64Data: string, 
        fileName?: string, 
        folder: string = 'chat-images'
    ): Promise<UploadResult> {
        try {
            // Extract mime type and data from base64 string
            const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (!matches || matches.length !== 3) {
                throw new Error('Invalid base64 string format');
            }

            const mimeType = matches[1];
            const data = matches[2];
            
            // Generate unique filename if not provided
            const fileExtension = this.getFileExtension(mimeType);
            const uniqueFileName = fileName || `${uuidv4()}.${fileExtension}`;
            const filePath = `${folder}/${uniqueFileName}`;

            // Convert base64 to buffer
            const buffer = Buffer.from(data, 'base64');
            const uint8Array = new Uint8Array(buffer);

            // Create reference and upload
            const storageRef = ref(this.storage, filePath);
            const metadata = {
                contentType: mimeType,
                customMetadata: {
                    uploadedAt: new Date().toISOString(),
                    originalFormat: 'base64'
                }
            };

            const snapshot = await uploadBytes(storageRef, uint8Array, metadata);
            const downloadURL = await getDownloadURL(snapshot.ref);

            logger.info(`Image uploaded successfully: ${filePath}`);

            return {
                url: downloadURL,
                path: filePath,
                fileName: uniqueFileName,
                size: buffer.length,
                mimeType
            };

        } catch (error) {
            logger.error('Error uploading base64 image:', error);
            throw new Error(`Failed to upload image: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Upload multiple base64 images
     */
    async uploadMultipleBase64Images(
        base64Images: string[], 
        folder: string = 'chat-images'
    ): Promise<UploadResult[]> {
        const uploadPromises = base64Images.map((base64, index) => 
            this.uploadBase64Image(base64, undefined, folder)
        );

        try {
            const results = await Promise.all(uploadPromises);
            logger.info(`Successfully uploaded ${results.length} images`);
            return results;
        } catch (error) {
            logger.error('Error uploading multiple images:', error);
            throw new Error('Failed to upload one or more images');
        }
    }

    /**
     * Upload file buffer to Firebase Storage
     */
    async uploadFileBuffer(
        buffer: Buffer, 
        fileName: string, 
        mimeType: string, 
        folder: string = 'chat-images'
    ): Promise<UploadResult> {
        try {
            const filePath = `${folder}/${fileName}`;
            const uint8Array = new Uint8Array(buffer);

            const storageRef = ref(this.storage, filePath);
            const metadata = {
                contentType: mimeType,
                customMetadata: {
                    uploadedAt: new Date().toISOString(),
                    originalFormat: 'buffer'
                }
            };

            const snapshot = await uploadBytes(storageRef, uint8Array, metadata);
            const downloadURL = await getDownloadURL(snapshot.ref);

            logger.info(`File uploaded successfully: ${filePath}`);

            return {
                url: downloadURL,
                path: filePath,
                fileName,
                size: buffer.length,
                mimeType
            };

        } catch (error) {
            logger.error('Error uploading file buffer:', error);
            throw new Error(`Failed to upload file: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Delete image from Firebase Storage
     */
    async deleteImage(filePath: string): Promise<void> {
        try {
            const storageRef = ref(this.storage, filePath);
            await deleteObject(storageRef);
            logger.info(`Image deleted successfully: ${filePath}`);
        } catch (error) {
            logger.error('Error deleting image:', error);
            throw new Error(`Failed to delete image: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get file extension from mime type
     */
    private getFileExtension(mimeType: string): string {
        const mimeToExt: { [key: string]: string } = {
            'image/jpeg': 'jpg',
            'image/jpg': 'jpg',
            'image/png': 'png',
            'image/gif': 'gif',
            'image/webp': 'webp',
            'image/bmp': 'bmp',
            'image/svg+xml': 'svg'
        };

        return mimeToExt[mimeType] || 'jpg';
    }

    /**
     * Validate image format
     */
    isValidImageFormat(mimeType: string): boolean {
        const validFormats = [
            'image/jpeg',
            'image/jpg', 
            'image/png',
            'image/gif',
            'image/webp',
            'image/bmp'
        ];

        return validFormats.includes(mimeType);
    }

    /**
     * Extract image info from base64
     */
    extractImageInfo(base64Data: string): { mimeType: string; size: number } | null {
        try {
            const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (!matches || matches.length !== 3) {
                return null;
            }

            const mimeType = matches[1];
            const data = matches[2];
            const size = Buffer.from(data, 'base64').length;

            return { mimeType, size };
        } catch (error) {
            return null;
        }
    }
}

// Singleton instance
export const firebaseStorage = new FirebaseStorageService();
