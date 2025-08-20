// import { Document } from "@langchain/core/documents";
// import { writeFileSync } from "fs";
// import { v4 as uuidv4 } from 'uuid';
// import { config, createSystemPromot, UserConfig } from "../../config";
// import { llm, secondaryLlm } from "../../lib/LLMClient";
// import { chatHistoryVectorStore } from "../../lib/Pinecone";
// import { prisma } from "../../lib/Prisma";
// import { IMessageQueue } from "../../lib/RabbitMQ";
// import { chunkText } from "../../utils/chunking";
// import { getCurrentDateTimeInfo } from "../../utils/date";
// import { FirebaseStorageService } from "../../utils/firebaseStorage";
// import { analyzeMultipleImages, createImageDescription, validateImagesForStorage } from "../../utils/imageUtils";
// import { logger } from "../../utils/logger";
// import { chatRepository } from "./chat.repository";

// interface MessageInput {
//     text: string;
//     images?: string[]; // Array of base64 encoded images or image URLs
// }

// interface ProcessedMessageInput {
//     text: string;
//     imageUrls?: string[]; // Array of Firebase Storage URLs
//     originalImages?: string[]; // Original input (for reference)
//     base64Images?: string[]; // Base64 images for LLM processing
//     imageDescriptions?: string[]; // AI-generated descriptions of images
// }

// export interface IChatService {
//     addMessage(input: string | MessageInput): Promise<unknown>;
//     getMessages(): string[];
//     clearMessages(): void;
//     getMessageCount(): number;
//     getLatestMessage(): Promise<string>;
// }

// export class ChatService implements IChatService {
//     private messages: string[] = [];
//     private firebaseStorage: FirebaseStorageService;

//     constructor(
//         private messageQueue: IMessageQueue
//     ) {
//         this.firebaseStorage = new FirebaseStorageService();
//     }

//     public isQueueHealthy(): boolean {
//         return this.messageQueue.isHealthy();
//     }

//     public async addMessage(input: string | MessageInput) {
//         // Normalize input
//         const messageData: MessageInput = typeof input === 'string'
//             ? { text: input, images: [] }
//             : input;

//         const { text: message, images } = messageData;
//         const userMessageId = uuidv4();

//         // Validate input
//         if (!message || message.trim().length === 0) {
//             throw new Error('Message text cannot be empty');
//         }

//         // Process images: upload to Firebase Storage and get URLs
//         let processedData: ProcessedMessageInput & { base64Images: string[]; imageDescriptions?: string[] } = { text: message, base64Images: [] };

//         if (images && images.length > 0) {
//             logger.info(`Processing ${images.length} image(s) for message`);

//             // Validate images first
//             if (!this.validateImages(images)) {
//                 throw new Error('Invalid image format. Images must be base64 strings, data URLs, or HTTP URLs');
//             }
//             if (!validateImagesForStorage(images)) {
//                 throw new Error('Images exceed size limit or contain unsupported formats');
//             }

//             try {
//                 processedData = await this.processImagesForStorage(messageData);
//                 logger.info(`Successfully uploaded ${processedData.imageUrls?.length || 0} image(s) to Firebase Storage`);
//                 logger.info(`Generated ${processedData.imageDescriptions?.length || 0} image description(s)`);
//             } catch (error) {
//                 logger.error('Failed to upload images to Firebase Storage:', error);
//                 throw new Error(`Image upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
//             }
//         }


//         logger.info(`Checking user conversation and message duplicates...`);
//         await checkIfUserConversationExists(UserConfig.id, UserConfig.conversationId);
//         const existingMessage = await checkIfUserMessageDuplicate(userMessageId)

//         // const userFacts = await userProfileVectorStore.search(message);
//         // const userProfileContext = userFacts.map((doc: Document) => doc.metadata.originalText).join('\n');

//         // Get ONLY semantic context from vector store for system prompt
//         logger.info(`Getting semantic context from vector store...`);
//         const semanticContext = await getRelevantChatHistory(message);
        
//         // Get recent database messages ONLY for conversation history (not system prompt)
//         const recentChatHistory = await getRecentChatHistory(UserConfig.id);
//         const recentChatHistoryMessages = recentChatHistory.slice(-8).map(msg => {
//             // Parse the formatted message back to get role and content
//             const match = msg.match(/^\[(\w+)\] \(.*?\): (.*)$/);
//             if (match) {
//                 return {
//                     id: `db_${Date.now()}_${Math.random()}`,
//                     role: match[1],
//                     content: match[2],
//                     timestamp: Date.now(),
//                     source: 'database' as const,
//                     conversationId: UserConfig.conversationId
//                 };
//             }
//             return null;
//         }).filter(Boolean) as CombinedMessage[];

//         logger.info(`Context ready: ${semanticContext.split('\n').length} semantic messages, ${recentChatHistoryMessages.length} recent messages`);

//         logger.info(`Creating system prompt with pure semantic context...`);
//         const systemPromptVersion = config.systemPrompt.version as keyof typeof createSystemPromot;

//         // Create system prompt with ONLY semantic context (no database duplicates)
//         let rawSystemPrompt: string;
//         if (systemPromptVersion === 'optimized-v2') {
//             // For optimized-v2: use pure semantic context
//             rawSystemPrompt = (createSystemPromot[systemPromptVersion] as any)(
//                 semanticContext, // Pure vector store context
//                 getCurrentDateTimeInfo(),
//                 undefined // userProfileContext - placeholder for future user profile feature
//             );
//         } else {
//             // For legacy system prompts: use traditional format
//             rawSystemPrompt = createSystemPromot[systemPromptVersion](
//                 semanticContext, // Pure semantic context from vector store
//                 getCurrentDateTimeInfo(),
//                 [], // No recent chat in system prompt - it goes to conversation context
//                 undefined // userProfileContext
//             );
//         }

