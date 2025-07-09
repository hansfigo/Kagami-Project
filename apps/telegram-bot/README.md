# Telegram Bot - Kagami Project

Telegram bot yang mendukung chat multimodal (text + images) dengan integrasi ke LLM Core API.

## Features

- 📝 **Text Chat**: Chat biasa dengan AI
- 🖼️ **Image Chat**: Kirim gambar dengan caption untuk analisis
- 📚 **Album Support**: Kirim multiple images sekaligus
- 🔄 **Auto Retry**: Fallback ke pesan terakhir jika ada error
- 📱 **Telegram Native**: Support semua fitur Telegram (commands, media groups, etc.)

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Environment variables:**
   Create `.env` file:
   ```env
   TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
   LLM_API_URL=http://localhost:3000/api/chat
   ```

3. **Start development:**
   ```bash
   npm run dev
   ```

## Usage

### Commands
- `/start` - Mulai chat dengan bot
- `/help` - Tampilkan bantuan
- `/l` - Ambil pesan terakhir jika ada error
- `/test-formatting` - Test format pesan

### Chat Types

#### Text Chat
Kirim pesan text biasa:
```
Halo, apa kabar?
```

#### Image Chat
Kirim gambar dengan caption:
```
Caption: "Jelaskan gambar ini"
[Attach image]
```

#### Multiple Images
Kirim album gambar:
```
Caption: "Bandingkan kedua gambar ini"
[Attach 2-3 images as album]
```

## Architecture

```
Telegram User -> Telegram Bot -> LLM Core API -> AI Response
                      |
                      v
                Firebase Storage (for images)
```

### Message Flow

1. **Text Messages**: `message` -> `/api/chat` -> `response`
2. **Image Messages**: `photo` -> `download` -> `base64` -> `/api/chat` -> `response`
3. **Album Messages**: `media_group` -> `collect all` -> `process` -> `/api/chat` -> `response`

## API Integration

Bot menggunakan endpoints berikut dari LLM Core:

- `POST /api/chat` - Chat dengan text dan/atau images
- `GET /api/chat/latest` - Ambil pesan terakhir untuk fallback

### Request Format

```json
{
  "text": "User message",
  "images": ["data:image/jpeg;base64,..."] // optional
}
```

## Error Handling

1. **API Down**: Bot akan coba ambil pesan terakhir
2. **Image Processing Error**: Bot akan show error message
3. **Unsupported Message**: Bot akan show help message
4. **Network Error**: Bot akan retry atau show fallback

## Testing

1. **Start LLM Core server:**
   ```bash
   cd ../llm-core
   npm run dev
   ```

2. **Start Telegram Bot:**
   ```bash
   npm run dev
   ```

3. **Test in Telegram:**
   - Send text messages
   - Send images with captions
   - Send albums of images
   - Try all commands

## Development

### File Structure
```
src/
  index.ts          # Main bot logic
  lib/
    logger.ts       # Winston logger
```

### Key Functions
- `handleSingleMessage()` - Handle regular messages
- `handleMediaGroup()` - Handle album messages
- `handlePhotoMessage()` - Handle single image
- `handleTextMessage()` - Handle text only
- `processMediaGroup()` - Process collected album

## Deployment

1. **Build:**
   ```bash
   npm run build
   ```

2. **Start:**
   ```bash
   npm start
   ```

3. **Docker:**
   ```bash
   docker build -t telegram-bot .
   docker run -d --env-file .env telegram-bot
   ```

## Troubleshooting

### Bot doesn't respond
- Check `TELEGRAM_BOT_TOKEN`
- Verify bot is running
- Check logs for errors

### Image processing fails
- Verify LLM Core is running
- Check Firebase Storage config
- Ensure images are within limits

### API errors
- Check `LLM_API_URL`
- Verify network connectivity
- Check LLM Core logs

## Logs

Bot menggunakan Winston untuk logging:
- `info`: Normal operations
- `error`: Error conditions
- `warn`: Warning conditions

Check console output atau log files untuk debugging.
