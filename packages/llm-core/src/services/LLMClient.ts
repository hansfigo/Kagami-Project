import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import 'dotenv/config';

// export const llm = new ChatOpenAI({
//     model: "gpt-4o",
//     temperature: 1
// });

export const llm = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-pro",
    temperature: 1,
    maxRetries: 1,
});






