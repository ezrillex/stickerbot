# Rolex AI StickerBot 🤖🎨

WhatsApp AI Sticker Bot built with [Baileys](https://baileys.wiki/), **Google Gemini Flash Lite** via **Cloudflare AI Gateway**, and **FLUX 2 Klein 4B** via **Cloudflare Workers AI**.

## Features

- 💬 **WhatsApp Multi-Device Integration**: Fast and reliable connection via `@whiskeysockets/baileys`.
- ✍️ **Natural DM Conversations**: Type any idea directly in private chat to generate a sticker—no commands required.
- ⚡ **Direct Photo → Sticker (Zero Quota)**: Send any photo without text (or say *"hazlo sticker"*) to instantly convert it into a WhatsApp sticker without consuming AI daily quota.
- 🎨 **Photo + Instruction AI Editing**: Send a photo with an instruction or reply to any photo (*"hazlo llorando"*, *"ponelo enojado"*) to edit and transform it with AI (`input_image_0`).
- 🎭 **Flexible Style Selection & Aliases**: Choose between die-cut sticker illustration and realistic cursed meme mode using slash commands (`/sticker`, `/meme`, `!sticker`, `!meme`) or natural prefixes (`sticker:`, `meme:`, `modo sticker`, `modo meme`).
- ⚡ **Bare Mode Transforms**: Send or reply to a photo with just `/sticker`, `/meme`, `sticker:`, `meme:`, `modo sticker`, or `modo meme` to transform the image directly without additional prompts.
- 🧠 **AI Prompt Enhancement**: Translates user requests into optimized prompts using `google/gemini-flash-lite-latest` proxied through Cloudflare AI Gateway.
- 🚀 **Sub-Second Image Generation**: Generates 512×512 images using `@cf/black-forest-labs/flux-2-klein-4b` via Cloudflare Workers AI.
- ✂️ **Automatic Background Cutout**: Smooth anti-aliased background removal with `sharp` to produce authentic die-cut stickers.
- 📦 **Native WhatsApp Stickers**: Encodes transparent WebP with custom EXIF metadata (`Rolex AI` / `StickerBot`).
- ⏱️ **Safe Daily Quota Limiter**: Enforces a global 50-sticker daily limit with atomic acquisition and automatic refund on any failure.
- 👥 **Group Safeguards**: Stays completely silent in groups unless tagged or replied to.

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

### 3. Verification & Testing

#### Option A: Offline Test Suite (Zero API Quota Used)
Run the offline verification suite to test message intent parsing, natural style aliases, bare command routing, rate limiting, and Baileys safeguards without consuming any API quota:

```bash
node test-verification.mjs
```

#### Option B: Live AI Pipeline Test (Consumes 1 Quota)
Run the live integration test to verify real Cloudflare and Gemini API connectivity:

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

## How to Use & Commands

### 📱 In Private Chat (DMs)

| Action / Message | What it does | AI Quota Used |
| :--- | :--- | :---: |
| **Send any text** (e.g. `un gato astronauta`) | Automatically creates an AI die-cut sticker (default mode) | 1 |
| **Send a photo without text** | Directly converts your photo to a sticker | **0 (Free)** |
| **Send a photo + "hazlo sticker"** | Directly converts your photo to a sticker | **0 (Free)** |
| **Send photo + instruction** (e.g. `hazlo llorando`) | Edits your photo with AI into a sticker | 1 |
| **Reply to any photo + instruction** | Edits that quoted photo with AI | 1 |
| **Send/reply to photo + `/sticker`**, `sticker:`, or `modo sticker` | Transforms photo into an illustrated die-cut sticker | 1 |
| **Send/reply to photo + `/meme`**, `meme:`, or `modo meme` | Transforms photo into a realistic cursed/candid meme | 1 |
| `/sticker <desc>`, `!sticker <desc>`, `sticker: <desc>`, or `modo sticker <desc>` | Forces die-cut sticker illustration mode | 1 |
| `/meme <desc>`, `!meme <desc>`, `meme: <desc>`, or `modo meme <desc>` | Forces realistic cursed/chaotic meme photo mode | 1 |
| `!status` or `/status` | Shows daily generations used, remaining, and reset time | 0 |
| `!help` or `/help` | Displays interactive in-chat help guide | 0 |

### 👥 In Groups

> **Note:** The bot completely ignores regular group conversation to avoid spam. To create stickers from text in groups, you must use an explicit mode selector (`/sticker`, `sticker:`, `/meme`, `meme:`). It only responds when tagged or quoted.

| Action / Message | What it does | AI Quota Used |
| :--- | :--- | :---: |
| `@bot /sticker <desc>` or `@bot sticker: <desc>` | Generates a die-cut illustration sticker | 1 |
| `@bot /meme <desc>` or `@bot meme: <desc>` | Generates a realistic cursed meme photo sticker | 1 |
| **Tag `@bot` on a photo (no text)** | Converts photo directly to sticker | **0 (Free)** |
| **Reply to a photo with `@bot` (no text)** | Converts quoted photo directly to sticker | **0 (Free)** |
| **Reply to photo with `@bot <instrucción>`** | Edits quoted photo with AI in sticker mode (e.g. `@bot hazlo llorando`) | 1 |
| **Reply to photo with `@bot /meme`** or `@bot meme:` | Transforms quoted photo into cursed meme photo style | 1 |
| **Reply to photo with `@bot /sticker`** or `@bot sticker:` | Transforms quoted photo into illustrated sticker style | 1 |
| `@bot !status` or `@bot /status` | Shows daily quota status | 0 |
| `@bot !help` or `@bot /help` | Displays group instructions and commands | 0 |
| *Unrelated or un-prefixed group text* | **Ignored completely** | 0 |

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
