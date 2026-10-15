import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, PassThrough } from 'node:stream';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { request } from '../src/request.js';
import { downloadBaileysMedia, preprocessReferenceImage } from '../src/media.js';
import { parseMessageIntent, cleanGroupPrompt } from '../src/messages.js';
import { getUtilityMessage } from '../src/replies.js';
import { DailyLimiter, limiter } from '../src/limiter.js';
import { handleIncomingMessages, isAddressedToBot } from '../src/index.js';
import { setSocket } from '../src/whatsapp.js';
import { generateImage } from '../src/imageGen.js';
import { enhancePrompt, sanitizePrompt } from '../src/gemini.js';
import { createSticker } from '../src/sticker.js';

const originalFetch = globalThis.fetch;
// Any unexpected network request fails the offline suite immediately.
globalThis.fetch = () => { throw new Error('Unexpected network request in offline tests'); };
test.afterEach(() => {
  globalThis.fetch = () => { throw new Error('Unexpected network request in offline tests'); };
  setSocket(null);
});
test.after(() => { globalThis.fetch = originalFetch; });

test('custom sticker commands work in DMs, groups and bare photo transforms', () => {
  for (const isGroup of [true, false]) {
    const parsed = parseMessageIntent('$draw: gato', { isGroup, prefix: '$draw' });
    assert.equal(parsed.mode, 'sticker');
    assert.equal(parsed.prompt, 'gato');
    assert.equal(parsed.isExplicitMode, true);
  }
  assert.equal(parseMessageIntent('$draw', { prefix: '$draw', hasImage: true }).isBareCommand, true);
  assert.equal(parseMessageIntent('$drawing', { prefix: '$draw', isGroup: true }).isIgnored, true);
  assert.equal(parseMessageIntent('/meme gato', { prefix: '$draw' }).mode, 'meme');
  assert.match(getUtilityMessage('help', false, limiter.getStatus(), '$draw'), /\$draw <desc>/);
});

test('group addressing matches exact phone/LID identities and preserves prompt numbers', () => {
  const user = { id: '15550001111:1@s.whatsapp.net', lid: '12345:1@lid' };
  assert.equal(isAddressedToBot({ mentionedJid: ['15550001111@s.whatsapp.net'] }, '', user), true);
  assert.equal(isAddressedToBot({ participant: '12345@lid' }, '', user), true);
  assert.equal(isAddressedToBot({ mentionedJid: ['915550001111@s.whatsapp.net'] }, '', user), false);
  assert.equal(isAddressedToBot({}, 'call 15550001111', user, '15550001111'), false);
  assert.equal(isAddressedToBot({}, '@15550001111 /meme gato', user), true);
  assert.equal(cleanGroupPrompt('@15550001111 sticker: placa 15550001111 mail@site.com'), 'sticker: placa 15550001111 mail@site.com');
});

test('AI timeout aborts fetch and includes stalled response body reads', async () => {
  let signal;
  globalThis.fetch = (_url, options) => {
    signal = options.signal;
    return new Promise(() => {});
  };
  await assert.rejects(request('https://offline.invalid', {}, response => response.text(), 20), /timed out/);
  assert.equal(signal.aborted, true);
  globalThis.fetch = async (_url, options) => {
    signal = options.signal;
    return { text: () => new Promise(() => {}) };
  };
  await assert.rejects(request('https://offline.invalid', {}, response => response.text(), 20), /timed out/);
  assert.equal(signal.aborted, true);
});

test('completed AI requests clear their deadlines', async () => {
  let signal;
  globalThis.fetch = async (_url, options) => {
    signal = options.signal;
    return new Response('ok');
  };
  assert.equal(await request('https://offline.invalid', {}, response => response.text(), 20), 'ok');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(signal.aborted, false);
});

test('Gemini enhancement and sanitization share authentication and bounded requests', async () => {
  const payloads = [];
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers['x-goog-api-key'], 'offline-test');
    assert.equal(options.headers['cf-aig-authorization'], 'Bearer offline-test');
    assert.ok(options.signal);
    payloads.push(JSON.parse(options.body));
    return Response.json({ candidates: [{ content: { parts: [{ text: 'image ' }, { text: 'prompt' }] } }] });
  };
  assert.equal(await enhancePrompt('gato'), 'image prompt');
  assert.equal(await sanitizePrompt('gato'), 'image prompt');
  assert.equal(payloads.length, 2);
});

