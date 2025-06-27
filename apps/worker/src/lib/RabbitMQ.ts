import amqp from 'amqplib';

interface IRabbitMQClient {
    connect: () => Promise<amqp.Channel>;
}

export class RabbitMQClient implements IRabbitMQClient {
    private connection: amqp.ChannelModel | null = null;
    private channel: amqp.Channel | null = null;

    constructor(private RABBITMQ_URL: string) { }

    public async connect(): Promise<amqp.Channel> {
        try {
            this.connection = await amqp.connect(this.RABBITMQ_URL);
            this.channel = await this.connection.createChannel();

            this.connection.on("close", () => {
                console.error('RabbitMQ connection closed!');
            });

            this.connection.on("error", (err: Error) => {
                console.error('RabbitMQ connection error:', err);
                throw new Error("RabbitMQ connection error");
            });

            return this.channel;
        } catch (error) {
            console.error('Failed to connect to RabbitMQ:', error);
            throw new Error("Failed to connect to RabbitMQ");
        }
    }
}