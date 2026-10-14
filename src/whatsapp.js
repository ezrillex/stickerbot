import makeWASocket, {useMultiFileAuthState, DisconnectReason, Browsers} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {config} from './config.js';
import {createSessionHandlers} from './whatsapp-session.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUTH_DIR = path.join(root, 'auth_session');
const PAIRING_FILE = path.join(root, 'pairing.txt');
let sockInstance = null, generation = 0, reconnectTimer, attempt = 0;
export function getSocket() { return sockInstance; }
export function setSocket(sock) { sockInstance = sock; }
function promptQuestion(query) {
  const rl = readline.createInterface({input: process.stdin, output: process.stdout});
  return new Promise(resolve => rl.question(query, answer => {rl.close(); resolve(answer.trim());}));
}
function removeCode() { try {fs.unlinkSync(PAIRING_FILE);} catch (error) {if(error.code !== 'ENOENT') throw error;} }
function retireAuth() {
  if (fs.existsSync(AUTH_DIR)) fs.renameSync(AUTH_DIR, path.join(root, 'auth-retired-' + Date.now()));
  fs.mkdirSync(AUTH_DIR, {recursive: true, mode: 0o700});
}

export async function connectToWhatsApp(onMessageCallback) {
  const current = ++generation;
  clearTimeout(reconnectTimer);
  sockInstance?.end?.(undefined);
  removeCode();
  fs.mkdirSync(AUTH_DIR, {recursive: true, mode: 0o700});
  const {state, saveCreds} = await useMultiFileAuthState(AUTH_DIR);
  let phone = (config.bot.phoneNumber || '').replace(/[^0-9]/g, '');
  if (!state.creds.registered && !phone) {
    if (!process.stdin.isTTY) throw Error('Set BOT_PHONE_NUMBER in the private .env before starting under PM2.');
    phone = (await promptQuestion('WhatsApp number with country code (digits), or ENTER for QR: ')).replace(/[^0-9]/g, '');
  }
  if (phone && !/^\d{10,15}$/.test(phone)) throw Error('BOT_PHONE_NUMBER must include country code, digits only.');
  if (current !== generation) return;
  const sock = makeWASocket({
    auth: state, logger: pino({level: 'silent'}), browser: Browsers.ubuntu('Chrome'),
    connectTimeoutMs: 60000, defaultQueryTimeoutMs: 60000, keepAliveIntervalMs: 30000
  });
  sockInstance = sock;
  const handlers = createSessionHandlers({
    sock, state, saveCreds, phone, isCurrent: () => current === generation,
    onCode: code => {
      fs.writeFileSync(PAIRING_FILE, code.match(/.{1,4}/g).join('-') + '\n', {mode: 0o600});
      console.log('[WhatsApp] Pairing code ready in private pairing.txt. Enter it now in Linked devices.');
    },
    onQr: qr => qrcode.generate(qr, {small: true}),
    onOpen: () => {attempt = 0; removeCode(); console.log('[WhatsApp] Connection opened successfully. Bot is online.');},
    onError: () => console.error('[WhatsApp] Pairing or credential operation failed; restart this bot to try again.'),
    onClose: ({statusCode, registered}) => {
      removeCode();
      console.log(`[WhatsApp] Connection closed (status: ${statusCode}, registered: ${registered}).`);
      if (statusCode === DisconnectReason.loggedOut) {
        retireAuth();
        console.log('[WhatsApp] Session rejected/logged out. Archived it; restart this bot for a fresh code.');
        return;
      }
      reconnectTimer = setTimeout(() => {
        if (current !== generation) return;
        connectToWhatsApp(onMessageCallback).catch(() => console.error('[WhatsApp] Reconnection failed.'));
      }, Math.min(30000, 1000 * 2 ** attempt++));
    }
  });
  sock.ev.on('creds.update', handlers.credentials);
  sock.ev.on('connection.update', update => handlers.update(update).catch(() => console.error('[WhatsApp] Session operation failed.')));
  if (onMessageCallback) sock.ev.on('messages.upsert', event => {
    if(current === generation) onMessageCallback(event);
  });
  return sock;
}
