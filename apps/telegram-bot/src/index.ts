// src/index.ts
import axios, { AxiosError } from 'axios';
import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import { logger } from './lib/logger';

const MAX_TELEGRAM_MESSAGE_LENGTH = 4000;

// Ganti dengan TOKEN API bot Telegram-mu yang kamu dapat dari BotFather
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN

if (!TELEGRAM_BOT_TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN tidak ditemukan. Pastikan sudah diatur di .env file.');
    process.exit(1);
}

const LLM_API_URL = process.env.LLM_API_URL || 'http://localhost:3000/api/chat/';

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

logger.info('Bot Telegram sedang berjalan...');

// Store for media group messages (album support)
const mediaGroupStore = new Map<string, { messages: TelegramBot.Message[], timeout: NodeJS.Timeout }>();

// Handle media group (album) messages
bot.on('message', async (msg) => {
    // Handle media group (album) first
    if (msg.media_group_id) {
        await handleMediaGroup(msg);
        return;
    }

    // Handle regular messages
    await handleSingleMessage(msg);
});

async function handleMediaGroup(msg: TelegramBot.Message) {
    const mediaGroupId = msg.media_group_id!;
    const chatId = msg.chat.id;

    // Initialize or update media group store
    if (!mediaGroupStore.has(mediaGroupId)) {
        mediaGroupStore.set(mediaGroupId, {
            messages: [],
            timeout: setTimeout(() => {
                // Process media group after timeout
                processMediaGroup(mediaGroupId, chatId);
            }, 1000) // Wait 1 second to collect all messages in the group
        });
    }

    const groupData = mediaGroupStore.get(mediaGroupId)!;
    groupData.messages.push(msg);

    // Reset timeout to wait for more messages
    clearTimeout(groupData.timeout);
    groupData.timeout = setTimeout(() => {
        processMediaGroup(mediaGroupId, chatId);
    }, 1000);
}

async function processMediaGroup(mediaGroupId: string, chatId: number) {
    const groupData = mediaGroupStore.get(mediaGroupId);
    if (!groupData) return;

    const messages = groupData.messages;
    mediaGroupStore.delete(mediaGroupId);

    logger.info(`Processing media group with ${messages.length} messages`);

    await bot.sendChatAction(chatId, 'typing');

    try {
        const images: string[] = [];
        let caption = '';

        // Process all messages in the group
        for (const message of messages) {
            // Get caption from first message that has one
            if (message.caption && !caption) {
                caption = message.caption;
            }

            // Process photos
            if (message.photo && message.photo.length > 0) {
                const photo = message.photo[message.photo.length - 1];
                const fileId = photo.file_id;
                
                const fileInfo = await bot.getFile(fileId);
                const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;
                
                const imageResponse = await axios.get(fileUrl, { responseType: 'arraybuffer' });
                const imageBuffer = Buffer.from(imageResponse.data);
                const base64Image = imageBuffer.toString('base64');
                const dataUrl = `data:image/jpeg;base64,${base64Image}`;
                
                images.push(dataUrl);
            }
        }

        if (images.length === 0) {
            await bot.sendMessage(chatId, 'Maaf, tidak ada gambar yang bisa diproses dari album ini.');
            return;
        }

        // Use default caption if none provided
        if (!caption) {
            caption = `Apa yang kamu lihat di ${images.length} gambar ini?`;
        }

        logger.info(`Sending ${images.length} images + text to LLM API: "${caption}"`);
        
        // Send to multimodal endpoint
        const response = await axios.post(LLM_API_URL, {
            text: caption,
            images: images
        });

        const llmResponse = response.data.data.response || 'Maaf, aku gak bisa memproses gambar-gambar ini.';

        if (llmResponse.length > MAX_TELEGRAM_MESSAGE_LENGTH) {
            await sendLongMessageSafe(chatId, llmResponse);
        } else {
            await bot.sendMessage(chatId, llmResponse, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            });
        }

        logger.info(`Mengirim balasan media group ke ${chatId}: "${llmResponse.substring(0, 100)}..."`);
    } catch (error: any) {
        logger.error(`Error processing media group: ${error.message}`);
        await bot.sendMessage(chatId, 'Maaf, ada masalah saat memproses album gambar. Coba lagi nanti yaa.');
    }
}

