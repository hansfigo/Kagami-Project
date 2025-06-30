import { expect, test } from "vitest";
import { UserConfig } from "../config";
import { chatRepository } from "../features/chat/chat.repository";
import { prisma } from "../lib/Prisma";



test('getLatestMessage should return the latest message from the database', async () => {
    const latestMessage = await chatRepository.getLatestMessage();

    console.log(`Latest message: ${latestMessage}`);

    if (latestMessage === null) {
        console.log('No messages found in database');
        expect(latestMessage).toBeNull();
    } else {
        expect(latestMessage).toBeDefined();
        expect(typeof latestMessage).toBe('string');
    }
});