//         // Clean system prompt to reduce token usage
//         const systemPrompt = cleanSystemPrompt(rawSystemPrompt);

//         const originalTokens = estimateTokens(rawSystemPrompt);
//         const cleanedTokens = estimateTokens(systemPrompt);
//         const tokenSavings = originalTokens - cleanedTokens;

//         logger.info(`System prompt ready - ${cleanedTokens} tokens (saved: ${tokenSavings}), conversation: ${recentChatHistoryMessages.length} messages`);

//         logger.info(`Calling LLM with semantic system prompt + conversation history...`);
//         const { aiResponse, aiMessageCreatedAt } = await callLLM(message, systemPrompt, processedData.base64Images, recentChatHistoryMessages);

//         const aiMessageId = uuidv4();
//         const userMessageCreatedAt = Date.now();

//         const queueMessagePayload = {
//             user: {
//                 id: UserConfig.id,
//                 conversationId: UserConfig.conversationId,
//                 userMessageId,
//                 userMessageCreatedAt,
//                 message,
//                 images: processedData.imageUrls || [],
//                 imageDescriptions: processedData.imageDescriptions || []
//             },
//             ai: {
//                 aiMessageId,
//                 aiMessageCreatedAt,
//                 aiResponse,
//             }
//         }

//         await this.messageQueue.sendToQueue('kagami.chat_memory.process', queueMessagePayload);

//         logger.info(`Saving chat message to database and vector store...`);
//         // Save message to database with image URLs (not base64)
//         await saveChatMessage({
//             user: {
//                 id: UserConfig.id,
//                 conversationId: UserConfig.conversationId,
//                 userMessageId,
//                 userMessageCreatedAt,
//                 message,
//                 images: processedData.imageUrls || [],
//                 imageDescriptions: processedData.imageDescriptions || []
//             },
//             ai: {
//                 aiMessageId,
//                 aiMessageCreatedAt,
//                 aiResponse,
//                 systemPrompt
//             }
//         });

//         if (!existingMessage) {
//             logger.info('User message already exists in chat history, skipping upsert:', existingMessage);

//             try {
//                 // Create enhanced page content for better semantic search
//                 // Use URLs for metadata, not base64 data
//                 const imageUrls = processedData.imageUrls || [];
//                 const imageDescriptions = processedData.imageDescriptions || [];

//                 const imageMetadata = imageUrls.length > 0 ?
//                     imageUrls.map((url, idx) => ({
//                         index: idx,
//                         type: 'url' as const,
//                         mimeType: 'image/jpeg', // Default, could be enhanced later
//                         description: imageDescriptions[idx] || `Firebase Storage image ${idx + 1}`,
//                         url: url
//                     })) : [];

//                 // Create enhanced page content that includes image descriptions for better search
//                 let enhancedPageContent = message;
//                 if (imageUrls.length > 0 && imageDescriptions.length > 0) {
//                     const imageDescText = imageDescriptions.map((desc, idx) =>
//                         `Gambar ${idx + 1}: ${desc}`
//                     ).join('; ');
//                     enhancedPageContent = `${message} [Berisi ${imageUrls.length} gambar: ${imageDescText}]`;
//                 } else if (imageUrls.length > 0) {
//                     enhancedPageContent = createImageDescription(message, imageUrls.length, imageMetadata);
//                 }

//                 // 1. Add user input to chat history with image URLs and descriptions
//                 const userInputDocs = new Document({
//                     pageContent: enhancedPageContent,
//                     metadata: {
//                         id: userMessageId,
//                         conversationId: UserConfig.conversationId, // Fixed typo
//                         userId: UserConfig.id,
//                         timestamp: userMessageCreatedAt,
//                         role: 'user',
//                         messageId: userMessageId,
//                         chunkIndex: 0,
//                         hasImages: (imageUrls.length > 0),
//                         imageCount: imageUrls.length,
//                         originalText: message, // Keep original text separate
//                         // Store image URLs, descriptions, and metadata
//                         imageUrls: imageUrls,
//                         imageDescriptions: imageDescriptions,
//                         imageMetadata: imageMetadata
//                     }
//                 });

//                 await chatHistoryVectorStore.upsert(userInputDocs);
//             } catch (error) {
//                 logger.error('Error saat menyimpan pesan user ke chat history:', error);
//                 throw new Error('Gagal menyimpan pesan user ke chat history');
//             }
//         }

//         // chunking aiResponse if it is too long
//         const chunkSize = 800;
//         const chunkOverlap = 100;

//         const chunks: Document[] = await chunkText(aiResponse as string, {
//             chunkSize: chunkSize,
//             chunkOverlap: chunkOverlap
//         });

//         const docsToUpsert = chunks.map((chunk, index) => {
//             const chunkDocsId = uuidv4();

//             return new Document({
//                 id: chunkDocsId,
//                 pageContent: chunk.pageContent,
//                 metadata: {
//                     id: chunkDocsId,
//                     conversationId: UserConfig.conversationId, // Fixed typo
//                     userId: UserConfig.id,
//                     timestamp: aiMessageCreatedAt,
//                     chunkIndex: index,
//                     originalText: chunk.pageContent,
//                     role: 'assistant',
//                     messageId: aiMessageId
//                 }
//             })
//         });

//         logger.info(`Upserting ${docsToUpsert.length} AI response chunks to vector store...`);
//         await chatHistoryVectorStore.addDocuments(docsToUpsert);