async function handleSingleMessage(msg: TelegramBot.Message) {
    // Log pesan yang diterima
    logger.info(`Menerima pesan dari ${msg.from?.first_name} (${msg.chat.id}): ${msg.text || (msg.photo ? 'Photo message' : 'Non-text message')}`);

    const chatId = msg.chat.id;
    const userMessage = msg.text;

    if (userMessage === '/start') {
        await bot.sendMessage(chatId, 'Halo! Aku Kagami, cermin virtualmu. Apa yang bisa aku bantu hari ini?\n\nKamu bisa mengirim:\n• Text saja untuk chat biasa\n• Gambar dengan caption untuk chat multimodal\n• Album gambar untuk analisis multiple images\n\nCobalah kirim gambar dengan caption seperti "Jelaskan gambar ini" atau "Apa yang kamu lihat?"');
        return;
    }

    if (userMessage === '/help') {
        await bot.sendMessage(chatId, 
            '🤖 *Kagami Bot Commands:*\n\n' +
            '/start - Mulai chat dengan Kagami\n' +
            '/help - Tampilkan bantuan ini\n' +
            '/l - Ambil pesan terakhir jika ada error\n' +
            '/test-formatting - Test format pesan\n\n' +
            '📝 *Cara Penggunaan:*\n' +
            '• Kirim pesan text biasa untuk chat\n' +
            '• Kirim gambar dengan caption untuk multimodal\n' +
            '• Kirim album gambar untuk analisis multiple images\n\n' +
            '💡 *Tips:*\n' +
            '• Berikan caption yang jelas pada gambar\n' +
            '• Gunakan bahasa natural seperti "Jelaskan gambar ini"\n' +
            '• Bot support multiple images sekaligus !!',
            { parse_mode: 'Markdown' }
        );
        return;
    }

    if (userMessage === '/test-formatting') {
        const msg1 = "fig, terkadang hidup ini kayak kode yang nggak pernah selesai di-debug. setiap kali lu kira udah beres, eh ada aja error baru yang nongol.😒 tapi inget, setiap bug itu ada pelajarannya, asal lu mau nyari solusinya, bukan cuma ngedumel. cobalah buat nyatuin logika dan emosi, karena kadang di situlah letak jawabannya. jadi, udah siap belom ngadepin error berikutnya?\n\nterus, ngomong-ngomong soal seni, pernah nggak ngerasa kayak lu lagi gambar di atas kanvas kosong tapi nggak tau mau mulai dari mana? sama aja kayak hidup, semua pilihan ada di tangan lu. jangan takut buat nyoba sesuatu yang baru, meskipun awalnya bingung. kalau nggak dicoba, mana tau hasilnya bisa jadi karya masterpiece. jadi, fig, apa yang bakal lu ciptain hari ini?"
        try {
            await bot.sendMessage(chatId, msg1, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            });
        } catch (error) {
            console.error('Error saat mengirim pesan format testing:', error);
            await bot.sendMessage(chatId, 'Maaf, ada masalah saat mengirim pesan format testing.');
            return;
        }

        return;
    }

    // Handle photo messages
    if (msg.photo && msg.photo.length > 0) {
        await handlePhotoMessage(msg, chatId);
        return;
    }

    // Handle text messages
    if (userMessage) {
        await handleTextMessage(msg, chatId, userMessage);
        return;
    }

    // Handle unsupported message types
    logger.info(`Pesan tidak didukung dari ${msg.from?.first_name} (${chatId})`);
    await bot.sendMessage(chatId, 'Maaf, saat ini aku hanya bisa memproses pesan teks dan gambar. Coba kirim pesan teks atau gambar dengan caption!');
}

