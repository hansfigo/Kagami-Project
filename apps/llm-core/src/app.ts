import { node } from "@elysiajs/node";
import { Elysia } from "elysia";
import multipart from "parse-multipart-data";
import { UserConfig } from "./config";
import { ChatService } from "./features/chat/chat.service";
import { chatHistoryVectorStore } from "./lib/Pinecone";
import { prisma } from "./lib/Prisma";
import { createMessageQueue, createRabbitMQClient, createSafeMessageQueue } from "./lib/RabbitMQ";
import { LEVEL, logger } from "./utils/logger";



export class LLMCore {
    constructor(private server: Elysia, private chatService: ChatService) { }

    public async init(): Promise<void> {
        const hostname = process.env.LISTEN_HOSTNAME

        await this.registerRoutes();

        if (hostname) {
            this.server.listen({
                hostname,
                port: 3000
            });
            logger.info(`LLM Core Server is running on http://${hostname}:3000`);
        }
        else {
            this.server.listen(3000);
            logger.info("LLM Core Server is running on http://localhost:3000");
        }
    }

    private async registerRoutes(): Promise<void> {
        this.server.get("/", () => ({
            hello: "Node.js👋"
        }));

        this.server.get("/health", () => ({
            status: "ok"
        }));

        this.server.get("/health/rabbitmq", () => {
            const isHealthy = this.chatService.isQueueHealthy();
            return {
                status: isHealthy ? "ok" : "degraded",
                rabbitmq: {
                    connected: isHealthy,
                    timestamp: new Date().toISOString()
                }
            };
        });

        this.server.post("/api/chat", async (ctx) => {
            if (!ctx.body) {
                logger.error("Request body is required.");
                ctx.set.status = 400;
                return { error: "Request body is required." };
            }
            
            // Support both legacy format and new multimodal format
            const body = ctx.body as { 
                msg?: string;           // Legacy format
                text?: string;          // New format
                message?: string;       // Alternative format
                images?: string[];      // Array of base64 or URLs
            };

            // Extract text from various possible fields for backward compatibility
            const messageText = body.msg || body.text || body.message;

            if (!messageText || typeof messageText !== 'string') {
                ctx.set.status = 400;
                logger.error("Invalid message format. Please provide a valid text message.");
                return { error: "Invalid message format. Please provide a valid text message." };
            }

            // Validate images if provided
            const images = body.images || [];
            if (images.length > 0) {
                // Basic validation
                if (!Array.isArray(images)) {
                    ctx.set.status = 400;
                    logger.error("Images must be an array of strings.");
                    return { error: "Images must be an array of strings." };
                }

                // Check if any images are provided but empty
                if (images.some(img => !img || typeof img !== 'string')) {
                    ctx.set.status = 400;
                    logger.error("All images must be valid strings (base64 or URLs).");
                    return { error: "All images must be valid strings (base64 or URLs)." };
                }

                logger.info(`Received message with ${images.length} image(s): ${messageText}`);
            } else {
                logger.info(`Received message: ${messageText}`);
            }

            try {
                logger.info(`Processing message for conversation ID: ${UserConfig.conversationId}`);
                
                // Use the enhanced addMessage method that supports images
                const { aiResponse } = images.length > 0 
                    ? await this.chatService.addMessage({ text: messageText, images })
                    : await this.chatService.addMessage(messageText);

                if (!aiResponse) {
                    ctx.set.status = 500;
                    logger.error("Failed to process message.");
                    return { error: "Failed to process message." };
                }

                logger.info("Message processed successfully, returning response.");

                return {
                    message: "Message processed successfully",
                    status: "success",
                    data: {
                        input: {
                            text: messageText,
                            imageCount: images.length,
                            hasImages: images.length > 0
                        },
                        response: aiResponse
                    }
                };
            } catch (error) {
                logger.error("Error processing message:", error);
                ctx.set.status = 500;
                return { 
                    error: "Failed to process message",
                    details: error instanceof Error ? error.message : "Unknown error"
                };
            }
        })

        this.server.get("/api/chat/latest", async (ctx) => {
            logger.info("Retrieving latest message from chat history...");
            const latestMessage = await this.chatService.getLatestMessage();

            if (latestMessage === null) {
                logger.warn("No messages found in the chat history.");
                ctx.set.status = 404;
                return { error: "No messages found." };
            }

            return {
                message: "Latest message retrieved successfully",
                status: "success",
                data: {
                    latestMessage
                }
            }
        })

        this.server.post("/api/chat/search", async (ctx) => {
            const body = ctx.body as { query: string };

            if (!body.query || typeof body.query !== 'string') {
                ctx.set.status = 400;
                return { error: "Invalid query format. Please provide a valid string." };
            }

            try {
                // Use enhanced search that includes image context
                const messages = await this.chatService.searchWithImageContext(body.query);
                return {
                    message: "Search completed successfully",
                    status: "success",
                    data: {
                        query: body.query,
                        results: messages,
                        totalResults: messages.length
                    }
                };
            } catch (error) {
                logger.error("Error searching messages:", error);
                ctx.set.status = 500;
                return { 
                    error: "Failed to search messages",
                    details: error instanceof Error ? error.message : "Unknown error"
                };
            }
        })

        this.server.post("/api/register", async (ctx) => {
            const body = ctx.body as { id: string, name: string, email: string, password: string, isActive?: boolean, isAdmin?: boolean };

            await prisma.user.create({
                data: {
                    id: UserConfig.id,
                    name: body.name,
                    email: body.email,
                    password: body.password,
                    isActive: body.isActive,
                    isAdmin: body.isAdmin
                }
            });

            return {
                message: "Register successful",
                status: "success",
                body: body
            };
        });

        this.server.delete("/api/record/:id", async ({ params: { id } }) => {
            try {
                await chatHistoryVectorStore.delete(
                    [id],
                )

                return {
                    message: "Record deleted successfully",
                };
            } catch (error) {
                console.error("Error deleting record:", error);
                return {
                    message: "Failed to delete record",
                    error: error instanceof Error ? error.message : "Unknown error"
                };
            }

        });

        this.server.delete("/api/namespace/", async (ctx) => {

            await chatHistoryVectorStore.deleteByNamespace('chat-history');

            return {
                message: "namespace deleted successfully",
            };
        });

        // Get message with images
        this.server.get("/api/chat/message/:messageId", async (ctx) => {
            const { messageId } = ctx.params;

            if (!messageId) {
                ctx.set.status = 400;
                return { error: "Message ID is required." };
            }

            try {
                const messageWithImages = await this.chatService.getMessageWithImages(messageId);
                return {
                    message: "Message retrieved successfully",
                    status: "success",
                    data: messageWithImages
                };
            } catch (error) {
                logger.error("Error retrieving message:", error);
                if (error instanceof Error && error.message === 'Message not found') {
                    ctx.set.status = 404;
                    return { error: "Message not found" };
                }
                ctx.set.status = 500;
                return { 
                    error: "Failed to retrieve message",
                    details: error instanceof Error ? error.message : "Unknown error"
                };
            }
        });

        // Dedicated endpoint for text + images (cleaner API)
        this.server.post("/api/chat/multimodal", async (ctx) => {
            if (!ctx.body) {
                logger.error("Request body is required.");
                ctx.set.status = 400;
                return { error: "Request body is required." };
            }

            const body = ctx.body as { 
                text: string;
                images: string[];
            };

            if (!body.text || typeof body.text !== 'string') {
                ctx.set.status = 400;
                logger.error("Text message is required.");
                return { error: "Text message is required." };
            }

            if (!body.images || !Array.isArray(body.images) || body.images.length === 0) {
                ctx.set.status = 400;
                logger.error("At least one image is required for multimodal endpoint.");
                return { error: "At least one image is required for multimodal endpoint." };
            }

            try {
                logger.info(`Processing multimodal message with ${body.images.length} image(s): ${body.text}`);
                
                const { aiResponse } = await this.chatService.addMessageWithImages(body.text, body.images);

                if (!aiResponse) {
                    ctx.set.status = 500;
                    logger.error("Failed to process multimodal message.");
                    return { error: "Failed to process multimodal message." };
                }

                logger.info("Multimodal message processed successfully, returning response.");

                return {
                    message: "Multimodal message processed successfully",
                    status: "success",
                    data: {
                        input: {
                            text: body.text,
                            imageCount: body.images.length
                        },
                        response: aiResponse
                    }
                };
            } catch (error) {
                logger.error("Error processing multimodal message:", error);
                ctx.set.status = 500;
                return { 
                    error: "Failed to process multimodal message",
                    details: error instanceof Error ? error.message : "Unknown error"
                };
            }
        });

        // FormData support endpoint for file uploads (Postman/Hopscotch friendly)
        this.server.post("/api/chat/upload", async (ctx) => {
            try {
                // Check if request is multipart/form-data
                const contentType = ctx.headers['content-type'] || '';
                if (!contentType.includes('multipart/form-data')) {
                    ctx.set.status = 400;
                    return { 
                        error: "This endpoint requires multipart/form-data. Use Content-Type: multipart/form-data" 
                    };
                }

                // Extract form data
                const formData = ctx.body as any;
                
                // Get text message from form field
                const text = formData.text || formData.message || formData.msg;
                if (!text || typeof text !== 'string') {
                    ctx.set.status = 400;
                    return { error: "Text field is required (use 'text', 'message', or 'msg' field)" };
                }

                // Process uploaded files
                const images: string[] = [];
                const files = formData.files || formData.images || [];
                
                // Handle single file or array of files
                const fileArray = Array.isArray(files) ? files : [files].filter(Boolean);
                
                for (const file of fileArray) {
                    if (file && file.size > 0) {
                        // Validate file type
                        const mimeType = file.type || 'image/jpeg';
                        if (!mimeType.startsWith('image/')) {
                            ctx.set.status = 400;
                            return { error: `Invalid file type: ${mimeType}. Only images are allowed.` };
                        }

                        // Validate file size (10MB limit)
                        if (file.size > 10 * 1024 * 1024) {
                            ctx.set.status = 400;
                            return { error: `File too large: ${file.size} bytes. Maximum 10MB allowed.` };
                        }

                        // Convert file to base64
                        const buffer = await file.arrayBuffer();
                        const base64 = Buffer.from(buffer).toString('base64');
                        const dataUrl = `data:${mimeType};base64,${base64}`;
                        images.push(dataUrl);
                    }
                }

                logger.info(`Processing FormData message with ${images.length} uploaded file(s): ${text}`);

                // Process with chat service
                const { aiResponse } = images.length > 0 
                    ? await this.chatService.addMessageWithImages(text, images)
                    : await this.chatService.addMessage(text);

                if (!aiResponse) {
                    ctx.set.status = 500;
                    return { error: "Failed to process message" };
                }

                return {
                    message: "FormData message processed successfully",
                    status: "success",
                    data: {
                        input: {
                            text: text,
                            imageCount: images.length,
                            hasImages: images.length > 0,
                            uploadedFiles: fileArray.map(f => ({
                                name: f.name,
                                size: f.size,
                                type: f.type
                            }))
                        },
                        response: aiResponse
                    }
                };

            } catch (error) {
                logger.error("Error processing FormData:", error);
                ctx.set.status = 500;
                return { 
                    error: "Failed to process FormData",
                    details: error instanceof Error ? error.message : "Unknown error"
                };
            }
        });

        // Simple FormData endpoint that works with base64 in form fields
        this.server.post("/api/chat/form", async (ctx) => {
            try {
                const body = ctx.body as any;
                
                // Extract text from various possible field names
                const text = body?.text || body?.message || body?.msg;
                if (!text || typeof text !== 'string') {
                    ctx.set.status = 400;
                    return { 
                        error: "Text field is required. Send as 'text', 'message', or 'msg' field in form data." 
                    };
                }

                // Extract images from form fields (expecting base64 strings)
                const images: string[] = [];
                
                // Check for common image field names
                const imageFields = ['images', 'image', 'files', 'file'];
                for (const field of imageFields) {
                    const fieldValue = body?.[field];
                    if (fieldValue) {
                        if (Array.isArray(fieldValue)) {
                            images.push(...fieldValue.filter(img => typeof img === 'string' && img.length > 0));
                        } else if (typeof fieldValue === 'string' && fieldValue.length > 0) {
                            images.push(fieldValue);
                        }
                    }
                }

                // Check for numbered image fields (image1, image2, etc.)
                for (let i = 1; i <= 5; i++) {
                    const fieldValue = body?.[`image${i}`] || body?.[`file${i}`];
                    if (fieldValue && typeof fieldValue === 'string' && fieldValue.length > 0) {
                        images.push(fieldValue);
                    }
                }

                // Validate image formats
                for (const image of images) {
                    if (!image.startsWith('data:image/') && !image.startsWith('http')) {
                        ctx.set.status = 400;
                        return { 
                            error: `Invalid image format. Expected base64 data URL or HTTP URL. Got: ${image.substring(0, 50)}...` 
                        };
                    }
                }

                logger.info(`Processing form data with ${images.length} image(s): ${text}`);

                // Process with chat service
                const { aiResponse } = images.length > 0 
                    ? await this.chatService.addMessageWithImages(text, images)
                    : await this.chatService.addMessage(text);

                if (!aiResponse) {
                    ctx.set.status = 500;
                    return { error: "Failed to process message" };
                }

                return {
                    message: "Form data processed successfully",
                    status: "success",
                    data: {
                        input: {
                            text: text,
                            imageCount: images.length,
                            hasImages: images.length > 0,
                            receivedFields: Object.keys(body || {}).filter(k => body[k])
                        },
                        response: aiResponse
                    }
                };

            } catch (error) {
                logger.error("Error processing form data:", error);
                ctx.set.status = 500;
                return { 
                    error: "Failed to process form data",
                    details: error instanceof Error ? error.message : "Unknown error"
                };
            }
        });
    }
}