//         // Update PostgreSQL message metadata with vector chunk IDs for better linking
//         const chunkIds = docsToUpsert.map(doc => doc.metadata.id);
//         if (chunkIds.length > 0) {
//             try {
//                 await prisma.message.update({
//                     where: { id: aiMessageId },
//                     data: {
//                         metadata: {
//                             id: aiMessageId,
//                             metadata: {
//                                 id: aiMessageId,
//                                 conversationId: UserConfig.conversationId,
//                                 userId: UserConfig.id,
//                                 timestamp: aiMessageCreatedAt,
//                                 role: 'assistant',
//                                 respondedToImages: (processedData.imageUrls && processedData.imageUrls.length > 0),
//                                 respondedToImageDescriptions: processedData.imageDescriptions || [],
//                                 // Link to vector chunks
//                                 vectorChunkIds: chunkIds,
//                                 vectorChunkCount: chunkIds.length,
//                                 chunked: true
//                             },
//                             pageContent: aiResponse as string
//                         }
//                     }
//                 });
//             } catch (updateError) {
//                 logger.warn('Failed to update message metadata with chunk IDs:', updateError);
//                 // Continue even if metadata update fails
//             }
//         }



//         return { aiResponse };
//     }

//     public async search(query: string) {
//         if (!query || typeof query !== 'string') {
//             throw new Error("Invalid query format. Please provide a valid string.");
//         }

//         const filterOptions = {
//             conversationId: UserConfig.conversationId,
//         }

//         const results = await chatHistoryVectorStore.search(query, 10, filterOptions);
//         return results.map((doc: Document) => ({
//             role: doc.metadata.role,
//             content: doc.pageContent,
//             timestamp: new Date(doc.metadata.timestamp).toLocaleTimeString(),
//         }));
//     }

//     public async regenerateAssistantResponse() {
//         // #1 get latest user & assistant message
//         // #2 get history chat
//         // #3 get similar messages from vector store
//         // #4 Create system prompt with chat history and similar messages
//         // #5 call LLM with the latest user message and system prompt
//         // #6 update the assistant message in the database
//         // #7 update the chat history vector store with the new assistant response
//         // #8 return the new assistant response
//     }

//     /**
//      * Get message with images
//      */
//     public async getMessageWithImages(messageId: string) {
//         const message = await prisma.message.findUnique({
//             where: { id: messageId },
//             include: {
//                 images: true
//             }
//         });

//         if (!message) {
//             throw new Error('Message not found');
//         }

//         return {
//             ...message,
//             imageUrls: message.images.map(img => img.imageUrl)
//         };
//     }

//     /**
//      * Search messages with image support
//      */
//     public async searchWithImageContext(query: string) {
//         if (!query || typeof query !== 'string') {
//             throw new Error("Invalid query format. Please provide a valid string.");
//         }

//         const filterOptions = {
//             conversationId: UserConfig.conversationId,
//         }

//         const results = await chatHistoryVectorStore.search(query, 10, filterOptions);

//         // Get full message details including images for messages that have them
//         const enhancedResults = await Promise.all(
//             results.map(async (doc: Document) => {
//                 const baseResult = {
//                     role: doc.metadata.role,
//                     content: doc.metadata.originalText || doc.pageContent,
//                     timestamp: new Date(doc.metadata.timestamp).toLocaleTimeString(),
//                     hasImages: doc.metadata.hasImages || false,
//                     imageCount: doc.metadata.imageCount || 0
//                 };

//                 // If message has images, fetch them from database
//                 if (doc.metadata.hasImages && doc.metadata.messageId) {
//                     try {
//                         const messageWithImages = await this.getMessageWithImages(doc.metadata.messageId);
//                         return {
//                             ...baseResult,
//                             images: messageWithImages.images
//                         };
//                     } catch (error) {
//                         logger.warn(`Failed to fetch images for message ${doc.metadata.messageId}:`, error);
//                         return baseResult;
//                     }
//                 }

//                 return baseResult;
//             })
//         );

//         return enhancedResults;
//     }

//     public getMessages(): string[] {
//         return this.messages;
//     }

//     public clearMessages(): void {
//         this.messages = [];
//     }

//     public getMessageCount(): number {
//         return this.messages.length;
//     }

//     public async getLatestMessage(): Promise<string> {
//         const latestMessage = await chatRepository.getLatestMessage();

//         if (latestMessage === null) {
//             logger.warn('No messages found in the database');
//             return 'No messages found';
//         } else {
//             return latestMessage;
//         }
//     }

//     /**
//      * Process images for storage: upload base64 images to Firebase Storage and return URLs
//      * Also keeps original base64 for LLM processing and generates descriptions
//      */
//     private async processImagesForStorage(messageData: MessageInput): Promise<ProcessedMessageInput & { base64Images: string[]; imageDescriptions?: string[] }> {
//         const { text, images } = messageData;

//         if (!images || images.length === 0) {
//             return { text, base64Images: [] };
//         }

//         const imageUrls: string[] = [];
//         const base64Images: string[] = [];
//         const urlImages: string[] = [];
//         const base64ForLLM: string[] = []; // Keep base64 for LLM processing
//         let imageDescriptions: string[] = [];

//         // Separate base64 images from URLs
//         for (const image of images) {
//             if (image.startsWith('http://') || image.startsWith('https://')) {
//                 // Already a URL, use as-is
//                 urlImages.push(image);
//                 imageUrls.push(image);
//                 // Note: For URLs, we can't convert to base64 easily, so skip LLM processing
//                 logger.warn(`URL image detected: ${image.substring(0, 50)}... - may not work with LLM`);
//             } else if (image.startsWith('data:image/') || this.isBase64String(image)) {
//                 // Base64 image, needs to be uploaded
//                 base64Images.push(image);
//                 base64ForLLM.push(image); // Keep original base64 for LLM
//             } else {
//                 throw new Error(`Invalid image format: ${image.substring(0, 50)}...`);
//             }
//         }

//         // Analyze image content for better descriptions
//         if (base64ForLLM.length > 0) {
//             try {
//                 logger.info(`Analyzing ${base64ForLLM.length} image(s) for content description...`);
//                 imageDescriptions = await analyzeMultipleImages(base64ForLLM, text);
//                 logger.info(`Successfully analyzed ${imageDescriptions.length} image(s)`);
//             } catch (error) {
//                 logger.error('Error analyzing images:', error);
//                 // Continue without descriptions
//                 imageDescriptions = base64ForLLM.map((_, index) => `Gambar ${index + 1}`);
//             }
//         }

