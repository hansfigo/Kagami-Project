import { llm, secondaryLlm } from "../../../lib/LLMClient";
import { logger } from "../../../utils/logger";
import { CombinedMessage } from "../types/chat.types";

export class LLMService {
    private maxRetries = 5;

    /**
     * Call LLM with retry mechanism and fallback to secondary LLM
     */
    async callLLM(
        message: string,
        systemPrompt: string,
        images?: string[],
        recentChatHistory?: CombinedMessage[]
    ): Promise<{ aiResponse: string; aiMessageCreatedAt: number; usedSecondaryLLM?: boolean }> {
        let aiResponse: string;
        let aiMessageCreatedAt: number;
        let messageSequence: Array<[string, any]> = [];
        let humanContent: any = message;
        
        let retryCount = 0;
        let usingSecondaryLlm = false;

        // Function to try LLM call with specified client
        const tryLLMCall = async (llmClient: any, clientName: string) => {
            const result = await llmClient.invoke(messageSequence);

            if (!result) {
                throw new Error(`${clientName} returned null/undefined result`);
            }

            if (!result.content) {
                throw new Error(`${clientName} result has no content property`);
            }

            const response = result.content as string;

            if (!response || response == '') {
                throw new Error(`${clientName} returned an empty response`);
            }

            return response;
        };

        while (retryCount <= this.maxRetries) {
            try {
                // Prepare the human message content
                humanContent = message;

                // If images are provided, format the message for multimodal input
                if (images && images.length > 0) {
                    humanContent = [
                        {
                            type: "text",
                            text: message
                        },
                        ...images.map(image => ({
                            type: "image_url",
                            image_url: {
                                url: image.startsWith('data:') ? image :
                                    `data:image/jpeg;base64,${image}`
                            }
                        }))
                    ];
                }

                // Build message sequence: system prompt + chat history + current message
                messageSequence = [];
                
                // Add system prompt
                messageSequence.push(['system', systemPrompt]);
                
                // Add recent chat history as conversation context
                if (recentChatHistory && recentChatHistory.length > 0) {
                    for (const msg of recentChatHistory) {
                        const role = msg.role === 'user' ? 'human' : 'assistant';
                        messageSequence.push([role, msg.content]);
                    }
                }
                
                // Add current user message
                messageSequence.push(['human', humanContent]);

                const llmText = usingSecondaryLlm ? ' [SecondaryLLM]' : '';
                
                if (retryCount === 0) {
                    logger.info(`LLM call: ${messageSequence.length} messages${llmText}`);
                }

                // Try primary LLM first, then secondary LLM if primary fails after max retries
                if (!usingSecondaryLlm) {
                    aiResponse = await tryLLMCall(llm, 'Primary LLM (gemini-2.5-pro)');
                } else {
                    aiResponse = await tryLLMCall(secondaryLlm, 'Secondary LLM (gemini-2.5-flash)');
                }

                aiMessageCreatedAt = Date.now();

                // Success! Break out of retry loop
                if (retryCount > 0 || usingSecondaryLlm) {
                    logger.info(`✅ LLM response received${retryCount > 0 ? ` after ${retryCount} retries` : ''}${usingSecondaryLlm ? ' using secondary LLM' : ''}`);
                }

                // Add indicator if using secondary LLM
                if (usingSecondaryLlm) {
                    aiResponse = `[🔄]\n\n${aiResponse}`;
                }

                return { aiResponse, aiMessageCreatedAt, usedSecondaryLLM: usingSecondaryLlm };

            } catch (error) {
                retryCount++;
                
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                const llmType = usingSecondaryLlm ? 'Secondary LLM' : 'Primary LLM';
                
                // Check if this is a server error that should trigger immediate fallback
                const isServerError = errorMessage.includes('500 Internal Server Error') || 
                                    errorMessage.includes('An internal error has occurred') ||
                                    errorMessage.includes('Internal Server Error') ||
                                    errorMessage.includes('503 Service Unavailable') ||
                                    errorMessage.includes('502 Bad Gateway');
                
                // If primary LLM has server error, immediately try secondary LLM
                if (!usingSecondaryLlm && isServerError) {
                    logger.warn(`🔄 Primary LLM server error detected: ${errorMessage}`);
                    logger.warn(`🔄 Immediately switching to secondary LLM (gemini-2.5-flash)...`);
                    usingSecondaryLlm = true;
                    retryCount = 1; // Reset retry count for secondary LLM
                    
                    // Short wait before trying secondary LLM
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    continue;
                }
                
                // If we've exhausted retries with primary LLM, try secondary LLM
                if (retryCount > this.maxRetries && !usingSecondaryLlm) {
                    logger.warn(`🔄 Primary LLM failed after ${this.maxRetries} retries. Switching to secondary LLM (gemini-2.5-flash)...`);
                    usingSecondaryLlm = true;
                    retryCount = 1; // Reset retry count for secondary LLM
                    
                    // Wait a bit before trying secondary LLM
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    continue;
                }
                
                // If this is an empty response error and we have retries left, continue the loop
                if (errorMessage.includes('empty response') && retryCount <= this.maxRetries) {
                    logger.warn(`⚠️ ${llmType} empty response (attempt ${retryCount}/${this.maxRetries + 1}). Retrying in ${retryCount * 1000}ms...`);
                    await new Promise(resolve => setTimeout(resolve, retryCount * 800));
                    continue;
                }
                
                // If we're using secondary LLM and still have retries, continue
                if (usingSecondaryLlm && retryCount <= this.maxRetries) {
                    logger.warn(`⚠️ ${llmType} error (attempt ${retryCount}/${this.maxRetries + 1}): ${errorMessage}. Retrying in ${retryCount * 1000}ms...`);
                    await new Promise(resolve => setTimeout(resolve, retryCount * 1000));
                    continue;
                }
                
                // For other errors or when both LLMs exhausted, log and throw
                logger.error(`Error communicating with ${llmType}:`, {
                    error: errorMessage,
                    retryCount: retryCount,
                    maxRetries: this.maxRetries,
                    usingSecondaryLlm: usingSecondaryLlm,
                    wasServerError: isServerError
                });
                
                let finalErrorMessage: string;
                if (usingSecondaryLlm) {
                    finalErrorMessage = `Failed to get response from both AIs (Primary + Secondary) after ${retryCount} attempts: ${errorMessage}`;
                } else {
                    finalErrorMessage = retryCount > 0 
                        ? `Failed to get response from Primary AI after ${retryCount} attempts: ${errorMessage}`
                        : `Failed to get response from Primary AI: ${errorMessage}`;
                }
                    
                throw new Error(finalErrorMessage);
            }
        }

        // This should never be reached due to the loop structure, but TypeScript needs it
        throw new Error('Unexpected end of retry loop');
    }
}

export const llmService = new LLMService();