export async function startServer(): Promise<void> {

    logger.info("Starting LLM Core Server...");
    logger.log({
        level: LEVEL.info,
        message: `Using UserConfig: ${JSON.stringify(UserConfig)}`
    })

    const server = new Elysia({ adapter: node() })
    let MessageQueue: any;
    
    try {
        // Use safe message queue that won't crash the app
        MessageQueue = await createSafeMessageQueue(process.env.RABBITMQ_URL);
        
        const chatService = new ChatService(MessageQueue)

        const llmCore = new LLMCore(server, chatService);
        await llmCore.init();

        logger.info("LLM Core Server started successfully.");
        
        // Graceful shutdown handlers
        const gracefulShutdown = async (signal: string) => {
            logger.info(`Received ${signal}, shutting down gracefully...`);
            
            try {
                if (MessageQueue) {
                    await MessageQueue.close();
                    logger.info('RabbitMQ connection closed');
                }
                
                // Close other resources if needed
                await prisma.$disconnect();
                logger.info('Database connection closed');
                
                logger.info('Graceful shutdown completed');
                process.exit(0);
            } catch (error) {
                logger.error('Error during graceful shutdown:', error);
                process.exit(1);
            }
        };

        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        
        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            logger.error('Uncaught exception:', error);
            // Don't exit, just log the error
        });
        
        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Unhandled rejection at:', promise, 'reason:', reason);
            // Don't exit, just log the error
        });
        
    } catch (error) {
        logger.error("Failed to start LLM Core Server:", error);
        throw error;
    }
}