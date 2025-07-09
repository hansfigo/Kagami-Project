import 'dotenv/config';
import { json } from 'stream/consumers';
import { createMessageQueue, createRabbitMQClient } from "./lib/RabbitMQ";
import { logger } from "./utils/logger";

interface IChatMemoryProcessMessage {
    user: {
        id: string;
        conversationId: string;
        userMessageId: string;
        userMessageCreatedAt: number;
        message: string;
    },
    ai: {
        aiMessageId: string;
        aiMessageCreatedAt: number;
        aiResponse: string;
    }
}


class Worker {
    public static async start() {
        const rabbitMQUrl = process.env.RABBITMQ_URL

        if (!rabbitMQUrl) {
            logger.error('RABBITMQ_URL is not set. Please set it in your environment variables.');
            throw new Error('RABBITMQ_URL is not set');
        }

        const rabbitMQClient = await createRabbitMQClient(rabbitMQUrl);
        const MessageQueue = await createMessageQueue(rabbitMQClient);

        MessageQueue.consumeFromQueue('kagami.chat_memory.process', async (message) => {
            if (!message) {
                logger.error('Received empty message from queue');
                return;
            }

            try {
                const content = message.content.toString()
                const parsedMessage: IChatMemoryProcessMessage = JSON.parse(content);


                logger.info(`Received message: ${content}`);

            } catch (error) {
                logger.error(`Error processing message: ${error}`);
            }
        }
        );
    }
}

export const startApp = async () => {
    try {
        logger.info('Starting Worker...');
        await Worker.start();
        logger.info('Worker started successfully');
    } catch (error) {
        logger.error(`Error starting Worker: ${error}`);
    }
}