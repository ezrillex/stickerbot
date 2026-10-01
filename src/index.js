import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import {
  jidNormalizedUser,
  extractMessageContent,
  downloadContentFromMessage
} from '@whiskeysockets/baileys';
import sharp from 'sharp';
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

    const finalSlug = slug || 'image';
    const filename = `${timestamp}_${mode}_${finalSlug}.${ext}`;
    const filePath = path.join(IMAGES_LOG_DIR, filename);

    fs.writeFileSync(filePath, buffer);
    console.log(`[Log] Raw image saved: logs/images/${filename}`);
  } catch (err) {
    console.warn('[Log] Could not save raw image log:', err.message);
  }
}

function getContextInfo(content) {
  if (!content) return undefined;
  return (
    content.extendedTextMessage?.contextInfo ||
    content.imageMessage?.contextInfo ||
    content.videoMessage?.contextInfo ||
    content.documentMessage?.contextInfo ||
    content.audioMessage?.contextInfo ||
    content.stickerMessage?.contextInfo
  );
}

async function downloadBaileysMedia(mediaMessage, type = 'image') {
  let timeoutId;
  let timedOut = false;
  try {
    const downloadPromise = (async () => {
      const stream = await downloadContentFromMessage(mediaMessage, type);
      let buffer = Buffer.alloc(0);
      for await (const chunk of stream) {
        if (timedOut) {
          if (typeof stream.destroy === 'function') stream.destroy();
          break;
        }
        buffer = Buffer.concat([buffer, chunk]);
      }
      return buffer;
    })();

    // Prevent unhandled rejection if download fails after timeout
    downloadPromise.catch((err) => {
      if (timedOut) {
        console.warn('[WhatsApp Media] Background download failed after timeout:', err.message);
      }
    });

    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        reject(new Error('Tiempo de espera agotado al descargar de WhatsApp'));
      }, 25000);
    });

    const buffer = await Promise.race([downloadPromise, timeoutPromise]);

    if (!buffer || buffer.length === 0) {
      throw new Error('La imagen descargada está vacía o no se pudo leer.');
    }
    return buffer;
  } catch (err) {
    throw new Error(`No se pudo descargar la imagen original (${err.message}). Si es una foto antigua, por favor reenvíala.`);
  } finally {
    clearTimeout(timeoutId);
  }
}

function cleanGroupPrompt(text, botPhone) {
  let cleaned = text.replace(/@\S+/g, '');
  if (botPhone) {
    cleaned = cleaned.replace(new RegExp(botPhone, 'g'), '');
  }
  return cleaned.trim();
}

function parseMessageIntent(rawText, { isGroup = false, botPhone = '', hasImage = false } = {}) {
  const cleanedText = isGroup ? cleanGroupPrompt(rawText || '', botPhone) : (rawText || '').trim();

  // 1. Utility commands first
  if (/^(!help|\/help)(\s|$)/i.test(cleanedText)) {
    return { isUtility: true, utilityType: 'help' };
  }
  if (/^(!status|\/status)(\s|$)/i.test(cleanedText)) {
    return { isUtility: true, utilityType: 'status' };
  }

  // 2. Explicit slash/bang mode commands
  const slashMatch = cleanedText.match(/^(!meme\b|\/meme\b|!sticker\b|\/sticker\b)(?::?\s*([\s\S]*))?$/i);
  if (slashMatch) {
    const cmd = slashMatch[1].toLowerCase();
    const mode = (cmd === '/meme' || cmd === '!meme') ? 'meme' : 'sticker';
    const prompt = (slashMatch[2] || '').trim();
    return {
      isUtility: false,
      mode,
      prompt,
      isBareCommand: !prompt,
      isExplicitMode: true
    };
  }

  // 3. Natural style prefixes (only at the beginning of the text)
  const memeAliasMatch = cleanedText.match(/^(?:meme\s*:\s*|modo\s+meme\b(?:\s*:)?\s*)([\s\S]*)$/i);
  if (memeAliasMatch) {
    const prompt = memeAliasMatch[1].trim();
    return {
      isUtility: false,
      mode: 'meme',
      prompt,
      isBareCommand: !prompt,
      isExplicitMode: true
    };
  }

  const stickerAliasMatch = cleanedText.match(/^(?:sticker\s*:\s*|modo\s+sticker\b(?:\s*:)?\s*)([\s\S]*)$/i);
  if (stickerAliasMatch) {
    const prompt = stickerAliasMatch[1].trim();
    return {
      isUtility: false,
      mode: 'sticker',
      prompt,
      isBareCommand: !prompt,
      isExplicitMode: true
    };
  }

  // 4. Fallback rules
  if (!isGroup) {
    return {
      isUtility: false,
      mode: 'sticker',
      prompt: cleanedText,
      isBareCommand: false,
      isExplicitMode: false
    };
  }

  // In groups:
  if (hasImage) {
    return {
      isUtility: false,
      mode: 'sticker',
      prompt: cleanedText,
      isBareCommand: false,
      isExplicitMode: false
    };
  }

  // Unaccompanied text in group without an explicit mode prefix or image -> ignore
  return {
    isIgnored: true
  };
}