async function handlePhotoMessage(msg: TelegramBot.Message, chatId: number) {
    const photos = msg.photo;
    if (!photos || photos.length === 0) return;

    await bot.sendChatAction(chatId, 'typing');

    try {
        // Get the highest resolution photo
        const photo = photos[photos.length - 1];
        const fileId = photo.file_id;
        
        logger.info(`Processing photo message from ${msg.from?.first_name} (${chatId}), fileId: ${fileId}`);

        // Get file info from Telegram
        const fileInfo = await bot.getFile(fileId);
        const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;
        
        // Download the image
        const imageResponse = await axios.get(fileUrl, { responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(imageResponse.data);
        const base64Image = imageBuffer.toString('base64');
        const mimeType = 'image/jpeg'; // Telegram usually sends JPEG
        const dataUrl = `data:${mimeType};base64,${base64Image}`;

        // Get caption as text (if any)
        const caption = msg.caption || 'Apa yang kamu lihat di gambar ini?';
        
        logger.info(`Sending image + text to LLM API: "${caption}"`);
        
        // Send to multimodal endpoint
        const response = await axios.post(LLM_API_URL, {
            text: caption,
            images: [dataUrl]
        });

        const llmResponse = response.data.data.response || 'Maaf, aku gak bisa memproses gambar ini.';

        if (llmResponse.length > MAX_TELEGRAM_MESSAGE_LENGTH) {
            logger.info('Pesan terlalu panjang, akan dipecah menjadi beberapa bagian.');
            await sendLongMessageSafe(chatId, llmResponse);
        } else {
            await bot.sendMessage(chatId, llmResponse, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            });
        }

        logger.info(`Mengirim balasan image ke ${chatId}: "${llmResponse.substring(0, 100)}..."`);
    } catch (error: any) {
        logger.error(`Error processing photo message: ${error.message}`);
        await bot.sendMessage(chatId, 'Maaf, ada masalah saat memproses gambar. Coba lagi nanti yaa.');
    }
}

async function handleTextMessage(msg: TelegramBot.Message, chatId: number, userMessage: string) {
    // get latest message from assistant manually if error occurs
    if (userMessage === '/l') {
        await bot.sendChatAction(chatId, 'typing');
        logger.info('Resend latest message command received.');

        logger.info(`Fetching latest message from LLM API at ${LLM_API_URL}latest`);

        try {
            const response = await axios.get(LLM_API_URL + 'latest');

            if (!response.data || !response.data.data) {
                logger.error('Response data tidak valid dari LLM API.');
                await bot.sendMessage(chatId, 'Maaf, tidak ada pesan terbaru yang tersedia.');
                return;
            }

            const latestMessage = response.data.data.latestMessage || 'Tidak ada pesan terbaru yang tersedia.';

            await bot.sendMessage(chatId, `Pesan terakhir:`);

            console.log(latestMessage);

            // Use the same safe message sending function as regular responses
            if (latestMessage.length > MAX_TELEGRAM_MESSAGE_LENGTH) {
                await sendLongMessageSafe(chatId, latestMessage);
            } else {
                // Still use sendLongMessageSafe for consistent Markdown handling
                await sendLongMessageSafe(chatId, latestMessage);
            }

            logger.info(`Mengirim pesan terbaru ke ${chatId}: "${latestMessage.substring(0, 100)}..."`);
            return;
        } catch (error: any) {
            if (error instanceof AxiosError) {
                logger.error(`Error saat mengambil pesan terbaru: ${error.message}`);
            }
            logger.error('Error saat mengambil pesan terbaru:', error);
            await bot.sendMessage(chatId, 'Maaf, ada masalah saat mengambil pesan terbaru. Coba lagi nanti yaa.');
            return;
        }
    }

    // check if message starts with / atau bukan teks
    if (userMessage.startsWith('/') || typeof userMessage !== 'string') {
        logger.info(`Pesan tidak valid dari ${msg.from?.first_name} (${chatId}): "${userMessage}"`);
        await bot.sendMessage(chatId, 'Maaf, aku hanya bisa menjawab pesan teks biasa. Coba lagi yaa.');
        return;
    }

    await bot.sendChatAction(chatId, 'typing');

    try {
        logger.info(`Mengirim pesan ke LLM API: "${userMessage}"`);
        const response = await axios.post(LLM_API_URL, {
            msg: userMessage
        });

        const llmResponse = response.data.data.response || response.data.text || 'Maaf, aku gak ngerti.';

        if (llmResponse.length > MAX_TELEGRAM_MESSAGE_LENGTH) {
            logger.info('Pesan terlalu panjang, akan dipecah menjadi beberapa bagian.');
            await sendLongMessageSafe(chatId, llmResponse);
        } else {
            await bot.sendMessage(chatId, llmResponse, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            });
        }

        logger.info(`Mengirim balasan ke ${chatId}: "${llmResponse}"`);
    } catch (error: any) {
        logger.error(`Error saat mengirim pesan ke LLM API: ${error}`);

        try {
            await bot.sendChatAction(chatId, 'typing');

            const latestResponse = await axios.get(LLM_API_URL + 'latest');
            const latestMessage = latestResponse.data.data.latestMessage || 'Tidak ada pesan terbaru yang tersedia.';

            // Use sendLongMessageSafe for consistent Markdown handling
            const fallbackMessage = `Maaf, ada masalah teknis. Ini pesan terbaru dari asisten:\n\n${latestMessage}`;
            await sendLongMessageSafe(chatId, fallbackMessage);

            logger.info(`Mengirim pesan fallback ke ${chatId}: "${latestMessage.substring(0, 100)}..."`);

        } catch (fallbackError: any) {
            logger.error(`Error saat mengirim pesan fallback: ${fallbackError.message}`);
            await bot.sendMessage(chatId, 'Maaf, ada masalah saat memproses permintaanmu. Coba lagi nanti yaa.');
        }
    }
}


