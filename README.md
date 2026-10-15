# Rolex AI StickerBot

A WhatsApp bot that turns text ideas and photos into stickers. It uses [Baileys](https://baileys.wiki/) for WhatsApp, Gemini through Cloudflare AI Gateway for prompts, and FLUX 2 Klein through Cloudflare Workers AI for image generation.

- Write an idea in a private chat to generate an illustrated sticker.
- Send a photo without text to convert it directly, without an AI request.
- Send or quote a photo with instructions to edit it with AI.
- Choose illustrated sticker or photographic meme style.
- In groups, the bot responds only when mentioned or when you reply to its messages.

## Quick start

You need **Node.js 20 or newer**, **Git** (also used by a dependency during installation), a WhatsApp account, and Cloudflare and Gemini credentials. AI credentials are required to start the bot, including when using direct photo conversion.

```sh
git clone https://github.com/ezrillex/stickerbot.git
cd stickerbot
npm ci
```

Copy the example configuration:

```sh
# macOS / Linux
cp .env.example .env
```

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

Edit `.env` with your credentials, then start:

```sh
npm start
```

Keep the terminal running while using the bot. Stop it with **Ctrl+C**. Run one bot process per WhatsApp account.

## AI credentials

| Variable | Where to get it |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID; see the [Workers AI REST setup](https://developers.cloudflare.com/workers-ai/get-started/rest-api/). |
| `CLOUDFLARE_API_TOKEN` | Create a Workers AI token using the [Workers AI token template](https://developers.cloudflare.com/workers-ai/get-started/rest-api/). A custom token needs Workers AI Read and Edit permissions for your account. |
| `CLOUDFLARE_GATEWAY_ID` | Create an [AI Gateway](https://developers.cloudflare.com/ai-gateway/get-started/) in the same account and use its ID. The default is `default`; your gateway must match it. |
| `CLOUDFLARE_GATEWAY_TOKEN` | Create an [authentication token](https://developers.cloudflare.com/ai-gateway/configuration/authentication/) with AI Gateway Run permission. |
| `GEMINI_API_KEY` | Create a Gemini API key in [Google AI Studio](https://ai.google.dev/gemini-api/docs/api-key). |

The Gemini request goes through AI Gateway; image generation goes directly to Workers AI. Provider quotas and billing apply independently of the bot's daily limit.

### Optional settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `DAILY_LIMIT` | `50` | Global successful AI sticker requests per UTC day. Must be a positive integer. Failed requests refund their reservation. |
| `AI_TIMEOUT_MS` | `60000` | Deadline for each AI request, including reading its response. Must be a positive integer. |
| `STICKER_PACK` | `Rolex AI` | Sticker pack metadata. |
| `STICKER_AUTHOR` | `StickerBot` | Sticker author metadata. |
| `BOT_PREFIX` | `!sticker` | Additional sticker command, such as `!draw`. Built-in commands remain available. Use one command without spaces. |
| `BOT_PHONE_NUMBER` | Empty | Phone number for pairing codes, including country code, without `+` or spaces. |
| `BOT_DATA_DIR` | `data/` in the repository | Alternative directory for daily usage storage. Relative paths resolve from the working directory. |

The bot reads `.env` from the repository directory. Environment variables already set in your shell take precedence.

## Link WhatsApp

On first startup, choose one of these methods:

**Pairing code:** Set `BOT_PHONE_NUMBER` in `.env`, or enter your number at the terminal prompt. On your phone, open WhatsApp → Linked devices → Link a device → Link with phone number instead. Enter the displayed code.

**QR code:** Leave `BOT_PHONE_NUMBER` empty and press Enter at the prompt. Open WhatsApp → Linked devices → Link a device and scan the terminal QR code. If the terminal cannot accept interactive input, the bot uses QR pairing automatically.

The session is saved in `auth_session/`, so subsequent starts reuse it. If you log out through WhatsApp, restart the bot to link again.

## Usage

### Private chats

Any ordinary text idea triggers AI generation. Messages and replies to photos use these rules:

| Input | Result | Bot daily quota |
| --- | --- | --- |
| `un gato astronauta` | Illustrated sticker | 1 |
| `/sticker <idea>` or `!sticker <idea>` | Illustrated sticker | 1 |
| `/meme <idea>` or `!meme <idea>` | Photographic meme sticker | 1 |
| `sticker: <idea>` / `modo sticker <idea>` | Illustrated sticker | 1 |
| `meme: <idea>` / `modo meme <idea>` | Photographic meme sticker | 1 |
| Photo without text, or with `hazlo sticker`, `hacelo sticker`, or `sticker` | Direct photo conversion | 0 |
| Photo + instruction, or reply to a photo + instruction | AI photo edit | 1 |
| Photo + bare `/sticker`, `sticker:`, or `modo sticker` | AI illustration transform | 1 |
| Photo + bare `/meme`, `meme:`, or `modo meme` | AI photographic meme transform | 1 |
| `/help` or `!help` | Usage instructions | 0 |
| `/status` or `!status` | Daily usage and reset time | 0 |

A bare mode command on a photo requests an **AI transform**. For direct conversion, send the photo without text instead. Bang commands (`!sticker`, `!meme`) also support bare transforms.

### Groups

Mention the bot or reply to one of its messages. For text-only requests, also include a mode selector, such as `@bot /sticker gato astronauta` or `@bot meme: gato sorprendido`. Your configured `BOT_PREFIX` works here too.

For photos, mention the bot on the photo or in a reply to it. No instruction converts the photo directly; an instruction edits it with AI. `/help` and `/status` also require addressing the bot. Other group messages are ignored.

## Tests and development

```sh
npm test
```

The offline suite uses dummy credentials, mocked API responses, and temporary usage storage. It needs no `.env`, does not connect to WhatsApp, and does not consume provider quota or modify your daily usage. It covers command routing, group safeguards, media downloads, AI timeouts and refunds, persistence, and real WebP conversion.

To check real AI connectivity after configuring credentials:

```sh
npm run test:ai
```

This optional live test makes **two Gemini requests and two image generations**: one new image and one edit. It consumes provider quota/billing and bypasses the bot's daily usage counter. Results are written to `temp/`.

Source modules:

- `src/main.js`: startup.
- `src/index.js`: message routing and the sticker pipeline.
- `src/messages.js` / `src/replies.js`: commands and chat responses.
- `src/whatsapp.js` / `src/media.js`: connection, authentication, and image downloads.
- `src/gemini.js` / `src/imageGen.js` / `src/request.js`: AI clients and request deadlines.
- `src/sticker.js`: background removal and WebP metadata.
- `src/limiter.js`: daily usage persistence.
- `src/imageLog.js`: generated image logging.

## Troubleshooting and local files

- **Missing environment variable:** Copy `.env.example` to `.env` and fill in every required credential.
- **AI authentication error:** Check that tokens belong to the configured account, the gateway ID exists, and the token permissions match the credential table.
- **AI timeout:** Try again, or increase `AI_TIMEOUT_MS` if your connection consistently needs more time. Failed requests release their bot quota reservation.
- **Old photo cannot download:** Resend the photo. Downloads have a 25-second deadline and a 20 MiB size limit.
- **Daily limit reached:** AI generation resets at midnight UTC. Direct photo conversion still works.

`.env`, `auth_session/`, `data/`, `logs/`, and `temp/` are ignored by Git. Treat `.env` and the authentication session as secrets. Generated images are saved under `logs/images/`; remove old logs when you no longer need them. Keep `data/usage.json` across restarts to preserve the daily counter.
