import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { jidNormalizedUser } from '@whiskeysockets/baileys';
import { config } from './config.js';
import { limiter } from './limiter.js';
import { enhancePrompt, sanitizePrompt } from './gemini.js';
import { generateImage } from './imageGen.js';
import { createSticker } from './sticker.js';
import { connectToWhatsApp, getSocket } from './whatsapp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const IMAGES_LOG_DIR = path.join(__dirname, '..', 'logs', 'images');

function saveRawImageLog(buffer, mode, userPrompt) {
  try {
    if (!fs.existsSync(IMAGES_LOG_DIR)) {
      fs.mkdirSync(IMAGES_LOG_DIR, { recursive: true });
    }

    let ext = 'png';
    if (buffer[0] === 0xff && buffer[1] === 0xd8) ext = 'jpg';
    else if (buffer[0] === 0x89 && buffer[1] === 0x50) ext = 'png';
    else if (buffer[0] === 0x52 && buffer[1] === 0x49) ext = 'webp';

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const slug = (userPrompt || 'image')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .slice(0, 30)
      .replace(/^_+|_+$/g, '');

    const filename = `${timestamp}_${mode}_${slug}.${ext}`;
    const filePath = path.join(IMAGES_LOG_DIR, filename);

    fs.writeFileSync(filePath, buffer);
    console.log(`[Log] Raw image saved: logs/images/${filename}`);
  } catch (err) {
    console.warn('[Log] Could not save raw image log:', err.message);
  }
}

console.log('==============================================');
console.log('     Rolex AI StickerBot — Starting Up        ');
console.log('==============================================');

function extractMessageText(message) {
  if (!message) return '';
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    ''
  ).trim();
}