function getAcknowledgmentMessage(mode, { hasReferenceImage = false, prompt = '' } = {}) {
  let ackEmoji = mode === 'meme' ? '🎭' : '🎨';
  let ackTitle = mode === 'meme' ? 'Generando tu meme...' : 'Generando tu sticker...';
  if (hasReferenceImage) {
    ackEmoji = mode === 'meme' ? '📸' : '🎨';
    ackTitle = mode === 'meme' ? 'Transformando tu foto (modo meme)...' : 'Transformando tu foto (modo sticker)...';
  }
  const promptDisplay = prompt ? `"${prompt}"\n` : '';
  return `${ackEmoji} *${ackTitle}*\n${promptDisplay}_Por favor espera unos segundos..._`;
}

async function preprocessReferenceImage(inputBuffer) {
  return sharp(inputBuffer)
    .rotate() // auto-orient based on smartphone EXIF orientation tag
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

function extractMessageText(content) {
  if (!content) return '';
  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    ''
  ).trim();
}

async function handleIncomingMessages({ messages, type }) {
  if (type !== 'notify') return;

  const sock = getSocket();
  if (!sock) return;

  for (const msg of messages) {
    (async () => {
      const remoteJid = msg?.key?.remoteJid;
      let mode = 'sticker';
      let quotaAcquired = false;

      try {
        if (!msg?.message || msg?.key?.fromMe) return;
        if (!remoteJid) return;

        const isGroup = remoteJid.endsWith('@g.us');

        // Unwrap inner message content
        const content = extractMessageContent(msg.message);
        if (!content) return;

        const directImage = content.imageMessage;
        const rawText = extractMessageText(content);

        // Extract quoted context info across all possible Baileys message subtypes
        const contextInfo = getContextInfo(content);
        const quotedContent = contextInfo?.quotedMessage ? extractMessageContent(contextInfo.quotedMessage) : undefined;
        const quotedImage = quotedContent?.imageMessage;

        // An image is present if directly attached or if quoting an existing image
        const targetImage = directImage || quotedImage;

        // Skip message if there is NEITHER text NOR media
        if (!rawText && !targetImage) return;

        let prompt = '';
        let isBareCommand = false;

        if (isGroup) {
          // Group chat requirements:
          // 1. Bot MUST be tagged/mentioned OR replied to
          const botPhone = (config.bot.phoneNumber || '').replace(/[^0-9]/g, '');
          const botJid = sock.user?.id ? jidNormalizedUser(sock.user.id) : '';
          const botLid = sock.user?.lid ? jidNormalizedUser(sock.user.lid) : '';
          const botNum = botJid ? botJid.split('@')[0] : '';

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
            return;
          }

          console.log(`[Group] Message addressed to bot in ${remoteJid}: "${rawText}"`);

          const parsed = parseMessageIntent(rawText, {
            isGroup: true,
            botPhone,
            hasImage: Boolean(targetImage)
          });

          if (parsed.isIgnored) {
            return;
          }

          if (parsed.isUtility) {
            if (parsed.utilityType === 'help') {
              const status = limiter.getStatus();
              const helpMessage = `👋 *Rolex AI StickerBot*\n\n` +
                `Mencióname o responde a mis mensajes con:\n` +
                `• *@bot /sticker <desc>* o *sticker: <desc>* — Genera sticker de ilustración\n` +
                `• *@bot /meme <desc>* o *meme: <desc>* — Genera foto meme cursed\n` +
                `• *@bot (en foto o respondiendo a foto)* sin texto — Convierte a sticker directo (sin gastar cuota IA)\n` +
                `• *@bot <instrucción> (respondiendo a foto)* — Edita foto en modo sticker (ej: \`@bot hazlo llorando\`)\n` +
                `• *@bot /meme* o *meme:* (con foto) — Transforma foto a modo meme\n` +
                `• *@bot /sticker* o *sticker:* (con foto) — Transforma foto a modo sticker\n\n` +
                `• *Uso hoy:* ${status.used}/${status.limit} generaciones IA (Reinicia a las 00:00 UTC)`;
              await sock.sendMessage(remoteJid, { text: helpMessage }, { quoted: msg });
              return;
            }

            if (parsed.utilityType === 'status') {
              const status = limiter.getStatus();
              const statusMessage = `📊 *Rolex AI Status*\n\n` +
                `• *Usados:* ${status.used} / ${status.limit}\n` +
                `• *Disponibles:* ${status.remaining}\n` +
                `• *Reinicia:* 00:00 UTC`;
              await sock.sendMessage(remoteJid, { text: statusMessage }, { quoted: msg });
              return;
            }
          }

          mode = parsed.mode;
          prompt = parsed.prompt;
          isBareCommand = parsed.isBareCommand;
        } else {
          // Private DM requirements:
          const parsed = parseMessageIntent(rawText, {
            isGroup: false,
            botPhone: '',
            hasImage: Boolean(targetImage)
          });

          if (parsed.isUtility) {
            if (parsed.utilityType === 'help') {
              const status = limiter.getStatus();
              const helpMessage = `👋 *Rolex AI StickerBot*\n\n` +
                `*¿Cómo usarlo en chat privado?*\n\n` +
                `✨ *Creación con IA:*\n` +
                `• *Escribe cualquier texto* — Genera sticker automáticamente (ej: \`un gato astronauta\`)\n` +
                `• */meme <desc>* o *meme: <desc>* — Forzar foto meme realista / cursed\n` +
                `• *!sticker <desc>* o *sticker: <desc>* — Forzar modo ilustración sticker\n\n` +
                `📸 *Edición de fotos con IA:*\n` +
                `• *Foto + texto* (o respondiendo a una foto) — Edita la foto con IA (ej: \`hazlo llorando\`, \`ponelo enojado\`)\n` +
                `• *Foto + /meme* o *meme:* o *modo meme* — Transforma a foto meme cursed\n` +
                `• *Foto + /sticker* o *sticker:* o *modo sticker* — Transforma a sticker ilustrado\n\n` +
                `⚡ *Conversión directa (Sin IA / Ilimitado):*\n` +
                `• *Envía cualquier foto sin texto* — Se convierte a sticker al instante sin consumir cuota diaria\n\n` +
                `📊 *Estado:* ${status.used}/${status.limit} generaciones IA hoy (Reinicia 00:00 UTC)`;
              await sock.sendMessage(remoteJid, { text: helpMessage }, { quoted: msg });
              return;
            }

            if (parsed.utilityType === 'status') {
              const status = limiter.getStatus();
              const statusMessage = `📊 *Rolex AI Status*\n\n` +
                `• *Fecha (UTC):* ${status.date}\n` +
                `• *Usados:* ${status.used} / ${status.limit}\n` +
                `• *Disponibles:* ${status.remaining}\n` +
                `• *Reinicia:* 00:00 UTC`;
              await sock.sendMessage(remoteJid, { text: statusMessage }, { quoted: msg });
              return;
            }
          }

          mode = parsed.mode;
          prompt = parsed.prompt;
          isBareCommand = parsed.isBareCommand;
        }

        // Check for Direct Photo -> Sticker (NO AI flow)
        // Criteria:
        // 1. An image is present (targetImage).
        // 2. Either no text was sent, or text is purely a direct sticker phrase ("hazlo sticker", "hacelo sticker", "sticker").
        // Notice: If the user explicitly typed "/sticker", "!sticker", "/meme", "!meme", isBareCommand is true -> routes to AI transform!
        const isDirectStickerPhrase = Boolean(
          prompt && /^(hazlo sticker|hacelo sticker|sticker)$/i.test(prompt)
        );

        if (targetImage && (!prompt || isDirectStickerPhrase) && !isBareCommand) {
          console.log(`\n[Direct Sticker] Converting photo to WhatsApp sticker without AI from: ${remoteJid}`);
          const rawImageBuffer = await downloadBaileysMedia(targetImage);
          const stickerBuffer = await createSticker(rawImageBuffer, { removeBg: false });

          await sock.sendMessage(
            remoteJid,
            { sticker: stickerBuffer },
            { quoted: msg }
          );
          console.log(`[Direct Sticker] Delivered successfully! (No AI quota used)\n`);
          return;
        }

        // If no image is present, validate minimum text prompt length
        if (!targetImage && (!prompt || prompt.length < 2)) {
          const exampleCmd = mode === 'meme' ? '/meme' : '!sticker';
          await sock.sendMessage(
            remoteJid,
            { text: `⚠️ Por favor escribe una descripción para tu sticker, ej:\n\`${exampleCmd} un gato blanco mamado sonriendo\`` },
            { quoted: msg }
          );
          return;
        }

        // Check daily quota limit for AI generations (Atomic)
        if (!limiter.tryAcquire()) {
          const status = limiter.getStatus();
          await sock.sendMessage(
            remoteJid,
            {
              text: `⏳ *Límite diario alcanzado*\n\nEl límite global de ${status.limit} generaciones de hoy se ha agotado.\nSe reiniciará automáticamente a las 00:00 UTC.\n\n💡 _Nota: Aún puedes enviar fotos para convertirlas a stickers directamente._`
            },
            { quoted: msg }
          );
          return;
        }
        quotaAcquired = true;

        const hasReferenceImage = Boolean(targetImage);

        console.log(`\n[Request] Mode: [${mode.toUpperCase()}] | RefImage: ${hasReferenceImage} | BareCmd: ${isBareCommand} | From: ${remoteJid}`);
        console.log(`[Request] Prompt: "${prompt}"`);

        // Download and preprocess reference image if present
        let preprocessedImage = null;
        if (hasReferenceImage) {
          console.log('[Pipeline] Downloading and preprocessing reference image with Sharp...');
          const rawBuf = await downloadBaileysMedia(targetImage);
          preprocessedImage = await preprocessReferenceImage(rawBuf);
        }

        // Send initial acknowledgment to user
        const ackText = getAcknowledgmentMessage(mode, { hasReferenceImage, prompt });
        await sock.sendMessage(
          remoteJid,
          { text: ackText },
          { quoted: msg }
        );

        // Step 1: Prompt enhancement via Gemini Flash Lite (Cloudflare AI Gateway)
        console.log(`[Pipeline] 1/4 Enhancing ${mode} prompt with Gemini Flash Lite...`);
        const enhancedPrompt = await enhancePrompt(prompt, mode, { hasReferenceImage, isBareCommand });
        console.log(`[Pipeline] Enhanced prompt: "${enhancedPrompt}"`);

        // Step 2: Generate image with FLUX (Workers AI direct)
        console.log('[Pipeline] 2/4 Generating 512x512 image with FLUX...');
        let imageBuffer;
        try {
          imageBuffer = await generateImage(enhancedPrompt, preprocessedImage);
        } catch (genErr) {
          if (genErr.isSafetyBlocked) {
            console.warn('[Pipeline] AI safety filter triggered (3030). Automatically sanitizing prompt with Gemini and retrying...');
            const sanitizedPrompt = await sanitizePrompt(enhancedPrompt, mode, { hasReferenceImage });
            console.log(`[Pipeline] Sanitized prompt: "${sanitizedPrompt}"`);
            imageBuffer = await generateImage(sanitizedPrompt, preprocessedImage);
          } else {
            throw genErr;
          }
        }
        console.log(`[Pipeline] Image generated (${imageBuffer.length} bytes)`);

        // Log raw image exactly as it comes from the image model
        saveRawImageLog(imageBuffer, mode, prompt || (isBareCommand ? `${mode}_transform` : 'sticker'));

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

        // Generation and delivery succeeded: keep quota consumed (no refund)
        quotaAcquired = false;

        const count = limiter.getStatus().used;
        console.log(`[Success] Sticker delivered! Total today: ${count}/${config.bot.dailyLimit}\n`);

      } catch (err) {
        console.error('[Error] Failed to process sticker request:', err);

        if (quotaAcquired) {
          try {
            limiter.refund();
          } catch (refundErr) {
            console.error('[Limiter] Error during quota refund:', refundErr.message);
          }
          quotaAcquired = false;
        }

        if (remoteJid && sock) {
          try {
            let userErrorMessage = `❌ *Error generando sticker:* ${err.message}`;
            if (err.isSafetyBlocked) {
              const exampleCmd = mode === 'meme' ? '/meme' : '!sticker';
              userErrorMessage =
                `⚠️ *Filtro de seguridad de IA*\n\n` +
                `Cloudflare bloqueó la imagen por filtros de contenido o marcas protegidas.\n\n` +
                `💡 *Consejo:* Describe la apariencia física en lugar de nombres de marcas o personajes protegidos.\n` +
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
    })();
  }
}

// Start WhatsApp connection when run directly as the main script or under PM2
function isMainEntry() {
  if (process.env.NODE_ENV === 'test') {
    return false;
  }
  if (process.env.pm_id !== undefined) {
    return true;
  }
  const entryPath = process.env.pm_exec_path || process.argv[1];
  if (!entryPath) return false;
  try {
    return import.meta.url === pathToFileURL(path.resolve(entryPath)).href;
  } catch {
    return false;
  }
}

if (isMainEntry()) {
  console.log('==============================================');
  console.log('     Rolex AI StickerBot — Starting Up        ');
  console.log('==============================================');

  connectToWhatsApp(handleIncomingMessages).catch((err) => {
    console.error('[Fatal] Error starting bot:', err);
    process.exit(1);
  });
}

export {
  downloadBaileysMedia,
  handleIncomingMessages,
  preprocessReferenceImage,
  cleanGroupPrompt,
  parseMessageIntent,
  getAcknowledgmentMessage
};