test('image generation handles binary/base64 and preserves provider error flags', async () => {
  globalThis.fetch = async (_url, options) => {
    assert.ok(options.signal);
    assert.equal(options.body.get('width'), '512');
    return Response.json({ success: true, result: { image: Buffer.from('image').toString('base64') } });
  };
  assert.equal((await generateImage('gato')).toString(), 'image');
  globalThis.fetch = async () => new Response(Buffer.from('binary'), { headers: { 'content-type': 'image/png' } });
  assert.equal((await generateImage('gato')).toString(), 'binary');
  for (const [code, flag] of [[3030, 'isSafetyBlocked'], [4006, 'isQuotaExhausted']]) {
    globalThis.fetch = async () => Response.json({ errors: [{ code, message: 'blocked' }] }, { status: 400 });
    await assert.rejects(generateImage('gato'), error => error[flag] === true);
  }
});

test('AI timeouts refund acquired quota and finish message handling', async () => {
  const sent = [];
  setSocket({ user: { id: '15550001111@s.whatsapp.net' }, sendMessage: async (_jid, content) => { sent.push(content); } });
  globalThis.fetch = () => new Promise(() => {});
  const before = limiter.getStatus().used;
  await handleIncomingMessages({ type: 'notify', messages: [{ key: { remoteJid: 'user@s.whatsapp.net' }, message: { conversation: 'gato astronauta' } }] });
  assert.equal(limiter.getStatus().used, before);
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /timed out/);
});

test('media download joins chunks and rejects empty/oversized images', async () => {
  const download = async () => Readable.from([Buffer.from('ab'), Buffer.from('cd')]);
  assert.equal((await downloadBaileysMedia({}, 'image', { download })).toString(), 'abcd');
  await assert.rejects(downloadBaileysMedia({}, 'image', { download, maxBytes: 3 }), /tamaño máximo/);
  await assert.rejects(downloadBaileysMedia({}, 'image', { download: async () => Readable.from([]) }), /vacía/);
});

test('media timeout destroys stalled streams, including streams acquired late', async () => {
  const stalled = new PassThrough();
  await assert.rejects(downloadBaileysMedia({}, 'image', { download: async () => stalled, timeoutMs: 20 }), /Tiempo de espera/);
  assert.equal(stalled.destroyed, true);
  const late = new PassThrough();
  let release;
  const download = () => new Promise(resolve => { release = resolve; });
  await assert.rejects(downloadBaileysMedia({}, 'image', { download, timeoutMs: 20 }), /Tiempo de espera/);
  release(late);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(late.destroyed, true);
});

test('photo preprocessing and WebP metadata work with real image buffers', async () => {
  const image = await sharp({ create: { width: 800, height: 400, channels: 3, background: 'red' } }).png().toBuffer();
  const reference = await preprocessReferenceImage(image);
  const metadata = await sharp(reference).metadata();
  assert.equal(metadata.width, 512);
  assert.equal(metadata.height, 256);
  for (const removeBg of [false, true]) {
    const sticker = await createSticker(image, { removeBg });
    const info = await sharp(sticker).metadata();
    assert.equal(info.format, 'webp');
    assert.equal(info.width, 512);
    assert.equal(info.height, 512);
    assert.ok(sticker.includes(Buffer.from('Rolex AI')));
  }
});

test('limiter persists usage, enforces limits and avoids refunds crossing midnight', () => {
  const dir = mkdtempSync(path.join(process.env.BOT_DATA_DIR, 'limiter-'));
  const usageFile = path.join(dir, 'usage.json');
  let date = '2026-10-14';
  try {
    const options = { limit: 1, usageFile, today: () => date };
    const tracker = new DailyLimiter(options);
    assert.equal(tracker.tryAcquire(), true);
    assert.equal(tracker.tryAcquire(), false);
    assert.equal(new DailyLimiter(options).getStatus().used, 1);
    date = '2026-10-15';
    assert.equal(tracker.tryAcquire(), true);
    tracker.refund('2026-10-14');
    assert.equal(tracker.getStatus().used, 1);
    tracker.refund('2026-10-15');
    assert.equal(tracker.getStatus().used, 0);
    assert.equal(JSON.parse(readFileSync(usageFile)).count, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('invalid quota and timeout values fail configuration with actionable errors', () => {
  const configUrl = new URL('../src/config.js', import.meta.url).href;
  for (const key of ['DAILY_LIMIT', 'AI_TIMEOUT_MS']) {
    for (const value of ['wat', '-1', '1.5', '0']) {
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(configUrl)})`], {
        env: { ...process.env, [key]: value }, encoding: 'utf8'
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, new RegExp(`${key} must be a positive integer`));
    }
  }
});
