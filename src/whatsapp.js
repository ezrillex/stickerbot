import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUTH_DIR = path.join(__dirname, '..', 'auth_session');

let sockInstance = null;

function promptQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

function clearAuthSession() {
  try {
    if (fs.existsSync(AUTH_DIR)) {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  } catch (err) {
    console.warn('[WhatsApp] Could not clear auth directory:', err.message);
  }
}

export function getSocket() {
  return sockInstance;
}

export function setSocket(sock) {
  sockInstance = sock;
}

export async function connectToWhatsApp(onMessageCallback) {
  console.log('[WhatsApp] Initializing connection...');

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`[WhatsApp] Using Baileys version ${version.join('.')}, latest: ${isLatest}`);

  let pairingPhoneNumber = config.bot.phoneNumber ? config.bot.phoneNumber.replace(/[^0-9]/g, '') : '';

  // If not registered and no phone number in .env, prompt in terminal
  if (!state.creds.registered && !pairingPhoneNumber && process.stdin.isTTY) {
    console.log('\n[WhatsApp] No active session found.');
    console.log('You can pair using a Phone Number Pairing Code (no camera needed) or QR code.');
    const input = await promptQuestion(
      'Enter your WhatsApp phone number with country code (e.g. 15551234567)\nor press ENTER to use QR code instead: '
    );
    if (input) {
      pairingPhoneNumber = input.replace(/[^0-9]/g, '');
    }
  }

  const usePairingCode = Boolean(!state.creds.registered && pairingPhoneNumber);

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: Browsers.ubuntu('Chrome'),
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 30000
  });

  sockInstance = sock;

  // Request Pairing Code if phone number provided and not registered
  let pairingTimer;
  let closed = false;
  if (usePairingCode) {
    pairingTimer = setTimeout(async () => {
      try {
        console.log(`\n[WhatsApp] Requesting 8-digit pairing code for: +${pairingPhoneNumber}...`);
        const code = await sock.requestPairingCode(pairingPhoneNumber);
        const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
        console.log('\n======================================================');
        console.log(`  YOUR WHATSAPP PAIRING CODE:  ${formattedCode}`);
        console.log('======================================================');
        console.log('How to enter the code on your phone:');
        console.log('1. Open WhatsApp on your phone');
        console.log('2. Tap Settings (or 3-dots menu) > Linked Devices');
        console.log('3. Tap "Link a device"');
        console.log('4. Tap "Link with phone number instead" at the bottom');
        console.log(`5. Enter this code: ${formattedCode}\n`);
      } catch (err) {
        console.error('[WhatsApp] Failed to request pairing code:', err.message);
      }
    }, 3000);
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !usePairingCode) {
      console.log('\n=========================================');
      console.log(' Scan this QR code with WhatsApp to log in:');
      console.log('=========================================\n');
      qrcode.generate(qr, { small: true });
      console.log('\n(Open WhatsApp > Linked devices > Link a device)\n');
    }

    if (connection === 'close') {
      if (closed) return;
      closed = true;
      clearTimeout(pairingTimer);
      sockInstance = null;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode === DisconnectReason.loggedOut) {
        console.log('[WhatsApp] Session logged out. Cleaning auth session...');
        clearAuthSession();
        console.log('[WhatsApp] Restart the bot to link again.');
      } else {
        // Preserve partially linked credentials during transient failures and pairing restarts.
        console.log(`[WhatsApp] Connection closed (status: ${statusCode}). Reconnecting...`);
        setTimeout(() => {
          connectToWhatsApp(onMessageCallback).catch(error => {
            console.error('[WhatsApp] Reconnection failed:', error.message);
            process.exitCode = 1;
          });
        }, 3000);
      }
    } else if (connection === 'open') {
      console.log('\n=========================================');
      console.log(' WhatsApp connection opened successfully!');
      console.log(' Bot is online and listening for messages.');
      console.log('=========================================\n');
    }
  });

  sock.ev.on('creds.update', () => {
    saveCreds().catch(error => console.error('[WhatsApp] Could not save session:', error.message));
  });

  if (onMessageCallback) {
    sock.ev.on('messages.upsert', update => {
      Promise.resolve().then(() => onMessageCallback(update)).catch(error => {
        console.error('[WhatsApp] Message handler failed:', error.message);
      });
    });
  }

  return sock;
}
