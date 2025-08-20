import { node } from "@elysiajs/node";
import { Elysia } from "elysia";
import multipart from "parse-multipart-data";
import { config, UserConfig } from "./config";
import { chatController } from "./features/chat/chat.controller";
import { chatRepository } from "./features/chat/repositories/chat.repository";
import { VectorMessage, vectorStoreService } from "./features/chat/services/vector-store.service";
import { chatHistoryVectorStore } from "./lib/Pinecone";
import { prisma } from "./lib/Prisma";
import { createMessageQueue, createRabbitMQClient, createSafeMessageQueue } from "./lib/RabbitMQ";
import { LEVEL, logger } from "./utils/logger";



export class LLMCore {
    constructor(private server: Elysia) { }

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

        // get system prompt
        this.server.get("/system-prompt", () => {
            return {
                prompt: config.systemPrompt.version
            };
        });

        this.server.get("/health", () => ({
            status: "ok"
        }));

        this.server.get("/health/rabbitmq", () => {
            // Since we're using modular architecture, we'll return a simple health check
            return {
                status: "ok",
                rabbitmq: {
                    connected: true, // Simplified for modular architecture
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

                // Use the enhanced chatController method that supports images
                const result = images.length > 0
                    ? await chatController.processMessage({ text: messageText, images })
                    : await chatController.processMessage(messageText);

                // Check if there was an error during processing
                if (result.error) {
                    ctx.set.status = 500;
                    logger.error(`Message processing failed: ${result.error.message}`);
                    return {
                        error: "Message processing failed",
                        details: {
                            type: result.error.type,
                            message: result.error.message,
                            step: result.error.details?.step,
                            duration: result.error.details?.duration,
                            timestamp: result.error.details?.timestamp
                        },
                        fallbackResponse: result.aiResponse,
                        status: "error_with_fallback"
                    };
                }

                const { aiResponse } = result;
                
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
            const latestMessage = await chatController.getLatestMessage();

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
                const messages = await chatController.searchWithImageContext(body.query);
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

        // Get latest vector messages from Pinecone
        this.server.get("/api/vector/latest", async (ctx) => {
            try {
                // Get limit from query parameter, default to 10, max 50
                const limitParam = ctx.query.limit;
                let limit = 10;
                
                if (limitParam) {
                    const parsedLimit = parseInt(limitParam as string);
                    if (!isNaN(parsedLimit) && parsedLimit > 0) {
                        limit = Math.min(parsedLimit, 50); // Max 50 messages
                    }
                }

                logger.info(`Retrieving latest ${limit} vector messages from Pinecone...`);

                // Use the new getLatestMessages method instead of empty query
                const messages = await vectorStoreService.getLatestMessages(limit);

                return {
                    message: "Latest vector messages retrieved successfully",
                    status: "success",
                    data: {
                        messages: messages,
                        totalMessages: messages.length,
                        limit: limit,
                        conversationId: UserConfig.conversationId
                    }
                };
            } catch (error) {
                logger.error("Error retrieving latest vector messages:", error);
                ctx.set.status = 500;
                return {
                    error: "Failed to retrieve latest vector messages",
                    details: error instanceof Error ? error.message : "Unknown error"
                };
            }
        })

        // Debug endpoint to verify chunk IDs
        this.server.get("/api/vector/verify/:chunkId", async (ctx) => {
            try {
                const { chunkId } = ctx.params;
                
                if (!chunkId) {
                    ctx.set.status = 400;
                    return { error: "Chunk ID is required." };
                }

                logger.info(`Verifying chunk ID: ${chunkId}`);

                // Try to find the chunk in Pinecone
                const results = await chatHistoryVectorStore.search("*", 1000, { 
                    conversationId: UserConfig.conversationId 
                });
                
                const foundChunk = results.find((doc: any) => doc.id === chunkId || doc.metadata?.id === chunkId);
                
                return {
                    message: foundChunk ? "Chunk found" : "Chunk not found",
                    status: "success",
                    data: {
                        chunkId: chunkId,
                        found: !!foundChunk,
                        chunk: foundChunk ? {
                            id: foundChunk.id,
                            metadataId: foundChunk.metadata?.id,
                            role: foundChunk.metadata?.role,
                            messageId: foundChunk.metadata?.messageId,
                            chunkIndex: foundChunk.metadata?.chunkIndex,
                            content: foundChunk.pageContent?.substring(0, 100) + "..."
                        } : null,
                        totalSearchResults: results.length
                    }
                };
            } catch (error) {
                logger.error("Error verifying chunk ID:", error);
                ctx.set.status = 500;
                return {
                    error: "Failed to verify chunk ID",
                    details: error instanceof Error ? error.message : "Unknown error"
                };
            }
        })

        // Debug endpoint to compare database vs vector store for a message
        this.server.get("/api/debug/message/:messageId", async (ctx) => {
            try {
                const { messageId } = ctx.params;
                
                if (!messageId) {
                    ctx.set.status = 400;
                    return { error: "Message ID is required." };
                }

                // Get message from database
                const dbMessage = await prisma.message.findUnique({
                    where: { id: messageId }
                });

                if (!dbMessage) {
                    ctx.set.status = 404;
                    return { error: "Message not found in database." };
                }

                // Get all chunks from vector store for this message
                const vectorResults = await chatHistoryVectorStore.search("*", 1000, { 
                    conversationId: UserConfig.conversationId,
                    messageId: messageId
                });

                // Extract metadata
                const dbMetadata = dbMessage.metadata as any;
                const vectorChunkIds = dbMetadata?.metadata?.vectorChunkIds || [];
                
                // Check which chunks exist in vector store
                const vectorChunkChecks = vectorChunkIds.map((chunkId: string) => {
                    const found = vectorResults.find((doc: any) => doc.id === chunkId);
                    return {
                        chunkId: chunkId,
                        existsInVector: !!found,
                        vectorMetadata: found ? {
                            id: found.id,
                            messageId: found.metadata?.messageId,
                            role: found.metadata?.role,
                            chunkIndex: found.metadata?.chunkIndex
                        } : null
                    };
                });

                return {
                    message: "Debug comparison completed",
                    status: "success",
                    data: {
                        messageId: messageId,
                        database: {
                            role: dbMessage.role,
                            createdAt: dbMessage.createdAt,
                            vectorChunkIds: vectorChunkIds,
                            vectorChunkCount: dbMetadata?.metadata?.vectorChunkCount || 0,
                            chunked: dbMetadata?.metadata?.chunked || false
                        },
                        vectorStore: {
                            totalChunksFound: vectorResults.length,
                            chunkIds: vectorResults.map((doc: any) => doc.id),
                            allChunks: vectorResults.map((doc: any) => ({
                                id: doc.id,
                                messageId: doc.metadata?.messageId,
                                chunkIndex: doc.metadata?.chunkIndex,
                                contentPreview: doc.pageContent?.substring(0, 50) + "..."
                            }))
                        },
                        chunkValidation: vectorChunkChecks,
                        issues: {
                            missingChunks: vectorChunkChecks.filter((c: any) => !c.existsInVector).length,
                            extraChunks: vectorResults.length - vectorChunkIds.length,
                            mismatchedCount: vectorResults.length !== vectorChunkIds.length
                        }
                    }
                };
            } catch (error) {
                logger.error("Error in debug comparison:", error);
                ctx.set.status = 500;
                return {
                    error: "Failed to debug message",
                    details: error instanceof Error ? error.message : "Unknown error"
                };
            }
        })

        // Fix chunk IDs for a specific message
        this.server.post("/api/debug/fix-chunks/:messageId", async (ctx) => {
            try {
                const { messageId } = ctx.params;
                
                if (!messageId) {
                    ctx.set.status = 400;
                    return { error: "Message ID is required." };
                }

                // Get message from database
                const dbMessage = await prisma.message.findUnique({
                    where: { id: messageId }
                });

                if (!dbMessage) {
                    ctx.set.status = 404;
                    return { error: "Message not found in database." };
                }

                if (dbMessage.role !== 'assistant') {
                    ctx.set.status = 400;
                    return { error: "Can only fix chunk IDs for assistant messages." };
                }

                // Get all chunks from vector store for this message
                const vectorResults = await chatHistoryVectorStore.search("*", 1000, { 
                    conversationId: UserConfig.conversationId,
                    messageId: messageId
                });

                if (vectorResults.length === 0) {
                    return {
                        message: "No chunks found in vector store for this message",
                        status: "warning"
                    };
                }

                // Extract the correct chunk IDs from vector store
                const correctChunkIds = vectorResults.map((doc: any) => doc.id);
                
                // Update the database with correct chunk IDs
                await chatRepository.updateMessageWithChunkIds(messageId, correctChunkIds);

                return {
                    message: "Successfully fixed chunk IDs",
                    status: "success",
                    data: {
                        messageId: messageId,
                        oldChunkCount: (dbMessage.metadata as any)?.metadata?.vectorChunkCount || 0,
                        newChunkCount: correctChunkIds.length,
                        correctedChunkIds: correctChunkIds
                    }
                };
            } catch (error) {
                logger.error("Error fixing chunk IDs:", error);
                ctx.set.status = 500;
                return {
                    error: "Failed to fix chunk IDs",
                    details: error instanceof Error ? error.message : "Unknown error"
                };
            }
        })

        // Delete latest chat pair (user message + AI response)
        this.server.delete("/api/chat/latest-pair", async (ctx) => {
            logger.info("Deleting latest chat pair (user + AI messages)...");
            
            try {
                // Get the latest 3 messages to ensure we can find a proper pair
                const latestMessages = await prisma.message.findMany({
                    where: {
                        conversationId: UserConfig.conversationId,
                        conversation: {
                            userId: UserConfig.id
                        }
                    },
                    orderBy: {
                        createdAt: 'desc'
                    },
                    take: 3, // Get latest 3 messages to find proper pair
                    include: {
                        images: true // Include images for cleanup
                    }
                });

                if (latestMessages.length === 0) {
                    logger.warn("No messages found to delete.");
                    ctx.set.status = 404;
                    return { 
                        error: "No messages found to delete.",
                        status: "error"
                    };
                }

                // Find the most recent assistant message and its corresponding user message
                let assistantMessage = null;
                let userMessage = null;
                let messagesToDelete = [];

                // Look for the latest assistant message
                for (const msg of latestMessages) {
                    if (msg.role === 'assistant' && !assistantMessage) {
                        assistantMessage = msg;
                        break;
                    }
                }

                // If we found an assistant message, look for the user message that came before it
                if (assistantMessage) {
                    for (const msg of latestMessages) {
                        if (msg.role === 'user' && 
                            new Date(msg.createdAt) < new Date(assistantMessage.createdAt)) {
                            userMessage = msg;
                            break;
                        }
                    }
                    
                    // If we found both, delete the pair
                    if (userMessage) {
                        messagesToDelete = [assistantMessage, userMessage];
                        logger.info(`Found proper chat pair to delete: user(${userMessage.id}) + assistant(${assistantMessage.id})`);
                    } else {
                        // Only assistant message without corresponding user - delete just assistant
                        messagesToDelete = [assistantMessage];
                        logger.info(`Found lone assistant message to delete: ${assistantMessage.id}`);
                    }
                } else {
                    // No assistant message found, check if there's a lone user message
                    const loneUserMessage = latestMessages.find(msg => msg.role === 'user');
                    if (loneUserMessage) {
                        messagesToDelete = [loneUserMessage];
                        logger.info(`Found lone user message to delete: ${loneUserMessage.id}`);
                    } else {
                        logger.warn("No valid messages found to delete.");
                        ctx.set.status = 404;
                        return { 
                            error: "No valid messages found to delete.",
                            status: "error"
                        };
                    }
                }

                // Collect all message IDs and image URLs for cleanup
                const messageIds = messagesToDelete.map(msg => msg.id);
                const imageUrls: string[] = [];
                
                for (const msg of messagesToDelete) {
                    if (msg.images && msg.images.length > 0) {
                        imageUrls.push(...msg.images.map(img => img.imageUrl));
                    }
                }

                // Delete from database (with cascade for images)
                await prisma.$transaction(async (tx) => {
                    // Delete message images first
                    await tx.messageImage.deleteMany({
                        where: {
                            messageId: {
                                in: messageIds
                            }
                        }
                    });

                    // Delete messages
                    await tx.message.deleteMany({
                        where: {
                            id: {
                                in: messageIds
                            }
                        }
                    });
                });

                // Delete from vector store (Pinecone)
                try {
                    for (const msg of messagesToDelete) {
                        if (msg.role === 'user') {
                            // Delete user message directly (user messages use their ID as vector ID)
                            await chatHistoryVectorStore.delete([msg.id]);
                            logger.info(`Deleted user message from vector store: ${msg.id}`);
                        } else if (msg.role === 'assistant') {
                            // For assistant messages, we need to find and delete all chunks
                            // First try to use chunk IDs from PostgreSQL metadata if available
                            
                            let allChunkIds: string[] = [];
                            
                            // Method 1: Try to get chunk IDs from PostgreSQL metadata (most reliable)
                            try {
                                const vectorChunkIds = (msg as any).metadata?.metadata?.vectorChunkIds;
                                if (vectorChunkIds && Array.isArray(vectorChunkIds) && vectorChunkIds.length > 0) {
                                    allChunkIds.push(...vectorChunkIds);
                                    logger.info(`Found ${vectorChunkIds.length} chunk IDs from PostgreSQL metadata for assistant message: ${msg.id}`);
                                } else {
                                    logger.info(`No chunk IDs found in PostgreSQL metadata for assistant message: ${msg.id}, falling back to search`);
                                }
                            } catch (metadataError) {
                                logger.warn(`Failed to extract chunk IDs from metadata for message ${msg.id}:`, metadataError);
                            }
                            
                            // Method 2: If no chunk IDs in metadata, try search-based approach
                            if (allChunkIds.length === 0) {
                                try {
                                    // Try multiple search queries to find chunks for this assistant message
                                    const searchQueries = [
                                        'assistant response',
                                        'AI response',
                                        msg.content?.substring(0, 50) || 'assistant message', // Use part of actual content
                                        '' // Empty query as final fallback
                                    ];
                                    
                                    for (const query of searchQueries) {
                                        try {
                                            const searchResults = await chatHistoryVectorStore.search(query, 200, { 
                                                messageId: msg.id, 
                                                role: 'assistant' 
                                            });
                                            
                                            if (searchResults.length > 0) {
                                                const searchChunkIds = searchResults
                                                    .map((chunk: any) => chunk.metadata?.id)
                                                    .filter((id: any) => id !== undefined && id !== null);
                                                allChunkIds.push(...searchChunkIds);
                                                logger.info(`Found ${searchChunkIds.length} chunks with query "${query.substring(0, 30)}..." for assistant message: ${msg.id}`);
                                                break; // Stop after finding chunks
                                            }
                                        } catch (queryError) {
                                            logger.warn(`Search query "${query.substring(0, 30)}..." failed:`, queryError);
                                            continue;
                                        }
                                    }
                                } catch (searchError) {
                                    logger.warn(`All search methods failed for assistant message ${msg.id}:`, searchError);
                                }
                            }
                            
                            // Delete found chunk IDs
                            if (allChunkIds.length > 0) {
                                // Remove duplicates
                                const uniqueChunkIds = [...new Set(allChunkIds)];
                                await chatHistoryVectorStore.delete(uniqueChunkIds);
                                logger.info(`Successfully deleted ${uniqueChunkIds.length} assistant chunks from vector store for message: ${msg.id}`);
                                logger.debug(`Deleted chunk IDs: ${uniqueChunkIds.join(', ')}`);
                            } else {
                                logger.warn(`No chunks found for assistant message: ${msg.id} - trying direct deletion`);
                                
                                // Fallback: Try to delete using the messageId directly
                                try {
                                    await chatHistoryVectorStore.delete([msg.id]);
                                    logger.info(`Fallback: Successfully deleted assistant message directly by ID: ${msg.id}`);
                                } catch (fallbackError) {
                                    logger.error(`All deletion methods failed for assistant message ${msg.id}:`, fallbackError);
                                }
                            }
                        }
                    }
                } catch (vectorError) {
                    logger.warn("Error deleting from vector store:", vectorError);
                    // Continue even if vector store deletion fails
                }

                // Verification: Check if vector store deletion was successful
                try {
                    for (const msg of messagesToDelete) {
                        if (msg.role === 'assistant') {
                            // Check if any chunks still exist for this assistant message
                            const verificationResults = await chatHistoryVectorStore.search('', 50, { 
                                messageId: msg.id, 
                                role: 'assistant' 
                            });
                            
                            if (verificationResults.length > 0) {
                                logger.warn(`VERIFICATION: ${verificationResults.length} chunks still exist for assistant message ${msg.id}. IDs: ${verificationResults.map((r: any) => r.metadata?.id).join(', ')}`);
                            } else {
                                logger.info(`VERIFICATION: All chunks successfully deleted for assistant message ${msg.id}`);
                            }
                        }
                    }
                } catch (verificationError) {
                    logger.warn("Verification check failed:", verificationError);
                }

                const deletedCount = messagesToDelete.length;
                const deletedTypes = messagesToDelete.map(msg => msg.role).join(' + ');
                const wasProperPair = deletedCount === 2 && 
                                    messagesToDelete.some(msg => msg.role === 'user') && 
                                    messagesToDelete.some(msg => msg.role === 'assistant');

                logger.info(`Successfully deleted ${deletedCount} message(s): ${deletedTypes}`);

                return {
                    message: `Successfully deleted latest chat ${deletedCount === 2 ? 'pair' : 'message'}`,
                    status: "success",
                    data: {
                        deletedMessages: deletedCount,
                        deletedTypes: deletedTypes,
                        deletedIds: messageIds,
                        deletedImages: imageUrls.length,
                        wasProperPair: wasProperPair
                    }
                };

            } catch (error) {
                logger.error("Error deleting latest chat pair:", error);
                ctx.set.status = 500;
                return {
                    error: "Failed to delete latest chat pair",
                    details: error instanceof Error ? error.message : "Unknown error",
                    status: "error"
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
                const messageWithImages = await chatController.getMessageWithImages(messageId);
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

                const { aiResponse } = await chatController.processMessage({ text: body.text, images: body.images });

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

                // Process with chat controller
                const { aiResponse } = images.length > 0
                    ? await chatController.processMessage({ text, images })
                    : await chatController.processMessage(text);

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

                // Process with chat controller
                const { aiResponse } = images.length > 0
                    ? await chatController.processMessage({ text, images })
                    : await chatController.processMessage(text);

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

        const llmCore = new LLMCore(server);
        await llmCore.init();

        logger.info("LLM Core Server started successfully.");

        const gracefulShutdown = async (signal: string) => {
            logger.info(`Received ${signal}, shutting down gracefully...`);

            try {
                if (MessageQueue) {
                    await MessageQueue.close();
                    logger.info('RabbitMQ connection closed');
                }

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

        process.on('uncaughtException', (error) => {
            logger.error('Uncaught exception:', error);
        });

        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Unhandled rejection at:', promise, 'reason:', reason);
        });

    } catch (error) {
        logger.error("Failed to start LLM Core Server:", error);
        throw error;
    }
}