//         // Upload base64 images to Firebase Storage
//         if (base64Images.length > 0) {
//             try {
//                 const uploadResults = await this.firebaseStorage.uploadMultipleBase64Images(
//                     base64Images,
//                     'chat-images'
//                 );

//                 const uploadedUrls = uploadResults.map(result => result.url);
//                 imageUrls.push(...uploadedUrls);

//                 logger.info(`Successfully uploaded ${base64Images.length} images to Firebase Storage`);
//             } catch (error) {
//                 logger.error('Error uploading images to Firebase:', error);
//                 throw new Error(`Failed to upload images: ${error instanceof Error ? error.message : 'Unknown error'}`);
//             }
//         }

//         return {
//             text,
//             imageUrls,
//             originalImages: images,
//             base64Images: base64ForLLM,
//             imageDescriptions
//         };
//     }

//     /**
//      * Helper method to add a text-only message (backward compatibility)
//      */
//     public async addTextMessage(message: string) {
//         return this.addMessage(message);
//     }

//     /**
//      * Helper method to add a message with images
//      */
//     public async addMessageWithImages(text: string, images: string[]) {
//         return this.addMessage({ text, images });
//     }

//     /**
//      * Helper method to validate image format
//      */
//     private validateImages(images: string[]): boolean {
//         return images.every(image =>
//             image.startsWith('data:image/') ||
//             image.startsWith('http') ||
//             this.isBase64String(image)
//         );
//     }

//     /**
//      * Helper method to check if string is base64
//      */
//     private isBase64String(str: string): boolean {
//         try {
//             return btoa(atob(str)) === str;
//         } catch (err) {
//             return false;
//         }
//     }
// }


// /**
//  * Estimate token count for text (rough approximation)
//  */
// const estimateTokens = (text: string): number => {
//     // Rough estimation: ~1.3 tokens per word for Indonesian text
//     const words = text.split(/\s+/).length;
//     const chars = text.length;

//     // More accurate estimation considering Indonesian + technical terms
//     return Math.ceil(words * 1.4 + chars * 0.1);
// };

// /**
//  * Clean system prompt to reduce unnecessary whitespace and tokens
//  */
// const cleanSystemPrompt = (prompt: string): string => {
//     return prompt
//         // Remove multiple consecutive spaces
//         .replace(/[ ]{2,}/g, ' ')
//         // Remove multiple consecutive newlines (keep max 2 for readability)
//         .replace(/\n{3,}/g, '\n\n')
//         // Remove trailing whitespace from lines
//         .replace(/[ \t]+$/gm, '')
//         // Remove leading whitespace from lines (except intentional indentation)
//         .replace(/^\s+/gm, '')
//         // Trim overall string
//         .trim();
// };

// const getRecentChatHistory = async (userId: string): Promise<string[]> => {

//     try {
//         const userWithMessages = await prisma.user.findUnique({
//             where: {
//                 id: userId
//             },
//             include: {
//                 Conversation: {
//                     where: {
//                         id: UserConfig.conversationId, // pastikan hanya mengambil percakapan yang relevan
//                     },
//                     include: {
//                         messages: {
//                             orderBy: {
//                                 createdAt: 'desc',
//                             },
//                             take: 16, // ambil 16 pesan terakhir
//                         },
//                     },
//                 },
//             },
//         });

//         return userWithMessages?.Conversation
//             .flatMap((conversation) => conversation.messages)
//             .map((msg) => {
//                 const dateObj = new Date(msg.createdAt);
//                 const formattedDate = dateObj.toLocaleDateString('id-ID', {
//                     year: 'numeric',
//                     month: 'numeric',
//                     day: 'numeric',
//                 });
//                 const formattedTime = dateObj.toLocaleTimeString('id-ID', {
//                     hour: '2-digit',
//                     minute: '2-digit',
//                     hour12: false,
//                 });

//                 // Clean content to remove unnecessary whitespace and newlines
//                 const cleanContent = msg.content.replace(/\s+/g, ' ').trim();

//                 return `[${msg.role}] (${formattedDate} ${formattedTime}): ${cleanContent}`;
//             })
//             .reverse() || [];

//     }
//     catch (error) {
//         logger.error(`Error getting recent chat history for user ${userId}:`, error);
//         throw new Error('Failed to retrieve recent chat history');
//     }
// }


// export const getRelevantChatHistory = async (query: string): Promise<string> => {
//     const filter = {
//         conversationId: UserConfig.conversationId,
//         role: "user" as "user"
//     }

//     const filterAssistant = {
//         conversationId: UserConfig.conversationId,
//         role: "assistant" as "assistant",
//     }

//     try {

//         const [userResults, assistantResults] = await Promise.all([
//             // Search user messages
//             chatHistoryVectorStore.search(query, 4, filter),
//             // Search assistant messages with broader/enhanced query
//             chatHistoryVectorStore.search(`${query}`, 4, filterAssistant)
//         ]);

//         const balancedResults: Document[] = [];
//         const maxResults = Math.max(userResults.length, assistantResults.length);

//         for (let i = 0; i < maxResults && balancedResults.length < 12; i++) {
//             // Add user message if available
//             if (i < userResults.length && balancedResults.length < 12) {
//                 balancedResults.push(userResults[i]);
//             }
//             // Add assistant message if available
//             if (i < assistantResults.length && balancedResults.length < 12) {
//                 balancedResults.push(assistantResults[i]);
//             }
//         }

//         const finalResults = balancedResults.filter((doc: Document) =>
//             doc.pageContent && doc.pageContent.trim().length > 0
//         );

//         const sortedResults = finalResults.sort((a, b) =>
//             (a.metadata?.timestamp || 0) - (b.metadata?.timestamp || 0)
//         );

