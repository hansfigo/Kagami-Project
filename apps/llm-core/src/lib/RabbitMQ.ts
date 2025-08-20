import amqp from 'amqplib';
import { logger } from '../utils/logger';

interface IRabbitMQClient {
    getConnection: () => Promise<amqp.ChannelModel>;
    close: () => Promise<void>;
    isConnected: () => boolean;
}

export interface IMessageQueue {
    init: () => Promise<void>;
    sendToQueue: (queue: string, payload: any) => Promise<void>;
    close: () => Promise<void>;
    isHealthy: () => boolean;
}

export class RabbitMQClient implements IRabbitMQClient {
    private connection: amqp.ChannelModel | null = null;
    private isConnecting = false;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private reconnectDelay = 5000; // 5 seconds
    private connectionHealthy = false;

    constructor(private RABBITMQ_URL: string) { }

    public isConnected(): boolean {
        return this.connectionHealthy && this.connection !== null;
    }

    public async getConnection(): Promise<amqp.ChannelModel> {
        if (!this.connection || !this.connectionHealthy) {
            await this.connect();
        }
        return this.connection!;
    }

    private async connect(): Promise<amqp.ChannelModel> {
        if (this.isConnecting) {
            while (this.isConnecting) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            if (this.connection && this.connectionHealthy) {
                return this.connection;
            }
        }

        this.isConnecting = true;

        try {
            logger.info(`Attempting to connect to RabbitMQ... (attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
            
            this.connection = await amqp.connect(this.RABBITMQ_URL);
            this.connectionHealthy = true;
            this.reconnectAttempts = 0;

            this.connection.on("close", () => {
                logger.warn('RabbitMQ connection closed, attempting to reconnect...');
                this.connectionHealthy = false;
                this.connection = null;
                this.scheduleReconnect();
            });

            this.connection.on("error", (err: Error) => {
                logger.error('RabbitMQ connection error:', err);
                this.connectionHealthy = false;
                this.connection = null;
                this.scheduleReconnect();
            });

            logger.info('Successfully connected to RabbitMQ');
            return this.connection;
            
        } catch (error) {
            logger.error('Failed to connect to RabbitMQ:', error);
            this.connectionHealthy = false;
            this.connection = null;
            this.scheduleReconnect();
            throw new Error("Failed to connect to RabbitMQ");
        } finally {
            this.isConnecting = false;
        }
    }

    private scheduleReconnect(): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger.error(`Max reconnection attempts (${this.maxReconnectAttempts}) reached. Giving up.`);
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff
        
        logger.info(`Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        
        setTimeout(async () => {
            try {
                await this.connect();
            } catch (error) {
                logger.error('Reconnection failed:', error);
            }
        }, delay);
    }

    public async close(): Promise<void> {
        this.connectionHealthy = false;
        if (this.connection) {
            try {
                await this.connection.close();
            } catch (error) {
                logger.error('Error closing RabbitMQ connection:', error);
            }
            this.connection = null;
        }
    }
}


export class MessageQueue implements IMessageQueue {
    private channel: amqp.Channel | null = null;
    private channelHealthy = false;
    private isInitializing = false;

    constructor(private rabbitMQClient: IRabbitMQClient) {
        if (!rabbitMQClient) {
            throw new Error("RabbitMQ client is required");
        }
    }

    public isHealthy(): boolean {
        return this.channelHealthy && this.channel !== null && this.rabbitMQClient.isConnected();
    }

    public async init(): Promise<void> {
        if (this.isInitializing) {
            // Wait for existing initialization
            while (this.isInitializing) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            return;
        }

        this.isInitializing = true;

        try {
            const connection = await this.rabbitMQClient.getConnection();
            this.channel = await connection.createChannel();
            this.channelHealthy = true;

            this.channel.on('close', () => {
                logger.warn('RabbitMQ channel closed');
                this.channelHealthy = false;
                this.channel = null;
            });

            this.channel.on('error', (err: Error) => {
                logger.error('RabbitMQ channel error:', err);
                this.channelHealthy = false;
                this.channel = null;
            });

            logger.info('RabbitMQ channel initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize RabbitMQ channel:', error);
            this.channelHealthy = false;
            this.channel = null;
            throw error;
        } finally {
            this.isInitializing = false;
        }
    }

    public async sendToQueue(queue: string, payload: any): Promise<void> {
        try {
            // Check if we need to reinitialize
            if (!this.isHealthy()) {
                logger.info('RabbitMQ not healthy, attempting to reinitialize...');
                await this.init();
            }

            if (!this.channel) {
                throw new Error("Channel is not initialized");
            }

            await this.channel.assertQueue(queue, { durable: true });
            const messageBuffer = Buffer.from(JSON.stringify(payload));
            
            const result = this.channel.sendToQueue(queue, messageBuffer, { persistent: true });
            
            if (!result) {
                logger.warn(`Failed to send message to queue ${queue} - queue might be full`);
            } else {
                logger.debug(`Message sent to queue ${queue} successfully`);
            }
            
        } catch (error) {
            logger.error(`Failed to send message to queue ${queue}:`, error);
            this.channelHealthy = false;
            this.channel = null;
            
            // Don't throw error, just log it so the app doesn't crash
            // The message will be lost but the app continues running
            logger.warn(`Message to queue ${queue} was dropped due to RabbitMQ error`);
        }
    }

    public async close(): Promise<void> {
        this.channelHealthy = false;
        if (this.channel) {
            try {
                await this.channel.close();
            } catch (error) {
                logger.error('Error closing RabbitMQ channel:', error);
            }
            this.channel = null;
        }
    }
}

export async function createRabbitMQClient(rabbitMQUrl: string): Promise<RabbitMQClient> {
    const client = new RabbitMQClient(rabbitMQUrl);
    try {
        await client.getConnection();
        return client;
    } catch (error) {
        logger.error('Failed to create RabbitMQ client:', error);
        return client;
    }
}

export async function createMessageQueue(rabbitMQClient: IRabbitMQClient): Promise<MessageQueue> {
    const queue = new MessageQueue(rabbitMQClient);
    try {
        await queue.init();
        return queue;
    } catch (error) {
        logger.error('Failed to initialize message queue:', error);
        return queue;
    }
}

export class NoOpMessageQueue implements IMessageQueue {
    public async init(): Promise<void> {
        logger.warn('Using NoOp message queue - RabbitMQ functionality disabled');
    }

    public async sendToQueue(queue: string, payload: any): Promise<void> {
        logger.warn(`NoOp: Would send message to queue ${queue}:`, payload);
    }

    public async close(): Promise<void> {
        logger.info('NoOp message queue closed');
    }

    public isHealthy(): boolean {
        return false; 
    }
}

export async function createSafeMessageQueue(rabbitMQUrl?: string): Promise<IMessageQueue> {
    if (!rabbitMQUrl) {
        logger.warn('No RabbitMQ URL provided, using NoOp message queue');
        return new NoOpMessageQueue();
    }

    try {
        const client = await createRabbitMQClient(rabbitMQUrl);
        const queue = await createMessageQueue(client);
        
        if (queue.isHealthy()) {
            logger.info('RabbitMQ message queue created successfully');
            return queue;
        } else {
            logger.warn('RabbitMQ not healthy, falling back to NoOp');
            return new NoOpMessageQueue();
        }
    } catch (error) {
        logger.error('Failed to create RabbitMQ message queue, falling back to NoOp:', error);
        return new NoOpMessageQueue();
    }
}



