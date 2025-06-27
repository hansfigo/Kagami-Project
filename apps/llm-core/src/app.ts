import { node } from "@elysiajs/node";
import { Elysia } from "elysia";
import { UserConfig } from "./config";
import { ChatService } from "./features/chat/chat.service";
import { chatHistoryVectorStore } from "./lib/Pinecone";
import { prisma } from "./lib/Prisma";
import { createMessageQueue, createRabbitMQClient } from "./lib/RabbitMQ";



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
            console.log(`LLM Core Server is running on http://${hostname}:3000`);
        }
        else {
            this.server.listen(3000);
            console.log("LLM Core Server is running on http://localhost:3000");
        }
    }

    private async registerRoutes(): Promise<void> {
        this.server.get("/", () => ({
            hello: "Node.js👋"
        }));

        this.server.get("/health", () => ({
            status: "ok"
        }));

        this.server.post("/api/chat", async (ctx) => {
            const body = ctx.body as { msg: string };

            if (!body.msg || typeof body.msg !== 'string') {
                ctx.set.status = 400;
                return { error: "Invalid message format. Please provide a valid string." };
            }

            const { aiResponse } = await this.chatService.addMessage(body.msg);
            return {
                message: "Message processed successfully",
                status: "success",
                data: {
                    input: body.msg,
                    response: aiResponse
                }
            }
        })

        this.server.post("/api/chat/search", async (ctx) => {
            const body = ctx.body as { query: string };

            if (!body.query || typeof body.query !== 'string') {
                ctx.set.status = 400;
                return { error: "Invalid message format. Please provide a valid string." };
            }

            const messages = await this.chatService.search(body.query);
            return {
                message: "Message processed successfully",
                status: "success",
                data: {
                    query: body.query,
                    result: messages
                }
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
    }
}

export async function startServer(): Promise<void> {
    const server = new Elysia({ adapter: node() })

    const rabbitMQClient = await createRabbitMQClient(process.env.RABBITMQ_URL || "amqp://localhost");
    const MessageQueue = await createMessageQueue(rabbitMQClient);

    const chatService = new ChatService(MessageQueue)

    const llmCore = new LLMCore(server, chatService);
    await llmCore.init();
}