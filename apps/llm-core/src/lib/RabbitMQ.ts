import amqp from 'amqplib';

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

    constructor(private RABBITMQ_URL: string) { }

    public async getConnection(): Promise<amqp.ChannelModel> {
        if (!this.connection) {
            this.connection = await this.connect();
        }
        return this.connection;
    }

    private async connect(): Promise<amqp.ChannelModel> {
        try {
            this.connection = await amqp.connect(this.RABBITMQ_URL);

            this.connection.on("close", () => {
                console.error('RabbitMQ connection closed!');
            });

            this.connection.on("error", (err: Error) => {
                console.error('RabbitMQ connection error:', err);
                throw new Error("RabbitMQ connection error");
            });

            return this.connection;
        } catch (error) {
            console.error('Failed to connect to RabbitMQ:', error);
            throw new Error("Failed to connect to RabbitMQ");
        }
    }

    public async close(): Promise<void> {
        if (this.connection) {
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
    return queue;
}



