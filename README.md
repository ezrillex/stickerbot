# Rolex AI StickerBot 🤖🎨

WhatsApp AI Sticker Bot built with [Baileys](https://baileys.wiki/), **Google Gemini Flash Lite** via **Cloudflare AI Gateway**, and **FLUX 2 Klein 4B** via **Cloudflare Workers AI**.

## Features

- 💬 **WhatsApp Multi-Device Integration**: Fast and reliable connection via `@whiskeysockets/baileys`.
- 🧠 **AI Prompt Enhancement**: Translates casual user requests into optimized sticker prompts using `google/gemini-flash-lite-latest` proxied through Cloudflare AI Gateway.
- ⚡ **Sub-Second Image Generation**: Generates 512×512 images using `@cf/black-forest-labs/flux-2-klein-4b` via Cloudflare Workers AI.
- ✂️ **Automatic Background Cutout**: Smooth anti-aliased background removal with `sharp` to produce authentic die-cut stickers.
- 📦 **Native WhatsApp Stickers**: Encodes transparent WebP with custom EXIF metadata (`Rolex AI` / `StickerBot`).
- ⏱️ **Daily Quota Limiter**: Enforces a global 50-sticker daily limit that automatically resets at 00:00 UTC (matching Cloudflare neuron resets).
- 👥 **Group Chat & DM Support**: Works directly in private chats, and in groups when tagged or prefixed with `!sticker`.

---

## Getting Started

### 1. Requirements

- Node.js 20.0.0 or higher
- A phone with WhatsApp installed (recommended: dedicated/prepaid number)

### 2. Configuration

Ensure `.env` contains your credentials:

```ini
# Cloudflare Account & AI Gateway
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
CLOUDFLARE_GATEWAY_ID=default
CLOUDFLARE_GATEWAY_TOKEN=your_token
CLOUDFLARE_API_TOKEN=your_token

# Google AI Studio (Gemini)
GEMINI_API_KEY=your_gemini_api_key

# Bot Configuration
DAILY_LIMIT=50
STICKER_PACK=Rolex AI
STICKER_AUTHOR=StickerBot
BOT_PREFIX=!sticker
```

### 3. Verification Test

Run the offline AI pipeline test to verify your API keys and models without WhatsApp:

```bash
npm run test:ai
```

### 4. Run the Bot

Start the WhatsApp bot:

```bash
npm start
```

You have two ways to authenticate:

#### Option A: Phone Number Pairing Code (No Camera Needed)
1. Either put your phone number in `.env`: `BOT_PHONE_NUMBER=15551234567` (with country code, no `+` or spaces), or enter it when prompted in terminal.
2. The bot will print an 8-character pairing code (e.g. `ABCD-1234`).
3. On your phone, open WhatsApp > **Linked Devices** > **Link a Device** > tap **"Link with phone number instead"** at the bottom.
4. Enter the pairing code.

#### Option B: QR Code
1. Leave `BOT_PHONE_NUMBER` blank in `.env` and press `ENTER` when prompted.
2. Scan the terminal QR code using WhatsApp camera.

---

## Bot Commands

| Command / Input | Context | Behavior |
| :--- | :--- | :--- |
| `!sticker a cute astronaut kitten` | DM | Generates die-cut illustration sticker with clean borders |
| `/sticker cyber samurai cat` | DM | Generates die-cut illustration sticker (supports `/` or `!`) |
| `/meme un gato blanco mamado` | DM | Generates realistic low-quality candid meme photo sticker (no borders) |
| `!meme perro mirando de reojo` | DM | Generates low-res reaction meme sticker (supports `/` or `!`) |
| `@bot /meme gato mamado sonriendo` | Group | **Required:** Tag bot + `/meme` command |
| `@bot !sticker neon skull` | Group | **Required:** Tag bot + `!sticker` command |
| `probando` / casual text | DM or Group | **Ignored completely** |
| `!status` | DM or Group | Displays daily usage and reset countdown |
| `!help` | DM or Group | Displays instructions and examples |

---

## Production Deployment with PM2

### 1. Install PM2 Globally
```bash
npm install -g pm2
```

### 2. Start the Bot
```bash
pm2 start ecosystem.config.cjs
```

> **IMPORTANT:** Always run with `instances: 1` (`exec_mode: 'fork'`). Never run WhatsApp bots in cluster mode.

### 3. Manage the Process
```bash
# View real-time logs
pm2 logs stickerbot

# View bot status and resource usage
pm2 status

# Restart the bot
pm2 restart stickerbot

# Stop the bot
pm2 stop stickerbot
```

### 4. Enable Auto-Start on Server Reboot
```bash
pm2 startup
pm2 save
```
