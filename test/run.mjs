import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = mkdtempSync(path.join(tmpdir(), 'stickerbot-test-'));
const env = {
  ...process.env,
  NODE_ENV: 'test',
  CLOUDFLARE_ACCOUNT_ID: 'offline-test',
  CLOUDFLARE_GATEWAY_ID: 'offline-test',
  CLOUDFLARE_GATEWAY_TOKEN: 'offline-test',
  CLOUDFLARE_API_TOKEN: 'offline-test',
  GEMINI_API_KEY: 'offline-test',
  DAILY_LIMIT: '50',
  AI_TIMEOUT_MS: '50',
  BOT_PREFIX: '!sticker',
  BOT_PHONE_NUMBER: '',
  STICKER_PACK: 'Rolex AI',
  STICKER_AUTHOR: 'StickerBot',
  BOT_DATA_DIR: dataDir
};

try {
  const files = readdirSync(testDir).filter(name => name.endsWith('.test.mjs')).map(name => path.join(testDir, name));
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { env, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status || (result.signal ? 1 : 0);
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