async function handleIncomingMessages({ messages, type }) {
  if (type !== 'notify') return;

  const sock = getSocket();
  if (!sock) return;

  for (const msg of messages) {
    try {
      if (!msg.message || msg.key.fromMe) continue;

      const remoteJid = msg.key.remoteJid;
      if (!remoteJid) continue;

      const rawText = extractMessageText(msg.message);
      if (!rawText) continue;

      const isGroup = remoteJid.endsWith('@g.us');
      let prompt = '';
      let mode = 'sticker';

      if (isGroup) {
        // Group chat requirements:
        // 1. Bot MUST be tagged/mentioned OR replied to
        // 2. Message MUST contain a command (!sticker, /sticker, !status, !help)
        const botPhone = (config.bot.phoneNumber || '').replace(/[^0-9]/g, '');
        const botJid = sock.user?.id ? jidNormalizedUser(sock.user.id) : '';
        const botLid = sock.user?.lid ? jidNormalizedUser(sock.user.lid) : '';
        const botNum = botJid ? botJid.split('@')[0] : '';

        const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
        const mentionedJids = contextInfo?.mentionedJid || [];
        const quotedParticipant = contextInfo?.participant ? jidNormalizedUser(contextInfo.participant) : '';

        const isMentionedInJids = mentionedJids.some(jid => {
          const norm = jidNormalizedUser(jid);
          return (
            (botJid && norm === botJid) ||
            (botLid && norm === botLid) ||
            (botNum && norm.includes(botNum)) ||
            (botPhone && norm.includes(botPhone))
          );
        });

        const isReplyingToBot = Boolean(
          quotedParticipant && (
            (botJid && quotedParticipant === botJid) ||
            (botLid && quotedParticipant === botLid) ||
            (botNum && quotedParticipant.includes(botNum)) ||
            (botPhone && quotedParticipant.includes(botPhone))
          )
        );

        const isTextTagged = Boolean(
          botPhone && rawText.includes(botPhone)
        );

        const isAddressedToBot = isMentionedInJids || isReplyingToBot || isTextTagged;

        if (!isAddressedToBot) {
          // Not tagged or replied to: ignore group chatter
          continue;
        }

        console.log(`[Group] Message addressed to bot in ${remoteJid}: "${rawText}"`);

        // Handle group help / status
        if (/(!help|\/help)/i.test(rawText)) {
          const status = limiter.getStatus();
          const helpMessage = `👋 *Rolex AI StickerBot*\n\n` +
            `Tag me with one of these commands:\n` +
            `• *@bot !sticker <desc>* — Sticker ilustración con bordes limpios\n` +
            `• *@bot /meme <desc>* — Foto de meme low-quality / cursed (sin bordes)\n\n` +
            `• *Uso hoy:* ${status.used}/${status.limit} (Reinicia a las 00:00 UTC)`;
          await sock.sendMessage(remoteJid, { text: helpMessage }, { quoted: msg });
          continue;
        }

        if (/(!status|\/status)/i.test(rawText)) {
          const status = limiter.getStatus();
          const statusMessage = `📊 *Rolex AI Status*\n\n` +
            `• *Usados:* ${status.used} / ${status.limit}\n` +
            `• *Disponibles:* ${status.remaining}\n` +
            `• *Reinicia:* 00:00 UTC`;
          await sock.sendMessage(remoteJid, { text: statusMessage }, { quoted: msg });
          continue;
        }

        // Check for meme vs sticker command anywhere in the message
        const memeMatch = rawText.match(/(!meme|\/meme)\s*(.*)/i);
        const stickerMatch = rawText.match(/(!sticker|\/sticker)\s*(.*)/i);

        if (memeMatch) {
          mode = 'meme';
          prompt = memeMatch[2].replace(/@\S+/g, '').trim();
        } else if (stickerMatch) {
          mode = 'sticker';
          prompt = stickerMatch[2].replace(/@\S+/g, '').trim();
        } else {
          // Tagged but without valid command
          continue;
        }
      } else {
        // Private DM requirements:
        // Must start with a command (!sticker, /sticker, !meme, /meme, !status, !help).
        // Any regular conversational text (e.g. "probando", "hello") is strictly IGNORED.

        if (/^(!help|\/help)/i.test(rawText)) {
          const status = limiter.getStatus();
          const helpMessage = `👋 *Rolex AI StickerBot*\n\n` +
            `Comandos disponibles:\n` +
            `• *!sticker <desc>* — Sticker ilustración con vectores y colores vivos\n` +
            `• */meme <desc>* — Foto meme realista estilo cámara low quality / cursed\n\n` +
            `• *Ejemplos:*\n` +
            `  \`!sticker un gato naranja comiendo pizza\`\n` +
            `  \`/meme un gato blanco mamado haciendo pose de musculo\`\n\n` +
            `• *Uso hoy:* ${status.used}/${status.limit} stickers\n` +
            `• *Reinicia:* 00:00 UTC`;
          await sock.sendMessage(remoteJid, { text: helpMessage }, { quoted: msg });
          continue;
        }

        if (/^(!status|\/status)/i.test(rawText)) {
          const status = limiter.getStatus();
          const statusMessage = `📊 *Rolex AI Status*\n\n` +
            `• *Fecha (UTC):* ${status.date}\n` +
            `• *Usados:* ${status.used} / ${status.limit}\n` +
            `• *Disponibles:* ${status.remaining}\n` +
            `• *Reinicia:* 00:00 UTC`;
          await sock.sendMessage(remoteJid, { text: statusMessage }, { quoted: msg });
          continue;
        }

        const memeMatch = rawText.match(/^(!meme|\/meme)\s*(.*)/i);
        const stickerMatch = rawText.match(/^(!sticker|\/sticker)\s*(.*)/i);

        if (memeMatch) {
          mode = 'meme';
          prompt = memeMatch[2].trim();
        } else if (stickerMatch) {
          mode = 'sticker';
          prompt = stickerMatch[2].trim();
        } else {
          // Regular text without command prefix: IGNORE completely
          continue;
        }
      }

      if (!prompt || prompt.length < 2) {
        const exampleCmd = mode === 'meme' ? '/meme' : '!sticker';
        await sock.sendMessage(
          remoteJid,
          { text: `⚠️ Por favor escribe una descripción después del comando, ej:\n\`${exampleCmd} un gato blanco mamado sonriendo\`` },
          { quoted: msg }
        );
        continue;
      }

      // Check daily quota limit
      if (!limiter.canGenerate()) {
        const status = limiter.getStatus();
        await sock.sendMessage(
          remoteJid,
          {
            text: `⏳ *Límite diario alcanzado*\n\nEl límite global de ${status.limit} generaciones de hoy se ha agotado.\nSe reiniciará automáticamente a las 00:00 UTC.`
          },
          { quoted: msg }
        );
        continue;
      }

      console.log(`\n[Request] Mode: [${mode.toUpperCase()}] | From: ${remoteJid}`);
      console.log(`[Request] Prompt: "${prompt}"`);

      // Send initial acknowledgment to user
      const ackEmoji = mode === 'meme' ? '🎭' : '🎨';
      const ackTitle = mode === 'meme' ? 'Generando tu meme...' : 'Generando tu sticker...';
      await sock.sendMessage(
        remoteJid,
        { text: `${ackEmoji} *${ackTitle}*\n"${prompt}"\n_Por favor espera unos segundos..._` },
        { quoted: msg }
      );

      // Step 1: Prompt enhancement via Gemini Flash Lite (Cloudflare AI Gateway)
      console.log(`[Pipeline] 1/4 Enhancing ${mode} prompt with Gemini Flash Lite...`);
      const enhancedPrompt = await enhancePrompt(prompt, mode);
      console.log(`[Pipeline] Enhanced prompt: "${enhancedPrompt}"`);

      // Step 2: Generate image with FLUX (Workers AI direct)
      console.log('[Pipeline] 2/4 Generating 512x512 image with FLUX...');
      let imageBuffer;
      try {
        imageBuffer = await generateImage(enhancedPrompt);
      } catch (genErr) {
        if (genErr.isSafetyBlocked) {
          console.warn('[Pipeline] AI safety filter triggered (3030). Automatically sanitizing prompt with Gemini and retrying...');
          const sanitizedPrompt = await sanitizePrompt(enhancedPrompt, mode);
          console.log(`[Pipeline] Sanitized prompt: "${sanitizedPrompt}"`);
          imageBuffer = await generateImage(sanitizedPrompt);
        } else {
          throw genErr;
        }
      }
      console.log(`[Pipeline] Image generated (${imageBuffer.length} bytes)`);

      // Log raw image exactly as it comes from the image model
      saveRawImageLog(imageBuffer, mode, prompt);

      // Step 3: Background cutout & WebP sticker creation
      console.log('[Pipeline] 3/4 Removing dark background and creating WebP sticker...');
      const stickerBuffer = await createSticker(imageBuffer, { removeBg: true });
      console.log(`[Pipeline] Sticker ready (${stickerBuffer.length} bytes)`);

      // Step 4: Send sticker as quoted reply
      console.log('[Pipeline] 4/4 Delivering sticker to WhatsApp...');
      await sock.sendMessage(
        remoteJid,
        { sticker: stickerBuffer },
        { quoted: msg }
      );

      const count = limiter.increment();
      console.log(`[Success] Sticker delivered! Total today: ${count}/${config.bot.dailyLimit}\n`);

    } catch (err) {
      console.error('[Error] Failed to process sticker request:', err);
      try {
        let userErrorMessage = `❌ *Error generando sticker:* ${err.message}`;
        if (err.isSafetyBlocked) {
          const exampleCmd = mode === 'meme' ? '/meme' : '!sticker';
          userErrorMessage =
            `⚠️ *Filtro de seguridad de IA*\n\n` +
            `Cloudflare bloqueó la imagen por filtros de contenido o marcas protegidas (suele suceder al mencionar nombres de juegos, franquicias o palabras ambiguas).\n\n` +
            `💡 *Consejo:* En vez del nombre del juego, describe la apariencia física del personaje.\n` +
            `_Ejemplo:_ En lugar de \`${exampleCmd} personaje de peak\`, prueba con:\n` +
            `\`${exampleCmd} un explorador con abrigo de nieve, mochila de montañismo y gorrito saludando\``;
        } else if (err.isQuotaExhausted) {
          userErrorMessage = `⏳ *Límite de Cloudflare alcanzado*\n\nSe ha agotado la cuota diaria de Cloudflare Workers AI. Se reiniciará automáticamente a las 00:00 UTC.`;
        }

        await sock.sendMessage(
          remoteJid,
          { text: userErrorMessage },
          { quoted: msg }
        );
      } catch (replyErr) {
        console.error('[Error] Could not send error message to user:', replyErr.message);
      }
    }
  }
}

// Start WhatsApp connection
connectToWhatsApp(handleIncomingMessages).catch((err) => {
  console.error('[Fatal] Error starting bot:', err);
  process.exit(1);
});