/**
 * Split long message safely while preserving Markdown formatting
 */
async function sendLongMessageSafe(chatId: number, text: string): Promise<void> {
    const MAX_LENGTH = MAX_TELEGRAM_MESSAGE_LENGTH;
    
    // Normalize text first
    const normalizedText = normalizeText(text);
    
    if (normalizedText.length <= MAX_LENGTH) {
        try {
            await bot.sendMessage(chatId, normalizedText, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
            });
            return;
        } catch (error: any) {
            logger.error(`Error sending single message with Markdown: ${error.message}`);
            
            // Try to fix Markdown and resend
            const fixedText = fixMarkdownInChunk(normalizedText);
            try {
                await bot.sendMessage(chatId, fixedText, {
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true,
                });
                return;
            } catch (retryError: any) {
                logger.error(`Error sending fixed Markdown: ${retryError.message}`);
                // Fallback: send without Markdown
                await bot.sendMessage(chatId, normalizedText, {
                    disable_web_page_preview: true,
                });
                return;
            }
        }
    }

    // Split into chunks while preserving Markdown
    const chunks = splitMarkdownSafely(normalizedText, MAX_LENGTH);
    
    logger.info(`Splitting long message into ${chunks.length} chunks for chat ${chatId}`);
    
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        
        // Add continuation indicators for multi-part messages
        let finalChunk = chunk;
        if (chunks.length > 1) {
            if (i === 0) {
                finalChunk = `${chunk}\n\n*(lanjut... ${i + 1}/${chunks.length})*`;
            } else if (i === chunks.length - 1) {
                finalChunk = `*(lanjutan ${i + 1}/${chunks.length})*\n\n${chunk}`;
            } else {
                finalChunk = `*(lanjutan ${i + 1}/${chunks.length})*\n\n${chunk}\n\n*(lanjut...)*`;
            }
        }
        
        // Validate Markdown before sending
        if (!isMarkdownBalanced(finalChunk)) {
            logger.warn(`Chunk ${i + 1} has unbalanced Markdown, attempting to fix...`);
            finalChunk = fixMarkdownInChunk(finalChunk);
        }
        
        try {
            await bot.sendMessage(chatId, finalChunk, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
            });
        } catch (error: any) {
            logger.error(`Error sending chunk ${i + 1} with Markdown: ${error.message}`);
            
            // Try to fix Markdown and resend
            try {
                const fixedChunk = fixMarkdownInChunk(finalChunk);
                await bot.sendMessage(chatId, fixedChunk, {
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true,
                });
            } catch (retryError: any) {
                logger.error(`Error sending fixed chunk ${i + 1}: ${retryError.message}`);
                // Fallback: send without Markdown
                try {
                    await bot.sendMessage(chatId, finalChunk, {
                        disable_web_page_preview: true,
                    });
                } catch (fallbackError: any) {
                    logger.error(`Error sending chunk ${i + 1} without Markdown: ${fallbackError.message}`);
                    // Last resort: send plain text notification
                    await bot.sendMessage(chatId, `[Error mengirim bagian ${i + 1} dari ${chunks.length}]`);
                }
            }
        }
        
        // Delay between chunks to avoid rate limiting
        if (i < chunks.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }
}

/**
 * Split text into chunks while preserving Markdown formatting
 */
