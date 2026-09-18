import { jidNormalizedUser } from '@whiskeysockets/baileys';
import { config } from './config.js';
import { limiter } from './limiter.js';
import { enhancePrompt } from './gemini.js';
import { generateImage } from './imageGen.js';
import { createSticker } from './sticker.js';
import { connectToWhatsApp, getSocket } from './whatsapp.js';

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
            `Tag me with the command to create a sticker:\n` +
            `• *@bot !sticker <description>*\n\n` +
            `• *Usage today:* ${status.used}/${status.limit} (Resets at 00:00 UTC)`;
          await sock.sendMessage(remoteJid, { text: helpMessage }, { quoted: msg });
          continue;
        }

        if (/(!status|\/status)/i.test(rawText)) {
          const status = limiter.getStatus();
          const statusMessage = `📊 *Rolex AI Status*\n\n` +
            `• *Used:* ${status.used} / ${status.limit}\n` +
            `• *Remaining:* ${status.remaining}\n` +
            `• *Resets:* 00:00 UTC`;
          await sock.sendMessage(remoteJid, { text: statusMessage }, { quoted: msg });
          continue;
        }

        // Extract sticker command anywhere in message (even after mention)
        const match = rawText.match(/(!sticker|\/sticker)\s*(.*)/i);
        if (!match) {
          // Tagged but without command
          continue;
        }

        // Clean out any remaining mentions from prompt
        prompt = match[2].replace(/@\S+/g, '').trim();
      } else {
        // Private DM requirements:
        // Must start with a command (!sticker, /sticker, !status, !help).
        // Any regular conversational text (e.g. "probando", "hello") is strictly IGNORED.

        if (/^(!help|\/help)/i.test(rawText)) {
          const status = limiter.getStatus();
          const helpMessage = `👋 *Rolex AI StickerBot*\n\n` +
            `Start your message with *!sticker* to generate a sticker:\n` +
            `• *Example:* \`!sticker a cute orange cat eating pizza\`\n\n` +
            `• *Today's usage:* ${status.used}/${status.limit} stickers\n` +
            `• *Quota resets:* Daily at 00:00 UTC`;
          await sock.sendMessage(remoteJid, { text: helpMessage }, { quoted: msg });
          continue;
        }

        if (/^(!status|\/status)/i.test(rawText)) {
          const status = limiter.getStatus();
          const statusMessage = `📊 *Rolex AI Status*\n\n` +
            `• *Date (UTC):* ${status.date}\n` +
            `• *Used:* ${status.used} / ${status.limit}\n` +
            `• *Remaining:* ${status.remaining}\n` +
            `• *Resets:* 00:00 UTC`;
          await sock.sendMessage(remoteJid, { text: statusMessage }, { quoted: msg });
          continue;
        }

        const match = rawText.match(/^(!sticker|\/sticker)\s*(.*)/i);
        if (!match) {
          // Regular text without command prefix: IGNORE completely
          continue;
        }

        prompt = match[2].trim();
      }

      if (!prompt || prompt.length < 2) {
        await sock.sendMessage(
          remoteJid,
          { text: '⚠️ Please provide a description after the command, e.g.:\n`!sticker a cool cyber samurai cat`' },
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
            text: `⏳ *Daily Limit Reached*\n\nThe global daily limit of ${status.limit} stickers has been exhausted for today.\nQuota will automatically reset at 00:00 UTC.`
          },
          { quoted: msg }
        );
        continue;
      }

      console.log(`\n[Request] From: ${remoteJid}`);
      console.log(`[Request] Prompt: "${prompt}"`);

      // Send initial acknowledgment to user
      await sock.sendMessage(
        remoteJid,
        { text: `🎨 *Generating your sticker...*\n"${prompt}"\n_Please wait a few seconds._` },
        { quoted: msg }
      );

      // Step 1: Prompt enhancement via Gemini Flash Lite (Cloudflare AI Gateway)
      console.log('[Pipeline] 1/4 Enhancing prompt with Gemini Flash Lite...');
      const enhancedPrompt = await enhancePrompt(prompt);
      console.log(`[Pipeline] Enhanced prompt: "${enhancedPrompt}"`);

      // Step 2: Generate image with FLUX (Workers AI direct)
      console.log('[Pipeline] 2/4 Generating 512x512 image with FLUX...');
      const imageBuffer = await generateImage(enhancedPrompt);
      console.log(`[Pipeline] Image generated (${imageBuffer.length} bytes)`);

      // Step 3: Background cutout & WebP sticker creation
      console.log('[Pipeline] 3/4 Removing dark background and creating WebP sticker...');
      const stickerBuffer = await createSticker(imageBuffer);
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
        await sock.sendMessage(
          msg.key.remoteJid,
          { text: `❌ *Error generating sticker:* ${err.message}` },
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
