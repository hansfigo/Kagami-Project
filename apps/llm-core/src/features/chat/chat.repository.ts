import { UserConfig } from "../../config";
import { prisma } from "../../lib/Prisma";


interface IChatRepository {
    getLatestMessage(): Promise<string | null>;
}

export class ChatRepository implements IChatRepository {


    constructor() {
    }

    public async getLatestMessage(): Promise<string | null> {
        const messages = await prisma.message.findMany({
            where: {
                conversationId: UserConfig.conversationId,
                role: 'assistant',
            },
            orderBy: {
                createdAt: 'desc',
            },
            take: 1,
        });

        return messages[0]?.content || null;
    }

    public async addMessage(data : any): Promise<void> {
        await prisma.message.create({
            data: data
        });
    }
}

export const chatRepository = new ChatRepository();


// Other routes can be added here as needed
// For example:
// this.server.post("/api/chat/send", async (ctx) => {
//     const body = ctx.body as { query: string };
//     const messages = await this.chatService.sendMessage(body.query);
//     return {
//         message: "Message sent successfully",