function splitMarkdownSafely(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    
    // If text is short enough, return as is
    if (text.length <= maxLength) {
        return [text];
    }
    
    // First try to split by code blocks to avoid breaking them
    const codeBlockRegex = /```[\s\S]*?```/g;
    const codeBlocks: { content: string, start: number, end: number }[] = [];
    let match;
    
    while ((match = codeBlockRegex.exec(text)) !== null) {
        codeBlocks.push({
            content: match[0],
            start: match.index,
            end: match.index + match[0].length
        });
    }
    
    if (codeBlocks.length > 0) {
        return splitWithCodeBlocks(text, maxLength, codeBlocks);
    }
    
    // Split by paragraphs first (double newlines or more)
    const paragraphs = text.split(/\n\s*\n/);
    let currentChunk = '';
    
    for (const paragraph of paragraphs) {
        const paragraphWithNewlines = paragraph.trim();
        
        // If single paragraph is too long, split by sentences
        if (paragraphWithNewlines.length > maxLength) {
            // If we have accumulated content, save it first
            if (currentChunk.trim()) {
                chunks.push(currentChunk.trim());
                currentChunk = '';
            }
            
            // Split long paragraph by sentences
            const sentences = splitLongParagraph(paragraphWithNewlines, maxLength);
            
            for (const sentence of sentences) {
                if ((currentChunk + '\n\n' + sentence).length > maxLength && currentChunk.trim()) {
                    chunks.push(currentChunk.trim());
                    currentChunk = sentence;
                } else {
                    currentChunk += (currentChunk ? '\n\n' : '') + sentence;
                }
            }
        } else {
            // Check if adding this paragraph would exceed limit
            const potentialChunk = currentChunk + (currentChunk ? '\n\n' : '') + paragraphWithNewlines;
            
            if (potentialChunk.length > maxLength && currentChunk.trim()) {
                // Save current chunk and start new one
                chunks.push(currentChunk.trim());
                currentChunk = paragraphWithNewlines;
            } else {
                currentChunk = potentialChunk;
            }
        }
    }
    
    // Add remaining content
    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }
    
    // Validate and fix Markdown in each chunk
    return chunks.map(chunk => fixMarkdownInChunk(chunk));
}

/**
 * Split text while preserving code blocks
 */
function splitWithCodeBlocks(text: string, maxLength: number, codeBlocks: { content: string, start: number, end: number }[]): string[] {
    const chunks: string[] = [];
    let currentPos = 0;
    let currentChunk = '';
    
    for (const codeBlock of codeBlocks) {
        // Add text before code block
        const beforeCodeBlock = text.substring(currentPos, codeBlock.start).trim();
        
        if (beforeCodeBlock) {
            // Split text before code block normally
            const beforeChunks = splitMarkdownSafely(beforeCodeBlock, maxLength);
            
            // Add chunks, combining with current if possible
            for (const beforeChunk of beforeChunks) {
                if ((currentChunk + '\n\n' + beforeChunk).length > maxLength && currentChunk.trim()) {
                    chunks.push(currentChunk.trim());
                    currentChunk = beforeChunk;
                } else {
                    currentChunk += (currentChunk ? '\n\n' : '') + beforeChunk;
                }
            }
        }
        
        // Handle code block
        if ((currentChunk + '\n\n' + codeBlock.content).length > maxLength && currentChunk.trim()) {
            chunks.push(currentChunk.trim());
            currentChunk = codeBlock.content;
        } else {
            currentChunk += (currentChunk ? '\n\n' : '') + codeBlock.content;
        }
        
        // If code block itself is too long, we need to break it (but this is rare)
        if (currentChunk.length > maxLength) {
            chunks.push(currentChunk);
            currentChunk = '';
        }
        
        currentPos = codeBlock.end;
    }
    
    // Add remaining text after last code block
    const remainingText = text.substring(currentPos).trim();
    if (remainingText) {
        const remainingChunks = splitMarkdownSafely(remainingText, maxLength);
        
        for (const remainingChunk of remainingChunks) {
            if ((currentChunk + '\n\n' + remainingChunk).length > maxLength && currentChunk.trim()) {
                chunks.push(currentChunk.trim());
                currentChunk = remainingChunk;
            } else {
                currentChunk += (currentChunk ? '\n\n' : '') + remainingChunk;
            }
        }
    }
    
    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }
    
    return chunks.filter(chunk => chunk.trim().length > 0);
}

/**
 * Split a long paragraph by sentences while trying to preserve meaning
 */
