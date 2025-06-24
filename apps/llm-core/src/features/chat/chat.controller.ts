import { Context } from "elysia";
import { IChatService } from "./chat.service";

export class ChatController {
    constructor(private chatService: IChatService) {
    }

    public sendMessage(ctx: any) {
        console.log(ctx)

        // if (!body.msg || typeof body.msg !== 'string') {
        //     set.status = 400;
        //     return { error: "Invalid message format. Please provide a valid string." };
        // }

        // const llmResponse = this.chatService.addMessage(body.msg);

        // return llmResponse;

        return "test"
    }
}