//         const chatHistoryContext = sortedResults
//             .map((doc: Document) => {
//                 const role = doc.metadata?.role || 'unknown';
//                 const timestamp = doc.metadata?.timestamp || Date.now();
//                 const originalText = doc.pageContent;

//                 const dateObj = new Date(timestamp);
//                 const formattedDate = dateObj.toLocaleDateString('id-ID', {
//                     year: 'numeric',
//                     month: 'numeric',
//                     day: 'numeric',
//                 });
//                 const formattedTime = dateObj.toLocaleTimeString('id-ID', {
//                     hour: '2-digit',
//                     minute: '2-digit',
//                     hour12: false,
//                 });

//                 const cleanText = originalText.replace(/\s+/g, ' ').trim();
//                 return `[${role}] (${formattedDate} ${formattedTime}): ${cleanText}`;
//             })
//             .join('\n');

//         return chatHistoryContext;
//     } catch (error) {
//         logger.error(`Error getting relevant chat history for query "${query}":`, error);
//         throw new Error('Failed to retrieve relevant chat history');
//     }

// }


// const checkIfUserConversationExists = async (userId: string, conversationId: string): Promise<void> => {
//     const userConversation = await prisma.conversation.findFirst({
//         where: {
//             userId: userId,
//             id: conversationId
//         }
//     });

//     if (!userConversation) {
//         await prisma.conversation.create({
//             data: {
//                 id: conversationId,
//                 userId: userId,
//                 title: 'FIGOMAGER Default Conversation',
//             }
//         });
//         logger.info(`Created new conversation: ${conversationId}`);
//     }

//     return;
// }


// const callLLM = async (
//     message: string,
//     systemPrompt: string,
//     images?: string[],
//     recentChatHistory?: CombinedMessage[]
// ): Promise<{ aiResponse: string; aiMessageCreatedAt: number }> => {

//     let aiResponse: string;
//     let aiMessageCreatedAt: number | null = null;
//     let messageSequence: Array<[string, any]> = [];
//     let humanContent: any = message;
    
//     const maxRetries = 5;
//     let retryCount = 0;
//     let usingSecondaryLlm = false;

//     // Function to try LLM call with specified client
//     const tryLLMCall = async (llmClient: any, clientName: string) => {
//         const result = await llmClient.invoke(messageSequence);

//         // Check if result exists and has content
//         if (!result) {
//             throw new Error(`${clientName} returned null/undefined result`);
//         }

//         if (!result.content) {
//             throw new Error(`${clientName} result has no content property`);
//         }

//         const response = result.content as string;

//         // Check for empty response
//         if (!response || response == '') {
//             throw new Error(`${clientName} returned an empty response`);
//         }

//         return response;
//     };

//     while (retryCount <= maxRetries) {
//         try {
//             // Prepare the human message content
//             humanContent = message;

//             // If images are provided, format the message for multimodal input
//             if (images && images.length > 0) {
//                 humanContent = [
//                     {
//                         type: "text",
//                         text: message
//                     },
//                     ...images.map(image => ({
//                         type: "image_url",
//                         image_url: {
//                             // Google GenAI expects base64 data URLs
//                             // All images should be base64 at this point
//                             url: image.startsWith('data:') ? image :
//                                 `data:image/jpeg;base64,${image}`
//                         }
//                     }))
//                 ];
//             }

//             // Build message sequence: system prompt + chat history + current message
//             messageSequence = [];
            
//             // Add system prompt
//             messageSequence.push(['system', systemPrompt]);
            
//             // Add recent chat history as conversation context
//             if (recentChatHistory && recentChatHistory.length > 0) {
//                 for (const msg of recentChatHistory) {
//                     const role = msg.role === 'user' ? 'human' : 'assistant';
//                     messageSequence.push([role, msg.content]);
//                 }
//             }
            
//             // Add current user message
//             messageSequence.push(['human', humanContent]);
            
//             const attemptText = retryCount > 0 ? ` (Retry ${retryCount}/${maxRetries})` : '';
//             const llmText = usingSecondaryLlm ? ' [SecondaryLLM]' : '';
            
//             if (retryCount === 0) {
//                 logger.info(`LLM call: ${messageSequence.length} messages${llmText}`);
//             }

//             // Try primary LLM first, then secondary LLM if primary fails after max retries
//             if (!usingSecondaryLlm) {
//                 // Use primary LLM (gemini-2.5-pro)
//                 aiResponse = await tryLLMCall(llm, 'Primary LLM (gemini-2.5-pro)');
//             } else {
//                 // Use secondary LLM (gemini-2.5-flash) as fallback
//                 aiResponse = await tryLLMCall(secondaryLlm, 'Secondary LLM (gemini-2.5-flash)');
//             }

//             aiMessageCreatedAt = Date.now();

//             // Success! Break out of retry loop
//             if (retryCount > 0 || usingSecondaryLlm) {
//                 logger.info(`✅ LLM response received${retryCount > 0 ? ` after ${retryCount} retries` : ''}${usingSecondaryLlm ? ' using secondary LLM' : ''}`);
//             }
//             return { aiResponse, aiMessageCreatedAt };

//         } catch (error) {
//             retryCount++;
            
//             // If we've exhausted retries with primary LLM, try secondary LLM
//             if (retryCount > maxRetries && !usingSecondaryLlm) {
//                 logger.warn(`🔄 Primary LLM failed after ${maxRetries} retries. Switching to secondary LLM (gemini-2.5-flash)...`);
//                 usingSecondaryLlm = true;
//                 retryCount = 1; // Reset retry count for secondary LLM
                
//                 // Wait a bit before trying secondary LLM
//                 await new Promise(resolve => setTimeout(resolve, 2000));
//                 continue;
//             }
            