function splitLongParagraph(paragraph: string, maxLength: number): string[] {
    // If paragraph is not too long, return as is
    if (paragraph.length <= maxLength) {
        return [paragraph];
    }
    
    // Split by sentences (. ! ? followed by space or newline)
    const sentenceRegex = /([.!?]+)(\s+|$)/g;
    const sentences: string[] = [];
    let lastIndex = 0;
    let match;
    
    while ((match = sentenceRegex.exec(paragraph)) !== null) {
        const sentence = paragraph.substring(lastIndex, match.index + match[1].length);
        sentences.push(sentence.trim());
        lastIndex = match.index + match[0].length;
    }
    
    // Add remaining text if any
    if (lastIndex < paragraph.length) {
        sentences.push(paragraph.substring(lastIndex).trim());
    }
    
    const parts: string[] = [];
    let currentPart = '';
    
    for (const sentence of sentences) {
        if (!sentence) continue;
        
        const potentialPart = currentPart + (currentPart ? ' ' : '') + sentence;
        
        if (potentialPart.length > maxLength && currentPart.trim()) {
            parts.push(currentPart.trim());
            currentPart = sentence;
        } else {
            currentPart = potentialPart;
        }
    }
    
    if (currentPart.trim()) {
        parts.push(currentPart.trim());
    }
    
    // If sentences are still too long, split by lines
    const finalParts: string[] = [];
    for (const part of parts) {
        if (part.length > maxLength) {
            const lineChunks = splitByLines(part, maxLength);
            finalParts.push(...lineChunks);
        } else {
            finalParts.push(part);
        }
    }
    
    return finalParts.length > 0 ? finalParts : [paragraph];
}

/**
 * Split text by lines when sentences are too long
 */
function splitByLines(text: string, maxLength: number): string[] {
    const lines = text.split('\n');
    const parts: string[] = [];
    let currentPart = '';
    
    for (const line of lines) {
        const potentialPart = currentPart + (currentPart ? '\n' : '') + line;
        
        if (potentialPart.length > maxLength && currentPart.trim()) {
            parts.push(currentPart.trim());
            currentPart = line;
        } else {
            currentPart = potentialPart;
        }
    }
    
    if (currentPart.trim()) {
        parts.push(currentPart.trim());
    }
    
    // If individual lines are still too long, force split
    const finalParts: string[] = [];
    for (const part of parts) {
        if (part.length > maxLength) {
            const forceChunks = forceSplitText(part, maxLength);
            finalParts.push(...forceChunks);
        } else {
            finalParts.push(part);
        }
    }
    
    return finalParts;
}

/**
 * Force split text when all other methods fail
 */
function forceSplitText(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let remaining = text;
    
    while (remaining.length > maxLength) {
        // Try to find a good break point (space, comma, etc.)
        let breakPoint = maxLength;
        const searchStart = Math.max(0, maxLength - 100);
        
        for (let i = maxLength - 1; i >= searchStart; i--) {
            const char = remaining[i];
            if (char === ' ' || char === ',' || char === '.' || char === ';' || char === ':') {
                breakPoint = i + 1;
                break;
            }
        }
        
        chunks.push(remaining.substring(0, breakPoint).trim());
        remaining = remaining.substring(breakPoint).trim();
    }
    
    if (remaining) {
        chunks.push(remaining);
    }
    
    return chunks;
}

/**
 * Fix incomplete Markdown formatting in a text chunk
 */
