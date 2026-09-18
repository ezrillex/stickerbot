import dotenv from 'dotenv';
dotenv.config();

function getEnv(key, defaultValue = undefined) {
  const value = process.env[key] || defaultValue;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

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
    dailyLimit: parseInt(process.env.DAILY_LIMIT || '50', 10),
    stickerPack: process.env.STICKER_PACK || 'Rolex AI',
    stickerAuthor: process.env.STICKER_AUTHOR || 'StickerBot',
    prefix: process.env.BOT_PREFIX || '!sticker',
    phoneNumber: process.env.BOT_PHONE_NUMBER || ''
  }
});
