// src/index.ts
import axios from 'axios';
import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';

const MAX_TELEGRAM_MESSAGE_LENGTH = 4000;

// Ganti dengan TOKEN API bot Telegram-mu yang kamu dapat dari BotFather
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN

if (!TELEGRAM_BOT_TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN tidak ditemukan. Pastikan sudah diatur di .env file.');
    process.exit(1);
}

const LLM_API_URL = process.env.LLM_API_URL || 'http://localhost:3000/api/chat';

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

console.log('Bot Telegram sedang berjalan...');

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userMessage = msg.text;

    if (userMessage === '/start') {
        await bot.sendMessage(chatId, 'Halo! Aku Kagami, cermin virtualmu. Apa yang bisa aku bantu hari ini?');
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

    if (!userMessage) {
        console.log('Pesan kosong atau bukan teks.');
        return;
    }

    console.log(`Menerima pesan dari ${msg.from?.first_name}(${chatId}): ${userMessage}`);

    await bot.sendChatAction(chatId, 'typing');

    try {
        const response = await axios.post(LLM_API_URL, {
            msg: userMessage
        });

        const llmResponse = response.data.data.response || response.data.text || 'Maaf, aku gak ngerti.';

        if (llmResponse.length > MAX_TELEGRAM_MESSAGE_LENGTH) {
            console.log('Pesan terlalu panjang, akan dipecah menjadi beberapa bagian.');
            await sendLongMessageSafe(chatId, llmResponse);
        } else {
            await bot.sendMessage(chatId, llmResponse, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            });
        }

        console.log(`Mengirim balasan ke ${chatId}: "${llmResponse}"`);

    } catch (error: any) {
        console.error('Error saat memanggil LLM API:', error.message, error);
        await bot.sendMessage(chatId, 'Maaf, ada masalah saat memproses permintaanmu. Coba lagi nanti yaa.');
    }
});


async function sendLongMessageSafe(chatId: number, text: string): Promise<void> {
    const lines = text.split('\n');
    let currentPart = '';
    const partsToSend: string[] = [];

    for (const line of lines) {
        if ((currentPart + line).length > MAX_TELEGRAM_MESSAGE_LENGTH && currentPart.length > 0) {

            partsToSend.push(currentPart);
            currentPart = '';
        }
        currentPart += (currentPart.length > 0 ? '\n' : '') + line;
    }
    if (currentPart.length > 0) {
        partsToSend.push(currentPart);
    }

    for (const part of partsToSend) {
        try {
            await bot.sendMessage(chatId, part, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
            });
        } catch (innerError: any) {
            console.error(`Error sending part of message: ${innerError.message}. Part length: ${part.length}. Part content snippet: ${part.substring(0, 100)}...`);
            await bot.sendMessage(chatId, part);
        }
        await new Promise(resolve => setTimeout(resolve, 300));
    }
}


// Penanganan error sederhana
bot.on('polling_error', (error) => {
    console.error(`Polling error: ${error}`);
});