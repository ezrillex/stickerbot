import test from 'node:test';
import assert from 'node:assert/strict';
import { limiter } from '../src/limiter.js';
import { setSocket } from '../src/whatsapp.js';
import { handleIncomingMessages } from '../src/index.js';
import { parseMessageIntent, getAcknowledgmentMessage } from '../src/messages.js';

globalThis.fetch = () => { throw new Error('Unexpected network request in offline tests'); };
test.afterEach(() => setSocket(null));

test('all mode selectors route text and bare photo transforms consistently', () => {
  for (const [mode, selectors] of [
    ['sticker', ['/sticker', '!sticker', 'sticker:', 'modo sticker']],
    ['meme', ['/meme', '!meme', 'meme:', 'modo meme']]
  ]) {
    for (const selector of selectors) {
      for (const isGroup of [false, true]) {
        const text = `${isGroup ? '@15550001111 ' : ''}${selector} gato astronauta`;
        const intent = parseMessageIntent(text, { isGroup });
        assert.equal(intent.mode, mode, text);
        assert.equal(intent.prompt, 'gato astronauta', text);
        assert.equal(intent.isBareCommand, false, text);
        assert.equal(intent.isExplicitMode, true, text);
        const bare = parseMessageIntent(selector, { hasImage: true });
        assert.equal(bare.mode, mode, selector);
        assert.equal(bare.prompt, '', selector);
        assert.equal(bare.isBareCommand, true, selector);
      }
    }
  }
});

test('DM ideas, photo instructions and direct conversion captions preserve their intent', () => {
  for (const text of ['gato programando', 'haz un sticker de un gato meme']) {
    const intent = parseMessageIntent(text);
    assert.equal(intent.mode, 'sticker');
    assert.equal(intent.prompt, text);
    assert.equal(intent.isExplicitMode, false);
  }
  for (const caption of ['', 'sticker', 'hazlo sticker', 'hacelo sticker', 'hazlo llorando']) {
    const intent = parseMessageIntent(caption, { hasImage: true });
    assert.equal(intent.mode, 'sticker');
    assert.equal(intent.prompt, caption);
    assert.equal(intent.isBareCommand, false);
  }
  assert.equal(parseMessageIntent('hola grupo', { isGroup: true }).isIgnored, true);
  assert.equal(parseMessageIntent('hazlo llorando', { isGroup: true, hasImage: true }).prompt, 'hazlo llorando');
});

test('partial command names are ordinary DM text and ignored group text', () => {
  for (const text of ['/memesomething', '/stickerman', '/memeology', '/stickers de gatos', '/meme-cat', 'modo memething']) {
    assert.equal(parseMessageIntent(text).isExplicitMode, false, text);
    assert.equal(parseMessageIntent(text).prompt, text, text);
    assert.equal(parseMessageIntent(text, { isGroup: true }).isIgnored, true, text);
  }
});

test('acknowledgments describe the selected style and photo transformation', () => {
  assert.match(getAcknowledgmentMessage('meme', { hasReferenceImage: true, prompt: 'hazlo enojado' }), /Transformando tu foto \(modo meme\)/);
  assert.match(getAcknowledgmentMessage('sticker', { hasReferenceImage: true }), /Transformando tu foto \(modo sticker\)/);
  assert.match(getAcknowledgmentMessage('meme', { prompt: 'gato astronauta' }), /Generando tu meme/);
  assert.match(getAcknowledgmentMessage('sticker'), /Generando tu sticker/);
});

function mockSocket() {
  const sent = [];
  setSocket({
    user: { id: '15550001111@s.whatsapp.net', lid: '12345@lid' },
    sendMessage: async (jid, content) => { sent.push({ jid, content }); }
  });
  return sent;
}

async function deliver(...messages) {
  await handleIncomingMessages({ messages, type: 'notify' });
}

test('malformed, outgoing, historical and unaddressed group messages are ignored', async () => {
  const sent = mockSocket();
  await deliver({}, { key: {} }, { key: { remoteJid: null } },
    { key: { remoteJid: 'user@s.whatsapp.net', fromMe: true }, message: { conversation: 'gato' } },
    { key: { remoteJid: 'group@g.us' }, message: { conversation: '/meme gato' } });
  await handleIncomingMessages({ type: 'append', messages: [{ key: { remoteJid: 'user@s.whatsapp.net' }, message: { conversation: 'gato' } }] });
  assert.equal(sent.length, 0);
});

test('DM utility commands and short prompts reply without consuming quota', async () => {
  const sent = mockSocket();
  const before = limiter.getStatus().used;
  for (const text of ['!help', '/help', '!status', '/status', 'x', '/meme']) {
    await deliver({ key: { remoteJid: 'user@s.whatsapp.net' }, message: { conversation: text } });
  }
  assert.equal(sent.length, 6);
  assert.match(sent[0].content.text, /Rolex AI StickerBot/);
  assert.match(sent[2].content.text, /Rolex AI Status/);
  assert.match(sent[4].content.text, /Por favor escribe una descripción/);
  assert.equal(limiter.getStatus().used, before);
});

test('group utility commands require mentioning or replying to the bot', async () => {
  const sent = mockSocket();
  await deliver({ key: { remoteJid: 'group@g.us' }, message: { extendedTextMessage: {
    text: '@15550001111 !help', contextInfo: { mentionedJid: ['15550001111@s.whatsapp.net'] }
  } } });
  await deliver({ key: { remoteJid: 'group@g.us' }, message: { extendedTextMessage: {
    text: '/status', contextInfo: { participant: '12345@lid', quotedMessage: { conversation: 'bot reply' } }
  } } });
  assert.equal(sent.length, 2);
  assert.match(sent[0].content.text, /@bot \/sticker/);
  assert.match(sent[1].content.text, /Rolex AI Status/);
});

test('failed photo edits refund quota and direct photo failures leave it untouched', async () => {
  const sent = mockSocket();
  const before = limiter.getStatus().used;
  for (const caption of ['hazlo llorando', '']) {
    await deliver({ key: { remoteJid: 'user@s.whatsapp.net' }, message: {
      imageMessage: { caption, mimetype: 'image/jpeg' }
    } });
    assert.equal(limiter.getStatus().used, before);
  }
  assert.equal(sent.length, 2);
  assert.ok(sent.every(reply => reply.jid === 'user@s.whatsapp.net'));
  assert.ok(sent.every(reply => reply.content.text.includes('Error generando sticker')));
});
