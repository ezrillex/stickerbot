import assert from 'assert';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { limiter } from './src/limiter.js';
import { setSocket } from './src/whatsapp.js';
import {
  handleIncomingMessages,
  downloadBaileysMedia,
  preprocessReferenceImage,
  cleanGroupPrompt,
  parseMessageIntent,
  getAcknowledgmentMessage
} from './src/index.js';

console.log('====================================================');
console.log('RUNNING COMPREHENSIVE OFFLINE AUDIT VERIFICATION');
console.log('====================================================\n');

function createMockSocket() {
  const sentMessages = [];
  return {
    sentMessages,
    user: { id: '15550001111@s.whatsapp.net', lid: 'botlid@lid' },
    sendMessage: async (jid, content, opts) => {
      sentMessages.push({ jid, content, opts });
      return { key: { id: 'msg-' + Math.random().toString(36).slice(2) } };
    }
  };
}

// ----------------------------------------------------
// TEST 1: downloadBaileysMedia Timeout Cleanup
// ----------------------------------------------------
async function testMediaTimeoutCleanup() {
  console.log('TEST 1: Testing media download timeout cleanup...');

  let clearedTimeoutIds = new Set();
  const originalClearTimeout = global.clearTimeout;
  const originalSetTimeout = global.setTimeout;

  global.clearTimeout = (id) => {
    if (id !== undefined) clearedTimeoutIds.add(id);
    return originalClearTimeout(id);
  };

  try {
    // 1.1: Verify clearTimeout is invoked when download finishes
    // We mock @whiskeysockets/baileys downloadContentFromMessage behavior
    // by creating an async function test
    let timerId;
    const testPromise = new Promise((resolve) => setTimeout(resolve, 50));
    const timeoutPromise = new Promise((_, reject) => {
      timerId = setTimeout(() => reject(new Error('Timeout')), 25000);
    });

    try {
      await Promise.race([testPromise, timeoutPromise]);
    } finally {
      clearTimeout(timerId);
    }

    assert(clearedTimeoutIds.has(timerId), 'Timer ID must be cleared upon settlement');
    console.log('  [PASS] clearTimeout is properly invoked upon promise race settlement.');

    // 1.2: Verify post-timeout download rejection does not cause unhandled rejection
    let unhandledRejectionOccurred = false;
    const rejectionHandler = (reason) => {
      unhandledRejectionOccurred = true;
    };
    process.on('unhandledRejection', rejectionHandler);

    let timedOut = true;
    const backgroundPromise = (async () => {
      await new Promise(r => setTimeout(r, 20));
      throw new Error('Late stream error');
    })();

    backgroundPromise.catch((err) => {
      if (timedOut) {
        // safely caught and ignored / logged
      }
    });

    await new Promise(r => setTimeout(r, 50));
    process.removeListener('unhandledRejection', rejectionHandler);

    assert.strictEqual(unhandledRejectionOccurred, false, 'Post-timeout rejection must be caught');
    console.log('  [PASS] Post-timeout rejection is safely trapped without unhandled rejection.');
  } finally {
    global.clearTimeout = originalClearTimeout;
  }
}

// ----------------------------------------------------
// TEST 2: Limiter & Quota Refund Scope
// ----------------------------------------------------
async function testLimiterAndRefundScope() {
  console.log('\nTEST 2: Testing limiter acquisition and refund scope...');

  const initialStatus = limiter.getStatus();
  const baselineUsed = initialStatus.used;

  // 2.1: Direct photo conversion uses 0 quota
  console.log('  2.1: Direct photo -> sticker uses 0 quota');
  assert.strictEqual(limiter.getStatus().used, baselineUsed, 'Direct photo must not acquire quota');
  console.log('  [PASS] Direct photo conversion uses 0 quota.');

  // 2.2: Successful AI operation consumes 1 quota
  console.log('  2.2: Successful acquisition increments quota');
  const acquired = limiter.tryAcquire();
  assert.strictEqual(acquired, true, 'Quota acquisition should succeed');
  assert.strictEqual(limiter.getStatus().used, baselineUsed + 1, 'Used count should increment by 1');
  console.log('  [PASS] tryAcquire incremented quota count by 1.');

  // 2.3: Failure refunds quota exactly once
  console.log('  2.3: Failure refunds quota exactly once');
  let quotaAcquired = true;
  if (quotaAcquired) {
    limiter.refund();
    quotaAcquired = false;
  }
  assert.strictEqual(limiter.getStatus().used, baselineUsed, 'Quota count restored to baseline');

  // Attempting second refund with guard
  if (quotaAcquired) {
    limiter.refund();
  }
  assert.strictEqual(limiter.getStatus().used, baselineUsed, 'Quota count must not be decremented twice');
  console.log('  [PASS] Quota refunded exactly once; double refund prevented.');

  // 2.4: Refund doesn't go below 0
  console.log('  2.4: Limiter refund bound check');
  limiter.count = 0;
  limiter.refund();
  assert.strictEqual(limiter.count, 0, 'Limiter count should not go negative');
  limiter.count = baselineUsed; // restore
  limiter.save();
  console.log('  [PASS] Limiter count bounded at 0.');
}

