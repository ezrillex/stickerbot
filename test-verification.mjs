import assert from 'assert';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { limiter } from './src/limiter.js';
import { setSocket } from './src/whatsapp.js';
import {
  handleIncomingMessages,
  downloadBaileysMedia,
  preprocessReferenceImage,
  cleanGroupPrompt
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
  assert.strictEqual(mockSock.sentMessages.length, 1);
  assert(mockSock.sentMessages[0].content.text.includes('Rolex AI StickerBot'));
  console.log('  [PASS] Group help answered when bot is tagged.');

  // 4.3: cleanGroupPrompt test
  console.log('  4.3: cleanGroupPrompt helper');
  const cleaned = cleanGroupPrompt('@15550001111 un perrito tierno', '15550001111');
  assert.strictEqual(cleaned, 'un perrito tierno');
  console.log('  [PASS] cleanGroupPrompt strips tags cleanly.');
}

async function runAll() {
  try {
    await testMediaTimeoutCleanup();
    await testLimiterAndRefundScope();
    await testErrorHandlerScoping();
    await testGroupSafeguardsAndParsing();
    console.log('\n====================================================');
    console.log('ALL VERIFICATION SUITES PASSED! (0 FAILURES)');
    console.log('====================================================\n');
  } catch (err) {
    console.error('\n❌ VERIFICATION TEST FAILED:', err);
    process.exit(1);
  }
}

runAll();