//             // If this is an empty response error and we have retries left, continue the loop
//             if (error instanceof Error && error.message.includes('empty response') && retryCount <= maxRetries) {
//                 const llmType = usingSecondaryLlm ? 'Secondary LLM' : 'Primary LLM';
//                 logger.warn(`⚠️ ${llmType} empty response (attempt ${retryCount}/${maxRetries + 1}). Retrying in ${retryCount * 1000}ms...`);
//                 await new Promise(resolve => setTimeout(resolve, retryCount * 1000));
//                 continue;
//             }
            
//             // Check if we should switch to secondary LLM
//             if (retryCount > maxRetries && !usingSecondaryLlm) {
//                 continue; // This will trigger the secondary LLM switch above
//             }
            
//             // For other errors or when both LLMs exhausted, log and throw
//             const llmType = usingSecondaryLlm ? 'Secondary LLM' : 'Primary LLM';
//             logger.error(`Error saat berinteraksi dengan ${llmType}:`, {
//                 error: error instanceof Error ? error.message : error,
//                 stack: error instanceof Error ? error.stack : undefined,
//                 messageSequenceLength: messageSequence?.length || 0,
//                 humanContentType: typeof humanContent,
//                 hasImages: images && images.length > 0,
//                 chatHistoryLength: recentChatHistory?.length || 0,
//                 retryCount: retryCount,
//                 maxRetries: maxRetries,
//                 usingSecondaryLlm: usingSecondaryLlm
//             });
            
//             let errorMessage: string;
//             if (usingSecondaryLlm) {
//                 errorMessage = `Gagal mendapatkan respons dari kedua AI (Primary + Secondary) setelah ${retryCount} percobaan: ${error instanceof Error ? error.message : 'Unknown error'}`;
//             } else {
//                 errorMessage = retryCount > 0 
//                     ? `Gagal mendapatkan respons dari Primary AI setelah ${retryCount} percobaan: ${error instanceof Error ? error.message : 'Unknown error'}`
//                     : `Gagal mendapatkan respons dari Primary AI: ${error instanceof Error ? error.message : 'Unknown error'}`;
//             }
                
//             throw new Error(errorMessage);
//         }
//     }

//     // This should never be reached due to the loop structure, but TypeScript needs it
//     throw new Error('Unexpected end of retry loop');
// }


// const checkIfUserMessageDuplicate = async (userMessageId: string) => {
//     const existingMessage = await prisma.message.findFirst({
//         where: {
//             id: userMessageId,
//             conversationId: UserConfig.conversationId,
//             role: 'user',
//         }
//     });

//     return existingMessage
// }


// interface ISaveChatArgs {
//     user: {
//         id: string;
//         conversationId: string;
//         userMessageId: string;
//         userMessageCreatedAt: number;
//         message: string;
//         images?: string[];
//         imageDescriptions?: string[];
//     },
//     ai: {
//         aiMessageId: string;
//         aiMessageCreatedAt: number;
//         aiResponse: string;
//         systemPrompt: string;
//     }
// }

// export interface CombinedMessage {
//     id: string;
//     role: string;
//     content: string;
//     timestamp: number;
//     source: 'vector' | 'database';
//     conversationId: string;
//     metadata?: any;
// }

// export interface CombinedRelevantContext {
//     messages: CombinedMessage[];
//     totalMessages: number;
//     vectorMessages: number;
//     databaseMessages: number;
//     formattedContext: string;
// }


// const saveChatMessage = async (args: ISaveChatArgs) => {
//     const { user, ai } = args;
//     const { userMessageId, userMessageCreatedAt, message, images, imageDescriptions } = user;
//     const { aiMessageId, aiMessageCreatedAt, aiResponse, systemPrompt } = ai;
//     try {

//         await prisma.$transaction(async (tx) => {
//             // Create user message
//             await tx.message.create({
//                 data: {
//                     id: userMessageId,
//                     conversationId: UserConfig.conversationId,
//                     content: message,
//                     role: 'user',
//                     hasImages: (images && images.length > 0),
//                     metadata: {
//                         id: userMessageId,
//                         metadata: {
//                             id: userMessageId,
//                             conversationId: UserConfig.conversationId, // Fixed typo
//                             userId: UserConfig.id,
//                             timestamp: userMessageCreatedAt,
//                             role: 'user',
//                             chunkIndex: 0,
//                             imageCount: images?.length || 0,
//                             imageDescriptions: imageDescriptions || []
//                         },
//                         pageContent: message as string
//                     }
//                 }
//             });

//             // Create images if any
//             if (images && images.length > 0) {
//                 const imageRecords = images.map((image, index) => {
//                     const imageType = image.startsWith('data:') ? 'base64' :
//                         image.startsWith('http') ? 'url' : 'base64';
//                     const mimeType = image.startsWith('data:') ?
//                         image.split(';')[0].split(':')[1] : 'image/jpeg';

//                     return {
//                         id: uuidv4(),
//                         messageId: userMessageId,
//                         imageUrl: image,
//                         imageType,
//                         mimeType,
//                         size: image.length, // Approximate size
//                         metadata: {
//                             index,
//                             processedAt: new Date().toISOString(),
//                             description: imageDescriptions?.[index] || `Gambar ${index + 1}`,
//                             aiGenerated: true
//                         }
//                     };
//                 });

//                 await tx.messageImage.createMany({
//                     data: imageRecords
//                 });
//             }

//             // Create AI response
//             await tx.message.create({
//                 data: {
//                     id: aiMessageId,
//                     conversationId: UserConfig.conversationId,
//                     content: aiResponse as string,
//                     role: 'assistant',
//                     fullPrompt: systemPrompt,
//                     hasImages: false,
//                     metadata: {
//                         id: aiMessageId,
//                         metadata: {
//                             id: aiMessageId,
//                             conversationId: UserConfig.conversationId, // Fixed typo
//                             userId: UserConfig.id,
//                             timestamp: aiMessageCreatedAt,
//                             role: 'assistant',
//                             respondedToImages: (images && images.length > 0),
//                             respondedToImageDescriptions: imageDescriptions || []
//                         },
//                         pageContent: aiResponse as string
//                     }
//                 }
//             });
//         });

