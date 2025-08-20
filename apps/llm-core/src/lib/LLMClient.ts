import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import { ChatXAI } from "@langchain/xai";
import 'dotenv/config';

// export const llm = new ChatOpenAI({
//     model: "gpt-4o",
//     temperature: 1
// });

// export const grok = new ChatXAI({
//     model: "grok-2.5",
//     temperature: 1,
//     apiKey: process.env.OPENROUTER_API_KEY || '',
// });

export const llm = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-pro",
    temperature: 1,
    maxRetries: 5,
});

export const secondaryLlm = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash",
    temperature: 1,
    maxRetries: 5,
});

// Lightweight Gemini instance for image analysis
export const visionLLM = new ChatGoogleGenerativeAI({
    model: "gemini-1.5-flash", // Faster and cheaper for image analysis
    temperature: 0.7,
    maxRetries: 2,
});









