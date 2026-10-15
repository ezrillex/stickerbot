import { jidNormalizedUser, extractMessageContent } from '@whiskeysockets/baileys';
import { config } from './config.js';
import { limiter } from './limiter.js';
import { enhancePrompt, sanitizePrompt } from './gemini.js';
import { generateImage } from './imageGen.js';
import { createSticker } from './sticker.js';
import { getSocket } from './whatsapp.js';
import { downloadBaileysMedia, preprocessReferenceImage } from './media.js';
import { parseMessageIntent, getAcknowledgmentMessage, getContextInfo, extractMessageText } from './messages.js';
import { getUtilityMessage } from './replies.js';
import { saveRawImageLog } from './imageLog.js';

export { downloadBaileysMedia, preprocessReferenceImage } from './media.js';
export { cleanGroupPrompt, parseMessageIntent, getAcknowledgmentMessage } from './messages.js';

export function isAddressedToBot(contextInfo, rawText, user, phoneNumber = '') {
  const identities = [user?.id, user?.lid, phoneNumber ? `${phoneNumber}@s.whatsapp.net` : '']
    .filter(Boolean).map(jidNormalizedUser);
  const matches = jid => Boolean(jid && identities.includes(jidNormalizedUser(jid)));
  const phone = phoneNumber || identities.find(jid => jid.endsWith('@s.whatsapp.net'))?.split('@')[0];
  return Boolean(
    contextInfo?.mentionedJid?.some(matches) ||
    matches(contextInfo?.participant) ||
    (phone && rawText.match(/@\d+\b/g)?.includes(`@${phone}`))
  );
}

export async function handleIncomingMessages({ messages, type }) {
  if (type !== 'notify') return;

  const sock = getSocket();
  if (!sock) return;

  await Promise.all(messages.map(msg => handleMessage(msg, sock)));
}

async function handleMessage(msg, sock) {
  const remoteJid = msg?.key?.remoteJid;
  let mode = 'sticker';
  let quotaAcquired = false;
  let acquiredDate;

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

    const botPhone = (config.bot.phoneNumber || '').replace(/[^0-9]/g, '');
    if (isGroup && !isAddressedToBot(contextInfo, rawText, sock.user, botPhone)) return;

    const parsed = parseMessageIntent(rawText, {
      isGroup, hasImage: Boolean(targetImage), prefix: config.bot.prefix
    });
    if (parsed.isIgnored) return;
    if (parsed.isUtility) {
      const text = getUtilityMessage(parsed.utilityType, isGroup, limiter.getStatus(), config.bot.prefix);
      await sock.sendMessage(remoteJid, { text }, { quoted: msg });
      return;
    }
    mode = parsed.mode;
    const { prompt, isBareCommand } = parsed;

    // Bare mode commands request an AI transform; an uncaptioned photo converts directly.
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
    acquiredDate = limiter.currentDate;

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
        limiter.refund(acquiredDate);
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
}