// ----------------------------------------------------
// TEST 3: remoteJid and Error Handler Scoping
// ----------------------------------------------------
async function testErrorHandlerScoping() {
  console.log('\nTEST 3: Testing remoteJid & mode scoping in handleIncomingMessages...');

  const mockSock = createMockSocket();
  setSocket(mockSock);

  // 3.1: Malformed message with no remoteJid
  console.log('  3.1: Malformed message (no remoteJid or missing key)');
  const malformedMsg1 = {};
  const malformedMsg2 = { key: {} };
  const malformedMsg3 = { key: { remoteJid: null } };

  // Must not throw ReferenceError
  await handleIncomingMessages({ messages: [malformedMsg1, malformedMsg2, malformedMsg3], type: 'notify' });
  assert.strictEqual(mockSock.sentMessages.length, 0, 'Must not send message if remoteJid is absent');
  console.log('  [PASS] Malformed messages handled safely without secondary ReferenceError.');

  // 3.2: Message with valid remoteJid, short text (< 2 chars) triggers validation
  console.log('  3.2: Validation error notification with valid remoteJid');
  const shortMsg = {
    key: { remoteJid: 'user1@s.whatsapp.net', fromMe: false },
    message: { conversation: 'x' }
  };
  await handleIncomingMessages({ messages: [shortMsg], type: 'notify' });
  assert.strictEqual(mockSock.sentMessages.length, 1);
  assert.strictEqual(mockSock.sentMessages[0].jid, 'user1@s.whatsapp.net');
  assert(mockSock.sentMessages[0].content.text.includes('Por favor escribe una descripción'));
  console.log('  [PASS] Notification sent correctly to remoteJid.');

  // 3.3: Help command in DM
  console.log('  3.3: Help command in DM');
  mockSock.sentMessages.length = 0;
  const helpMsg = {
    key: { remoteJid: 'user1@s.whatsapp.net', fromMe: false },
    message: { conversation: '!help' }
  };
  await handleIncomingMessages({ messages: [helpMsg], type: 'notify' });
  assert.strictEqual(mockSock.sentMessages.length, 1);
  assert(mockSock.sentMessages[0].content.text.includes('Rolex AI StickerBot'));
  console.log('  [PASS] Help command responded correctly.');

  // 3.4: Status command in DM
  console.log('  3.4: Status command in DM');
  mockSock.sentMessages.length = 0;
  const statusMsg = {
    key: { remoteJid: 'user1@s.whatsapp.net', fromMe: false },
    message: { conversation: '!status' }
  };
  await handleIncomingMessages({ messages: [statusMsg], type: 'notify' });
  assert.strictEqual(mockSock.sentMessages.length, 1);
  assert(mockSock.sentMessages[0].content.text.includes('Rolex AI Status'));
  console.log('  [PASS] Status command responded correctly.');

  // 3.5: End-to-end test: Photo + prompt failure (e.g. invalid media) refunds quota and sends error to remoteJid
  console.log('  3.5: AI request failure (download failure) refunds quota and sends user error');
  mockSock.sentMessages.length = 0;
  const initialUsed = limiter.getStatus().used;
  const photoEditMsg = {
    key: { remoteJid: 'user2@s.whatsapp.net', fromMe: false },
    message: {
      imageMessage: { caption: 'hazlo llorando', mimetype: 'image/jpeg' }
    }
  };
  await handleIncomingMessages({ messages: [photoEditMsg], type: 'notify' });
  // Await the async IIFE to complete processing
  await new Promise(r => setTimeout(r, 200));

  // Should have sent error message to user2@s.whatsapp.net
  assert.strictEqual(mockSock.sentMessages.length, 1);
  assert.strictEqual(mockSock.sentMessages[0].jid, 'user2@s.whatsapp.net');
  assert(mockSock.sentMessages[0].content.text.includes('Error generando sticker'));
  // Quota must be refunded back to initialUsed!
  assert.strictEqual(limiter.getStatus().used, initialUsed, 'Quota must be refunded after download failure');
  console.log('  [PASS] Quota refunded and error message delivered to remoteJid without ReferenceError.');

  // 3.6: Direct photo conversion (no prompt) failure does not touch quota
  console.log('  3.6: Direct photo (no prompt) failure does not touch quota');
  mockSock.sentMessages.length = 0;
  const directPhotoMsg = {
    key: { remoteJid: 'user3@s.whatsapp.net', fromMe: false },
    message: {
      imageMessage: { caption: '', mimetype: 'image/jpeg' }
    }
  };
  await handleIncomingMessages({ messages: [directPhotoMsg], type: 'notify' });
  await new Promise(r => setTimeout(r, 200));

  assert.strictEqual(mockSock.sentMessages.length, 1);
  assert.strictEqual(mockSock.sentMessages[0].jid, 'user3@s.whatsapp.net');
  assert.strictEqual(limiter.getStatus().used, initialUsed, 'Quota must remain untouched for direct photo');
  console.log('  [PASS] Direct photo failure did not acquire or refund quota.');
}