//     } catch (error) {
//         logger.error('Error saat menyimpan pesan ke database:', error);
//         throw new Error('Gagal menyimpan pesan ke database');
//     }
// }

// /**
//  * Get combined relevant context by merging vector store semantic search results
//  * with recent database messages, deduplicating and sorting chronologically
//  * 
//  * @param query - The query to search for semantic similarity
//  * @param userId - The user ID to filter messages for
//  * @param conversationId - The conversation ID to get recent messages from
//  * @param limit - Maximum number of messages to return (default: 15)
//  * @returns Combined and formatted context with metadata
//  */
// /**
//  * Clean and deduplicate messages for system prompt
//  */
// const cleanAndDeduplicateMessages = (messages: CombinedMessage[]): CombinedMessage[] => {
//     const seen = new Set<string>();
//     const deduplicatedMessages: CombinedMessage[] = [];
    
//     for (const message of messages) {
//         // Create a content hash for deduplication (first 100 chars + role)
//         const contentHash = `${message.role}:${message.content.substring(0, 100).toLowerCase().trim()}`;
        
//         if (!seen.has(contentHash)) {
//             seen.add(contentHash);
            
//             // Clean the message content
//             const cleanedMessage: CombinedMessage = {
//                 ...message,
//                 content: message.content
//                     .replace(/[\u{1f600}-\u{1f64f}]|[\u{1f300}-\u{1f5ff}]|[\u{1f680}-\u{1f6ff}]|[\u{1f1e0}-\u{1f1ff}]|[\u{2600}-\u{26ff}]|[\u{2700}-\u{27bf}]/gu, '') // Remove emojis
//                     .replace(/\s+/g, ' ') // Normalize whitespace
//                     .replace(/[^\w\s\.,\?!;:\-()]/g, '') // Remove special characters except basic punctuation
//                     .trim()
//             };
            
//             // Only add if content is not empty after cleaning
//             if (cleanedMessage.content.length > 0) {
//                 deduplicatedMessages.push(cleanedMessage);
//             }
//         }
//     }
    
//     return deduplicatedMessages;
// };

// export const getCombinedRelevantContext = async (
//     query: string,
//     userId: string,
//     conversationId: string,
//     limit: number = 15
// ): Promise<CombinedRelevantContext> => {
//     // Validate input parameters first, before try-catch
//     if (!query || typeof query !== 'string' || query.trim().length === 0) {
//         throw new Error('Query is required and must be a non-empty string');
//     }

//     if (!userId || typeof userId !== 'string') {
//         throw new Error('User ID is required and must be a string');
//     }

//     if (!conversationId || typeof conversationId !== 'string') {
//         throw new Error('Conversation ID is required and must be a string');
//     }

//     try {
//         // 1. Get semantic search results from vector store
//         const vectorResults: CombinedMessage[] = [];
//         try {
//             const userFilter = { userId: userId };

//             // Get balanced results from vector store (similar to existing getRelevantChatHistory logic)
//             const userResults = await chatHistoryVectorStore.search(query, 10, { ...userFilter, role: 'user' });
//             const assistantResults = await chatHistoryVectorStore.search(query, 10, { ...userFilter, role: 'assistant' });

//             // Balance the results by interleaving
//             const balancedResults: Document[] = [];
//             const maxLength = Math.max(userResults.length, assistantResults.length);

//             for (let i = 0; i < maxLength && balancedResults.length < 12; i++) {
//                 if (i < userResults.length && balancedResults.length < 12) {
//                     balancedResults.push(userResults[i]);
//                 }
//                 if (i < assistantResults.length && balancedResults.length < 12) {
//                     balancedResults.push(assistantResults[i]);
//                 }
//             }

//             // Convert vector results to CombinedMessage format
//             for (const doc of balancedResults) {
//                 if (doc.pageContent && doc.pageContent.trim().length > 0) {
//                     // For Pinecone chunks, we need to use the correct ID strategy:
//                     // - For user messages: use 'id' (which should match PostgreSQL message ID)
//                     // - For assistant chunks: use 'messageId' (the original PostgreSQL message ID)
//                     let actualMessageId: string;
//                     let isChunk = false;
                    
//                     if (doc.metadata?.role === 'assistant' && doc.metadata?.chunkIndex !== undefined) {
//                         // This is an assistant chunk - use messageId to group chunks together
//                         actualMessageId = doc.metadata?.messageId;
//                         isChunk = true;
//                     } else if (doc.metadata?.role === 'user') {
//                         // User message - use id directly (should match PostgreSQL ID)
//                         actualMessageId = doc.metadata?.id;
//                     } else {
//                         // Fallback for other cases
//                         actualMessageId = doc.metadata?.messageId || doc.metadata?.id || `vector_${Date.now()}_${Math.random()}`;
//                     }
                    
//                     const vectorMessage = {
//                         id: actualMessageId,
//                         role: doc.metadata?.role || 'unknown',
//                         content: doc.pageContent.trim(),
//                         timestamp: doc.metadata?.timestamp || Date.now(),
//                         source: 'vector' as const,
//                         conversationId: doc.metadata?.conversationId || conversationId,
//                         metadata: {
//                             ...doc.metadata,
//                             originalVectorId: doc.metadata?.id, // Keep original Pinecone chunk ID
//                             isChunk: isChunk,
//                             actualMessageId: actualMessageId
//                         }
//                     };
//                     vectorResults.push(vectorMessage);
//                 }
//             }

//         } catch (vectorError) {
//             logger.error('Error getting vector store results:', vectorError);
//             // Continue without vector results rather than failing completely
//         }

