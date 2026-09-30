import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
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
  if (!state.creds.registered && !pairingPhoneNumber) {
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

  let pairingRequested = false;

  // Request Pairing Code if phone number provided and not registered
  if (usePairingCode && !pairingRequested) {
    pairingRequested = true;
    setTimeout(async () => {
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

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !usePairingCode) {
      console.log('\n=========================================');
      console.log(' Scan this QR code with WhatsApp to log in:');
      console.log('=========================================\n');
      qrcode.generate(qr, { small: true });
      console.log('\n(Open WhatsApp > Linked devices > Link a device)\n');
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output?.statusCode
        : (lastDisconnect?.error?.output?.statusCode);

      const isRegistered = Boolean(state.creds.registered);

      if (isRegistered) {
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(`[WhatsApp] Connection closed (status: ${statusCode}). Reconnecting: ${shouldReconnect}`);

        if (shouldReconnect) {
          setTimeout(() => connectToWhatsApp(onMessageCallback), 3000);
        } else {
          console.log('[WhatsApp] Session logged out from phone. Cleaning auth session...');
          clearAuthSession();
          console.log('[WhatsApp] Restart the bot to link again.');
        }
      } else {
        // Pairing phase: If 401 happened before registration completed, clean and retry
        console.log(`[WhatsApp] Connection closed during pairing (status: ${statusCode}). Resetting session for a fresh code...`);
        clearAuthSession();
        setTimeout(() => connectToWhatsApp(onMessageCallback), 3000);
      }
    } else if (connection === 'open') {
      console.log('\n=========================================');
      console.log(' WhatsApp connection opened successfully!');
      console.log(' Bot is online and listening for messages.');
      console.log('=========================================\n');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  if (onMessageCallback) {
    sock.ev.on('messages.upsert', onMessageCallback);
  }

  return sock;
}
