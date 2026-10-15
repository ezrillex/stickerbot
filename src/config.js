import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

function getEnv(key, defaultValue = undefined) {
  const value = process.env[key] || defaultValue;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}. Copy .env.example to .env and configure your AI credentials.`);
  }
  return value;
}

function positiveInteger(key, fallback) {
  const value = Number(process.env[key] || fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) {
    throw new Error(`${key} must be a positive integer (at most 2147483647).`);
  }
  return value;
}

const prefix = process.env.BOT_PREFIX || '!sticker';
if (/\s/.test(prefix)) throw new Error('BOT_PREFIX must be a single command without spaces.');

export const config = Object.freeze({
  cloudflare: {
    accountId: getEnv('CLOUDFLARE_ACCOUNT_ID'),
    gatewayId: getEnv('CLOUDFLARE_GATEWAY_ID', 'default'),
    gatewayToken: getEnv('CLOUDFLARE_GATEWAY_TOKEN'),
    apiToken: getEnv('CLOUDFLARE_API_TOKEN'),
    fluxModel: '@cf/black-forest-labs/flux-2-klein-4b',
    get geminiGatewayUrl() {
      return `https://gateway.ai.cloudflare.com/v1/${this.accountId}/${this.gatewayId}/google-ai-studio/v1beta/models/gemini-flash-lite-latest:generateContent`;
    },
    get fluxUrl() {
      return `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run/${this.fluxModel}`;
    }
  },
  gemini: {
    apiKey: getEnv('GEMINI_API_KEY')
  },
  bot: {
    dailyLimit: positiveInteger('DAILY_LIMIT', 50),
    aiTimeoutMs: positiveInteger('AI_TIMEOUT_MS', 60000),
    stickerPack: process.env.STICKER_PACK || 'Rolex AI',
    stickerAuthor: process.env.STICKER_AUTHOR || 'StickerBot',
    prefix,
    phoneNumber: process.env.BOT_PHONE_NUMBER || ''
  }
});