//         // 2. Get recent messages from database
//         const databaseResults: CombinedMessage[] = [];
//         try {
//             const recentMessages = await prisma.message.findMany({
//                 where: {
//                     conversationId: conversationId,
//                     conversation: {
//                         userId: userId
//                     }
//                 },
//                 orderBy: {
//                     createdAt: 'desc'
//                 },
//                 take: Math.max(limit, 10), // Get at least 10 recent messages
//                 include: {
//                     conversation: true
//                 }
//             });

//             // Convert database results to CombinedMessage format
//             for (const msg of recentMessages) {
//                 const dbMessage = {
//                     id: msg.id,
//                     role: msg.role,
//                     content: msg.content,
//                     timestamp: msg.createdAt.getTime(),
//                     source: 'database' as const,
//                     conversationId: msg.conversationId,
//                     metadata: msg.metadata
//                 };
//                 databaseResults.push(dbMessage);
//             }
//         } catch (dbError) {
//             logger.error('Error getting database messages:', dbError);
//             // Continue without database results rather than failing completely
//         }

//         // 3. Combine and deduplicate messages
//         const messageMap = new Map<string, CombinedMessage>();

//         // STEP 1: Add database results first (as base layer)
//         for (const msg of databaseResults) {
//             messageMap.set(msg.id, msg);
//         }

//         // STEP 2: Process vector results and let them override database results (semantic priority)
        
//         // Group assistant chunks by messageId and merge them
//         const assistantChunks = new Map<string, CombinedMessage[]>();
//         let regularVectorMessages = 0;
//         let chunkMessages = 0;
        
//         for (const msg of vectorResults) {
//             if (msg.metadata?.isChunk && msg.metadata?.role === 'assistant') {
//                 // This is an assistant chunk, group by messageId (which is msg.id)
//                 const messageId = msg.id;
//                 if (!assistantChunks.has(messageId)) {
//                     assistantChunks.set(messageId, []);
//                 }
//                 assistantChunks.get(messageId)!.push(msg);
//                 chunkMessages++;
//             } else {
//                 // Regular message (user or non-chunked assistant) - OVERRIDE database if exists
//                 messageMap.set(msg.id, msg);
//                 regularVectorMessages++;
//             }
//         }
        
//         // STEP 3: Merge assistant chunks and override database versions
//         for (const [messageId, chunks] of assistantChunks.entries()) {
//             // Sort chunks by chunkIndex
//             chunks.sort((a, b) => (a.metadata?.chunkIndex || 0) - (b.metadata?.chunkIndex || 0));
            
//             // Merge content
//             const mergedContent = chunks.map(chunk => chunk.content).join(' ');
//             const mergedMessage: CombinedMessage = {
//                 ...chunks[0], // Use first chunk as base
//                 content: mergedContent,
//                 metadata: {
//                     ...chunks[0].metadata,
//                     chunkCount: chunks.length,
//                     mergedFromChunks: true
//                 }
//             };
            
//             messageMap.set(messageId, mergedMessage);
//         }

//         const vectorCount = Array.from(messageMap.values()).filter(m => m.source === 'vector').length;
//         const databaseCount = Array.from(messageMap.values()).filter(m => m.source === 'database').length;

//         // 4. Smart selection: Balance vector and database messages
//         const allMessages = Array.from(messageMap.values());
        
//         // Separate vector and database messages
//         const vectorMessages = allMessages.filter(m => m.source === 'vector');
//         const databaseMessages = allMessages.filter(m => m.source === 'database');
        
//         // Sort each group by timestamp (most recent first for database, semantic relevance for vector)
//         const sortedVectorMessages = vectorMessages.sort((a, b) => b.timestamp - a.timestamp);
//         const sortedDatabaseMessages = databaseMessages.sort((a, b) => b.timestamp - a.timestamp);
        
//         // Smart selection strategy: Optimize for system prompt + conversation context
//         const minVectorMessages = Math.min(Math.ceil(limit * 0.5), vectorMessages.length); // At least 50% vector (semantic context)
//         const maxDatabaseMessages = limit - minVectorMessages;
        
//         // Take messages with balanced approach
//         const selectedMessages: CombinedMessage[] = [];
        
//         // Add vector messages first (they have semantic priority)
//         selectedMessages.push(...sortedVectorMessages.slice(0, minVectorMessages));
        
//         // Fill remaining slots with most recent database messages
//         const remainingSlots = limit - selectedMessages.length;
//         selectedMessages.push(...sortedDatabaseMessages.slice(0, remainingSlots));
        
//         // Final sort by timestamp for chronological context
//         const sortedFinalMessages = selectedMessages.sort((a, b) => a.timestamp - b.timestamp);
        
//         // Clean and deduplicate one final time before formatting for system prompt
//         const finalMessages = cleanAndDeduplicateMessages(sortedFinalMessages);

//         // 5. Create clean formatted context string for system prompt (already cleaned and deduplicated)
//         const formattedContext = finalMessages
//             .map((msg) => {
//                 const dateObj = new Date(msg.timestamp);
//                 const formattedDate = dateObj.toLocaleDateString('id-ID', {
//                     year: 'numeric',
//                     month: 'numeric',
//                     day: 'numeric',
//                 });
//                 const formattedTime = dateObj.toLocaleTimeString('id-ID', {
//                     hour: '2-digit',
//                     minute: '2-digit',
//                     hour12: false,
//                 });

//                 // Simple clean format for system prompt
//                 return `[${msg.role}] ${formattedDate} ${formattedTime}: ${msg.content}`;
//             })
//             .join('\n');

//         const result: CombinedRelevantContext = {
//             messages: finalMessages,
//             totalMessages: finalMessages.length,
//             vectorMessages: finalMessages.filter(msg => msg.source === 'vector').length,
//             databaseMessages: finalMessages.filter(msg => msg.source === 'database').length,
//             formattedContext
//         };

//         return result;

//     } catch (error) {
//         logger.error(`Error getting combined relevant context for query "${query}":`, error);
//         throw new Error('Failed to retrieve combined relevant context');
//     }
// };

