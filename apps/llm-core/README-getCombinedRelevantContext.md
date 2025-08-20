# getCombinedRelevantContext Function

## Overview

The `getCombinedRelevantContext` function is a comprehensive chat history retrieval system that merges semantic search results from Pinecone vector store with recent messages from PostgreSQL database. This provides optimal context for LLM responses by combining both long-term memory (semantic relevance) and short-term memory (recent conversation state).

## Function Signature

```typescript
export const getCombinedRelevantContext = async (
    query: string,
    userId: string,
    conversationId: string,
    limit: number = 15
): Promise<CombinedRelevantContext>
```

## Parameters

- **query**: The user's message or query to search for semantic similarity
- **userId**: The user ID to filter messages for
- **conversationId**: The conversation ID to get recent messages from  
- **limit**: Maximum number of messages to return (default: 15)

## Return Type

```typescript
interface CombinedRelevantContext {
    messages: CombinedMessage[];
    totalMessages: number;
    vectorMessages: number;
    databaseMessages: number;
    formattedContext: string;
}

interface CombinedMessage {
    id: string;
    role: string;
    content: string;
    timestamp: number;
    source: 'vector' | 'database';
    conversationId: string;
    metadata?: any;
}
```

## How It Works

### 1. **Vector Store Search** 🔍
- Performs semantic search in Pinecone vector store
- Searches for both user and assistant messages separately
- Balances results by interleaving user and assistant messages
- Provides long-term memory based on semantic similarity

### 2. **Database Query** 📝
- Retrieves recent messages from PostgreSQL using Prisma
- Gets chronologically ordered messages from the specific conversation
- Provides short-term memory with recent conversation state

### 3. **Deduplication** 🔄
- Uses message IDs to remove duplicates between vector and database results
- Vector store results take precedence (semantic relevance)
- Ensures no message appears twice in the final context

### 4. **Chronological Sorting** ⏰
- Sorts all messages by timestamp in ascending order
- Maintains natural conversation flow
- Limits results to the specified number of most recent messages

### 5. **Formatted Output** 📝
- Creates a formatted string suitable for LLM context
- Includes visual indicators for source (🔍 for vector, 📝 for database)
- Formats timestamps in Indonesian locale
- Ready to use in system prompts

## Usage Example

```typescript
import { getCombinedRelevantContext } from './features/chat/chat.service';

async function handleUserMessage(userMessage: string, userId: string, conversationId: string) {
    // Get combined context
    const context = await getCombinedRelevantContext(
        userMessage,
        userId,
        conversationId,
        12 // Limit to 12 messages
    );

    // Build system prompt
    const systemPrompt = `
You are Kagami, an AI assistant with conversation history.

## Conversation Context:
${context.formattedContext}

## Current User Message:
${userMessage}

Please respond based on the conversation context above.
`;

    // Send to LLM
    const response = await llm.call(systemPrompt);
    return response;
}
```

## Key Features

### ✅ **Robust Error Handling**
- Graceful fallback when vector store is unavailable
- Continues with database results if vector search fails
- Validates input parameters before processing
- Specific error messages for debugging

### ✅ **Performance Optimized**
- Parallel execution of vector and database queries
- Efficient deduplication using Map data structure
- Limited result sets to control token usage
- Configurable limits for different use cases

### ✅ **Comprehensive Logging**
- Detailed logs for debugging and monitoring
- Performance metrics (message counts, source distribution)
- Context length tracking for token management
- Visual indicators in formatted output

### ✅ **Type Safety**
- Full TypeScript support with exported interfaces
- Strongly typed parameters and return values
- Runtime validation for critical parameters
- Clear interface definitions

## Test Coverage

The function includes comprehensive test coverage:

- ✅ Basic functionality with combined results
- ✅ Graceful handling of missing vector store data
- ✅ Input parameter validation
- ✅ Result limiting and pagination
- ✅ Message deduplication
- ✅ Chronological sorting
- ✅ Error handling and recovery

## Integration Points

### **Existing Systems**
- Uses existing `chatHistoryVectorStore` from Pinecone integration
- Leverages `prisma` client for database queries  
- Integrates with existing logging system
- Compatible with current message schema

### **Future Enhancements**
- Could be extended with caching for frequently accessed contexts
- May support custom scoring algorithms for message ranking
- Could include user preference-based filtering
- Potential for conversation summarization integration

## Performance Considerations

- **Vector Search**: ~2-4 seconds depending on index size
- **Database Query**: ~100-500ms for typical conversation sizes
- **Memory Usage**: Minimal - processes results in streaming fashion
- **Token Usage**: Configurable limits prevent context overflow

## Error Scenarios

1. **Invalid Parameters**: Throws specific validation errors
2. **Vector Store Unavailable**: Continues with database results only
3. **Database Connection Issues**: Continues with vector results only
4. **Empty Results**: Returns empty context with proper structure
5. **Network Timeouts**: Implements graceful degradation

This function represents a significant enhancement to the chat system's ability to provide contextually rich and relevant responses by intelligently combining multiple data sources.
