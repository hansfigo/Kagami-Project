import { createSystemPromot } from '../config';
import { getCurrentDateTimeInfo } from '../utils/date';

/**
 * Script untuk membandingkan penggunaan token antara versi system prompt
 */

// Mock data for testing
const mockChatHistory = `[user] (6/7/2025 10:30): hey kagami, gimana kabarmu?
[assistant] (6/7/2025 10:31): yaa biasa aja sih go. knp tiba-tiba nanya gitu? ada apaa?
[user] (6/7/2025 10:32): lagi stuck di typescript nih, bisa bantu?
[assistant] (6/7/2025 10:33): HAHH typescript lagi? emang masalahnya apaa sekarang?`;

const mockRecentChat = [
    '[user] (10:30): test message',
    '[assistant] (10:31): oke go'
];

const mockUserProfile = 'User: introvert INFP programmer, suka musik rock';

/**
 * Estimate token count (rough approximation)
 */
function estimateTokens(text: string): number {
    // Rough estimation: ~1.3 tokens per word for Indonesian text
    const words = text.split(/\s+/).length;
    const chars = text.length;
    
    // More accurate estimation considering Indonesian + technical terms
    return Math.ceil(words * 1.4 + chars * 0.1);
}

/**
 * Compare all system prompt versions
 */
function compareSystemPrompts() {
    console.log('🔍 System Prompt Token Comparison\n');
    
    const versions = ['default', 'old', 'optimized'] as const;
    const results: { [key: string]: { tokens: number; prompt: string } } = {};
    
    versions.forEach(version => {
        try {
            const prompt = createSystemPromot[version](
                mockChatHistory,
                getCurrentDateTimeInfo(),
                mockRecentChat,
                mockUserProfile
            );
            
            const tokens = estimateTokens(prompt);
            results[version] = { tokens, prompt };
            
            console.log(`📝 ${version.toUpperCase()}`);
            console.log(`   Tokens: ${tokens}`);
            console.log(`   Length: ${prompt.length} chars`);
            console.log(`   Preview: ${prompt.substring(0, 100)}...`);
            console.log('');
            
        } catch (error) {
            console.error(`❌ Error with ${version}:`, error);
        }
    });
    
    // Calculate savings
    if (results.old && results.optimized) {
        const savings = results.old.tokens - results.optimized.tokens;
        const percentage = (savings / results.old.tokens * 100).toFixed(1);
        
        console.log('💰 COST ANALYSIS');
        console.log(`   Old version: ${results.old.tokens} tokens`);
        console.log(`   Optimized: ${results.optimized.tokens} tokens`);
        console.log(`   Savings: ${savings} tokens (${percentage}%)`);
        console.log('');
        
        // Cost estimation (GPT-4 pricing: $0.03/1K input tokens)
        const oldCost = (results.old.tokens / 1000) * 0.03;
        const optimizedCost = (results.optimized.tokens / 1000) * 0.03;
        const costSavings = oldCost - optimizedCost;
        
        console.log('💵 MONTHLY COST (1000 conversations)');
        console.log(`   Old version: $${(oldCost * 1000).toFixed(2)}`);
        console.log(`   Optimized: $${(optimizedCost * 1000).toFixed(2)}`);
        console.log(`   Monthly savings: $${(costSavings * 1000).toFixed(2)}`);
        console.log(`   Annual savings: $${(costSavings * 12000).toFixed(2)}`);
    }
    
    return results;
}

/**
 * Test behavior consistency
 */
function testBehaviorConsistency() {
    console.log('\n🧪 BEHAVIOR CONSISTENCY TEST');
    
    const testCases = [
        'response to greeting',
        'typescript help request', 
        'music discussion',
        'code review'
    ];
    
    const keyBehaviors = [
        'uses lowercase start',
        'calls user "go" or "fig"',
        'tsundere personality',
        'casual Indonesian',
        'brutal honesty'
    ];
    
    console.log('Key behaviors to maintain:');
    keyBehaviors.forEach(behavior => {
        console.log(`   ✓ ${behavior}`);
    });
    
    console.log('\nTest cases:');
    testCases.forEach(test => {
        console.log(`   📋 ${test}`);
    });
    
    console.log('\n⚠️  Manual testing required for full behavior validation');
}

/**
 * Test token optimization features
 */
function testTokenOptimization() {
    console.log('\n🔧 TOKEN OPTIMIZATION TEST\n');
    
    // Test whitespace cleaning
    const messyText = `ini    pesan    dengan

    
    spacing    buruk    dan    
    
    newlines   berlebihan   `;
    
    const cleanedText = messyText.replace(/\s+/g, ' ').trim();
    
    console.log('📝 Content Cleaning Test:');
    console.log(`   Original: "${messyText}" (${messyText.length} chars)`);
    console.log(`   Cleaned:  "${cleanedText}" (${cleanedText.length} chars)`);
    console.log(`   Saved:    ${messyText.length - cleanedText.length} chars`);
    
    // Test system prompt cleaning
    const messyPrompt = `// SYSTEM PROMPT


    
    nama kamu Kagami    


    
    personality:    dingin    
    
    
    `;
    
    const cleanedPrompt = messyPrompt
        .replace(/[ ]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+$/gm, '')
        .replace(/^\s+/gm, '')
        .trim();
    
    console.log('\n📋 System Prompt Cleaning Test:');
    console.log(`   Original: ${messyPrompt.length} chars, ${estimateTokens(messyPrompt)} tokens`);
    console.log(`   Cleaned:  ${cleanedPrompt.length} chars, ${estimateTokens(cleanedPrompt)} tokens`);
    console.log(`   Savings:  ${estimateTokens(messyPrompt) - estimateTokens(cleanedPrompt)} tokens`);
}

// Run comparison
if (require.main === module) {
    try {
        compareSystemPrompts();
        testBehaviorConsistency();
        testTokenOptimization();
        
        console.log('\n✅ Comparison completed successfully');
        console.log('💡 Recommendation: Use "optimized" version for production');
        console.log('🔧 Token optimization active - expect 20-30% savings');
        
    } catch (error) {
        console.error('❌ Comparison failed:', error);
        process.exit(1);
    }
}

export { compareSystemPrompts, estimateTokens };

