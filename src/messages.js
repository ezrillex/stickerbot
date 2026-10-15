export function cleanGroupPrompt(text) {
  return text.replace(/@\d+\b/g, '').trim();
}

export function parseMessageIntent(rawText, { isGroup = false, hasImage = false, prefix = '!sticker' } = {}) {
  const cleanedText = isGroup ? cleanGroupPrompt(rawText || '') : (rawText || '').trim();

  // 1. Utility commands first
  if (/^(!help|\/help)(\s|$)/i.test(cleanedText)) {
    return { isUtility: true, utilityType: 'help' };
  }
  if (/^(!status|\/status)(\s|$)/i.test(cleanedText)) {
    return { isUtility: true, utilityType: 'status' };
  }

  // 2. Explicit slash/bang mode commands
  const slashMatch = cleanedText.match(/^[!\/](meme|sticker)(?=$|[\s:]):?\s*([\s\S]*)$/i);
  if (slashMatch) {
    const mode = slashMatch[1].toLowerCase();
    const prompt = (slashMatch[2] || '').trim();
    return explicitIntent(mode, prompt);
  }

  // The configured prefix adds a sticker command without overriding built-in modes.
  if (prefix !== '!sticker' && cleanedText.toLowerCase().startsWith(prefix.toLowerCase())) {
    const rest = cleanedText.slice(prefix.length);
    if (!rest || /^[\s:]/.test(rest)) return explicitIntent('sticker', rest.replace(/^:?\s*/, '').trim());
  }

  // Natural style prefixes apply only at the beginning of a message.
  const alias = cleanedText.match(/^(?:(meme|sticker)\s*:\s*|modo\s+(meme|sticker)(?=$|[\s:])\s*:?\s*)([\s\S]*)$/i);
  if (alias) {
    return explicitIntent((alias[1] || alias[2]).toLowerCase(), alias[3].trim());
  }

  // 4. Fallback rules
  if (!isGroup || hasImage) {
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

function explicitIntent(mode, prompt) {
  return { isUtility: false, mode, prompt, isBareCommand: !prompt, isExplicitMode: true };
}

export function getAcknowledgmentMessage(mode, { hasReferenceImage = false, prompt = '' } = {}) {
  let ackEmoji = mode === 'meme' ? '🎭' : '🎨';
  let ackTitle = mode === 'meme' ? 'Generando tu meme...' : 'Generando tu sticker...';
  if (hasReferenceImage) {
    ackEmoji = mode === 'meme' ? '📸' : '🎨';
    ackTitle = mode === 'meme' ? 'Transformando tu foto (modo meme)...' : 'Transformando tu foto (modo sticker)...';
  }
  const promptDisplay = prompt ? `"${prompt}"\n` : '';
  return `${ackEmoji} *${ackTitle}*\n${promptDisplay}_Por favor espera unos segundos..._`;
}


export function getContextInfo(content) {
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

export function extractMessageText(content) {
  if (!content) return '';
  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    ''
  ).trim();
}