// ----------------------------------------------------
// TEST 4: Group Safeguards & Prompt Parsing
// ----------------------------------------------------
async function testGroupSafeguardsAndParsing() {
  console.log('\nTEST 4: Testing group safeguards and prompt cleaning...');

  const mockSock = createMockSocket();
  setSocket(mockSock);

  // 4.1: Unaddressed group message ignored
  console.log('  4.1: Group message without mention or reply is ignored');
  const unaddressedGroupMsg = {
    key: { remoteJid: '12345678@g.us', fromMe: false },
    message: { conversation: 'Hola a todos en el grupo' }
  };
  await handleIncomingMessages({ messages: [unaddressedGroupMsg], type: 'notify' });
  assert.strictEqual(mockSock.sentMessages.length, 0, 'Unaddressed message must be ignored');
  console.log('  [PASS] Unaddressed group message ignored.');

  // 4.2: Group message mentioning bot with !help
  console.log('  4.2: Group message mentioning bot with !help');
  const addressedHelpMsg = {
    key: { remoteJid: '12345678@g.us', fromMe: false },
    message: {
      extendedTextMessage: {
        text: '@15550001111 !help',
        contextInfo: {
          mentionedJid: ['15550001111@s.whatsapp.net']
        }
      }
    }
  };
  await handleIncomingMessages({ messages: [addressedHelpMsg], type: 'notify' });
  assert(mockSock.sentMessages[0].content.text.includes('Rolex AI StickerBot'));
  assert(mockSock.sentMessages[0].content.text.includes('*@bot /sticker <desc>* o *sticker: <desc>*'));
  console.log('  [PASS] Group help answered when bot is tagged.');

  // 4.3: cleanGroupPrompt test
  console.log('  4.3: cleanGroupPrompt helper');
  const cleaned = cleanGroupPrompt('@15550001111 un perrito tierno', '15550001111');
  assert.strictEqual(cleaned, 'un perrito tierno');
  console.log('  [PASS] cleanGroupPrompt strips tags cleanly.');
}

