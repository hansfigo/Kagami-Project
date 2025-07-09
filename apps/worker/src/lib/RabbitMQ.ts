import amqp from 'amqplib';
import { logger } from '../utils/logger';

interface IRabbitMQClient {
    getConnection: () => Promise<amqp.ChannelModel>;
    close: () => Promise<void>;
}

export interface IMessageQueue {
    init: () => Promise<void>;
    sendToQueue: (queue: string, message: string) => Promise<void>;
    close: () => Promise<void>;
}

export class RabbitMQClient implements IRabbitMQClient {
    private connection: amqp.ChannelModel | null = null;
    private currentReconnectAttempt = 0;
    private maxReconnectAttempts = 5;
    private reconnectDelay = 5000;
    private isConnecting = false;

    constructor(private RABBITMQ_URL: string) { }

    public async getConnection(): Promise<amqp.ChannelModel> {
        while (this.isConnecting) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (!this.connection) {
            await this.connect();
        }

        if (!this.connection) {
            logger.error('Failed to establish RabbitMQ connection after multiple attempts.');
            throw new Error('RabbitMQ connection is not established');
        }
        return this.connection;
    }

    private async connect(): Promise<void> {
        try {
            logger.info(`Connecting to RabbitMQ...`);
            this.isConnecting = true;
            this.connection = await amqp.connect(this.RABBITMQ_URL);

            this.connection.on("close", async (err: Error) => {
                logger.warn('RabbitMQ connection closed, attempting to reconnect...', err);
                this.connection = null;
                this.isConnecting = false;
                await this.scheduleReconnect();
            });

            this.connection.on("error", async (err: Error) => {
                logger.error('RabbitMQ connection error:', err);
                this.connection = null;
                this.isConnecting = false;
                await this.scheduleReconnect();
            });

            logger.info('RabbitMQ connection established successfully.');
            this.isConnecting = false;
            this.currentReconnectAttempt = 0;
        } catch (error) {
            logger.error('Failed to connect to RabbitMQ:', error);
            this.connection = null;
            await this.scheduleReconnect();
        }
    }

    private async scheduleReconnect(): Promise<void> {
        while (this.isConnecting) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        logger.warn(`Scheduling reconnect in ${this.reconnectDelay}ms...`);
        if (this.currentReconnectAttempt >= this.maxReconnectAttempts) {

            logger.error('Max reconnect attempts reached. Giving up.');
            return;
        }

        this.isConnecting = true;
        const delay = this.reconnectDelay

        try {
            this.currentReconnectAttempt++;

            logger.warn(`Attempting to reconnect to RabbitMQ... (Attempt ${this.currentReconnectAttempt}/${this.maxReconnectAttempts})`);

            await setTimeout(async () => {
                await this.connect()
            }, delay)
        } catch (error) {
            logger.error(`Reconnect attempt ${this.currentReconnectAttempt + 1} failed:`, error);
        }
    }

    public async close(): Promise<void> {
        if (this.connection) {
            logger.info('Closing RabbitMQ connection...');
            this.connection.removeAllListeners();
            await this.connection.close();
            this.connection = null;
        }
    }
}


export class MessageQueue implements IMessageQueue {
    private channel: amqp.Channel | null = null;

    constructor(private rabbitMQClient: IRabbitMQClient) {
        if (!rabbitMQClient) {
            throw new Error("RabbitMQ client is required");
        }
    }

    public async init(): Promise<void> {
        const connection = await this.rabbitMQClient.getConnection();
        this.channel = await connection.createChannel();
    }

    public async sendToQueue(queue: string, message: string): Promise<void> {
        if (!this.channel) {
            throw new Error("Channel is not initialized. Call init() first.");
        }
        await this.channel.assertQueue(queue, { durable: true });
        this.channel.sendToQueue(queue, Buffer.from(message), { persistent: true });
    }

    public async consumeFromQueue(queue: string, callback: (msg: amqp.ConsumeMessage | null) => void): Promise<void> {
        if (!this.channel) {
            throw new Error("Channel is not initialized. Call init() first.");
        }

        logger.info(`Consuming from queue: ${queue}`);

        await this.channel.assertQueue(queue, { durable: true });

        this.channel.consume(queue, (msg) => {
            if (msg) {
                callback(msg);
                this.channel!.ack(msg);
            } else {
                console.warn(`No message received from queue: ${queue}`);
            }
        }, { noAck: false });
    }

    public async close(): Promise<void> {
        if (this.channel) {
            await this.channel.close();
            this.channel = null;
        }
    }
}

export async function createRabbitMQClient(rabbitMQUrl: string): Promise<RabbitMQClient> {
    const client = new RabbitMQClient(rabbitMQUrl);
    await client.getConnection();
    return client;
}

export async function createMessageQueue(rabbitMQClient: IRabbitMQClient): Promise<MessageQueue> {
    const queue = new MessageQueue(rabbitMQClient);
    await queue.init();
    if (!queue) {
        throw new Error("Failed to create message queue");
    }
    return queue;
}



