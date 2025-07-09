import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { OpenAIEmbeddings } from "@langchain/openai";
import 'dotenv/config';
import { config } from "../config";


export const embeddings = new OpenAIEmbeddings({
    model: config.embeddings.model
});

export const googleEmbeddings = new GoogleGenerativeAIEmbeddings({
    model: 'gemini-embedding-exp-03-07',
});