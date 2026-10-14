import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionHandlers} from './src/whatsapp-session.js';
function setup(options = {}) {
  const calls = [], state = {creds: {registered: false}};
  const handlers = createSessionHandlers({state,
    sock: {requestPairingCode: async () => {calls.push('request'); return 'TEST1234';}},
    saveCreds: async () => calls.push('save'), phone: '15550001111', isCurrent: () => true,
    onCode: () => calls.push('code'), onQr: () => calls.push('qr'),
    onOpen: () => calls.push('open'), onClose: value => calls.push(value),
    onError: error => {throw error;}, ...options});
  return {calls, state, handlers};
}
test('waits for QR readiness and requests only one code on repeated events', async () => {
  const {calls, handlers} = setup();
  await handlers.update({connection: 'connecting'});
  assert.deepEqual(calls, []);
  await handlers.update({qr: 'ready'});
  await handlers.update({qr: 'ready-again'});
  assert.deepEqual(calls, ['request', 'code']);
});
test('flushes credentials before handling the 515 pairing restart', async () => {
  let finish;
  const {calls, state, handlers} = setup({saveCreds: () => new Promise(resolve => {finish = resolve;})});
  state.creds.registered = true;
  handlers.credentials();
  await Promise.resolve();
  const closing = handlers.update({connection: 'close', lastDisconnect: {error: {output: {statusCode: 515}}}});
  assert.deepEqual(calls, []);
  finish(); await closing;
  assert.deepEqual(calls, [{statusCode: 515, registered: true}]);
});
test('late pairing response cannot publish a code from a closed socket', async () => {
  let resolveCode;
  const {calls, handlers} = setup({sock: {requestPairingCode: () => new Promise(resolve => {resolveCode = resolve;})}});
  const pairing = handlers.update({qr: 'ready'});
  await handlers.update({connection: 'close', lastDisconnect: {error: {output: {statusCode: 401}}}});
  resolveCode('TEST1234'); await pairing;
  assert.deepEqual(calls, [{statusCode: 401, registered: false}]);
});
test('events from replaced sockets cannot generate codes or save credentials', async () => {
  const {calls, handlers} = setup({isCurrent: () => false});
  handlers.credentials(); await handlers.update({qr: 'ready'});
  assert.deepEqual(calls, []);
});
