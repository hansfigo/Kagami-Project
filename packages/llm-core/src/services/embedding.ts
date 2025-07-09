import { OpenAIEmbeddings } from "@langchain/openai";
import { config } from "../config";

export const embeddings = new OpenAIEmbeddings({
    model: config.embeddings.model
});