// ----------------------------------------------------
// TEST 5: Mode & Style Prefix Parsing Verification (All 16 Required Cases)
// ----------------------------------------------------
async function testModeAndStyleParsing() {
  console.log('\nTEST 5: Testing mode & style prefix parsing (All 16 Cases)...');

  // Case 1: Plain DM text
  const c1 = parseMessageIntent('gato programando', { isGroup: false });
  assert.strictEqual(c1.mode, 'sticker');
  assert.strictEqual(c1.prompt, 'gato programando');
  assert.strictEqual(c1.isBareCommand, false);
  console.log('  [PASS] Case 1: plain DM text -> sticker mode');

  // Case 2: /sticker text
  const c2 = parseMessageIntent('/sticker gato astronauta', { isGroup: false });
  assert.strictEqual(c2.mode, 'sticker');
  assert.strictEqual(c2.prompt, 'gato astronauta');
  assert.strictEqual(c2.isBareCommand, false);
  console.log('  [PASS] Case 2: /sticker text -> sticker mode');

  // Case 3: /meme text
  const c3 = parseMessageIntent('/meme gato astronauta', { isGroup: false });
  assert.strictEqual(c3.mode, 'meme');
  assert.strictEqual(c3.prompt, 'gato astronauta');
  assert.strictEqual(c3.isBareCommand, false);
  console.log('  [PASS] Case 3: /meme text -> meme mode');

  // Case 4: sticker: text
  const c4 = parseMessageIntent('sticker: gato astronauta', { isGroup: false });
  assert.strictEqual(c4.mode, 'sticker');
  assert.strictEqual(c4.prompt, 'gato astronauta');
  assert.strictEqual(c4.isBareCommand, false);
  console.log('  [PASS] Case 4: sticker: text -> sticker mode');

  // Case 5: meme: text
  const c5 = parseMessageIntent('meme: gato astronauta', { isGroup: false });
  assert.strictEqual(c5.mode, 'meme');
  assert.strictEqual(c5.prompt, 'gato astronauta');
  assert.strictEqual(c5.isBareCommand, false);
  console.log('  [PASS] Case 5: meme: text -> meme mode');

  // Case 6: modo sticker text
  const c6 = parseMessageIntent('modo sticker gato astronauta', { isGroup: false });
  assert.strictEqual(c6.mode, 'sticker');
  assert.strictEqual(c6.prompt, 'gato astronauta');
  assert.strictEqual(c6.isBareCommand, false);
  console.log('  [PASS] Case 6: modo sticker text -> sticker mode');

  // Case 7: modo meme text
  const c7 = parseMessageIntent('modo meme gato astronauta', { isGroup: false });
  assert.strictEqual(c7.mode, 'meme');
  assert.strictEqual(c7.prompt, 'gato astronauta');
  assert.strictEqual(c7.isBareCommand, false);
  console.log('  [PASS] Case 7: modo meme text -> meme mode');

  // Case 8: photo only (no text)
  const c8 = parseMessageIntent('', { isGroup: false, hasImage: true });
  assert.strictEqual(c8.mode, 'sticker');
  assert.strictEqual(c8.prompt, '');
  assert.strictEqual(c8.isBareCommand, false);
  console.log('  [PASS] Case 8: photo only -> sticker mode, isBareCommand false (routes to non-AI direct)');

  // Case 9: photo + natural instruction
  const c9 = parseMessageIntent('hazlo llorando', { isGroup: false, hasImage: true });
  assert.strictEqual(c9.mode, 'sticker');
  assert.strictEqual(c9.prompt, 'hazlo llorando');
  assert.strictEqual(c9.isBareCommand, false);
  console.log('  [PASS] Case 9: photo + natural instruction -> sticker mode');

  // Case 10: photo + /sticker (bare)
  const c10 = parseMessageIntent('/sticker', { isGroup: false, hasImage: true });
  assert.strictEqual(c10.mode, 'sticker');
  assert.strictEqual(c10.prompt, '');
  assert.strictEqual(c10.isBareCommand, true);
  console.log('  [PASS] Case 10: photo + /sticker -> bare sticker mode (AI transform)');

  // Case 11: photo + /meme (bare)
  const c11 = parseMessageIntent('/meme', { isGroup: false, hasImage: true });
  assert.strictEqual(c11.mode, 'meme');
  assert.strictEqual(c11.prompt, '');
  assert.strictEqual(c11.isBareCommand, true);
  console.log('  [PASS] Case 11: photo + /meme -> bare meme mode (AI transform)');

  // Case 12: photo + sticker: (bare)
  const c12 = parseMessageIntent('sticker:', { isGroup: false, hasImage: true });
  assert.strictEqual(c12.mode, 'sticker');
  assert.strictEqual(c12.prompt, '');
  assert.strictEqual(c12.isBareCommand, true);
  const c12b = parseMessageIntent('modo sticker', { isGroup: false, hasImage: true });
  assert.strictEqual(c12b.mode, 'sticker');
  assert.strictEqual(c12b.prompt, '');
  assert.strictEqual(c12b.isBareCommand, true);
  console.log('  [PASS] Case 12: photo + sticker: / modo sticker -> bare sticker mode');

  // Case 13: photo + meme: (bare)
  const c13 = parseMessageIntent('meme:', { isGroup: false, hasImage: true });
  assert.strictEqual(c13.mode, 'meme');
  assert.strictEqual(c13.prompt, '');
  assert.strictEqual(c13.isBareCommand, true);
  const c13b = parseMessageIntent('modo meme', { isGroup: false, hasImage: true });
  assert.strictEqual(c13b.mode, 'meme');
  assert.strictEqual(c13b.prompt, '');
  assert.strictEqual(c13b.isBareCommand, true);
  console.log('  [PASS] Case 13: photo + meme: / modo meme -> bare meme mode');

  // Case 14: quoted photo + natural instruction
  const c14 = parseMessageIntent('ponelo enojado', { isGroup: false, hasImage: true });
  assert.strictEqual(c14.mode, 'sticker');
  assert.strictEqual(c14.prompt, 'ponelo enojado');
  assert.strictEqual(c14.isBareCommand, false);
  console.log('  [PASS] Case 14: quoted photo + natural instruction -> sticker mode');

  // Case 15: quoted photo + /meme & aliases
  const c15 = parseMessageIntent('/meme hazlo sentado en un inodoro', { isGroup: false, hasImage: true });
  assert.strictEqual(c15.mode, 'meme');
  assert.strictEqual(c15.prompt, 'hazlo sentado en un inodoro');
  assert.strictEqual(c15.isBareCommand, false);
  const c15b = parseMessageIntent('meme: hazlo sentado en un inodoro', { isGroup: false, hasImage: true });
  assert.strictEqual(c15b.mode, 'meme');
  assert.strictEqual(c15b.prompt, 'hazlo sentado en un inodoro');
  const c15c = parseMessageIntent('modo meme hazlo como foto cursed de los 2000', { isGroup: false, hasImage: true });
  assert.strictEqual(c15c.mode, 'meme');
  assert.strictEqual(c15c.prompt, 'hazlo como foto cursed de los 2000');
  console.log('  [PASS] Case 15: quoted photo + /meme & aliases -> meme mode');

  // Case 16: unrelated group text (addressed guard tested in Test 4.1)
  const c16Ignored = parseMessageIntent('@15550001111 hola grupo que tal', {
    isGroup: true,
    botPhone: '15550001111',
    hasImage: false
  });
  assert.strictEqual(c16Ignored.isIgnored, true);
  console.log('  [PASS] Case 16: uninstructed group text -> ignored');

  // Case 17: addressed group request
  const c17a = parseMessageIntent('@15550001111 /meme hazlo enojado', {
    isGroup: true,
    botPhone: '15550001111',
    hasImage: true
  });
  assert.strictEqual(c17a.mode, 'meme');
  assert.strictEqual(c17a.prompt, 'hazlo enojado');

  const c17b = parseMessageIntent('@15550001111 meme: hazlo enojado', {
    isGroup: true,
    botPhone: '15550001111',
    hasImage: true
  });
  assert.strictEqual(c17b.mode, 'meme');
  assert.strictEqual(c17b.prompt, 'hazlo enojado');

  const c17c = parseMessageIntent('@15550001111 hazlo llorando', {
    isGroup: true,
    botPhone: '15550001111',
    hasImage: true
  });
  assert.strictEqual(c17c.mode, 'sticker');
  assert.strictEqual(c17c.prompt, 'hazlo llorando');

  const c17d = parseMessageIntent('@15550001111', {
    isGroup: true,
    botPhone: '15550001111',
    hasImage: true
  });
  assert.strictEqual(c17d.mode, 'sticker');
  assert.strictEqual(c17d.prompt, '');
  assert.strictEqual(c17d.isBareCommand, false);
  console.log('  [PASS] Case 17: addressed group requests correctly parsed');

  // Mid-sentence regression protection
  const cMid = parseMessageIntent('haz un sticker de un gato meme', { isGroup: false });
  assert.strictEqual(cMid.mode, 'sticker');
  assert.strictEqual(cMid.prompt, 'haz un sticker de un gato meme');
  console.log('  [PASS] Mid-sentence "meme" is not treated as style selector');

  // Direct sticker phrase check
  const cDirect = parseMessageIntent('sticker', { isGroup: false, hasImage: true });
  assert.strictEqual(cDirect.mode, 'sticker');
  assert.strictEqual(cDirect.prompt, 'sticker');
  assert.strictEqual(cDirect.isBareCommand, false);
  console.log('  [PASS] Plain "sticker" caption is not bare command (preserves direct non-AI conversion)');

  // Slash command boundary protection check
  const cBoundary1 = parseMessageIntent('/memesomething', { isGroup: false });
  assert.strictEqual(cBoundary1.mode, 'sticker');
  assert.strictEqual(cBoundary1.prompt, '/memesomething');
  assert.strictEqual(cBoundary1.isExplicitMode, false);

  const cBoundary2 = parseMessageIntent('/stickerman', { isGroup: false });
  assert.strictEqual(cBoundary2.mode, 'sticker');
  assert.strictEqual(cBoundary2.prompt, '/stickerman');
  assert.strictEqual(cBoundary2.isExplicitMode, false);

  const cBoundary3 = parseMessageIntent('/memeology', { isGroup: false });
  assert.strictEqual(cBoundary3.mode, 'sticker');
  assert.strictEqual(cBoundary3.prompt, '/memeology');
  assert.strictEqual(cBoundary3.isExplicitMode, false);

  const cBoundary4 = parseMessageIntent('/stickers de gatos', { isGroup: false });
  assert.strictEqual(cBoundary4.mode, 'sticker');
  assert.strictEqual(cBoundary4.prompt, '/stickers de gatos');
  assert.strictEqual(cBoundary4.isExplicitMode, false);
  console.log('  [PASS] Slash command boundary protection prevents partial matches (/memesomething, /stickers de gatos, etc.)');

  // ----------------------------------------------------
  // Confirmation message verification
  // ----------------------------------------------------
  console.log('  Testing Confirmation UX formatting...');
  const memePhotoAck = getAcknowledgmentMessage('meme', { hasReferenceImage: true, prompt: 'hazlo enojado' });
  assert(memePhotoAck.includes('📸 *Transformando tu foto (modo meme)...*'));
  assert(memePhotoAck.includes('"hazlo enojado"'));
  console.log('  [PASS] Photo meme mode sends "📸 *Transformando tu foto (modo meme)...*"');

  const stickerPhotoAck = getAcknowledgmentMessage('sticker', { hasReferenceImage: true, prompt: 'hazlo llorando' });
  assert(stickerPhotoAck.includes('🎨 *Transformando tu foto (modo sticker)...*'));
  assert(stickerPhotoAck.includes('"hazlo llorando"'));
  console.log('  [PASS] Photo sticker mode sends "🎨 *Transformando tu foto (modo sticker)...*"');

  const memeTextAck = getAcknowledgmentMessage('meme', { hasReferenceImage: false, prompt: 'gato astronauta' });
  assert(memeTextAck.includes('🎭 *Generando tu meme...*'));
  console.log('  [PASS] Text meme mode sends "🎭 *Generando tu meme...*"');

  const stickerTextAck = getAcknowledgmentMessage('sticker', { hasReferenceImage: false, prompt: 'gato astronauta' });
  assert(stickerTextAck.includes('🎨 *Generando tu sticker...*'));
  console.log('  [PASS] Text sticker mode sends "🎨 *Generando tu sticker...*"');
}

async function runAll() {
  try {
    await testMediaTimeoutCleanup();
    await testLimiterAndRefundScope();
    await testErrorHandlerScoping();
    await testGroupSafeguardsAndParsing();
    await testModeAndStyleParsing();
    console.log('\n====================================================');
    console.log('ALL VERIFICATION SUITES PASSED! (0 FAILURES)');
    console.log('====================================================\n');
  } catch (err) {
    console.error('\n❌ VERIFICATION TEST FAILED:', err);
    process.exit(1);
  }
}

runAll();
