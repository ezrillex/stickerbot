// Keep pairing tied to the socket lifecycle, not a wall-clock delay.
export function createSessionHandlers({sock, state, saveCreds, phone, isCurrent,
  onCode, onQr, onOpen, onClose, onError}) {
  let closed = false, pairingRequested = false, writes = Promise.resolve();
  function credentials() {
    if (closed || !isCurrent()) return;
    writes = writes.then(() => saveCreds()).catch(onError);
  }
  async function update({connection, qr, lastDisconnect}) {
    if (closed || !isCurrent()) return;
    if (connection === 'close') {
      closed = true;
      await writes;
      if (isCurrent()) await onClose({
        statusCode: lastDisconnect?.error?.output?.statusCode,
        registered: Boolean(state.creds.registered)
      });
      return;
    }
    if (qr && !state.creds.registered) {
      if (phone && !pairingRequested) {
        pairingRequested = true;
        try {
          const code = await sock.requestPairingCode(phone);
          if (!closed && isCurrent()) await onCode(code);
        } catch (error) { if (!closed && isCurrent()) onError(error); }
      } else if (!phone) onQr(qr);
    }
    if (connection === 'open') await onOpen();
  }
  return {credentials, update};
}