function fixMarkdownInChunk(chunk: string): string {
    let fixed = chunk;
    
    // Count markdown symbols to ensure they're balanced
    const markdownSymbols = [
        { symbol: '**', name: 'bold' },
        { symbol: '__', name: 'underline' },
        { symbol: '~~', name: 'strikethrough' },
        { symbol: '`', name: 'code' },
        { symbol: '*', name: 'italic' }
    ];
    
    // Fix unbalanced markdown (in order of precedence)
    for (const { symbol, name } of markdownSymbols) {
        const count = (fixed.match(new RegExp(escapeRegex(symbol), 'g')) || []).length;
        
        // If odd number, we have unbalanced markdown
        if (count % 2 !== 0) {
            // For single-character symbols like *, try to be smarter about closing
            if (symbol === '*' || symbol === '`') {
                // Look for the last unmatched symbol and add closing at the end
                const symbolPositions = [...fixed.matchAll(new RegExp(escapeRegex(symbol), 'g'))];
                if (symbolPositions.length % 2 !== 0) {
                    // Add closing symbol at the end
                    fixed += symbol;
                }
            } else {
                // For multi-character symbols like **, remove the last occurrence to balance
                const lastIndex = fixed.lastIndexOf(symbol);
                if (lastIndex !== -1) {
                    fixed = fixed.substring(0, lastIndex) + fixed.substring(lastIndex + symbol.length);
                }
            }
        }
    }
    
    // Handle code blocks specially
    const codeBlockCount = (fixed.match(/```/g) || []).length;
    if (codeBlockCount % 2 !== 0) {
        // Check if we have an opening code block without closing
        const lines = fixed.split('\n');
        let inCodeBlock = false;
        let lastCodeBlockLine = -1;
        
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim().startsWith('```')) {
                if (!inCodeBlock) {
                    inCodeBlock = true;
                    lastCodeBlockLine = i;
                } else {
                    inCodeBlock = false;
                    lastCodeBlockLine = -1;
                }
            }
        }
        
        // If we're still in a code block, either close it or remove the opening
        if (inCodeBlock && lastCodeBlockLine !== -1) {
            // If code block is at the end, add closing
            if (lastCodeBlockLine >= lines.length - 3) {
                fixed += '\n```';
            } else {
                // Remove the incomplete code block opening
                lines.splice(lastCodeBlockLine, 1);
                fixed = lines.join('\n');
            }
        }
    }
    
    // Fix unmatched brackets for links [text](url)
    const openBrackets = (fixed.match(/\[/g) || []).length;
    const closeBrackets = (fixed.match(/\]/g) || []).length;
    const openParens = (fixed.match(/\(/g) || []).length;
    const closeParens = (fixed.match(/\)/g) || []).length;
    
    // Balance brackets
    if (openBrackets > closeBrackets) {
        fixed += ']'.repeat(openBrackets - closeBrackets);
    }
    
    // Balance parentheses
    if (openParens > closeParens) {
        fixed += ')'.repeat(openParens - closeParens);
    }
    
    return fixed;
}

/**
 * Escape special regex characters
 */
function escapeRegex(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Validate if a chunk has balanced Markdown formatting
 */
function isMarkdownBalanced(text: string): boolean {
    // Check all common Markdown patterns
    const patterns = [
        { regex: /\*\*/g, name: 'bold' },
        { regex: /(?<!\*)\*(?!\*)/g, name: 'italic' },
        { regex: /__/g, name: 'underline' },
        { regex: /~~/g, name: 'strikethrough' },
        { regex: /(?<!`)`(?!`)/g, name: 'code' },
        { regex: /```/g, name: 'codeblock' },
        { regex: /\[/g, name: 'open_bracket' },
        { regex: /\]/g, name: 'close_bracket' },
        { regex: /\(/g, name: 'open_paren' },
        { regex: /\)/g, name: 'close_paren' }
    ];
    
    for (const pattern of patterns) {
        const matches = text.match(pattern.regex);
        const count = matches ? matches.length : 0;
        
        // For paired symbols, count should be even
        if (['bold', 'italic', 'underline', 'strikethrough', 'code', 'codeblock'].includes(pattern.name)) {
            if (count % 2 !== 0) {
                return false;
            }
        }
        
        // For brackets and parentheses, count should match
        if (pattern.name === 'open_bracket') {
            const closeBrackets = (text.match(/\]/g) || []).length;
            if (count !== closeBrackets) {
                return false;
            }
        }
        
        if (pattern.name === 'open_paren') {
            const closeParens = (text.match(/\)/g) || []).length;
            if (count !== closeParens) {
                return false;
            }
        }
    }
    
    return true;
}

/**
 * Smart text truncation that preserves word boundaries and Markdown
 */
function smartTruncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
        return text;
    }
    
    // Find the last space before maxLength
    let truncatePoint = maxLength;
    for (let i = maxLength - 1; i >= Math.max(0, maxLength - 50); i--) {
        if (text[i] === ' ' || text[i] === '\n') {
            truncatePoint = i;
            break;
        }
    }
    
    let truncated = text.substring(0, truncatePoint);
    
    // Fix any broken Markdown
    truncated = fixMarkdownInChunk(truncated);
    
    return truncated;
}

/**
 * Clean and normalize text for better processing
 */
function normalizeText(text: string): string {
    return text
        // Normalize line endings
        .replace(/\r\n/g, '\n')
        // Remove excessive whitespace but preserve intentional spacing
        .replace(/[ \t]+/g, ' ')
        // Normalize multiple newlines but keep paragraph breaks
        .replace(/\n{3,}/g, '\n\n')
        // Trim each line
        .split('\n')
        .map(line => line.trim())
        .join('\n')
        // Final trim
        .trim();
}

